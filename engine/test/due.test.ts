/** SCR-97: due dates read from asks, relative to the message's date; ordering and reminders only. Made-up content only. */
import { expect, test } from 'bun:test';
import { formatWhy } from '../src/cli.ts';
import type { ChatReader } from '../src/chat.ts';
import { dayOf, dueFrom } from '../src/due.ts';
import type { MailReader } from '../src/email.ts';
import { pollOnce } from '../src/engine.ts';
import { Store } from '../src/store.ts';

// Wednesday 11 November 2026, 10:00 local time.
const WED = new Date(2026, 10, 11, 10, 0);

test('English phrases, relative to the message date', () => {
  const cases: [string, string | null][] = [
    ['Can you send it by Friday?', '2026-11-13'],
    ['Please confirm by Wednesday', '2026-11-11'], // said on a Wednesday: today
    ['by EOD please', '2026-11-11'],
    ['end of day is fine', '2026-11-11'],
    ['Could you do it tomorrow?', '2026-11-12'],
    ['sometime next week', '2026-11-16'],
    ['by end of the week', '2026-11-13'],
    ['due 2026-11-20', '2026-11-20'],
    ['on 20 November', '2026-11-20'],
    ['due Nov 20th', '2026-11-20'],
    ['by 20/11', '2026-11-20'],
    ['by 20.11.2026', '2026-11-20'],
    ['by May 5, 2027', '2027-05-05'],
  ];
  for (const [text, want] of cases) expect({ text, due: dueFrom(text, WED) }).toEqual({ text, due: want });
});

test('Hebrew phrases', () => {
  expect(dueFrom('תשלח לי עד יום חמישי', WED)).toBe('2026-11-12');
  expect(dueFrom('אפשר מחר בבוקר?', WED)).toBe('2026-11-12');
  expect(dueFrom('עד סוף היום', WED)).toBe('2026-11-11');
  expect(dueFrom('בשבוע הבא', WED)).toBe('2026-11-16');
  expect(dueFrom('עד 20/11', WED)).toBe('2026-11-20');
});

test('relative to when it was sent, not when it is read', () => {
  const monday = new Date(2026, 10, 9, 9, 0);
  expect(dueFrom('by Friday', monday)).toBe('2026-11-13');
  expect(dueFrom('tomorrow please', monday)).toBe('2026-11-10'); // already past on Wednesday: overdue
  expect(dueFrom('due 2026-11-01', WED)).toBe('2026-11-01'); // a past date is kept: it is overdue
});

test('ambiguous or no deadline: left empty', () => {
  for (const text of ['by next Friday', 'by 3/4', 'Friday or Monday?', 'we met Thursday', 'meeting Nov 20th', 'version 1.2.3',
    'call 054-123', 'you may 5 times', 'Can you send the deck?', 'tomorrow, or by Friday']) {
    expect({ text, due: dueFrom(text, WED) }).toEqual({ text, due: null });
  }
  expect(dayOf(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
});

test('an email asking "by Thursday" becomes a task due that day; why says so', () => {
  const store = new Store(':memory:');
  const mailReader: MailReader = () => ({ need: 'action', task: 'Send Dana the updated Q3 numbers' });
  store.insertObservation({ ts: WED.toISOString(), bundleId: 'com.microsoft.Outlook', app: 'Microsoft Outlook', windowTitle: 'Inbox • me@example.com', url: null, source: 'ax',
    text: 'Inbox\n⟦Email⟧\nSubject: Q3 budget numbers\nFrom: Dana Levi, dana@acme.com\nDate: Today at 9:58\nTo: me@example.com\nHi Mike,\nCan you send me the updated Q3 numbers by Thursday?' });
  pollOnce(store, WED, { mailReader });
  const [task] = store.listTasks();
  expect(task!.dueAt).toBe('2026-11-12');
  expect(formatWhy(task!, store.listEvidence(task!.id))).toContain('Due: 2026-11-12');
  store.close();
});

test('a chat ask "tomorrow" is due tomorrow, even after waiting for your reply', () => {
  const store = new Store(':memory:');
  store.setMeta('my_name', 'Mike Rosen');
  const chatReader: ChatReader = () => ({ asks: true, task: 'Send Dana the contract' });
  // Sent at 9:58: it waits ten minutes for a reply before it becomes a task.
  store.insertObservation({ ts: WED.toISOString(), bundleId: 'net.whatsapp.WhatsApp', app: 'WhatsApp', windowTitle: 'Dana Levi', url: null, source: 'ax',
    text: '⟦Chat message: Dana Levi (direct) — from Dana Levi — Today at 9:58⟧\nCan you send me the contract tomorrow?' });
  pollOnce(store, WED, { chatReader });
  expect(store.listTasks()).toEqual([]);
  pollOnce(store, new Date(WED.getTime() + 15 * 60_000), { chatReader });
  expect(store.listTasks()[0]!.dueAt).toBe('2026-11-12');
  store.close();
});

test('a snoozed task comes back on its day; one reminder that day; never a tick', () => {
  const store = new Store(':memory:');
  const mailReader: MailReader = () => ({ need: 'action', task: 'Send Dana the updated Q3 numbers' });
  store.insertObservation({ ts: WED.toISOString(), bundleId: 'com.microsoft.Outlook', app: 'Microsoft Outlook', windowTitle: 'Inbox • me@example.com', url: null, source: 'ax',
    text: 'Inbox\n⟦Email⟧\nSubject: Q3 budget numbers\nFrom: Dana Levi, dana@acme.com\nDate: Today at 9:58\nTo: me@example.com\nCan you send me the updated Q3 numbers by Thursday?' });
  pollOnce(store, WED, { mailReader });
  const id = store.listTasks()[0]!.id;
  // Snoozed for a week on Wednesday.
  store.snooze(id, new Date(2026, 10, 18, 9, 0), WED);
  expect(store.takeNudges(WED).filter((n) => n.due)).toEqual([]);
  expect(store.wakeSnoozed(new Date(2026, 10, 11, 23, 0))).toBe(0);
  // Thursday morning: it is back, and reminded about once.
  const thu = new Date(2026, 10, 12, 8, 0);
  expect(store.wakeSnoozed(thu)).toBe(1);
  expect(store.getTask(id)!.status).toBe('open');
  expect(store.takeNudges(thu).filter((n) => n.due)).toEqual([{ id, title: 'Send Dana the updated Q3 numbers', source: 'Microsoft Outlook', left: 1, total: 1, due: '2026-11-12' }]);
  expect(store.takeNudges(thu).filter((n) => n.due)).toEqual([]);
  expect(store.getTask(id)!.status).toBe('open');
  store.close();
});
