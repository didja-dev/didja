/** SCR-48 Fresh Start and SCR-46 My List. */
import { expect, test } from 'bun:test';
import { addManualTask, keepTask, pollOnce } from '../src/engine.ts';
import { KEPT_LIST, Store } from '../src/store.ts';

const NOW = new Date(2026, 10, 12, 10, 0);
const later = (m: number) => new Date(NOW.getTime() + m * 60_000);

function seeded() {
  const store = new Store(':memory:');
  const a = addManualTask(store, 'Send Sam the deck', NOW)!;
  const b = addManualTask(store, 'Pay the Acme invoice', NOW)!;
  const kept = keepTask(store, 'Renew the passport', NOW)!;
  store.snooze(b, later(120), NOW);
  const done = addManualTask(store, 'Already finished', NOW)!;
  store.setStatus(done, 'done', NOW);
  return { store, a, b, kept, done };
}

test('Fresh Start marks every open and snoozed task done, and leaves My List', () => {
  const { store, a, b, kept } = seeded();
  expect(store.freshStart(later(1)).sort()).toEqual([a, b].sort());
  expect(store.listTasks().map((t) => t.id)).toEqual([kept]);
  expect(store.getTask(a)!.status).toBe('done');
  expect(store.lastFreshStart()).toEqual({ at: later(1).toISOString(), count: 2 });
  store.close();
});

test('Undo puts back exactly what it marked done, snoozed ones snoozed, unless you changed them since', () => {
  const { store, a, b, done } = seeded();
  store.freshStart(later(1));
  store.setStatus(a, 'dismissed', later(2)); // you changed this one since
  expect(store.undoFreshStart(later(3))).toEqual([b]);
  expect(store.getTask(b)!.status).toBe('snoozed');
  expect(store.getTask(a)!.status).toBe('dismissed');
  expect(store.getTask(done)!.status).toBe('done'); // done before the fresh start: untouched
  expect(store.lastFreshStart()).toBeNull();
  expect(store.undoFreshStart(later(4))).toEqual([]);
  store.close();
});

test('My List is a list of its own, ticked only by you', () => {
  const store = new Store(':memory:');
  const id = keepTask(store, '  Renew   the passport on gov.example.com ', NOW)!;
  const control = addManualTask(store, 'Renew the passport on gov.example.com', NOW)!; // the same words, not on My List
  const task = store.getTask(id)!;
  expect(task.title).toBe('Renew the passport on gov.example.com');
  expect(task.sourceRef).toBe(KEPT_LIST);
  expect(keepTask(store, '   ', NOW)).toBeNull();
  // A screen that says it outright is not taken as done, nor shown to the model.
  store.insertObservation({ ts: later(5).toISOString(), bundleId: 'com.apple.Safari', app: 'Safari', windowTitle: 'Passport',
    url: 'https://gov.example.com/passport', source: 'ax', text: 'Renew the passport on gov.example.com\nYour passport renewal is complete.' });
  const looked: string[] = [];
  pollOnce(store, later(6), { looker: (q) => { looked.push(q.task); return 'done'; } });
  expect(store.getTask(id)!.status).toBe('open');
  expect(store.getTask(id)!.suggestion).toBeNull();
  expect(looked.length).toBeGreaterThan(0); // the ordinary task was looked at
  expect(store.getTask(control)!.suggestion !== null || store.getTask(control)!.status === 'done').toBe(true);
  store.close();
});
