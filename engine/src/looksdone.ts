/**
 * "Looks done — confirm?" (completion tier 3, see docs/ARCHITECTURE.md).
 *
 * For tasks with nothing exact to look for, a later screen may still show the
 * task has been done. This file decides which screens are worth showing the
 * on-device model, and what to show it. The model's "done" is only ever a
 * suggestion: the task stays open until the user confirms.
 */

import type { DonePlace } from './store.ts';
import type { Observation, Teaching } from './store.ts';

/** What the on-device model said about one task and one screen, or null if it could not be asked. */
export type LooksDone = 'done' | 'notDone' | 'unsure';
export type Looker = (input: { task: string; app: string; page: string; text: string; teach?: Teaching }) => LooksDone | null;

const STOP_WORDS = new Set(
  `about above after again against also another back because been before being below between both
  check click close confirm could does done down each every first from have here into just like
  list look make many more most much must need next once only onto open other over page press
  same select should show some step still such sure take than that their them then there these
  they this those through under until using very want were what when where which while will with
  work works would your`.split(/\s+/),
);

/** The words of a task that would show up on a screen where it is being done. */
export function keywords(title: string): string[] {
  const words = title
    .toLowerCase()
    .replace(/`/g, ' ')
    .match(/[a-z][a-z0-9_-]{3,}|[A-Z0-9_]{4,}/gi) ?? [];
  return [...new Set(words.map((w) => w.toLowerCase()).filter((w) => !STOP_WORDS.has(w)))];
}

/** Where an observation was made, as shown to the user: never screen text, never a query string. */
export function placeOf(o: Pick<Observation, 'app' | 'windowTitle' | 'url'>): string {
  if (o.url) {
    try {
      const u = new URL(o.url);
      return `${o.app} — ${u.hostname}${u.pathname}`.replace(/\/$/, '');
    } catch {
      // fall through to the window title
    }
  }
  return o.windowTitle && o.windowTitle !== o.app ? `${o.app} — ${o.windowTitle}` : o.app;
}

const MAX_SNIPPET_LINES = 14;
const MAX_SNIPPET_CHARS = 900;

/**
 * The part of a screen worth asking the model about for this task, or null if
 * the screen has too little to do with it. A screen qualifies when at least
 * two of the task's keywords appear on it (in its text, title or address), or one strong token.
 */
export function relevantSnippet(title: string, o: Observation, tokens: string[] = []): string | null {
  const words = keywords(title);
  const lines = o.text.split(/\r?\n/);
  const everything = `${o.windowTitle}\n${o.url ?? ''}\n${o.text}`.toLowerCase();
  // Two of the task's words, or one strong token (an id, a repository) already found on the screen (SCR-66).
  const present = [...words.filter((w) => everything.includes(w)), ...tokens.map((t) => t.replace(/^#/, ''))];
  if (present.length < 2 && tokens.length === 0) return null;

  // The lines that mention the task, each with its neighbours for context.
  const keep = new Set<number>();
  lines.forEach((line, i) => {
    const lower = line.toLowerCase();
    if (present.some((w) => lower.includes(w))) [i - 1, i, i + 1].forEach((n) => keep.add(n));
  });
  // Mentioned only in the title or address: the top of the page is the context.
  const picked = keep.size > 0 ? [...keep].sort((a, b) => a - b) : lines.map((_, i) => i);
  const out: string[] = [];
  let chars = 0;
  for (const i of picked) {
    const line = lines[i]?.trim();
    if (!line) continue;
    if (out.length >= MAX_SNIPPET_LINES || chars + line.length > MAX_SNIPPET_CHARS) break;
    out.push(line.slice(0, 200));
    chars += line.length;
  }
  return out.length > 0 ? out.join('\n') : null;
}

/**
 * Whether a screen is where the task gets done: a site or app the task names ("Sign … with
 * Docusign" on docusign.com, or in the DocuSign app), or a page on the same site as a link the
 * email gave. For email tasks only these screens are shown to the model; a page that merely
 * mentions the same words (a Linear issue about the DocuSign rollout) is not.
 */
/** The site of a screen, for places you taught: its web host, or its app's name with no address. */
export function siteOf(o: Pick<Observation, 'app' | 'url'>): string {
  try {
    if (o.url) return new URL(o.url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    // no usable address: the app
  }
  return o.app.toLowerCase();
}

/**
 * A place you said a step was done applies to this task: the screen is at that site, and the task
 * is from the same conversation, or names the same app word. Nothing else is made to count.
 */
export function learnedWhere(task: { title: string; sourceId: number }, o: Pick<Observation, 'app' | 'url'>,
  places: Pick<DonePlace, 'site' | 'source' | 'word'>[]): boolean {
  if (places.length === 0) return false;
  const site = siteOf(o);
  const words = keywords(task.title);
  return places.some((p) => p.site === site && (p.source === task.sourceId || (p.word !== null && words.includes(p.word))));
}

export function isWhereItIsDone(title: string, o: Pick<Observation, 'app' | 'url'>, links: string[] = []): boolean {
  let host = '';
  try {
    host = o.url ? new URL(o.url).hostname.toLowerCase().replace(/^www\./, '') : '';
  } catch {
    host = '';
  }
  const place = new Set([...host.split(/[.-]/), ...o.app.toLowerCase().split(/[^a-z0-9]+/)].filter((w) => w.length >= 3));
  if (keywords(title).some((w) => place.has(w))) return true;
  if (!host) return false;
  return links.some((link) => {
    try {
      return new URL(link).hostname.toLowerCase().replace(/^www\./, '') === host;
    } catch {
      return false;
    }
  });
}

// --- Which screens to show, and in what order (SCR-66) ------------------------------------------

/** A year is not an id. */
const YEAR = /^(19|20)\d\d$/;
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|md|json|py|swift|sql|css|html|ya?ml|sh|txt|toml|lock|env)$/i;

/**
 * The tokens of a task and the text it came from that name one thing exactly: ids and numbers
 * ("4410", "#42", "pull request 42"), a repository or project ("acme/widgets"), a quoted name.
 * One of them on a screen is enough to show it to the model there.
 */
export function strongTokens(text: string): string[] {
  const found = new Set<string>();
  const plain = text.replace(/`[^`]*`/g, ' ');
  for (const m of plain.matchAll(/(?<![\w.,/:-])(\d{3,})(?![\w.,]\d|\w)/g)) if (!YEAR.test(m[1]!)) found.add(m[1]!);
  for (const m of plain.matchAll(/(?:#|\b(?:pull request|PR|issue|ticket|order|invoice|report)\s+#?)(\d{1,6})\b/gi)) found.add(`#${m[1]}`);
  for (const m of plain.matchAll(/(?<![\w./@-])([A-Za-z0-9][\w-]{1,38}\/[\w.-]{2,60})(?![\w/])/g)) {
    const repo = m[1]!.replace(/\.$/, '');
    if (!CODE_EXT.test(repo) && !/^(and|or|either|yes|no)\//i.test(repo) && /[A-Za-z]/.test(repo)) found.add(repo.toLowerCase());
  }
  for (const m of plain.matchAll(/[“"]([^”"\n]{3,60})[”"]/g)) found.add(m[1]!.trim().toLowerCase());
  return [...found];
}

/** Whether a strong token is on a screen: in its text, title or address. */
export function hasToken(o: Pick<Observation, 'text' | 'windowTitle' | 'url'>, token: string): boolean {
  const everything = `${o.windowTitle}\n${o.url ?? ''}\n${o.text}`.toLowerCase();
  if (token.startsWith('#')) {
    const n = token.slice(1);
    return new RegExp(`#${n}(?!\\d)`).test(everything) || new RegExp(`/(?:pull|issues?|merge_requests|orders?|reports?|tickets?)/${n}(?![\\d])`).test(o.url ?? '');
  }
  if (/^\d+$/.test(token)) return new RegExp(`(?<![\\d.,])${token}(?![\\d])`).test(everything);
  return everything.includes(token);
}

/** Names in the text a task came from that a site or app might be called: "GitHub", "Vercel". */
export function serviceWords(text: string): string[] {
  const words: string[] = [];
  for (const m of text.matchAll(/\b[A-Z][A-Za-z0-9]{3,}\b/g)) {
    // A capital that only starts a sentence says nothing; one inside the word (GitHub, PayPal) does.
    const before = text.slice(0, m.index).replace(/[\s"“'‘(]+$/, '');
    const startsSentence = before === '' || /[.!?:\n]$/.test(before);
    if (startsSentence && !/[A-Z]/.test(m[0].slice(1))) continue;
    words.push(m[0].toLowerCase());
  }
  return [...new Set(words.filter((w) => !STOP_WORDS.has(w) && !GENERIC_PLACE.has(w)))];
}
/** Parts of an address or app name that say nothing about which service it is. */
const GENERIC_PLACE = new Set(`mail inbox home page settings dashboard login account accounts docs help support
  google chrome safari edge firefox arc browser microsoft apple app apps web online cloud portal hello thanks thank
  please today tomorrow monday tuesday wednesday thursday friday saturday sunday`.split(/\s+/));

export interface LookSource {
  /** The task's own title as captured. */
  title: string;
  /** What is kept of where it came from: the lines around it, its window and address. */
  context: string;
  /** Links its email gave. */
  links: string[];
  /** When the task was last seen where it came from. */
  lastSeenAt: string;
}

export interface LookCandidate {
  snippet: string;
  /** Higher is shown first. */
  score: number;
}

/** Minutes after you last looked at a task's source in which where you went counts as "next". */
export const NEXT_MINUTES = 15;

/**
 * Whether a screen is worth showing the model for this task, and how strongly, or null. A screen
 * must be somewhere the task could be done: a site or app the task or its source names, a site
 * its email linked to, or one you taught (`taught`). A page elsewhere that only shares words never
 * counts; one with an id from the task counts only right after you looked at the task's source.
 * On top of that it must show the task: two of its words, or one strong token.
 */
export function lookCandidate(src: LookSource, o: Observation, taught: boolean): LookCandidate | null {
  const tokens = strongTokens(`${src.title}\n${src.context}`).filter((t) => hasToken(o, t));
  const named = isWhereItIsDone(src.title, o, src.links);
  const servicePlace = !named && isWhereItIsDone(serviceWords(src.context).join(' '), o);
  const since = (Date.parse(o.ts) - Date.parse(src.lastSeenAt)) / 60_000;
  const next = since > 0 && since <= NEXT_MINUTES;
  if (!named && !servicePlace && !taught && !(next && tokens.some((t) => /^#?\d+$|\//.test(t)))) return null;
  const snippet = relevantSnippet(src.title, o, tokens);
  if (!snippet) return null;
  let score = tokens.length * 4 + (named ? 2 : 0) + (servicePlace ? 2 : 0) + (taught ? 3 : 0);
  if (next) score += 1 + (1 - since / NEXT_MINUTES);
  return { snippet, score };
}

// --- States that say "done" (SCR-68) --------------------------------------------------------------

/** A ticked box or a switch turned on, as capture writes it: "[x] Approve 4410", "[on] Public". */
const CHECKED = /^\s*(?:[-*•]\s+|\d+[.)]\s+)?\[(?:x|X|on)\]\s+(.+)$/;
/** A box not ticked, or a switch off: "[ ] Approve 4410", "[off] Public". */
const UNCHECKED = /^\s*(?:[-*•]\s+|\d+[.)]\s+)?\[(?: |off)\]\s+(.+)$/;
/** A short notice the app announced: "⟦Notice: Pull request #42 merged⟧". */
const NOTICE = /^⟦Notice: (.+)⟧$/;

/**
 * Whether a line names the task: two of its words, at least 60% of them, or one of its ids with one
 * of its words. A box or notice that only shares a word ("[x] Public") says nothing about this task.
 */
export function namesTask(title: string, line: string): boolean {
  const lower = line.toLowerCase();
  const words = keywords(title);
  const found = words.filter((w) => lower.includes(w)).length;
  const ids = strongTokens(title).filter((t) => hasToken({ text: line, windowTitle: '', url: null }, t)).length;
  if (ids > 0 && found >= 1) return true;
  return words.length >= 2 && found >= 2 && found >= Math.ceil(words.length * 0.6);
}

export type DoneState =
  /** A ticked box, a switch on, or a notice, that names the task. */
  | { kind: 'checked'; line: string }
  /** Only a box not ticked (or a switch off) names it: not done yet. */
  | { kind: 'unchecked'; line: string }
  | { kind: 'none' };

/**
 * What the states on a screen say about a task. Only ever a reason to show the screen to the
 * looks-done model, or to leave it out: a ticked box is never a tick by itself.
 */
export function doneState(title: string, text: string): DoneState {
  let unchecked: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const label = CHECKED.exec(line)?.[1] ?? NOTICE.exec(line)?.[1];
    if (label && namesTask(title, label)) return { kind: 'checked', line };
    const open = UNCHECKED.exec(line)?.[1];
    if (open && unchecked === null && namesTask(title, open)) unchecked = line;
  }
  return unchecked === null ? { kind: 'none' } : { kind: 'unchecked', line: unchecked };
}
