/**
 * Forget (SCR-104): three levels, each listing every store it cleared.
 *
 * - **Captured text only**: the screen text Didja keeps (observations, and the lines kept around
 *   open tasks). Tasks and what was learned stay.
 * - **Everything Didja learned**: that, plus every store derived from it (`Store.forget`), and the
 *   three logs beside the database (`shell.log`, `agent-hooks.jsonl`, `mcp-log.jsonl`).
 * - **The last hour**: screen text, kept lines and log lines from the last 60 minutes; nothing older.
 *
 * Tasks go only when asked (`tasks`), and then only those captured from the screen.
 * The result is written to `meta.last_forget` so Privacy can show what went.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ForgetLevel, ForgetStore, Store } from './store.ts';

export const LOG_FILES = ['shell.log', 'agent-hooks.jsonl', 'mcp-log.jsonl'] as const;
export type LogFile = typeof LOG_FILES[number];

/** What each store is called in Privacy and in `didja forget`. */
export const FORGET_LABELS: Record<ForgetStore | LogFile, string> = {
  observations: 'Captured text',
  task_context: 'Lines kept around tasks',
  lessons: 'Corrections you taught (Not an Action, Not Done, renames)',
  criteria: 'Written "what done looks like"',
  outcomes: 'Outcomes (for How Didja Is Doing)',
  trust_events: 'Trust events (earned auto-tick)',
  done_places: 'Taught places (Didja Missed This)',
  timings: 'Speed timings',
  capture_outcomes: 'Capture counts per app',
  engine_drops: 'Lines left out, counted',
  verdicts: 'Model verdicts remembered',
  suggestions: 'Suggested tray',
  chat_pending: 'Chat asks waiting to become tasks',
  merge_suggestions: 'Merge suggestions',
  tasks: 'Tasks captured from the screen',
  waiting: 'Waiting on (asks you sent)',
  'shell.log': 'Commands you ran (shell.log)',
  'agent-hooks.jsonl': 'Agent hook events (agent-hooks.jsonl)',
  'mcp-log.jsonl': 'didja mcp calls (mcp-log.jsonl)',
};

export interface Cleared {
  store: ForgetStore | LogFile;
  label: string;
  removed: number;
}

export interface ForgetResult {
  at: string;
  level: ForgetLevel;
  tasks: boolean;
  /** For `hour`: the start of the hour forgotten. */
  since: string | null;
  cleared: Cleared[];
}

export const HOUR_MS = 60 * 60_000;

/** When a log line was written, or null when it does not say: shell.log starts with epoch seconds, the JSON logs carry `ts`. */
export function lineTime(file: LogFile, line: string): number | null {
  if (file === 'shell.log') {
    const t = Number(line.split('\t')[0]);
    return Number.isFinite(t) && t > 0 ? t * 1000 : null;
  }
  try {
    const ts = (JSON.parse(line) as { ts?: unknown }).ts;
    const t = typeof ts === 'string' ? Date.parse(ts) : NaN;
    return Number.isNaN(t) ? null : t;
  } catch {
    return null;
  }
}

/**
 * A log's text without the lines written at or after `since`, and how many went. A line that does
 * not say when it was written stays: "the last hour" never touches what may be older.
 */
export function withoutSince(file: LogFile, text: string, since: Date): { text: string; removed: number } {
  const lines = text.split('\n').filter((l) => l !== '');
  const kept = lines.filter((l) => {
    const t = lineTime(file, l);
    return t === null || t < since.getTime();
  });
  return { text: kept.length ? `${kept.join('\n')}\n` : '', removed: lines.length - kept.length };
}

function forgetLogs(dir: string, since: Date | null): Cleared[] {
  const out: Cleared[] = [];
  for (const file of LOG_FILES) {
    const path = join(dir, file);
    let removed = 0;
    if (existsSync(path)) {
      const text = readFileSync(path, 'utf8');
      if (since) {
        const after = withoutSince(file, text, since);
        removed = after.removed;
        if (removed > 0) writeFileSync(path, after.text, { mode: 0o600 });
      } else {
        removed = text.split('\n').filter((l) => l !== '').length;
        rmSync(path, { force: true });
      }
    }
    out.push({ store: file, label: FORGET_LABELS[file], removed });
  }
  return out;
}

/** Forget at a level: the database, then (for everything and the last hour) the logs in `dir`. */
export function forget(store: Store, dir: string, level: ForgetLevel, opts: { tasks?: boolean; now?: Date } = {}): ForgetResult {
  const now = opts.now ?? new Date();
  const since = level === 'hour' ? new Date(now.getTime() - HOUR_MS) : null;
  const rows = store.forget(level, { tasks: opts.tasks, since: since ?? undefined });
  const cleared: Cleared[] = rows.map((r) => ({ ...r, label: FORGET_LABELS[r.store] }));
  if (level !== 'captured') cleared.push(...forgetLogs(dir, since));
  // How Didja Is Doing counts from now on: what it counted before is gone.
  if (level === 'everything') for (const key of ['outcomes_since', 'timings_since']) store.setMeta(key, now.toISOString());
  const result: ForgetResult = { at: now.toISOString(), level, tasks: !!opts.tasks, since: since?.toISOString() ?? null, cleared };
  store.setMeta('last_forget', JSON.stringify(result));
  return result;
}

const LEVEL_WORDS: Record<ForgetLevel, string> = {
  captured: 'Forgot captured text',
  everything: 'Forgot everything Didja learned',
  hour: 'Forgot the last hour',
};

/** The result in words, one store a line, as `didja forget` prints it. */
export function describeForget(r: ForgetResult): string {
  const head = `${LEVEL_WORDS[r.level]}${r.tasks ? ', with tasks' : ''}:`;
  return [head, ...r.cleared.map((c) => `  ${c.label}: ${c.removed} removed`)].join('\n');
}
