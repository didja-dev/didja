import { expect, test } from 'bun:test';
import { pollOnce } from '../src/engine.ts';
import { assemble } from '../src/extract.ts';
import { Store } from '../src/store.ts';
import { stableTitle, windowKeyFor } from '../src/window.ts';

// SCR-72: one window identity across capture and the engine. Every window here is made up.

test('the window key is the same rule as capture: same cases as DifferTests', () => {
  // Keep these in step with testWindowKeyMatchesTheEngine in app/DidjaTests/CaptureTests.swift.
  expect(windowKeyFor('b', 't', 'https://vercel.com/a/env?tab=1#x')).toBe('b|https://vercel.com/a/env');
  expect(windowKeyFor('b', '✳ Fix auth', null)).toBe('b|Fix auth');
  expect(windowKeyFor('b', '✻ Fix auth', null)).toBe('b|Fix auth');
  expect(windowKeyFor('b', '⠂ Fix auth', null)).toBe('b|Fix auth');
  expect(windowKeyFor('b', '(3) Inbox', null)).toBe('b|Inbox');
  expect(windowKeyFor('b', 'Inbox (12)', null)).toBe('b|Inbox');
  expect(windowKeyFor('b', 'Notes.txt — Edited', null)).toBe('b|Notes.txt');
  expect(windowKeyFor('b', 'Notes.txt - edited', null)).toBe('b|Notes.txt');
  expect(windowKeyFor('b', '• קבוצת הבית', null)).toBe('b|קבוצת הבית');
  expect(windowKeyFor('b', 'Q3 plan (draft)', null)).toBe('b|Q3 plan (draft)');
  expect(windowKeyFor('b', 'Inbox', '')).toBe('b|Inbox');
});

test('a title is kept whole when nothing in it comes and goes', () => {
  expect(stableTitle('Stripe webhooks')).toBe('Stripe webhooks');
  expect(stableTitle('2026 budget')).toBe('2026 budget');
});

const CLAUDE_CODE = (text: string[], title: string, ts: string) => ({
  ts, bundleId: 'com.mitchellh.ghostty', app: 'Ghostty', windowTitle: title, url: null, source: 'ax' as const, text: text.join('\n'),
});

test('a Claude Code list that arrives while the spinner in the title changes is one list', () => {
  const store = new Store(':memory:');
  store.insertObservation(CLAUDE_CODE([
    '> what do I need to do for the release?',
    '⏺ Three things on your side:',
    '  1. Add the redirect URL in Supabase auth settings',
  ], '✳ Release prep', '2026-11-10T10:00:00.000Z'));
  pollOnce(store, new Date('2026-11-10T10:00:10Z'));
  store.insertObservation(CLAUDE_CODE([
    '  2. Set STRIPE_WEBHOOK_SECRET in Vercel prod',
    '  3. Run the migration with supabase db push',
    '? for shortcuts',
  ], '✻ Release prep', '2026-11-10T10:00:20.000Z'));
  pollOnce(store, new Date('2026-11-10T10:00:30Z'));
  const tasks = store.listTasks().filter((t) => !t.isGroup);
  expect(tasks.map((t) => t.title)).toEqual([
    'Add the redirect URL in Supabase auth settings',
    'Set STRIPE_WEBHOOK_SECRET in Vercel prod',
    'Run the migration with supabase db push',
  ]);
  expect(new Set(tasks.map((t) => t.sourceRef)).size).toBe(1);
  // Its own window under the other spinner, saying a step again, is not that step done.
  store.insertObservation(CLAUDE_CODE([
    '⏺ Reminder: add the redirect URL in Supabase auth settings before you run the migration.',
  ], '✳ Release prep', '2026-11-10T10:01:00.000Z'));
  pollOnce(store, new Date('2026-11-10T10:01:10Z'));
  expect(store.listTasks().filter((t) => !t.isGroup).every((t) => t.status === 'open')).toBe(true);
  store.close();
});

test('two pages with the same title and different addresses are two windows', () => {
  const store = new Store(':memory:');
  const page = (url: string, text: string, ts: string) => store.insertObservation({
    ts, bundleId: 'com.google.Chrome', app: 'Google Chrome', windowTitle: 'Inbox', url, source: 'ax', text,
  });
  page('https://mail.example.com/inbox?folder=a', 'first page line', '2026-11-10T10:00:00.000Z');
  page('https://tracker.example.com/inbox', 'second page line', '2026-11-10T10:00:05.000Z');
  page('https://mail.example.com/inbox?folder=b', 'first page, later', '2026-11-10T10:00:10.000Z');
  const since = '2026-11-10T09:00:00.000Z';
  const mail = store.windowObservations({ bundleId: 'com.google.Chrome', windowTitle: 'Inbox', windowKey: 'com.google.Chrome|https://mail.example.com/inbox' }, since);
  expect(mail.map((o) => o.text)).toEqual(['first page line', 'first page, later']);
  const tracker = store.windowObservations({ bundleId: 'com.google.Chrome', windowTitle: 'Inbox', windowKey: 'com.google.Chrome|https://tracker.example.com/inbox' }, since);
  expect(tracker.map((o) => o.text)).toEqual(['second page line']);
  store.close();
});

test('a row from before the window key is grouped by app and exact title, apart from keyed rows', () => {
  const store = new Store(':memory:');
  store.insertObservation({ ts: '2026-11-10T10:00:00.000Z', bundleId: 'b', app: 'A', windowTitle: 'T', url: null, source: 'ax', text: 'keyed', windowKey: 'b|T' });
  store.insertObservation({ ts: '2026-11-10T10:00:01.000Z', bundleId: 'b', app: 'A', windowTitle: 'T', url: null, source: 'ax', text: 'old', windowKey: '' });
  const old = store.observationsAfter(0).find((o) => o.text === 'old')!;
  expect(old.windowKey).toBeUndefined();
  expect(store.windowObservations(old, '2026-11-10T09:00:00.000Z').map((o) => o.text)).toEqual(['old']);
  store.close();
});

test('a line caught while streaming is kept once, as it ended', () => {
  expect(assemble([
    '⟦Currently streaming message⟧\nOn your side:\n1. Set the key in Ver',
    '⟦Currently streaming message⟧\n1. Set the key in Vercel prod\n2. Run the mig',
    'Capturing · 3 observations',
    '⟦Currently streaming message⟧\n2. Run the migration',
  ]).split('\n')).toEqual([
    'Capturing · 3 observations',
    '⟦Currently streaming message⟧', 'On your side:', '1. Set the key in Vercel prod', '2. Run the migration',
  ]);
});

test('a line is only folded into the one its batch starts with; other repeats and earlier lines stay', () => {
  // "Done" in the middle of a batch is not a streaming line, and two emails can share a section.
  expect(assemble(['⟦Open email⟧\nFrom: Sam\nDone', '⟦Open email⟧\nFrom: Noa\nDone with the slides']).split('\n'))
    .toEqual(['⟦Open email⟧', 'From: Sam', 'Done', 'From: Noa', 'Done with the slides']);
  // A terminal command typed again is a new line.
  expect(assemble(['$ bun test\n 3 pass', '$ bun test']).split('\n')).toEqual(['$ bun test', ' 3 pass', '$ bun test']);
});
