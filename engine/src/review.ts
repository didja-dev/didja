/**
 * Day Review (SCR-100): an opt-in, short look at the day. Off until you choose a time.
 *
 * - Evening: what Didja ticked for you today (each with why, and Not Done), asks you sent that were
 *   answered today, what is still open from today, and what is due tomorrow.
 * - Morning: what is due today, what is overdue, and who you are waiting on.
 *
 * Built from the database only; it changes nothing. Not Done on a tick reopens the task, which
 * records the tick as wrong and the place as not trusted (as reopening it anywhere does).
 */
import { dayOf } from './due.ts';
import { TICKS } from './store.ts';
import type { Store, Task } from './store.ts';

export type ReviewKind = 'evening' | 'morning';

export interface ReviewItem {
  id: number;
  title: string;
  source: string;
  /** Why it was ticked, closed or listed: the engine's own words. */
  why?: string;
  due?: string;
}

export interface Review {
  kind: ReviewKind;
  /** The local day it is about, "YYYY-MM-DD". */
  day: string;
  sections: { key: string; title: string; items: ReviewItem[] }[];
}

function startOfDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function tomorrowOf(now: Date): string {
  const d = startOfDay(now);
  d.setDate(d.getDate() + 1);
  return dayOf(d);
}

/** Steps, not parents. */
function steps(store: Store): Task[] {
  return store.listTasks({ all: true }).filter((t) => !t.isGroup);
}

/** The review as it stands at `now`. Sections with nothing in them are left out. */
export function buildReview(store: Store, kind: ReviewKind, now: Date = new Date()): Review {
  const today = dayOf(now);
  const since = startOfDay(now).toISOString();
  const all = steps(store);
  const item = (t: Task, extra: Partial<ReviewItem> = {}): ReviewItem => ({ id: t.id, title: t.title, source: t.sourceRef, ...extra });
  const sections: Review['sections'] = [];
  const add = (key: string, title: string, items: ReviewItem[]) => {
    if (items.length) sections.push({ key, title, items });
  };

  if (kind === 'evening') {
    // Ticked for you today, and still ticked: the last thing that happened to it was Didja's tick.
    const ticked = all.filter((t) => t.status === 'done' && t.doneAt !== null && t.doneAt >= since
      && (TICKS as readonly string[]).includes(store.lastOutcome(t.id) ?? ''));
    add('ticked', 'Ticked for you today', ticked.map((t) => item(t, { why: store.tickReason(t.id) ?? undefined })));
    add('answered', 'Answered', store.waitingItems({ all: true })
      .filter((w) => w.status === 'answered' && w.closedAt !== null && w.closedAt >= since)
      .map((w) => ({ id: w.id, title: w.title, source: `${w.app} — ${w.place}`, why: w.closedWhy ?? undefined })));
    add('open', 'Still open from today', all.filter((t) => t.status === 'open' && t.createdAt >= since).map((t) => item(t)));
    const tomorrow = tomorrowOf(now);
    add('tomorrow', 'Due tomorrow', all.filter((t) => (t.status === 'open' || t.status === 'snoozed') && t.dueAt === tomorrow).map((t) => item(t, { due: t.dueAt! })));
  } else {
    const open = all.filter((t) => t.status === 'open' || t.status === 'snoozed');
    add('today', 'Due today', open.filter((t) => t.dueAt === today).map((t) => item(t, { due: t.dueAt! })));
    add('overdue', 'Overdue', open.filter((t) => t.dueAt && t.dueAt < today).sort((a, b) => a.dueAt!.localeCompare(b.dueAt!)).map((t) => item(t, { due: t.dueAt! })));
    add('waiting', 'Waiting on', store.waitingItems().map((w) => ({ id: w.id, title: w.title, source: `${w.app} — ${w.place}` })));
  }
  return { kind, day: today, sections };
}

/** The review as Markdown, for a standup or notes: headings and bullets, nothing else. */
export function reviewMarkdown(review: Review): string {
  const head = review.kind === 'evening' ? `## Day Review · ${review.day}` : `## Morning · ${review.day}`;
  if (review.sections.length === 0) return `${head}\n\nNothing to review.\n`;
  const parts = [head];
  for (const s of review.sections) {
    parts.push(`### ${s.title}`);
    parts.push(s.items.map((i) => `- ${i.title} (${i.source}${i.due ? `, due ${i.due}` : ''})`).join('\n'));
  }
  return `${parts.join('\n\n')}\n`;
}

/** "18:00" → minutes after midnight; null for anything else ("off"). */
export function parseClock(text: string | null | undefined): number | null {
  const m = (text ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? h * 60 + min : null;
}

const TIME_KEY: Record<ReviewKind, string> = { evening: 'review_evening', morning: 'review_morning' };
const SHOWN_KEY: Record<ReviewKind, string> = { evening: 'review_evening_shown', morning: 'review_morning_shown' };

/** The times you chose, "HH:MM", or null when that review is off (the default). */
export function reviewTimes(store: Store): Record<ReviewKind, string | null> {
  const read = (k: ReviewKind) => (parseClock(store.getMeta(TIME_KEY[k])) === null ? null : store.getMeta(TIME_KEY[k])!.trim());
  return { evening: read('evening'), morning: read('morning') };
}

export function setReviewTime(store: Store, kind: ReviewKind, time: string | null): boolean {
  if (time !== null && parseClock(time) === null) return false;
  store.setMeta(TIME_KEY[kind], time ?? 'off');
  return true;
}

/**
 * The review that is due now, once a day: its time has come today and it was not shown today.
 * Evening first. Marks it shown when `take` is set (the app shows it, or posts its reminder).
 */
export function dueReview(store: Store, now: Date = new Date(), take = false): ReviewKind | null {
  const today = dayOf(now);
  const minutes = now.getHours() * 60 + now.getMinutes();
  for (const kind of ['evening', 'morning'] as const) {
    const at = parseClock(store.getMeta(TIME_KEY[kind]));
    if (at === null || minutes < at || store.getMeta(SHOWN_KEY[kind]) === today) continue;
    // The morning list is for the morning: not shown after noon if it was missed.
    if (kind === 'morning' && minutes >= 12 * 60 && at < 12 * 60) continue;
    if (take) store.setMeta(SHOWN_KEY[kind], today);
    return kind;
  }
  return null;
}

/**
 * The first tick Didja ever made for you (SCR-100): shown once, with Undo. Null once it was seen,
 * or before there is one. Only a tick still standing counts.
 */
export function firstTickNote(store: Store): { id: number; title: string; why: string | null } | null {
  if (store.getMeta('first_tick_seen')) return null;
  const id = store.firstTick();
  if (id === null) return null;
  const task = store.getTask(id);
  if (!task || task.status !== 'done') return null;
  return { id, title: task.title, why: store.tickReason(id) };
}

export function firstTickSeen(store: Store, now: Date = new Date()): void {
  store.setMeta('first_tick_seen', now.toISOString());
}

/** Not Done on a tick: reopen it. A tick from what a screen looked like is also taught as not done. */
export function undoTick(store: Store, id: number, now: Date = new Date()): boolean {
  const task = store.getTask(id);
  if (!task || task.status !== 'done') return false;
  if (task.acceptedFrom) return store.notDone(id, now);
  return store.setStatus(id, 'open', now);
}
