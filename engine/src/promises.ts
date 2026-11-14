/**
 * Promises you make in your own messages (SCR-98): "I'll send the slides tomorrow", "I will get back
 * to you on the quote by Friday", "אשלח את הקובץ מחר". Read by wording only, no model.
 *
 * Only first person, future, and not hedged: "I'll try", "perhaps I'll", "if I can", "let's catch up
 * sometime" and questions are not promises. A promise is "sure" when it names something concrete to
 * do (send the slides, call the bank, get back to you on the quote). A vaguer one ("I'll look into
 * the invoice", "I'll send it") is not sure: it is only suggested, never a task by itself. A verb
 * with nothing after it ("I'll check", "I'll get back to you") is not read as a promise at all.
 *
 * A promise never ticks anything by itself. Its task is settled by you: a later message of yours in
 * the same conversation only asks "looks done?".
 */

export interface Promise_ {
  /** What you said you'd do, in your words, without the time: "send the slides". */
  what: string;
  /** The sentence it came from, for reading its due date. */
  sentence: string;
  /** Wording alone says it is a concrete promise. */
  sure: boolean;
  lang: 'en' | 'he';
}

/** Verbs that name something to deliver or do. */
const SURE_EN = [
  'send', 'share', 'forward', 'email', 'mail', 'call', 'ring', 'text', 'pay', 'transfer', 'sign', 'book',
  'review', 'submit', 'finish', 'fix', 'update', 'upload', 'prepare', 'write', 'draft', 'order', 'buy',
  'schedule', 'set up', 'get back to you', 'follow up', 'confirm', 'return', 'deliver', 'renew', 'cancel',
];
/** Verbs that promise something, but not what: only suggested. */
const VAGUE_EN = ['check', 'look into', 'look at', 'handle', 'take care of', 'sort out', 'deal with', 'see about'];

const FIRST_FUTURE_EN = /\b(?:i\s*(?:'|’)?\s*ll|i will|i'm going to|i’m going to|i am going to|i shall)\s+(?:also\s+|definitely\s+|just\s+|first\s+|quickly\s+)?/i;
const HEDGED_EN = /\b(if|may ?be|perhaps|probably|might|may|try|trying|hopefully|sometime|someday|one day|at some point|whenever|unless|could|would|not|never|won'?t|can'?t)\b/i;
const SOCIAL_EN = /\b(let'?s|we should|catch up|grab (?:a )?(?:coffee|lunch|drinks?)|think about it|keep you posted|see you|talk soon|be there|let you know)\b/i;

/** Words that only point back or name a time: an object made only of these is not concrete. */
const EMPTY_EN = new Set([
  'it', 'that', 'this', 'them', 'those', 'these', 'you', 'him', 'her', 'one', 'something', 'stuff', 'things',
  'thing', 'over', 'out', 'up', 'back', 'to', 'on', 'the', 'a', 'an', 'asap', 'later', 'soon', 'today',
  'tonight', 'tomorrow', 'now', 'shortly', 'then', 'again', 'too', 'as', 'well', 'for', 'with', 'me', 'us',
]);

/** Trailing time words, taken off what was promised (the due date reads them separately). */
const WHEN_EN = '(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|week|weekend|month|morning|afternoon|evening|day|\\d)';
const TIME_TAIL_EN = new RegExp(
  `\\s+(?:(?:by|before|until|till|first thing|end of|eod|eow|cob|asap|right away|later|tomorrow|today|tonight|soon|shortly|in a bit)\\b|(?:on|this|next|at|in the|after the|after)\\s+${WHEN_EN}).*$`,
  'i',
);

/** Hebrew first-person future verbs and their infinitive, for the title. */
const HE_VERBS: { first: string; inf: string; sure: boolean }[] = [
  { first: 'אשלח', inf: 'לשלוח', sure: true },
  { first: 'אעביר', inf: 'להעביר', sure: true },
  { first: 'אחזור אליך', inf: 'לחזור אליך', sure: true },
  { first: 'אחזור אלייך', inf: 'לחזור אלייך', sure: true },
  { first: 'אחזור אליכם', inf: 'לחזור אליכם', sure: true },
  { first: 'אתקשר', inf: 'להתקשר', sure: true },
  { first: 'אשלם', inf: 'לשלם', sure: true },
  { first: 'אחתום', inf: 'לחתום', sure: true },
  { first: 'אכין', inf: 'להכין', sure: true },
  { first: 'אזמין', inf: 'להזמין', sure: true },
  { first: 'אעדכן', inf: 'לעדכן', sure: true },
  { first: 'אבדוק', inf: 'לבדוק', sure: false },
  { first: 'אטפל', inf: 'לטפל', sure: false },
  { first: 'אסדר', inf: 'לסדר', sure: false },
];
const HEDGED_HE = /(^|[^\p{L}])(אם|אולי|אנסה|ננסה|כנראה|מתישהו|פעם|לא)($|[^\p{L}])/u;
const EMPTY_HE = new Set([
  'לך', 'לכם', 'לכן', 'את', 'זה', 'זאת', 'אותו', 'אותה', 'אותם', 'אותן', 'מחר', 'היום', 'הערב', 'בערב',
  'בבוקר', 'עוד', 'מעט', 'אחר', 'כך', 'בהמשך', 'השבוע', 'בשבוע', 'הבא', 'עד', 'בקרוב', 'כבר', 'גם', 'על',
  'אליך', 'אלייך', 'אליכם', 'שוב',
]);
const TIME_TAIL_HE = /\s+(?:מחר|היום|הערב|בערב|בבוקר|עוד מעט|אחר כך|בהמשך|השבוע|בשבוע הבא|עד|לפני|ביום|בקרוב|מאוחר יותר)(?:$|[^\p{L}].*$)/u;

/** The sentences of a message, without quoted lines. */
function sentences(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((l) => !/^\s*>/.test(l))
    .flatMap((l) => l.split(/(?<=[.!?])\s+|;\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

function concrete(object: string, empty: Set<string>): boolean {
  return object
    .toLowerCase()
    .split(/[^\p{L}\p{N}'’]+/u)
    .some((w) => w.length >= 2 && !empty.has(w));
}

function clean(what: string): string {
  return what.replace(/[\s,.:;!—-]+$/u, '').replace(/\s+/g, ' ').trim().slice(0, 100);
}

function englishPromise(sentence: string): Promise_ | null {
  const m = sentence.match(FIRST_FUTURE_EN);
  if (!m || m.index === undefined) return null;
  const before = sentence.slice(0, m.index);
  const after = sentence.slice(m.index + m[0].length);
  // Hedged, conditional, negative or social: not a promise.
  // A condition anywhere ("…if I find it") makes it no promise; a hedge before the verb too.
  if (HEDGED_EN.test(before) || HEDGED_EN.test(after.split(/\s+/).slice(0, 3).join(' '))) return null;
  if (/\b(if|unless|may ?be|perhaps|hopefully)\b/i.test(after)) return null;
  if (SOCIAL_EN.test(sentence)) return null;
  const lower = after.toLowerCase();
  const sureVerb = SURE_EN.find((v) => lower === v || lower.startsWith(`${v} `) || lower.startsWith(`${v},`) || lower.startsWith(`${v}.`));
  const vagueVerb = sureVerb ? undefined : VAGUE_EN.find((v) => lower === v || lower.startsWith(`${v} `) || lower.startsWith(`${v}.`));
  const verb = sureVerb ?? vagueVerb;
  if (!verb) return null;
  const rest = after.slice(verb.length);
  const object = rest.replace(TIME_TAIL_EN, '');
  // The verb alone ("I'll check", "I'll get back to you") says nothing to hold you to.
  if (clean(object) === '') return null;
  const what = clean(`${after.slice(0, verb.length)}${object}`);
  // "get back to you" is concrete only with what about: "get back to you on the quote".
  const objectWords = verb === 'get back to you' ? object.replace(/^\s*(on|about|re|regarding)\b/i, '') : object;
  const sure = !!sureVerb && (verb === 'get back to you' ? /^\s*(on|about|re|regarding)\b/i.test(object) && concrete(objectWords, EMPTY_EN) : concrete(objectWords, EMPTY_EN));
  return { what, sentence, sure, lang: 'en' };
}

function hebrewPromise(sentence: string): Promise_ | null {
  for (const v of HE_VERBS) {
    const at = sentence.search(new RegExp(`(^|[^\\p{L}])${v.first}($|[^\\p{L}])`, 'u'));
    if (at < 0) continue;
    const start = sentence.indexOf(v.first, at);
    const before = sentence.slice(0, start);
    const after = sentence.slice(start + v.first.length);
    if (HEDGED_HE.test(before) || HEDGED_HE.test(after.trim().split(/\s+/).slice(0, 2).join(' '))) return null;
    if (/\?\s*$/.test(sentence)) return null;
    const object = after.replace(TIME_TAIL_HE, '');
    if (clean(object) === '') return null;
    const what = clean(`${v.inf}${object}`);
    return { what, sentence, sure: v.sure && concrete(object, EMPTY_HE), lang: 'he' };
  }
  return null;
}

/**
 * The promises in a message of yours, at most one per sentence. A question is never a promise
 * ("I'll send it, ok?" is asking).
 */
export function promisesIn(text: string): Promise_[] {
  const out: Promise_[] = [];
  for (const s of sentences(text)) {
    if (/\?\s*$/.test(s)) continue;
    const p = englishPromise(s) ?? hebrewPromise(s);
    if (p && !out.some((o) => o.what.toLowerCase() === p.what.toLowerCase())) out.push(p);
  }
  return out;
}

/** The task's title: "You said you'd: send the slides", "הבטחת: לשלוח את הקובץ". */
export function promiseTitle(p: Pick<Promise_, 'what' | 'lang'>): string {
  return p.lang === 'he' ? `הבטחת: ${p.what}` : `You said you'd: ${p.what}`;
}

/** Two wordings of the same promise: the same words, ignoring case, punctuation and time. */
export function samePromise(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/^(you said you'd|הבטחת):\s*/u, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return norm(a) === norm(b);
}
