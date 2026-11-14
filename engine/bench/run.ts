/**
 * The end-to-end benchmark (SCR-64): replays made-up sessions through the engine with a fake
 * clock and measures what became a task and what got ticked, against labels written by hand.
 *
 *   bun bench/run.ts [--model none|apple|ollama:<name>] [--only <scenario id>] [--verbose] [--held-out]
 *
 * `none` (the default) asks no model: deterministic, and what CI runs. `apple` asks Apple's
 * on-device model through the app's binary (DIDJA_JUDGE, or the Debug build); `ollama:<name>`
 * does the same with that local model asked first, as the app does when one is on. Those two
 * need this Mac and are run by hand, like eval/ollama.ts.
 *
 * Exits 1 when any task is ticked wrongly: before it was done, or when it never was.
 *
 * Speed (SCR-75): every new task, tick and "looks done?" is timed as `didja quality` times it, on a
 * fake clock that charges each model call its measured median cost (`MODEL_COST_MS`). Observations
 * are handled by a pass the moment they are written, so this is the engine's own share; the wait
 * for the next pass and for capture is measured live. Exits 1 too when a path that needs no model
 * (a new task, a sure tick) takes over 3 s.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findChatReader, findCriteriaWriter, findJudge, findLooker, findMailReader, findReplyJudge, findTitler } from '../src/cli.ts';
import { assistantFor, assistants, useAssistants } from '../src/assistants.ts';
import { catalogue, useCatalogue } from '../src/done.ts';
import { profileFor, profiles, useProfiles } from '../src/profiles.ts';
import { pollOnce } from '../src/engine.ts';
import type { PollOptions } from '../src/engine.ts';
import { SPEED_KINDS, SPEED_TARGET_MS, percentiles, seconds, speedKind } from '../src/quality.ts';
import type { Percentiles, SpeedKind } from '../src/quality.ts';
import { Store } from '../src/store.ts';
import type { CaptureLevel } from '../src/store.ts';

/** One observation as capture writes it: the new lines of one window, with its ⟦…⟧ section lines. */
export interface Step {
  /** Minutes after the scenario's start. */
  at: number;
  app: string;
  bundle: string;
  title: string;
  url?: string | null;
  source?: 'ax' | 'ocr';
  text: string[];
}

/**
 * Which tool a scenario's tasks come from (SCR-82): the AI assistant, editor agent or terminal agent,
 * or `email`, `messaging`, `notes`, `editor` (a document), `first-day` (a new user's first session
 * across tools) and `done-target` (where a step is done, and near-misses that must not tick).
 */
export const FAMILIES = [
  'claude-app', 'chatgpt', 'gemini', 'copilot', 'claude-code', 'codex', 'gemini-cli', 'copilot-cli', 'aider', 'opencode', 'goose',
  'vscode-copilot', 'cursor', 'windsurf', 'devin', 'editor', 'email', 'messaging', 'notes', 'first-day', 'done-target',
] as const;
export type Family = typeof FAMILIES[number];

export interface Scenario {
  id: string;
  about: string;
  family: Family;
  /** Local time the session starts, "2026-11-11T09:00". */
  start: string;
  /** Your name, as the app knows it (default "Mike Rosen"). */
  me?: string;
  /** Minutes to keep polling after the last step (default 15: a chat ask waits 10 for a reply). */
  tail?: number;
  steps: Step[];
  expect: {
    /** Tasks that should exist: every word appears in the title (any case). `done` is when and where
     * it was really done, or null when it never was. */
    tasks: { words: string[]; done: { at: number; where: string } | null; due?: string }[];
    /** Tasks that must not exist, by the same words rule. */
    none: string[][];
    /**
     * Someone else's to do (SCR-103): an ask to a group that does not name you, what another person
     * promised. One on your list is an owner error, not only an unwanted task.
     */
    theirs?: string[][];
    /** Asks you sent (SCR-99): they belong in Waiting on. One on your list as your task is an owner error. */
    waiting?: string[][];
  };
}

export interface ScenarioResult {
  id: string;
  family: Family;
  /** The AI tools (assistant profile ids) recognised in the scenario's windows (SCR-83). */
  recognised: string[];
  expected: number;
  captured: number;
  matched: number;
  /** Captured tasks still on the list at the end that match a "must not exist" label (or are someone else's). */
  unwanted: string[];
  /**
   * Tasks given to the wrong person (SCR-103): someone else's on your list ("theirs: …"), an ask you
   * sent on your list as your task ("sent: …"), or one of yours filed under Waiting on ("yours: …").
   */
  ownerErrors: string[];
  /** Asks you sent that should be waited on, and how many of them are in Waiting on at the end. */
  waitingExpected: number;
  waitingFound: number;
  /** Labelled due days (SCR-97): how many tasks carry one, how many got that day, and the ones that got another. */
  dueExpected: number;
  dueRight: number;
  dueWrong: string[];
  /** Tasks the engine made and then took back (dismissed, with why), which left the list (SCR-85). */
  takenBack: string[];
  /** Steps Didja added itself after one was done (SCR-86: "Redeploy on Vercel…"); not captured, so not counted as made. */
  followUps: string[];
  ticked: number;
  suggested: number;
  missed: number;
  wrongTicks: string[];
  wrongSuggestions: string[];
  /** Why each task captured was made (SCR-96), as the engine wrote it; null where none was written. */
  whys: (string | null)[];
  /** Asks left in the Suggested tray at the end (Capture: Everything, SCR-95); never tasks. */
  suggestedAsks: string[];
  /** Minutes from done to ticked, or to suggested, per task that was. */
  latencies: number[];
  titles: string[];
  /** Simulated milliseconds from the screen showing it to Didja showing it, per timed event (SCR-75). */
  speeds: { what: SpeedKind; ms: number }[];
}

export type ModelChoice = 'none' | 'apple' | `ollama:${string}`;

/** How often the engine's loop polls (`runLoop`'s default interval). */
export const POLL_SECONDS = 5;

/**
 * What one model call is charged on the fake clock: medians measured on the maintainer's Mac
 * (eval/lists.ts: Apple's on-device model about 0.7 s, qwen3.8 in Ollama about 2.3 s), rounded up.
 */
export const MODEL_COST_MS = { apple: 1000, ollama: 2500 } as const;

/** Jobs the local model is asked first, when one is on; the rest always go to Apple's. */
const LOCAL_JOBS = new Set<keyof PollOptions>(['judge', 'looker', 'mailReader']);

/**
 * The options with every model call charged to `charge` at its cost (SCR-75). A call that finds no
 * model still costs a start-up; that is what the app pays too.
 */
export function chargedOptions(opts: PollOptions, model: ModelChoice, charge: (ms: number) => void): PollOptions {
  if (model === 'none') return opts;
  const local = model.startsWith('ollama:');
  const out: PollOptions = {};
  for (const [name, fn] of Object.entries(opts) as [keyof PollOptions, ((...a: unknown[]) => unknown) | undefined][]) {
    if (!fn) continue;
    const cost = local && LOCAL_JOBS.has(name) ? MODEL_COST_MS.ollama : MODEL_COST_MS.apple;
    (out as Record<string, unknown>)[name] = (...args: unknown[]) => {
      charge(cost);
      return fn(...args);
    };
  }
  return out;
}

const DEBUG_APP = join(import.meta.dir, '../../app/build/Build/Products/Debug/Didja.app/Contents/MacOS/Didja');

export function modelOptions(model: ModelChoice): PollOptions {
  if (model === 'none') return {};
  process.env.DIDJA_JUDGE ??= DEBUG_APP;
  const local = model.startsWith('ollama:') ? model.slice('ollama:'.length) : null;
  return {
    judge: findJudge(() => local), titler: findTitler(), looker: findLooker(() => local), mailReader: findMailReader(() => local),
    chatReader: findChatReader(), replyJudge: findReplyJudge(), criteria: findCriteriaWriter(),
  };
}

const matches = (title: string, words: string[]) => {
  const t = title.toLowerCase();
  return words.every((w) => t.includes(w.toLowerCase()));
};

export function runScenario(s: Scenario, opts: PollOptions = {}, model: ModelChoice = 'none', level?: CaptureLevel): ScenarioResult {
  const store = new Store(':memory:');
  if (level) store.setCaptureLevel(level);
  // The fake clock inside a pass: it moves only when a model is asked (SCR-75).
  let spent = 0;
  store.clock = () => spent;
  opts = chargedOptions(opts, model, (ms) => { spent += ms; });
  store.setMeta('my_name', s.me ?? 'Mike Rosen');
  const start = new Date(s.start);
  if (Number.isNaN(start.getTime())) throw new Error(`${s.id}: bad start`);
  const time = (minutes: number) => new Date(start.getTime() + minutes * 60_000);
  const steps = [...s.steps].sort((a, b) => a.at - b.at);
  const end = (steps.at(-1)?.at ?? 0) + (s.tail ?? 15);
  const tickedAt = new Map<number, number>();
  const suggestedAt = new Map<number, number>();

  // Every five seconds, as the engine's loop does, and right after each observation.
  let next = 0;
  for (let tick = 0; tick <= end * 60 / POLL_SECONDS; tick++) {
    const minute = (tick * POLL_SECONDS) / 60;
    while (next < steps.length && steps[next]!.at <= minute) {
      const step = steps[next++]!;
      store.insertObservation({
        ts: time(step.at).toISOString(), bundleId: step.bundle, app: step.app, windowTitle: step.title,
        url: step.url ?? null, source: step.source ?? 'ax', text: step.text.join('\n'),
      });
    }
    // With a model, as `didja run` does (SCR-76): the fast lane first, then the model lane's full pass.
    if (model !== 'none') pollOnce(store, time(minute), { lane: 'fast', judging: opts.judge !== undefined });
    pollOnce(store, time(minute), opts);
    for (const t of store.listTasks({ all: true })) {
      if (t.status === 'done' && !tickedAt.has(t.id)) tickedAt.set(t.id, minute);
      if (t.suggestion && !suggestedAt.has(t.id)) suggestedAt.set(t.id, minute);
    }
  }

  // What is on the list at the end: a task the engine took back (an agent ran it, a list judged the
  // assistant's own) has left it, so it is neither found nor unwanted. Only the engine dismisses here.
  // A follow-up Didja added itself (SCR-86) was not captured from the screen: listed apart.
  const added = new Set(store.listTasks({ all: true }).filter((t) => store.listEvidence(t.id).some((e) => (e.detail ?? '').startsWith('Added by Didja:'))).map((t) => t.id));
  const everything = store.listTasks({ all: true }).filter((t) => !t.isGroup && !added.has(t.id));
  const tasks = everything.filter((t) => t.status !== 'dismissed');
  const followUps = store.listTasks({ all: true }).filter((t) => added.has(t.id)).map((t) => t.title);
  const speeds = store.timingsSince('').filter((t) => t.seenAt !== null)
    .map((t) => ({ what: speedKind(t), ms: Math.max(0, Date.parse(t.shownAt) - Date.parse(t.seenAt!)) }));
  const suggestedAsks = store.suggestions().map((x) => x.title);
  const whys = store.listTasks({ all: true }).map((t) => t.capturedWhy ?? null);
  const waiting = store.waitingItems({ all: true }).map((w) => w.title);
  store.close();
  const result: ScenarioResult = {
    id: s.id, family: s.family, recognised: recognisedIn(s), expected: s.expect.tasks.length, captured: tasks.length, matched: 0, unwanted: [],
    ownerErrors: [], waitingExpected: (s.expect.waiting ?? []).length, waitingFound: 0,
    dueExpected: s.expect.tasks.filter((t) => t.due).length, dueRight: 0, dueWrong: [],
    takenBack: everything.filter((t) => t.status === 'dismissed').map((t) => t.title),
    followUps,
    ticked: 0, suggested: 0, missed: 0, wrongTicks: [], wrongSuggestions: [], suggestedAsks, whys, latencies: [], titles: tasks.map((t) => t.title), speeds,
  };
  const taken = new Set<number>();
  for (const want of s.expect.tasks) {
    const task = tasks.find((t) => !taken.has(t.id) && matches(t.title, want.words));
    if (!task) {
      if (want.done) result.missed++;
      // Yours, but filed as an ask you are waiting on someone else for.
      const filed = waiting.find((w) => matches(w, want.words));
      if (filed) result.ownerErrors.push(`yours: ${filed}`);
      continue;
    }
    taken.add(task.id);
    result.matched++;
    if (want.due) {
      if (task.dueAt === want.due) result.dueRight++;
      else result.dueWrong.push(`${task.title} (${task.dueAt ?? 'no date'}, want ${want.due})`);
    }
    const ticked = tickedAt.get(task.id);
    const suggested = suggestedAt.get(task.id);
    const doneAt = want.done?.at ?? null;
    if (ticked !== undefined && (doneAt === null || ticked < doneAt)) result.wrongTicks.push(task.title);
    else if (suggested !== undefined && (doneAt === null || suggested < doneAt)) result.wrongSuggestions.push(task.title);
    if (doneAt === null) continue;
    if (ticked !== undefined && ticked >= doneAt) {
      result.ticked++;
      result.latencies.push(ticked - doneAt);
    } else if (suggested !== undefined && suggested >= doneAt) {
      result.suggested++;
      result.latencies.push(suggested - doneAt);
    } else if (ticked === undefined) {
      result.missed++;
    }
  }
  for (const task of tasks) {
    if (s.expect.none.some((words) => matches(task.title, words))) result.unwanted.push(task.title);
    if ((s.expect.theirs ?? []).some((words) => matches(task.title, words))) result.ownerErrors.push(`theirs: ${task.title}`);
    if ((s.expect.waiting ?? []).some((words) => matches(task.title, words))) result.ownerErrors.push(`sent: ${task.title}`);
  }
  for (const words of s.expect.waiting ?? []) if (waiting.some((w) => matches(w, words))) result.waitingFound++;
  // A task that should not exist and got ticked anyway is a wrong tick too, even if later taken back.
  for (const task of everything) {
    if (!taken.has(task.id) && tickedAt.has(task.id) && s.expect.none.some((words) => matches(task.title, words))) {
      result.wrongTicks.push(task.title);
    }
  }
  return result;
}

/** Which assistant profiles a tool family's windows should be recognised as; families of no one tool have none. */
export const FAMILY_TOOLS: Partial<Record<Family, string[]>> = {
  'claude-app': ['claude-desktop', 'claude-web'], chatgpt: ['chatgpt'], gemini: ['gemini'], copilot: ['copilot'], 'claude-code': ['claude-code'],
  codex: ['codex'], 'gemini-cli': ['gemini-cli'], 'copilot-cli': ['copilot-cli'], aider: ['aider'], opencode: ['opencode'], goose: ['goose'],
  'vscode-copilot': ['vscode-copilot'], cursor: ['cursor'], windsurf: ['windsurf'], devin: ['devin'],
};

/** The assistant profiles that recognise any of a scenario's windows, each judged on its own step's lines. */
export function recognisedIn(s: Scenario): string[] {
  const ids = s.steps.map((step) => assistantFor({ bundleId: step.bundle, windowTitle: step.title, url: step.url ?? null }, step.text.join('\n'))?.id)
    .filter((id): id is string => !!id);
  return [...new Set(ids)];
}

/** Of a family's scenarios, how many had a window recognised as that family's tool; null for a family of no one tool. */
export function recognition(family: Family, results: ScenarioResult[]): { seen: number; of: number } | null {
  const tools = FAMILY_TOOLS[family];
  if (!tools) return null;
  const own = results.filter((r) => r.family === family);
  return { seen: own.filter((r) => r.recognised.some((id) => tools.includes(id))).length, of: own.length };
}

export const SCENARIOS = join(import.meta.dir, 'scenarios');

export function loadScenarios(dir = SCENARIOS): Scenario[] {
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Scenario);
}

export interface Totals {
  scenarios: number;
  expected: number;
  captured: number;
  matched: number;
  unwanted: number;
  precision: number | null;
  recall: number | null;
  /** Tasks really done, among those that should exist. */
  done: number;
  ticked: number;
  suggested: number;
  missed: number;
  wrongTicks: number;
  wrongSuggestions: number;
  /**
   * The headline (SCR-103): of the ticks Didja made, the share that were right (ticked when or after
   * it was done). Null when nothing was ticked. Agreement with the labels is recall; this is apart.
   */
  tickPrecision: number | null;
  ownerErrors: number;
  waitingExpected: number;
  waitingFound: number;
  dueExpected: number;
  dueRight: number;
  medianMinutes: number | null;
  /** Simulated speed per kind of event (SCR-75), and the paths that need no model but took over 3 s. */
  speed: { what: SpeedKind; ms: Percentiles }[];
  slow: { id: string; what: SpeedKind; ms: number }[];
}

export function totals(results: ScenarioResult[], scenarios: Scenario[]): Totals {
  const sum = (f: (r: ScenarioResult) => number) => results.reduce((n, r) => n + f(r), 0);
  const expected = sum((r) => r.expected);
  const captured = sum((r) => r.captured);
  const matched = sum((r) => r.matched);
  const latencies = results.flatMap((r) => r.latencies).sort((a, b) => a - b);
  return {
    scenarios: results.length, expected, captured, matched, unwanted: sum((r) => r.unwanted.length),
    precision: captured ? matched / captured : null, recall: expected ? matched / expected : null,
    done: scenarios.reduce((n, s) => n + s.expect.tasks.filter((t) => t.done).length, 0),
    ticked: sum((r) => r.ticked), suggested: sum((r) => r.suggested), missed: sum((r) => r.missed),
    wrongTicks: sum((r) => r.wrongTicks.length), wrongSuggestions: sum((r) => r.wrongSuggestions.length),
    tickPrecision: tickPrecision(sum((r) => r.ticked), sum((r) => r.wrongTicks.length)),
    ownerErrors: sum((r) => r.ownerErrors.length),
    waitingExpected: sum((r) => r.waitingExpected), waitingFound: sum((r) => r.waitingFound),
    dueExpected: sum((r) => r.dueExpected), dueRight: sum((r) => r.dueRight),
    medianMinutes: latencies.length ? latencies[Math.floor(latencies.length / 2)]! : null,
    speed: SPEED_KINDS.map((what) => ({ what, ms: percentiles(results.flatMap((r) => r.speeds.filter((x) => x.what === what).map((x) => x.ms))) }))
      .filter((x) => x.ms.n > 0),
    slow: results.flatMap((r) => r.speeds.filter((x) => (x.what === 'new-task' || x.what === 'sure-tick') && x.ms > SPEED_TARGET_MS[x.what]!)
      .map((x) => ({ id: r.id, ...x }))),
  };
}

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);

/** Right ticks over all ticks; null when there were none. A wrong tick of a task never done counts too. */
export function tickPrecision(right: number, wrong: number): number | null {
  return right + wrong ? right / (right + wrong) : null;
}

/**
 * How many owner errors the benchmark allows before it fails (SCR-103): none. A task given to the
 * wrong person is a wrong task on your list, so it is held to the wrong-tick standard.
 */
export const OWNER_ERROR_LIMIT = 0;

/** The headline line (SCR-103), first in the report and in CI's output. */
export function headline(t: Totals): string {
  return `Tick precision: ${pct(t.tickPrecision)} (${t.ticked} right ticks, ${t.wrongTicks} wrong). Owner errors: ${t.ownerErrors}.`;
}

/** The totals per tool family (SCR-82), in `FAMILIES` order, only the families that have scenarios. */
export function byFamily(results: ScenarioResult[], scenarios: Scenario[]): { family: Family; t: Totals; seen: { seen: number; of: number } | null }[] {
  return FAMILIES.map((family) => ({
    family,
    t: totals(results.filter((r) => r.family === family), scenarios.filter((s) => s.family === family)),
    seen: recognition(family, results),
  })).filter((x) => x.t.scenarios > 0);
}

/** One row per tool family: how many tasks it should make, how many it found, and what got ticked. */
export function familyTable(rows: { family: Family; t: Totals; seen: { seen: number; of: number } | null }[]): string {
  const head = ['family', 'scen', 'recognised', 'want', 'right', 'recall', 'got', 'precision', 'unwanted', 'done', 'ticked', 'asked', 'missed', 'WRONG tick', 'wrong ask', 'tick prec', 'owner'];
  const cells = rows.map(({ family, t, seen }) => [family, t.scenarios, seen ? `${seen.seen}/${seen.of}` : '—', t.expected, t.matched, pct(t.recall), t.captured, pct(t.precision),
    t.unwanted, t.done, t.ticked, t.suggested, t.missed, t.wrongTicks, t.wrongSuggestions, pct(t.tickPrecision), t.ownerErrors].map(String));
  const widths = head.map((h, i) => Math.max(h.length, ...cells.map((r) => r[i]!.length)));
  const line = (c: string[]) => c.map((x, i) => (i === 0 ? x.padEnd(widths[i]!) : x.padStart(widths[i]!))).join('  ');
  return [line(head), widths.map((w) => '-'.repeat(w)).join('  '), ...cells.map(line)].join('\n');
}

export function table(results: ScenarioResult[], t: Totals, verbose = false): string {
  const head = ['scenario', 'want', 'got', 'right', 'unwanted', 'ticked', 'asked', 'missed', 'WRONG tick', 'wrong ask', 'owner'];
  const rows = results.map((r) => [r.id, r.expected, r.captured, r.matched, r.unwanted.length, r.ticked, r.suggested, r.missed,
    r.wrongTicks.length, r.wrongSuggestions.length, r.ownerErrors.length].map(String));
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join('  ');
  const out = [line(head), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)];
  if (verbose) {
    for (const r of results) {
      out.push('', `${r.id}: ${r.titles.length ? r.titles.map((x) => `“${x}”`).join(', ') : 'no tasks'}`);
      if (r.unwanted.length) out.push(`  unwanted: ${r.unwanted.join(' | ')}`);
      if (r.takenBack.length) out.push(`  taken back: ${r.takenBack.join(' | ')}`);
      if (r.followUps.length) out.push(`  follow-ups added: ${r.followUps.join(' | ')}`);
      if (r.wrongTicks.length) out.push(`  WRONG TICK: ${r.wrongTicks.join(' | ')}`);
      if (r.wrongSuggestions.length) out.push(`  wrong ask: ${r.wrongSuggestions.join(' | ')}`);
      if (r.ownerErrors.length) out.push(`  OWNER: ${r.ownerErrors.join(' | ')}`);
      if (r.dueWrong.length) out.push(`  due: ${r.dueWrong.join(' | ')}`);
    }
  }
  out.push(
    '',
    `Capture: ${t.matched} of ${t.expected} tasks found (recall ${pct(t.recall)}); ${t.captured} made, ${t.matched} right (precision ${pct(t.precision)}); ${t.unwanted} that must not exist.`,
    `Done: ${t.done} really done: ${t.ticked} ticked, ${t.suggested} asked, ${t.missed} missed. Wrong ticks: ${t.wrongTicks}. Wrong asks: ${t.wrongSuggestions}.`,
    `Owner: ${t.ownerErrors} given to the wrong person; asks you sent in Waiting on: ${t.waitingFound} of ${t.waitingExpected}. Due dates: ${t.dueRight} of ${t.dueExpected} right.`,
    `Time from done to ticked or asked: median ${t.medianMinutes === null ? '—' : `${t.medianMinutes} min`}.`,
    `Speed (simulated, engine's share): ${t.speed.length ? t.speed.map((x) => `${x.what} ${x.ms.n}× ${seconds(x.ms.p50)} / ${seconds(x.ms.p90)}`).join('; ') : 'nothing timed'}.`,
    `Over 3 s without a model: ${t.slow.length}${t.slow.length ? ` (${t.slow.map((x) => `${x.id} ${x.what} ${seconds(x.ms)}`).join(', ')})` : ''}.`,
  );
  return out.join('\n');
}

/**
 * What was written for a family (SCR-103): an AI tool's assistant profiles, the app profiles of the
 * mail and chat windows, or the done catalogue for `done-target`. A family across tools (`first-day`)
 * or with nothing of its own (a document, notes) has none and is left out of the held-out run.
 */
export interface HeldOut {
  apps: string[];
  tools: string[];
  catalogue: boolean;
}

export function heldOutFor(family: Family, own: Scenario[]): HeldOut {
  // An AI tool's family holds out that tool; where a step is done holds out the catalogue only; a
  // mail or chat family holds out the app profiles its windows are read with.
  const tools = FAMILY_TOOLS[family];
  if (tools) return { apps: [], tools: [...tools].sort(), catalogue: false };
  if (family === 'done-target') return { apps: [], tools: [], catalogue: true };
  if (family !== 'email' && family !== 'messaging') return { apps: [], tools: [], catalogue: false };
  const apps = new Set<string>();
  for (const step of own.flatMap((s) => s.steps)) {
    const app = profileFor({ bundleId: step.bundle, url: step.url ?? null });
    if (app) apps.add(app.id);
  }
  return { apps: [...apps].sort(), tools: [], catalogue: false };
}

export interface HeldOutRow {
  family: Family;
  held: HeldOut;
  with: Totals;
  without: Totals;
}

/**
 * The held-out-app run (SCR-103): each family's scenarios again, with what was written for that
 * family (its app and assistant profiles, and for `done-target` the done catalogue) left out, as
 * if the app were new to Didja. The drop shows how much the family leans on its own profile; a
 * wrong tick or owner error without it is still a failure. A family read with nothing of its own
 * (a plain document, notes) is left out of the run.
 */
export function heldOutRun(scenarios: Scenario[], opts: PollOptions = {}, model: ModelChoice = 'none'): HeldOutRow[] {
  const allApps = profiles();
  const allTools = assistants();
  const allPlaces = catalogue();
  const rows: HeldOutRow[] = [];
  try {
    for (const family of FAMILIES) {
      const own = scenarios.filter((s) => s.family === family);
      if (!own.length) continue;
      const held = heldOutFor(family, own);
      if (!held.apps.length && !held.tools.length && !held.catalogue) continue;
      const withResults = own.map((s) => runScenario(s, opts, model));
      useProfiles(allApps.filter((p) => !held.apps.includes(p.id)));
      useAssistants(allTools.filter((a) => !held.tools.includes(a.id)));
      useCatalogue(held.catalogue ? [] : allPlaces);
      const withoutResults = own.map((s) => runScenario(s, opts, model));
      useProfiles(allApps);
      useAssistants(allTools);
      useCatalogue(allPlaces);
      rows.push({ family, held, with: totals(withResults, own), without: totals(withoutResults, own) });
    }
  } finally {
    useProfiles(allApps);
    useAssistants(allTools);
    useCatalogue(allPlaces);
  }
  return rows;
}

const change = (a: number | null, b: number | null) => (a === null || b === null ? '—' : `${pct(a)} → ${pct(b)}`);

export function heldOutTable(rows: HeldOutRow[]): string {
  const head = ['family', 'held out', 'recall', 'precision', 'ticked', 'tick prec', 'WRONG tick', 'owner'];
  const cells = rows.map(({ family, held, with: w, without: o }) => [
    family, [...held.apps, ...held.tools, ...(held.catalogue ? ['done catalogue'] : [])].join(', '),
    change(w.recall, o.recall), change(w.precision, o.precision), `${w.ticked} → ${o.ticked}`,
    change(w.tickPrecision, o.tickPrecision), String(o.wrongTicks), String(o.ownerErrors),
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...cells.map((r) => r[i]!.length)));
  const line = (c: string[]) => c.map((x, i) => (i <= 1 ? x.padEnd(widths[i]!) : x.padStart(widths[i]!))).join('  ');
  return [line(head), widths.map((w) => '-'.repeat(w)).join('  '), ...cells.map(line)].join('\n');
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const model = (flag('--model') ?? 'none') as ModelChoice;
  if (model !== 'none' && model !== 'apple' && !/^ollama:.+/.test(model)) {
    console.error('--model is none, apple or ollama:<name>');
    process.exit(2);
  }
  const only = flag('--only');
  const scenarios = loadScenarios().filter((s) => !only || s.id === only);
  const opts = modelOptions(model);
  if (model !== 'none' && !opts.judge) {
    console.error(`No model: build the app first, or set DIDJA_JUDGE to Didja.app/Contents/MacOS/Didja.`);
    process.exit(2);
  }
  const results = scenarios.map((s) => runScenario(s, opts, model));
  const t = totals(results, scenarios);
  console.log(`Didja benchmark — model: ${model}, ${t.scenarios} scenarios`);
  console.log(`${headline(t)}\n`);
  console.log(table(results, t, args.includes('--verbose')));
  console.log(`\nBy tool:\n${familyTable(byFamily(results, scenarios))}`);
  const held = args.includes('--held-out') ? heldOutRun(scenarios, opts, model) : [];
  if (held.length) console.log(`\nHeld out (each family without its own profiles):\n${heldOutTable(held)}`);
  if (t.wrongTicks > 0) {
    console.error(`\n${t.wrongTicks} wrong tick(s): see --verbose.`);
    process.exit(1);
  }
  if (t.ownerErrors > OWNER_ERROR_LIMIT) {
    console.error(`\n${t.ownerErrors} task(s) given to the wrong person (limit ${OWNER_ERROR_LIMIT}): see --verbose.`);
    process.exit(1);
  }
  const heldWrong = held.filter((r) => r.without.wrongTicks > 0 || r.without.ownerErrors > OWNER_ERROR_LIMIT);
  if (heldWrong.length) {
    console.error(`\nWithout their own profiles, ${heldWrong.map((r) => r.family).join(', ')} tick wrongly or give tasks to the wrong person.`);
    process.exit(1);
  }
  if (t.slow.length > 0) {
    console.error(`\n${t.slow.length} new task(s) or sure tick(s) over 3 s.`);
    process.exit(1);
  }
}
