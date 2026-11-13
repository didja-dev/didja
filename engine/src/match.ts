/**
 * Completion matching, tiers 1 and 2 (see docs/ARCHITECTURE.md):
 *   1. Exact markers — the task's env var name, URL or command shows up in a new observation.
 *   2. Context       — and it shows up in the right place: commands at a terminal
 *                      prompt, env vars and URLs on the named service's site.
 *
 * A task is ticked only when every required marker has been seen in context.
 * Anything less leaves it open: a missed tick is cheap, a wrong tick is not.
 * Tier 3 (model judgement) arrives in Milestone 4.
 */

import { TERMINALS } from './extract.ts';
import { requiredMarkers, withoutLinkTargets } from './markers.ts';
import type { Marker } from './markers.ts';
import type { Observation, Task } from './store.ts';

export interface Sighting {
  taskId: number;
  marker: Marker;
  observationId: number;
  ts: string;
  /** A description of where the marker was seen. Never raw screen text. */
  detail: string;
}

/** What a shell prompt ends with, just before the typed command. */
const PROMPT_BEFORE_COMMAND = /[%$❯➜>#]\s*$/;

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function onHost(host: string | null, hosts: string[]): boolean {
  return host !== null && hosts.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Location without query string or fragment, which can carry tokens. */
function pageRef(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`.replace(/\/$/, '');
  } catch {
    return 'the page';
  }
}

/**
 * True if the command was typed at a shell prompt: it is the last thing on a
 * line and a prompt character comes right before it. A command merely printed
 * somewhere (in docs, in Claude's own output) does not count.
 */
export function commandAtPrompt(text: string, command: string): boolean {
  for (const line of text.split(/\r?\n/)) {
    const squashed = line.replace(/\s+/g, ' ').trimEnd();
    if (!squashed.endsWith(command)) continue;
    if (PROMPT_BEFORE_COMMAND.test(squashed.slice(0, squashed.length - command.length))) return true;
  }
  return false;
}

/** How long after a command its output or the next prompt may show up and still count (SCR-61). */
export const RUN_WINDOW_MS = 5 * 60_000;

/**
 * Output that says a command failed (SCR-61). Any of these between a command and the next prompt
 * means it did not get done: no tick, no "looks done?". Shells, git, npm/bun/yarn/pnpm, gh,
 * docker, xcodebuild, wrangler, curl, test runners.
 */
export const FAILURE_LINES: RegExp[] = [
  /^\s*(error|fatal|err!?)\b\s*[:!\]]/i, // error: …, fatal: …, ERR! …, error] …
  /^\s*error\s+\S/i, // yarn: error Command failed …
  /\bnpm (ERR!|error\b)/i,
  /\bcommand not found\b|: not found\s*$|\bno such file or directory\b|\bpermission denied\b/i,
  /^\s*(zsh|bash|sh|fish):\s/i, // the shell itself complaining
  /\*\* (BUILD|TEST|ARCHIVE|ANALYZE) FAILED \*\*/,
  /\bHTTP\/[\d.]+\s+[45]\d\d\b|\(HTTP [45]\d\d\)|\bHTTP [45]\d\d\b/,
  /^\s*curl: \(\d+\)/,
  /\[(remote )?rejected\]|\berror: failed to push\b/i,
  /\[ERROR\]|^\s*✘|^\s*✗/,
  /^\s*Error\b/,
  /\bexit(ed)? (with )?(code|status):? *[1-9]\d*\b/i,
  /(^|\s)[1-9]\d* (fail|failed|failing|failures?|errors?)\b/i,
  /^\s*FAIL\s/,
  /\bTraceback \(most recent call last\)/,
  /\bpanic:|\bSegmentation fault\b|\bAborted\b/,
];

/** A prompt that shows the last command's exit status as non-zero: ✘, ✗, [1], "exit 1". */
const FAILED_PROMPT = /✘|✗|\[\s*[1-9]\d*\s*\]|\bexit [1-9]\d*\b/;

export function failed(line: string): boolean {
  return FAILURE_LINES.some((re) => re.test(line));
}

export interface TerminalLine { text: string; ts: string; observationId: number }

/**
 * What became of a command typed at a prompt, from the lines a terminal window showed after it
 * (SCR-61): 'ran' when output or a new prompt followed within a few minutes and nothing in it
 * failed; 'failed' when it did; 'typed' when nothing followed yet (typed, not entered). A command
 * typed several times counts as ran if any one of those runs did.
 */
export function commandOutcome(lines: TerminalLine[], command: string): { outcome: 'ran' | 'failed' | 'typed'; line: TerminalLine } | null {
  let result: { outcome: 'ran' | 'failed' | 'typed'; line: TerminalLine } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const squashed = lines[i]!.text.replace(/\s+/g, ' ').trimEnd();
    if (!squashed.endsWith(command)) continue;
    const prompt = squashed.slice(0, squashed.length - command.length);
    if (!PROMPT_BEFORE_COMMAND.test(prompt)) continue;
    const start = Date.parse(lines[i]!.ts);
    const after = lines.slice(i + 1).filter((l) => Date.parse(l.ts) - start <= RUN_WINDOW_MS && l.text.trim() !== '');
    // The next prompt: a line with the same prompt in it (a status mark may come before it).
    const promptText = prompt.trim();
    const next = after.findIndex((l) => promptText.length >= 1 && l.text.replace(/\s+/g, ' ').includes(promptText) && PROMPT_BEFORE_COMMAND.test(promptText));
    const output = next === -1 ? after : after.slice(0, next);
    let outcome: 'ran' | 'failed' | 'typed';
    if (after.length === 0) outcome = 'typed';
    else if (output.some((l) => failed(l.text)) || (next !== -1 && FAILED_PROMPT.test(after[next]!.text))) outcome = 'failed';
    else outcome = 'ran';
    const evidence = after[next === -1 ? after.length - 1 : next] ?? lines[i]!;
    if (outcome === 'ran') return { outcome, line: evidence };
    if (!result || outcome === 'failed') result = { outcome, line: evidence };
  }
  return result;
}

function seenIn(o: Observation, marker: Marker, task: Task, history: Observation[]): string | null {
  if (marker.kind === 'command') {
    if (!TERMINALS.has(o.bundleId)) return null;
    // The window's lines in order, from the command's own observation (which may be an earlier
    // one: the line is not captured again once its output appears) to this one.
    const lines = history
      .filter((h) => h.bundleId === o.bundleId && h.windowTitle === o.windowTitle && h.ts > task.createdAt && h.ts <= o.ts)
      .sort((a, b) => a.ts.localeCompare(b.ts) || a.id - b.id)
      .flatMap((h) => h.text.split(/\r?\n/).map((text) => ({ text, ts: h.ts, observationId: h.id })));
    return commandOutcome(lines, marker.value)?.outcome === 'ran' ? `Ran \`${marker.value}\` in ${o.app}` : null;
  }
  if (marker.kind === 'env' || marker.kind === 'url') {
    if (!task.criteria?.service || !o.url || !onHost(hostOf(o.url), task.criteria.hosts)) return null;
    // A link pointing at the page is not the page: only text on screen counts (SCR-68).
    const text = withoutLinkTargets(o.text);
    const found =
      marker.kind === 'env'
        ? new RegExp(`(?<![A-Z0-9_])${marker.value}(?![A-Z0-9_])`).test(text)
        : text.toLowerCase().includes(marker.value.toLowerCase());
    return found ? `Saw ${marker.value} on ${pageRef(o.url)}` : null;
  }
  return null;
}

/**
 * Look for each open task's required markers in observations made after the
 * task was created. The caller must leave out Claude windows: that is where
 * the task text itself is on screen.
 */
export function findSightings(tasks: Task[], observations: Observation[], history: Observation[] = observations): Sighting[] {
  const candidates = tasks
    // A snoozed task can still be seen getting done.
    .filter((t) => t.status === 'open' || t.status === 'snoozed')
    .map((task) => ({ task, required: requiredMarkers(task.markers, task.criteria) }))
    .filter((c) => c.required.length > 0);
  if (candidates.length === 0) return [];

  const sightings: Sighting[] = [];
  const found = new Set<string>();
  for (const o of observations) {
    for (const { task, required } of candidates) {
      if (o.ts <= task.createdAt) continue;
      for (const marker of required) {
        const key = `${task.id}\u0000${marker.value}`;
        if (found.has(key)) continue;
        const detail = seenIn(o, marker, task, history.some((h) => h.id === o.id) ? history : [...history, o]);
        if (!detail) continue;
        found.add(key);
        sightings.push({ taskId: task.id, marker, observationId: o.id, ts: o.ts, detail });
      }
    }
  }
  return sightings;
}

/** True once every required marker has been seen. */
export function isComplete(task: Task, seen: Set<string>): boolean {
  const required = requiredMarkers(task.markers, task.criteria);
  return required.length > 0 && required.every((m) => seen.has(m.value));
}
