import { githubUrl, releasesUrl } from './repo.mjs';

/**
 * What the page links to (SCR-28, Brand V1). The code is ORG/didja and the signed builds are in
 * ORG/releases (`repo.mjs`), unless PUBLIC_GITHUB_URL or PUBLIC_RELEASES_URL is set; the version
 * comes from that releases repository's API at build time and falls back to the visible `[VERSION]`.
 */
export const GITHUB: string = githubUrl(import.meta.env.PUBLIC_GITHUB_URL);
export const RELEASES_REPO: string = releasesUrl(import.meta.env.PUBLIC_RELEASES_URL);
export const RELEASES = `${RELEASES_REPO}/releases`;
export const DOWNLOAD = `${RELEASES_REPO}/releases/latest/download/Didja.dmg`;

/** The latest release's version ("0.3.0"), or "[VERSION]" when it cannot be read. */
export async function latestVersion(): Promise<string> {
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
