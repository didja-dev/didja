/**
 * App profile fixtures, the engine's half (SCR-42): what the engine makes of a fixture's lines,
 * and a quick check of a profile's shape. Used by the tests and by `didja mcp` (test_profile,
 * draft_profile), so a contributor's Claude sees exactly what CI will check.
 */
import type { ChatReader, ReplyJudge } from './chat.ts';
import { parseChatMessages } from './chat.ts';
import { parseEmails } from './email.ts';
import { pollOnce } from './engine.ts';
import type { ProfileInfo } from './profiles.ts';
import { profileFor, useProfiles } from './profiles.ts';
import { Store } from './store.ts';

/** Wednesday 11 November 2026, 10:00 local time: the fixtures' "today". */
export const FIXTURE_NOW = new Date(2026, 10, 11, 10, 0);
/** When a fixture's window was first on screen. */
export const FIXTURE_SEEN = new Date(2026, 10, 11, 9, 25);
export const FIXTURE_ME = 'Mike Rosen';

export interface Fixture {
  about: string;
  profile: string;
  app: string;
  url?: string;
  window?: string;
  outline?: string[];
  lines: string[];
  expect?: FixtureView;
}

export interface FixtureView {
  messages?: { chat: string; kind: string; from: string; mentionsMe: boolean; time: string; body: string }[];
  open?: string[];
  emails?: { subject: string; from: string; to: string; date: string | null }[];
}

/**
 * What the engine makes of a fixture's lines: the messages and the asks left open for a chat, the
 * emails for mail. The model is stood in for by a judge that ticks whenever it can: every message
 * from someone else asks, every reply of yours settles it. So an ask stays open only if no message
 * is wrongly taken for yours.
 */
export function engineView(f: Fixture, list: ProfileInfo[]): FixtureView {
  const window = { bundleId: f.app, app: f.app, url: f.url ?? null };
  const profile = profileFor(window, list);
  if (!profile) throw new Error(`no profile reads ${f.app}${f.url ? ` at ${f.url}` : ''}`);
  if (profile.kind === 'email') {
    return { emails: parseEmails(f.lines.join('\n')).map((e) => ({ subject: e.subject, from: e.from, to: e.to, date: e.date })) };
  }
  useProfiles(list);
  const store = new Store(':memory:');
  try {
    store.setMeta('my_name', FIXTURE_ME);
    // Seen first at 9:25 (so every message arrived while it was on screen), and again just now.
    for (const ts of [FIXTURE_SEEN, new Date(FIXTURE_NOW.getTime() - 60_000)]) {
      store.insertObservation({
        ts: ts.toISOString(), bundleId: f.app, app: profile.name, windowTitle: f.window ?? profile.name, url: f.url ?? null,
        source: 'ax', text: f.lines.join('\n'),
      });
    }
    // Titled by who asked only: a title that names you is refused as a misreading.
    const read: ChatReader = (q) => ({ asks: true, task: `Answer ${q.from}` });
    const settles: ReplyJudge = () => 'settles';
    pollOnce(store, FIXTURE_NOW, { chatReader: read, replyJudge: settles });
    pollOnce(store, new Date(FIXTURE_NOW.getTime() + 11 * 60_000), { chatReader: read, replyJudge: settles });
    const open = store.listTasks().map((t) => t.title).sort();
    return { messages: parseChatMessages(f.lines.join('\n')), open };
  } finally {
    store.close();
    useProfiles(null);
  }
}

const RULES = new Set(['chatName', 'message', 'messageList', 'reactionList', 'skip', 'line', 'emailHeader', 'emailSubject',
  'emailSection', 'emailMessage', 'emailBody']);

/** Every pattern in a profile, wherever it sits. */
export function patternsIn(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => patternsIn(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (k === 'pattern' && typeof x === 'string') out.push(x);
      else if (k === 'reactions' && Array.isArray(x)) out.push(...x.filter((p): p is string => typeof p === 'string'));
      else patternsIn(x, out);
    }
  }
  return out;
}

/**
 * What is wrong with a profile's shape, if anything. The app's own check when it loads one is the
 * full one (AppProfile.check, ProfilePattern); this one runs anywhere.
 */
export function profileProblems(p: any, fileName?: string): string[] {
  const problems: string[] = [];
  if (!p || typeof p !== 'object') return ['not a JSON object'];
  if (typeof p.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(p.id)) problems.push('id: lowercase letters, digits and dashes');
  if (fileName && fileName !== `${p.id}.json`) problems.push(`the file must be named ${p.id}.json`);
  if (typeof p.name !== 'string' || !p.name) problems.push('name is missing');
  if (p.kind !== 'chat' && p.kind !== 'email') problems.push('kind is chat or email');
  if (typeof p.about !== 'string' || !p.about) problems.push('about: say what the app is and how its window is laid out');
  const m = p.match ?? {};
  if ((m.bundleIds ?? []).length + (m.urlPrefixes ?? []).length + (m.hosts ?? []).length === 0) problems.push('match names no app or site');
  for (const prefix of m.urlPrefixes ?? []) {
    if (!/^https:\/\/[^/]{4,}\//.test(prefix)) problems.push(`urlPrefixes: ${prefix} must start https:// and name its site`);
  }
  if (!Array.isArray(p.rules) || p.rules.length === 0) problems.push('rules are missing');
  else if (p.rules.length > 60) problems.push('more than 60 rules');
  for (const [i, r] of (Array.isArray(p.rules) ? p.rules : []).entries()) {
    if (!RULES.has(r?.is)) problems.push(`rule ${i + 1}: "is" must be one of ${[...RULES].join(', ')}`);
    if (!r?.where || typeof r.where !== 'object') problems.push(`rule ${i + 1}: "where" is missing`);
  }
  for (const pattern of patternsIn(p.rules)) {
    if (pattern.length > 300) problems.push(`a pattern is over 300 characters: ${pattern.slice(0, 40)}…`);
    if (/\\[1-9]|\\k<|\(\?<[=!]/.test(pattern)) problems.push(`no back-references or look-behind: ${pattern}`);
  }
  return problems;
}
