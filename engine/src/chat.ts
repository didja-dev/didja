/**
 * Chat apps (WhatsApp, Teams, Slack). The capture layer labels each message of the open
 * conversation (see app/Capture/ChatAdapter.swift):
 *
 *     ⟦Chat message: Dana Levi (direct) — from Dana Levi — 9 October at 12:34⟧
 *     Can you send me the signed contract?
 *
 * Rules (the maintainer, 2026-11-11): a message from someone else that asks you to do something becomes a
 * task. In a one-to-one chat any such ask counts; in a group only one that @mentions or names you.
 * Your reply after it ticks the task, unless the model reads the reply as putting it off.
 */
import { matchesApp, profiles } from './profiles.ts';
import type { Observation } from './store.ts';
import type { Teaching } from './store.ts';

/** The chat app a window belongs to ("WhatsApp"), by the app profiles, or null. */
export function chatApp(window: Pick<Observation, 'bundleId'>): string | null {
  const p = profiles().find((p) => p.kind === 'chat' && matchesApp(p, window.bundleId));
  return p?.name ?? null;
}

export type ChatKind = 'direct' | 'group' | 'unknown';

export interface ChatMessage {
  chat: string;
  kind: ChatKind;
  /** The sender as shown, or "me" where the app says so (WhatsApp). */
  from: string;
  /** The app flagged it as mentioning you (Teams). */
  mentionsMe: boolean;
  time: string;
  body: string;
}

const SECTION = /^⟦Chat message: (.*) \((direct|group|unknown)\) — from (.*?)(, mentions me)? — (.*)⟧$/;

/** The labelled messages in a window's text, in order. */
export function parseChatMessages(text: string): ChatMessage[] {
  const out: ChatMessage[] = [];
  let current: ChatMessage | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('⟦')) {
      const m = line.match(SECTION);
      current = m
        ? { chat: m[1]!, kind: m[2] as ChatKind, from: m[3]!, mentionsMe: m[4] !== undefined, time: m[5]!, body: '' }
        : null;
      if (current) out.push(current);
      continue;
    }
    if (current && line.trim() !== '') current.body = current.body ? `${current.body}\n${line.trim()}` : line.trim();
  }
  // Reactions read from a chat list share one section per chat ("— from me — reaction"): each line is its own.
  return out.flatMap((m) => (m.time === 'reaction' && m.body.includes('\n')
    ? m.body.split('\n').filter((l) => l.startsWith('[reacted ')).map((body) => ({ ...m, body }))
    : [m]));
}

/** Whether a message is yours: "me", or sent under one of your names. */
export function isMine(message: Pick<ChatMessage, 'from'>, names: string[]): boolean {
  const from = message.from.trim().toLowerCase();
  if (from === 'me' || from === 'you') return true;
  return names.some((n) => n.trim().toLowerCase() === from);
}

/** Whether a message names you: an @mention, or one of your names (or first names) as a word. */
export function namesMe(message: Pick<ChatMessage, 'body' | 'mentionsMe'>, names: string[]): boolean {
  if (message.mentionsMe) return true;
  const body = message.body.toLowerCase();
  const words = new Set<string>();
  for (const n of names) {
    const name = n.trim().toLowerCase();
    if (name.length >= 2) words.add(name);
    const first = name.split(/\s+/)[0] ?? '';
    if (first.length >= 3) words.add(first);
  }
  for (const w of words) {
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^\\p{L}\\p{N}])@?${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(body)) return true;
  }
  return false;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * When a message was sent, from what the app shows: "Today at 9:05", "Yesterday at 21:10",
 * "Monday at 9:05", "9 October at 12:34", "9 November 2026 12:34", "12:34" (today).
 * Local time. Null when it cannot be read.
 */
export function chatTime(shown: string, now: Date = new Date()): Date | null {
  const s = shown.trim().toLowerCase().replace(/\s+/g, ' ');
  const clock = s.match(/(\d{1,2}):(\d{2})(?: ?([ap])m)?$/);
  if (!clock) return null;
  let hour = Number(clock[1]);
  const minute = Number(clock[2]);
  if (clock[3] === 'p' && hour < 12) hour += 12;
  if (clock[3] === 'a' && hour === 12) hour = 0;
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
  const head = s.slice(0, clock.index).replace(/\bat\s*$/, '').trim().replace(/,$/, '');
  if (head === '' || head === 'today') return day;
  if (head === 'yesterday') return new Date(day.getTime() - 24 * 3600_000);
  const weekday = DAYS.indexOf(head);
  if (weekday >= 0) {
    const back = (now.getDay() - weekday + 7) % 7 || 7;
    return new Date(day.getTime() - back * 24 * 3600_000);
  }
  const dated = head.match(/^(\d{1,2}) ([a-z]+)(?: (\d{4}))?$/) ?? head.match(/^([a-z]+) (\d{1,2})(?:,? (\d{4}))?$/);
  if (dated) {
    const [dayText, monthText] = /^\d/.test(dated[1]!) ? [dated[1]!, dated[2]!] : [dated[2]!, dated[1]!];
    const month = MONTHS.findIndex((m) => m.startsWith(monthText) && monthText.length >= 3);
    if (month < 0) return null;
    let year = dated[3] ? Number(dated[3]) : now.getFullYear();
    let when = new Date(year, month, Number(dayText), hour, minute);
    if (!dated[3] && when.getTime() > now.getTime() + 24 * 3600_000) when = new Date(--year, month, Number(dayText), hour, minute);
    return when;
  }
  return null;
}

/** How far back a message may be to become a task: the last three days. */
export const RECENT_MS = 3 * 24 * 3600_000;

export function isRecentChat(message: Pick<ChatMessage, 'time'>, now: Date = new Date()): boolean {
  const when = chatTime(message.time, now);
  if (!when) return false;
  const age = now.getTime() - when.getTime();
  return age > -3600_000 && age < RECENT_MS;
}

const EVERYONE = /(^|[^\p{L}])(@all|@everyone|@channel|@here|everyone|everybody|all of you|each of you|every one of you|כולם|כל אחד|כל אחת|כל מי ש|כל החברים|כל המשתתפים)($|[^\p{L}])/iu;

/**
 * A group message that asks each person for their own answer ("everyone, please confirm", "כולם
 * תאשרו הגעה", @all): it is asked of you too. "Can someone…" is not: anyone can answer for all.
 */
export function asksEveryone(message: Pick<ChatMessage, 'body'>): boolean {
  return EVERYONE.test(message.body);
}

/**
 * Worth asking the model about: from someone else, recent, with words in it, and in a group (or
 * where it is not known whether it is one) only when it tags or names you, or asks everyone for
 * their own answer (the maintainer: no random requests meant for other people in the group).
 */
export function mayAskOfMe(message: ChatMessage, names: string[], now: Date = new Date()): boolean {
  if (isMine(message, names)) return false;
  const words = message.body.replace(/^\[[^\]]+\]\s*/, '').trim();
  if (words.length < 3) return false;
  if (!isRecentChat(message, now)) return false;
  if (message.kind !== 'direct' && !namesMe(message, names) && !asksEveryone(message)) return false;
  return true;
}

/**
 * A message that was sent once the chat was already on screen, rather than one that was
 * there before you first looked (or that scrolling back brought up). Times are shown to the
 * minute, so the minute you first saw the chat still counts. An unreadable time never does.
 */
export function arrivedWhileShown(message: ChatMessage, firstShown: Date, now: Date = new Date()): boolean {
  const sent = chatTime(message.time, now);
  if (sent === null) return false;
  const minute = new Date(firstShown);
  minute.setSeconds(0, 0);
  return sent.getTime() >= minute.getTime();
}

/** One message, for linking it to its task and remembering what the model said. */
export function chatKey(app: string, m: ChatMessage): string {
  return `chat:${app}:${m.chat}:${m.from}:${m.time}:${lineHash(m.body)}`;
}

/** A message's identity from its first line only: more of a long message can arrive later, and it
 * is still the same message. Bold and italic marks do not count. */
export function lineHash(body: string): string {
  let hash = 0;
  const first = (body.split('\n')[0] ?? '').replace(/[*_~]/g, '').trim().slice(0, 200);
  for (const ch of first) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return hash.toString(36);
}

/**
 * Your reactions as WhatsApp's chat list shows them in plain text, "You reacted 👍 to "…"",
 * with the first line of the message reacted to. The chat is not named there; the message is.
 */
export function plainReactions(text: string): { emoji: string; quote: string }[] {
  const out: { emoji: string; quote: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.replace(/[\u200e\u200f]/g, '').match(/^You reacted (\S+) to ["“](.*?)["”]?$/);
    if (m && m[2]!.trim()) out.push({ emoji: m[1]!, quote: m[2]!.replace(/[*_~]/g, '').trim() });
  }
  return out;
}

/** The message a reaction is on, by its first line: "[reacted 👍 to “…”]" → "…". */
export function reactedTo(body: string): string | null {
  return body.match(/^\[reacted .+? to “(.*)”\]$/s)?.[1] ?? null;
}

/** Where a chat task came from, for its group in the list: "WhatsApp — Dana Levi". */
export function chatSourceRef(app: string, chat: string): string {
  return chat.trim() ? `${app} — ${chat.trim()}` : app;
}

/** What the model is shown about a message: the chat, who you are, and the few messages before it. */
export interface ChatQuestion {
  app: string;
  chat: string;
  group: boolean;
  /** In a group: how the message reaches you. */
  addressed?: 'named' | 'everyone';
  me: string[];
  from: string;
  message: string;
  /** Up to six messages before it, oldest first, "me" for yours. */
  before: { from: string; text: string }[];
  teach?: Teaching;
}

export interface ChatAnswer {
  /** The message asks the reader to do something (and, in a group, it is addressed to them). */
  asks: boolean;
  /** What to do, as an instruction naming the person. */
  task: string;
}

export type ChatReader = (question: ChatQuestion) => ChatAnswer | null;

/** Your reply to an ask: does it settle it, or put it off? */
export interface ReplyQuestion {
  app: string;
  task: string;
  ask: string;
  reply: string;
  teach?: Teaching;
}

export type ReplyVerdict = 'settles' | 'defers' | 'unsure';
export type ReplyJudge = (question: ReplyQuestion) => ReplyVerdict | null;

const DEFERRING = /\b(later|tomorrow|tonight|next week|next month|soon|will (?:do|check|look|send|get back)|i'?ll (?:do|check|look|send|get back|try)|get back to you|on it|after (?:the|my|lunch|work)|when i (?:can|get)|not yet|in a bit|in a minute|remind me)\b|אחר כך|מחר|בהמשך|אחזור|אבדוק|אשלח|בקרוב|עוד מעט|לא עכשיו/i;

/**
 * A reply that plainly puts the ask off ("later", "tomorrow", "I'll check"), whatever the model says.
 * A wrong tick is the bug this app exists to prevent: such a reply never ticks.
 */
export function plainlyDefers(reply: string): boolean {
  return DEFERRING.test(reply);
}

/**
 * A reply that is only emoji (👍, 🙏❤️). Like a reaction, it never ticks a task by itself: 👍 to
 * "can you send it?" means "will do". At most it asks you.
 */
export function isEmojiOnly(body: string): boolean {
  const t = body.trim();
  return t !== '' && /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Emoji_Component}\u200d\ufe0f\s]+$/u.test(t) && !/^[\d#*\s]+$/.test(t);
}

const ACKNOWLEDGE = /\b(confirm|acknowledge|ack|let me know (?:you|that you|if you) (?:got|received|saw)|did you (?:get|receive|see)|got it\?|received\?|seen\?)\b|תאשר|תאשרי|תאשרו|אשר(?:ו|י)? ש|קיבלת|שקיבלת|קיבלתם|ראית|ראיתם|תעדכן שקיבלת/i;
const POSITIVE = /👍|✅|👌|🙏|❤️|❤|💯|☑️|✔️|🆗|👏|🤝/u;

/**
 * An ask that only wants you to acknowledge or confirm ("confirm you got it", "תאשר שקיבלת",
 * "did you see this?"). For these a 👍 is the whole answer (the maintainer: "thumbs up meant I got it").
 */
export function asksForAcknowledgement(...texts: string[]): boolean {
  return texts.some((t) => ACKNOWLEDGE.test(t));
}

/** A positive emoji: 👍 ✅ 👌 🙏 ❤️ and the like. */
export function isPositiveEmoji(body: string): boolean {
  return POSITIVE.test(body);
}

/** Your emoji reaction, as capture writes it: "[reacted ❤️ to “Happy birthday”]". */
export function isReaction(body: string): boolean {
  return body.startsWith('[reacted ');
}

/** The model's wording for a chat task: one line, no quotes, 3 to 120 characters, any language. Null if unusable. */
const VAGUE_TASK = /\bwhat (he|she|they|you|i) (think|thinks|want|wants|wants to remember|meant?)\b|^(reply|respond)( to)?( the)? (message|thanks)$/i;

export function chatTaskTitle(raw: string): string | null {
  const title = (raw.split(/\r?\n/)[0] ?? '')
    .replace(/^["“”'‘’\s]+|["“”'‘’\s.:;,]+$/g, '')
    .replace(/\s+/g, ' ');
  if (title.length < 3 || title.length > 120 || !/\p{L}{2}/u.test(title) || /^none$/i.test(title)) return null;
  // Vague wording that says nothing about what was asked (SCR-45): "Tell Ron what he thinks".
  if (VAGUE_TASK.test(title)) return null;
  return title;
}
