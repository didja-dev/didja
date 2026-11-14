/**
 * The week (SCR-116): what you finished over the last seven days, from what Didja already keeps.
 * Done by you, ticked by Didja, asks of yours that were answered, and what you dismissed, by day,
 * each with where it came from. Titles and outcomes only: no kept lines, no screen text.
 *
 * Built from the database only; it changes nothing. In the Full View (This Week), as Markdown to
 * copy or save, and as one opt-in Friday reminder (off until you turn it on).
 */
import { dayOf } from './due.ts';
import { TICKS } from './store.ts';
import type { Outcome, Store, Task } from './store.ts';

export type WeekKind = 'byYou' | 'ticked' | 'answered' | 'dismissed';

export interface WeekItem {
  /** A task's id, or a Waiting On row's for `answered`. */
  id: number;
  kind: WeekKind;
  title: string;
  source: string;
  /** When it happened (ISO). */
  at: string;
}

export interface Week {
  /** The first and last local days covered, "YYYY-MM-DD": the last seven days, today included. */
  from: string;
  to: string;
  /**
   * Set when outcomes have been recorded only since a time after `from` (the first version that
   * recorded them, or Forget Everything Didja Learned): nothing finished before it is shown,
   * since how it ended is not known.
   */
  countedSince: string | null;
  totals: Record<WeekKind, number>;
  /** Newest day first; days with nothing in them are left out. Items in each day by source, then time. */
  days: { day: string; items: WeekItem[] }[];
}

export const WEEK_WORDS: Record<WeekKind, string> = {
  byYou: 'done by you',
  ticked: 'ticked by Didja',
  answered: 'answered',
  dismissed: 'dismissed',
};

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** What Didja made of a finished task, or null when it does not belong in the week. */
export function kindOf(task: Pick<Task, 'status' | 'isGroup'>, last: Outcome | null): WeekKind | null {
  if (task.isGroup) return null; // a checklist is its steps
  if (task.status === 'done') {
    if (last === 'fresh-start') return null; // cleared for a fresh list, not finished
    return last !== null && (TICKS as readonly string[]).includes(last) ? 'ticked' : 'byYou';
  }
  if (task.status === 'dismissed') return last === 'dismissed' || last === 'not-an-action' ? 'dismissed' : null;
  return null;
}

export function buildWeek(store: Store, now: Date = new Date()): Week {
  const first = startOfDay(now);
  first.setDate(first.getDate() - 6);
  // How a task ended is known only from the outcomes recorded since `outcomes_since`.
  const recorded = store.getMeta('outcomes_since');
  const countedSince = recorded && recorded > first.toISOString() ? recorded : null;
  const since = countedSince ?? first.toISOString();
  const items: WeekItem[] = [];
  for (const t of store.listTasks({ all: true })) {
    if (t.status !== 'done' && t.status !== 'dismissed') continue;
    const last = store.lastOutcomeAt(t.id);
    const kind = kindOf(t, last?.outcome ?? null);
    if (!kind) continue;
    // Done: when it was done. Dismissed: when you dismissed it (its outcome's time).
    const at = kind === 'dismissed' ? last!.ts : t.doneAt;
    if (!at || at < since || at > now.toISOString()) continue;
    items.push({ id: t.id, kind, title: t.title, source: t.sourceRef, at });
  }
  for (const w of store.waitingItems({ all: true })) {
    // A Waiting On row says itself when it was answered, so it needs no recorded outcome.
    if (w.status !== 'answered' || !w.closedAt || w.closedAt < first.toISOString()) continue;
    items.push({ id: w.id, kind: 'answered', title: w.title, source: `${w.app} — ${w.place}`, at: w.closedAt });
  }
  const totals: Record<WeekKind, number> = { byYou: 0, ticked: 0, answered: 0, dismissed: 0 };
  const byDay = new Map<string, WeekItem[]>();
  for (const item of items) {
    totals[item.kind]++;
    const day = dayOf(new Date(item.at));
    byDay.set(day, [...(byDay.get(day) ?? []), item]);
  }
  const days = [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, list]) => ({ day, items: list.sort((a, b) => a.source.localeCompare(b.source) || a.at.localeCompare(b.at) || a.id - b.id) }));
  return { from: dayOf(first), to: dayOf(now), countedSince, totals, days };
}

/** "Fri 13 Nov" for "2026-11-13". */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "13 Nov at 03:56", local time. */
export function countedLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} at ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "12 done by you · 5 ticked by Didja · 2 answered · 1 dismissed": every kind, zeros too. */
export function totalsLine(week: Week): string {
  return (Object.keys(WEEK_WORDS) as WeekKind[]).map((k) => `${week.totals[k]} ${WEEK_WORDS[k]}`).join(' · ');
}

/** The week as Markdown, for notes or a weekly update: headings and bullets, nothing else. */
export function weekMarkdown(week: Week): string {
  const parts = [`## Your week · ${week.from} – ${week.to}`, totalsLine(week)];
  if (week.countedSince) parts.push(`Counted since ${countedLabel(week.countedSince)}: how tasks ended was not recorded before then.`);
  if (week.days.length === 0) parts.push('Nothing finished this week yet.');
  for (const { day, items } of week.days) {
    parts.push(`### ${dayLabel(day)}`);
    const sources = [...new Set(items.map((i) => i.source))];
    parts.push(sources.map((s) => [`- ${s}`, ...items.filter((i) => i.source === s).map((i) => `  - ${i.kind === 'dismissed' ? '✗' : '✓'} ${i.title} (${WEEK_WORDS[i.kind]})`)].join('\n')).join('\n'));
  }
  return `${parts.join('\n\n')}\n`;
}

const NUDGE_KEY = 'week_nudge';
const SHOWN_KEY = 'week_nudge_shown';
/** Friday at 16:00, local time. */
const NUDGE_DAY = 5;
const NUDGE_MINUTES = 16 * 60;

/** The Friday reminder: off unless you turned it on. */
export function weekNudgeOn(store: Store): boolean {
  return store.getMeta(NUDGE_KEY) === 'on';
}

export function setWeekNudge(store: Store, on: boolean): void {
  store.setMeta(NUDGE_KEY, on ? 'on' : 'off');
}

/**
 * Whether the Friday reminder is due now: it is on, it is Friday from 16:00, and it was not given
 * today. `take` marks it given. Never on another day: a missed Friday is not made up.
 */
export function weekDue(store: Store, now: Date = new Date(), take = false): boolean {
  if (!weekNudgeOn(store)) return false;
  if (now.getDay() !== NUDGE_DAY || now.getHours() * 60 + now.getMinutes() < NUDGE_MINUTES) return false;
  const today = dayOf(now);
  if (store.getMeta(SHOWN_KEY) === today) return false;
  if (take) store.setMeta(SHOWN_KEY, today);
  return true;
}
