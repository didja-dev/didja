/**
 * The same thing seen in two places: Sam writes in Teams that he will send a document to sign,
 * and the DocuSign email from him arrives. Two tasks, one thing to do. Didja suggests
 * merging them when they come from the same person and are about the same kind of action; you
 * merge them or say they are not the same. Merged, they finish together (store.setStatus).
 */
import type { Store, Task } from './store.ts';

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

const WINDOW_MS = 3 * 24 * 3600_000;

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
      if (Math.abs(Date.parse(a.task.createdAt) - Date.parse(b.task.createdAt)) > WINDOW_MS) continue;
      if (!samePerson(a.person!, b.person!)) continue;
      const shared = actions(a.words).filter((x) => actions(b.words).includes(x));
      if (shared.length === 0) continue;
      if (store.suggestMerge(a.task.id, b.task.id, now)) suggested++;
    }
  }
  return suggested;
}
