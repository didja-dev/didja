/**
 * Undo and redo of your own changes in the list (SCR-122): marking done, reopening, dismissing,
 * snoozing, "done all from here" and ticking a canvas section.
 *
 * Each change keeps the state of every task it moved, before and after: status, times and place
 * labels, never text. Undo puts those tasks back as they were, exactly (a checklist ticked by its
 * parent comes back with the steps that were open open, and the ones already done still done), and
 * takes back what the change wrote down (its counts, lessons and trust). Redo makes the change again.
 * A task that changed since is left alone. Kept in `meta` for a day, the last 50 changes.
 */
import { confirmChecking } from './engine.ts';
import { sameTaskState, type Store, type TaskState } from './store.ts';

export type UndoableChange =
  | { kind: 'done' | 'dismiss' | 'reopen' | 'done-all'; id: number }
  | { kind: 'snooze'; id: number; until: string }
  | { kind: 'canvas-tick'; id: number; undo: boolean };

interface Entry {
  change: UndoableChange;
  at: string;
  rows: { id: number; before: TaskState; after: TaskState }[];
}

interface Log {
  undo: Entry[];
  redo: Entry[];
}

const KEY = 'undo_log';
export const UNDO_LIMIT = 50;
export const UNDO_HOURS = 24;

function readLog(store: Store, now: Date): Log {
  const raw = store.getMeta(KEY);
  const log: Log = raw ? JSON.parse(raw) : { undo: [], redo: [] };
  const since = now.getTime() - UNDO_HOURS * 3_600_000;
  const fresh = (e: Entry) => new Date(e.at).getTime() >= since;
  return { undo: log.undo.filter(fresh), redo: log.redo.filter(fresh) };
}

function writeLog(store: Store, log: Log): void {
  store.setMeta(KEY, JSON.stringify({ undo: log.undo.slice(-UNDO_LIMIT), redo: log.redo.slice(-UNDO_LIMIT) }));
}

/** Make the change through the store's rules, as the list's own commands do. False when nothing is there to change. */
function apply(store: Store, c: UndoableChange, now: Date): boolean {
  switch (c.kind) {
    case 'done':
    case 'dismiss':
    case 'reopen': {
      const status = c.kind === 'done' ? 'done' : c.kind === 'dismiss' ? 'dismissed' : 'open';
      // Ticking a step of a list still being checked says it is yours (SCR-78).
      if (status === 'done') confirmChecking(store, c.id, now);
      // Counted in "How Didja is doing" (SCR-73).
      return store.changeByYou(c.id, status, now);
    }
    case 'snooze':
      return store.snooze(c.id, new Date(c.until), now);
    case 'done-all':
      return store.completeSource(c.id, now) !== null;
    case 'canvas-tick':
      store.tickCanvasSection(c.id, c.undo, now);
      return true;
  }
}

/** Run one change and keep what it moved, so it can be undone. */
function recorded(store: Store, c: UndoableChange, now: Date, log: Log): boolean {
  const before = store.taskStates();
  const ok = apply(store, c, now);
  const after = store.taskStates();
  const rows: Entry['rows'] = [];
  for (const [id, state] of after) {
    const was = before.get(id);
    if (was && !sameTaskState(was, state)) rows.push({ id, before: was, after: state });
  }
  if (rows.length) log.undo.push({ change: c, at: now.toISOString(), rows });
  return ok;
}

/** A change you made in the list, kept so it can be undone. A new change clears what Redo had. */
export function change(store: Store, c: UndoableChange, now: Date = new Date()): boolean {
  const log = readLog(store, now);
  const kept = log.undo.length;
  const ok = recorded(store, c, now, log);
  if (log.undo.length > kept) log.redo = [];
  writeLog(store, log);
  return ok;
}

/** What one change did, in a few words, for the Undo and Redo menu items. */
export function describe(c: UndoableChange, count: number): string {
  const many = count > 1 ? ` (${count})` : '';
  switch (c.kind) {
    case 'done': return `Mark Done${many}`;
    case 'reopen': return `Reopen${many}`;
    case 'dismiss': return `Dismiss${many}`;
    case 'snooze': return `Snooze${many}`;
    case 'done-all': return `Done All From Here${many}`;
    case 'canvas-tick': return c.undo ? `Reopen All Under It${many}` : `Mark All Under It Done${many}`;
  }
}

/** Tasks a change moved that are steps or loose tasks, the count the person sees. */
function shown(store: Store, e: Entry): number {
  return e.rows.filter((r) => !store.getTask(r.id)?.isGroup).length || e.rows.length;
}

export interface UndoState {
  undo: string | null;
  redo: string | null;
}

/** What Undo and Redo would do now, for the menu: null when there is nothing. */
export function undoState(store: Store, now: Date = new Date()): UndoState {
  const log = readLog(store, now);
  const u = log.undo[log.undo.length - 1];
  const r = log.redo[log.redo.length - 1];
  return { undo: u ? describe(u.change, shown(store, u)) : null, redo: r ? describe(r.change, shown(store, r)) : null };
}

/** Undo your last change: the tasks it moved go back as they were. Returns what was undone, or null. */
export function undo(store: Store, now: Date = new Date()): { what: string; ids: number[] } | null {
  const log = readLog(store, now);
  const e = log.undo.pop();
  if (!e) return null;
  const ids = store.restoreTaskStates(e.rows.map((r) => ({ id: r.id, from: r.after, to: r.before })), e.at);
  log.redo.push(e);
  writeLog(store, log);
  return { what: describe(e.change, shown(store, e)), ids };
}

/** Make the last undone change again, through the same rules as the first time. Returns what was redone, or null. */
export function redo(store: Store, now: Date = new Date()): { what: string; ids: number[] } | null {
  const log = readLog(store, now);
  const e = log.redo.pop();
  if (!e) return null;
  const before = log.undo.length;
  recorded(store, e.change, now, log);
  writeLog(store, log);
  const again = log.undo.length > before ? log.undo[log.undo.length - 1]! : null;
  return { what: describe(e.change, again ? shown(store, again) : shown(store, e)), ids: again ? again.rows.map((r) => r.id) : [] };
}
