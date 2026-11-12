import { expect, test } from 'bun:test';
import { contextLines } from '../src/context.ts';
import { pollOnce } from '../src/engine.ts';
import { Store } from '../src/store.ts';

const CHAT = `⟦Chat message: Sarah (direct) — from Sarah — 10:02⟧
Hi! Quick one before the weekend.
The client signed off on the draft.
Don't forget to email Mike the contract
He needs it before Monday's call.
Thanks a lot
See you`;

test('the task line comes with up to three lines on each side, marked', () => {
  const lines = contextLines(CHAT, 'Email Mike the contract')!;
  expect(lines.map((l) => l.text)).toEqual([
    'Hi! Quick one before the weekend.',
    'The client signed off on the draft.',
    "Don't forget to email Mike the contract",
    "He needs it before Monday's call.",
    'Thanks a lot',
    'See you',
  ]);
  expect(lines.filter((l) => l.task).map((l) => l.text)).toEqual(["Don't forget to email Mike the contract"]);
});

test('the capture markers are not shown as screen text', () => {
  expect(contextLines(CHAT, 'Email Mike the contract')!.some((l) => l.text.includes('⟦'))).toBe(false);
});

test('a shortened title still finds its line when most of its words are there', () => {
  const lines = contextLines('Intro\nPlease rotate the old API key for the staging server today\nThanks', 'Rotate old API key staging')!;
  expect(lines.find((l) => l.task)!.text).toBe('Please rotate the old API key for the staging server today');
});

test('nothing is kept when the task is not found: never a guessed place', () => {
  expect(contextLines(CHAT, 'Book the flights to Lisbon')).toBeNull();
  expect(contextLines(CHAT, 'ok')).toBeNull();
});

test('Hebrew lines are matched too', () => {
  const lines = contextLines('שלום\nתשלח לי את החוזה עד מחר\nתודה', 'תשלח לי את החוזה')!;
  expect(lines.find((l) => l.task)!.text).toBe('תשלח לי את החוזה עד מחר');
});

test('long lines are cut', () => {
  const lines = contextLines(`Do the thing now ${'x'.repeat(400)}`, 'Do the thing now')!;
  expect(lines[0]!.text.length).toBe(240);
});

const CHECKLIST = `Claude responded: Before this works in prod:
Before this works in prod:
1. Set STRIPE_WEBHOOK_SECRET in Vercel prod
2. Run the migration with supabase db push
3. Add the redirect URL in Supabase auth settings`;

test('a captured task keeps its context while open, and loses it when done', () => {
  const store = new Store(':memory:');
  store.insertObservation({
    ts: '2026-11-10T10:00:00.000Z', bundleId: 'com.anthropic.claudefordesktop', app: 'Claude',
    windowTitle: 'Stripe webhooks', url: null, source: 'ax', text: CHECKLIST,
  });
  pollOnce(store, new Date('2026-11-10T10:05:00Z'));
  const step = store.listTasks().find((t) => t.title.startsWith('Run the migration'))!;
  const context = store.context(step.id)!;
  expect(context.app).toBe('Claude');
  expect(context.window).toBe('Stripe webhooks');
  expect(context.lines.find((l) => l.task)!.text).toBe('2. Run the migration with supabase db push');
  // A checklist shows its first step's.
  expect(store.context(step.parentId!)!.lines.find((l) => l.task)!.text).toContain('STRIPE_WEBHOOK_SECRET');
  store.setStatus(step.id, 'done');
  pollOnce(store, new Date('2026-11-10T10:06:00Z'));
  expect(store.context(step.id)).toBeNull();
  store.close();
});
