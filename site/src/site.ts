import { githubUrl } from './repo.mjs';

/**
 * What the page links to (SCR-28, Brand V1). The org comes from ORG in `repo.mjs` (didja-dev),
 * unless PUBLIC_GITHUB_URL is set; the version comes from the GitHub Releases API at build time and
 * falls back to the visible `[VERSION]` placeholder.
 */
export const GITHUB: string = githubUrl(import.meta.env.PUBLIC_GITHUB_URL);
export const RELEASES = `${GITHUB}/releases`;
export const DOWNLOAD = `${GITHUB}/releases/latest/download/Didja.dmg`;

/** The latest release's version ("0.3.0"), or "[VERSION]" when it cannot be read. */
export async function latestVersion(): Promise<string> {
  const repo = GITHUB.match(/^https:\/\/github\.com\/([^/[\]]+)\/([^/[\]]+)\/?$/);
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
