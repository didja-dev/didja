/** SCR-99: asks you sent wait for that person's answer ("Waiting on Sam: …"). Made-up content only. */
import { expect, test } from 'bun:test';
import type { ChatReader } from '../src/chat.ts';
import { pollOnce } from '../src/engine.ts';
import { Store } from '../src/store.ts';
import { asksIn, quietUntil, samePerson, waitingTitle } from '../src/waiting.ts';

// Wednesday 11 November 2026, 10:00 local time.
const NOW = new Date(2026, 10, 11, 10, 0);
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const section = (chat: string, kind: string, from: string, time: string) => `⟦Chat message: ${chat} (${kind}) — from ${from} — ${time}⟧`;
const never: ChatReader = () => ({ asks: false, task: '' });

function chatStore(): Store {
  const store = new Store(':memory:');
  store.setMeta('my_name', 'Mike Rosen');
  return store;
}
function see(store: Store, lines: string[], ts: string, title = 'Dana Levi'): void {
  store.insertObservation({ ts, bundleId: 'net.whatsapp.WhatsApp', app: 'WhatsApp', windowTitle: title, url: null, source: 'ax', text: lines.join('\n') });
}

test('wording: plain asks with something concrete; not "send it", "let me know", or hedged ones', () => {
  const read = (t: string) => asksIn(t).map((a) => `${waitingTitle(a.to ?? 'Dana Levi', a)}${a.to ? ` [${a.to}]` : ''}`);
  expect(read('Can you send me the signed contract?')).toEqual(['Waiting on Dana: the signed contract']);
  expect(read('Hi Sam, could you review the PR by Friday?')).toEqual(['Waiting on Sam: review the PR [Sam]']);
  expect(read('Noa: please share the floor plan')).toEqual(['Waiting on Noa: the floor plan [Noa]']);
  expect(read('Could I get the October invoice?')).toEqual(['Waiting on Dana: the October invoice']);
  expect(read('תוכל לשלוח את החוזה?')).toEqual(['מחכה ל־Dana: לשלוח את החוזה']);
  expect(read('תשלחי לי את הקובץ מחר')).toEqual(['מחכה ל־Dana: לשלוח את הקובץ']);
  for (const none of [
    'Can you send it?', 'Let me know', 'Can you believe it?', 'Can you send the slides', 'Can you check if the invoice came?',
    'Thoughts?', 'Sam will send the contract', 'אולי תשלח את החוזה',
  ]) expect(read(none)).toEqual([]);
  expect(samePerson('Sam', 'Sam Carter')).toBe(true);
  expect(samePerson('Sam Carter', 'Sam Carter')).toBe(true);
  expect(samePerson('Sam Carter', 'Sam Levi')).toBe(false);
  expect(samePerson('Sam', 'Samuel Ross')).toBe(false);
});

test('quiet for a day after a chat ask, two working days after an email (Friday → Tuesday)', () => {
  const friday = new Date(2026, 10, 13, 15, 0);
  expect(quietUntil('chat', friday, 24, 2)).toEqual(new Date(2026, 10, 14, 15, 0));
  expect(quietUntil('email', friday, 24, 2)).toEqual(new Date(2026, 10, 17, 15, 0));
});

const ASK = [section('Dana Levi', 'direct', 'me', 'Today at 9:05'), 'Can you send me the signed contract?'];

test('an ask you sent in a chat waits on the other person; it is not a task', () => {
  const store = chatStore();
  see(store, ASK, at(1));
  pollOnce(store, later(1), { chatReader: never });
  expect(store.listTasks()).toEqual([]);
  const [w] = store.waitingItems();
  expect(w!.title).toBe('Waiting on Dana: the signed contract');
  expect(w!.who).toBe('Dana Levi');
  expect(w!.status).toBe('waiting');
  expect(w!.quietUntil).toBe(new Date(2026, 10, 12, 9, 5).toISOString());
  store.close();
});

test('your follow-up, a reaction, or a message from before the ask does not close it; their reply after it does', () => {
  const store = chatStore();
  const before = [section('Dana Levi', 'direct', 'Dana Levi', 'Today at 9:00'), 'Morning!'];
  see(store, [...before, ...ASK], at(1));
  pollOnce(store, later(1), { chatReader: never });
  see(store, [...before, ...ASK, section('Dana Levi', 'direct', 'me', 'Today at 9:20'), 'Any news on the contract?'], at(2));
  pollOnce(store, later(2), { chatReader: never });
  see(store, [section('Dana Levi', 'direct', 'Dana Levi', 'Today at 9:25'), '[reacted 👍 to “Can you send me the signed contract?”]'], at(3));
  pollOnce(store, later(3), { chatReader: never });
  expect(store.waitingItems().length).toBe(1);

  see(store, [...ASK, section('Dana Levi', 'direct', 'Dana Levi', 'Today at 9:42'), 'Sent it just now'], at(4));
  pollOnce(store, later(4), { chatReader: never });
  expect(store.waitingItems()).toEqual([]);
  const [w] = store.waitingItems({ all: true });
  expect(w!.status).toBe('answered');
  expect(w!.closedWhy).toBe('Dana replied in WhatsApp — Dana Levi at 09:42');
  // Never a tick: no task, no outcome counted.
  expect(store.listTasks()).toEqual([]);
  store.close();
});

test('in a group, only the person named closes it; an ask that names no one waits on no one', () => {
  const store = chatStore();
  const ask = [section('Team', 'group', 'me', 'Today at 9:05'), 'Sam, can you review the PR?', section('Team', 'group', 'me', 'Today at 9:06'), 'Can you send me the floor plan?'];
  see(store, ask, at(1), 'Team');
  pollOnce(store, later(1), { chatReader: never });
  expect(store.waitingItems().map((w) => w.title)).toEqual(['Waiting on Sam: review the PR']);
  see(store, [...ask, section('Team', 'group', 'Noa Katz', 'Today at 9:30'), 'Done, merged it'], at(2), 'Team');
  pollOnce(store, later(2), { chatReader: never });
  expect(store.waitingItems().length).toBe(1);
  see(store, [...ask, section('Team', 'group', 'Sam Carter', 'Today at 9:40'), 'Looks good, approved'], at(3), 'Team');
  pollOnce(store, later(3), { chatReader: never });
  expect(store.waitingItems()).toEqual([]);
  store.close();
});

test('already answered on screen: nothing to wait for', () => {
  const store = chatStore();
  see(store, [...ASK, section('Dana Levi', 'direct', 'Dana Levi', 'Today at 9:07'), 'Here it is'], at(1));
  pollOnce(store, later(1), { chatReader: never });
  expect(store.waitingItems({ all: true })).toEqual([]);
  store.close();
});

test('one reminder after the quiet time, then none; Got it and Stop waiting close it without a tick', () => {
  const store = chatStore();
  see(store, ASK, at(1));
  pollOnce(store, later(1), { chatReader: never });
  expect(store.takeWaitingNudges(later(60))).toEqual([]);
  expect(store.takeWaitingNudges(later(24 * 60)).map((w) => w.title)).toEqual(['Waiting on Dana: the signed contract']);
  expect(store.takeWaitingNudges(later(25 * 60))).toEqual([]);
  const [w] = store.waitingItems();
  expect(store.closeWaiting(w!.id, 'answered', 'You said you got it', later(26 * 60))).toBe(true);
  expect(store.closeWaiting(w!.id, 'stopped', 'You stopped waiting', later(26 * 60))).toBe(false);
  expect(store.listTasks()).toEqual([]);
  // Closed items leave after a day; open ones 30 days after the ask.
  store.pruneWaiting(later(51 * 60));
  expect(store.waitingItems({ all: true })).toEqual([]);
  store.close();
});

test('the quiet time is a setting', () => {
  const store = chatStore();
  expect(store.waitingQuiet()).toEqual({ chatHours: 24, emailDays: 2 });
  store.setWaitingQuiet({ chatHours: 4 });
  see(store, ASK, at(1));
  pollOnce(store, later(1), { chatReader: never });
  expect(store.waitingItems()[0]!.quietUntil).toBe(new Date(2026, 10, 11, 13, 5).toISOString());
  store.setMeta('waiting_email_days', 'nonsense');
  expect(store.waitingQuiet().emailDays).toBe(2);
  store.close();
});

const mail = (subject: string, from: string, to: string, date: string, body: string) =>
  `⟦Email⟧\nSubject: ${subject}\nFrom: ${from}\nDate: ${date}\nTo: ${to}\n${body}`;
function outlook(store: Store, text: string, ts: string): void {
  store.insertObservation({ ts, bundleId: 'com.microsoft.Outlook', app: 'Microsoft Outlook', windowTitle: 'Sent Items • me@example.com', url: null, source: 'ax', text: `Sent Items\n${text}` });
}

test('an email you sent one person waits on them; only their reply after it closes it', () => {
  const store = new Store(':memory:');
  const ask = mail('Contract', 'Mike Rosen, me@example.com', 'Dana Levi <dana@example.com>', 'Today at 9:05', 'Hi Dana,\nCould you send me the signed contract?\nThanks');
  outlook(store, ask, at(1));
  pollOnce(store, later(1), {});
  const [w] = store.waitingItems();
  expect(w!.title).toBe('Waiting on Dana: the signed contract');
  expect(w!.quietUntil).toBe(new Date(2026, 10, 13, 9, 5).toISOString());
  outlook(store, `${ask}\n${mail('Re: Contract', 'Sam Carter, sam@example.com', 'me@example.com', 'Today at 9:30', 'Dana is out today')}`, at(2));
  pollOnce(store, later(2), {});
  expect(store.waitingItems().length).toBe(1);
  outlook(store, `${ask}\n${mail('Re: Contract', 'Dana Levi, dana@example.com', 'me@example.com', 'Today at 9:45', 'Attached')}`, at(3));
  pollOnce(store, later(3), {});
  expect(store.waitingItems()).toEqual([]);
  expect(store.waitingItems({ all: true })[0]!.closedWhy).toBe('Dana replied in Microsoft Outlook at 09:45');
  expect(store.listTasks()).toEqual([]);
  store.close();
});

test('an email to several people, or someone else\'s ask, waits on no one', () => {
  const store = new Store(':memory:');
  outlook(store, [
    mail('Plan', 'Mike Rosen, me@example.com', 'dana@example.com; sam@example.com', 'Today at 9:05', 'Can you send me the floor plan?'),
    mail('Plan 2', 'Dana Levi, dana@example.com', 'me@example.com', 'Today at 9:06', 'Can you send me the floor plan?'),
  ].join('\n'), at(1));
  pollOnce(store, later(1), {});
  expect(store.waitingItems({ all: true })).toEqual([]);
  store.close();
});
