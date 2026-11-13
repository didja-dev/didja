/**
 * Done by target (SCR-86): a catalogue of the places where common steps are done, and what "done"
 * looks like there, as data in `profiles/done/*.json`. A step that names its target (an env name,
 * a redirect or webhook URL, a domain, a repository's visibility, a DNS record, an auth provider) is
 * done when that target shows up as an item in the right list on the right page: a line of its own
 * in that page's list, on a screen captured after the step was made, with the confirming words the
 * place needs ("Valid Configuration", "Enabled", "OAuth client saved").
 *
 * Near-misses never count: the name only in a chat or in code (not the place), the page open without
 * the item, the item in a form still being filled in (a "Key"/"Value" form above it), another
 * environment's list (the step says Production and the row shows only Preview), a prefix of a
 * longer name. What it finds is evidence, never a tick by itself: the engine uses it as the second
 * sign beside the model's "looks done" (SCR-74), asks you when there is no model, and ticks on it
 * alone only where you have said yes often enough (an earned-trust place).
 *
 * Pure: the catalogue, a task's words and one screen in; a description out. Never screen text.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compilePattern } from './assistants.ts';
import type { Marker } from './markers.ts';
import { profilesDir } from './profiles.ts';

export type TargetKind = 'env' | 'url' | 'domain' | 'visibility' | 'dns' | 'provider' | 'deployment';

export interface Target {
  kind: TargetKind;
  value: string;
  /** A DNS record's type ("CNAME"). */
  type?: string;
}

interface PlaceFile {
  id: string;
  name: string;
  kinds: TargetKind[];
  /** The page's path matches this (a pattern). */
  path?: string;
  /** Or a line on the page matches one of these. */
  page?: string[];
  /** The item counts only after a line matching one of these (the list's heading)... */
  after?: string[];
  /** ...and before one matching these. */
  before?: string[];
  /** One of these must be within a few lines after the item ("Enabled", "Valid Configuration"). */
  confirm?: string[];
  /** One of these must be somewhere on the screen (a form that is the list: "OAuth client saved"). */
  saved?: string[];
  /** A line matching one of these just above the item means a form still being filled in. */
  form?: string[];
  /** The environments a row may show; a step naming one needs it on the row. */
  environments?: string[];
  /** A step done here implies this one next ("Redeploy on Vercel…"), done by a `deployment` place. */
  followUp?: { title: string };
}

export interface DoneServiceFile {
  id: string;
  name: string;
  /** Other names a step may use for the service ("Google Console"); its name always counts. */
  names?: string[];
  hosts: string[];
  places: PlaceFile[];
}

export interface Place {
  id: string;
  name: string;
  service: string;
  /** The service's name and other names, as patterns: a step or its source must name it. */
  names: RegExp[];
  hosts: string[];
  kinds: Set<TargetKind>;
  path: RegExp | null;
  page: RegExp[];
  after: RegExp[];
  before: RegExp[];
  confirm: RegExp[];
  saved: RegExp[];
  form: RegExp[];
  environments: string[];
  followUp: string | null;
}

const KINDS: TargetKind[] = ['env', 'url', 'domain', 'visibility', 'dns', 'provider', 'deployment'];
const list = (xs: unknown): string[] => (Array.isArray(xs) ? xs.filter((x): x is string => typeof x === 'string') : []);

/** A catalogue file as places, or an error saying what is wrong with it. */
export function compileService(f: DoneServiceFile): Place[] {
  if (typeof f.id !== 'string' || !/^[a-z0-9-]+$/.test(f.id)) throw new Error('id: lowercase letters, digits and dashes');
  const hosts = list(f.hosts).map((h) => h.toLowerCase());
  if (hosts.length === 0) throw new Error('hosts is empty');
  if (!Array.isArray(f.places) || f.places.length === 0) throw new Error('places is empty');
  return f.places.map((p) => {
    const kinds = list(p.kinds).filter((k): k is TargetKind => KINDS.includes(k as TargetKind));
    if (kinds.length === 0) throw new Error(`${p.id}: kinds names no known target`);
    if (!p.path && list(p.page).length === 0) throw new Error(`${p.id}: needs a path or page words`);
    return {
      id: p.id, name: p.name, service: f.name, hosts, kinds: new Set(kinds),
      names: [f.name, ...list(f.names)].map((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')),
      path: p.path ? compilePattern(p.path) : null, page: list(p.page).map(compilePattern),
      after: list(p.after).map(compilePattern), before: list(p.before).map(compilePattern),
      confirm: list(p.confirm).map(compilePattern), saved: list(p.saved).map(compilePattern),
      form: list(p.form).map(compilePattern), environments: list(p.environments),
      followUp: typeof p.followUp?.title === 'string' && p.followUp.title ? p.followUp.title : null,
    };
  });
}

/** Every place in a folder; a broken file is left out. */
export function readCatalogue(dir: string | null = doneDir()): Place[] {
  if (!dir || !existsSync(dir)) return [];
  const out: Place[] = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    try {
      out.push(...compileService(JSON.parse(readFileSync(join(dir, name), 'utf8')) as DoneServiceFile));
    } catch {
      // Left out, as a broken profile is.
    }
  }
  return out;
}

export function doneDir(): string | null {
  const dir = profilesDir();
  return dir && existsSync(join(dir, 'done')) ? join(dir, 'done') : null;
}

let cached: Place[] | null = null;
export function catalogue(): Place[] {
  cached ??= readCatalogue();
  return cached;
}
/** For tests: use these places instead of the ones on disk. */
export function useCatalogue(places: Place[] | null): void {
  cached = places;
}

// --- What a step targets -------------------------------------------------------------------------

/** A bare domain: "app.example.com" (not a file name, not inside a URL). */
const DOMAIN = /(?<![\w./@-])((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|io|dev|app|co|ai|xyz|me|so|sh|tech|site|cloud|page|link))(?![\w/.-])/gi;
const DNS_TYPE = /\b(A|AAAA|CNAME|TXT|MX|NS|CAA|SRV)\b(?:\s+record)?/;
const PROVIDERS = ['Google', 'GitHub', 'Apple', 'Azure', 'Discord', 'GitLab', 'Bitbucket', 'Facebook', 'Twitter', 'LinkedIn', 'Slack', 'Spotify', 'Twitch', 'Notion', 'Zoom', 'Figma', 'Keycloak', 'WorkOS'];

/** What a step names that a catalogue place can list: its env names and URLs (markers), and a domain, visibility, DNS record or provider in its words. */
export function targetsOf(title: string, markers: Marker[]): Target[] {
  const out: Target[] = [];
  const add = (t: Target) => {
    if (!out.some((o) => o.kind === t.kind && o.value === t.value)) out.push(t);
  };
  for (const m of markers) {
    if (m.kind === 'env') add({ kind: 'env', value: m.value });
    if (m.kind === 'url') add({ kind: 'url', value: m.value });
  }
  const prose = title.replace(/https?:\/\/\S+/g, ' ').replace(/`[^`]*`/g, ' ');
  const dns = prose.match(DNS_TYPE);
  for (const m of prose.matchAll(DOMAIN)) {
    const value = m[1]!.toLowerCase();
    if (dns && /\brecord\b/i.test(prose)) {
      add({ kind: 'dns', value, type: dns[1]! });
    } else {
      add({ kind: 'domain', value });
    }
  }
  if (dns && /\brecord\b/i.test(prose) && !out.some((t) => t.kind === 'dns')) {
    // "Add a CNAME record for www": the name may be a bare label.
    const name = prose.match(/\b(?:for|named|name)\s+[`"']?([a-z0-9_*@-]+)\b/i)?.[1];
    if (name) add({ kind: 'dns', value: name.toLowerCase(), type: dns[1]! });
  }
  const visibility = prose.match(/\b(public|private)\b/i);
  if (visibility && /\b(repo|repository|visibility)\b/i.test(prose)) add({ kind: 'visibility', value: visibility[1]!.toLowerCase() });
  // "Redeploy on Vercel": done by a deployment on the service the step names, newer than the step.
  if (/\bredeploy\b/i.test(prose)) add({ kind: 'deployment', value: 'redeploy' });
  if (/\b(?:provider|sign[- ]in|login|oauth)\b/i.test(prose) && /\b(?:enable|turn on|switch on|activate)\b/i.test(prose)) {
    const provider = PROVIDERS.find((p) => new RegExp(`\\b${p}\\b`, 'i').test(prose));
    if (provider) add({ kind: 'provider', value: provider });
  }
  return out;
}

/** The environments a step names: "for Production", "in Preview". */
function environmentsNamed(title: string, place: Place): string[] {
  return place.environments.filter((e) => new RegExp(`\\b${e}\\b`, 'i').test(title));
}

/** "just now", "42s ago", "3m ago", "1h ago": milliseconds, or null. */
export function agoMs(line: string): number | null {
  const l = line.trim().toLowerCase();
  if (/^just now$/.test(l)) return 0;
  const m = l.match(/^(\d+)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?)\s+ago$/);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2]!.startsWith('s') ? n * 1000 : m[2]!.startsWith('m') ? n * 60_000 : n * 3_600_000;
}

/**
 * A deployment the place confirms ("Ready", "Published") with a time beside it newer than the step:
 * a redeploy after the change. Only on the service the step names; never an older one.
 */
function newDeployment(place: Place, title: string, lines: string[], ts: string | null, since: string | null): string | null {
  if (!ts || !since || !new RegExp(`\\b${place.service}\\b`, 'i').test(title)) return null;
  for (let i = 0; i < lines.length; i++) {
    if (!place.confirm.some((r) => r.test(lines[i]!.trim()))) continue;
    const near = lines.slice(Math.max(0, i - NEAR), i + NEAR + 1);
    const ago = near.map((l) => agoMs(l)).find((v) => v !== null);
    if (ago === undefined || ago === null) continue;
    if (Date.parse(ts) - ago > Date.parse(since)) return near.map((l) => l.trim()).join('\n');
  }
  return null;
}

// --- Is it listed there? ---------------------------------------------------------------------------

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}
const onHost = (host: string, hosts: string[]) => hosts.some((h) => host === h || host.endsWith(`.${h}`));
const trimUrl = (u: string) => u.replace(/\/+$/, '').toLowerCase();

/** The places on this page: its host, then its path or page words. */
export function placesOn(o: { url: string | null; text: string }, all: Place[] = catalogue()): Place[] {
  const host = hostOf(o.url);
  if (!host) return [];
  const lines = o.text.split(/\r?\n/).map((l) => l.trim());
  return all.filter((p) => onHost(host, p.hosts) &&
    (p.path ? p.path.test(pathOf(o.url!)) : p.page.some((r) => lines.some((l) => r.test(l)))));
}

/** Whether the catalogue knows any place on this host for this kind of target. */
export function catalogued(host: string | null, kind: TargetKind, all: Place[] = catalogue()): boolean {
  return host !== null && all.some((p) => p.kinds.has(kind) && onHost(host, p.hosts));
}

/** Whether a line is the target as an item: the name or URL alone, or first, on its line. Never a prefix of a longer one. */
function isItem(line: string, t: Target): boolean {
  const l = line.trim();
  switch (t.kind) {
    case 'env': return new RegExp(`^${t.value}(?![A-Za-z0-9_])`).test(l) && l.length <= t.value.length + 80;
    case 'url': {
      const first = l.split(/\s+/)[0] ?? '';
      return trimUrl(first) === trimUrl(t.value);
    }
    case 'domain': {
      const first = (l.split(/\s+/)[0] ?? '').toLowerCase();
      return first === t.value;
    }
    case 'dns': return new RegExp(`(?:^|\\s)${t.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\.|\\s|$)`, 'i').test(l);
    case 'visibility': return new RegExp(`^${t.value}$|currently ${t.value}\\b|now ${t.value}\\b`, 'i').test(l);
    case 'provider': return new RegExp(`^${t.value}$`, 'i').test(l);
    case 'deployment': return false;
  }
}

export interface Listed {
  place: Place;
  target: Target;
  /** The item and the lines right after it, for the model to judge. Kept in memory only. */
  snippet: string;
  /** "Vercel › Environment Variables lists RESEND_API_KEY": no screen text beyond the step's own target. */
  detail: string;
}

const NEAR = 4;

/**
 * Whether a screen shows one of a step's targets as an item of a catalogue place, with every rule of
 * that place met; null for a near-miss or a page that is no catalogue place.
 */
export function listedOn(
  title: string, targets: Target[], o: { url: string | null; text: string; ts?: string }, all: Place[] = catalogue(), since: string | null = null,
  source: string | null = null,
): Listed | null {
  if (targets.length === 0) return null;
  const lines = o.text.split(/\r?\n/);
  // Where it is done must be named by the step or where it came from (SCR-66): a page that only
  // happens to list the same words is not that place. Names inside links and code do not count.
  const said = source === null ? null : `${title}\n${source}`.replace(/https?:\/\/\S+/g, ' ').replace(/`[^`]*`/g, ' ');
  for (const place of placesOn(o, all)) {
    if (said !== null && !place.names.some((r) => r.test(said))) continue;
    if (place.saved.length > 0 && !lines.some((l) => place.saved.some((r) => r.test(l)))) continue;
    let start = 0;
    let end = lines.length;
    if (place.after.length > 0) {
      const at = lines.findIndex((l) => place.after.some((r) => r.test(l.trim())));
      if (at < 0) continue;
      start = at + 1;
      const stop = lines.findIndex((l, i) => i > at && place.before.some((r) => r.test(l.trim())));
      if (stop >= 0) end = stop;
    }
    for (const target of targets.filter((t) => place.kinds.has(t.kind))) {
      if (target.kind === 'deployment') {
        const found = newDeployment(place, title, lines, o.ts ?? null, since);
        if (found) return { place, target, snippet: found, detail: `${place.name} shows a deployment newer than the step` };
        continue;
      }
      for (let i = start; i < end; i++) {
        if (!isItem(lines[i]!, target)) continue;
        const above = lines.slice(Math.max(start, i - NEAR), i).map((l) => l.trim());
        if (place.form.some((r) => above.some((l) => r.test(l)))) continue; // a form, not yet saved
        const around = lines.slice(i, Math.min(lines.length, i + NEAR + 1)).map((l) => l.trim());
        if (place.confirm.length > 0 && !place.confirm.some((r) => around.some((l) => r.test(l)))) continue;
        if (target.kind === 'dns' && !around.slice(0, 3).concat(lines.slice(Math.max(0, i - 2), i)).some((l) => new RegExp(`\\b${target.type}\\b`).test(l))) continue;
        const wanted = environmentsNamed(title, place);
        if (wanted.length > 0) {
          const row = around.slice(0, NEAR).join(' ');
          if (!wanted.every((e) => new RegExp(`\\b${e}\\b`).test(row))) continue; // another environment's list
        }
        return { place, target, snippet: around.join('\n'), detail: `${place.name} lists ${target.value}` };
      }
    }
  }
  return null;
}

/** The follow-up a step done on this page implies ("Redeploy on Vercel…"), or null. */
export function followUpOn(o: { url: string | null; text: string }, all: Place[] = catalogue()): { place: Place; title: string } | null {
  const place = placesOn(o, all).find((p) => p.followUp !== null);
  return place ? { place, title: place.followUp! } : null;
}
