import { expect, test } from 'bun:test';
import { sentBefore } from '../src/chat.ts';
import type { ChatMessage, ChatReader } from '../src/chat.ts';
import { mailTime } from '../src/email.ts';
import type { MailReader } from '../src/email.ts';
import { pollOnce } from '../src/engine.ts';
import { Store } from '../src/store.ts';

// "New messages only" (SCR-27, reworked 2026-11-12): leave out what is plainly dated before capture
// started. A Claude reply has no date, so it is always read, also when you scroll back to it.

// Wednesday 11 November 2026, 10:00 local time.
const NOW = new Date(2026, 10, 11, 10, 0);
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

const yours = (n: number, words: string) => `⟦Message ${n}⟧\n${words}\nYou said: ${words}`;
const steps = (n: number | null, first: string, second: string) =>
  `${n === null ? '⟦Currently streaming message⟧' : `⟦Message ${n}⟧`}
Here is what you do:
1. ${first}
2. ${second}`;

function claude(store: Store, ts: string, ...parts: string[]): void {
  store.insertObservation({
    ts, bundleId: 'com.anthropic.claudefordesktop', app: 'Claude', windowTitle: 'Deploy', url: null, source: 'ax', text: parts.join('\n'),
  });
}
const titles = (store: Store) => store.listTasks({ all: true }).map((t) => t.title).sort();

test('setting off (the default): an older conversation\'s list is captured, as before', () => {
  const store = new Store(':memory:');
  expect(store.onlyNewMessages()).toBe(false);
  claude(store, at(0), yours(40, 'how do I deploy?'), steps(41, 'Set the key in Vercel', 'Run the migration'));
  pollOnce(store, NOW);
  expect(titles(store)).toEqual(['Run the migration', 'Set the key in Vercel']);
  store.close();
});

/** Turns the setting on, with capture started at 10:00 (as the app reports it). */
function onlyNewSince(store: Store, start = NOW): void {
  store.setMeta('only_new', 'on');
  store.setMeta('capturing_since', start.toISOString());
}

test('setting on: a Claude list is captured even when it was already there, or you scroll back to it', () => {
  const store = new Store(':memory:');
  onlyNewSince(store);
  expect(store.onlyNewMessages()).toBe(true);
  expect(store.captureStartedAt()).toEqual(NOW);

  // The answer came while you were in another window; you come back to it.
  claude(store, at(0), yours(40, 'how do I deploy?'), steps(41, 'Set the key in Vercel', 'Run the migration'));
  pollOnce(store, NOW);
  expect(titles(store)).toEqual(['Run the migration', 'Set the key in Vercel']);

  // You scroll back to an earlier answer: it has no date to tell it is old, so it is read too.
  claude(store, at(1), yours(11, 'and the database?'), steps(12, 'Create the Supabase project', 'Copy the anon key'));
  pollOnce(store, NOW);
  expect(titles(store)).toEqual(['Copy the anon key', 'Create the Supabase project', 'Run the migration', 'Set the key in Vercel']);
  store.close();
});

test('setting on: a new conversation\'s first answer is captured, even if seen first while streaming', () => {
  const store = new Store(':memory:');
  onlyNewSince(store);
  claude(store, at(0), yours(1, 'how do I deploy?'), steps(null, 'Set the key in Vercel', 'Run the migration'));
  pollOnce(store, NOW);
  expect(titles(store)).toEqual(['Run the migration', 'Set the key in Vercel']);
  store.close();
});

test('setting on: text with no message sections (Claude Code in a terminal) is read as before', () => {
  const store = new Store(':memory:');
  onlyNewSince(store);
  store.insertObservation({
    ts: at(0), bundleId: 'com.mitchellh.ghostty', app: 'Ghostty', windowTitle: '✳ Deploy', url: null, source: 'ax',
    text: '⏺ Here is what you do:\n  1. Set the key in Vercel\n  2. Run the migration',
  });
  const before = new Store(':memory:');
  before.insertObservation({
    ts: at(0), bundleId: 'com.mitchellh.ghostty', app: 'Ghostty', windowTitle: '✳ Deploy', url: null, source: 'ax',
    text: '⏺ Here is what you do:\n  1. Set the key in Vercel\n  2. Run the migration',
  });
  pollOnce(store, NOW);
  pollOnce(before, NOW);
  expect(titles(store)).toEqual(['Run the migration', 'Set the key in Vercel']);
  expect(titles(store)).toEqual(titles(before));
  store.close();
  before.close();
});

// --- chats

const message = (time: string): ChatMessage => ({ chat: 'Dana Levi', kind: 'direct', from: 'Dana Levi', mentionsMe: false, time, body: 'Can you send the contract?' });

test('a chat message was sent before capture started only if its time plainly says so', () => {
  const start = new Date(2026, 10, 11, 10, 0, 40);
  expect(sentBefore(message('Today at 9:59'), start, NOW)).toBe(true);
  expect(sentBefore(message('Yesterday at 18:00'), start, NOW)).toBe(true);
  expect(sentBefore(message('Today at 10:00'), start, NOW)).toBe(false); // the same minute counts as new
  expect(sentBefore(message('10:05'), start, NOW)).toBe(false);
  expect(sentBefore(message('sometime'), start, NOW)).toBe(false); // no time to go by: kept
});

const section = (chat: string, time: string) => `⟦Chat message: ${chat} (direct) — from ${chat} — ${time}⟧`;
function whatsapp(store: Store, ts: string, lines: string[]): void {
  store.insertObservation({ ts, bundleId: 'net.whatsapp.WhatsApp', app: 'WhatsApp', windowTitle: 'WhatsApp', url: null, source: 'ax', text: lines.join('\n') });
}

test('setting on: chat asks sent before capture started are not put to the model; newer ones are', () => {
  const store = new Store(':memory:');
  store.setMeta('my_name', 'Mike Rosen');
  onlyNewSince(store);
  const asked: string[] = [];
  const read: ChatReader = (q) => { asked.push(q.message); return { asks: true, task: `Do: ${q.message}` }; };

  // Capture started at 10:00. Dana's ask from 9:05, and yesterday's you scroll back to, are older.
  whatsapp(store, at(1), [section('Dana Levi', 'Today at 9:05'), 'Can you send me the signed contract?']);
  whatsapp(store, at(2), [section('Dana Levi', 'Yesterday at 18:00'), 'Could you book the room for Thursday?']);
  pollOnce(store, NOW, { chatReader: read });
  expect(asked).toEqual([]);
  expect(store.listTasks()).toEqual([]);

  // Sent at 9:58 but first on screen at 10:04 (you were elsewhere): still before capture started.
  whatsapp(store, at(4), [section('Dana Levi', 'Today at 9:58'), 'Did you see the invoice?']);
  pollOnce(store, NOW, { chatReader: read });
  expect(asked).toEqual([]);

  // Sent at 10:03, seen whenever you come back to it: put to the model, then waits 10 minutes
  // for a reply (SCR-45) before it becomes a task.
  whatsapp(store, at(6), [section('Dana Levi', 'Today at 10:03'), 'Please call the bank today']);
  pollOnce(store, NOW, { chatReader: read });
  expect(asked).toEqual(['Please call the bank today']);
  pollOnce(store, new Date(NOW.getTime() + 15 * 60_000), { chatReader: read });
  expect(store.listTasks().map((t) => t.title)).toEqual(['Do: Please call the bank today']);
  store.close();
});

test('setting on, but the app has not said when capture started: nothing is left out', () => {
  const store = new Store(':memory:');
  store.setMeta('my_name', 'Mike Rosen');
  store.setMeta('only_new', 'on');
  const asked: string[] = [];
  const read: ChatReader = (q) => { asked.push(q.message); return { asks: false, task: '' }; };
  whatsapp(store, at(1), [section('Dana Levi', 'Today at 9:05'), 'Can you send me the signed contract?']);
  pollOnce(store, NOW, { chatReader: read });
  expect(asked).toEqual(['Can you send me the signed contract?']);
  store.close();
});

test('setting off: the same chat asks are all put to the model, as before', () => {
  const store = new Store(':memory:');
  store.setMeta('my_name', 'Mike Rosen');
  const asked: string[] = [];
  const read: ChatReader = (q) => { asked.push(q.message); return { asks: false, task: '' }; };
  whatsapp(store, at(1), [section('Dana Levi', 'Today at 9:05'), 'Can you send me the signed contract?']);
  whatsapp(store, at(2), [section('Dana Levi', 'Yesterday at 18:00'), 'Could you book the room for Thursday?']);
  pollOnce(store, NOW, { chatReader: read });
  expect(asked.sort()).toEqual(['Can you send me the signed contract?', 'Could you book the room for Thursday?']);
  store.close();
});

// --- email

test('when an email was sent, from the date the mail app shows', () => {
  expect(mailTime('15:05 (2 hours ago)', NOW)).toEqual(new Date(2026, 10, 11, 8, 0));
  expect(mailTime('Today at 9:15', NOW)).toEqual(new Date(2026, 10, 11, 9, 15));
  expect(mailTime('Yesterday at 18:00', NOW)).toEqual(new Date(2026, 10, 10, 18, 0));
  expect(mailTime('9:40 AM', NOW)).toEqual(new Date(2026, 10, 11, 9, 40));
  expect(mailTime('Mon 11/9/2026 9:15 AM', NOW)).toEqual(new Date(2026, 10, 9, 9, 15));
  expect(mailTime('Mon 3/4/2026 9:15 AM', NOW)).toBeNull(); // March 4th or April 3rd: cannot tell
  expect(mailTime('sometime', NOW)).toBeNull();
  expect(mailTime(null, NOW)).toBeNull();
});

function outlook(store: Store, ts: string, date: string, subject: string): void {
  store.insertObservation({
    ts, bundleId: 'com.microsoft.Outlook', app: 'Microsoft Outlook', windowTitle: 'Inbox • me@example.com', url: null, source: 'ax',
    text: `Inbox\n⟦Email⟧\nSubject: ${subject}\nFrom: Dana Levi, dana@example.com\nDate: ${date}\nTo: me@example.com\nHi Mike,\nCan you send me the ${subject}?\nThanks, Dana`,
  });
}

test('setting on: an email sent before capture started is not read; one sent after is', () => {
  const store = new Store(':memory:');
  store.setMeta('my_name', 'Mike Rosen');
  onlyNewSince(store);
  const asked: string[] = [];
  const mailReader: MailReader = (email) => { asked.push(email.subject); return { need: 'reply', task: `Send Dana the ${email.subject}` }; };
  outlook(store, at(1), 'Today at 9:30', 'Q3 numbers');
  outlook(store, at(2), 'Yesterday at 18:00', 'room booking');
  pollOnce(store, NOW, { mailReader });
  expect(asked).toEqual([]);
  outlook(store, at(5), 'Today at 10:04', 'signed contract');
  pollOnce(store, NOW, { mailReader });
  expect(asked).toEqual(['signed contract']);
  store.close();
});

test('setting off: the same older email is read, as before', () => {
  const store = new Store(':memory:');
  store.setMeta('my_name', 'Mike Rosen');
  store.setMeta('capturing_since', NOW.toISOString());
  const asked: string[] = [];
  const mailReader: MailReader = (email) => { asked.push(email.subject); return { need: 'none', task: 'none' }; };
  outlook(store, at(1), 'Today at 9:30', 'Q3 numbers');
  pollOnce(store, NOW, { mailReader });
  expect(asked).toEqual(['Q3 numbers']);
  store.close();
});
