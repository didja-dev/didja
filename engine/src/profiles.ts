/**
 * App profiles (`profiles/*.json`): how capture reads each chat and email app. The engine needs
 * only which windows belong to which app: a chat app's name for its tasks, and which windows are
 * mail. The rules themselves are applied by capture in the app.
 *
 * The profiles are read from the app bundle (`Contents/Resources/profiles`, next to the engine's
 * `Contents/Helpers`), or from the repository when the engine runs from source.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface ProfileInfo {
  id: string;
  name: string;
  kind: 'chat' | 'email';
  status?: 'builtIn' | 'community' | 'communityNew';
  about?: string;
  match: { bundleIds?: string[]; urlPrefixes?: string[]; hosts?: string[] };
}

/** Where the profiles are: $DIDJA_PROFILES, the app bundle, or the repository. */
export function profilesDir(): string | null {
  const candidates = [
    process.env.DIDJA_PROFILES,
    join(dirname(process.execPath), '..', 'Resources', 'profiles'),
    join(import.meta.dir, '..', '..', 'profiles'),
  ];
  return candidates.find((d): d is string => !!d && existsSync(d)) ?? null;
}

/** Every profile in a folder that reads as one; the app checks the rules, this only what it needs. */
export function readProfiles(dir: string | null = profilesDir()): ProfileInfo[] {
  if (!dir) return [];
  const out: ProfileInfo[] = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    try {
      const p = JSON.parse(readFileSync(join(dir, name), 'utf8')) as ProfileInfo;
      if (typeof p.id === 'string' && typeof p.name === 'string' && (p.kind === 'chat' || p.kind === 'email') && p.match) out.push(p);
    } catch {
      // An unreadable profile is left out, as the app leaves it out.
    }
  }
  return out;
}

let cached: ProfileInfo[] | null = null;
export function profiles(): ProfileInfo[] {
  cached ??= readProfiles();
  return cached;
}
/** For tests: use these profiles instead of the ones on disk. */
export function useProfiles(list: ProfileInfo[] | null): void {
  cached = list;
}

export function matchesApp(p: ProfileInfo, bundleId: string): boolean {
  return (p.match.bundleIds ?? []).includes(bundleId);
}

export function matchesURL(p: ProfileInfo, url: string | null): boolean {
  if (!url) return false;
  if ((p.match.urlPrefixes ?? []).some((prefix) => prefix.startsWith('https://') && url.startsWith(prefix))) return true;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (p.match.hosts ?? []).includes(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** The profile a window is read with: its app's, else its site's. */
export function profileFor(window: { bundleId: string; url: string | null }, list: ProfileInfo[] = profiles()): ProfileInfo | null {
  return list.find((p) => matchesApp(p, window.bundleId)) ?? list.find((p) => matchesURL(p, window.url)) ?? null;
}
