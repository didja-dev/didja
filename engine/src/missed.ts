/**
 * "Didja Missed This…": you finished a task and Didja did not notice. What the report holds about
 * one task (the app masks it before you see or share it), and the place you say it was done.
 *
 * The report: what would tick it (`why`), how it looked where it was captured, where Didja looks
 * for it done, and the places it saw since, each with its last few lines. You can pick one of
 * those places as where you did it; Didja then also looks there for this conversation's other
 * steps, and for steps that name the same app ("Planner"). That only lets those screens be shown
 * to the model, which must still see them done: a place never ticks anything by itself.
 */
import { formatWhy } from './cli.ts';
import { keywords, learnedWhere, siteOf } from './looksdone.ts';
import type { Observation, Store } from './store.ts';

export interface MissedScreen {
  id: number;
  ts: string;
  window: string;
  /** What was new on it, as kept: your own text, shown to you as it is (masked only in the report). */
  lines: string[];
}

export interface MissedPlace {
  site: string;
  app: string;
  /** How many screens were kept there since the task was captured. */
  screens: number;
  /** Its last few lines, as kept (masked in the report). */
  lines: string[];
  /** Didja already looks for this task there. */
  watched: boolean;
  /** The screens kept there, newest first (at most eight). */
  recent: MissedScreen[];
  /** When the newest was kept. */
  last: string;
  /** The word remembering it would use (`placeWord`), or null. */
  word: string | null;
}

export interface MissedReport {
  id: number;
  title: string;
  source: string;
  status: string;
  why: string;
  context: { app: string; window: string; lines: string[] } | null;
  /** Where Didja looks for it done, in words. */
  watching: string[];
  places: MissedPlace[];
  /** The app word a place you pick is remembered for (a capitalised word in the title), or null. */
  word: string | null;
  /** The words a screen's app or site must name for Didja to look at it for this task. */
  keywords: string[];
  /** The conversation it came from, and how many other steps from it are still open. */
  conversation: string;
  openInConversation: number;
  /** Whether "looks done" ticks by itself (Accept Automatically) or asks you. */
  acceptsLooksDone: boolean;
}

/** Words that name no app: page plumbing, UI verbs, and the tools tasks come from. */
const GENERIC = new Set(`main index home page pages view views apps app edit list item items open save select click import
export settings admin login signin dashboard search new add update delete remove form forms record records default
claude code repo chat conversation project projects workbench connection linear github mail inbox www html aspx
https http content static assets api docs help`.split(/\s+/));

/**
 * The word a place you teach is remembered for: the app the steps are done in. From the site's own
 * addresses first (the most common first path segment there, "…/planner/…"), else a word of the
 * conversation's name that also shows on those screens. Never a word of the step's own text:
 * "Import", "Select" and "Save" would tie unrelated steps together. Null when nothing fits: the place
 * then applies only to the conversation's steps.
 */
export function placeWord(conversation: string, screens: Pick<Observation, 'url' | 'windowTitle' | 'text'>[]): string | null {
  const counts = new Map<string, number>();
  for (const o of screens) {
    try {
      const first = o.url ? new URL(o.url).pathname.split('/').find((p) => p.length > 0) : undefined;
      const word = first?.toLowerCase();
      if (word && /^[a-z]{4,}$/.test(word) && !GENERIC.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
    } catch {
      // no usable address
    }
  }
  const fromPath = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (fromPath) return fromPath;
  const seen = screens.map((o) => `${o.windowTitle}\n${o.text}`.toLowerCase()).join('\n');
  const named = conversation.split(/[^\p{L}]+/u).map((w) => w.toLowerCase()).filter((w) => w.length >= 4 && !GENERIC.has(w));
  return named.find((w) => seen.includes(w)) ?? null;
}

/** The kept screens at a site since a time. */
function screensAt(store: Store, site: string, since: string): Observation[] {
  return store.observationsSince(since).filter((o) => siteOf(o) === site);
}

/** How many places Didja Missed This offers at most. */
export const MAX_PLACES = 16;

export function missedReport(store: Store, id: number, now: Date = new Date()): MissedReport | null {
  const task = store.getTask(id);
  if (!task) return null;
  const context = store.context(id);
  const learned = store.donePlaces();
  const since = new Date(Math.max(Date.parse(task.createdAt), now.getTime() - 24 * 3600_000)).toISOString();
  const bySite = new Map<string, MissedPlace>();
  for (const o of store.observationsSince(since)) {
    const site = siteOf(o);
    const place = bySite.get(site) ?? { site, app: o.app, screens: 0, lines: [], watched: false, recent: [], last: o.ts, word: null };
    place.screens++;
    const lines = o.text.split('\n').filter((l) => l.trim());
    place.lines = [...place.lines, ...lines].slice(-6);
    place.recent = [{ id: o.id, ts: o.ts, window: o.windowTitle, lines: lines.slice(0, 40) }, ...place.recent].slice(0, 8);
    place.last = o.ts;
    bySite.set(site, place);
  }
  const where = (p: MissedPlace) => ({ app: p.app, url: p.site.includes('.') ? `https://${p.site}/` : null });
  const all = store.observationsSince(since);
  for (const p of bySite.values()) {
    p.word = placeWord(task.sourceRef, all.filter((o) => siteOf(o) === p.site));
    const kw = keywords(task.capturedTitle);
    const named = [...p.site.split(/[.-]/), ...p.app.toLowerCase().split(/[^a-z0-9]+/)].some((w) => w.length >= 3 && kw.includes(w));
    p.watched = named || learnedWhere({ title: task.capturedTitle, sourceId: task.sourceId }, where(p), learned);
  }
  // The likeliest first: where you were most recently. A step from a conversation with Claude is
  // done somewhere else, so that app goes last; an email or a chat ask is often done right where
  // it came from (approved, answered, signed in Outlook itself), so its app keeps its place.
  const sourceApp = (context?.app ?? task.sourceRef.split(' — ')[0] ?? '').toLowerCase();
  const fromApp = task.sourceKind === 'email' || task.sourceKind === 'chat' ? '' : sourceApp;
  const sorted = [...bySite.values()]
    .sort((a, b) => Number(a.app.toLowerCase() === fromApp) - Number(b.app.toLowerCase() === fromApp) || b.last.localeCompare(a.last));
  // Every app you were in is offered: its latest place before a second site of the same app,
  // so many browser sites never push an app off the list. The app the task came from is kept
  // first of all, however many other apps you used (a native app has no address: its place is
  // the app itself, `siteOf`). Shown in the order above.
  const firstOfApp = sorted.filter((p, i) => sorted.findIndex((q) => q.app === p.app) === i);
  const own = firstOfApp.filter((p) => p.app.toLowerCase() === sourceApp);
  const kept = new Set([...new Set([...own, ...firstOfApp, ...sorted])].slice(0, MAX_PLACES));
  const places = sorted.filter((p) => kept.has(p));
  const watching = [
    `Screens whose app or site names one of: ${keywords(task.capturedTitle).join(', ') || '(no words to go by)'}.`,
    ...(task.criteria?.links ?? []).map((l) => `The page its email linked to: ${l}`),
    ...learned.filter((p) => p.source === task.sourceId || (p.word !== null && keywords(task.capturedTitle).includes(p.word)))
      .map((p) => `${p.site}, where you said a step like it was done.`),
  ];
  return {
    id, title: task.title, source: task.sourceRef, status: task.status,
    why: formatWhy(task, store.listEvidence(id)),
    context: context ? { app: context.app, window: context.window, lines: context.lines.map((l) => l.text) } : null,
    watching, places, word: places[0]?.word ?? null,
    keywords: keywords(task.capturedTitle),
    conversation: task.sourceRef,
    openInConversation: store.listTasks().filter((t) => t.sourceId === task.sourceId && t.id !== id && !t.isGroup).length,
    acceptsLooksDone: store.looksDoneMode() === 'accept',
  };
}

/**
 * "This shows it done": you point at the screen where you did a task. It is ticked, with that
 * screen as its evidence, and its site is remembered for steps like it.
 */
export function doneAt(store: Store, id: number, observationId: number, now: Date = new Date()): { site: string } | null {
  const task = store.getTask(id);
  const o = store.observation(observationId);
  if (!task || !o) return null;
  const site = siteOf(o);
  store.withOutcome(id, 'shown-done', now, () => store.setStatus(id, 'done', now));
  store.addNote(id, 'judged', now.toISOString(), `You showed it done on ${o.app} — ${o.windowTitle} (${site})`);
  store.recordConfirmed(id, site, now);
  store.addDonePlace(id, site, wordForPlace(store, task, site, now), now);
  return { site };
}

/** The word for teaching `site` from this task: from the screens kept there in the last day. */
export function wordForPlace(store: Store, task: { sourceRef: string }, site: string, now: Date = new Date()): string | null {
  return placeWord(task.sourceRef, screensAt(store, site, new Date(now.getTime() - 24 * 3600_000).toISOString()));
}

/**
 * Places taught before the word came from the site (it was a capitalised word of the step: "Import")
 * are given the right word once, from what is still kept there.
 */
export function rewordPlacesOnce(store: Store, now: Date = new Date()): number {
  if (store.getMeta('places_reworded') === 'yes') return 0;
  let changed = 0;
  for (const p of store.donePlacesShown()) {
    const word = placeWord(p.conversation ?? '', screensAt(store, p.site, new Date(now.getTime() - 24 * 3600_000).toISOString()));
    if (word !== p.word && store.setDonePlaceWord(p.id, word)) changed++;
  }
  store.setMeta('places_reworded', 'yes');
  return changed;
}
