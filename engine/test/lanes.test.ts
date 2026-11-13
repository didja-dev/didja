/** SCR-76: the engine is woken by new screens, and models run in their own lane. Made-up content only. */
import { expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAYBE_CONFIDENCE, pollOnce, runLoop, Waker } from '../src/engine.ts';
import type { Judge, PollOptions } from '../src/engine.ts';
import { startModelLane, wakeOnInput } from '../src/lanes.ts';
import { CHECKING_CONFIDENCE, Store } from '../src/store.ts';

const claude = (store: Store, text: string, ts = new Date()) => store.insertObservation({
  ts: ts.toISOString(), bundleId: 'com.anthropic.claudefordesktop', app: 'Claude', windowTitle: 'Launch', url: null, source: 'ax', text });
const terminal = (store: Store, ts = new Date()) => store.insertObservation({
  ts: ts.toISOString(), bundleId: 'com.apple.Terminal', app: 'Terminal', windowTitle: 'zsh', url: null, source: 'ax',
  text: 'sam@mac acme-web % supabase db push\nApplying migration 20261110_webhooks.sql...\nFinished supabase db push.\nsam@mac acme-web % ' });
const CLEAR = 'Claude responded: Nearly done.\nOn your side:\n1. Set STRIPE_WEBHOOK_SECRET in Vercel prod\n2. Run the migration with `supabase db push`';
const UNCLEAR = 'Claude responded: Almost there.\nNext steps:\n1. Add the redirect URL in the Supabase dashboard\n2. Run the smoke test\n3. Tell Noa it is live\nThat should be it.';
const MAIL = { bundleId: 'com.microsoft.Outlook', app: 'Microsoft Outlook', windowTitle: 'Inbox • me@example.com', url: null, source: 'ax' as const };

/** Every model job, recorded in the order asked; none of them answers unless told to. */
function recorder(answers: { judge?: 'user' | 'assistant' } = {}) {
  const calls: string[] = [];
  const opts: PollOptions = {
    judge: (list) => { calls.push(`judge:${list.steps[0]}`); return answers.judge ? { audience: answers.judge, model: 'test' } : null; },
    titler: () => { calls.push('title'); return null; },
    looker: (input) => { calls.push(`look:${input.task}`); return 'unsure'; },
    criteria: (q) => { calls.push(`criteria:${q.task}`); return null; },
    mailReader: () => { calls.push('mail'); return null; },
    chatReader: () => { calls.push('chat'); return null; },
    replyJudge: () => { calls.push('reply'); return null; },
  };
  return { calls, opts };
}

test('the fast lane asks no model, leaves mail to the full pass, and holds an unclear list for the model lane', () => {
  const store = new Store(':memory:');
  const { calls, opts } = recorder({ judge: 'user' });
  const now = new Date('2026-11-11T12:00:00Z');
  claude(store, CLEAR, now);
  claude(store, UNCLEAR, now);
  store.insertObservation({ ...MAIL, ts: now.toISOString(),
    text: 'Inbox\nSent Items\n⟦Email⟧\nSubject: Q4 budget\nFrom: Dana Levi, dana@acme.com\nDate: Today at 11:58\nTo: me@example.com\nHi, can you approve the Q4 budget by Friday?' });
  pollOnce(store, now, { ...opts, lane: 'fast', judging: true });
  expect(calls).toEqual([]);
  // The clear list is made at once; the unclear one is shown as "checking…" for the judge, not kept as "maybe".
  const steps = store.listTasks().filter((t) => !t.isGroup);
  expect(steps.filter((t) => t.confidence > MAYBE_CONFIDENCE).map((t) => t.title)).toEqual(['Set STRIPE_WEBHOOK_SECRET in Vercel prod', 'Run the migration with `supabase db push`']);
  expect(steps.filter((t) => t.confidence === CHECKING_CONFIDENCE).length).toBe(3);
  expect(store.listTasks({ all: true }).some((t) => t.confidence === MAYBE_CONFIDENCE)).toBe(false);
  expect(store.settledPendingJudgements(new Date(now.getTime() + 60_000), 10).length).toBe(1);
  // The full pass still reads everything from its own place, mail included.
  pollOnce(store, new Date(now.getTime() + 7000), opts);
  expect(calls).toContain('mail');
  expect(calls.some((c) => c.startsWith('judge:'))).toBe(true);
  store.close();
});

test('the fast lane starts where the full pass is, not from the oldest screen', () => {
  const store = new Store(':memory:');
  const now = new Date('2026-11-11T12:00:00Z');
  claude(store, CLEAR, now);
  pollOnce(store, now);
  const [first] = store.listTasks();
  store.changeByYou(first!.id, 'dismissed', now);
  pollOnce(store, new Date(now.getTime() + 1000), { lane: 'fast' });
  expect(store.getTask(first!.id)!.status).toBe('dismissed');
  expect(store.getMeta('fast_observation_id')).toBe(store.getMeta('last_observation_id'));
  store.close();
});

test('a sure tick in the fast lane is the same tick as in the full pass, made once', () => {
  const store = new Store(':memory:');
  const now = new Date('2026-11-11T12:00:00Z');
  claude(store, CLEAR, now);
  pollOnce(store, now, { lane: 'fast' });
  terminal(store, new Date(now.getTime() + 60_000));
  expect(pollOnce(store, new Date(now.getTime() + 61_000), { lane: 'fast' }).completed).toBe(1);
  const push = store.listTasks({ all: true }).find((t) => t.title.includes('supabase db push'))!;
  expect(push.status).toBe('done');
  // The full pass reads the same screens later: nothing more to tick, nothing counted twice.
  expect(pollOnce(store, new Date(now.getTime() + 62_000)).completed).toBe(0);
  expect(store.timingsSince('').filter((t) => t.event === 'tick').length).toBe(1);
  store.close();
});

test('model jobs go in order: a list verdict, then done criteria, then "looks done?", then titles', () => {
  const store = new Store(':memory:');
  const t0 = new Date('2026-11-11T12:00:00Z');
  const at = (s: number) => new Date(t0.getTime() + s * 1000);
  const quiet = recorder();
  claude(store, 'Claude responded: So, on your side before we launch:\nSo, on your side before we launch:\n1. Add the redirect URL in the Supabase dashboard\n2. Turn on email confirmations in Supabase', t0);
  claude(store, UNCLEAR.replace('Add the redirect URL in the Supabase dashboard', 'Rotate the Stripe key in the Stripe dashboard'), t0);
  pollOnce(store, t0, quiet.opts);
  const { calls, opts } = recorder({ judge: 'user' });
  store.insertObservation({ ts: at(5).toISOString(), bundleId: 'com.google.Chrome', app: 'Google Chrome', windowTitle: 'Authentication – Supabase',
    url: 'https://supabase.com/dashboard/project/acme/auth/url-configuration', source: 'ax',
    text: 'URL Configuration\nRedirect URLs\nhttps://acme.example.com/auth/callback\nSave' });
  pollOnce(store, at(8), opts);
  const first = (prefix: string) => calls.findIndex((c) => c.startsWith(prefix));
  expect(first('judge:')).toBeGreaterThanOrEqual(0);
  expect(first('criteria:')).toBeGreaterThan(first('judge:'));
  expect(first('look:')).toBeGreaterThan(first('criteria:'));
  expect(first('title')).toBeGreaterThan(first('look:'));
  // A list judged in this pass is not shown this pass's screens: they were read before it was a task.
  expect(calls).not.toContain('look:Rotate the Stripe key in the Stripe dashboard');
  store.close();
});

test('a stale job is dropped: a queued list already judged elsewhere, a dismissed task awaiting criteria', () => {
  const store = new Store(':memory:');
  const t0 = new Date('2026-11-11T12:00:00Z');
  claude(store, UNCLEAR, t0);
  pollOnce(store, t0, { lane: 'fast', judging: true });
  const [pending] = store.settledPendingJudgements(new Date(t0.getTime() + 60_000), 10);
  store.saveJudgement(pending!.key, 'user', 'test', t0);
  const { calls, opts } = recorder({ judge: 'user' });
  claude(store, CLEAR, t0);
  pollOnce(store, t0, { lane: 'fast' });
  for (const t of store.listTasks()) if (t.title.startsWith('Set STRIPE')) store.changeByYou(t.id, 'dismissed', t0);
  pollOnce(store, new Date(t0.getTime() + 7000), opts);
  expect(calls.filter((c) => c.startsWith('judge:'))).toEqual([]);
  expect(store.settledPendingJudgements(new Date(t0.getTime() + 60_000), 10)).toEqual([]);
  expect(calls).not.toContain('criteria:Set STRIPE_WEBHOOK_SECRET in Vercel prod');
  store.close();
});

test('a wake runs a pass within 300 ms; without one the loop waits for its heartbeat', async () => {
  const store = new Store(':memory:');
  const waker = new Waker();
  const controller = new AbortController();
  let passes = 0;
  const loop = runLoop(store, () => {}, { intervalSeconds: 60, signal: controller.signal, waker, afterPass: () => { passes++; } });
  await Bun.sleep(30);
  expect(passes).toBe(1);
  claude(store, CLEAR);
  await Bun.sleep(100);
  expect(store.listTasks()).toEqual([]);
  const woken = performance.now();
  waker.wake();
  while (store.listTasks().length === 0 && performance.now() - woken < 1000) await Bun.sleep(5);
  expect(performance.now() - woken).toBeLessThan(300);
  expect(store.listTasks().length).toBe(2);
  controller.abort();
  await loop;
  store.close();
});

test('a wake during a pass is kept: the loop goes round again at once', async () => {
  const waker = new Waker();
  waker.wake();
  expect(await waker.sleep(60_000)).toBe(true);
  const started = performance.now();
  expect(await waker.sleep(20)).toBe(false);
  expect(performance.now() - started).toBeGreaterThanOrEqual(15);
});

test('each line on standard input is a wake', async () => {
  const waker = new Waker();
  let ended = false;
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  wakeOnInput(readable, waker, () => { ended = true; });
  const writer = writable.getWriter();
  await writer.write(new TextEncoder().encode('\n'));
  expect(await waker.sleep(1000)).toBe(true);
  await writer.close();
  await Bun.sleep(10);
  expect(ended).toBe(true);
});

test('a sure tick happens in the fast lane while the model lane is still waiting on a slow model', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'didja-lanes-'));
  const db = join(dir, 'didja.db');
  const mark = join(dir, 'judge');
  // A made-up model: the list judge takes three seconds; every other job finds no model.
  const fake = join(dir, 'fake-model');
  writeFileSync(fake, `#!/bin/sh\ncat > /dev/null\nif [ "$1" = "--judge" ]; then touch "${mark}.started"; sleep 3; touch "${mark}.done"; echo '{"available":true,"audience":"user","model":"fake"}'; else echo '{"available":false}'; fi\n`);
  chmodSync(fake, 0o755);
  const store = new Store(db);
  const old = new Date(Date.now() - 10_000);
  claude(store, UNCLEAR, old);
  claude(store, CLEAR, old);
  pollOnce(store, old, { lane: 'fast', judging: true });
  const controller = new AbortController();
  // The lane reads its database and its model from the environment it is started with.
  const saved = { db: process.env.DIDJA_DB, judge: process.env.DIDJA_JUDGE, server: process.env.DIDJA_JUDGE_SERVER };
  process.env.DIDJA_DB = db;
  process.env.DIDJA_JUDGE = fake;
  // The made-up model answers one question per process, like the one-shot flags.
  process.env.DIDJA_JUDGE_SERVER = '0';
  const lane = startModelLane(controller.signal, () => {}, [process.execPath, join(import.meta.dir, '../src/cli.ts'), 'lane']);
  const restore = (key: 'DIDJA_DB' | 'DIDJA_JUDGE' | 'DIDJA_JUDGE_SERVER', value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  restore('DIDJA_DB', saved.db);
  restore('DIDJA_JUDGE', saved.judge);
  restore('DIDJA_JUDGE_SERVER', saved.server);
  try {
    expect(lane.running()).toBe(true);
    const deadline = Date.now() + 8000;
    while (!existsSync(`${mark}.started`) && Date.now() < deadline) await Bun.sleep(25);
    expect(existsSync(`${mark}.started`)).toBe(true);
    // The model lane is busy for three seconds. A command run now is ticked by the fast lane at once.
    terminal(store);
    const before = performance.now();
    pollOnce(store, new Date(), { lane: 'fast', judging: true });
    expect(performance.now() - before).toBeLessThan(300);
    expect(store.listTasks({ all: true }).find((t) => t.title.includes('supabase db push'))!.status).toBe('done');
    expect(existsSync(`${mark}.done`)).toBe(false);
    // Then the verdict lands and the model lane makes the list.
    while (!store.listTasks().some((t) => t.title.startsWith('Add the redirect URL')) && Date.now() < deadline + 4000) await Bun.sleep(50);
    expect(store.listTasks().some((t) => t.title.startsWith('Add the redirect URL'))).toBe(true);
  } finally {
    controller.abort();
    await Bun.sleep(50);
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 20_000);
