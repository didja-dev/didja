/**
 * A GitHub issue about a miss, drafted for the user's own Claude (`didja mcp` › `draft_issue`,
 * SCR-57). Didja writes the issue: a fixed template, the facts it knows (app, bundle id, profile,
 * versions) and what capture kept, masked by Didja itself. Claude adds only its diagnosis in
 * words, which is checked here for anything from the user's screen before a draft is given back.
 * Nothing is sent: the result is text and a link the user opens themselves.
 */
import { mask, UI_WORDS } from './mcp.ts';

export const ISSUES = 'https://github.com/didja-dev/didja/issues';

export type IssueKind = 'missed-task' | 'app-support';
export const ISSUE_KINDS: readonly IssueKind[] = ['missed-task', 'app-support'];

/** What Claude found, in its own words. */
export interface Diagnosis {
  /** What was missed or misread. */
  what: string;
  cause: string;
  fix: string;
}

/** What Didja knows about the case, and what it kept (masked here). */
export interface IssueFacts {
  app: string;
  bundleId: string | null;
  profile: string | null;
  didja: string | null;
  macos: string | null;
  /** Lines as kept: masked when the draft is made. */
  kept: string[];
  /** Words from the user's screen and tasks for this case, unmasked: none may appear in the diagnosis. */
  privateWords: Set<string>;
}

export interface IssueDraft {
  title: string;
  body: string;
  fingerprint: string;
  /** Opens a new issue with every field filled in; the bare form when the text is too long for a link. */
  url: string;
  /** True when `url` could not hold the text: the user pastes `body` into the form. */
  pasteBody: boolean;
  /** Existing issues with the same fingerprint, to add to instead of opening another. */
  search: string;
}

/** Links longer than this are cut by browsers or GitHub. */
export const MAX_URL = 7000;
const MAX_PROSE = 1500;
const MAX_KEPT = 30;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** A miss type: two to eight lowercase words joined by hyphens, "place-missing-no-address". */
const MISS = /^[a-z0-9]+(?:-[a-z0-9]+){1,7}$/;
const BUNDLE = /^[A-Za-z0-9][A-Za-z0-9.-]{1,120}$/;

/** "com.microsoft.Outlook:place-missing-no-address", or null when either part is not well formed. */
export function fingerprint(bundleId: string | null, miss: string): string | null {
  if (!MISS.test(miss)) return null;
  const app = bundleId && BUNDLE.test(bundleId) ? bundleId : 'unknown-app';
  return `${app}:${miss}`;
}

/**
 * Common English words, and the words a diagnosis of Didja needs. They may appear in the
 * diagnosis even when the user's screen also had them; anything else from the screen may not.
 */
const COMMON = new Set(`about above after again against also although always another anything around because been before
being below between both cannot could does doing down during each either else enough even ever every first found from
have having here into just last least less like little made make many maybe might more most much must near need needs
never next none nothing once only other ought over same seems should since some something still such than that their
them then there these they thing things this those though through under until upon very want were what when where
whether which while whom whose will with within without would your yours also already instead rather really seen
shown shows show gets getting given gives take takes taken took tell told think used uses using went come comes came
look looks looked keep keeps kept leave leaves left line lines word words text texts part parts place places screen
screens window windows title titles header headers body field fields label labels button buttons link links address
addresses site sites page pages view views list lists item items task tasks step steps conversation conversations
mail email emails message messages chat chats sender senders recipient recipients subject subjects reply replies
response responses action actions request requests approval approvals approve approved reject rejected forward
forwarded sent inbox folder folders compose draft drafts capture captured captures captures reading reads read
engine profile profiles fixture fixtures rule rules model models outline role roles class classes match matches
matched matching missed miss misses tick ticks ticked ticking done open opened opens close closed dismissed
snoozed archive archived archiving notice notices didja because likely cause causes fix fixes suggested suggest
should would could app apps application applications native browser browsers address none no-address workflow
workflows mailer notification notifications new older newer time times date dates name names user users
same different another other version versions macos accessibility focus focused front first second third
group grouped grouping keyed key keys never always once twice every each when whose which where`.split(/\s+/));

/** The words of some text that could say something about the user: not label words, not common ones. */
export function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.match(/[\p{L}\p{M}]+/gu) ?? []) {
    const lower = w.toLowerCase();
    const latin = /^[a-z]+$/.test(lower);
    if (latin && (lower.length < 4 || /^x+$/.test(lower))) continue;
    if (!latin && [...lower].length < 2) continue;
    if (UI_WORDS.has(lower) || COMMON.has(lower)) continue;
    out.add(lower);
  }
  return out;
}

/**
 * What in Claude's words could identify the user, described without repeating it: an email
 * address, a web address with a path, a number of three or more digits (masked text is all
 * zeros), or a word from the user's screen. Empty when the words are clean.
 */
export function leaks(text: string, privateWords: Set<string>, allowed: Set<string> = new Set()): string[] {
  const found: string[] = [];
  // Masked text (only x and 0 left) is fine; an address with any other letter or digit is not.
  const unmasked = (s: string) => /[a-wyz1-9]/i.test(s);
  if ((text.match(EMAIL) ?? []).some(unmasked)) found.push('an email address');
  for (const url of text.match(/https?:\/\/[^\s)>\]]+/gi) ?? []) {
    let path = '';
    try { const u = new URL(url); path = `${u.pathname}${u.search}${u.hash}`; } catch { path = url; }
    if (path.replace(/\/+$/, '') !== '' && !url.startsWith(`${ISSUES.replace(/\/issues$/, '')}`)) {
      found.push('a web address with a path or query (keep only the site, e.g. example.com)');
      break;
    }
  }
  if ((text.match(/\d{3,}/g) ?? []).some((n) => /[1-9]/.test(n))) found.push('a number of three or more digits');
  const words = [...(text.match(/[\p{L}\p{M}]+/gu) ?? [])]
    .map((w) => w.toLowerCase())
    .filter((w) => privateWords.has(w) && !allowed.has(w));
  if (words.length) found.push(`words from the user's screen or tasks: ${[...new Set(words)].join(', ')}`);
  return found;
}

/** The words that name the app and the case, which an issue may always use. */
function allowedFor(facts: IssueFacts): Set<string> {
  return new Set(`${facts.app} ${facts.bundleId ?? ''} ${facts.profile ?? ''} ${TEMPLATE}`.toLowerCase().match(/[\p{L}\p{M}]+/gu) ?? []);
}

const KIND_TITLE: Record<IssueKind, string> = { 'missed-task': 'Missed task', 'app-support': 'App support' };
const FOOTER = "Drafted by the user's own Claude with Didja's `draft_issue`. Didja masked the screen text (every letter x, every digit 0, except words apps use in their labels).";
/** The template's own words, which the final check of a draft allows. */
const TEMPLATE = `${Object.values(KIND_TITLE).join(' ')} Fingerprint App and profile Versions What was missed What Didja misreads
What capture kept (masked by Didja) nothing Likely cause Suggested fix unknown macOS ${FOOTER}`;

/** The issue, or the reasons it cannot be drafted (nothing is drafted until the words are clean). */
export function draftIssue(kind: IssueKind, miss: string, diagnosis: Diagnosis, facts: IssueFacts): IssueDraft | { problems: string[] } {
  const problems: string[] = [];
  const fp = fingerprint(facts.bundleId, miss);
  if (!fp) problems.push('miss must be two to eight lowercase words joined by hyphens, naming the kind of miss (e.g. "place-missing-no-address"), never words from the screen');
  const allowed = allowedFor(facts);
  for (const [field, value] of Object.entries(diagnosis) as [keyof Diagnosis, string][]) {
    const v = String(value ?? '').trim();
    if (!v) problems.push(`${field} is empty`);
    if (v.length > MAX_PROSE) problems.push(`${field} is longer than ${MAX_PROSE} characters`);
    for (const l of leaks(v, facts.privateWords, allowed)) problems.push(`${field} has ${l}: describe it in general terms, or quote it masked (letters x, digits 0)`);
  }
  if (fp) for (const l of leaks(miss, facts.privateWords, allowed)) problems.push(`miss has ${l}`);
  if (problems.length) return { problems };

  // An address is masked whole first: `mask` keeps label words, which would leave "me" before the @ as it is.
  const kept = facts.kept
    .map((l) => mask(l.replace(EMAIL, (a) => a.replace(/\p{L}/gu, 'x').replace(/\p{N}/gu, '0'))))
    .map((l) => l.replace(/`/g, "'")).filter((l) => l.trim()).slice(-MAX_KEPT);
  const appLine = `${facts.app}${facts.bundleId ? ` (${facts.bundleId})` : ''}${facts.profile ? `, profile \`${facts.profile}\`` : ', no profile'}`;
  const versions = `Didja ${facts.didja ?? 'unknown'} · macOS ${facts.macos ?? 'unknown'}`;
  const title = `${KIND_TITLE[kind]}: ${facts.app}, ${miss.replace(/-/g, ' ')}`.slice(0, 120);
  const fields: [string, string, string][] = [
    ['fingerprint', 'Fingerprint', fp!],
    ['app', 'App and profile', appLine],
    ['versions', 'Versions', versions],
    ['what', kind === 'missed-task' ? 'What was missed' : 'What Didja misreads', diagnosis.what.trim()],
    ['kept', 'What capture kept (masked by Didja)', kept.length ? kept.join('\n') : '(nothing)'],
    ['cause', 'Likely cause', diagnosis.cause.trim()],
    ['fix', 'Suggested fix', diagnosis.fix.trim()],
  ];
  const body = [
    `<!-- didja-fingerprint: ${fp} -->`,
    ...fields.flatMap(([id, label, value]) => [`### ${label}`, '', id === 'kept' ? `\`\`\`\n${value}\n\`\`\`` : id === 'fingerprint' ? `\`${value}\`` : value, '']),
    '---',
    FOOTER,
  ].join('\n');
  const leftover = leaks(body, facts.privateWords, allowed);
  if (leftover.length) return { problems: leftover.map((l) => `the drafted issue still has ${l}`) };

  const form = new URLSearchParams({ template: `${kind}.yml`, title });
  const full = new URLSearchParams(form);
  for (const [id, , value] of fields) full.set(id, value);
  const long = `${ISSUES}/new?${full.toString()}`;
  const pasteBody = long.length > MAX_URL;
  const search = `${ISSUES}?${new URLSearchParams({ q: `is:issue "${fp}"` }).toString()}`;
  return { title, body, fingerprint: fp!, url: pasteBody ? `${ISSUES}/new?${form.toString()}` : long, pasteBody, search };
}
