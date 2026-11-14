/**
 * The same thing seen in two places: Sam writes in Teams that he will send a document to sign,
 * and the DocuSign email from him arrives. Two tasks, one thing to do. Didja suggests
 * merging them when they come from the same person and name the same thing (an id, a file, an
 * amount, a link: SCR-106) or are about the same kind of action; you merge them or say they are
 * not the same. Never merged on its own. Merged, they finish together (store.setStatus).
 */
import type { Store, Task, Waiting } from './store.ts';

const FAMILIES: Record<string, RegExp> = {
  sign: /\bsign|signature|docusign|e-?sign|חת(?:ום|ימ|מי|ו)/i,
  approve: /\bapprov|\bauthori[sz]|אשר|אישור/i,
  pay: /\bpay\b|\bpayment|\binvoice|לשלם|שלם|תשלום|חשבונית/i,
  review: /\breview|\bfeedback|משוב|לעבור על/i,
  send: /\bsend\b|\bshare\b|לשלוח|שלח|העבר/i,
  meet: /\bmeet|\bschedule|\bbook\b|\bcalendar|פגיש|לקבוע/i,
};

/** The kinds of action a task's words point to. */
export function actions(text: string): string[] {
  return Object.entries(FAMILIES).filter(([, re]) => re.test(text)).map(([name]) => name);
}

/** "Sam Carter via Docusign" → "sam carter". */
export function plainName(name: string): string {
  return name.replace(/\s+(?:via|through|from)\s+.*$/i, '').replace(/[“”"'(),]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** The same person: the shorter name's words all in the longer one, at least one of them a real name. */
export function samePerson(a: string, b: string): boolean {
  const [x, y] = [plainName(a), plainName(b)].sort((p, q) => p.length - q.length) as [string, string];
  const words = x.split(' ').filter((w) => w.length >= 2);
  const others = new Set(y.split(' '));
  return words.length > 0 && words.some((w) => w.length >= 3) && words.every((w) => others.has(w));
}

/** Who asked, and the words to read for the action: from what the task already keeps. */
export function askerOf(store: Store, task: Task): { person: string | null; words: string } {
  if (task.criteria?.chat) {
    const from = task.criteria.chat.from;
    return { person: from === 'me' ? null : from, words: task.title };
  }
  if (task.sourceKind === 'email') {
    const origin = store.listEvidence(task.id).find((e) => e.kind === 'origin')?.detail ?? '';
    const m = origin.match(/^From an email: (.+?) — “(.*)”$/);
    return { person: m?.[1] ?? null, words: `${task.title} ${m?.[2] ?? ''}` };
  }
  return { person: null, words: task.title };
}

/**
 * The concrete things a task's words name (SCR-106), normalised so the same one matches across
 * apps: an id ("INV-2041", "#5531", "invoice 5531"), a file name ("budget-q4.pdf"), an amount
 * ("$1,200", "1200 USD", "₪500"), a link's host and path. Product names are left out: without a
 * model they cannot be told from any other capitalised word.
 */
export function objects(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/https?:\/\/([^\s/?#"”']+)(\/[^\s?#"”']*)?/gi)) {
    out.add(`link ${m[1]!.toLowerCase().replace(/^www\./, '')}${(m[2] ?? '').replace(/\/+$/, '').toLowerCase()}`);
  }
  const plain = text.replace(/https?:\/\/\S+/gi, ' ');
  for (const m of plain.matchAll(/\b([\w-]+\.(?:pdf|docx?|xlsx?|pptx?|csv|zip|key|numbers|pages|png|jpe?g))\b/gi)) out.add(`file ${m[1]!.toLowerCase()}`);
  for (const m of plain.matchAll(/\b([A-Z]{2,6})-?(\d{2,})\b/g)) out.add(`id ${m[1]}-${m[2]}`);
  for (const m of plain.matchAll(/(?:#|\b(?:invoice|order|ticket|case|ref|po|quote|contract|הזמנה|חשבונית)\s*(?:no\.?|number|#)?\s*)(\d{3,})\b/giu)) out.add(`number ${m[1]}`);
  const amount = (n: string) => `amount ${Number(n.replace(/,/g, ''))}`;
  for (const m of plain.matchAll(/[$€£₪]\s?(\d[\d,]*(?:\.\d+)?)/g)) out.add(amount(m[1]!));
  for (const m of plain.matchAll(/\b(\d[\d,]*(?:\.\d+)?)\s?(?:usd|eur|gbp|ils|nis|dollars|euros|₪|ש"ח|שקל)/giu)) out.add(amount(m[1]!));
  return [...out];
}

/** How an object is said back: "INV-2041", "budget-q4.pdf", "1200", "example.com/invoices/5531". */
const said = (o: string) => o.replace(/^(?:link|file|id|number|amount) /, '');

const WINDOW_MS = 3 * 24 * 3600_000;
/** The same object from the same person: within two days (SCR-106). */
const OBJECT_WINDOW_MS = 48 * 3600_000;

interface Known { task: Task; person: string | null; words: string }

/**
 * Why two tasks may be one thing, or null (SCR-106). Never across different people. The same
 * concrete object (an id, a file, an amount, a link) within 48 hours; else the same kind of action
 * within three days, unless each names objects and they differ. Only words the tasks already keep
 * (titles, an email's subject) are read and said back.
 */
export function mergeReason(a: Known, b: Known): string | null {
  if (!a.person || !b.person || !samePerson(a.person, b.person)) return null;
  const apart = Math.abs(Date.parse(a.task.createdAt) - Date.parse(b.task.createdAt));
  const ours = objects(a.words);
  const theirs = objects(b.words);
  const shared = ours.filter((o) => theirs.includes(o));
  const who = plainName(a.person).split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  if (shared.length > 0 && apart <= OBJECT_WINDOW_MS) return `both from ${who}, both name ${shared.map(said).join(', ')}`;
  if (ours.length > 0 && theirs.length > 0) return null; // each names a different thing
  const kinds = actions(a.words).filter((x) => actions(b.words).includes(x));
  if (kinds.length > 0 && apart <= WINDOW_MS) return `both from ${who}, both to ${kinds.join(' and ')}`;
  return null;
}

/** The reason a waiting merge suggestion was made, for `why`. */
export function suggestionReason(store: Store, a: Task, b: Task): string | null {
  return mergeReason({ task: a, ...askerOf(store, a) }, { task: b, ...askerOf(store, b) });
}

/** Suggest merging related tasks from different places. Returns how many pairs were suggested. */
export function suggestMerges(store: Store, now: Date): number {
  const since = new Date(now.getTime() - WINDOW_MS).toISOString();
  const tasks = store.listTasks({ all: true }).filter((t) =>
    !t.isGroup && t.createdAt >= since && (t.status === 'open' || t.status === 'done') &&
    (t.criteria?.chat || t.sourceKind === 'email' || t.criteria?.external) && store.mergedWith(t.id).length === 0);
  const known = tasks.map((t) => ({ task: t, ...askerOf(store, t) })).filter((k) => k.person);
  let suggested = 0;
  for (let i = 0; i < known.length; i++) {
    for (let j = i + 1; j < known.length; j++) {
      const a = known[i]!, b = known[j]!;
      if (a.task.sourceRef === b.task.sourceRef) continue; // two places, not two messages in one
      if (a.task.status === 'done' && b.task.status === 'done') continue;
      if (mergeReason(a, b) === null) continue;
      if (store.suggestMerge(a.task.id, b.task.id, now)) suggested++;
    }
  }
  return suggested;
}

// --- SCR-109: answered in another app ------------------------------------------------------------

/**
 * A message seen in some app, between you and one person: one you sent them (`person` is who it went
 * to), or one they sent you. `text` is read for objects only and never kept.
 */
export interface Seen { person: string; text: string; app: string; at: Date }

/** The app a task came from: "WhatsApp — Dana Levi" → "WhatsApp"; an email task's ref is its mailbox. */
export const appOf = (sourceRef: string): string => sourceRef.split(' — ')[0]!.trim();

/** The objects two texts both name, said back ("INV-2041"), or none. */
export function sharedObjects(a: string, b: string): string[] {
  const theirs = objects(b);
  return objects(a).filter((o) => theirs.includes(o)).map(said);
}

const firstOf = (name: string) => {
  const w = plainName(name).split(' ')[0] ?? '';
  return w.charAt(0).toUpperCase() + w.slice(1);
};

/** How a "looks done?" from another app reads: "you wrote to Dana in Microsoft Outlook about INV-2041". */
const ELSEWHERE = /^you wrote to .+ in .+ about /;

/** A "looks done?" made because you wrote to that person in another app (SCR-109): it only ever asks. */
export function answeredElsewhere(place: string | null | undefined): boolean {
  return !!place && ELSEWHERE.test(place);
}

/**
 * Whether a message you sent may answer an ask of theirs in another app (SCR-109), and how to say so,
 * or null. The same person, another app, after the ask, and the same concrete thing named (an id, a
 * file, an amount, a link): a kind of action alone is never enough here.
 */
export function answerPlace(task: Known, yours: Seen): string | null {
  if (!task.person || !samePerson(task.person, yours.person)) return null;
  if (appOf(task.task.sourceRef) === yours.app) return null; // the same app is read as a reply there
  if (yours.at.getTime() < Date.parse(task.task.createdAt)) return null;
  const shared = sharedObjects(task.words, yours.text);
  if (shared.length === 0) return null;
  return `you wrote to ${firstOf(yours.person)} in ${yours.app} about ${shared.join(', ')}`;
}

/**
 * A message you sent to one person (SCR-109): their open asks from another app that name the same
 * thing show "looks done?". Never ticks: the auto-accept setting and trusted places skip these
 * (`answeredElsewhere`). A place you said "not yet" to is not asked again. Returns how many it asked.
 */
export function noticeYourAnswer(store: Store, yours: Seen, now: Date): number {
  let asked = 0;
  for (const task of store.listTasks()) {
    if (task.suggestion || task.criteria?.promise) continue;
    if (!(task.criteria?.chat || task.sourceKind === 'email' || task.criteria?.external)) continue;
    const place = answerPlace({ task, ...askerOf(store, task) }, yours);
    if (!place || store.rejectedPlaces(task.id).has(place)) continue;
    store.suggestDone(task.id, place, null, now);
    asked++;
  }
  return asked;
}

const clock = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/**
 * Whether a message from someone may answer what you are waiting on from them in another app
 * (SCR-109), and how to say so, or null: the same person, another app, after the ask, the same thing
 * named. The waiting title is what was asked ("Waiting on Dana: invoice INV-2041").
 */
export function waitingHint(w: Waiting, theirs: Seen): string | null {
  if (w.status !== 'waiting' || w.app === theirs.app) return null;
  if (!samePerson(w.who, theirs.person)) return null;
  if (theirs.at.getTime() <= Date.parse(w.askedAt)) return null;
  const shared = sharedObjects(w.title, theirs.text);
  if (shared.length === 0) return null;
  return `${firstOf(theirs.person)} wrote in ${theirs.app} at ${clock(theirs.at)} about ${shared.join(', ')}`;
}

/** A message from one person (SCR-109): what you wait on from them elsewhere is marked "answered?", never closed. */
export function noticeTheirAnswer(store: Store, theirs: Seen, now: Date): number {
  let marked = 0;
  for (const w of store.waitingItems()) {
    if (w.hint) continue;
    const why = waitingHint(w, theirs);
    if (why && store.hintWaiting(w.id, why, now)) marked++;
  }
  return marked;
}
