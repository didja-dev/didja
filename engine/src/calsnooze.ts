/**
 * Calendar-aware snooze (SCR-117): snooze times worked out from the user's calendar, for timing
 * only, never scheduling. The app reads events with EventKit on this Mac, after the user grants
 * Calendar access from the Snooze menu, and hands them here in memory: start, end, whether it is
 * all-day, and the attendees' names. Never an event's title. Nothing here is stored or sent; only
 * the time the user picks becomes the task's snooze time.
 */
import type { Store, Task } from './store.ts';

export interface CalEvent {
  start: string;
  end: string;
  allDay?: boolean;
  attendees?: string[];
}

export type CalendarSnoozeKind = 'after-this' | 'after-next' | 'before-first-tomorrow' | 'before-next-with';

export interface CalendarSnoozeOption {
  kind: CalendarSnoozeKind;
  /** When the task comes back, ISO. */
  until: string;
  /** For before-next-with: the person matched. */
  person?: string;
}

/** Minutes before a meeting that a task comes back, so it is in front of you beforehand. */
export const LEAD_MINUTES = 15;
/** How far ahead "my next meeting" looks. */
const NEXT_HOURS = 24;
/** How far ahead "my next meeting with them" looks. */
const WITH_DAYS = 14;

interface Timed {
  start: Date;
  end: Date;
  attendees: string[];
}

/** Timed events only (no all-day ones), each with valid times, ordered by start. */
function timed(events: CalEvent[]): Timed[] {
  return events
    .filter((e) => !e.allDay)
    .map((e) => ({ start: new Date(e.start), end: new Date(e.end), attendees: (e.attendees ?? []).filter((a) => typeof a === 'string') }))
    .filter((e) => !Number.isNaN(e.start.getTime()) && !Number.isNaN(e.end.getTime()) && e.end > e.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

function minus(d: Date, minutes: number): Date {
  return new Date(d.getTime() - minutes * 60_000);
}

/** A name for comparing: lower case, accents and punctuation gone, spaces collapsed. */
export function normaliseName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when an attendee is that person. Strict on purpose: the whole name the same, or, when the
 * task knows only a first name, that first name and nothing else to go on. Never part of a word.
 */
export function samePerson(person: string, attendee: string): boolean {
  const p = normaliseName(person);
  const a = normaliseName(attendee);
  if (!p || !a) return false;
  if (p === a) return true;
  const pWords = p.split(' ');
  return pWords.length === 1 && a.split(' ')[0] === p;
}

/** Who the task is with: the name of the one-to-one chat it came from, else null. */
export function taskPerson(task: Pick<Task, 'sourceKind' | 'sourceRef'>): string | null {
  if (task.sourceKind !== 'chat') return null;
  const name = task.sourceRef.split(' — ').at(-1)?.trim() ?? '';
  return name || null;
}

/** The options that apply now, each with its time. An option with no meeting to go by is left out. */
export function calendarSnoozeOptions(events: CalEvent[], now: Date, person: string | null = null): CalendarSnoozeOption[] {
  const list = timed(events);
  const options: CalendarSnoozeOption[] = [];

  // After this meeting: one you are in now. If several overlap, after the last of them ends.
  const current = list.filter((e) => e.start <= now && e.end > now);
  if (current.length) {
    const end = new Date(Math.max(...current.map((e) => e.end.getTime())));
    options.push({ kind: 'after-this', until: end.toISOString() });
  }

  // After my next meeting: the next one to start, within a day.
  const horizon = new Date(now.getTime() + NEXT_HOURS * 3_600_000);
  const next = list.find((e) => e.start > now && e.start <= horizon);
  if (next) options.push({ kind: 'after-next', until: next.end.toISOString() });

  // Before tomorrow's first meeting (local day), a little before it starts.
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const dayAfter = new Date(tomorrow);
  dayAfter.setDate(dayAfter.getDate() + 1);
  const first = list.find((e) => e.start >= tomorrow && e.start < dayAfter);
  if (first) options.push({ kind: 'before-first-tomorrow', until: minus(first.start, LEAD_MINUTES).toISOString() });

  // Before my next meeting with the person who asked, a little before it starts.
  if (person) {
    const until = new Date(now.getTime() + WITH_DAYS * 86_400_000);
    const meeting = list.find((e) => e.start > now && e.start <= until && e.attendees.some((a) => samePerson(person, a)));
    if (meeting) {
      const at = minus(meeting.start, LEAD_MINUTES);
      options.push({ kind: 'before-next-with', until: (at > now ? at : meeting.start).toISOString(), person });
    }
  }
  return options;
}

/** Read the events the app passed, ignoring anything that is not one. */
export function parseEvents(text: string): CalEvent[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { events?: unknown })?.events) ? (raw as { events: unknown[] }).events : [];
  return list.flatMap((e): CalEvent[] => {
    if (!e || typeof e !== 'object') return [];
    const { start, end, allDay, attendees } = e as Record<string, unknown>;
    if (typeof start !== 'string' || typeof end !== 'string') return [];
    return [{ start, end, allDay: allDay === true, attendees: Array.isArray(attendees) ? attendees.filter((a): a is string => typeof a === 'string') : [] }];
  });
}

/** For each open task, the calendar snooze options that apply: the shared ones, and per task the "with them" one. */
export function calendarSnoozePlan(store: Store, events: CalEvent[], now: Date = new Date()) {
  const shared = calendarSnoozeOptions(events, now);
  const withPerson: Record<number, CalendarSnoozeOption> = {};
  for (const task of store.listTasks({ all: true })) {
    if (task.status !== 'open') continue;
    const person = taskPerson(task);
    if (!person) continue;
    const option = calendarSnoozeOptions(events, now, person).find((o) => o.kind === 'before-next-with');
    if (option) withPerson[task.id] = option;
  }
  return { shared, withPerson };
}
