/** SCR-122: undo and redo of your own changes in the list, on a made-up store. */
import { expect, test } from 'bun:test';
import { addManualTask, pollOnce } from '../src/engine.ts';
import { Store } from '../src/store.ts';
import { change, redo, undo, undoState, UNDO_HOURS } from '../src/undo.ts';

const NOW = new Date('2026-11-10T10:05:00Z');
const at = (m: number) => new Date(NOW.getTime() + m * 60_000);

function fresh(): Store {
  const store = new Store(':memory:');
  store.setMeta('outcomes_since', '2026-11-01T00:00:00.000Z');
  return store;
}

/** A made-up checklist from Claude with two steps: returns the parent and its steps. */
function checklist(store: Store): { parent: number; steps: number[] } {
  store.insertObservation({
    ts: '2026-11-10T10:00:00.000Z', bundleId: 'com.anthropic.claudefordesktop', app: 'Claude', windowTitle: 'Acme webhooks', url: null, source: 'ax',
    text: 'Claude responded: Before this works in prod:\nBefore this works in prod:\n1. Set ACME_WEBHOOK_SECRET in Vercel prod\n2. Run the migration with `supabase db push`',
  });
  pollOnce(store, NOW);
  const steps = store.listTasks({ all: true }).filter((t) => !t.isGroup && t.sourceKind === 'claude-desktop').map((t) => t.id);
  return { parent: store.getTask(steps[0]!)!.parentId!, steps };
}

const status = (store: Store, id: number) => store.getTask(id)!.status;

test('undo takes back a tick, and redo makes it again', () => {
  const store = fresh();
  const a = addManualTask(store, 'Send Sam the deck', NOW)!;
  expect(undoState(store, at(1))).toEqual({ undo: null, redo: null });
  change(store, { kind: 'done', id: a }, at(1));
  expect(status(store, a)).toBe('done');
  expect(undoState(store, at(2))).toEqual({ undo: 'Mark Done', redo: null });

  expect(undo(store, at(2))).toEqual({ what: 'Mark Done', ids: [a] });
  expect(status(store, a)).toBe('open');
  expect(store.getTask(a)!.doneAt).toBeNull();
  expect(undoState(store, at(3))).toEqual({ undo: null, redo: 'Mark Done' });

  expect(redo(store, at(3))?.ids).toEqual([a]);
  expect(status(store, a)).toBe('done');
  expect(undoState(store, at(4))).toEqual({ undo: 'Mark Done', redo: null });
  store.close();
});

test('undoing a parent tick brings back exactly the steps that were open, not the one already done', () => {
  const store = fresh();
  const { parent, steps } = checklist(store);
  const [first, second] = steps as [number, number];
  change(store, { kind: 'done', id: first }, at(1));
  change(store, { kind: 'done', id: parent }, at(2));
  expect(status(store, second)).toBe('done');
  expect(status(store, parent)).toBe('done');
  expect(undoState(store, at(3)).undo).toBe('Mark Done');

  undo(store, at(3));
  expect(status(store, parent)).toBe('open');
  expect(status(store, second)).toBe('open');
  // Reopening the parent by hand would reopen this one too; undo does not.
  expect(status(store, first)).toBe('done');
  store.close();
});

test('undo of a reopen ticks only what was done before, and is not counted as a new tick', () => {
  const store = fresh();
  const a = addManualTask(store, 'Pay the Acme invoice', NOW)!;
  change(store, { kind: 'done', id: a }, at(1));
  const doneAt = store.getTask(a)!.doneAt;
  change(store, { kind: 'reopen', id: a }, at(2));
  undo(store, at(3));
  expect(status(store, a)).toBe('done');
  expect(store.getTask(a)!.doneAt).toBe(doneAt);
  expect(store.lastOutcome(a)).toBe('done-by-hand');
  store.close();
});

test('undo takes back the counts a tick wrote, and redo writes them again', () => {
  const store = fresh();
  const a = addManualTask(store, 'Book the room for Noa', NOW)!;
  change(store, { kind: 'done', id: a }, at(1));
  expect(store.lastOutcome(a)).toBe('done-by-hand');
  undo(store, at(2));
  expect(store.lastOutcome(a)).not.toBe('done-by-hand');
  redo(store, at(3));
  expect(store.lastOutcome(a)).toBe('done-by-hand');
  store.close();
});

test('undoing a reopen of something Didja ticked restores the tick without a wrong-tick lesson', () => {
  const store = fresh();
  const { steps } = checklist(store);
  const push = steps[1]!;
  store.insertObservation({
    ts: '2026-11-10T10:06:00.000Z', bundleId: 'com.apple.Terminal', app: 'Terminal', windowTitle: 'zsh', url: null, source: 'ax',
    text: 'sam@mac acme-web % supabase db push\nApplying migration 20261110_webhooks.sql...\nFinished supabase db push.\nsam@mac acme-web % ',
  });
  pollOnce(store, at(2));
  expect(status(store, push)).toBe('done');
  const tickedOutcome = store.lastOutcome(push);

  change(store, { kind: 'reopen', id: push }, at(3));
  expect(store.lastOutcome(push)).toBe('reopened-after-tick');
  undo(store, at(4));
  expect(status(store, push)).toBe('done');
  expect(store.lastOutcome(push)).toBe(tickedOutcome);
  store.close();
});

test('undo puts back a dismiss and a snooze', () => {
  const store = fresh();
  const a = addManualTask(store, 'Reply to Noa', NOW)!;
  const b = addManualTask(store, 'Renew the Acme domain', NOW)!;
  change(store, { kind: 'dismiss', id: a }, at(1));
  change(store, { kind: 'snooze', id: b, until: at(120).toISOString() }, at(2));
  expect(undoState(store, at(3)).undo).toBe('Snooze');
  undo(store, at(3));
  expect(status(store, b)).toBe('open');
  expect(store.getTask(b)!.snoozedUntil).toBeNull();
  expect(undoState(store, at(3)).undo).toBe('Dismiss');
  undo(store, at(4));
  expect(status(store, a)).toBe('open');
  store.close();
});

test('a task changed since is left alone, and a new change clears redo', () => {
  const store = fresh();
  const a = addManualTask(store, 'Send Sam the deck', NOW)!;
  const b = addManualTask(store, 'Call the Acme office', NOW)!;
  change(store, { kind: 'done', id: a }, at(1));
  // Changed some other way since (not through undo): undo must not overwrite it.
  store.setStatus(a, 'dismissed', at(2));
  expect(undo(store, at(3))?.ids).toEqual([]);
  expect(status(store, a)).toBe('dismissed');

  change(store, { kind: 'done', id: b }, at(4));
  undo(store, at(5));
  expect(undoState(store, at(5)).redo).toBe('Mark Done');
  change(store, { kind: 'dismiss', id: b }, at(6));
  expect(undoState(store, at(6)).redo).toBeNull();
  store.close();
});

test('nothing to undo after a day, and a change that moves nothing is not kept', () => {
  const store = fresh();
  const a = addManualTask(store, 'Send Sam the deck', NOW)!;
  change(store, { kind: 'reopen', id: a }, at(1));
  expect(undoState(store, at(1)).undo).toBeNull();
  change(store, { kind: 'done', id: a }, at(1));
  expect(undoState(store, at(2)).undo).toBe('Mark Done');
  expect(undoState(store, at(UNDO_HOURS * 60 + 2)).undo).toBeNull();
  expect(undo(store, at(UNDO_HOURS * 60 + 2))).toBeNull();
  expect(status(store, a)).toBe('done');
  store.close();
});

test('undo of done-all puts back every task it ticked, with one step', () => {
  const store = fresh();
  const { parent, steps } = checklist(store);
  change(store, { kind: 'done-all', id: steps[0]! }, at(1));
  expect(status(store, parent)).toBe('done');
  expect(undoState(store, at(2)).undo).toBe('Done All From Here (2)');
  undo(store, at(2));
  expect(steps.map((s) => status(store, s))).toEqual(['open', 'open']);
  store.close();
});
