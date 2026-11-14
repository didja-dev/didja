/** SCR-116: the week. What you finished, from what Didja keeps; titles and outcomes only; changes nothing. */
import { expect, test } from 'bun:test';
import { addManualTask } from '../src/engine.ts';
import { Store } from '../src/store.ts';
import { buildWeek, dayLabel, kindOf, setWeekNudge, weekDue, weekMarkdown, weekNudgeOn } from '../src/week.ts';

// Friday 13 November 2026, 17:00 local time.
const FRIDAY = new Date(2026, 10, 13, 17, 0);
const at = (daysBack: number, hour = 10) => new Date(2026, 10, 13 - daysBack, hour, 0);

function seeded(): { store: Store; ids: Record<string, number> } {
  const store = new Store(':memory:');
  const make = (title: string, daysBack: number) => addManualTask(store, title, at(daysBack, 9))!;
  const ids = {
    byYou: make('Send Noa the Acme deck', 0),
    ticked: make('Run the prod migration', 1),
    dismissed: make('Not a real to-do', 2),
    fresh: make('Cleared by Fresh Start', 1),
    old: make('Done before the week', 10),
    open: make('Still open', 0),
  };
  store.withOutcome(ids.byYou, 'done-by-hand', at(0), () => store.setStatus(ids.byYou, 'done', at(0)));
  store.withOutcome(ids.ticked, 'ticked-command', at(1, 11), () => store.setStatus(ids.ticked, 'done', at(1, 11)));
  store.withOutcome(ids.dismissed, 'dismissed', at(2), () => store.setStatus(ids.dismissed, 'dismissed', at(2)));
  store.withOutcome(ids.fresh, 'fresh-start', at(1), () => store.setStatus(ids.fresh, 'done', at(1)));
  store.withOutcome(ids.old, 'done-by-hand', at(10), () => store.setStatus(ids.old, 'done', at(10)));
  store.addWaiting({ key: 'w1', via: 'chat', app: 'WhatsApp', place: 'Sam Carter', who: 'Sam Carter', direct: true, title: 'Waiting on Sam: the floor plan', askedAt: at(1, 8), quietUntil: at(0) }, at(1, 8));
  const w = store.waitingItems()[0]!;
  store.closeWaiting(w.id, 'answered', 'Sam Carter replied at 12:00', at(0, 12));
  return { store, ids };
}

test('done by you, ticked by Didja, answered and dismissed, in the last seven days', () => {
  const { store } = seeded();
  const week = buildWeek(store, FRIDAY);
  expect(week.from).toBe('2026-11-07');
  expect(week.to).toBe('2026-11-13');
  expect(week.totals).toEqual({ byYou: 1, ticked: 1, answered: 1, dismissed: 1 });
  const all = week.days.flatMap((d) => d.items);
  expect(all.map((i) => [i.title, i.kind]).sort()).toEqual([
    ['Not a real to-do', 'dismissed'],
    ['Run the prod migration', 'ticked'],
    ['Send Noa the Acme deck', 'byYou'],
    ['Waiting on Sam: the floor plan', 'answered'],
  ]);
  // Not in it: open tasks, a Fresh Start (cleared, not finished), and anything older than the week.
  expect(all.some((i) => ['Still open', 'Cleared by Fresh Start', 'Done before the week'].includes(i.title))).toBe(false);
  store.close();
});

test('by day, newest first, each with where it came from', () => {
  const { store } = seeded();
  const week = buildWeek(store, FRIDAY);
  expect(week.days.map((d) => d.day)).toEqual(['2026-11-13', '2026-11-12', '2026-11-11']);
  expect(week.days[0]!.items.map((i) => i.source).sort()).toEqual(['Added by you', 'WhatsApp — Sam Carter']);
  store.close();
});

test('reading the week changes nothing', () => {
  const { store } = seeded();
  const before = JSON.stringify(store.listTasks({ all: true }));
  buildWeek(store, FRIDAY);
  weekMarkdown(buildWeek(store, FRIDAY));
  expect(JSON.stringify(store.listTasks({ all: true }))).toBe(before);
  store.close();
});

test('Markdown: totals, then days, by source; titles and outcomes only', () => {
  const { store } = seeded();
  const md = weekMarkdown(buildWeek(store, FRIDAY));
  expect(md).toContain('## Your week · 2026-11-07 – 2026-11-13');
  expect(md).toContain('1 done by you · 1 ticked by Didja · 1 answered · 1 dismissed');
  expect(md.indexOf(`### ${dayLabel('2026-11-13')}`)).toBeLessThan(md.indexOf(`### ${dayLabel('2026-11-12')}`));
  expect(md).toContain('- Added by you\n  - ✓ Send Noa the Acme deck (done by you)');
  expect(md).toContain('  - ✓ Run the prod migration (ticked by Didja)');
  expect(md).toContain('  - ✗ Not a real to-do (dismissed)');
  store.close();
});

test('an empty week says so', () => {
  const store = new Store(':memory:');
  const md = weekMarkdown(buildWeek(store, FRIDAY));
  expect(md).toContain('0 done by you · 0 ticked by Didja · 0 answered · 0 dismissed');
  expect(md).toContain('Nothing finished this week yet.');
  store.close();
});

test('a checklist counts as its steps; a dismissal is counted only when you dismissed it', () => {
  expect(kindOf({ status: 'done', isGroup: true }, 'done-by-hand')).toBeNull();
  expect(kindOf({ status: 'done', isGroup: false }, null)).toBe('byYou');
  expect(kindOf({ status: 'done', isGroup: false }, 'ticked-reply')).toBe('ticked');
  expect(kindOf({ status: 'done', isGroup: false }, 'yes')).toBe('byYou');
  expect(kindOf({ status: 'dismissed', isGroup: false }, 'not-an-action')).toBe('dismissed');
  expect(kindOf({ status: 'dismissed', isGroup: false }, null)).toBeNull();
  expect(kindOf({ status: 'open', isGroup: false }, 'reopened-after-tick')).toBeNull();
});

test('the Friday reminder is off by default, and once on comes once, on Friday from 16:00', () => {
  const store = new Store(':memory:');
  expect(weekNudgeOn(store)).toBe(false);
  expect(weekDue(store, FRIDAY)).toBe(false);
  setWeekNudge(store, true);
  expect(weekDue(store, new Date(2026, 10, 13, 15, 59))).toBe(false); // before 16:00
  expect(weekDue(store, new Date(2026, 10, 12, 17, 0))).toBe(false); // Thursday
  expect(weekDue(store, new Date(2026, 10, 14, 17, 0))).toBe(false); // Saturday: a missed Friday is not made up
  expect(weekDue(store, FRIDAY)).toBe(true);
  expect(weekDue(store, FRIDAY, true)).toBe(true);
  expect(weekDue(store, new Date(2026, 10, 13, 18, 0))).toBe(false); // once
  expect(weekDue(store, new Date(2026, 10, 20, 16, 30))).toBe(true); // next Friday
  setWeekNudge(store, false);
  expect(weekDue(store, new Date(2026, 10, 20, 16, 30))).toBe(false);
  store.close();
});
