/**
 * Calendar-aware snooze (SCR-117): snooze times from made-up calendar events, read in memory.
 * Timing only: a snooze never ticks, and a person matches an attendee only by the whole name.
 */
import { expect, test } from 'bun:test';
import { parseSnooze } from '../src/cli.ts';
import type { CalEvent } from '../src/calsnooze.ts';
import { calendarSnoozeOptions, calendarSnoozePlan, LEAD_MINUTES, parseEvents, samePerson, taskPerson } from '../src/calsnooze.ts';
import { Store } from '../src/store.ts';

const NOW = new Date(2026, 10, 16, 10, 20); // a Monday, 10:20 local
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).toISOString();
const ev = (start: string, end: string, attendees: string[] = [], allDay = false): CalEvent => ({ start, end, attendees, allDay });

const EVENTS: CalEvent[] = [
  ev(at(16, 10), at(16, 10, 45), ['Noa Levi']), // now
  ev(at(16, 13), at(16, 13, 30), ['Sam Carter', 'Acme Team']),
  ev(at(16, 0), at(17, 0), [], true), // all-day: never counts
  ev(at(17, 9, 30), at(17, 10), ['Dana']),
  ev(at(17, 8), at(17, 8, 30)), // tomorrow's first
];

const kinds = (o: { kind: string }[]) => o.map((x) => x.kind);

test('in a meeting: after this one, after the next, before tomorrow\'s first', () => {
  const o = calendarSnoozeOptions(EVENTS, NOW);
  expect(kinds(o)).toEqual(['after-this', 'after-next', 'before-first-tomorrow']);
  expect(o[0]!.until).toBe(at(16, 10, 45));
  expect(o[1]!.until).toBe(at(16, 13, 30));
  expect(o[2]!.until).toBe(new Date(new Date(at(17, 8)).getTime() - LEAD_MINUTES * 60_000).toISOString());
});

test('overlapping meetings: after the last of them ends', () => {
  const o = calendarSnoozeOptions([ev(at(16, 10), at(16, 10, 30)), ev(at(16, 10, 15), at(16, 11))], NOW);
  expect(o.find((x) => x.kind === 'after-this')!.until).toBe(at(16, 11));
});

test('no calendar, or only all-day events: no options at all', () => {
  expect(calendarSnoozeOptions([], NOW)).toEqual([]);
  expect(calendarSnoozeOptions([ev(at(16, 0), at(17, 0), [], true), ev(at(17, 0), at(18, 0), [], true)], NOW)).toEqual([]);
});

test('broken events are ignored, not guessed', () => {
  expect(calendarSnoozeOptions([ev('not a time', at(16, 11)), ev(at(16, 12), at(16, 11))], NOW)).toEqual([]);
  expect(parseEvents('nonsense')).toEqual([]);
  expect(parseEvents(JSON.stringify([{ start: at(16, 12), end: at(16, 13), title: 'Secret plan', attendees: ['Sam', 4] }, { start: 1 }])))
    .toEqual([{ start: at(16, 12), end: at(16, 13), allDay: false, attendees: ['Sam'] }]);
});

test('"after my next meeting" looks a day ahead, no further', () => {
  expect(kinds(calendarSnoozeOptions([ev(at(18, 9), at(18, 10))], NOW))).toEqual([]);
});

test('before my next meeting with them: the whole name, or a first name alone', () => {
  const sam = calendarSnoozeOptions(EVENTS, NOW, 'Sam Carter').find((o) => o.kind === 'before-next-with')!;
  expect(sam.until).toBe(new Date(new Date(at(16, 13)).getTime() - LEAD_MINUTES * 60_000).toISOString());
  expect(calendarSnoozeOptions(EVENTS, NOW, 'Dana').find((o) => o.kind === 'before-next-with')!.until)
    .toBe(new Date(new Date(at(17, 9, 30)).getTime() - LEAD_MINUTES * 60_000).toISOString());
  // The meeting you are in now is not "next".
  expect(calendarSnoozeOptions(EVENTS, NOW, 'Noa Levi').find((o) => o.kind === 'before-next-with')).toBeUndefined();
});

test('a person never matches part of a name, another surname, or a group', () => {
  expect(samePerson('Sam', 'Samantha Carter')).toBe(false);
  expect(samePerson('Sam Carter', 'Sam Brown')).toBe(false);
  expect(samePerson('Sam Carter', 'Sam')).toBe(false);
  expect(samePerson('Acme', 'Acme Team')).toBe(true); // a first word alone is the only loose case
  expect(samePerson('Book Club', 'Book')).toBe(false);
  expect(samePerson('נועה', 'נועה כהן')).toBe(true);
  expect(samePerson('Zoë', 'zoe')).toBe(true);
  expect(calendarSnoozeOptions(EVENTS, NOW, 'Sam Brown').find((o) => o.kind === 'before-next-with')).toBeUndefined();
});

test('the person is the chat a task came from; email and AI steps have none', () => {
  expect(taskPerson({ sourceKind: 'chat', sourceRef: 'WhatsApp — Sam Carter' })).toBe('Sam Carter');
  expect(taskPerson({ sourceKind: 'email', sourceRef: 'Mail — Inbox' })).toBeNull();
  expect(taskPerson({ sourceKind: 'ai', sourceRef: 'Claude — Deploy' })).toBeNull();
});

test('a snooze to a worked-out time: ahead and within 30 days only', () => {
  expect(parseSnooze(`at:${at(16, 13, 30)}`, NOW)!.toISOString()).toBe(at(16, 13, 30));
  expect(parseSnooze(`at:${at(16, 9)}`, NOW)).toBeNull();
  expect(parseSnooze(`at:${new Date(2027, 0, 30).toISOString()}`, NOW)).toBeNull();
  expect(parseSnooze('at:soon', NOW)).toBeNull();
});

test('the plan gives shared options and, per open chat task, "with them"; it changes nothing', () => {
  const store = new Store(':memory:');
  const ts = NOW.toISOString();
  const add = (title: string, sourceKind: string, sourceRef: string) =>
    store.upsertTask({ distinct: title, title, sourceKind, sourceRef, confidence: 1, position: null, ts, observationId: null, markers: [], criteria: null }).id;
  const withSam = add('Send Sam the deck', 'chat', 'WhatsApp — Sam Carter');
  const withNobody = add('Pay the Acme invoice', 'email', 'Mail — Inbox');
  const done = add('Call Dana back', 'chat', 'WhatsApp — Dana');
  store.setStatus(done, 'done', NOW);
  const before = JSON.stringify(store.listTasks({ all: true }));
  const plan = calendarSnoozePlan(store, EVENTS, NOW);
  expect(kinds(plan.shared)).toEqual(['after-this', 'after-next', 'before-first-tomorrow']);
  expect(Object.keys(plan.withPerson).map(Number)).toEqual([withSam]);
  expect(plan.withPerson[withNobody]).toBeUndefined();
  expect(JSON.stringify(store.listTasks({ all: true }))).toBe(before);
});
