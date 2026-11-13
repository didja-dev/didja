/** SCR-75: how long each task event takes, timed from the screen that showed it. Made-up content only. */
import { expect, test } from 'bun:test';
import { chargedOptions, MODEL_COST_MS, runScenario, totals } from '../bench/run.ts';
import type { Scenario } from '../bench/run.ts';
import { addManualTask, pollOnce } from '../src/engine.ts';
import type { Judge } from '../src/engine.ts';
import { formatQuality, percentiles, qualityReport, seconds, speedKind, speedRows } from '../src/quality.ts';
import type { Timing } from '../src/store.ts';
import { Store } from '../src/store.ts';

const T0 = new Date('2026-11-10T10:00:00.000Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

/** A store whose clock inside a pass moves only when told to, recording since before T0. */
function fresh(): { store: Store; spend: (ms: number) => void } {
  const store = new Store(':memory:');
  store.setMeta('outcomes_since', '2026-11-01T00:00:00.000Z');
  store.setMeta('timings_since', '2026-11-01T00:00:00.000Z');
  let spent = 0;
  store.clock = () => spent;
  return { store, spend: (ms) => { spent += ms; } };
}

const claude = (store: Store, ts: Date, text: string) => store.insertObservation({
  ts: ts.toISOString(), bundleId: 'com.anthropic.claudefordesktop', app: 'Claude', windowTitle: 'Stripe webhooks', url: null, source: 'ax', text });
const terminal = (store: Store, ts: Date) => store.insertObservation({
  ts: ts.toISOString(), bundleId: 'com.apple.Terminal', app: 'Terminal', windowTitle: 'zsh', url: null, source: 'ax',
  text: 'sam@mac acme-web % supabase db push\nApplying migration 20261110_webhooks.sql...\nFinished supabase db push.\nsam@mac acme-web % ' });
const LIST = 'Claude responded: Before this works in prod:\nBefore this works in prod:\n1. Set STRIPE_WEBHOOK_SECRET in Vercel prod\n2. Run the migration with `supabase db push`';

test('a new task is timed from the screen that showed it, to the pass, to when it was written', () => {
  const { store } = fresh();
  claude(store, T0, LIST);
  pollOnce(store, at(2));
  const timings = store.timingsSince('');
  // One per step, none for the checklist around them.
  expect(timings.map((t) => [t.event, t.path, t.kind, t.seenAt, t.engineAt, t.shownAt])).toEqual([
    ['task', 'fast', 'claude-desktop', T0.toISOString(), at(2).toISOString(), at(2).toISOString()],
    ['task', 'fast', 'claude-desktop', T0.toISOString(), at(2).toISOString(), at(2).toISOString()],
  ]);
  // Seen again in a later pass: not timed again.
  claude(store, at(5), LIST);
  pollOnce(store, at(6));
  expect(store.timingsSince('').length).toBe(2);
  store.close();
});

test('a sure tick is timed from the screen that showed it done', () => {
  const { store } = fresh();
  claude(store, T0, LIST);
  pollOnce(store, at(1));
  terminal(store, at(60));
  pollOnce(store, at(63));
  const tick = store.timingsSince('').find((t) => t.event === 'tick')!;
  expect(tick).toMatchObject({ path: 'fast', seenAt: at(60).toISOString(), engineAt: at(63).toISOString(), shownAt: at(63).toISOString() });
  expect(speedKind(tick)).toBe('sure-tick');
  store.close();
});

test('an unclear list is timed when it is shown as checking, not when the model has judged it (SCR-78)', () => {
  const { store, spend } = fresh();
  const judge: Judge = () => { spend(1500); return { audience: 'user', model: 'test-model' }; };
  claude(store, T0, 'Claude responded: Almost there.\nNext steps:\n1. Add the redirect URL in the Supabase dashboard\n2. Run the smoke test\nThat should be it.');
  pollOnce(store, at(1), { judge });
  pollOnce(store, at(8), { judge });
  const timings = store.timingsSince('');
  expect(timings.length).toBe(2);
  for (const t of timings) expect(t).toMatchObject({ event: 'task', path: 'fast', seenAt: T0.toISOString(), shownAt: at(1).toISOString() });
  store.close();
});

test('time spent on a model inside the pass counts toward when it was shown', () => {
  const { store, spend } = fresh();
  store.pass = { at: at(8), started: store.clock(), seen: null, path: 'model' };
  spend(1500);
  store.recordTiming(1, 'task', 'model', T0.toISOString());
  store.pass = null;
  const [t] = store.timingsSince('');
  expect(t).toMatchObject({ path: 'model', seenAt: T0.toISOString(), engineAt: at(8).toISOString(), shownAt: new Date(at(8).getTime() + 1500).toISOString() });
  expect(speedKind(t!)).toBe('model');
  store.close();
});

test('nothing is timed outside an engine pass: your own tasks and ticks', () => {
  const { store } = fresh();
  const id = addManualTask(store, 'Send Noa the deck', T0)!;
  store.changeByYou(id, 'done', at(5));
  expect(store.timingsSince('')).toEqual([]);
  store.close();
});

test('speed rows: median and 90th percentile per kind, overall and per source, against the targets', () => {
  expect(percentiles([])).toEqual({ n: 0, p50: null, p90: null });
  expect(percentiles([5, 1, 4, 2, 3, 6, 7, 8, 9, 10])).toEqual({ n: 10, p50: 5, p90: 9 });
  const timing = (event: Timing['event'], path: Timing['path'], kind: string, seen: number, engine: number, shown: number): Timing => ({
    taskId: 1, event, path, kind, seenAt: at(seen).toISOString(), engineAt: at(engine).toISOString(), shownAt: at(shown).toISOString() });
  const rows = speedRows([
    timing('task', 'fast', 'claude-desktop', 0, 2, 2),
    timing('task', 'fast', 'email', 0, 4, 5),
    timing('tick', 'fast', 'claude-desktop', 0, 1, 1),
    timing('asked', 'model', 'claude-desktop', 0, 3, 9),
    timing('task', 'wait', 'chat', 0, 600, 600),
  ]);
  const all = rows.filter((r) => r.source === 'All sources');
  expect(all.map((r) => r.what)).toEqual(['new-task', 'sure-tick', 'model', 'chat-wait']);
  expect(all[0]).toMatchObject({ targetMs: 3000, total: { n: 2, p50: 2000, p90: 5000 }, waiting: { p90: 4000 }, working: { p90: 1000 } });
  expect(all[2]).toMatchObject({ targetMs: 10_000, total: { p90: 9000 }, working: { p90: 6000 } });
  expect(all[3]!.targetMs).toBeNull();
  expect(rows.filter((r) => r.source === 'Email').map((r) => r.what)).toEqual(['new-task']);
  expect(seconds(2500)).toBe('2.5 s');
  expect(seconds(600_000)).toBe('10 min');
});

test('didja quality prints the speeds, numbers only', () => {
  const { store } = fresh();
  claude(store, T0, LIST);
  pollOnce(store, at(2));
  terminal(store, at(60));
  pollOnce(store, at(64));
  const r = qualityReport(store, 7, at(120));
  expect(r.speed.rows.find((x) => x.source === 'All sources' && x.what === 'sure-tick')!.total).toEqual({ n: 1, p50: 4000, p90: 4000 });
  const text = formatQuality(r);
  expect(text).toContain('How fast:');
  expect(text).toContain('Sure tick: 1, 4.0 s / 4.0 s, target 3.0 s (over)');
  expect(text).not.toContain('STRIPE');
  expect(text).not.toContain('supabase');
  store.close();
});

test('the benchmark charges each model call its cost on the fake clock', () => {
  let spent = 0;
  const judge: Judge = () => ({ audience: 'user', model: 'm' });
  const apple = chargedOptions({ judge }, 'apple', (ms) => { spent += ms; });
  apple.judge!({ leadIn: '', steps: [] });
  expect(spent).toBe(MODEL_COST_MS.apple);
  const local = chargedOptions({ judge, titler: () => null }, 'ollama:qwen', (ms) => { spent += ms; });
  local.judge!({ leadIn: '', steps: [] });
  local.titler!({ leadIn: '', steps: [] });
  expect(spent).toBe(MODEL_COST_MS.apple + MODEL_COST_MS.ollama + MODEL_COST_MS.apple);
  expect(chargedOptions({ judge }, 'none', () => { throw new Error('charged'); }).judge).toBe(judge);
});

test('the benchmark times its tasks and ticks, and flags a path with no model that takes over 3 s', () => {
  const s: Scenario = {
    id: 'speed-check', family: 'claude-app', about: 'A command handed over by Claude and run in Terminal at minute 3.', start: '2026-11-11T09:00',
    steps: [
      { at: 0, app: 'Claude', bundle: 'com.anthropic.claudefordesktop', title: 'Check', text: ['⟦Message 2⟧', 'Claude responded: Run this:', 'Check it:', '`curl ipinfo.io`'] },
      { at: 3, app: 'Terminal', bundle: 'com.apple.Terminal', title: 'zsh', text: ['me@mac ~ % curl ipinfo.io', '{ "ip": "203.0.113.7" }', 'me@mac ~ % '] },
    ],
    expect: { tasks: [{ words: ['curl ipinfo.io'], done: { at: 3, where: 'Terminal' } }], none: [] },
  };
  const r = runScenario(s);
  expect(r.speeds.map((x) => x.what).sort()).toEqual(['new-task', 'sure-tick']);
  expect(r.speeds.every((x) => x.ms === 0)).toBe(true);
  const t = totals([r], [s]);
  expect(t.slow).toEqual([]);
  const slow = totals([{ ...r, speeds: [{ what: 'sure-tick', ms: 3001 }, { what: 'model', ms: 9000 }] }], [s]);
  expect(slow.slow).toEqual([{ id: 'speed-check', what: 'sure-tick', ms: 3001 }]);
});
