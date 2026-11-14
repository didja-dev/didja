/**
 * Waiting on (SCR-99): an ask you sent someone ("Can you send me the signed contract?", "Sam, please
 * review the PR", "תוכל לשלוח את החוזה?") is kept as a separate kind of item, "Waiting on Sam: the
 * signed contract". It is not a task of yours: it is never ticked and never counted. It closes as
 * answered when a message from that person arrives in the same chat or email conversation after
 * the ask, or when you say "Got it" or "Stop waiting".
 *
 * Read by wording only, no model. Only a plain ask with something concrete in it: "can you…?",
 * "could you…?", "please…", "can I get…?", with a verb that names something to hand over or do.
 * "Can you send it?", "let me know", "thoughts?" and the like are not taken.
 */

export interface YourAsk {
  /** What you asked for, without the time: "the signed contract", "review the PR". */
  what: string;
  /** The name you addressed it to at the start ("Sam, can you…"), or null. */
  to: string | null;
  lang: 'en' | 'he';
}

/** Verbs whose object is the thing asked for: "send me the contract" → "the contract". */
const HAND_OVER_EN = ['send', 'share', 'forward', 'email', 'give', 'get', 'pass', 'resend'];
const DO_EN = [
  'sign', 'review', 'approve', 'confirm', 'check', 'look at', 'update', 'fix', 'call', 'pay', 'book', 'schedule',
  'submit', 'upload', 'prepare', 'write', 'draft', 'merge', 'finish', 'order', 'renew', 'transfer',
];
const ASK_EN = /^(?:(?:can|could|would|will) you(?: please| possibly| kindly)?|would you mind|please|pls|kindly|(?:can|could|may) (?:i|we) (?:get|have))\s+/i;
const EMPTY_EN = new Set([
  'it', 'that', 'this', 'them', 'those', 'these', 'me', 'us', 'one', 'something', 'stuff', 'things', 'thing',
  'over', 'back', 'to', 'the', 'a', 'an', 'asap', 'later', 'soon', 'today', 'tonight', 'tomorrow', 'now',
  'again', 'too', 'for', 'with', 'please', 'when', 'you', 'can',
]);
const WHEN_EN = '(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|week|weekend|month|morning|afternoon|evening|day|\\d)';
const TIME_TAIL_EN = new RegExp(
  `\\s+(?:(?:by|before|until|till|first thing|end of|eod|eow|cob|asap|right away|later|tomorrow|today|tonight|soon|when you (?:can|get a chance)|please)\\b|(?:on|this|next|at|in the|after the|after)\\s+${WHEN_EN}).*$`,
  'i',
);

/** Hebrew asks: "תוכל לשלוח…?", "אפשר לקבל…?", "תשלח לי…". The infinitive is kept for the title. */
const HE_MODAL = /^(?:תוכל|תוכלי|תוכלו|אתה יכול|את יכולה|אתם יכולים|אפשר)\s+(?:בבקשה\s+)?(לשלוח|להעביר|לבדוק|לאשר|לחתום|לעדכן|לתקן|להתקשר|לשלם|לקבל|להכין)(?=$|[^\p{L}])/u;
const HE_IMPERATIVE: { forms: string[]; inf: string }[] = [
  { forms: ['תשלח', 'תשלחי', 'תשלחו', 'שלח', 'שלחי'], inf: 'לשלוח' },
  { forms: ['תעביר', 'תעבירי', 'תעבירו'], inf: 'להעביר' },
  { forms: ['תבדוק', 'תבדקי', 'תבדקו'], inf: 'לבדוק' },
  { forms: ['תאשר', 'תאשרי', 'תאשרו'], inf: 'לאשר' },
  { forms: ['תחתום', 'תחתמי', 'תחתמו'], inf: 'לחתום' },
];
const EMPTY_HE = new Set(['לי', 'לנו', 'את', 'זה', 'זאת', 'אותו', 'אותה', 'אותם', 'בבקשה', 'מחר', 'היום', 'עוד', 'כבר', 'גם', 'שוב', 'עד']);
const TIME_TAIL_HE = /\s+(?:מחר|היום|הערב|בערב|בבוקר|עוד מעט|אחר כך|בהמשך|השבוע|בשבוע הבא|עד|לפני|ביום|בקרוב|בבקשה)(?:$|[^\p{L}].*$)/u;

/** "Hi Sam, …", "@Sam …", "Sam: …", "סאם, …": the name, and the rest. Case decides it is a name in English. */
function addressed(sentence: string): { to: string | null; rest: string } {
  const s = sentence.replace(/^(?:hi|hey|hello|היי|הי|שלום)\s*,?\s*/i, '');
  const m = s.match(/^@?([\p{Lu}][\p{L}'’-]+)\s*[,:]\s*(.*)$/u) ?? s.match(/^@([\p{L}][\p{L}'’-]+)\s+(.*)$/u)
    ?? s.match(/^([֐-׿][֐-׿'’-]+)\s*,\s*(.*)$/u);
  if (m && m[2]) return { to: m[1]!, rest: m[2] };
  return { to: null, rest: s };
}

function concrete(object: string, empty: Set<string>): boolean {
  return object.toLowerCase().split(/[^\p{L}\p{N}'’]+/u).some((w) => w.length >= 2 && !empty.has(w));
}

function clean(what: string): string {
  return what.replace(/[\s,.:;!?—-]+$/u, '').replace(/\s+/g, ' ').trim().slice(0, 100);
}

function englishAsk(sentence: string): YourAsk | null {
  const { to, rest } = addressed(sentence);
  const m = rest.match(ASK_EN);
  if (!m) return null;
  const question = /\?\s*$/.test(rest);
  const opener = m[0].trim().toLowerCase();
  // "Can you…" is an ask only as a question; "please…" either way.
  if (!question && !/^(please|pls|kindly)$/.test(opener)) return null;
  const after = rest.slice(m[0].length).replace(/[?!.\s]+$/, '');
  // "Can I get the invoice?": what follows is the thing asked for.
  if (/\b(?:i|we) (?:get|have)$/.test(opener)) {
    if (/\b(if|may ?be|perhaps|whenever|sometime)\b/i.test(after)) return null;
    const object = after.replace(TIME_TAIL_EN, '');
    return concrete(object, EMPTY_EN) ? { what: clean(object), to, lang: 'en' } : null;
  }
  const lower = after.toLowerCase();
  const starts = (v: string) => lower === v || lower.startsWith(`${v} `);
  const hand = HAND_OVER_EN.find(starts);
  const verb = hand ?? DO_EN.find(starts);
  if (!verb) return null;
  // Hedged or conditional: not a plain ask.
  if (/\b(if|may ?be|perhaps|whenever|sometime)\b/i.test(after)) return null;
  let object = after.slice(verb.length).replace(TIME_TAIL_EN, '');
  if (hand) object = object.replace(/^\s+(?:me|us|over|back)\b/i, '').replace(/^\s+(?:me|us|over|back)\b/i, '');
  if (!concrete(object, EMPTY_EN)) return null;
  const what = clean(hand ? object : `${after.slice(0, verb.length)}${object}`);
  return what.length >= 3 ? { what, to, lang: 'en' } : null;
}

function hebrewAsk(sentence: string): YourAsk | null {
  const { to, rest } = addressed(sentence);
  let inf: string | null = null;
  let after = '';
  const modal = rest.match(HE_MODAL);
  if (modal) {
    if (!/\?\s*$/.test(rest)) return null;
    inf = modal[1]!;
    after = rest.slice(modal[0].length);
  } else {
    for (const v of HE_IMPERATIVE) {
      const form = v.forms.find((f) => rest === f || rest.startsWith(`${f} `));
      if (form) {
        inf = v.inf;
        after = rest.slice(form.length);
        break;
      }
    }
  }
  if (!inf) return null;
  if (/(^|[^\p{L}])(אם|אולי|מתישהו)($|[^\p{L}])/u.test(after)) return null;
  const object = after.replace(/[?!.\s]+$/, '').replace(TIME_TAIL_HE, '').replace(/^\s+(?:לי|לנו)(?=$|[^\p{L}])/u, '');
  if (!concrete(object, EMPTY_HE)) return null;
  return { what: clean(`${inf}${object}`), to, lang: 'he' };
}

/** The asks in a message of yours, one per sentence, without quoted lines. */
export function asksIn(text: string): YourAsk[] {
  const out: YourAsk[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*>/.test(line)) continue;
    for (const s of line.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean)) {
      const a = englishAsk(s) ?? hebrewAsk(s);
      if (a && !out.some((o) => o.what.toLowerCase() === a.what.toLowerCase())) out.push(a);
    }
  }
  return out;
}

/** The first name of a person as a chat or email shows them: "Sam Carter" → "Sam". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name.trim();
}

/** "Waiting on Sam: the signed contract", "מחכה ל־סאם: לשלוח את החוזה". */
export function waitingTitle(who: string, ask: Pick<YourAsk, 'what' | 'lang'>): string {
  return ask.lang === 'he' ? `מחכה ל־${firstName(who)}: ${ask.what}` : `Waiting on ${firstName(who)}: ${ask.what}`;
}

/** Whether a sender is the person waited on: the same name, or the same first name when one is only a first name. */
export function samePerson(who: string, sender: string): boolean {
  const a = who.trim().toLowerCase().replace(/^@/, '');
  const b = sender.trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  const oneWord = !a.includes(' ') || !b.includes(' ');
  return oneWord && firstName(a) === firstName(b);
}

/** When a waiting item stops being quiet: hours later for a chat, working days (Monday to Friday) later for email. */
export function quietUntil(via: 'chat' | 'email', asked: Date, chatHours: number, emailDays: number): Date {
  if (via === 'chat') return new Date(asked.getTime() + chatHours * 3600_000);
  const out = new Date(asked);
  let left = emailDays;
  while (left > 0) {
    out.setDate(out.getDate() + 1);
    if (out.getDay() !== 0 && out.getDay() !== 6) left--;
  }
  return out;
}
