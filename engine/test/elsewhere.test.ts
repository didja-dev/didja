/**
 * SCR-109: an ask answered in another app. A message you send the same person elsewhere, naming the
 * same thing, asks "looks done?"; a message from someone you wait on, elsewhere, marks the waiting
 * item "answered?". Neither ever ticks or closes on its own. Made-up content only.
 */
import { expect, test } from 'bun:test';
import type { ChatReader } from '../src/chat.ts';
import { pollOnce } from '../src/engine.ts';
import { answeredElsewhere, answerPlace, sharedObjects, waitingHint } from '../src/related.ts';
import { Store, TRUST_YES, trustKey, type Task, type Waiting } from '../src/store.ts';

// Wednesday 11 November 2026, 10:00 local time.
const NOW = new Date(2026, 10, 11, 10, 0);
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const never: ChatReader = () => ({ asks: false, task: '' });

const mail = (subject: string, from: string, to: string, date: string, body: string) =>
  `⟦Email⟧\nSubject: ${subject}\nFrom: ${from}\nDate: ${date}\nTo: ${to}\n${body}`;
function outlook(store: Store, text: string, ts: string): void {
  store.insertObservation({ ts, bundleId: 'com.microsoft.Outlook', app: 'Microsoft Outlook', windowTitle: 'Sent Items • me@example.com', url: null, source: 'ax', text: `Sent Items\n${text}` });
}
const section = (chat: string, kind: string, from: string, time: string) => `⟦Chat message: ${chat} (${kind}) — from ${from} — ${time}⟧`;
function whatsapp(store: Store, lines: string[], ts: string, title: string): void {
  store.insertObservation({ ts, bundleId: 'net.whatsapp.WhatsApp', app: 'WhatsApp', windowTitle: title, url: null, source: 'ax', text: lines.join('\n') });
}

/** An ask from Dana in WhatsApp, captured at 9:00. */
function chatAsk(store: Store, title: string, from = 'Dana Levi'): number {
  return store.upsertTask({ distinct: `w-${title}`, title, sourceKind: 'chat', sourceRef: `WhatsApp — ${from}`, confidence: 1, position: null,
    ts: at(-60), observationId: null, criteria: { service: null, hosts: [], chat: { app: 'WhatsApp', chat: from, from, at: at(-60), key: `k-${title}` } } }).id;
}
function store(): Store {
  const s = new Store(':memory:');
  s.setMeta('my_name', 'Mike Rosen');
  return s;
}
const yourEmail = (subject: string, body: string, to = 'Dana Levi <dana@example.com>') =>
  mail(subject, 'Mike Rosen, me@example.com', to, 'Today at 9:30', body);

test('the matching rule: same person, another app, after the ask, the same thing named', () => {
  const task = { id: 1, sourceRef: 'WhatsApp — Dana Levi', createdAt: at(-60) } as Task;
  const asker = { task, person: 'Dana Levi', words: 'Send Dana invoice INV-2041' };
  const yours = { person: 'Dana Levi', text: 'Here is INV-2041, attached', app: 'Microsoft Outlook', at: later(-30) };
  expect(answerPlace(asker, yours)).toBe('you wrote to Dana in Microsoft Outlook about INV-2041');
  expect(answerPlace(asker, { ...yours, text: 'Here is INV-2042' })).toBeNull(); // another invoice
  expect(answerPlace(asker, { ...yours, text: 'Here you go' })).toBeNull(); // names nothing
  expect(answerPlace(asker, { ...yours, person: 'Sam Carter' })).toBeNull(); // someone else
  expect(answerPlace(asker, { ...yours, app: 'WhatsApp' })).toBeNull(); // the same app has its own reply rules
  expect(answerPlace(asker, { ...yours, at: later(-90) })).toBeNull(); // before the ask
  expect(answeredElsewhere('you wrote to Dana in Microsoft Outlook about INV-2041')).toBe(true);
  expect(answeredElsewhere('Microsoft Outlook — a reply in “RE: Q3”')).toBe(false);
  expect(sharedObjects('Pay $1,200 for order #5531', 'Paid 1200 USD, order 5531')).toEqual(['5531', '1200']);
});

test('your email to Dana naming the invoice her WhatsApp ask named asks "looks done?"; it does not tick', () => {
  const s = store();
  const id = chatAsk(s, 'Send Dana invoice INV-2041');
  outlook(s, yourEmail('Invoice', 'Hi Dana,\nHere is INV-2041, attached.\nMike'), at(1));
  pollOnce(s, later(1), { chatReader: never });
  const task = s.getTask(id)!;
  expect(task.status).toBe('open');
  expect(task.suggestion).toBe('you wrote to Dana in Microsoft Outlook about INV-2041');
  s.close();
});

test('another invoice, or the same invoice sent to someone else, asks nothing', () => {
  let s = store();
  let id = chatAsk(s, 'Send Dana invoice INV-2041');
  outlook(s, yourEmail('Invoice', 'Hi Dana,\nHere is INV-2042.\nMike'), at(1));
  pollOnce(s, later(1), { chatReader: never });
  expect(s.getTask(id)!.suggestion).toBeNull();
  s.close();

  s = store();
  id = chatAsk(s, 'Send Dana invoice INV-2041');
  outlook(s, yourEmail('Invoice', 'Hi Sam,\nHere is INV-2041.\nMike', 'Sam Carter <sam@example.com>'), at(1));
  pollOnce(s, later(1), { chatReader: never });
  expect(s.getTask(id)!.suggestion).toBeNull();
  s.close();
});

test('never ticked on its own: not with "accept looks done", not in a place you trusted; "not yet" is not asked again', () => {
  const s = store();
  s.setMeta('looks_done_sure_once', 'yes');
  s.setMeta('looks_done', 'accept');
  const title = 'Send Dana invoice INV-2041';
  const id = chatAsk(s, title);
  const place = 'you wrote to Dana in Microsoft Outlook about INV-2041';
  for (let i = 0; i < TRUST_YES + 2; i++) s.recordTrust(trustKey(place, 'chat', title), 'yes', later(-120));
  outlook(s, yourEmail('Invoice', 'Hi Dana,\nHere is INV-2041.\nMike'), at(1));
  pollOnce(s, later(1), { chatReader: never });
  pollOnce(s, later(2), { chatReader: never });
  expect(s.getTask(id)!.status).toBe('open');
  expect(s.getTask(id)!.suggestion).toBe(place);

  s.rejectSuggestion(id, later(3));
  outlook(s, yourEmail('Invoice', 'Hi Dana,\nHere is INV-2041.\nMike'), at(4));
  pollOnce(s, later(4), { chatReader: never });
  expect(s.getTask(id)!.suggestion).toBeNull();
  expect(s.getTask(id)!.status).toBe('open');
  s.close();
});

// --- Waiting On ----------------------------------------------------------------------------------

const waiting = (over: Partial<Waiting> = {}): Waiting => ({
  id: 1, via: 'chat', app: 'WhatsApp', place: 'Dana Levi', who: 'Dana Levi', whoAddress: null, direct: true,
  title: 'Waiting on Dana: invoice INV-2041', askedAt: at(-60), quietUntil: at(1440), nudgedAt: null,
  status: 'waiting', closedAt: null, closedWhy: null, hint: null, ...over,
});

test('waiting: a message from that person in another app naming the same thing is a hint, nothing else is', () => {
  const theirs = { person: 'Dana Levi', text: 'Re: INV-2041 — attached', app: 'Microsoft Outlook', at: later(-15) };
  expect(waitingHint(waiting(), theirs)).toBe('Dana wrote in Microsoft Outlook at 09:45 about INV-2041');
  expect(waitingHint(waiting(), { ...theirs, text: 'INV-2042 attached' })).toBeNull();
  expect(waitingHint(waiting(), { ...theirs, person: 'Sam Carter' })).toBeNull();
  expect(waitingHint(waiting(), { ...theirs, app: 'WhatsApp' })).toBeNull(); // that chat closes it by its own rule
  expect(waitingHint(waiting(), { ...theirs, at: later(-90) })).toBeNull(); // before the ask
  expect(waitingHint(waiting({ title: 'Waiting on Dana: the signed contract' }), theirs)).toBeNull(); // the ask names no object
});

test('waiting on Dana in WhatsApp; her email about the same invoice marks it "answered?" and does not close it', () => {
  const s = store();
  whatsapp(s, [section('Dana Levi', 'direct', 'me', 'Today at 9:05'), 'Can you send me invoice INV-2041?'], at(1), 'Dana Levi');
  pollOnce(s, later(1), { chatReader: never });
  const [w] = s.waitingItems();
  expect(w!.title).toBe('Waiting on Dana: invoice INV-2041');
  expect(w!.hint).toBeNull();

  // An email from her about something else, or from someone else about the invoice: no hint.
  const inbox = [
    mail('Lunch', 'Dana Levi, dana@example.com', 'me@example.com', 'Today at 9:40', 'INV-2042 is paid'),
    mail('Invoices', 'Sam Carter, sam@example.com', 'me@example.com', 'Today at 9:41', 'About INV-2041'),
  ];
  outlook(s, inbox.join('\n'), at(2));
  pollOnce(s, later(2), { chatReader: never });
  expect(s.waitingItems()[0]!.hint).toBeNull();

  outlook(s, [mail('INV-2041', 'Dana Levi, dana@example.com', 'me@example.com', 'Today at 9:45', 'Attached as asked'), ...inbox].join('\n'), at(3));
  pollOnce(s, later(3), { chatReader: never });
  const [after] = s.waitingItems();
  expect(after!.status).toBe('waiting');
  expect(after!.hint).toBe('Dana wrote in Microsoft Outlook at 09:45 about INV-2041');
  expect(s.listTasks()).toEqual([]);
  s.close();
});
