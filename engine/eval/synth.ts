/**
 * A made-up corpus, generated: thousands of samples for the three model jobs (who a list is for,
 * whether a chat message asks something of the reader, whether a screen shows a task done) and
 * benchmark scenarios, in English and Hebrew, built from frames (one phrasing of one situation,
 * with its answer written in) filled with made-up people, things and times. Never from anything
 * captured on a Mac or scraped from anywhere: every word is in this file.
 *
 * Each sample carries its `frame` and `split`. Whole frames are held out (about one in five of each
 * job and answer, at least one, chosen by a stable hash of the frame id), so a model or an adapter
 * measured on the held-out samples meets phrasings it never saw, not new names in a familiar
 * sentence. The same seed always gives the same corpus.
 *
 *   bun eval/synth.ts [out-dir] [--seed N] [--lists N] [--chats N] [--looks N] [--scenarios N]
 *
 * writes lists-samples.json, chat-samples.json, looks-samples.json (the shapes of the hand-written
 * ones in this folder, so `SAMPLES=<file> bun eval/lists.ts` reads them) and scenarios/ (the
 * benchmark's shape; `bun bench/run.ts --synth N` generates them in memory instead).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Scenario } from '../bench/run.ts';
import { stableHash } from './adapter-data.ts';
import type { LookRequest } from './prompts.ts';

export type Split = 'train' | 'held-out';
export type SynthJob = 'list-owner' | 'chat-ask' | 'looks-done';

export interface SynthList { id: string; frame: string; split: Split; expect: 'user' | 'assistant'; leadIn: string; steps: string[]; before?: string[]; after?: string[]; asked?: string }
export interface SynthChat {
  id: string; frame: string; split: Split; expect: boolean; task?: string; group: boolean; addressed?: 'named' | 'everyone' | 'group';
  chat: string; from: string; message: string; before?: { from: string; text: string }[];
}
export interface SynthLook { id: string; frame: string; split: Split; expect: 'done' | 'notDone'; request: LookRequest }
export interface SynthScenario extends Scenario { frame: string; split: Split }

// MARK: Randomness, seeded

/** mulberry32: small, fast, and the same numbers for the same seed everywhere. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type R = () => number;
const pick = <T>(r: R, list: readonly T[]): T => list[Math.floor(r() * list.length)]!;
function pickOther<T>(r: R, list: readonly T[], not: T): T {
  const rest = list.filter((x) => x !== not);
  return pick(r, rest);
}
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

// MARK: Made-up people and things. Names from profiles/fixtures/names.txt, or already in the
// hand-written samples in this folder; never anyone real.

export const ME = ['Mike', 'מייק'];
interface Person { first: string; full: string }
export const PEOPLE: readonly Person[] = [
  { first: 'Sam', full: 'Sam Carter' }, { first: 'Dana', full: 'Dana Levi' }, { first: 'Ron', full: 'Ron Cohen' },
  { first: 'Noa', full: 'Noa Katz' }, { first: 'Tamar', full: 'Tamar Levi' }, { first: 'Lena', full: 'Lena Hale' },
  { first: 'Jordan', full: 'Jordan Lee' }, { first: 'Omar', full: 'Omar Haddad' },
];
export const PEOPLE_HE: readonly Person[] = [{ first: 'נועה', full: 'נועה כץ' }, { first: 'תמר', full: 'תמר כהן' }];
/** Group chats, from the roster. */
export const GROUPS = ['Family', 'Design', 'Design Review', 'Choir', 'Team', 'General', 'Acme'] as const;
export const GROUPS_HE = ['Family', 'Team', 'Choir'] as const;

/** Things to send: the words in the message, and a key word a task about it holds. */
const SENDS = [
  { o: 'the signed contract', k: 'contract' }, { o: 'the slides', k: 'slides' }, { o: 'the invoice for October', k: 'invoice' },
  { o: 'the photos from Saturday', k: 'photos' }, { o: 'the Q3 numbers', k: 'numbers' }, { o: 'the staging link', k: 'staging' },
  { o: 'the receipt for the hotel', k: 'receipt' }, { o: 'the draft proposal', k: 'proposal' }, { o: 'the address of the venue', k: 'address' },
  { o: 'the recording of the call', k: 'recording' },
] as const;
/** Other things someone asks you to do. */
const DOINGS = [
  { a: 'approve the Q3 budget', k: 'budget' }, { a: 'book the table for Friday at 8', k: 'table' }, { a: 'update the release notes', k: 'release notes' },
  { a: 'sign the NDA', k: 'nda' }, { a: 'call the plumber about the leak', k: 'plumber' }, { a: 'pick up the cake on your way', k: 'cake' },
  { a: 'print the boarding passes', k: 'boarding' }, { a: 'fill in the expense form', k: 'expense' }, { a: 'review the pull request for the login fix', k: 'pull request' },
  { a: 'renew the parking permit', k: 'parking' },
] as const;
const WHENS = ['', ' by Thursday', ' before 5', ' today', ' tomorrow morning', ' this week'] as const;
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday'] as const;
const TIMES = ['10', '11:30', '2', '4'] as const;
const MEETINGS = ['review', 'planning call', 'design sync', 'kickoff'] as const;
const CHOICES = [
  { thing: 'logo', a: 'blue', b: 'green' }, { thing: 'venue', a: 'park', b: 'hall' }, { thing: 'date', a: 'Friday', b: 'Sunday' },
  { thing: 'font', a: 'serif', b: 'sans' },
] as const;
const EVENTS = ['offsite', 'team dinner', 'end-of-year party', 'workshop'] as const;
const WHERE = ['the VPN config', 'the spare key', 'the Wi-Fi password for the office', 'the old logo files'] as const;
const OUTAGES = ['Water', 'The office Wi-Fi', 'Staging', 'The parking gate'] as const;

const SENDS_HE = [
  { o: 'החשבונית של מרץ', k: 'חשבונית' }, { o: 'המצגת', k: 'מצגת' }, { o: 'החוזה החתום', k: 'חוזה' },
  { o: 'התמונות משבת', k: 'תמונות' }, { o: 'הקבלה מהמלון', k: 'קבלה' }, { o: 'הדוח', k: 'דוח' },
] as const;
const DOCS_HE = ['המסמך', 'הטבלה', 'רשימת המשימות', 'המצגת'] as const;
const DAYS_HE = ['שלישי', 'רביעי', 'חמישי'] as const;
const TIMES_HE = ['עשר', 'אחת עשרה', 'ארבע'] as const;
const EVENTS_HE = [{ to: 'לאסיפה' }, { to: 'לישיבת הצוות' }, { to: 'למסיבה' }] as const;

// MARK: Holding out whole frames

/**
 * Which frames are held out: in each group (job and answer), the ones whose ids hash lowest, one in
 * `every` and at least one. A frame never appears in both splits.
 */
export function heldOutFrames(groups: Record<string, string[]>, every = 5): Set<string> {
  const held = new Set<string>();
  for (const frames of Object.values(groups)) {
    const ranked = [...frames].sort((a, b) => stableHash(a) - stableHash(b) || a.localeCompare(b));
    for (const f of ranked.slice(0, Math.max(1, Math.round(frames.length / every)))) held.add(f);
  }
  return held;
}

/** Makes `n` samples from frames in turn (so every frame is used), dropping exact repeats. */
function generate<F extends { id: string }, P, S>(frames: readonly F[], n: number, seed: number, held: Set<string>, make: (f: F, r: R) => P, key: (p: P) => string,
  tag: (p: P, f: F, split: Split, i: number) => S): S[] {
  const r = rng(seed);
  const out: S[] = [];
  const seen = new Set<string>();
  let tries = 0;
  for (let i = 0; out.length < n && tries < n * 20; i++, tries++) {
    const f = frames[i % frames.length]!;
    const s = make(f, r);
    const k = key(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(tag(s, f, held.has(f.id) ? 'held-out' : 'train', out.length));
  }
  return out;
}

const grouped = <F extends { id: string }>(frames: readonly F[], label: (f: F) => string) => {
  const g: Record<string, string[]> = {};
  for (const f of frames) (g[label(f)] ??= []).push(f.id);
  return g;
};

// MARK: Who is a list for?

const USER_DOMAINS = [
  { goal: 'send emails from the app', steps: ['Set RESEND_API_KEY in the Vercel dashboard for Production', 'Redeploy from the Deployments tab'] },
  { goal: 'get Google sign-in working', steps: ['Add https://app.example.com/auth/callback as a redirect URL in Supabase Auth settings', 'Try signing in with Google on the preview URL'] },
  { goal: 'make the repository public', steps: ['Open the repository settings on GitHub', 'Change the visibility to Public', 'Turn on Discussions'] },
  { goal: 'fix the webhook signature error', steps: ['Copy the signing secret from the Stripe webhook page', 'Paste it into .env.local as STRIPE_WEBHOOK_SECRET', 'Restart the dev server'] },
  { goal: 'point the domain at the site', steps: ['Log in to your domain registrar', 'Add an A record for acme.example.com pointing to 76.76.21.21', 'Wait for the certificate in Vercel'] },
  { goal: 'let the app read the screen', steps: ['Open System Settings › Privacy & Security › Accessibility', 'Turn on the switch next to Acme Notes', 'Quit and reopen the app'] },
  { goal: 'ship the iOS build', steps: ['Upload the build with Transporter', 'Submit it for review in App Store Connect'] },
  { goal: 'deal with the leaked key', steps: ['Revoke the leaked key in the OpenAI dashboard', 'Create a new key and put it in your password manager'] },
  { goal: 'check the login on mobile', steps: ['Open the preview link on your phone', 'Sign in with your test account', 'Send me a screenshot of the error'] },
  { goal: 'unblock the deploy', steps: ['Add a payment method in the Netlify billing page', 'Retry the failed deploy'] },
  { goal: 'install the tools', steps: ['Run `brew install jq` in your terminal', 'Run `bun install` in the project folder'] },
  { goal: 'run the migration', steps: ['Run `bun run migrate` in the project folder', 'Check the orders table in the Supabase dashboard'] },
  { goal: 'finish the Slack app', steps: ['Install the app to your workspace from the OAuth page', 'Invite the bot to the #team channel'] },
  { goal: 'get the release out', steps: ['Review the pull request on GitHub', 'Merge it once the checks are green'] },
] as const;
const CODE_DOMAINS = [
  { want: 'retries on the sync job', steps: ['Add a `retry` option to the fetch helper', 'Use it in the sync job', 'Add a test for the timeout case'] },
  { want: 'the failing webhook test fixed', steps: ['Read the webhook handler', 'Update the tests', 'Open a pull request'] },
  { want: 'invoices in the API', steps: ['Add a migration for the invoices table', 'Write the Invoice model', 'Expose it in the API'] },
  { want: 'the settings view cleaned up', steps: ['Split the settings view into two files', 'Move the shared state into a store'] },
  { want: 'the double session check gone', steps: ['Refactor src/auth.ts so the session check runs once', 'Remove the duplicate check in middleware.ts'] },
  { want: 'forwarded emails handled', steps: ['Handle forwarded emails in parseEmails()', 'Add fixtures for both cases'] },
  { want: 'a CSV export', steps: ['Add an Export menu item', 'Write the CSV encoder', 'Wire it to the menu'] },
  { want: 'the matcher moved', steps: ['Port the matcher to the new terminal module', 'Delete the old one'] },
  { want: 'shorter landing page copy', steps: ['Rewrite the hero copy in content.ts', 'Shorten the FAQ answers'] },
] as const;
const PAST = [
  'Fixed the redirect loop on sign-out', 'Added a test for the empty state', 'Moved the date helpers to utils/date.ts', 'Renamed `fetchUser` to `loadUser`',
  'Removed the unused icons', 'Updated the README with the new flags', 'Bumped the timeout to 30 seconds', 'Made the popover close on Esc',
] as const;
const HOW = [
  'The webhook fires when a payment succeeds', 'The handler checks the signature first', 'Orders are written to a queue', 'A worker picks them up every minute',
  'Failed jobs are retried three times', 'The cache is cleared on deploy', 'Sessions expire after a week',
] as const;
const USER_HE = [
  ['היכנס להגדרות הדומיין אצל הרשם', 'הוסף רשומת A שמצביעה ל-76.76.21.21', 'חכה שהתעודה תופיע ב-Vercel'],
  ['פתח את לוח הבקרה של Vercel', 'הגדר את RESEND_API_KEY בסביבת Production', 'פרוס מחדש מלשונית Deployments'],
  ['הרץ `bun install` בתיקיית הפרויקט', 'הרץ `bun run migrate`', 'בדוק את הטבלה ב-Supabase'],
  ['פתח את הקישור לתצוגה המקדימה בטלפון', 'התחבר עם חשבון הבדיקה', 'שלח לי צילום מסך של השגיאה'],
] as const;
const PLAN_HE = [
  ['אוסיף אפשרות retry לפונקציית ה-fetch', 'אשתמש בה במשימת הסנכרון', 'אוסיף בדיקה למקרה של timeout'],
  ['אקרא את ה-handler של ה-webhook', 'אעדכן את הבדיקות', 'אפתח pull request'],
  ['אפצל את מסך ההגדרות לשני קבצים', 'אעביר את המצב המשותף ל-store'],
] as const;
const PAST_HE = ['תיקנתי את הלולאה בהתנתקות', 'הוספתי בדיקה למצב הריק', 'העברתי את פונקציות התאריך ל-utils/date.ts', 'עדכנתי את ה-README', 'הסרתי את האייקונים שלא בשימוש'] as const;

interface ListFrame { id: string; expect: 'user' | 'assistant'; make: (r: R) => Omit<SynthList, 'id' | 'frame' | 'split' | 'expect'> }
const userSteps = (r: R) => [...pick(r, USER_DOMAINS).steps];
const codeSteps = (r: R) => [...pick(r, CODE_DOMAINS).steps];
const some = <T>(r: R, list: readonly T[], n: number) => {
  const pool = [...list];
  const out: T[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]!);
  return out;
};

export const LIST_FRAMES: readonly ListFrame[] = [
  // Yours: something only a person at the keyboard, in an account or on a phone can do.
  { id: 'list:user:next-steps', expect: 'user', make: (r) => ({ leadIn: pick(r, ['Next steps:', 'Next steps for you:']), steps: userSteps(r) }) },
  { id: 'list:user:to-finish-tell-me', expect: 'user', make: (r) => ({ leadIn: pick(r, ['To finish:', 'To fix this:']), steps: userSteps(r), after: [pick(r, ["Tell me once it's live and I'll check the logs.", 'Let me know what you see.', 'Ping me when that is done.'])] }) },
  { id: 'list:user:your-side', expect: 'user', make: (r) => ({ leadIn: pick(r, ['On your side:', 'What you need to do:', "You'll need to:"]), steps: userSteps(r) }) },
  { id: 'list:user:before-i-can', expect: 'user', make: (r) => {
    const p = pick(r, PEOPLE);
    return { leadIn: 'Before I can go on:', steps: [`Ask ${p.first} for the staging database password`, 'Paste it into .env.local'], after: ["Then I'll wire up the connection."] };
  } },
  { id: 'list:user:asked-how', expect: 'user', make: (r) => {
    const d = pick(r, USER_DOMAINS);
    return { asked: `How do I ${d.goal}?`, leadIn: pick(r, ['Steps:', 'Do this:', "Here's how:"]), steps: [...d.steps] };
  } },
  { id: 'list:user:code-words-your-side', expect: 'user', make: (r) => ({ leadIn: 'To fix this on your side:', steps: [pick(r, ['Update Xcode to 26.1 from the App Store', 'Upgrade Node to 22 with `nvm install 22`', 'Clear the derived data folder in Xcode']), 'Build again'] }) },
  { id: 'list:user:send-person', expect: 'user', make: (r) => {
    const p = pick(r, PEOPLE);
    return { before: ['The preview is up.'], leadIn: 'Next steps:', steps: [`Send ${p.first} the staging link`, `Ask ${p.first} to try the checkout`] };
  } },
  { id: 'list:user:he-next', expect: 'user', make: (r) => ({ leadIn: pick(r, ['הצעדים הבאים:', 'מה שנשאר לך לעשות:', 'כדי לסיים:']), steps: [...pick(r, USER_HE)] }) },
  { id: 'list:user:he-asked', expect: 'user', make: (r) => ({ asked: 'איך אני מחבר את הדומיין?', leadIn: 'תעשה כך:', steps: [...USER_HE[0]] , after: [pick(r, ['תגיד לי כשזה עובד.', 'תעדכן אותי אם יש שגיאה.'])] }) },
  // The assistant's own: its plan, a report of what it did, or how something works.
  { id: 'list:asst:ill', expect: 'assistant', make: (r) => ({ leadIn: pick(r, ["I'll take care of it:", "Here's my plan:", "I'll do the following:"]), steps: codeSteps(r) }) },
  { id: 'list:asst:next-offer', expect: 'assistant', make: (r) => ({ leadIn: 'Next steps:', steps: codeSteps(r), after: [pick(r, ['Want me to go ahead?', 'Shall I?', "Say go and I'll start."])] }) },
  { id: 'list:asst:report', expect: 'assistant', make: (r) => ({ leadIn: pick(r, ['Summary:', 'What changed:', "Here's what I did:"]), steps: some(r, PAST, 3) }) },
  { id: 'list:asst:how', expect: 'assistant', make: (r) => ({ leadIn: pick(r, ['How it works:', 'Here is how the webhook flow goes:']), steps: some(r, HOW, 3) }) },
  { id: 'list:asst:asked-build', expect: 'assistant', make: (r) => {
    const d = pick(r, CODE_DOMAINS);
    return { asked: `Can you get ${d.want}?`, leadIn: pick(r, ["Here's the order:", 'Plan:']), steps: [...d.steps] };
  } },
  { id: 'list:asst:first-person', expect: 'assistant', make: (r) => ({ leadIn: 'Next steps:', steps: codeSteps(r).map((s) => `I'll ${s.charAt(0).toLowerCase()}${s.slice(1)}`) }) },
  { id: 'list:asst:after-ill', expect: 'assistant', make: (r) => ({ leadIn: 'Next steps:', steps: codeSteps(r), after: [pick(r, ["I'll start with the first one since the rest depends on it.", "I'll report back with what I find."])] }) },
  { id: 'list:asst:he-plan', expect: 'assistant', make: (r) => ({ leadIn: pick(r, ['התוכנית שלי:', 'אני אעשה את זה כך:']), steps: [...pick(r, PLAN_HE)] }) },
  { id: 'list:asst:he-report', expect: 'assistant', make: (r) => ({ leadIn: pick(r, ['מה ששיניתי:', 'סיכום:']), steps: some(r, PAST_HE, 3) }) },
];

// MARK: Does a chat message ask the reader to do something?

interface ChatFrame { id: string; expect: boolean; make: (r: R) => Omit<SynthChat, 'id' | 'frame' | 'split' | 'expect'> }
const dm = (p: Person) => ({ group: false as const, chat: p.first, from: p.first });
const grp = (r: R, p: Person, addressed: 'named' | 'everyone' | 'group') => ({ group: true as const, addressed, chat: pick(r, GROUPS), from: p.first });
const sendTask = (p: Person, s: { o: string }, w: string) => `Send ${p.first} ${s.o}${w}`;
const doTask = (p: Person, d: { a: string }, w: string) => `${cap(d.a)} for ${p.first}${w}`;

export const CHAT_FRAMES: readonly ChatFrame[] = [
  // Asks of the reader.
  { id: 'chat:ask:dm-can-you-send', expect: true, make: (r) => { const p = pick(r, PEOPLE), s = pick(r, SENDS), w = pick(r, WHENS); return { ...dm(p), message: `Can you send me ${s.o}${w}?`, task: sendTask(p, s, w) }; } },
  { id: 'chat:ask:dm-send-over', expect: true, make: (r) => { const p = pick(r, PEOPLE), s = pick(r, SENDS), w = pick(r, WHENS); return { ...dm(p), message: `could you send over ${s.o}${w}? thanks`, task: sendTask(p, s, w) }; } },
  { id: 'chat:ask:dm-can-you-do', expect: true, make: (r) => { const p = pick(r, PEOPLE), d = pick(r, DOINGS), w = pick(r, WHENS); return { ...dm(p), message: `Hey, can you ${d.a}${w}?`, task: doTask(p, d, w) }; } },
  { id: 'chat:ask:dm-please', expect: true, make: (r) => { const p = pick(r, PEOPLE), d = pick(r, DOINGS), w = pick(r, WHENS); return { ...dm(p), message: `Please ${d.a}${w}`, task: doTask(p, d, w) }; } },
  { id: 'chat:ask:dm-when-you-get-a-sec', expect: true, make: (r) => { const p = pick(r, PEOPLE), d = pick(r, DOINGS); return { ...dm(p), message: `When you get a sec, can you ${d.a}?`, task: doTask(p, d, '') }; } },
  { id: 'chat:ask:dm-no-rush', expect: true, make: (r) => { const p = pick(r, PEOPLE), s = pick(r, SENDS); return { ...dm(p), message: `No rush at all, but could you send me ${s.o} after the weekend?`, task: sendTask(p, s, ' after the weekend') }; } },
  { id: 'chat:ask:dm-does-time-work', expect: true, make: (r) => { const p = pick(r, PEOPLE), d = pick(r, DAYS), t = pick(r, TIMES); return { ...dm(p), message: `Does ${d} at ${t} work for you for the ${pick(r, MEETINGS)}?`, task: `Answer ${p.first}: does ${d} at ${t} work` }; } },
  { id: 'chat:ask:dm-which', expect: true, make: (r) => { const p = pick(r, PEOPLE), c = pick(r, CHOICES); return { ...dm(p), message: `Which ${c.thing} do you prefer, the ${c.a} one or the ${c.b} one?`, task: `Answer ${p.first}: ${c.a} or ${c.b} ${c.thing}` }; } },
  { id: 'chat:ask:grp-at-named', expect: true, make: (r) => { const p = pick(r, PEOPLE), d = pick(r, DOINGS), w = pick(r, WHENS); return { ...grp(r, p, 'named'), message: `@Mike can you ${d.a}${w}?`, task: doTask(p, d, w) }; } },
  { id: 'chat:ask:grp-comma-named', expect: true, make: (r) => { const p = pick(r, PEOPLE), s = pick(r, SENDS), w = pick(r, WHENS); return { ...grp(r, p, 'named'), message: `Mike, could you send ${s.o}${w}?`, task: sendTask(p, s, w) }; } },
  { id: 'chat:ask:grp-everyone-confirm', expect: true, make: (r) => { const p = pick(r, PEOPLE), e = pick(r, EVENTS); return { ...grp(r, p, 'everyone'), message: `Everyone please confirm by ${pick(r, DAYS)} if you're coming to the ${e}`, task: `Confirm to ${p.first} if you're coming to the ${e}` }; } },
  { id: 'chat:ask:grp-named-question', expect: true, make: (r) => { const p = pick(r, PEOPLE), v = pick(r, [['2.1', '2.2'], ['Tuesday', 'Wednesday'], ['the short', 'the long']] as const); return { ...grp(r, p, 'named'), message: `Mike, which should we go with, ${v[0]} or ${v[1]}?`, task: `Answer ${p.first}: ${v[0]} or ${v[1]}` }; } },
  { id: 'chat:ask:he-dm-send', expect: true, make: (r) => { const p = pick(r, PEOPLE_HE), s = pick(r, SENDS_HE); return { ...dm(p), message: `תוכל לשלוח לי את ${s.o}?`, task: `שלח ל${p.first} את ${s.o}` }; } },
  { id: 'chat:ask:he-dm-time', expect: true, make: (r) => { const p = pick(r, PEOPLE_HE), d = pick(r, DAYS_HE), t = pick(r, TIMES_HE); return { ...dm(p), message: `יום ${d} ב${t} מתאים לך?`, task: `ענה ל${p.first}: האם יום ${d} ב${t} מתאים` }; } },
  { id: 'chat:ask:he-dm-no-rush', expect: true, make: (r) => { const p = pick(r, PEOPLE_HE), s = pick(r, SENDS_HE); return { ...dm(p), message: `אין לחץ, אבל תשלח לי את ${s.o} אחרי החג?`, task: `שלח ל${p.first} את ${s.o} אחרי החג` }; } },
  { id: 'chat:ask:he-grp-named', expect: true, make: (r) => { const p = pick(r, PEOPLE_HE), d = pick(r, DOCS_HE); return { group: true, addressed: 'named', chat: pick(r, GROUPS_HE), from: p.first, message: `@מייק תעדכן בבקשה את ${d} עד מחר`, task: `עדכן את ${d} ל${p.first} עד מחר` }; } },
  { id: 'chat:ask:he-grp-everyone', expect: true, make: (r) => { const p = pick(r, PEOPLE_HE), e = pick(r, EVENTS_HE), d = pick(r, DAYS_HE); return { group: true, addressed: 'everyone', chat: pick(r, GROUPS_HE), from: p.first, message: `כולם תאשרו הגעה ${e.to} ביום ${d}`, task: `אשר ל${p.first} הגעה ${e.to} ביום ${d}` }; } },
  // Not asks of the reader.
  { id: 'chat:no:dm-thanks', expect: false, make: (r) => { const p = pick(r, PEOPLE); return { ...dm(p), message: pick(r, ['Thanks so much, got it!', "Thank you!! that's perfect", `Got ${pick(r, SENDS).o}, thanks!`, 'Received, thank you 🙏']) }; } },
  { id: 'chat:no:dm-ack', expect: false, make: (r) => { const p = pick(r, PEOPLE); return { ...dm(p), message: pick(r, ['ok 👍', 'sounds good', 'perfect', 'great, thanks', 'noted']) }; } },
  { id: 'chat:no:dm-sender-will', expect: false, make: (r) => { const p = pick(r, PEOPLE), s = pick(r, SENDS); return { ...dm(p), message: pick(r, [`I'll send you ${s.o} tomorrow morning`, `I'll ${pick(r, DOINGS).a} myself, don't worry about it`]) }; } },
  { id: 'chat:no:dm-sender-defers', expect: false, make: (r) => { const p = pick(r, PEOPLE); return { ...dm(p), message: pick(r, ['Let me check with the team and get back to you next week', "I'll look into it and let you know tomorrow"]) }; } },
  { id: 'chat:no:dm-news', expect: false, make: (r) => { const p = pick(r, PEOPLE); return { ...dm(p), message: pick(r, ['The deploy went out, everything looks green', 'Landed safely ✈️', `The ${pick(r, MEETINGS)} moved to ${pick(r, DAYS)} at ${pick(r, TIMES)}`]) }; } },
  { id: 'chat:no:dm-small-talk', expect: false, make: (r) => { const p = pick(r, PEOPLE); return { ...dm(p), message: pick(r, ['How was the weekend? 😄', "Hope you're feeling better!", 'That was a fun evening']) }; } },
  { id: 'chat:no:dm-answers-reader', expect: false, make: (r) => {
    const p = pick(r, PEOPLE), d = pick(r, DAYS);
    return { ...dm(p), before: [{ from: 'me', text: `Does ${d} work for you?` }], message: `Yes, ${d} works for me` };
  } },
  { id: 'chat:no:dm-sender-sending', expect: false, make: (r) => {
    const p = pick(r, PEOPLE), s = pick(r, SENDS);
    return { ...dm(p), before: [{ from: 'me', text: `Can you send me ${s.o}?` }], message: 'Sure, sending it now' };
  } },
  { id: 'chat:no:grp-can-someone', expect: false, make: (r) => { const p = pick(r, PEOPLE), d = pick(r, DOINGS); return { ...grp(r, p, 'group'), message: pick(r, [`can someone ${d.a}?`, `Could anyone ${d.a} today?`]) }; } },
  { id: 'chat:no:grp-anyone-know', expect: false, make: (r) => { const p = pick(r, PEOPLE); return { ...grp(r, p, 'group'), message: `Does anyone know where ${pick(r, WHERE)} lives?` }; } },
  { id: 'chat:no:grp-for-other', expect: false, make: (r) => {
    const p = pick(r, PEOPLE), o = pickOther(r, PEOPLE, p), s = pick(r, SENDS);
    return { ...grp(r, p, 'named'), message: pick(r, [`@Mike thanks! @${o.first} can you send ${s.o}?`, `Thanks Mike! ${o.first}, could you send ${s.o}?`]) };
  } },
  { id: 'chat:no:grp-thanks-reader', expect: false, make: (r) => { const p = pick(r, PEOPLE); return { ...grp(r, p, 'named'), message: pick(r, ['Thanks Mike, that was super helpful', 'Mike you legend, thank you!']) }; } },
  { id: 'chat:no:grp-announcement', expect: false, make: (r) => { const p = pick(r, PEOPLE); return { ...grp(r, p, 'everyone'), message: pick(r, [`${pick(r, OUTAGES)} will be off tomorrow between 9 and 12`, `Reminder: the ${pick(r, EVENTS)} is on ${pick(r, DAYS)}`]) }; } },
  { id: 'chat:no:he-dm-thanks', expect: false, make: (r) => { const p = pick(r, PEOPLE_HE); return { ...dm(p), message: pick(r, ['תודה רבה! קיבלתי', 'תודה, מעולה', 'סבבה 👍', 'אחלה']) }; } },
  { id: 'chat:no:he-dm-sender-will', expect: false, make: (r) => { const p = pick(r, PEOPLE_HE); return { ...dm(p), message: pick(r, [`אני אשלח לך את ${pick(r, SENDS_HE).o} מחר בבוקר`, 'אבדוק ואחזור אליך בשבוע הבא']) }; } },
  { id: 'chat:no:he-grp-someone', expect: false, make: (r) => { const p = pick(r, PEOPLE_HE); return { group: true, addressed: 'group', chat: pick(r, GROUPS_HE), from: p.first, message: pick(r, ['מישהו יכול לבדוק למה השרת נפל?', 'מישהו יודע איפה המפתח הרזרבי?']) }; } },
  { id: 'chat:no:he-grp-other', expect: false, make: (r) => {
    const p = pick(r, PEOPLE_HE), o = pickOther(r, PEOPLE_HE, p);
    return { group: true, addressed: 'named', chat: pick(r, GROUPS_HE), from: p.first, message: `תודה מייק! ${o.first}, תוכלי לשלוח את ${pick(r, SENDS_HE).o}?` };
  } },
];

// MARK: Does a screen show a task done?

interface LookFrame { id: string; expect: 'done' | 'notDone'; make: (r: R) => LookRequest }
const inv = (r: R) => `INV-${2000 + Math.floor(r() * 900)}`;
const amount = (r: R) => `$${(40 + Math.floor(r() * 900))}.00`;
const ENVS = ['STRIPE_KEY', 'RESEND_API_KEY', 'DATABASE_URL', 'SENTRY_DSN'] as const;
const FEATURES = ['the login redirect', 'the CSV export', 'the dark mode toggle', 'the search filters'] as const;
const FORMS = [{ name: 'school trip', title: 'School Trip Consent' }, { name: 'expense', title: 'Expense Claim' }, { name: 'offsite RSVP', title: 'Offsite RSVP' }] as const;
const BOOKINGS = ['venue for the offsite', 'table at the restaurant', 'meeting room'] as const;
const mailTask = (p: Person, s: { o: string }) => `Send ${p.first} ${s.o}`;
const subject = (s: { k: string }) => cap(s.k);

export const LOOK_FRAMES: readonly LookFrame[] = [
  { id: 'look:done:mail-sent', expect: 'done', make: (r) => { const p = pick(r, PEOPLE), s = pick(r, SENDS); return { task: mailTask(p, s), app: 'Outlook', page: 'Outlook — Sent Items', text: `Sent Items\nTo: ${p.full}\nSubject: ${subject(s)}\nAttached is ${s.o}.\nSent ${pick(r, ['9:12', '10:42', '14:05'])}` }; } },
  { id: 'look:not:mail-draft', expect: 'notDone', make: (r) => { const p = pick(r, PEOPLE), s = pick(r, SENDS); return { task: mailTask(p, s), app: 'Outlook', page: 'Outlook — Drafts', text: `Drafts\nTo: ${p.full}\nSubject: ${subject(s)}\n[Draft] Attached is ${s.o}.\nSend` }; } },
  { id: 'look:not:mail-inbox-ask', expect: 'notDone', make: (r) => { const p = pick(r, PEOPLE), s = pick(r, SENDS); return { task: mailTask(p, s), app: 'Outlook', page: 'Outlook — Inbox', text: `Inbox\nFrom: ${p.full}\nSubject: ${subject(s)}\nHi Mike, can you send me ${s.o}?\nReply  Forward` }; } },
  { id: 'look:done:gmail-sent', expect: 'done', make: (r) => { const p = pick(r, PEOPLE), s = pick(r, SENDS); return { task: mailTask(p, s), app: 'Google Chrome', page: 'mail.google.com — Sent', text: `Message sent.  Undo  View message\nSent\nTo: ${p.first.toLowerCase()}@example.com\n${subject(s)} — here you go, ${s.o} attached` }; } },
  { id: 'look:not:gmail-compose', expect: 'notDone', make: (r) => { const p = pick(r, PEOPLE), s = pick(r, SENDS); return { task: mailTask(p, s), app: 'Google Chrome', page: 'mail.google.com — Compose', text: `New Message\nTo: ${p.first.toLowerCase()}@example.com\nSubject: ${subject(s)}\nHere you go\nSend  Saving…` }; } },
  { id: 'look:done:pay-paid', expect: 'done', make: (r) => ({ task: 'Pay the Acme invoice', app: 'Safari', page: 'pay.example.com/invoices', text: `Invoice ${inv(r)}\nPayment received. Thank you!\nAmount paid: ${amount(r)}\nStatus: Paid` }) },
  { id: 'look:not:pay-form', expect: 'notDone', make: (r) => ({ task: 'Pay the Acme invoice', app: 'Safari', page: 'pay.example.com/invoices', text: `Invoice ${inv(r)}\nAmount due: ${amount(r)}\nCard number\nExpiry\nPay now` }) },
  { id: 'look:not:pay-list-due', expect: 'notDone', make: (r) => ({ task: 'Pay the Acme invoice', app: 'Safari', page: 'pay.example.com/invoices', text: `Invoices — Acme\n${inv(r)} — ${amount(r)} — Due in 5 days — Pay\n${inv(r)} — ${amount(r)} — Paid last month` }) },
  { id: 'look:done:env-prod', expect: 'done', make: (r) => { const e = pick(r, ENVS); return { task: `Add ${e} to the production environment`, app: 'Google Chrome', page: 'vercel.com/acme/settings/environment-variables', text: `Environment Variables\n${e}\nProduction\nAdded just now\nSaved` }; } },
  { id: 'look:not:env-empty', expect: 'notDone', make: (r) => { const e = pick(r, ENVS); return { task: `Add ${e} to the production environment`, app: 'Google Chrome', page: 'vercel.com/acme/settings/environment-variables', text: 'Environment Variables\nNo environment variables yet\nKey\nValue\nAdd New' }; } },
  { id: 'look:not:env-preview-only', expect: 'notDone', make: (r) => { const e = pick(r, ENVS); return { task: `Add ${e} to the production environment`, app: 'Google Chrome', page: 'vercel.com/acme/settings/environment-variables', text: `Environment Variables\n${e}\nPreview, Development\nAdded just now` }; } },
  { id: 'look:done:pr-merged', expect: 'done', make: (r) => { const f = pick(r, FEATURES), n = 100 + Math.floor(r() * 300); return { task: `Merge the pull request for ${f}`, app: 'Google Chrome', page: `github.com/acme/web/pull/${n}`, text: `Fix ${f} #${n}\nMerged\n${pick(r, PEOPLE).first.toLowerCase()} merged 1 commit into main` }; } },
  { id: 'look:not:pr-open', expect: 'notDone', make: (r) => { const f = pick(r, FEATURES), n = 100 + Math.floor(r() * 300); return { task: `Merge the pull request for ${f}`, app: 'Google Chrome', page: `github.com/acme/web/pull/${n}`, text: `Fix ${f} #${n}\nOpen\nReview required\nMerge pull request` }; } },
  { id: 'look:not:pr-other-merged', expect: 'notDone', make: (r) => { const f = pick(r, FEATURES), o = pickOther(r, FEATURES, f), n = 100 + Math.floor(r() * 300); return { task: `Merge the pull request for ${f}`, app: 'Google Chrome', page: `github.com/acme/web/pull/${n}`, text: `Fix ${o} #${n}\nMerged\nmerged 2 commits into main` }; } },
  { id: 'look:done:form-sent', expect: 'done', make: (r) => { const f = pick(r, FORMS); return { task: `Fill in the ${f.name} form`, app: 'Safari', page: 'forms.example.com/f/9', text: `${f.title}\nYour response has been recorded.\nSubmit another response` }; } },
  { id: 'look:not:form-blank', expect: 'notDone', make: (r) => { const f = pick(r, FORMS); return { task: `Fill in the ${f.name} form`, app: 'Safari', page: 'forms.example.com/f/9', text: `${f.title}\nName *\nEmail *\nSubmit` }; } },
  { id: 'look:done:booking-confirmed', expect: 'done', make: (r) => { const b = pick(r, BOOKINGS), d = pick(r, DAYS); return { task: `Book the ${b} for ${d}`, app: 'Safari', page: 'book.example.com/confirm', text: `Booking confirmed\nReference AC-${1000 + Math.floor(r() * 8999)}\n${d}, 19:30\nA confirmation email is on its way` }; } },
  { id: 'look:not:booking-picker', expect: 'notDone', make: (r) => { const b = pick(r, BOOKINGS), d = pick(r, DAYS); return { task: `Book the ${b} for ${d}`, app: 'Safari', page: 'book.example.com/times', text: `Choose a time\n${d}\nAvailable: 18:00, 19:30, 21:00\nContinue` }; } },
  { id: 'look:not:booking-notes', expect: 'notDone', make: (r) => { const b = pick(r, BOOKINGS), d = pick(r, DAYS); return { task: `Book the ${b} for ${d}`, app: 'Notes', page: 'Notes', text: `To do\n- Book the ${b} for ${d}\n- Buy a gift for ${pick(r, PEOPLE).first}` }; } },
  { id: 'look:done:he-chat-sent', expect: 'done', make: (r) => { const p = pick(r, PEOPLE_HE), s = pick(r, SENDS_HE); return { task: `שלח ל${p.first} את ${s.o}`, app: 'WhatsApp', page: p.full, text: `תוכל לשלוח לי את ${s.o}?\nהנה, שלחתי עכשיו\n📎 ${s.k}.pdf` }; } },
  { id: 'look:not:he-chat-promise', expect: 'notDone', make: (r) => { const p = pick(r, PEOPLE_HE), s = pick(r, SENDS_HE); return { task: `שלח ל${p.first} את ${s.o}`, app: 'WhatsApp', page: p.full, text: `תוכל לשלוח לי את ${s.o}?\nבטח, אשלח בערב` }; } },
];

// MARK: The corpus

export const listHeld = () => heldOutFrames(grouped(LIST_FRAMES, (f) => f.expect));
export const chatHeld = () => heldOutFrames(grouped(CHAT_FRAMES, (f) => String(f.expect)));
export const lookHeld = () => heldOutFrames(grouped(LOOK_FRAMES, (f) => f.expect));

export function synthLists(n: number, seed = 1): SynthList[] {
  return generate(LIST_FRAMES, n, seed, listHeld(), (f, r): Omit<SynthList, 'id' | 'frame' | 'split'> => ({ ...f.make(r), expect: f.expect }),
    (s) => JSON.stringify([s.leadIn, s.steps, s.before, s.after, s.asked]),
    (s, f, split, i) => ({ id: `synth-list-${i}`, frame: f.id, split, ...s }));
}

export function synthChats(n: number, seed = 1): SynthChat[] {
  return generate(CHAT_FRAMES, n, seed, chatHeld(), (f, r): Omit<SynthChat, 'id' | 'frame' | 'split'> => ({ ...f.make(r), expect: f.expect }),
    (s) => JSON.stringify([s.chat, s.from, s.message, s.before, s.group, s.addressed]),
    (s, f, split, i) => ({ id: `synth-chat-${i}`, frame: f.id, split, ...s }));
}

export function synthLooks(n: number, seed = 1): SynthLook[] {
  return generate(LOOK_FRAMES, n, seed, lookHeld(), (f, r): Omit<SynthLook, 'id' | 'frame' | 'split'> => ({ expect: f.expect, request: f.make(r) }),
    (s) => JSON.stringify(s.request),
    (s, f, split, i) => ({ id: `synth-look-${i}`, frame: f.id, split, ...s }));
}

// MARK: Benchmark scenarios

const START = '2026-11-11T09:00';
const WA = { app: 'WhatsApp', bundle: 'net.whatsapp.WhatsApp' } as const;
const CLAUDE = { app: 'Claude', bundle: 'com.anthropic.claudefordesktop' } as const;
const clock = (at: number) => { const m = 9 * 60 + at; return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
const header = (chat: string, kind: 'direct' | 'group', from: string, at: number, mentions = false) =>
  `⟦Chat message: ${chat} (${kind}) — from ${from}${mentions ? ', mentions me' : ''} — Today at ${clock(at)}⟧`;
const waStep = (at: number, title: string, text: string[]) => ({ at, ...WA, title, text });
/** A key word per user step, for the words rule: the step's most telling word. */
const STEP_KEYS: Record<string, string> = {
  'Set RESEND_API_KEY in the Vercel dashboard for Production': 'resend_api_key', 'Redeploy from the Deployments tab': 'redeploy',
  'Open the repository settings on GitHub': 'repository settings', 'Change the visibility to Public': 'visibility', 'Turn on Discussions': 'discussions',
  'Log in to your domain registrar': 'registrar', 'Add an A record for acme.example.com pointing to 76.76.21.21': 'a record', 'Wait for the certificate in Vercel': 'certificate',
  'Upload the build with Transporter': 'transporter', 'Submit it for review in App Store Connect': 'app store connect',
  'Add a payment method in the Netlify billing page': 'payment method', 'Retry the failed deploy': 'failed deploy',
};
const KEYED = USER_DOMAINS.filter((d) => d.steps.every((s) => STEP_KEYS[s]));

interface ScenarioFrame { id: string; family: Scenario['family']; make: (r: R) => Omit<Scenario, 'id' | 'family' | 'start'> }
const replyAt = (r: R) => 15 + Math.floor(r() * 46);
const DONE_REPLIES = ['Done', 'Done ✅', 'All done', 'Done!'] as const;

/** One chat ask of the reader, as a direct message or tagging them in a group, and its key word. */
function askOf(r: R): { message: string; k: string } {
  if (r() < 0.5) { const s = pick(r, SENDS); return { message: `Can you send me ${s.o}?`, k: s.k }; }
  const d = pick(r, DOINGS);
  return { message: `Can you ${d.a}?`, k: d.k };
}

export const SCENARIO_FRAMES: readonly ScenarioFrame[] = [
  { id: 'scenario:dm-ask-done', family: 'messaging', make: (r) => {
    const p = pick(r, PEOPLE), a = askOf(r), at = replyAt(r);
    return { about: `${p.first} asks you something in a direct chat; you answer "Done" ${at} minutes later.`,
      steps: [waStep(0, p.full, [header(p.full, 'direct', p.full, 0), a.message]), waStep(at, p.full, [header(p.full, 'direct', 'me', at), pick(r, DONE_REPLIES)])],
      expect: { tasks: [{ words: [a.k], done: { at, where: 'WhatsApp reply' } }], none: [] } };
  } },
  { id: 'scenario:dm-ask-promise', family: 'messaging', make: (r) => {
    const p = pick(r, PEOPLE), a = askOf(r), at = replyAt(r);
    return { about: `${p.first} asks you something; you only promise to do it later, so it is not done.`,
      steps: [waStep(0, p.full, [header(p.full, 'direct', p.full, 0), a.message]), waStep(at, p.full, [header(p.full, 'direct', 'me', at), pick(r, ["Sure, I'll do it tonight", 'Will do later', 'On it after lunch'])])],
      expect: { tasks: [{ words: [a.k], done: null }], none: [] } };
  } },
  { id: 'scenario:dm-ask-open', family: 'messaging', make: (r) => {
    const p = pick(r, PEOPLE), a = askOf(r);
    return { about: `${p.first} asks you something in a direct chat and you have not answered.`,
      steps: [waStep(0, p.full, [header(p.full, 'direct', p.full, 0), a.message])], expect: { tasks: [{ words: [a.k], done: null }], none: [] } };
  } },
  { id: 'scenario:grp-named-done', family: 'messaging', make: (r) => {
    const p = pick(r, PEOPLE), g = pick(r, GROUPS), a = askOf(r), at = replyAt(r);
    return { about: `In ${g}, ${p.first} tags you with an ask; you answer "Done" in the group.`,
      steps: [waStep(0, g, [header(g, 'group', p.full, 0, true), `@Mike ${a.message.charAt(0).toLowerCase()}${a.message.slice(1)}`]), waStep(at, g, [header(g, 'group', 'me', at), pick(r, DONE_REPLIES)])],
      expect: { tasks: [{ words: [a.k], done: { at, where: 'WhatsApp reply' } }], none: [] } };
  } },
  { id: 'scenario:grp-for-other', family: 'messaging', make: (r) => {
    const p = pick(r, PEOPLE), o = pickOther(r, PEOPLE, p), g = pick(r, GROUPS), a = askOf(r);
    return { about: `In ${g}, ${p.first} asks ${o.first}, not you: theirs, never on your list.`,
      steps: [waStep(0, g, [header(g, 'group', p.full, 0), `@${o.first} ${a.message.charAt(0).toLowerCase()}${a.message.slice(1)}`])],
      expect: { tasks: [], none: [], theirs: [[a.k]] } };
  } },
  { id: 'scenario:you-asked', family: 'messaging', make: (r) => {
    const p = pick(r, PEOPLE), s = pick(r, SENDS), at = replyAt(r);
    return { about: `You ask ${p.first} for something; it is theirs to do, so you wait on it.`,
      steps: [waStep(0, p.full, [header(p.full, 'direct', 'me', 0), `Could you send me ${s.o}?`]), waStep(at, p.full, [header(p.full, 'direct', p.full, at), 'Sure, will do'])],
      expect: { tasks: [], none: [], waiting: [[s.k]] } };
  } },
  { id: 'scenario:he-grp-named-done', family: 'messaging', make: (r) => {
    const p = pick(r, PEOPLE_HE), g = pick(r, GROUPS_HE), s = pick(r, SENDS_HE), at = replyAt(r);
    return { about: `In a Hebrew ${g} group, ${p.full} asks you by name to send something; you answer that you sent it.`,
      steps: [waStep(0, g, [header(g, 'group', p.full, 0, true), `מייק, תוכל לשלוח את ${s.o}?`]), waStep(at, g, [header(g, 'group', 'me', at), pick(r, ['שלחתי', 'שלחתי עכשיו'])])],
      expect: { tasks: [{ words: [s.k], done: { at, where: 'WhatsApp reply' } }], none: [] } };
  } },
  { id: 'scenario:claude-own-plan', family: 'claude-app', make: (r) => {
    const d = pick(r, CODE_DOMAINS), lead = pick(r, ["I'll take care of it:", "Here's my plan:"]);
    return { about: 'Claude lists what it will do itself, after being asked: none of it is yours.',
      steps: [{ at: 0, ...CLAUDE, title: cap(d.want), text: ['⟦Message 1⟧', `You said: Can you get ${d.want}?`, '⟦Message 2⟧', `Claude responded: ${lead}`, lead, ...d.steps.map((s, i) => `${i + 1}. ${s}`)] }],
      expect: { tasks: [], none: d.steps.map((s) => [s.toLowerCase()]) } };
  } },
  { id: 'scenario:claude-user-list', family: 'claude-app', make: (r) => {
    const d = pick(r, KEYED), lead = pick(r, ['Next steps:', 'To finish:']);
    return { about: 'Claude lists steps only you can take, in your accounts; none is done yet.',
      steps: [{ at: 0, ...CLAUDE, title: cap(d.goal), text: ['⟦Message 1⟧', `You said: How do I ${d.goal}?`, '⟦Message 2⟧', `Claude responded: ${lead}`, lead, ...d.steps.map((s, i) => `${i + 1}. ${s}`)] }],
      expect: { tasks: d.steps.map((s) => ({ words: [STEP_KEYS[s]!], done: null })), none: [] } };
  } },
];

export const scenarioHeld = () => heldOutFrames(grouped(SCENARIO_FRAMES, (f) => f.family));

export function synthScenarios(n: number, seed = 1): SynthScenario[] {
  return generate(SCENARIO_FRAMES, n, seed, scenarioHeld(), (f, r): Omit<Scenario, 'id'> => ({ ...f.make(r), family: f.family, start: START }),
    (s) => JSON.stringify(s.steps),
    (s, f, split, i): SynthScenario => ({ id: `synth-${f.id.replace('scenario:', '')}-${i}`, frame: f.id, split, ...s }));
}

// MARK: Measuring by split

/**
 * For an eval run over generated samples: right answers on frames trained on and on frames held out,
 * per model. Prints nothing for the hand-written samples, which carry no split.
 */
export function splitTable(samples: { id: string; split?: Split }[], runs: Record<string, { rightIds: string[] }>) {
  if (!samples.some((s) => s.split)) return;
  const of = (split: Split) => new Set(samples.filter((s) => s.split === split).map((s) => s.id));
  const train = of('train'), held = of('held-out');
  console.log(`\nBy split (held-out frames are phrasings an adapter never trains on):`);
  for (const [name, t] of Object.entries(runs)) {
    const right = (set: Set<string>) => t.rightIds.filter((id) => set.has(id)).length;
    console.log(`  ${name.padEnd(26)} train ${right(train)}/${train.size}   held out ${right(held)}/${held.size}`);
  }
}

// MARK: Writing it out

export interface Counts { lists: number; chats: number; looks: number; scenarios: number }
export const DEFAULT_COUNTS: Counts = { lists: 600, chats: 900, looks: 300, scenarios: 120 };

export function writeCorpus(outDir: string, counts: Counts = DEFAULT_COUNTS, seed = 1) {
  mkdirSync(join(outDir, 'scenarios'), { recursive: true });
  const put = (file: string, data: unknown) => writeFileSync(join(outDir, file), JSON.stringify(data, null, 1) + '\n');
  const lists = synthLists(counts.lists, seed), chats = synthChats(counts.chats, seed), looks = synthLooks(counts.looks, seed), scenarios = synthScenarios(counts.scenarios, seed);
  put('lists-samples.json', lists);
  put('chat-samples.json', chats);
  put('looks-samples.json', looks);
  scenarios.forEach((s, i) => put(join('scenarios', `${String(i + 1).padStart(3, '0')}-${s.id}.json`), s));
  return { lists, chats, looks, scenarios };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string, d: number) => { const i = args.indexOf(name); return i >= 0 ? Number(args[i + 1]) : d; };
  const outDir = args[0] && !args[0].startsWith('--') ? args[0] : join(process.env.TMPDIR ?? tmpdir(), 'didja-synth');
  const counts = { lists: flag('--lists', DEFAULT_COUNTS.lists), chats: flag('--chats', DEFAULT_COUNTS.chats), looks: flag('--looks', DEFAULT_COUNTS.looks), scenarios: flag('--scenarios', DEFAULT_COUNTS.scenarios) };
  const c = writeCorpus(outDir, counts, flag('--seed', 1));
  const line = (name: string, list: { split: Split; frame: string }[]) => {
    const held = list.filter((s) => s.split === 'held-out');
    console.log(`${name.padEnd(10)} ${String(list.length).padStart(5)} samples from ${new Set(list.map((s) => s.frame)).size} frames; ${held.length} held out (${new Set(held.map((s) => s.frame)).size} frames)`);
  };
  line('lists', c.lists);
  line('chats', c.chats);
  line('looks', c.looks);
  line('scenarios', c.scenarios);
  console.log(`\nIn ${outDir}. Nothing is sent anywhere.`);
}
