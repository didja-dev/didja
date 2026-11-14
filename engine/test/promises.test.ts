/** SCR-98: promises you make in your own messages become "You said you'd: …". Made-up content only. */
import { expect, test } from 'bun:test';
import type { ChatReader } from '../src/chat.ts';
import { acceptSuggestion, looksDelivered, pollOnce } from '../src/engine.ts';
import { promisesIn, promiseTitle, samePromise } from '../src/promises.ts';
import { Store } from '../src/store.ts';

// Wednesday 11 November 2026, 10:00 local time.
const NOW = new Date(2026, 10, 11, 10, 0);
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const section = (chat: string, kind: string, from: string, time: string) => `⟦Chat message: ${chat} (${kind}) — from ${from} — ${time}⟧`;

function chatStore(level?: 'strict' | 'balanced' | 'everything'): Store {
  const store = new Store(':memory:');
  store.setMeta('my_name', 'Mike Rosen');
  if (level) store.setCaptureLevel(level);
  return store;
}
function see(store: Store, lines: string[], ts: string, title = 'Dana Levi'): void {
  store.insertObservation({ ts, bundleId: 'net.whatsapp.WhatsApp', app: 'WhatsApp', windowTitle: title, url: null, source: 'ax', text: lines.join('\n') });
}
const never: ChatReader = () => ({ asks: false, task: '' });
const promised = (store: Store) => store.listTasks().filter((t) => t.criteria?.promise);

test('wording: first person, future and concrete; hedged, social, vague and questions are not', () => {
  const read = (t: string) => promisesIn(t).map((p) => `${promiseTitle(p)}${p.sure ? '' : ' (vague)'}`);
  expect(read("I'll send the slides tomorrow")).toEqual(["You said you'd: send the slides"]);
  expect(read('Sure, I will get back to you on the quote by Friday')).toEqual(["You said you'd: get back to you on the quote"]);
  expect(read('Thanks! I’ll forward the invoice to Sam by EOD.')).toEqual(["You said you'd: forward the invoice to Sam"]);
  expect(read("I'll update the doc in Drive")).toEqual(["You said you'd: update the doc in Drive"]);
  expect(read("I'll send it")).toEqual(["You said you'd: send it (vague)"]);
  expect(read("I'll look into the invoice")).toEqual(["You said you'd: look into the invoice (vague)"]);
  expect(read('אשלח את הקובץ מחר')).toEqual(['הבטחת: לשלוח את הקובץ']);
  expect(read('אחזור אליך על התקציב')).toEqual(['הבטחת: לחזור אליך על התקציב']);
  for (const none of [
    "We should grab coffee soon", "I'll try to send it", 'Perhaps I\'ll send the slides', "I'll send the slides if I find it",
    'Will you send the slides?', "I'll send the slides to Noa, ok?", "I'll think about it", "I'll let you know", "I'll check",
    "I'll get back to you", 'Noa will send the slides', 'אולי אשלח את זה', 'אבדוק', 'אחזור אליך', "I won't send it",
  ]) expect(read(none)).toEqual([]);
  expect(samePromise("You said you'd: send the slides", "you said you'd: Send the slides.")).toBe(true);
  expect(looksDelivered('here you go')).toBe(true);
  expect(looksDelivered('slides-v2.pdf')).toBe(true);
  expect(looksDelivered('ok thanks')).toBe(false);
});

test('a concrete promise in your chat message becomes a task under the chat, with its due day', () => {
  const store = chatStore();
  see(store, [section('Dana Levi', 'direct', 'Dana Levi', 'Today at 9:01'), 'Great meeting today', section('Dana Levi', 'direct', 'me', 'Today at 9:05'), "I'll send the slides tomorrow"], at(1));
  pollOnce(store, later(1), { chatReader: never });
  const [task] = promised(store);
  expect(task).toBeDefined();
  expect(task!.title).toBe("You said you'd: send the slides");
  expect(task!.sourceRef).toBe('WhatsApp — Dana Levi');
  expect(task!.capturedWhy).toContain('You promised it in a chat message of yours');
  expect(task!.dueAt).toBe('2026-11-12');
  // Never watched on other screens: only you settle a promise.
  expect(store.tasksToWatch().some((t) => t.id === task!.id)).toBe(false);
  store.close();
});

test('a promise said again is the same task, and is not done', () => {
  const store = chatStore();
  const first = [section('Dana Levi', 'direct', 'me', 'Today at 9:05'), "I'll send the slides tomorrow"];
  see(store, first, at(1));
  pollOnce(store, later(1), { chatReader: never });
  see(store, [...first, section('Dana Levi', 'direct', 'me', 'Today at 9:40'), 'Yes, I will send the slides first thing'], at(2));
  pollOnce(store, later(2), { chatReader: never });
  const tasks = promised(store);
  expect(tasks.length).toBe(1);
  expect(tasks[0]!.status).toBe('open');
  expect(tasks[0]!.suggestion).toBeNull();
  store.close();
});

test('"here you go" afterwards only asks; it never ticks. A message that hands nothing over does nothing', () => {
  const store = chatStore();
  const first = [section('Dana Levi', 'direct', 'me', 'Today at 9:05'), "I'll send the slides tomorrow"];
  see(store, first, at(1));
  pollOnce(store, later(1), { chatReader: never });
  see(store, [...first, section('Dana Levi', 'direct', 'me', 'Today at 9:30'), 'ok thanks'], at(2));
  pollOnce(store, later(2), { chatReader: never });
  expect(promised(store)[0]!.suggestion).toBeNull();
  see(store, [...first, section('Dana Levi', 'direct', 'me', 'Today at 9:50'), 'here you go'], at(3));
  pollOnce(store, later(3), { chatReader: never, replyJudge: () => 'settles' });
  const [task] = promised(store);
  expect(task!.status).toBe('open');
  expect(task!.suggestion).toContain('WhatsApp — Dana Levi');
  store.close();
});

test('a promise that answers someone\'s ask is that ask\'s task, not a second one', () => {
  const store = chatStore();
  see(store, [
    section('Dana Levi', 'direct', 'Dana Levi', 'Today at 9:00'), 'Can you send me the signed contract?',
    section('Dana Levi', 'direct', 'me', 'Today at 9:20'), "I'll send the signed contract tomorrow",
  ], at(1));
  pollOnce(store, later(1), { chatReader: () => ({ asks: true, task: 'Send Dana the signed contract' }) });
  expect(promised(store)).toEqual([]);
  const tasks = store.listTasks().filter((t) => !t.isGroup);
  expect(tasks.map((t) => t.title)).toEqual(['Send Dana the signed contract']);
  store.close();
});

test('in a group, your promise to someone is yours; theirs to someone else is not', () => {
  const store = chatStore();
  see(store, [
    section('Ops', 'group', 'me', 'Today at 9:05'), "Noa, I'll send you the slides by Friday",
    section('Ops', 'group', 'Noa', 'Today at 9:06'), "Thanks! I'll book the room",
  ], at(1), 'Ops');
  pollOnce(store, later(1), { chatReader: never });
  expect(promised(store).map((t) => t.title)).toEqual(["You said you'd: send you the slides"]);
  expect(promised(store)[0]!.dueAt).toBe('2026-11-13');
  store.close();
});

test('a vague promise goes to Suggested (not under Strict); Accept makes a promise task, your next message does not clear it', () => {
  const vague = [section('Dana Levi', 'direct', 'me', 'Today at 9:05'), "I'll look into the invoice", section('Dana Levi', 'direct', 'me', 'Today at 9:06'), 'Talk soon'];
  const strict = chatStore('strict');
  see(strict, vague, at(1));
  pollOnce(strict, later(1), { chatReader: never });
  expect(strict.suggestions()).toEqual([]);
  expect(strict.listTasks()).toEqual([]);
  strict.close();

  const store = chatStore();
  see(store, vague, at(1));
  pollOnce(store, later(1), { chatReader: never });
  expect(store.listTasks()).toEqual([]);
  const [s] = store.suggestions();
  expect(s!.title).toBe("You said you'd: look into the invoice");
  expect(acceptSuggestion(store, s!.id, later(2))).toBe(true);
  const [task] = promised(store);
  expect(task!.criteria!.chat).toBeUndefined();
  expect(task!.capturedWhy).toContain('accepted it from Suggested');
  store.close();
});

test('Not an Action on a promise is remembered: the same line is not taken again', () => {
  const store = chatStore();
  const lines = [section('Dana Levi', 'direct', 'me', 'Today at 9:05'), "I'll send the slides tomorrow"];
  see(store, lines, at(1));
  pollOnce(store, later(1), { chatReader: never });
  store.notAnAction(promised(store)[0]!.id, later(2));
  see(store, [section('Sam', 'direct', 'me', 'Today at 9:30'), "I'll send the slides tomorrow"], at(3), 'Sam');
  pollOnce(store, later(3), { chatReader: never });
  expect(promised(store).filter((t) => t.status === 'open')).toEqual([]);
  store.close();
});

const mail = (subject: string, from: string, date: string, body: string) => `⟦Email⟧\nSubject: ${subject}\nFrom: ${from}\nDate: ${date}\nTo: dana@example.com\n${body}`;
function outlook(store: Store, text: string, ts: string): void {
  store.insertObservation({ ts, bundleId: 'com.microsoft.Outlook', app: 'Microsoft Outlook', windowTitle: 'Sent Items • me@example.com', url: null, source: 'ax', text: `Sent Items\n${text}` });
}

test('a promise in an email you sent becomes a task; a later email of yours with the file only asks', () => {
  const store = new Store(':memory:');
  const promise = mail('Q3 slides', 'Mike Rosen, me@example.com', 'Today at 9:05', "Hi Dana,\nI'll send the final slides by Friday.\nMike\nFrom: Dana Levi <dana@example.com>\nI'll be away next week");
  outlook(store, promise, at(1));
  pollOnce(store, later(1), {});
  const tasks = promised(store);
  // Only your own words: the quoted message below yours is not your promise.
  expect(tasks.map((t) => t.title)).toEqual(["You said you'd: send the final slides"]);
  expect(tasks[0]!.sourceKind).toBe('email');
  expect(tasks[0]!.dueAt).toBe('2026-11-13');
  outlook(store, `${promise}\n${mail('Re: Q3 slides', 'Mike Rosen, me@example.com', 'Today at 9:40', 'Attached: q3-slides.pdf')}`, at(2));
  pollOnce(store, later(2), {});
  const [task] = promised(store);
  expect(task!.status).toBe('open');
  expect(task!.suggestion).toContain('your later email');
  store.close();
});

test("someone else's promise in an email is not yours", () => {
  const store = new Store(':memory:');
  outlook(store, mail('Q3 slides', 'Dana Levi, dana@example.com', 'Today at 9:05', "I'll send the final slides by Friday."), at(1));
  pollOnce(store, later(1), {});
  expect(promised(store)).toEqual([]);
  store.close();
});
