/**
 * E-signature requests (DocuSign, Adobe Sign, Dropbox Sign, PandaDoc, SignNow) sent by email.
 *
 * Opening the email's link goes through redirects (a link-protection wrapper, DocuSign's
 * EmailStart, then the signing app) so the address you end on is never the link itself. What
 * carries through is the request's own long id. And when you finish, these services say so in
 * plain words ("A copy of this document has been sent to your Docusign account", "You're done
 * signing"), which the on-device model read as not done. So: a page whose address carries the
 * email's link id starts the signing; the finished message on that service within 15 minutes
 * after it ticks the task. A page of the same service for some other document does not.
 */
import type { Observation, Store, Task } from './store.ts';
import { followsLink } from './email.ts';

const ESIGN_HOST = /(^|\.)(docusign\.(net|com)|echosign\.com|adobesign\.com|documents\.adobe\.com|hellosign\.com|sign\.dropbox\.com|pandadoc\.com|signnow\.com)$/i;

/** The finished state, as these services word it. */
const ESIGN_DONE =
  /you(?:'|’)?ve finished signing|you(?:'|’)?re done signing|you have (?:finished|completed) signing|(?:this|the|your) document (?:has been|is) (?:completed|signed)|a copy of (?:this|the|your)(?: signed| completed)? document has been (?:sent|saved|emailed)|signing (?:is )?complete|thank you for signing|all parties have signed|envelope (?:has been )?completed/i;

/** How long after opening the link the finished message may come. */
export const SIGNING_WINDOW_MS = 15 * 60_000;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function isESignURL(url: string | null): boolean {
  return !!url && ESIGN_HOST.test(hostOf(url));
}

/**
 * Ids that name a person or an account, the same on every request you receive: never evidence that
 * a page belongs to one particular request (DocuSign's `er` is you, `acct` the sender's account).
 */
const SHARED_ID_KEYS = new Set(['er', 'acct', 'account', 'accountid', 'recipient', 'recipientid', 'uid', 'userid', 'user', 'u', 'email']);

/**
 * The long ids (hex, with or without dashes; lower-cased, dashes dropped) that name this request:
 * those in the path, and in query values other than a person's or account's.
 */
export function longIds(url: string): string[] {
  let parts: string[];
  try {
    const u = new URL(url);
    parts = [u.pathname, ...[...u.searchParams].filter(([k]) => !SHARED_ID_KEYS.has(k.toLowerCase())).map(([, v]) => v)];
  } catch {
    parts = [url];
  }
  const plain = parts.join(' ').toLowerCase().replace(/-/g, '');
  return [...new Set(plain.match(/[0-9a-f]{24,}/g) ?? [])];
}

/** Whether a visited address belongs to the request an email's link opens: the same page, or one carrying its long id. */
export function opensLink(visited: string, link: string): boolean {
  if (followsLink(visited, link)) return true;
  const theirs = longIds(link);
  if (theirs.length === 0) return false;
  return longIds(visited).some((mine) => theirs.some((t) => t.includes(mine.slice(0, 24)) || mine.includes(t.slice(0, 24))));
}

export function isSigningDone(text: string): boolean {
  return ESIGN_DONE.test(text);
}

/** "Docusign", "Adobe Sign"…, from an address, for the note. */
function service(url: string): string {
  const host = hostOf(url);
  if (host.includes('docusign')) return 'DocuSign';
  if (host.includes('adobe') || host.includes('echosign')) return 'Adobe Sign';
  if (host.includes('dropbox') || host.includes('hellosign')) return 'Dropbox Sign';
  if (host.includes('pandadoc')) return 'PandaDoc';
  return 'SignNow';
}

export const SIGNED_NOTE = 'Ticked: you opened the email’s signing link and';

/** Tasks from emails whose link opens an e-signature request, ticked when that request is signed. */
export function signedFromEmail(store: Store, observations: Observation[], now: Date): number {
  let ticked = 0;
  const tasks: Task[] = store.tasksWithLinks().filter((t) => t.status === 'open' && t.criteria!.links!.some((l) => isESignURL(l)));
  if (tasks.length === 0) return 0;
  for (const task of tasks) {
    const links = task.criteria!.links!.filter((l) => isESignURL(l));
    const started = store.pagesSeenSince(task.createdAt).find((page) => links.some((link) => opensLink(page.url, link)));
    if (!started) continue;
    const from = Date.parse(started.ts);
    // Reopened after being ticked this way: it was not that; leave it to you.
    if (store.listEvidence(task.id).some((e) => e.detail?.startsWith(SIGNED_NOTE))) continue;
    const done = observations.find((o) =>
      isESignURL(o.url) && Date.parse(o.ts) >= from && Date.parse(o.ts) - from <= SIGNING_WINDOW_MS && isSigningDone(o.text));
    if (!done) continue;
    store.tickSeen(task.id, done.id, `${SIGNED_NOTE} ${service(done.url!)} then said the document was signed`, now);
    ticked++;
  }
  return ticked;
}
