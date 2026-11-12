import { expect, test } from 'bun:test';
import { arrivedWhileShown } from '../src/chat.ts';
import type { ChatMessage, ChatReader } from '../src/chat.ts';
import { pollOnce } from '../src/engine.ts';
import { dropEarlierMessages, newestMessage } from '../src/extract.ts';
import { Store } from '../src/store.ts';

// SCR-27: tasks only from messages that arrive after you first looked, not from ones you scroll back to.

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

test('the newest message number in a conversation, and leaving out the ones up to a number', () => {
  const text = [yours(40, 'how do I deploy?'), steps(41, 'Set the key in Vercel', 'Run the migration'), 'Reply to Claude…'].join('\n');
  expect(newestMessage(text)).toBe(41);
  expect(newestMessage('⟦Currently streaming message⟧\nHello')).toBe(0);
  expect(newestMessage('1. Set the key\n2. Run it')).toBeNull();
  expect(newestMessage('⟦Page⟧\nSomething')).toBeNull();

  const later = [steps(41, 'Old step one', 'Old step two'), yours(42, 'and then?'), steps(null, 'New step one', 'New step two')].join('\n');
  const kept = dropEarlierMessages(later, 41);
  expect(kept).not.toContain('Old step');
  expect(kept).toContain('⟦Message 42⟧');
  expect(kept).toContain('New step one');
  // Text outside any message stays.
  expect(dropEarlierMessages(`Sidebar\n${steps(3, 'a', 'b')}\n⟦Page⟧\nFooter`, 3)).toBe('Sidebar\n⟦Page⟧\nFooter');
});

test('setting off (the default): an older conversation\'s list is captured, as before', () => {
  const store = new Store(':memory:');
  expect(store.onlyNewMessages()).toBe(false);
  claude(store, at(0), yours(40, 'how do I deploy?'), steps(41, 'Set the key in Vercel', 'Run the migration'));
  pollOnce(store, NOW);
  expect(titles(store)).toEqual(['Run the migration', 'Set the key in Vercel']);
  store.close();
});

test('setting on: lists already there when you open a conversation, or found by scrolling back, are not captured; a new answer is', () => {
  const store = new Store(':memory:');
  store.setMeta('only_new', 'on');
  expect(store.onlyNewMessages()).toBe(true);

  // You open yesterday's conversation: its last answer has a list.
  claude(store, at(0), yours(40, 'how do I deploy?'), steps(41, 'Set the key in Vercel', 'Run the migration'));
  pollOnce(store, NOW);
  expect(titles(store)).toEqual([]);

  // You scroll back: older messages load above, one with a list.
  claude(store, at(1), yours(11, 'and the database?'), steps(12, 'Create the Supabase project', 'Copy the anon key'));
  pollOnce(store, NOW);
  expect(titles(store)).toEqual([]);

  // You ask something new: the answer streams in below, then is numbered once finished.
  claude(store, at(2), yours(42, 'what about the webhook?'), steps(null, 'Add the webhook URL in Stripe', 'Paste the secret into Vercel'));
  pollOnce(store, NOW);
  expect(titles(store)).toEqual(['Add the webhook URL in Stripe', 'Paste the secret into Vercel']);
  claude(store, at(3), steps(43, 'Add the webhook URL in Stripe', 'Paste the secret into Vercel'));
  pollOnce(store, NOW);
  expect(titles(store).length).toBe(2);

  // Scrolling back again, after the new answer, still brings nothing.
  claude(store, at(4), steps(20, 'Rotate the service key', 'Restart the server'));
  pollOnce(store, NOW);
  expect(titles(store).length).toBe(2);
  store.close();
});

test('setting on: a new conversation\'s first answer is captured, even if seen first while streaming', () => {
  const store = new Store(':memory:');
  store.setMeta('only_new', 'on');
  claude(store, at(0), yours(1, 'how do I deploy?'), steps(null, 'Set the key in Vercel', 'Run the migration'));
  pollOnce(store, NOW);
  expect(titles(store)).toEqual(['Run the migration', 'Set the key in Vercel']);
  store.close();
});

test('setting on: text with no message sections (Claude Code in a terminal) is read as before', () => {
  const store = new Store(':memory:');
  store.setMeta('only_new', 'on');
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

test('a chat message arrived while shown if it was sent in or after the minute the chat was first on screen', () => {
  const shown = new Date(2026, 10, 11, 10, 0, 40);
  expect(arrivedWhileShown(message('Today at 10:00'), shown, NOW)).toBe(true);
  expect(arrivedWhileShown(message('10:05'), shown, NOW)).toBe(true);
  expect(arrivedWhileShown(message('Today at 9:59'), shown, NOW)).toBe(false);
  expect(arrivedWhileShown(message('Yesterday at 18:00'), shown, NOW)).toBe(false);
  expect(arrivedWhileShown(message('sometime'), shown, NOW)).toBe(false);
});

const section = (chat: string, time: string) => `⟦Chat message: ${chat} (direct) — from ${chat} — ${time}⟧`;
function whatsapp(store: Store, ts: string, lines: string[]): void {
  store.insertObservation({ ts, bundleId: 'net.whatsapp.WhatsApp', app: 'WhatsApp', windowTitle: 'WhatsApp', url: null, source: 'ax', text: lines.join('\n') });
}

test('setting on: chat asks already there, or scrolled back to, are not put to the model; one that arrives is', () => {
  const store = new Store(':memory:');
  store.setMeta('my_name', 'Mike Rosen');
  store.setMeta('only_new', 'on');
  const asked: string[] = [];
  const read: ChatReader = (q) => { asked.push(q.message); return { asks: true, task: `Do: ${q.message}` }; };

  // You open the chat at 10:01; Dana's ask from 9:05 is already there.
  whatsapp(store, at(1), [section('Dana Levi', 'Today at 9:05'), 'Can you send me the signed contract?']);
  pollOnce(store, NOW, { chatReader: read });
  // Scrolling back brings up yesterday's ask.
  whatsapp(store, at(2), [section('Dana Levi', 'Yesterday at 18:00'), 'Could you book the room for Thursday?']);
  pollOnce(store, NOW, { chatReader: read });
  expect(asked).toEqual([]);
  expect(store.listTasks()).toEqual([]);

  // A new ask arrives at 10:03 while the chat is open. It is put to the model, then waits 10
  // minutes for a reply (SCR-45) before it becomes a task.
  whatsapp(store, at(3), [section('Dana Levi', 'Today at 10:03'), 'Please call the bank today']);
  pollOnce(store, NOW, { chatReader: read });
  expect(asked).toEqual(['Please call the bank today']);
  expect(store.listTasks()).toEqual([]);
  pollOnce(store, new Date(NOW.getTime() + 15 * 60_000), { chatReader: read });
  expect(store.listTasks().map((t) => t.title)).toEqual(['Do: Please call the bank today']);
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
