/** SCR-100: Day Review (evening and morning), Not Done on a tick, the first-tick note. Made-up content only. */
import { expect, test } from 'bun:test';
import { buildReview, dueReview, firstTickNote, firstTickSeen, reviewMarkdown, reviewTimes, setReviewTime, undoTick } from '../src/review.ts';
import { Store } from '../src/store.ts';

// Wednesday 11 November 2026, 18:30 local time.
const NOW = new Date(2026, 10, 11, 18, 30);
const MORNING = new Date(2026, 10, 11, 9, 0);
const YESTERDAY = new Date(2026, 10, 10, 15, 0);

function task(store: Store, title: string, when: Date, source = 'Claude — Release'): number {
  return store.upsertTask({
    title, sourceKind: 'claude', sourceRef: source, confidence: 1, position: null, ts: when.toISOString(),
    observationId: null, markers: [], criteria: { service: null, hosts: [] },
  }).id;
}

function seeded() {
  const store = new Store(':memory:');
  const ids = {
    command: task(store, 'Run the migration', MORNING),
    accepted: task(store, 'Turn on the webhook', MORNING),
    byYou: task(store, 'Rotate the old key', MORNING),
    open: task(store, 'Update the changelog', MORNING),
    old: task(store, 'Book the room', YESTERDAY),
    tomorrow: task(store, 'Send Noa the slides', MORNING, 'WhatsApp — Noa Katz'),
    overdue: task(store, 'Pay the invoice', YESTERDAY, 'Microsoft Outlook'),
  };
  store.withOutcome(ids.command, 'ticked-command', new Date(2026, 10, 11, 11, 0), () => store.setStatus(ids.command, 'done', new Date(2026, 10, 11, 11, 0)));
  store.suggestDone(ids.accepted, 'Google Chrome — dashboard.example.com', null, new Date(2026, 10, 11, 12, 0));
  store.acceptLooksDone(ids.accepted, 'Google Chrome — dashboard.example.com', new Date(2026, 10, 11, 12, 0));
  store.changeByYou(ids.byYou, 'done', new Date(2026, 10, 11, 13, 0));
  store.setDue(ids.tomorrow, '2026-11-12');
  store.setDue(ids.overdue, '2026-11-09');
  store.setDue(ids.old, '2026-11-11');
  store.addWaiting({ key: 'w1', via: 'chat', app: 'WhatsApp', place: 'Dana Levi', who: 'Dana Levi', direct: true, title: 'Waiting on Dana: the signed contract', askedAt: MORNING, quietUntil: NOW }, MORNING);
  store.addWaiting({ key: 'w2', via: 'chat', app: 'WhatsApp', place: 'Sam Carter', who: 'Sam Carter', direct: true, title: 'Waiting on Sam: the floor plan', askedAt: MORNING, quietUntil: NOW }, MORNING);
  store.closeWaiting(store.waitingItems().find((w) => w.who === 'Sam Carter')!.id, 'answered', 'Sam replied in WhatsApp — Sam Carter at 14:10', new Date(2026, 10, 11, 14, 10));
  return { store, ids };
}

test('evening: ticked for you today (with why), answered, still open from today, due tomorrow', () => {
  const { store } = seeded();
  const review = buildReview(store, 'evening', NOW);
  const titles = Object.fromEntries(review.sections.map((s) => [s.title, s.items.map((i) => i.title)]));
  expect(titles).toEqual({
    'Ticked for you today': ['Run the migration', 'Turn on the webhook'],
    Answered: ['Waiting on Sam: the floor plan'],
    'Still open from today': ['Update the changelog', 'Send Noa the slides'],
    'Due tomorrow': ['Send Noa the slides'],
  });
  const ticked = review.sections[0]!.items;
  expect(ticked[1]!.why).toContain('dashboard.example.com');
  expect(review.sections[1]!.items[0]!.why).toBe('Sam replied in WhatsApp — Sam Carter at 14:10');
  store.close();
});

test('morning: due today, overdue, waiting on', () => {
  const { store } = seeded();
  const review = buildReview(store, 'morning', NOW);
  expect(review.sections.map((s) => [s.title, s.items.map((i) => i.title)])).toEqual([
    ['Due today', ['Book the room']],
    ['Overdue', ['Pay the invoice']],
    ['Waiting on', ['Waiting on Dana: the signed contract']],
  ]);
  store.close();
});

test('Not Done reopens a tick and records it as wrong; a tick from a screen is also taught and no longer trusted', () => {
  const { store, ids } = seeded();
  expect(undoTick(store, ids.command, NOW)).toBe(true);
  expect(store.getTask(ids.command)!.status).toBe('open');
  expect(store.lastOutcome(ids.command)).toBe('reopened-after-tick');
  expect(undoTick(store, ids.accepted, NOW)).toBe(true);
  expect(store.getTask(ids.accepted)!.status).toBe('open');
  expect(store.lastOutcome(ids.accepted)).toBe('reopened-after-tick');
  expect(store.lessons().some((l) => l.job === 'looks-done' && l.kind === 'not-done')).toBe(true);
  // Nothing left ticked for you today; something you did yourself is not Didja's to undo here.
  expect(buildReview(store, 'evening', NOW).sections.find((s) => s.key === 'ticked')).toBeUndefined();
  expect(undoTick(store, ids.open, NOW)).toBe(false);
  store.close();
});

test('Markdown for a standup: headings and bullets only', () => {
  const { store } = seeded();
  const md = reviewMarkdown(buildReview(store, 'morning', NOW));
  expect(md).toBe([
    '## Morning · 2026-11-11', '', '### Due today', '', '- Book the room (Claude — Release, due 2026-11-11)', '',
    '### Overdue', '', '- Pay the invoice (Microsoft Outlook, due 2026-11-09)', '',
    '### Waiting on', '', '- Waiting on Dana: the signed contract (WhatsApp — Dana Levi)', '',
  ].join('\n'));
  expect(reviewMarkdown({ kind: 'evening', day: '2026-11-11', sections: [] })).toBe('## Day Review · 2026-11-11\n\nNothing to review.\n');
  store.close();
});

test('off by default; once a day at the time you chose; the morning list is not shown after noon', () => {
  const store = new Store(':memory:');
  expect(reviewTimes(store)).toEqual({ evening: null, morning: null });
  expect(dueReview(store, NOW)).toBeNull();
  expect(setReviewTime(store, 'evening', '25:00')).toBe(false);
  setReviewTime(store, 'evening', '18:00');
  setReviewTime(store, 'morning', '08:30');
  expect(dueReview(store, new Date(2026, 10, 11, 17, 59))).toBeNull();
  expect(dueReview(store, NOW)).toBe('evening');
  expect(dueReview(store, NOW, true)).toBe('evening');
  expect(dueReview(store, NOW)).toBeNull();
  expect(dueReview(store, new Date(2026, 10, 12, 8, 45), true)).toBe('morning');
  expect(dueReview(store, new Date(2026, 10, 13, 13, 0))).toBeNull();
  setReviewTime(store, 'evening', null);
  expect(reviewTimes(store)).toEqual({ evening: null, morning: '08:30' });
  store.close();
});

test('the first tick Didja ever made is shown once, with its why', () => {
  const store = new Store(':memory:');
  expect(firstTickNote(store)).toBeNull();
  const id = task(store, 'Run the migration', MORNING);
  store.withOutcome(id, 'ticked-command', NOW, () => store.setStatus(id, 'done', NOW));
  expect(firstTickNote(store)).toMatchObject({ id, title: 'Run the migration' });
  firstTickSeen(store, NOW);
  expect(firstTickNote(store)).toBeNull();
  store.close();
});
