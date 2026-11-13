import { githubUrl, releasesUrl } from './repo.mjs';

/**
 * What the page links to (SCR-28, Brand V1). The code is ORG/didja and the signed builds are in
 * ORG/releases (`repo.mjs`), unless PUBLIC_GITHUB_URL or PUBLIC_RELEASES_URL is set; the version
 * comes from the appcast at build time (`latestVersion`) and falls back to the visible `[VERSION]`.
 */
export const GITHUB: string = githubUrl(import.meta.env.PUBLIC_GITHUB_URL);
export const RELEASES_REPO: string = releasesUrl(import.meta.env.PUBLIC_RELEASES_URL);
export const RELEASES = `${RELEASES_REPO}/releases`;
export const DOWNLOAD = `${RELEASES_REPO}/releases/latest/download/Didja.dmg`;

/** The newest version an appcast offers ("0.7.0"), or null. Compared as numbers, so 0.10 > 0.9. */
export function newestInAppcast(xml: string): string | null {
  const versions = [...xml.matchAll(/<sparkle:shortVersionString>\s*([\d.]+)\s*</g)].map((m) => m[1]!);
  const parts = (v: string) => v.split('.').map(Number);
  const newer = (a: string, b: string) => {
    const [x, y] = [parts(a), parts(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
    return false;
  };
  return versions.reduce<string | null>((best, v) => (best === null || newer(v, best) ? v : best), null);
}

/**
 * The latest release's version ("0.3.0"), or "[VERSION]" when it cannot be read. From the appcast
 * in this repository first: the release workflow adds each version to it before it deploys the
 * site, and reading a file needs no network (GitHub's API often refuses build machines without a
 * token). The releases repository's API is the fallback.
 */
export async function latestVersion(): Promise<string> {
  try {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const fromAppcast = newestInAppcast(readFileSync(join(process.cwd(), 'public', 'appcast.xml'), 'utf8'));
    if (fromAppcast) return fromAppcast;
  } catch {
    // Not built from the site folder: ask GitHub below.
  }
  const repo = RELEASES_REPO.match(/^https:\/\/github\.com\/([^/[\]]+)\/([^/[\]]+)\/?$/);
  if (!repo) return '[VERSION]';
  try {
    const answer = await fetch(`https://api.github.com/repos/${repo[1]}/${repo[2]}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'didja-site-build' },
      signal: AbortSignal.timeout(5000),
    });
    if (!answer.ok) return '[VERSION]';
    const tag = ((await answer.json()) as { tag_name?: string }).tag_name ?? '';
    return tag.replace(/^v/, '') || '[VERSION]';
  } catch {
    return '[VERSION]';
  }
}
