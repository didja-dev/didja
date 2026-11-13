/**
 * "What done looks like" (SCR-67). When a task with nothing exact to look for is captured, the
 * on-device model is asked once, while its source is still at hand, what a screen showing it done
 * would have: where it is done, phrases that appear when it is done, phrases that show it is not
 * done yet, and ids or names that must be there. Later, a screen that matches is a strong candidate
 * for "looks done?"; the looks-done model still has to confirm it, and a "not yet" phrase vetoes it.
 * Nothing here ticks anything.
 */
import type { Observation } from './store.ts';

export interface DoneCriteria {
  /** Apps and sites where it is done: "github.com/acme/widgets/settings", "Microsoft Outlook", "Terminal". */
  where: string[];
  /** Short phrases on screen once it is done: "Approved", "main -> main". */
  success: string[];
  /** Phrases that show it is not done yet: "Approve", "requires your approval". */
  pending: string[];
  /** Ids or names that must be on the screen: "4410", "acme/widgets". */
  tokens: string[];
}

/** What the model is shown to write them: never more than the task and what is kept around it. */
export interface CriteriaQuestion {
  task: string;
  /** The line that introduced its list, if any. */
  leadIn: string;
  /** The other steps of its list. */
  neighbours: string[];
  /** Where it came from: "Claude — Open source", "Microsoft Outlook". */
  source: string;
  /** The lines kept around it where it was captured (SCR-31). */
  context: string[];
  links: string[];
}

/** Asks the on-device model; null when no model is available. */
export type CriteriaWriter = (q: CriteriaQuestion) => DoneCriteria | null;

const MAX_ITEMS = 5;
const MAX_PHRASE = 60;

/** Keep only what is usable: short, distinct phrases, at most five of each. */
export function cleanCriteria(raw: Partial<Record<keyof DoneCriteria, unknown>>): DoneCriteria {
  const list = (v: unknown, min: number): string[] => {
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    for (const item of v) {
      if (typeof item !== 'string') continue;
      const p = item.replace(/\s+/g, ' ').replace(/^["“'‘]+|["”'’.]+$/g, '').trim();
      if (p.length < min || p.length > MAX_PHRASE || /^(none|n\/a|unknown)$/i.test(p)) continue;
      if (!out.some((o) => o.toLowerCase() === p.toLowerCase())) out.push(p);
      if (out.length >= MAX_ITEMS) break;
    }
    return out;
  };
  const criteria = { where: list(raw.where, 3), success: list(raw.success, 3), pending: list(raw.pending, 3), tokens: list(raw.tokens, 2) };
  // A phrase cannot be both: what says "not yet" is not also proof it is done.
  criteria.success = criteria.success.filter((s) => !criteria.pending.some((p) => p.toLowerCase() === s.toLowerCase()));
  return criteria;
}

export function parseCriteria(json: string): DoneCriteria | null {
  try {
    const c = cleanCriteria(JSON.parse(json) as Record<string, unknown>);
    return c.where.length + c.success.length + c.pending.length + c.tokens.length > 0 ? c : null;
  } catch {
    return null;
  }
}

const lower = (o: Pick<Observation, 'windowTitle' | 'url' | 'text'>) => `${o.windowTitle}\n${o.url ?? ''}\n${o.text}`.toLowerCase();

/** Whether a phrase is on the screen as words, not inside another word ("Approve" is not in "Approved"). */
export function phraseOn(text: string, phrase: string): boolean {
  const p = phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${p}(?![\\p{L}\\p{N}])`, 'u').test(text.toLowerCase());
}

/** Whether a screen is one of the places it is done: its app, or its address, contains a `where` entry. */
export function inWhere(c: DoneCriteria, o: Pick<Observation, 'app' | 'url'>): boolean {
  const app = o.app.toLowerCase();
  let address = '';
  try {
    if (o.url) {
      const u = new URL(o.url);
      address = `${u.hostname.replace(/^www\./, '')}${u.pathname}`.toLowerCase();
    }
  } catch {
    address = '';
  }
  return c.where.some((w) => {
    const place = w.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
    if (!place) return false;
    // A site: the address starts with its host, and any path parts it gives that are not placeholders.
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/.test(place)) {
      const [host, ...path] = place.split('/');
      if (!address.startsWith(host!) && !address.includes(`.${host}`)) return false;
      const parts = path.filter((p) => p && !/[<>{}]/.test(p));
      return parts.every((p) => address.includes(`/${p}`));
    }
    if (app === place || app.includes(place) || place.includes(app)) return true;
    // A service by name ("GitHub", "DocuSign"): a label of the site's host ("github.com", "app.docusign.com").
    const name = place.replace(/[^a-z0-9]/g, '');
    const host = address.split('/')[0] ?? '';
    return name.length >= 4 && host.split('.').slice(0, -1).includes(name);
  });
}

export type CriteriaMatch =
  /** One of its places, with a "not yet" phrase on it: do not show it. */
  | 'pending'
  /** One of its places, but an id it needs is missing: do not show it. */
  | 'missing'
  /** Its place, its ids and a done phrase: a strong candidate. */
  | 'match'
  /** Says nothing either way: the other rules decide. */
  | 'none';

/** How a screen compares with what done looks like for a task. The screen's lines are those new there. */
export function matchCriteria(c: DoneCriteria, o: Pick<Observation, 'app' | 'url' | 'windowTitle' | 'text'>): CriteriaMatch {
  // Only one of its own places is judged by it: elsewhere the other rules decide, untouched.
  if (c.where.length === 0 || !inWhere(c, o)) return 'none';
  const text = lower(o);
  if (!c.tokens.every((t) => text.includes(t.toLowerCase()))) return 'missing';
  if (c.pending.some((p) => phraseOn(o.text, p))) return 'pending';
  return c.success.some((s) => phraseOn(o.text, s)) ? 'match' : 'none';
}

/** The phrases of a match, for the lines shown to the model. */
export function matchedWords(c: DoneCriteria, o: Pick<Observation, 'text'>): string[] {
  return [...c.tokens, ...c.success.filter((s) => phraseOn(o.text, s))].map((w) => w.toLowerCase());
}

/** "Didja is looking for: …", for why. */
export function describeCriteria(c: DoneCriteria): string {
  const parts: string[] = [];
  if (c.where.length) parts.push(`in ${c.where.join(' or ')}`);
  if (c.success.length) parts.push(`showing ${c.success.map((s) => `“${s}”`).join(' or ')}`);
  if (c.tokens.length) parts.push(`with ${c.tokens.join(', ')}`);
  if (c.pending.length) parts.push(`not while it shows ${c.pending.map((s) => `“${s}”`).join(' or ')}`);
  return `Didja is looking for: a screen ${parts.join(', ')}. The on-device model wrote this when the task was captured; it still has to see the screen to suggest it.`;
}

/**
 * Keep only what the model could have taken from what it was shown: an id or name not in the
 * question is dropped (the model copies examples), and a site keeps only the path parts that are.
 */
export function groundCriteria(c: DoneCriteria, q: CriteriaQuestion): DoneCriteria {
  const given = [q.task, q.leadIn, ...q.neighbours, q.source, ...q.context, ...q.links].join('\n').toLowerCase();
  const where = c.where.map((w) => {
    const place = w.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(place)) return w;
    const [host, ...path] = place.split('/');
    const kept = path.filter((p) => p && !/[<>{}]/.test(p) && given.includes(p.toLowerCase()));
    return [host, ...kept].join('/');
  });
  // An id is copied from the step or the lines around it, never from where it came from (the
  // conversation's name), and looks like one: a number, a key, a path, a constant.
  const own = [q.task, ...q.context].join('\n').toLowerCase();
  const tokens = c.tokens.filter((t) => own.includes(t.toLowerCase()) && (/\d|[\/_]|\w-\w/.test(t) || /^[A-Z][A-Z0-9]{2,}$/.test(t)));
  return { ...c, where: [...new Set(where)], tokens };
}
