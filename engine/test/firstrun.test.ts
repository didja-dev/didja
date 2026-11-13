/** SCR-89: the first run's status, the "read but no tasks" nudge, and AI tools Didja doesn't know yet. Made-up windows. */
import { expect, test } from 'bun:test';
import { doctorReport, formatDoctor } from '../src/doctor.ts';
import { pollOnce } from '../src/engine.ts';
import { aiLike, FIRST_RUN_KEY, firstRunStatus, NUDGE_DISMISSED_KEY } from '../src/firstrun.ts';
import type { FirstRunStatus } from '../src/firstrun.ts';
import { Store } from '../src/store.ts';

const T0 = new Date('2026-11-10T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);

function store(): Store {
  const s = new Store(':memory:');
  s.setMeta('capture_status', 'Capturing (since 2026-11-10T09:00:00Z, app at /Applications/Didja.app)');
  return s;
}

/** A ChatGPT reply with no steps in it, read at `sec`. */
function chatgptNoSteps(s: Store, sec: number, i: number): void {
  s.insertObservation({
    ts: at(sec).toISOString(), bundleId: 'com.openai.chat', app: 'ChatGPT', windowTitle: `Chat ${i}`, url: null, source: 'ax',
    text: `You said:\nHow does caching work, part ${i}?\nChatGPT said:\nCaching keeps a copy close by, so the next read is quick. Layer ${i} explains how the pieces fit together.`,
  });
  pollOnce(s, at(sec + 1));
}

const status = (s: Store): FirstRunStatus => JSON.parse(s.getMeta(FIRST_RUN_KEY)!) as FirstRunStatus;

test('read but no task: no nudge before ten minutes, then one naming the AI tool and the readings', () => {
  const s = store();
  for (let i = 0; i < 6; i++) chatgptNoSteps(s, i * 60, i);
  expect(status(s).watching).toEqual(['ChatGPT']);
  expect(status(s).assistantsRead).toEqual([{ name: 'ChatGPT', reads: 6 }]);
  expect(status(s).nudge).toBeNull();
  expect(firstRunStatus(s, at(9 * 60)).nudge).toBeNull();
  expect(firstRunStatus(s, at(10 * 60 + 1)).nudge).toEqual({ name: 'ChatGPT', reads: 6 });
});

test('a few glances are not a try: no nudge under five readings', () => {
  const s = store();
  for (let i = 0; i < 3; i++) chatgptNoSteps(s, i * 60, i);
  expect(firstRunStatus(s, at(30 * 60)).nudge).toBeNull();
});

test('no nudge once a task has come from an AI tool, even after it is done or gone', () => {
  const s = store();
  for (let i = 0; i < 6; i++) chatgptNoSteps(s, i * 60, i);
  s.insertObservation({
    ts: at(400).toISOString(), bundleId: 'com.anthropic.claudefordesktop', app: 'Claude', windowTitle: 'Deploy', url: null, source: 'ax',
    text: 'Claude responded: Here is what you need to do:\n1. Set STRIPE_WEBHOOK_SECRET in Vercel prod\n2. Run the migration with `supabase db push`\n3. Add the redirect URL in Supabase',
  });
  pollOnce(s, at(401));
  const first = status(s).firstList;
  expect(first?.from).toBe('Claude');
  expect(first?.count).toBeGreaterThanOrEqual(2);
  for (const t of s.listTasks()) s.changeByYou(t.id, 'dismissed', at(500));
  expect(s.listTasks()).toEqual([]);
  expect(firstRunStatus(s, at(30 * 60)).nudge).toBeNull();
});

test('closing the nudge keeps it closed', () => {
  const s = store();
  for (let i = 0; i < 6; i++) chatgptNoSteps(s, i * 60, i);
  expect(firstRunStatus(s, at(15 * 60)).nudge).not.toBeNull();
  s.setMeta(NUDGE_DISMISSED_KEY, at(15 * 60).toISOString());
  expect(firstRunStatus(s, at(20 * 60)).nudge).toBeNull();
});

test('no AI tool read, no nudge: other apps never count', () => {
  const s = store();
  for (let i = 0; i < 8; i++) {
    s.insertObservation({
      ts: at(i * 60).toISOString(), bundleId: 'com.example.notes', app: 'Notes', windowTitle: 'Groceries', url: null, source: 'ax',
      text: `Milk, eggs and bread for week ${i}.`,
    });
    pollOnce(s, at(i * 60 + 1));
  }
  expect(status(s).watching).toEqual(['Notes']);
  expect(status(s).assistantsRead).toEqual([]);
  expect(firstRunStatus(s, at(60 * 60)).nudge).toBeNull();
});

test('the status holds names and counts, never what a window said or its title', () => {
  const s = store();
  for (let i = 0; i < 6; i++) chatgptNoSteps(s, i * 60, i);
  const raw = JSON.stringify(firstRunStatus(s, at(15 * 60)));
  for (const word of ['caching', 'Caching', 'Chat 3', 'Layer', 'pieces']) expect(raw).not.toContain(word);
});

test('looks like an AI tool: a chat or ai site, an approval prompt or a context footer in a terminal', () => {
  expect(aiLike({ bundleId: 'com.google.Chrome', url: 'https://chat.example.com/c/1' }, '')).toEqual({ sign: 'host', host: 'chat.example.com' });
  expect(aiLike({ bundleId: 'com.google.Chrome', url: 'https://acme.ai/app' }, '')).toEqual({ sign: 'host', host: 'acme.ai' });
  expect(aiLike({ bundleId: 'com.google.Chrome', url: 'https://example.com/chatter' }, 'Do you want to run this?')).toBeNull();
  expect(aiLike({ bundleId: 'com.apple.Terminal', url: null }, '$ newagent\n› Do you want to run `npm test`?\n  1. Yes')).toEqual({ sign: 'approval' });
  expect(aiLike({ bundleId: 'com.googlecode.iterm2', url: null }, 'newagent ready\n  42% context left')).toEqual({ sign: 'context-left' });
  // Plain shell output, or a document mentioning context, is not an agent.
  expect(aiLike({ bundleId: 'com.apple.Terminal', url: null }, '$ ls\nREADME.md\nsrc')).toBeNull();
  expect(aiLike({ bundleId: 'com.example.notes', url: null }, 'Do you want to run the meeting?')).toBeNull();
});

test('an unknown AI tool is a candidate in the troubleshooting report, with app, bundle id and sign only', () => {
  const s = store();
  s.insertObservation({
    ts: at(0).toISOString(), bundleId: 'com.apple.Terminal', app: 'Terminal', windowTitle: 'zsh — newagent', url: null, source: 'ax',
    text: '$ newagent\nI will deploy the Acme site.\n› Do you want to run `vercel deploy --prod`?\n  1. Yes\n  2. No',
  });
  pollOnce(s, at(1));
  const r = doctorReport(s, at(60));
  expect(r.candidates).toEqual([expect.objectContaining({ app: 'Terminal', bundleId: 'com.apple.Terminal', sign: 'approval', n: 1 })]);
  expect(r.findings.some((f) => f.startsWith("Terminal looks like an AI tool Didja doesn't know yet (it asked to run a command)") && f.includes('Report a Problem with This Window…'))).toBe(true);
  const all = JSON.stringify(r) + formatDoctor(r);
  for (const word of ['Acme', 'vercel deploy', 'newagent']) expect(all).not.toContain(word);
});

test('a known AI tool is never a candidate', () => {
  const s = store();
  s.insertObservation({
    ts: at(0).toISOString(), bundleId: 'com.google.Chrome', app: 'Google Chrome', windowTitle: 'ChatGPT', url: 'https://chatgpt.com/c/1', source: 'ax',
    text: 'Here is how caching works.',
  });
  pollOnce(s, at(1));
  expect(doctorReport(s, at(60)).candidates).toEqual([]);
});

test('the report names the AI tool it read, not only Claude', () => {
  const s = store();
  for (let i = 0; i < 3; i++) chatgptNoSteps(s, i * 10, i);
  const r = doctorReport(s, at(60));
  expect(r.findings).toContain('Didja read 3 screens from ChatGPT but saw no numbered list of steps for you. Try asking ChatGPT for a numbered checklist of what you need to do.');
  expect(formatDoctor(r)).toContain('  ChatGPT: read 3');
});
