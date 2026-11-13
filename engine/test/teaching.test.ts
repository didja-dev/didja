import { expect, test } from 'bun:test';
import { pollOnce } from '../src/engine.ts';
import type { ChatReader } from '../src/chat.ts';
import { doneAt } from '../src/missed.ts';
import { emailLessonKey, originSender } from '../src/email.ts';
import { Store } from '../src/store.ts';

// SCR-71: feedback that teaches, and dedupe and retract scoped to their own conversation. Made-up data.
const T0 = Date.parse('2026-11-10T10:00:00Z');
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();
const claude = (store: Store, title: string, text: string, minutes: number) => store.insertObservation({
  ts: at(minutes), bundleId: 'com.anthropic.claudefordesktop', app: 'Claude', windowTitle: title, url: null, source: 'ax', text });
const LIST = (lead: string) => `⟦Message 2⟧\nClaude responded: ok\n${lead}\n1. Restart the app from the menu bar\n2. Open the Settings window`;

test('a recurring step in a new conversation later is a new task, not the old done one', () => {
  const store = new Store(':memory:');
  claude(store, 'Monday fix', LIST('On your side:'), 0);
  pollOnce(store, new Date(at(0)));
  const first = store.listTasks().find((t) => t.title.startsWith('Restart'))!;
  store.setStatus(first.id, 'done', new Date(at(5)));
  // Two days on, another conversation asks for the same step.
  claude(store, 'Wednesday fix', LIST('On your side:'), 2 * 24 * 60);
  pollOnce(store, new Date(at(2 * 24 * 60)));
  const restarts = store.listTasks({ all: true }).filter((t) => t.title.startsWith('Restart'));
  expect(restarts.map((t) => [t.sourceRef, t.status])).toEqual([['Claude — Monday fix', 'done'], ['Claude — Wednesday fix', 'open']]);
  store.close();
});

test('the same conversation seen again, or one renamed within the hour, is still the same task', () => {
  const store = new Store(':memory:');
  claude(store, 'New chat', LIST('On your side:'), 0);
  pollOnce(store, new Date(at(0)));
  const first = store.listTasks().find((t) => t.title.startsWith('Restart'))!;
  store.setStatus(first.id, 'done', new Date(at(2)));
  claude(store, 'Fix the hotkey', LIST('On your side:'), 10); // Claude named the conversation
  claude(store, 'New chat', LIST('On your side:'), 4 * 24 * 60); // the old one scrolled back to days later
  pollOnce(store, new Date(at(4 * 24 * 60)));
  expect(store.listTasks({ all: true }).filter((t) => t.title.startsWith('Restart')).map((t) => t.status)).toEqual(['done']);
  store.close();
});

test("Claude's own plan in conversation A takes back A's task only, never the same words in B", () => {
  const store = new Store(':memory:');
  claude(store, 'Project B', LIST('On your side:'), 0);
  pollOnce(store, new Date(at(0)));
  claude(store, 'Project A', LIST("I'll do these next:"), 1);
  pollOnce(store, new Date(at(1)));
  expect(store.listTasks().filter((t) => t.title.startsWith('Restart')).map((t) => [t.sourceRef, t.status])).toEqual([['Claude — Project B', 'open']]);
  store.close();
});

test('"Not an Action" on an email is keyed on sender and base subject, read and written the same way', () => {
  expect(emailLessonKey('Dana Levi', 'Re: Re: Q3 numbers')).toBe(emailLessonKey('dana levi', 'Q3 numbers'));
  expect(emailLessonKey('Dana Levi', 'FW: RE: Q3 numbers')).toBe(emailLessonKey('Dana Levi', 'Q3 numbers'));
  expect(emailLessonKey('Dana Levi', 'Q3 numbers')).not.toBe(emailLessonKey('Sam Carter', 'Q3 numbers'));
  expect(originSender('From an email: Dana Levi — “Q3 numbers”')).toBe('Dana Levi');
  expect(originSender('From an email: forwarded by Sam Carter, written by Dana Levi — “Q3 numbers”')).toBe('Sam Carter');

  const store = new Store(':memory:');
  const { id } = store.upsertTask({ title: 'Send Dana the Q3 numbers', sourceKind: 'email', sourceRef: 'Microsoft Outlook', confidence: 1, position: null, ts: at(0), observationId: null, markers: [], criteria: null });
  store.addNote(id, 'origin', at(0), 'From an email: Dana Levi — “Re: Q3 numbers”');
  expect(store.notAnAction(id)).toBe(true);
  expect(store.isNotAnActionEmail('Dana Levi', 'Re: Re: Q3 numbers')).toBe(true);
  expect(store.isNotAnActionEmail('Dana Levi', 'Q3 numbers')).toBe(true);
  expect(store.isNotAnActionEmail('Sam Carter', 'Q3 numbers')).toBe(false); // another sender is not blocked
  store.close();
});

test('a lesson taught before SCR-71, by subject alone, still matches "Re: Re:" from anyone', () => {
  const store = new Store(':memory:');
  (store as unknown as { db: { run(sql: string): void } }).db.run("INSERT INTO lesson_notes (job, kind, key, example, created_at) VALUES ('emails', 'not-an-action', 'q3 numbers', 'x', '2026-11-10T10:00:00Z')");
  expect(store.isNotAnActionEmail('Sam Carter', 'Re: Re: Q3 numbers')).toBe(true);
  store.close();
});

test('chat corrections teach the chat job, which the chat model is shown; the list judge never sees them', () => {
  const store = new Store(':memory:');
  store.setMeta('my_name', 'Mike Rosen');
  const ask = '⟦Chat message: Noa Katz (direct) — from Noa Katz — Today at 9:05⟧\nCan you check the venue booking?';
  store.insertObservation({ ts: at(0), bundleId: 'net.whatsapp.WhatsApp', app: 'WhatsApp', windowTitle: 'Noa Katz', url: null, source: 'ax', text: ask });
  const asked: Parameters<ChatReader>[0][] = [];
  const read: ChatReader = (q) => { asked.push(q); return { asks: true, task: 'Check the venue booking' }; };
  const now = new Date(Date.parse('2026-11-10T09:30:00') + 0);
  pollOnce(store, now, { chatReader: read });
  pollOnce(store, new Date(now.getTime() + 15 * 60_000), { chatReader: read });
  const task = store.listTasks().find((t) => t.title === 'Check the venue booking');
  expect(task).toBeDefined();
  expect(store.notAnAction(task!.id)).toBe(true);
  expect(store.teaching('chats').examples[0]).toContain('Check the venue booking');
  expect(store.teaching('lists').examples).toEqual([]);
  expect(store.isNotAnAction('Check the venue booking', 'chats')).toBe(true);
  store.close();
});

test('renaming a checklist teaches the titles job; a plain step rename does not', () => {
  const store = new Store(':memory:');
  claude(store, 'Setup', LIST('Before any of this works you will need to do the following on your Mac:'), 0);
  pollOnce(store, new Date(at(0)));
  const group = store.listGroups()[0]!.parent!;
  const step = store.listTasks().find((t) => !t.isGroup)!;
  store.rename(group.id, 'Set up the Mac');
  store.rename(step.id, 'Restart it');
  expect(store.teaching('titles').examples).toEqual([
    'A checklist introduced by "Before any of this works you will need to do the following on your Mac" is better titled "Set up the Mac".',
  ]);
  store.close();
});

test('"Yes, done" on a "looks done?" and "This shows it done" are recorded as confirmed, with place, kind and verb', () => {
  const store = new Store(':memory:');
  const { id } = store.upsertTask({ title: 'Approve purchase order 4410', sourceKind: 'email', sourceRef: 'Microsoft Outlook', confidence: 1, position: null, ts: at(0), observationId: null, markers: [], criteria: null });
  store.suggestDone(id, 'Google Chrome — erp.example.org/po', null, new Date(at(5)));
  store.setStatus(id, 'done', new Date(at(6)));
  expect(store.confirmations().map((c) => c.detail)).toEqual(['Confirmed by you: done in Google Chrome — erp.example.org/po · email · approve']);
  // A plain tick with no question asked is not a confirmation.
  const other = store.upsertTask({ title: 'Book the venue', sourceKind: 'chat', sourceRef: 'WhatsApp — Noa Katz', confidence: 1, position: null, ts: at(0), observationId: null, markers: [], criteria: null }).id;
  store.setStatus(other, 'done', new Date(at(7)));
  expect(store.confirmations().length).toBe(1);
  // Didja Missed This: "This shows it done".
  const third = store.upsertTask({ title: 'Renew the domain', sourceKind: 'claude', sourceRef: 'Claude — Site', confidence: 1, position: null, ts: at(0), observationId: null, markers: [], criteria: null }).id;
  const o = store.insertObservation({ ts: at(8), bundleId: 'com.google.Chrome', app: 'Google Chrome', windowTitle: 'Domains', url: 'https://registrar.example.com/domains', source: 'ax', text: 'Renewed' });
  doneAt(store, third, o, new Date(at(9)));
  expect(store.confirmations().at(-1)!.detail).toBe('Confirmed by you: done in registrar.example.com · claude · renew');
  store.close();
});

test('a step kept apart in a second conversation is found there to be taken back, and the first is left alone', () => {
  const store = new Store(':memory:');
  claude(store, 'Monday fix', LIST('On your side:'), 0);
  pollOnce(store, new Date(at(0)));
  const monday = store.listTasks().find((t) => t.title.startsWith('Restart'))!;
  store.setStatus(monday.id, 'done', new Date(at(1)));
  claude(store, 'Wednesday fix', LIST('On your side:'), 2 * 24 * 60);
  pollOnce(store, new Date(at(2 * 24 * 60)));
  const wednesday = store.findTaskByTitle('Restart the app from the menu bar', 'Claude — Wednesday fix')!;
  expect(wednesday.id).not.toBe(monday.id);
  expect(store.findTaskByTitle('Restart the app from the menu bar', 'Claude — Monday fix')!.id).toBe(monday.id);
  store.close();
});
