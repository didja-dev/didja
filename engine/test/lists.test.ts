import { expect, test } from 'bun:test';
import { MAYBE_CONFIDENCE, pollOnce } from '../src/engine.ts';
import type { Judge } from '../src/engine.ts';
import { extractChecklists, planActor, replyAround, stepLeaning } from '../src/extract.ts';
import { Store } from '../src/store.ts';

// SCR-70: unclear lists wait for the verdict; with no model they are "maybe"; Claude's own plans are
// recognised from their steps. All lists here are made up.
const NOW = new Date('2026-11-11T12:00:00Z');
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);
const observe = (store: Store, text: string, ts = NOW.toISOString()) => store.insertObservation({
  ts, bundleId: 'com.anthropic.claudefordesktop', app: 'Claude', windowTitle: 'Launch', url: null, source: 'ax', text });
const UNCLEAR = 'Claude responded: Almost there.\nNext steps:\n1. Add the redirect URL in the Supabase dashboard\n2. Run the smoke test\n3. Tell Noa it is live\nThat should be it.';

function judge(answer: 'user' | 'assistant' | null) {
  const asked: Parameters<Judge>[0][] = [];
  const j: Judge = (list) => { asked.push(list); return answer ? { audience: answer, model: 'test-model' } : null; };
  return { judge: j, asked };
}

test('an unclear list shows nothing until judged yours, then its steps at full confidence', () => {
  const store = new Store(':memory:');
  const { judge: j, asked } = judge('user');
  observe(store, UNCLEAR);
  pollOnce(store, NOW, { judge: j });
  expect(store.listTasks()).toEqual([]);
  expect(pollOnce(store, at(7), { judge: j }).judged).toBe(1);
  expect(store.listTasks().map((t) => t.title)).toEqual(['Add the redirect URL in the Supabase dashboard', 'Run the smoke test', 'Tell Noa it is live']);
  expect(store.listTasks().every((t) => t.confidence > MAYBE_CONFIDENCE)).toBe(true);
  // The model saw the whole reply, not only the lead-in and steps.
  expect(asked[0]!.reply).toBe('Almost there.\nNext steps:\n1. Add the redirect URL in the Supabase dashboard\n2. Run the smoke test\n3. Tell Noa it is live\nThat should be it.');
  store.close();
});

test('with no model, an unclear list is kept as "maybe"; judged yours later, it is no longer maybe', () => {
  const store = new Store(':memory:');
  observe(store, UNCLEAR);
  pollOnce(store, NOW, { judge: judge(null).judge });
  pollOnce(store, at(7), { judge: judge(null).judge });
  expect(store.listTasks().length).toBe(3);
  expect(store.listTasks().every((t) => t.confidence === MAYBE_CONFIDENCE)).toBe(true);
  expect(store.settledPendingJudgements(at(100), 10)).toEqual([]);

  // A model is there now: seen again, judged yours, shown as usual.
  observe(store, UNCLEAR, at(20).toISOString());
  const { judge: j } = judge('user');
  pollOnce(store, at(20), { judge: j });
  pollOnce(store, at(30), { judge: j });
  expect(store.listTasks().length).toBe(3);
  expect(store.listTasks().every((t) => t.confidence > MAYBE_CONFIDENCE)).toBe(true);
  store.close();
});

test('with no judge at all, an unclear list is "maybe" at once; a list for you never is', () => {
  const store = new Store(':memory:');
  observe(store, UNCLEAR);
  pollOnce(store, NOW);
  expect(store.listTasks().map((t) => t.confidence)).toEqual([MAYBE_CONFIDENCE, MAYBE_CONFIDENCE, MAYBE_CONFIDENCE]);
  const other = new Store(':memory:');
  observe(other, 'Claude responded: x\nOn your side:\n1. Add the redirect URL in the Supabase dashboard\n2. Run the smoke test');
  pollOnce(other, NOW);
  expect(other.listTasks().every((t) => t.confidence > MAYBE_CONFIDENCE)).toBe(true);
  store.close();
  other.close();
});

test("plan-like lists are Claude's: first-person steps, or most steps working on code with nothing only you can do", () => {
  expect(planActor(['Add a `retry` option to the fetch helper', 'Write tests for parseEmails()', 'Update the schema migration'])).toBe('assistant');
  expect(planActor(["I'll wire the new store into the panel", "Then I'll run the tests"])).toBe('assistant');
  expect(planActor(['Refactor src/auth.ts into two modules', 'Rename the `UserStore` class', 'Run the tests'])).toBe('assistant');
  // Something only you can do keeps it open for the model.
  expect(planActor(['Add the redirect URL in the Supabase dashboard', 'Write tests for the callback handler'])).toBeNull();
  expect(planActor(['Fix the failing test', 'Ask Noa for the API key'])).toBeNull();
  expect(planActor(['Rotate the API key', 'Update the docs'])).toBeNull();
  expect(planActor(['Add parent tasks to the schema', 'Run the tests', 'Update the docs'])).toBeNull(); // one code step of three
  expect(stepLeaning('Sign in to the Vercel dashboard')).toBe('you');
  expect(stepLeaning('Add a test for the panel component')).toBe('assistant');
  expect(stepLeaning('Restart the app')).toBeNull();

  const text = 'Claude responded: Here is the plan.\nNext steps:\n1. Add a `retry` option to the fetch helper\n2. Write tests for parseEmails()\n3. Update the schema migration';
  expect(extractChecklists(text, { includeAssistant: true })[0]!.actor).toBe('assistant');
  expect(extractChecklists(text)).toEqual([]);
});

test('a plan-like list makes no task and is never shown to the model', () => {
  const store = new Store(':memory:');
  const { judge: j, asked } = judge('user');
  observe(store, 'Claude responded: Here is the plan.\nNext steps:\n1. Add a `retry` option to the fetch helper\n2. Write tests for parseEmails()\n3. Update the schema migration');
  pollOnce(store, NOW, { judge: j });
  pollOnce(store, at(7), { judge: j });
  expect(store.listTasks()).toEqual([]);
  expect(asked).toEqual([]);
  store.close();
});

test('the reply around a list stops at the next message and is bounded', () => {
  const text = '⟦Message 1⟧\nYou said: go\n⟦Message 2⟧\nClaude responded: Done.\nNext:\n1. Run it\n2. Ship it\nBye\n⟦Message 3⟧\nYou said: thanks';
  expect(replyAround(text, 'Run it')).toBe('Done.\nNext:\n1. Run it\n2. Ship it\nBye');
  const long = `Claude responded: ${'word '.repeat(1000)}\n1. Run it\n2. Ship it`;
  expect(replyAround(long, 'Run it').length).toBe(2000);
  expect(replyAround(long, 'Run it')).toContain('1. Run it');
  expect(replyAround(text, 'missing')).toBe('');
});
