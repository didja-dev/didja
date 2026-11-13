/** SCR-78: an unclear list is shown at once as "checking…" while the model decides. Made-up content only. */
import { expect, test } from 'bun:test';
import { confirmChecking, MAYBE_CONFIDENCE, pollOnce } from '../src/engine.ts';
import type { Judge } from '../src/engine.ts';
import { CHECKING_CONFIDENCE, Store } from '../src/store.ts';

const NOW = new Date('2026-11-11T12:00:00Z');
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);
const UNCLEAR = 'Claude responded: Almost there.\nNext steps:\n1. Add the redirect URL in the Supabase dashboard\n2. Run the smoke test\n3. Tell Noa it is live\nThat should be it.';
const observe = (store: Store, ts = NOW) => store.insertObservation({
  ts: ts.toISOString(), bundleId: 'com.anthropic.claudefordesktop', app: 'Claude', windowTitle: 'Launch', url: null, source: 'ax', text: UNCLEAR });
const steps = (store: Store) => store.listTasks({ all: true }).filter((t) => !t.isGroup);

function judge(answer: 'user' | 'assistant' | null) {
  let asked = 0;
  const j: Judge = () => { asked++; return answer ? { audience: answer, model: 'test' } : null; };
  return { judge: j, asked: () => asked };
}

test('an unclear list is visible as checking after one fast pass, and is never nudged', () => {
  const store = new Store(':memory:');
  observe(store);
  pollOnce(store, NOW, { lane: 'fast', judging: true });
  expect(steps(store).map((t) => [t.status, t.confidence])).toEqual([['open', CHECKING_CONFIDENCE], ['open', CHECKING_CONFIDENCE], ['open', CHECKING_CONFIDENCE]]);
  // Hours later, still unjudged: not a nudge.
  expect(store.takeNudges(new Date(NOW.getTime() + 6 * 3600_000))).toEqual([]);
  store.close();
});

test('a "yours" verdict makes it a normal list, and then it can be nudged', () => {
  const store = new Store(':memory:');
  const j = judge('user');
  observe(store);
  pollOnce(store, NOW, { judge: j.judge });
  pollOnce(store, at(7), { judge: j.judge });
  expect(j.asked()).toBe(1);
  expect(steps(store).every((t) => t.status === 'open' && t.confidence > MAYBE_CONFIDENCE)).toBe(true);
  expect(store.takeNudges(new Date(NOW.getTime() + 6 * 3600_000)).length).toBe(1);
  store.close();
});

test('a step you tick while it is checking is kept, says the list is yours, and the model is not asked', () => {
  const store = new Store(':memory:');
  const j = judge('assistant');
  observe(store);
  pollOnce(store, NOW, { lane: 'fast', judging: true });
  const [first] = steps(store);
  expect(confirmChecking(store, first!.id, at(2))).toBe(true);
  store.changeByYou(first!.id, 'done', at(2));
  // The model lane would have said Claude's; your tick settled it first.
  pollOnce(store, at(10), { judge: j.judge });
  expect(j.asked()).toBe(0);
  expect(steps(store).map((t) => t.status)).toEqual(['done', 'open', 'open']);
  expect(steps(store).every((t) => t.confidence > MAYBE_CONFIDENCE)).toBe(true);
  // Seen again: the list is known to be yours.
  observe(store, at(20));
  pollOnce(store, at(21), { judge: j.judge });
  expect(j.asked()).toBe(0);
  // Not a step being checked: nothing to confirm.
  expect(confirmChecking(store, first!.id)).toBe(false);
  store.close();
});

test('a "Claude\'s" verdict after you ticked a step takes back only what you left open', () => {
  const store = new Store(':memory:');
  const j = judge('assistant');
  observe(store);
  pollOnce(store, NOW, { lane: 'fast', judging: true });
  const [first] = steps(store);
  // Ticked in a way that does not confirm the list (e.g. through a connected tool's sync).
  store.setStatus(first!.id, 'done', at(2));
  pollOnce(store, at(10), { judge: j.judge });
  expect(steps(store).map((t) => t.status)).toEqual(['done', 'dismissed', 'dismissed']);
  store.close();
});

test('with no model to answer, a checking list becomes "maybe", as before', () => {
  const store = new Store(':memory:');
  const j = judge(null);
  observe(store);
  pollOnce(store, NOW, { judge: j.judge });
  pollOnce(store, at(7), { judge: j.judge });
  expect(steps(store).every((t) => t.status === 'open' && t.confidence === MAYBE_CONFIDENCE)).toBe(true);
  store.close();
});
