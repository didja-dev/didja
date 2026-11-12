import { matchesApp, matchesURL, profiles } from './profiles.ts';
import type { Teaching } from './store.ts';
/**
 * Emails that need a reply (Milestone 4).
 *
 * The capture layer marks the email open in Outlook as its own section:
 *
 *     ⟦Email⟧
 *     Subject: Q3 budget numbers
 *     From: Dana Levi, dana@example.com
 *     Date: Today at 15:05
 *     To: you@example.com
 *     …the body…
 *
 * This file reads those sections, drops what is plainly automatic, and says
 * what to ask the on-device model. Whether a reply is needed is the model's
 * call; noticing that a reply was sent is done here, by subject and sender.
 */

export interface Email {
  subject: string;
  /** The sender as shown: "Dana Levi, dana@example.com". */
  from: string;
  fromName: string;
  fromAddress: string | null;
  to: string;
  date: string | null;
  body: string[];
  /** Outlook's reactions summary on it, "1 Like": how many and which, not whose. */
  reactions?: string;
}

/** What an email asks of its reader, in the model's words. */
export interface MailVerdict {
  /** reply: a written answer is awaited. action: something to do elsewhere. none: nothing asked. */
  need: 'reply' | 'action' | 'none';
  /** The thing to do: "Update card details on PayPal". */
  task: string;
  /** Who is asking, where the model could tell: the writer of the request, not a forwarder. */
  asker?: string;
}
/** Asks the on-device model what an email asks of its reader. Null when there is no model. */
export type MailReader = (email: MailSnippet & { teach?: Teaching }) => MailVerdict | null;

/** Where mail is read: "Microsoft Outlook", "Gmail"; null for a window that is not mail. An email
 * app's profile names it by the app; a site's by the profile's own name. */
export function mailSource(window: { bundleId: string; app: string; url: string | null }): string | null {
  const mail = profiles().filter((p) => p.kind === 'email');
  if (mail.some((p) => matchesApp(p, window.bundleId))) return window.app;
  return mail.find((p) => matchesURL(p, window.url))?.name ?? null;
}

/** Who you are in your mail: the addresses and names your own messages are sent as. */
export interface MailIdentity {
  addresses: string[];
  names: string[];
}

const BROWSER_SUFFIX = /\s+[-–—]\s+(Microsoft Edge|Google Chrome|Safari|Arc|Brave|Firefox)$/i;

/**
 * The account a mail window says it belongs to, from its title:
 * Outlook for Mac, "Inbox • you@example.com"; Outlook on the web,
 * "Mail - Your Name - Outlook". Only these exact shapes count, so an address
 * in an email's subject is never taken for yours.
 */
/** Outlook for Mac titles its window with the account; other apps' titles are not read for it. */
const OUTLOOK_APP = 'com.microsoft.Outlook';

export function accountOf(window: { bundleId: string; windowTitle: string }, mailbox: string): MailIdentity {
  const found: MailIdentity = { addresses: [], names: [] };
  const title = window.windowTitle.trim();
  if (window.bundleId === OUTLOOK_APP) {
    const address = title.match(/•\s*([^\s•]+@[^\s•]+\.[a-z]{2,})$/i)?.[1];
    if (address && ADDRESS.test(address)) found.addresses.push(address.toLowerCase());
  } else if (mailbox === 'Outlook on the web') {
    const parts = title.replace(BROWSER_SUFFIX, '').split(/\s+-\s+/);
    if (parts.length >= 3 && parts.at(-1) === 'Outlook') {
      const account = parts.at(-2)!.replace(/\s+/g, ' ').trim();
      if (new RegExp(`^${ADDRESS.source}$`, 'i').test(account)) found.addresses.push(account.toLowerCase());
      else if (account.length >= 2 && account.length <= 60 && !/@/.test(account)) found.names.push(account);
    }
  }
  return found;
}

/** Whether an email was sent by you: by address where the page shows one, by name where it shows only that. */
export function isMine(email: Email, me: MailIdentity): boolean {
  if (email.fromAddress !== null) return me.addresses.includes(email.fromAddress);
  const name = email.fromName.replace(/\s+/g, ' ').trim().toLowerCase();
  return name !== '' && me.names.some((n) => n.toLowerCase() === name);
}

/** "⟦Email⟧", "⟦Email: Q3 numbers⟧" or, for one message of a thread, "⟦Email 2: Q3 numbers⟧". */
const EMAIL_SECTION = /^⟦Email(?: \d+)?(?:: (.*))?⟧$/;
const SECTION_LINE = /^⟦.*⟧$/;
const ADDRESS = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/** The emails in a window's captured text, oldest first. */
export function parseEmails(text: string): Email[] {
  const emails: Email[] = [];
  let current: Email | null = null;
  let named = false;
  let inEmail = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (SECTION_LINE.test(line)) {
      const section = line.match(EMAIL_SECTION);
      inEmail = section !== null;
      named = section?.[1] !== undefined;
      if (section?.[1] !== undefined) {
        // The section names its email: each one is a message of its own.
        current = { subject: section[1], from: '', fromName: '', fromAddress: null, to: '', date: null, body: [] };
        emails.push(current);
      }
      continue;
    }
    if (!inEmail || line === '') continue;
    const reacted = line.match(/^Reactions: (\d+ .+)$/);
    if (reacted && current) {
      current.reactions = reacted[1]; // not body text: it must not change what the email is
      continue;
    }
    const header = line.match(/^(Subject|From|Date|To): (.+)$/);
    // In a section named after its email, a subject line is the quoted header of
    // a forwarded or earlier message, and is body text.
    const opens = header?.[1] === 'Subject' && !named;
    if (opens) {
      // A new subject line starts a new email, unless it is the same one seen again.
      if (!current || current.subject !== header![2]) {
        current = { subject: header![2]!, from: '', fromName: '', fromAddress: null, to: '', date: null, body: [] };
        emails.push(current);
      }
      continue;
    }
    if (!current) continue; // body lines of an email whose header we never saw
    // The message's own header comes first and once. A "From:" further down is
    // the quoted header of an earlier message in the thread, and is body text.
    const taken = { From: current.from !== '', Date: current.date !== null, To: current.to !== '' }[header?.[1] ?? ''];
    if (header && (taken || current.body.length > 0)) {
      if (!current.body.includes(line)) current.body.push(line);
      continue;
    }
    if (header?.[1] === 'From') {
      current.from = header[2]!;
      current.fromAddress = header[2]!.match(ADDRESS)?.[0]?.toLowerCase() ?? null;
      current.fromName = header[2]!.replace(ADDRESS, '').replace(/[<>,;]+/g, ' ').replace(/\s+/g, ' ').trim().replace(PRESENCE, '') || header[2]!;
    } else if (header?.[1] === 'Date') {
      current.date = header[2]!;
    } else if (header?.[1] === 'To') {
      current.to = header[2]!;
    } else if (!current.body.includes(line)) {
      current.body.push(line);
    }
  }
  return emails.filter((e) => e.from !== '');
}

/**
 * Outlook reads the sender's presence out after the name: "Dana Levi Available".
 * It is not part of the name.
 */
const PRESENCE = /\s+(available|away|busy|offline|do not disturb|be right back|out of office|in a meeting|in a call|presenting|focusing|appear away|appear offline|presence unknown|status unknown)$/i;

/** "Re: Fwd: Q3 numbers" → "q3 numbers". */
export function baseSubject(subject: string): string {
  let s = subject.trim();
  for (;;) {
    const next = s.replace(/^(re|fw|fwd|aw|sv|wg|תשובה|השב|הועבר)\s*(\[\d+\])?\s*[:：]\s*/i, '');
    if (next === s) break;
    s = next;
  }
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function isReply(subject: string): boolean {
  return /^(re|aw|sv|תשובה|השב)\s*(\[\d+\])?\s*[:：]/i.test(subject.trim());
}

/** Senders nobody reads replies at: services, notifications, platforms. */
const SERVICE_SENDER =
  /\b(no-?reply|do-?not-?reply|notifications?|newsletter|mailer|mailer-daemon|bounces?|alerts?|updates?|digest|receipts?|billing|invoices?|marketing|news|info|support|hello|team|calendar|service|accounts?|security)@|@(?:[a-z0-9-]+\.)*(github|linkedin|stripe|vercel|notion|slack|atlassian|google|facebook|medium|substack)\.(com|so|io)$/i;
/** Mail that is never a request: calendar replies, auto-replies, bounces, list traffic. */
const NEVER_A_REQUEST_SUBJECT =
  /^(invitation|accepted|declined|tentative|canceled|cancelled|updated invitation|automatic reply|out of office|undeliverable|welcome to|password reset|\[[^\]]+\])\b/i;
/** Receipts and confirmations: only a request when they say something needs doing. */
const RECEIPT_SUBJECT = /^(receipt|your receipt|invoice|your invoice|order confirmation|payment|your payment|your order)\b/i;
/** Newsletters and marketing carry a way out of the list. */
const NEWSLETTER_BODY = /\bunsubscribe\b|\bmanage (?:your )?(?:email )?preferences\b|\bview (?:this email )?in (?:your )?browser\b/i;
/** A message that says it was sent by a machine. */
const MACHINE_BODY = /\bthis is an automated\b|\bdo not reply to this\b|\bplease do not reply\b/i;
/**
 * Words a service uses when something needs doing on your side: "update your
 * card", "action required", "your plan expires", "payment failed".
 */
const STEP_NEEDED =
  /\baction (?:is )?required\b|\b(?:update|verify|confirm|renew|re-?enter|review|approve|sign|complete|reactivate|add) (?:your|the|this)\b|\b(?:expires?|expiring|expired|failed|declined|overdue|past due|suspended|on hold|will be (?:closed|cancell?ed|suspended))\b/i;

/** How people ask for something in a message. */
const PERSON_ASKS = /\b(?:can|could|would) you\b|\bplease\b|\?/i;

/**
 * Mail not worth asking the model about: newsletters, receipts, notifications,
 * calendar traffic. A service's message still goes to the model when it says
 * something needs doing on your side ("Payment failed: update your card"),
 * because those are often exactly the requests worth a task. Newsletters never do.
 */
export function isAutomatic(email: Email): boolean {
  const subject = email.subject.trim();
  const body = email.body.join('\n');
  if (NEVER_A_REQUEST_SUBJECT.test(subject) || NEWSLETTER_BODY.test(body)) return true;
  const fromService = (email.fromAddress !== null && SERVICE_SENDER.test(email.fromAddress)) || MACHINE_BODY.test(body);
  const asked = STEP_NEEDED.test(`${subject}\n${body}`);
  if (fromService) return !asked;
  // A receipt-like subject from a person ("Payment for the venue") may still ask something.
  if (RECEIPT_SUBJECT.test(subject)) return !asked && !PERSON_ASKS.test(body);
  return false;
}

/**
 * Whether Outlook's date line says the email arrived today or yesterday.
 * Older mail opened from the archive is not a fresh request.
 */
export function isRecent(date: string | null, now: Date = new Date()): boolean {
  if (!date) return false;
  if (/^(today|yesterday|היום|אתמול)\b/i.test(date.trim())) return true;
  // Gmail: "Mon 9 Nov, 15:05 (2 hours ago)", "15:05 (12 minutes ago)", "8 Nov 2026, 10:00 (2 days ago)".
  const ago = date.match(/\((\d+)\s+(minute|hour|day)s?\s+ago\)/i);
  if (ago) return ago[2]!.toLowerCase() !== 'day' || Number(ago[1]) <= 1;
  // Outlook on the web: "Mon 11/9/2026 9:15 AM". Month and day swap places with
  // the language, so either reading counts.
  const slashed = date.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (slashed) {
    const [a, b, year] = [Number(slashed[1]), Number(slashed[2]), Number(slashed[3])];
    return [[a, b], [b, a]].some(([month, day]) => {
      if (month! > 12) return false;
      const age = now.getTime() - new Date(year, month! - 1, day!).getTime();
      return age > -24 * 3600_000 && age < 3 * 24 * 3600_000;
    });
  }
  const parsed = Date.parse(date.replace(/\bat\b/i, ''));
  if (Number.isNaN(parsed)) return false;
  const age = now.getTime() - parsed;
  return age > -24 * 3600_000 && age < 3 * 24 * 3600_000;
}

/** The title to fall back on when the model's own wording is not usable. */
export function replyTitle(email: Email): string {
  return `Reply to ${email.fromName}: ${email.subject.trim()}`.slice(0, 200);
}

/**
 * The task an email becomes: what to do, in the model's words ("Update card
 * details on PayPal"), or the fallback if it gave nothing usable.
 */
export function mailTaskTitle(email: Email, verdict: MailVerdict): string {
  const task = verdict.task
    .split(/\r?\n/)[0]!
    .replace(/^["“”'‘’\s]+|["“”'‘’\s.]+$/g, '')
    .replace(/\s+/g, ' ');
  const words = task.split(' ').length;
  const usable = task.length >= 8 && task.length <= 90 && words >= 2 && !/^none$/i.test(task) && !/^reply to (the|this) (e-?mail|message)$/i.test(task);
  if (!usable) return replyTitle(email);
  // A forward: the task is for whoever wrote the request, so a title that names
  // the person who passed it on is put right.
  const asker = (verdict.asker ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!forwardOf(email).forwarded || !asker || asker.toLowerCase() === email.fromName.toLowerCase()) return task;
  const names = [email.fromName, email.fromName.split(' ')[0]!]
    .filter((n) => n.length >= 2)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return names.length ? task.replace(new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.join('|')})(?![\\p{L}\\p{N}])`, 'iu'), asker) : task;
}

/** Mail from an address nobody reads: an answer cannot be what is wanted. */
const UNANSWERABLE = /^(service|no-?reply|do-?not-?reply|notifications?|alerts?|billing|accounts?|security|mailer)@/i;

/** A machine cannot be waiting for a written answer: what it asks is done elsewhere. */
export function settleNeed(email: Email, verdict: MailVerdict): MailVerdict {
  const machine = email.fromName.includes('@') || (email.fromAddress !== null && UNANSWERABLE.test(email.fromAddress));
  return verdict.need === 'reply' && machine ? { ...verdict, need: 'action' } : verdict;
}

/**
 * A link as it was meant, with the wrapping a mail filter put around it taken
 * off: Proofpoint ("urldefense.com/v3/__<link>__;…") and Outlook Safe Links
 * ("…safelinks.protection.outlook.com/?url=<link>").
 */
export function unwrapLink(url: string): string {
  const proofpoint = url.match(/^https:\/\/urldefense\.com\/v3\/__(.+?)__;/i);
  if (proofpoint) return proofpoint[1]!;
  try {
    const parsed = new URL(url);
    if (/\.safelinks\.protection\.outlook\.com$/i.test(parsed.hostname)) return parsed.searchParams.get('url') ?? url;
  } catch {
    // not an address: leave it
  }
  return url;
}

const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function pageOf(url: string): { host: string; path: string; ids: string[] } | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return {
      host: parsed.hostname.toLowerCase(),
      path: parsed.pathname.replace(/\/+$/, '').toLowerCase(),
      ids: (url.match(GUID) ?? []).map((id) => id.toLowerCase()),
    };
  } catch {
    return null;
  }
}

/**
 * The pages an email's links point to, for noticing later that you went there.
 * Only links that name one particular page are kept: a path, or a record id.
 * A link to a site's front page says nothing about what you did there.
 */
export function mailLinks(email: Email): string[] {
  const found = email.body.join('\n').match(/https?:\/\/[^\s<>"'‹›⟨⟩]+/g) ?? [];
  const links: string[] = [];
  for (const raw of found) {
    const link = unwrapLink(raw.replace(/[).,;:!?\]]+$/, ''));
    const page = pageOf(link);
    if (!page || (page.path === '' && page.ids.length === 0)) continue;
    if (/unsubscribe|preferences|privacy|terms|\.(png|jpe?g|gif|svg)$/i.test(page.path)) continue;
    if (!links.includes(link)) links.push(link);
    if (links.length >= 8) break;
  }
  return links;
}

/**
 * Whether the page you are on is the one a link pointed to: the same site and
 * path, and every record id in the link is in the address. Stricter than it
 * needs to be on purpose; this is what lets a task be ticked.
 */
export function followsLink(visited: string | null, link: string): boolean {
  const here = visited ? pageOf(visited) : null;
  const there = pageOf(link);
  if (!here || !there) return false;
  if (there.path === '' && there.ids.length === 0) return false;
  return here.host === there.host && here.path === there.path && there.ids.every((id) => here.ids.includes(id));
}

/**
 * What an email is known by: sender, subject and when it was sent, hashed. The
 * date is taken without the parts that change as time passes ("Today at",
 * "(12 minutes ago)"), so the same email has the same key an hour later.
 */
export function mailKey(email: Email): string {
  const when = (email.date ?? '')
    .replace(/\s*\([^)]*\bago\)/i, '')
    .replace(/^(today|yesterday|היום|אתמול)\s*(at|ב-?)?\s*/i, '')
    .trim();
  return new Bun.CryptoHasher('sha256')
    .update(`${(email.fromAddress ?? email.fromName).toLowerCase()}\n${baseSubject(email.subject)}\n${when}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * The model's name for who is asking, completed from the message: it tends to
 * stop at a quotation mark ("תמר - מנה" for a line signed תמר - מנה"ח). If a
 * short line of the message starts with that name, the whole line is the signature.
 */
export function signedName(email: Email, asker: string | undefined): string | undefined {
  const name = (asker ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 2) return asker;
  const squash = (t: string) => t.replace(/\s+/g, '').toLowerCase();
  const lines = email.body.map((l) => l.trim()).filter((l) => l.length <= 40);
  const line =
    lines.find((l) => l.length > name.length && squash(l).startsWith(squash(name))) ??
    // It can also join the full name from the header to the role ("נועה כץ - מש" for a line
    // signed נועה - מש"א): a line with the same first name and a role that starts the same way.
    lines.find((l) => {
      const [who, role] = [splitRole(name), splitRole(l)];
      return who && role && role.role.length > who.role.length && squash(role.role).startsWith(squash(who.role)) && squash(role.who) === squash(who.who.split(' ')[0]!);
    });
  return line ? line.replace(/[\s,.;:–-]+$/, '') : name;
}

/** "נועה - מש"א" as its name and role, when a dash parts them. */
function splitRole(signature: string): { who: string; role: string } | null {
  const match = signature.match(/^([^-–]+?)\s*[-–]\s*(.{2,})$/);
  return match ? { who: match[1]!.trim(), role: match[2]!.trim() } : null;
}

const FORWARD_SUBJECT = /^(fw|fwd|wg|tr|הועבר|העבר)\s*[:：]/i;
const FORWARD_MARK = /forwarded message|הודעה שהועברה|^-{2,}\s*original message|^begin forwarded message/i;
const QUOTED_FROM = /^(?:from|מאת|von|de)\s*[:：]\s*(.+)$/i;

/**
 * Whether the sender only passed this message on, and who wrote the message
 * inside it, read from the quoted header ("From: Tamar Cohen <tamar@school.org>").
 */
export function forwardOf(email: Email): { forwarded: boolean; writtenBy: string | null } {
  const mark = email.body.findIndex((line) => FORWARD_MARK.test(line));
  const forwarded = FORWARD_SUBJECT.test(email.subject.trim()) || mark !== -1;
  if (!forwarded) return { forwarded, writtenBy: null };
  for (const line of email.body.slice(Math.max(mark, 0))) {
    const from = line.match(QUOTED_FROM)?.[1];
    if (!from) continue;
    // Outlook runs the quoted header together: "From: Tamar <e@x.org>Sent: Monday…".
    const name = from.split(/\b(?:sent|date|נשלח|תאריך)\s*[:：]/i)[0]!.replace(ADDRESS, '').replace(/[<>"“”,;]+/g, ' ').replace(/\s+/g, ' ').trim();
    return { forwarded, writtenBy: name || (from.match(ADDRESS)?.[0] ?? null) };
  }
  return { forwarded, writtenBy: null };
}

/**
 * Where a mail task came from, to show under it: never the body. `asker` is
 * who the model says wrote the request, shown when it is not the sender.
 */
export function mailOrigin(email: Email, asker?: string): string {
  const { forwarded, writtenBy } = forwardOf(email);
  const writer = (asker ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || writtenBy;
  const who = forwarded
    ? `forwarded by ${email.fromName}${writer && writer.toLowerCase() !== email.fromName.toLowerCase() ? `, written by ${writer}` : ''}`
    : email.fromName;
  return `From an email: ${who} — “${email.subject.trim().slice(0, 80)}”`;
}

export interface MailSnippet {
  from: string;
  subject: string;
  body: string;
  /** Set when `from` only passed the message on. */
  forwarded?: true;
  /** Who wrote the message inside, where its quoted header says. */
  writtenBy?: string;
}

/** What is shown to the model: enough of the message to tell, and no more. */
export function mailSnippet(email: Email): MailSnippet {
  const { forwarded, writtenBy } = forwardOf(email);
  // A forward starts with a quoted header, and the request and its signature come after it.
  const body = email.body.join('\n').slice(0, forwarded ? 1500 : 900);
  return { from: email.fromName, subject: email.subject, body, ...(forwarded ? { forwarded: true as const } : {}), ...(writtenBy ? { writtenBy } : {}) };
}
