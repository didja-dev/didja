import { expect, test } from 'bun:test';
import { asksEveryone, asksForAcknowledgement, chatTaskTitle, isEmojiOnly, chatTime, isMine, mayAskOfMe, namesMe, parseChatMessages, plainlyDefers } from '../src/chat.ts';
import type { ChatQuestion, ChatReader, ReplyJudge, ReplyQuestion } from '../src/chat.ts';
import { myNames, namesOf, pollOnce } from '../src/engine.ts';
import { Store } from '../src/store.ts';

// Wednesday 11 November 2026, 10:00 local time.
const NOW = new Date(2026, 10, 11, 10, 0);
const ME = ['Mike Rosen'];
/** A reading taken `minutes` after NOW, as capture stamps it. */
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

const section = (chat: string, kind: string, from: string, time: string, extra = '') =>
  `⟦Chat message: ${chat} (${kind}) — from ${from}${extra} — ${time}⟧`;

test('messages are read from their labelled sections', () => {
  const text = [
    section('Dana Levi', 'direct', 'Dana Levi', 'Today at 9:05'),
    'Can you send me the signed contract?',
    'Thanks!',
    section('Dana Levi', 'direct', 'me', 'Today at 9:10'),
    'Sent',
    '⟦Page⟧',
    'Type a message',
    section('Team', 'group', 'Ron', '11 November 2026 09:30', ', mentions me'),
    'Please review the deck',
  ].join('\n');
  expect(parseChatMessages(text)).toEqual([
    { chat: 'Dana Levi', kind: 'direct', from: 'Dana Levi', mentionsMe: false, time: 'Today at 9:05', body: 'Can you send me the signed contract?\nThanks!' },
    { chat: 'Dana Levi', kind: 'direct', from: 'me', mentionsMe: false, time: 'Today at 9:10', body: 'Sent' },
    { chat: 'Team', kind: 'group', from: 'Ron', mentionsMe: true, time: '11 November 2026 09:30', body: 'Please review the deck' },
  ]);
});

test('times as chat apps show them', () => {
  expect(chatTime('Today at 9:05', NOW)).toEqual(new Date(2026, 10, 11, 9, 5));
  expect(chatTime('Yesterday at 21:10', NOW)).toEqual(new Date(2026, 10, 10, 21, 10));
  expect(chatTime('Monday at 9:05', NOW)).toEqual(new Date(2026, 10, 9, 9, 5));
  expect(chatTime('9 October at 12:34', NOW)).toEqual(new Date(2026, 9, 9, 12, 34));
  expect(chatTime('11 November 2026 09:30', NOW)).toEqual(new Date(2026, 10, 11, 9, 30));
  expect(chatTime('9:05 PM', NOW)).toEqual(new Date(2026, 10, 11, 21, 5));
  expect(chatTime('20 December at 10:00', NOW)).toEqual(new Date(2025, 11, 20, 10, 0)); // last year's
  expect(chatTime('sometime', NOW)).toBeNull();
});

test('who is who: you, and messages that name you', () => {
  expect(isMine({ from: 'me' }, ME)).toBe(true);
  expect(isMine({ from: 'mike rosen' }, ME)).toBe(true);
  expect(isMine({ from: 'Dana Levi' }, ME)).toBe(false);
  expect(namesMe({ body: '@Mike can you check?', mentionsMe: false }, ME)).toBe(true);
  expect(namesMe({ body: 'Mike, please review', mentionsMe: false }, ME)).toBe(true);
  expect(namesMe({ body: 'Mikeyim are great', mentionsMe: false }, ME)).toBe(false);
  expect(namesMe({ body: 'review please', mentionsMe: true }, ME)).toBe(true);
  expect(namesMe({ body: 'review please', mentionsMe: false }, ME)).toBe(false);
});

test('only recent asks from others are worth asking about; in a group only when they name you', () => {
  const m = { chat: 'Dana', kind: 'direct' as const, from: 'Dana', mentionsMe: false, time: 'Today at 9:05', body: 'Can you send it?' };
  expect(mayAskOfMe(m, ME, NOW)).toBe(true);
  expect(mayAskOfMe({ ...m, from: 'me' }, ME, NOW)).toBe(false);
  expect(mayAskOfMe({ ...m, time: '9 October at 12:34' }, ME, NOW)).toBe(false); // a month old
  expect(mayAskOfMe({ ...m, body: '[photo]' }, ME, NOW)).toBe(false);
  expect(mayAskOfMe({ ...m, kind: 'group' }, ME, NOW)).toBe(false);
  expect(mayAskOfMe({ ...m, kind: 'group', mentionsMe: true }, ME, NOW)).toBe(true);
  expect(mayAskOfMe({ ...m, kind: 'unknown', body: 'Mike can you send it?' }, ME, NOW)).toBe(true);
});

test('replies that put it off are recognised in English and Hebrew', () => {
  for (const r of ['Will do tomorrow', "I'll check later", 'on it', 'אבדוק מחר', 'אחזור אליך בהמשך']) expect(plainlyDefers(r)).toBe(true);
  for (const r of ['Done, sent it', 'Here it is', 'Yes, approved', 'שלחתי']) expect(plainlyDefers(r)).toBe(false);
});

test('a chat title is the model wording, in any language, or nothing', () => {
  expect(chatTaskTitle('"Send Dana the signed contract."')).toBe('Send Dana the signed contract');
  expect(chatTaskTitle('שלח לדנה את החוזה החתום')).toBe('שלח לדנה את החוזה החתום');
  expect(chatTaskTitle('none')).toBeNull();
  // Vague wording that does not say what was asked is refused (SCR-45); the ask then falls back to "Reply to <name>".
  expect(chatTaskTitle('Tell Ron what he thinks')).toBeNull();
  expect(chatTaskTitle('Tell Ron what you think')).toBeNull();
  expect(chatTaskTitle('Respond to the thanks')).toBeNull();
  expect(chatTaskTitle('Answer Ron: does Tuesday work')).toBe('Answer Ron: does Tuesday work');
  expect(chatTaskTitle('ענה לרון: האם יום שלישי מתאים')).toBe('ענה לרון: האם יום שלישי מתאים');
});

// --- The whole flow -------------------------------------------------------------------------

function seeded(lines: string[], title = 'Dana Levi'): Store {
  const store = new Store(':memory:');
  store.setMeta('my_name', 'Mike Rosen');
  observe(store, lines, at(1), title);
  return store;
}
function observe(store: Store, lines: string[], ts: string, title = 'Dana Levi'): void {
  store.insertObservation({ ts, bundleId: 'net.whatsapp.WhatsApp', app: 'WhatsApp', windowTitle: title, url: null, source: 'ax', text: lines.join('\n') });
}
function reader(asks = true, task = 'Send Dana the signed contract') {
  const asked: ChatQuestion[] = [];
  const read: ChatReader = (q) => { asked.push(q); return { asks, task }; };
  return { read, asked };
}
function judge(verdict: 'settles' | 'defers' | 'unsure') {
  const asked: ReplyQuestion[] = [];
  const j: ReplyJudge = (q) => { asked.push(q); return verdict; };
  return { j, asked };
}
const ASK = [section('Dana Levi', 'direct', 'Dana Levi', 'Today at 9:05'), 'Can you send me the signed contract?'];

test('your name comes from the app (and your mail)', () => {
  const store = seeded([]);
  expect(myNames(store)).toEqual(['Mike Rosen']);
});

test('an ask in a direct chat becomes a task named by the model, under the chat', () => {
  const store = seeded(ASK);
  const { read, asked } = reader();
  expect(pollOnce(store, NOW, { chatReader: read }).chats).toBe(1);
  expect(asked[0]).toMatchObject({ app: 'WhatsApp', chat: 'Dana Levi', group: false, from: 'Dana Levi', message: 'Can you send me the signed contract?' });
  const [task] = store.listTasks();
  expect(task).toMatchObject({ title: 'Send Dana the signed contract', sourceKind: 'chat', sourceRef: 'WhatsApp — Dana Levi', status: 'open' });
  // Seen again: not asked again, not made twice.
  pollOnce(store, NOW, { chatReader: read });
  observe(store, [...ASK, 'x'], at(2));
  pollOnce(store, NOW, { chatReader: read });
  expect(asked.length).toBe(1);
  expect(store.listTasks().length).toBe(1);
  store.close();
});

test('nothing asked, a group message not naming you, or one already answered: no task', () => {
  let store = seeded(ASK);
  pollOnce(store, NOW, { chatReader: reader(false).read });
  expect(store.listTasks()).toEqual([]);
  store.close();

  store = seeded([section('Family', 'group', 'Dana', 'Today at 9:05'), 'Can someone buy milk?'], 'Family');
  const { read, asked } = reader();
  pollOnce(store, NOW, { chatReader: read });
  expect(asked).toEqual([]);
  store.close();

  store = seeded([...ASK, section('Dana Levi', 'direct', 'me', 'Today at 9:20'), 'Sent it just now']);
  const second = reader();
  pollOnce(store, NOW, { chatReader: second.read });
  expect(second.asked).toEqual([]);
  expect(store.listTasks()).toEqual([]);
  store.close();
});

test('your reply that settles it ticks the task, labelled', () => {
  const store = seeded(ASK);
  pollOnce(store, NOW, { chatReader: reader().read });
  observe(store, [section('Dana Levi', 'direct', 'me', 'Today at 9:20'), 'Sent, check your inbox'], at(3));
  const { j, asked } = judge('settles');
  expect(pollOnce(store, NOW, { chatReader: reader().read, replyJudge: j }).completed).toBe(1);
  expect(asked[0]).toMatchObject({ task: 'Send Dana the signed contract', reply: 'Sent, check your inbox' });
  expect(store.listTasks({ all: true })[0]).toMatchObject({ status: 'done', acceptedFrom: 'WhatsApp — Dana Levi' });
  store.close();
});

test('a reply that puts it off never ticks, whatever the model says', () => {
  const store = seeded(ASK);
  pollOnce(store, NOW, { chatReader: reader().read });
  observe(store, [section('Dana Levi', 'direct', 'me', 'Today at 9:20'), "Sure, I'll send it tomorrow"], at(3));
  const { j, asked } = judge('settles');
  expect(pollOnce(store, NOW, { replyJudge: j }).completed).toBe(0);
  expect(asked).toEqual([]); // not even asked
  expect(store.listTasks()[0]!.status).toBe('open');
  expect(store.listTasks()[0]!.suggestion).toBeNull();
  store.close();
});

test('the model saying it is put off keeps it open; unsure, or no model, only asks you', () => {
  for (const [verdict, suggested] of [['defers', false], ['unsure', true], [null, true]] as const) {
    const store = seeded(ASK);
    pollOnce(store, NOW, { chatReader: reader().read });
    observe(store, [section('Dana Levi', 'direct', 'me', 'Today at 9:20'), 'Let me see what I can do'], at(3));
    pollOnce(store, NOW, verdict ? { replyJudge: judge(verdict).j } : {});
    const task = store.listTasks()[0]!;
    expect(task.status).toBe('open');
    expect(task.suggestion !== null).toBe(suggested);
    store.close();
  }
});

test('what is not your reply after the ask never ticks it', () => {
  const cases: string[][] = [
    // Theirs, not yours.
    [section('Dana Levi', 'direct', 'Dana Levi', 'Today at 9:20'), 'Any news?'],
    // Yours, but from before the ask (scrolled up).
    [section('Dana Levi', 'direct', 'me', 'Yesterday at 18:00'), 'Talk tomorrow'],
    // Yours, in another chat.
    [section('Ron', 'direct', 'me', 'Today at 9:30'), 'Done!'],
    // Yours, with a time that cannot be read.
    [section('Dana Levi', 'direct', 'me', 'sometime'), 'Done!'],
  ];
  for (const lines of cases) {
    const store = seeded(ASK);
    pollOnce(store, NOW, { chatReader: reader().read });
    observe(store, lines, at(4), lines[0]!.includes('Ron') ? 'Ron' : 'Dana Levi');
    const { j } = judge('settles');
    expect(pollOnce(store, NOW, { replyJudge: j }).completed).toBe(0);
    expect(store.listTasks()[0]).toMatchObject({ status: 'open', suggestion: null });
    store.close();
  }
});

test('reopening a task ticked by your reply stops replies in that chat ticking it again', () => {
  const store = seeded(ASK);
  pollOnce(store, NOW, { chatReader: reader().read });
  observe(store, [section('Dana Levi', 'direct', 'me', 'Today at 9:20'), 'Sent'], at(3));
  pollOnce(store, NOW, { replyJudge: judge('settles').j });
  const id = store.listTasks({ all: true })[0]!.id;
  store.setStatus(id, 'open', NOW);
  observe(store, [section('Dana Levi', 'direct', 'me', 'Today at 9:40'), 'Sent again'], at(5));
  const { j, asked } = judge('settles');
  expect(pollOnce(store, NOW, { replyJudge: j }).completed).toBe(0);
  expect(asked).toEqual([]);
  expect(store.getTask(id)!.status).toBe('open');
  store.close();
});

test('a group message counts when it asks everyone for their own answer, not when anyone can answer for all', () => {
  for (const b of ['Everyone please confirm by Thursday', '@all vote in the poll', 'כולם תאשרו הגעה עד חמישי', 'כל אחד ישלח את המספר שלו']) expect(asksEveryone({ body: b })).toBe(true);
  for (const b of ['Can someone restart the server?', 'מישהו יכול לבדוק?', 'Ron, can you check?']) expect(asksEveryone({ body: b })).toBe(false);
  const m = { chat: 'Family', kind: 'group' as const, from: 'Dana', mentionsMe: false, time: 'Today at 9:05', body: 'Everyone please confirm by Thursday' };
  expect(mayAskOfMe(m, ME, NOW)).toBe(true);
  expect(mayAskOfMe({ ...m, body: 'Can someone restart the server?' }, ME, NOW)).toBe(false);
});

test('other names you are tagged by count, and the model is told how a group message reaches you', () => {
  const store = seeded([section('Family', 'group', 'Dana', 'Today at 9:05'), '@מייק תוכל להביא את הכיסאות?'], 'Family');
  const { read, asked } = reader();
  pollOnce(store, NOW, { chatReader: read });
  expect(asked).toEqual([]); // not known as yours yet
  store.setMeta('my_other_names', 'מייק');
  observe(store, [section('Family', 'group', 'Dana', 'Today at 9:06'), '@מייק תוכל להביא את השולחן?'], at(2), 'Family');
  pollOnce(store, NOW, { chatReader: read });
  expect(asked.map((q) => q.addressed)).toEqual(['named', 'named']);
  store.close();

  const everyone = seeded([section('Family', 'group', 'Dana', 'Today at 9:05'), 'כולם תאשרו הגעה'], 'Family');
  const second = reader();
  pollOnce(everyone, NOW, { chatReader: second.read });
  expect(second.asked[0]?.addressed).toBe('everyone');
  everyone.close();
});

test('your names: the one you set (or the Mac\'s), your nicknames, then your mail names, once each', () => {
  const store = new Store(':memory:');
  store.setMeta('my_name', 'Mike Rosen');
  store.setMeta('mail_identity', JSON.stringify({ addresses: ['a@x.com'], names: ['Mike Rosen', 'M. Rosen'] }));
  store.setMeta('my_other_names', 'מייק\nRosie');
  expect(myNames(store)).toEqual(['Mike Rosen', 'מייק', 'Rosie', 'M. Rosen']);
  store.setMeta('my_chosen_name', 'Mike');
  expect(myNames(store)).toEqual(['Mike', 'מייק', 'Rosie', 'Mike Rosen', 'M. Rosen']);
  expect(namesOf(store)).toEqual({ mac: 'Mike Rosen', name: 'Mike', mail: ['Mike Rosen', 'M. Rosen'], others: ['מייק', 'Rosie'] });
  store.close();
});

test('your emoji reaction on the ask is weighed as a reply; it does not stop the ask becoming a task', () => {
  const store = seeded([...ASK, section('Dana Levi', 'direct', 'me', 'Today at 9:05'), '[reacted 👍 to “Can you send me the signed contract?”]']);
  const { read, asked } = reader();
  pollOnce(store, NOW, { chatReader: read });
  expect(asked.length).toBe(1); // a reaction is not taken as the answer before the model is asked
  const { j, asked: judged } = judge('defers'); // 👍 to "send it" means "will do"
  observe(store, ['x'], at(2));
  pollOnce(store, NOW, { replyJudge: j });
  expect(judged[0]?.reply).toBe('[reacted 👍 to “Can you send me the signed contract?”]');
  expect(store.listTasks()[0]!.status).toBe('open');
  store.close();
});

test('a task worded around you is dropped: the model misread who asks whom', () => {
  const store = seeded([section('Team', 'group', 'Lena Hale', 'Today at 9:05'), 'Thanks Mike! 🎂'], 'Team');
  pollOnce(store, NOW, { chatReader: reader(true, 'Lena Hale ask Mike Rosen to respond to birthday message').read });
  expect(store.listTasks()).toEqual([]);
  store.close();
});

test('chat tasks are never judged done from some other screen', () => {
  const store = seeded(ASK);
  pollOnce(store, NOW, { chatReader: reader().read });
  expect(store.tasksToWatch()).toEqual([]);
  store.close();
});

test('a reply of only emoji, or a reaction, never ticks: at most it asks you', () => {
  expect(isEmojiOnly('👍')).toBe(true);
  expect(isEmojiOnly('🙏❤️ ')).toBe(true);
  expect(isEmojiOnly('👍🏽')).toBe(true);
  expect(isEmojiOnly('Done 👍')).toBe(false);
  expect(isEmojiOnly('911')).toBe(false);
  for (const reply of ['👍', '[reacted 👍 to “Can you send me the signed contract?”]']) {
    const store = seeded(ASK);
    pollOnce(store, NOW, { chatReader: reader().read });
    observe(store, [section('Dana Levi', 'direct', 'me', 'Today at 9:20'), reply], at(3));
    expect(pollOnce(store, NOW, { replyJudge: judge('settles').j }).completed).toBe(0);
    const task = store.listTasks()[0]!;
    expect(task.status).toBe('open');
    expect(task.suggestion).not.toBeNull(); // "looks done?" for you to answer
    store.close();
  }
});

test('👍 to an ask that only wants you to acknowledge it ticks it; to anything else it only asks', () => {
  expect(asksForAcknowledgement('תאשר שקיבלת')).toBe(true);
  expect(asksForAcknowledgement('Please confirm you got the invite')).toBe(true);
  expect(asksForAcknowledgement('Did you see the deck?')).toBe(true);
  expect(asksForAcknowledgement('Send me the signed contract')).toBe(false);
  const ack = [section('Book Club', 'group', 'מעדכנת', 'Today at 9:05', ', mentions me'), '1215 תדריך מצטרפים\nתאשר שקיבלת'];
  for (const reply of ['[reacted 👍 to “1215 תדריך מצטרפים”]', '👍']) {
    const store = seeded(ack, 'Book Club');
    pollOnce(store, NOW, { chatReader: reader(true, 'תאשר שקיבלת').read });
    observe(store, [section('Book Club', 'group', 'me', 'Today at 9:20'), reply], at(3), 'Book Club');
    const { j, asked } = judge('defers');
    expect(pollOnce(store, NOW, { replyJudge: j }).completed).toBe(1);
    expect(asked).toEqual([]); // no model needed
    expect(store.listTasks({ all: true })[0]!.status).toBe('done');
    store.close();
  }
  // A thumbs down is not an acknowledgement.
  const store = seeded(ack, 'Book Club');
  pollOnce(store, NOW, { chatReader: reader(true, 'תאשר שקיבלת').read });
  observe(store, [section('Book Club', 'group', 'me', 'Today at 9:20'), '👎'], at(3), 'Book Club');
  expect(pollOnce(store, NOW, { replyJudge: judge('settles').j }).completed).toBe(0);
  store.close();
});

test('your reaction from WhatsApp\'s chat list answers the ask it names, whenever it was made; on another message it does not', () => {
  const ack = [section('Book Club', 'direct', 'Book Club', 'Today at 9:05'), '1215 תדריך מצטרפים', 'תאשר שקיבלת'];
  const store = seeded(ack, 'Book Club');
  pollOnce(store, NOW, { chatReader: reader(true, 'תאשר שקיבלת').read });
  expect(store.listTasks().length).toBe(1);
  // On some other message: nothing.
  observe(store, [section('Book Club', 'unknown', 'me', 'reaction'), '[reacted 👍 to “Good morning”]'], at(2), 'Book Club');
  expect(pollOnce(store, NOW, { replyJudge: judge('settles').j }).completed).toBe(0);
  // On the ask (its first line, bold marks and all): ticked.
  observe(store, [section('Book Club', 'unknown', 'me', 'reaction'), '[reacted 👍 to “*1215 תדריך מצטרפים*”]'], at(3), 'Book Club');
  expect(pollOnce(store, NOW, {}).completed).toBe(1);
  expect(store.listTasks({ all: true })[0]!.status).toBe('done');
  store.close();
});

test('a reaction seen as plain text ("You reacted 👍 to "…"") answers the open ask whose first line it quotes', () => {
  const ack = [section('Book Club', 'direct', 'Book Club', 'Today at 9:05'), '1215 תדריך מצטרפים', 'תאשר שקיבלת'];
  const store = seeded(ack, 'Book Club');
  pollOnce(store, NOW, { chatReader: reader(true, 'תאשר שקיבלת').read });
  // Elsewhere in WhatsApp (the chat list), with no chat named.
  observe(store, ['You reacted 👍 to "Good morning all"'], at(2), 'WhatsApp');
  expect(pollOnce(store, NOW, {}).completed).toBe(0);
  observe(store, ['\u200eYou reacted 👍 to "*1215 תדריך מצטרפים*', 'תאשר שקיבלת 🌾"'], at(3), 'WhatsApp');
  expect(pollOnce(store, NOW, {}).completed).toBe(1);
  store.close();
});

test('two people asking the same thing are two tasks, never merged with each other or a finished one', () => {
  const store = seeded([section('Book Club', 'direct', 'Book Club', 'Today at 9:05'), 'תאשר שקיבלת'], 'Book Club');
  pollOnce(store, NOW, { chatReader: reader(true, 'תאשר שקיבלת').read });
  store.setStatus(store.listTasks()[0]!.id, 'done', NOW);
  store.insertObservation({ ts: at(2), bundleId: 'com.microsoft.teams2', app: 'Microsoft Teams', windowTitle: 'Chat', url: null, source: 'ax',
    text: [section('Sam Carter', 'direct', 'Sam Carter', 'Today at 9:30'), 'Please confirm you received the files'].join('\n') });
  expect(pollOnce(store, NOW, { chatReader: reader(true, 'תאשר שקיבלת').read }).chats).toBe(1);
  const all = store.listTasks({ all: true });
  expect(all.map((t) => [t.sourceRef, t.status])).toEqual([['WhatsApp — Book Club', 'done'], ['Teams — Sam Carter', 'open']]);
  store.close();
});

// --- SCR-45: a live conversation is not a task per message ----------------------------------

const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const asking = (time: string, body: string, chat = 'Dana Levi') => [section(chat, 'direct', chat, time), body];
const mine = (time: string, body: string, chat = 'Dana Levi') => [section(chat, 'direct', 'me', time), body];

test('an ask answered while the conversation goes on never becomes a task', () => {
  const store = seeded(asking('Today at 9:58', 'Is Tuesday OK for you?'));
  const { read } = reader(true, 'Answer Dana: is Tuesday OK');
  pollOnce(store, NOW, { chatReader: read });
  expect(store.listTasks()).toEqual([]); // waiting for a reply
  observe(store, mine('Today at 9:59', 'Yes, Tuesday works'), at(2));
  pollOnce(store, later(2), { chatReader: read });
  pollOnce(store, later(20), { chatReader: read });
  expect(store.listTasks()).toEqual([]);
  store.close();
});

test('an ask left without a reply for 10 minutes becomes a task, even when the chat is no longer on screen', () => {
  const store = seeded(asking('Today at 9:58', 'Can you send the slides?'));
  const { read } = reader(true, 'Send Dana the slides');
  pollOnce(store, NOW, { chatReader: read });
  expect(store.listTasks()).toEqual([]);
  pollOnce(store, later(5), { chatReader: read });
  expect(store.listTasks()).toEqual([]); // 7 minutes: still waiting
  pollOnce(store, later(9), { chatReader: read }); // nothing new on screen, 11 minutes after the ask
  expect(store.listTasks().map((t) => t.title)).toEqual(['Send Dana the slides']);
  store.close();
});

test('several asks in one chat are one task, reworded to the newest, and one reply settles it', () => {
  const store = seeded([
    ...asking('Today at 9:20', 'Did you see the link?'),
    ...asking('Today at 9:25', 'Is 20 options enough?'),
    ...asking('Today at 9:30', 'Is this really good?'),
  ]);
  let n = 0;
  const titles = ['Check the link Dana sent', 'Answer Dana: are 20 options enough', 'Answer Dana: is it really good'];
  const read: ChatReader = () => ({ asks: true, task: titles[n++]! });
  pollOnce(store, NOW, { chatReader: read });
  const open = store.listTasks();
  expect(open.length).toBe(1);
  expect(open[0]).toMatchObject({ title: 'Answer Dana: is it really good · +2', sourceRef: 'WhatsApp — Dana Levi' });
  expect(open[0]!.criteria?.chat).toMatchObject({ asks: 3 });
  // Your reply after the newest ask settles the conversation's one task.
  observe(store, mine('Today at 9:40', 'Yes, all good, and I saw the link'), at(3));
  const { j } = judge('settles');
  expect(pollOnce(store, later(1), { replyJudge: j }).completed).toBe(1);
  expect(store.listTasks()).toEqual([]);
  store.close();
});

test('a reply only counts in its own chat, and one that puts things off answers nothing', () => {
  // A reply in another chat leaves this ask waiting.
  let store = seeded(asking('Today at 9:58', 'Can you send the slides?'));
  pollOnce(store, NOW, { chatReader: reader(true, 'Send Dana the slides').read });
  observe(store, mine('Today at 9:59', 'Sure', 'Ron'), at(2), 'Ron');
  pollOnce(store, later(15), {});
  expect(store.listTasks().map((t) => t.title)).toEqual(['Send Dana the slides']);
  store.close();

  // "I'll do it later" is not an answer.
  store = seeded(asking('Today at 9:58', 'Can you send the slides?'));
  pollOnce(store, NOW, { chatReader: reader(true, 'Send Dana the slides').read });
  observe(store, mine('Today at 9:59', "I'll send it tomorrow"), at(2));
  pollOnce(store, later(15), {});
  expect(store.listTasks().map((t) => t.title)).toEqual(['Send Dana the slides']);
  store.close();
});

test('a new ask after a "looks done" reopens the question: the task waits for your next reply', () => {
  const store = seeded(asking('Today at 9:20', 'Can you send the slides?'));
  pollOnce(store, NOW, { chatReader: reader(true, 'Send Dana the slides').read });
  observe(store, mine('Today at 9:30', 'Here'), at(2));
  pollOnce(store, later(1), { replyJudge: judge('unsure').j });
  expect(store.listTasks()[0]!.suggestion).not.toBeNull();
  observe(store, asking('Today at 9:35', 'And the budget too?'), at(3));
  pollOnce(store, later(2), { chatReader: reader(true, 'Send Dana the budget').read });
  const [task] = store.listTasks();
  expect(task).toMatchObject({ title: 'Send Dana the budget · +1', suggestion: null });
  store.close();
});

test('once: open tasks already made one per message in a chat are folded into one', () => {
  const store = new Store(':memory:');
  store.setMeta('my_name', 'Mike Rosen');
  const make = (i: number, chat: string) => store.upsertTask({
    distinct: `chat:WhatsApp:${chat}:${chat}:9:0${i}:k${i}`, title: `Ask ${i} in ${chat}`, sourceKind: 'chat', sourceRef: `WhatsApp — ${chat}`,
    confidence: 1, position: null, ts: at(i), observationId: null, markers: [],
    criteria: { service: null, hosts: [], chat: { app: 'WhatsApp', chat, from: chat, at: at(i), key: `k${i}` } },
  }).id;
  make(1, 'Dana Levi'); make(2, 'Dana Levi'); const newest = make(3, 'Dana Levi'); make(4, 'Ron');
  pollOnce(store, NOW, {});
  // The earlier two are merged into the newest: they leave the list and finish with it.
  expect(store.openChatTask('WhatsApp', 'Dana Levi')!.id).toBe(newest);
  expect(store.mergedWith(newest).length).toBe(2);
  expect(store.openChatTask('WhatsApp', 'Ron')).not.toBeNull();
  // Only once: later duplicates are prevented when they are made, not folded again.
  expect(store.getMeta('chat_conversations_folded')).not.toBeNull();
  store.close();
});
