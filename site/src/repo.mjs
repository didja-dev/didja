// Where Didja lives on GitHub (SCR-35). ORG is the organization; PUBLIC_GITHUB_URL and
// PUBLIC_RELEASES_URL, when set at build time, win over it. Plain JavaScript so that both the page
// (src/site.ts) and astro.config.mjs, which writes the short links, can import it.
export const ORG = 'didja-dev';

/** The code repository's URL, from PUBLIC_GITHUB_URL if given, else from ORG. */
export function githubUrl(fromEnv) {
  return (fromEnv || `https://github.com/${ORG}/didja`).replace(/\/+$/, '');
}

/**
 * The repository the signed builds are published to (didja-dev/releases, by release.yml and
 * scripts/release.sh): downloads, the version and the release notes come from here, not from the code.
 */
export function releasesUrl(fromEnv) {
  return (fromEnv || `https://github.com/${ORG}/releases`).replace(/\/+$/, '');
}

/** Cloudflare Pages `_redirects`: the short links /github, /releases and /download (302s). */
export function redirects(github, releases = releasesUrl()) {
  return [
    '# Short links, written at build time from src/repo.mjs (SCR-35).',
    `/github     ${github}                                    302`,
    `/releases   ${releases}/releases                         302`,
    `/download   ${releases}/releases/latest/download/Didja.dmg 302`,
    '',
  ].join('\n');
}
