/**
 * Apple Reminders (SCR-121): tasks written to a Reminders list, opt-in, and kept in step both ways.
 *
 * The app owns EventKit; the engine owns every rule. Each sync the app hands over the reminders it
 * found that carry a Didja link (`didja://task/<id>`), and the engine answers with what to write:
 * reminders to create (the engine-written title and the link, nothing else unless you chose "include
 * who asked"), and ones to complete or reopen. What happened in Reminders is applied here: a reminder
 * you completed ticks its task as done by you; one you deleted dismisses it. A reminder Didja did
 * not write (no row in `reminder_links`) is never touched, even if it carries a Didja link.
 *
 * Off until turned on in Settings › Connections. Only tasks captured after it was turned on go
 * there, so turning it on does not copy the whole list out at once.
 */
import { assistants } from './assistants.ts';
import { KEPT_KIND } from './store.ts';
import type { Store, Task } from './store.ts';

export const REMINDER_SOURCES = ['chat', 'email', 'ai', 'mylist', 'other'] as const;
export type ReminderSource = (typeof REMINDER_SOURCES)[number];

export interface RemindersSettings {
  on: boolean;
  /** The Reminders list tasks go to. */
  list: string;
  /** Which tasks go there. */
  sources: ReminderSource[];
  /** Add who asked (the chat, or the email's sender and subject) as the reminder's note. */
  who: boolean;
  /** When it was last turned on: only tasks captured from then go to Reminders. */
  since: string | null;
}

export const DEFAULT_LIST = 'Didja';
const DEFAULTS: RemindersSettings = { on: false, list: DEFAULT_LIST, sources: [...REMINDER_SOURCES], who: false, since: null };
const META = 'reminders';
/** At most this many reminders are created in one sync. */
export const MAX_CREATES = 25;

export function remindersSettings(store: Store): RemindersSettings {
  const raw = store.getMeta(META);
  if (!raw) return { ...DEFAULTS, sources: [...DEFAULTS.sources] };
  try {
    const v = JSON.parse(raw) as Partial<RemindersSettings>;
    const sources = Array.isArray(v.sources) ? v.sources.filter((s): s is ReminderSource => (REMINDER_SOURCES as readonly string[]).includes(s)) : [...REMINDER_SOURCES];
    const list = typeof v.list === 'string' && v.list.trim() ? v.list.trim().slice(0, 100) : DEFAULT_LIST;
    return { on: v.on === true, list, sources, who: v.who === true, since: typeof v.since === 'string' ? v.since : null };
  } catch {
    return { ...DEFAULTS, sources: [...DEFAULTS.sources] };
  }
}

/** Change the settings. Turning it on starts the clock: tasks captured from now on go to Reminders. */
export function setRemindersSettings(store: Store, change: Partial<Omit<RemindersSettings, 'since'>>, now: Date = new Date()): RemindersSettings {
  const was = remindersSettings(store);
  const next: RemindersSettings = { ...was, ...change };
  if (change.list !== undefined) next.list = change.list.trim().slice(0, 100) || DEFAULT_LIST;
  if (change.sources) next.sources = REMINDER_SOURCES.filter((s) => change.sources!.includes(s));
  if (next.on && !was.on) next.since = now.toISOString();
  store.setMeta(META, JSON.stringify(next));
  return remindersSettings(store);
}

/** Which of the settings' groups a task belongs to. */
export function reminderSourceOf(task: Pick<Task, 'sourceKind'>, aiKinds: Set<string> = assistantKinds()): ReminderSource {
  if (task.sourceKind === KEPT_KIND) return 'mylist';
  if (task.sourceKind === 'chat') return 'chat';
  if (task.sourceKind === 'email') return 'email';
  if (aiKinds.has(task.sourceKind)) return 'ai';
  return 'other';
}

function assistantKinds(): Set<string> {
  try {
    return new Set(assistants().map((a) => a.sourceKind));
  } catch {
    return new Set();
  }
}

export const taskLink = (id: number) => `didja://task/${id}`;

/** The task id in a Didja link, or null. */
export function taskIdOfLink(url: string | null | undefined): number | null {
  const m = /^didja:\/\/task\/(\d+)$/.exec(url?.trim() ?? '');
  return m ? Number(m[1]) : null;
}

/** A reminder the app found in Reminders that carries a Didja link. */
export interface SeenReminder {
  id: string;
  completed: boolean;
}

export interface ReminderCreate {
  taskId: number;
  title: string;
  url: string;
  /** Who asked, only when you chose to include it. */
  notes: string | null;
}

export interface RemindersPlan {
  list: string;
  create: ReminderCreate[];
  /** Reminders to mark completed: their task was ticked or dismissed in Didja. */
  complete: string[];
  /** Reminders to mark not completed: their task was reopened in Didja. */
  reopen: string[];
  /** What this sync did here: tasks ticked because you completed their reminder, and dismissed because you deleted it. */
  ticked: number;
  dismissed: number;
  /** True when every reminder Didja wrote was missing at once: nothing was dismissed for it. */
  held: boolean;
}

const localState = (t: Task): 'open' | 'done' => (t.status === 'done' || t.status === 'dismissed' ? 'done' : 'open');

/**
 * One sync. `seen` is every reminder found with a Didja link (in any list); `found` is false when the
 * app could not read Reminders, and then nothing is applied here. Changes made here are written now;
 * the reminders in `create`, `complete` and `reopen` are recorded once the app says it wrote them
 * (`remindersWritten`), so one it could not write is asked for again next time.
 */
export function remindersPlan(store: Store, seen: SeenReminder[] | null, now: Date = new Date()): RemindersPlan {
  const settings = remindersSettings(store);
  const plan: RemindersPlan = { list: settings.list, create: [], complete: [], reopen: [], ticked: 0, dismissed: 0, held: false };
  if (!settings.on || seen === null) return plan;

  const byId = new Map(seen.map((r) => [r.id, r]));
  const links = store.reminderLinks();
  const live = links.filter((l) => { const t = store.getTask(l.taskId); return t !== null && localState(t) === 'open'; });
  // Every reminder for an open task gone at once looks like a list or account Reminders lost, not
  // your deletions: hold, and dismiss nothing.
  plan.held = live.length >= 3 && live.every((l) => !byId.has(l.reminderId));

  for (const link of links) {
    const task = store.getTask(link.taskId);
    if (!task) {
      store.unlinkReminder(link.taskId);
      continue;
    }
    const reminder = byId.get(link.reminderId);
    if (!reminder) {
      if (plan.held) continue;
      // You deleted it in Reminders: the task is dismissed, if it was still open.
      if (localState(task) === 'open' && store.changeByYou(task.id, 'dismissed', now)) {
        store.addNote(task.id, 'judged', now.toISOString(), 'Dismissed: you deleted its reminder in Reminders');
        plan.dismissed++;
      }
      store.unlinkReminder(task.id);
      continue;
    }
    const remote = reminder.completed ? 'done' : 'open';
    const local = localState(task);
    if (remote === local) {
      if (link.synced !== local) store.setReminderSynced(task.id, local);
      continue;
    }
    if (remote !== link.synced) {
      // Changed in Reminders. Completing it there is your own act: tick the task, done by you.
      // Un-completing it there reopens nothing here (the conservative way round), and is left as it
      // is: the agreed state stays, so the reminder is not completed again under you.
      if (remote === 'done') {
        if (store.changeByYou(task.id, 'done', now)) {
          store.addNote(task.id, 'judged', now.toISOString(), 'Done: you completed its reminder in Reminders');
          plan.ticked++;
        }
        store.setReminderSynced(task.id, 'done');
      }
      continue;
    }
    // Changed here: carry it to Reminders.
    (local === 'done' ? plan.complete : plan.reopen).push(reminder.id);
  }

  const linked = new Set(store.reminderLinks().map((l) => l.taskId));
  const since = settings.since ?? now.toISOString();
  const wanted = new Set(settings.sources);
  const kinds = assistantKinds();
  for (const task of store.listTasks({ all: true })) {
    if (plan.create.length >= MAX_CREATES) break;
    if (task.status !== 'open' || task.isGroup || linked.has(task.id) || task.createdAt < since) continue;
    if (!wanted.has(reminderSourceOf(task, kinds))) continue;
    plan.create.push({ taskId: task.id, title: task.title, url: taskLink(task.id), notes: settings.who ? whoAsked(store, task) : null });
  }
  return plan;
}

/** Who asked: the chat it came from, or the email's note (sender and subject). Null for anything else. */
export function whoAsked(store: Store, task: Task): string | null {
  if (task.sourceKind === 'chat') return task.sourceRef;
  if (task.sourceKind === 'email') {
    const origin = store.listEvidence(task.id).filter((e) => e.kind === 'origin').at(-1)?.detail ?? null;
    return origin?.split('\n')[0]?.slice(0, 200) ?? null;
  }
  return null;
}

export interface RemindersWritten {
  created?: { taskId: number; reminderId: string }[];
  completed?: string[];
  reopened?: string[];
}

/** What the app wrote to Reminders, recorded so it is not written again. */
export function remindersWritten(store: Store, written: RemindersWritten, now: Date = new Date()): void {
  for (const c of written.created ?? []) {
    if (Number.isInteger(c.taskId) && typeof c.reminderId === 'string' && c.reminderId) store.linkReminder(c.taskId, c.reminderId, now);
  }
  const byReminder = new Map(store.reminderLinks().map((l) => [l.reminderId, l.taskId]));
  for (const id of written.completed ?? []) {
    const taskId = byReminder.get(id);
    if (taskId !== undefined) store.setReminderSynced(taskId, 'done');
  }
  for (const id of written.reopened ?? []) {
    const taskId = byReminder.get(id);
    if (taskId !== undefined) store.setReminderSynced(taskId, 'open');
  }
}
