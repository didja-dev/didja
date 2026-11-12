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
 * two of the task's keywords appear on it (in its text, title or address).
 */
export function relevantSnippet(title: string, o: Observation): string | null {
  const words = keywords(title);
  if (words.length < 2) return null;
  const lines = o.text.split(/\r?\n/);
  const everything = `${o.windowTitle}\n${o.url ?? ''}\n${o.text}`.toLowerCase();
  const present = words.filter((w) => everything.includes(w));
  if (present.length < 2) return null;

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
