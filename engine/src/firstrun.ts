/**
 * The first run (SCR-89): what the Welcome screen's "Try it" step and the Quick View's quiet nudge
 * show, written by the engine to `meta.first_run` after each pass for the app to read.
 *
 *   - `watching`: the names of the apps read in the last ten minutes (no text, no window titles);
 *   - `firstList`: the newest list from an AI tool, as a count and the tool's name ("3 steps from Claude");
 *   - `nudge`: when AI tool windows have been read for ten minutes or more and not one task has
 *     ever come from an AI tool: which tool, and how many readings;
 *   - `candidates`: windows that look like an AI tool Didja has no profile for (approval prompts, a
 *     "context left" footer, a site whose address says chat or ai), for the troubleshooting report.
 *
 * Names, codes and counts only. A candidate keeps its app's name and bundle id, and for a browser
 * the site's host name: never the window's text or title.
 */
import { assistantByKind, assistants, EDITORS, TERMINALS } from './assistants.ts';
import type { Store } from './store.ts';

const MINUTE = 60_000;
/** How long AI tool windows are read with no task before the nudge shows. */
export const NUDGE_AFTER_MS = 10 * MINUTE;
/** Readings of AI tool windows needed before the nudge shows: one glance is not a try. */
export const NUDGE_MIN_READS = 5;
/** How often the status is worked out again, at most. */
const REFRESH_MS = 2_000;
const CANDIDATES_MAX = 10;

export const FIRST_RUN_KEY = 'first_run';
/** When an AI tool's window was first read. Set once. */
export const FIRST_READ_KEY = 'assistant_first_read';
/** When the first task from an AI tool was seen; from then on there is no nudge. */
export const FIRST_TASK_KEY = 'assistant_first_task';
/** Set by the app when you close the nudge. */
export const NUDGE_DISMISSED_KEY = 'first_run_nudge_dismissed';
export const CANDIDATES_KEY = 'unknown_assistants';

export interface Candidate {
  app: string;
  bundleId: string;
  /** For a browser: the site's host name. */
  host?: string;
  /** Which sign made it look like an AI tool: 'approval', 'context-left' or 'host'. */
  sign: string;
  last: string;
  n: number;
}

export interface FirstRunStatus {
  at: string;
  watching: string[];
  assistantsRead: { name: string; reads: number }[];
  firstList: { count: number; from: string; at: string } | null;
  nudge: { name: string; reads: number } | null;
}

/** Approval prompts and footers that AI agents show and other apps don't. */
const AI_SIGNS: { sign: string; re: RegExp }[] = [
  { sign: 'approval', re: /^\s*(?:[>›❯]\s*)?(?:Do you want to (?:run|proceed|allow|make this edit)|Would you like to run|Allow (?:once|always|execution|this command)|Approve and run|Run (?:this )?command\?)/imu },
  { sign: 'context-left', re: /\b\d{1,3}\s?% (?:of )?context (?:window )?(?:left|remaining)\b|\bcontext left until auto-compact\b/iu },
];

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Whether a window no profile matched looks like an AI tool, and by which sign; null if not.
 * A site counts when a part of its host name is "chat" or "ai" (chat.example.com, example.ai);
 * a terminal or an editor when its text shows an agent's approval prompt or a "context left" footer.
 */
export function aiLike(window: { bundleId: string; url: string | null }, text: string): { sign: string; host?: string } | null {
  const host = hostOf(window.url);
  if (host) {
    const labels = host.split(/[.-]/);
    return labels.includes('chat') || labels.includes('ai') ? { sign: 'host', host } : null;
  }
  if (!TERMINALS.has(window.bundleId) && !EDITORS.has(window.bundleId)) return null;
  for (const { sign, re } of AI_SIGNS) if (re.test(text)) return { sign };
  return null;
}

/** The candidates kept (last 24 hours, at most ten), newest first. */
export function readCandidates(store: Store, now: Date = new Date()): Candidate[] {
  try {
    const parsed = JSON.parse(store.getMeta(CANDIDATES_KEY) ?? '[]');
    const dayAgo = new Date(now.getTime() - 24 * 60 * MINUTE).toISOString();
    return Array.isArray(parsed) ? (parsed as Candidate[]).filter((c) => c && typeof c.app === 'string' && c.last >= dayAgo) : [];
  } catch {
    return [];
  }
}

/** Note windows that looked like an unknown AI tool in this pass. */
export function noteCandidates(store: Store, seen: { app: string; bundleId: string; sign: string; host?: string }[], now: Date): void {
  if (seen.length === 0) return;
  const list = readCandidates(store, now);
  for (const c of seen) {
    const same = list.find((x) => x.bundleId === c.bundleId && (x.host ?? '') === (c.host ?? ''));
    if (same) {
      same.n++;
      same.last = now.toISOString();
      same.sign = c.sign;
    } else {
      list.push({ app: c.app, bundleId: c.bundleId, ...(c.host ? { host: c.host } : {}), sign: c.sign, last: now.toISOString(), n: 1 });
    }
  }
  list.sort((a, b) => b.last.localeCompare(a.last));
  store.setMeta(CANDIDATES_KEY, JSON.stringify(list.slice(0, CANDIDATES_MAX)));
}

/** The source kinds of every AI tool profile. */
function assistantKinds(): string[] {
  return [...new Set(assistants().map((a) => a.sourceKind))];
}

/** A source kind's words: its AI tool's name, else the kind. */
export function assistantName(kind: string): string {
  return assistantByKind(kind)?.name ?? kind;
}

/**
 * Work out the first-run status from the store. `readThisPass` is the AI tool source kinds read in
 * the pass that just ran (to note when one was first read).
 */
export function firstRunStatus(store: Store, now: Date = new Date(), readThisPass: string[] = []): FirstRunStatus {
  if (readThisPass.length > 0 && store.getMeta(FIRST_READ_KEY) === null) store.setMeta(FIRST_READ_KEY, now.toISOString());

  const kinds = assistantKinds();
  const kindSet = new Set(kinds);
  const tenMinutes = new Date(now.getTime() - 10 * MINUTE).toISOString();
  const watching = store.observationCountsByApp(tenMinutes).map((r) => r.app).filter((a) => a && a !== 'Didja').slice(0, 4);

  const reads = new Map<string, number>();
  for (const d of store.drops(new Date(now.getTime() - 24 * 60 * MINUTE).toISOString())) {
    if (d.reason !== 'read' || !kindSet.has(d.source)) continue;
    const name = assistantName(d.source);
    reads.set(name, (reads.get(name) ?? 0) + d.n);
  }
  const assistantsRead = [...reads.entries()].map(([name, n]) => ({ name, reads: n })).sort((a, b) => b.reads - a.reads);

  const newest = store.newestStepFrom(kinds);
  const firstList = newest ? { count: newest.count, from: assistantName(newest.kind), at: newest.at } : null;
  if (newest && store.getMeta(FIRST_TASK_KEY) === null) store.setMeta(FIRST_TASK_KEY, newest.at);

  let nudge: FirstRunStatus['nudge'] = null;
  const firstRead = store.getMeta(FIRST_READ_KEY);
  const top = assistantsRead[0];
  if (
    top && firstRead !== null && store.getMeta(FIRST_TASK_KEY) === null && store.getMeta(NUDGE_DISMISSED_KEY) === null
    && now.getTime() - Date.parse(firstRead) >= NUDGE_AFTER_MS
    && assistantsRead.reduce((n, a) => n + a.reads, 0) >= NUDGE_MIN_READS
  ) {
    nudge = { name: top.name, reads: top.reads };
  }
  return { at: now.toISOString(), watching, assistantsRead, firstList, nudge };
}

/** Write the status for the app, at most every two seconds. */
export function updateFirstRun(store: Store, now: Date, readThisPass: string[]): void {
  if (readThisPass.length > 0 && store.getMeta(FIRST_READ_KEY) === null) store.setMeta(FIRST_READ_KEY, now.toISOString());
  const last = store.getMeta(FIRST_RUN_KEY);
  if (last) {
    try {
      const at = Date.parse((JSON.parse(last) as FirstRunStatus).at);
      if (now.getTime() - at < REFRESH_MS) return;
    } catch { /* worked out again below */ }
  }
  store.setMeta(FIRST_RUN_KEY, JSON.stringify(firstRunStatus(store, now, readThisPass)));
}
