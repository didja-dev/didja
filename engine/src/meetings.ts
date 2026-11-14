/**
 * Meeting action items already on screen (SCR-107): the "Action items" / "Next steps" /
 * "Follow-ups" list a meeting tool shows in its notes (Granola, Otter, Zoom's summary, Notion's AI
 * meeting notes, Gemini's notes in Google Docs). Text from the screen only: Didja never hears a
 * meeting.
 *
 * Which windows are which tool, and which headings start its list, are data: one file per tool in
 * `profiles/meetings/`, with made-up fixtures in `profiles/fixtures/meetings/`. A tool whose list
 * cannot be read yet is listed with `supported: false` and why.
 *
 * Who an item is for is read from its own words ("Mike: send the deck", "Send the deck (Mike)",
 * "Mike to send the deck", "@Mike", "Owner: Mike"). Yours (by Your Names, or "me") becomes a task;
 * someone else's is left out; an item that names no one goes to the Suggested tray, never the list.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { profilesDir } from './profiles.ts';
import { samePerson } from './waiting.ts';

export interface MeetingProfile {
  id: string;
  name: string;
  about?: string;
  /** False for a tool whose list Didja cannot read yet; `about` says why. */
  supported: boolean;
  match: { bundleIds?: string[]; hosts?: string[] };
  /** The headings that start its list of action items, as shown (any case). */
  sections: string[];
}

export function meetingsDir(): string | null {
  const dir = profilesDir();
  return dir && existsSync(join(dir, 'meetings')) ? join(dir, 'meetings') : null;
}

export function readMeetingProfiles(dir: string | null = meetingsDir()): MeetingProfile[] {
  if (!dir || !existsSync(dir)) return [];
  const out: MeetingProfile[] = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    try {
      const p = JSON.parse(readFileSync(join(dir, name), 'utf8')) as MeetingProfile;
      if (typeof p.id === 'string' && typeof p.name === 'string' && typeof p.supported === 'boolean' && p.match && Array.isArray(p.sections)) out.push(p);
    } catch {
      // Left out, as a broken app profile is.
    }
  }
  return out;
}

let cached: MeetingProfile[] | null = null;
export function meetingProfiles(): MeetingProfile[] {
  cached ??= readMeetingProfiles();
  return cached;
}
/** For tests: use these instead of the ones on disk. */
export function useMeetingProfiles(list: MeetingProfile[] | null): void {
  cached = list;
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** The meeting tool a window is, by its app or its site; only tools Didja can read. */
export function meetingFor(window: { bundleId: string; url: string | null }, list: MeetingProfile[] = meetingProfiles()): MeetingProfile | null {
  const host = hostOf(window.url);
  return list.find((p) => p.supported && ((p.match.bundleIds ?? []).includes(window.bundleId)
    || (host !== null && (p.match.hosts ?? []).some((h) => host === h || host.endsWith(`.${h}`))))) ?? null;
}

export interface MeetingItem {
  /** The item's words without its owner or box: "Send the deck to Acme". */
  title: string;
  /** Who it is for, as written ("Mike", "me"), or null when it names no one. */
  owner: string | null;
  /** Its box is ticked in the tool. */
  checked: boolean;
}

/** Headings that end an action-item list: the notes' other parts. */
const OTHER_PART = /^(?:summary|overview|notes|meeting notes|key (?:points|takeaways)|takeaways|decisions|transcript|details|topics|agenda|chapters|questions|outline|highlights|attendees|participants|discussion|recap|keywords)$/i;
const BOX = /^(?:\[( |x|X)\]|(☐|□|◻|⬜)|(☑|✅|✔|✔️|☒))\s*/u;
const BULLET = /^(?:[-*•·◦▪–]|\d{1,2}[.)])\s+/u;
/** Words that start an item, never a name ("Follow up: …", "Next: …"). */
const NOT_A_NAME = new Set(['follow', 'next', 'action', 'todo', 'to-do', 'note', 'task', 'item', 'owner', 'assignee', 'due', 'send', 'review',
  'schedule', 'update', 'check', 'share', 'book', 'call', 'email', 'draft', 'prepare', 'confirm', 'set', 'create', 'add', 'fix', 'ask', 'reply',
  'decide', 'finish', 'write', 'plan', 'sign', 'pay', 'get', 'make', 'look', 'find', 'reach', 'organize', 'organise', 'circle', 'sync', 'all', 'everyone', 'team']);
const NAME = String.raw`(?:@?(?:[\p{Lu}][\p{L}'’-]+(?: [\p{Lu}][\p{L}'’-]+){0,2}|[֐-׿][֐-׿'’-]+(?: [֐-׿][֐-׿'’-]+)?|me|Me))`;

function nameLike(s: string): boolean {
  const first = s.replace(/^@/, '').split(' ')[0]!.toLowerCase();
  return !NOT_A_NAME.has(first) && !/\d/.test(s);
}

const clean = (s: string) => {
  const t = s.replace(/^@/, '').trim();
  return /^me$/i.test(t) ? 'me' : t;
};
const titled = (s: string) => {
  const t = s.replace(/^[\s:;,—–-]+/u, '').replace(/[\s.;,]+$/u, '').replace(/\s+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Who an item is for, and its words without them. */
export function ownerOf(line: string): { title: string; owner: string | null } {
  let text = line.trim();
  // "Owner: Mike", "Assigned to Mike", "Assignee: @Mike" anywhere in the line.
  const tag = text.match(new RegExp(String.raw`\s*[(\[]?\b(?:owner|assignee|assigned to)\s*:?\s*(${NAME})[)\]]?`, 'iu'));
  if (tag && nameLike(tag[1]!)) return { title: titled(text.replace(tag[0], ' ')), owner: clean(tag[1]!) };
  // "Mike: send the deck", "Mike — send the deck".
  let m = text.match(new RegExp(String.raw`^(${NAME})\s*(?::|\s[—–-])\s*(.+)$`, 'u'));
  if (m && nameLike(m[1]!)) return { title: titled(m[2]!), owner: clean(m[1]!) };
  // "Mike to send the deck", "Mike will send the deck".
  m = text.match(new RegExp(String.raw`^(${NAME})\s+(?:to|will|should)\s+(.+)$`, 'u'));
  if (m && nameLike(m[1]!)) return { title: titled(m[2]!), owner: clean(m[1]!) };
  // "@Mike send the deck".
  m = text.match(/^@([\p{L}][\p{L}'’-]+(?: [\p{Lu}][\p{L}'’-]+)?)\s+(.+)$/u);
  if (m) return { title: titled(m[2]!), owner: m[1]! };
  // "Send the deck (Mike)", "Send the deck — Mike", "Send the deck @Mike".
  m = text.match(new RegExp(String.raw`^(.+?)\s*(?:[(\[]\s*(${NAME})\s*[)\]]|\s[—–-]\s*(${NAME})|\s@([\p{L}][\p{L}'’-]+))\s*$`, 'u'));
  const who = m ? (m[2] ?? m[3] ?? m[4]) : undefined;
  if (m && who && nameLike(who)) return { title: titled(m[1]!), owner: clean(who) };
  text = titled(text);
  return { title: text, owner: null };
}

function isHeading(line: string, sections: RegExp[]): 'list' | 'other' | null {
  const t = line.replace(/^#{1,6}\s*/, '').replace(/^\*\*(.*)\*\*$/, '$1').replace(/:$/, '').trim();
  if (sections.some((r) => r.test(t))) return 'list';
  if (OTHER_PART.test(t)) return 'other';
  return null;
}

/** The action items under the tool's headings in a window's text, with who each is for. */
export function actionItems(profile: MeetingProfile, text: string): MeetingItem[] {
  const sections = profile.sections.map((s) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
  const out: MeetingItem[] = [];
  let inList = false;
  let count = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('⟦')) { inList = false; continue; }
    if (!line) continue;
    const heading = isHeading(line, sections);
    if (heading) { inList = heading === 'list'; count = 0; continue; }
    if (!inList) continue;
    // Another heading of the notes' own ("Pricing:"), short and ending in a colon: the list is over.
    if (/:$/.test(line) && line.split(/\s+/).length <= 5 && !BULLET.test(line) && !BOX.test(line)) { inList = false; continue; }
    if (++count > 25) { inList = false; continue; }
    let body = line.replace(BULLET, '');
    const box = body.match(BOX);
    const checked = !!box && (box[1] === 'x' || box[1] === 'X' || !!box[3]);
    body = body.replace(BOX, '').replace(BULLET, '').trim();
    if (body.length < 3 || !/\p{L}{2}/u.test(body)) continue;
    const { title, owner } = ownerOf(body);
    if (title.length < 3) continue;
    out.push({ title: title.slice(0, 200), owner, checked });
  }
  return out;
}

/** Whether an item's owner is you: "me", or one of your names (a first name matches a full one). */
export function isYou(owner: string, me: string[]): boolean {
  if (/^me$/i.test(owner)) return true;
  return me.some((name) => samePerson(owner, name) || samePerson(name, owner));
}
