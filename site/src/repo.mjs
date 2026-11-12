// Where the code lives on GitHub (SCR-35). ORG is the one line to change once the organization
// exists; PUBLIC_GITHUB_URL, when set at build time, wins over it. Plain JavaScript so that both
// the page (src/site.ts) and astro.config.mjs, which writes the short links, can import it.
export const ORG = 'didja-dev';

/** The repository's URL, from PUBLIC_GITHUB_URL if given, else from ORG. */
export function githubUrl(fromEnv) {
  return (fromEnv || `https://github.com/${ORG}/didja`).replace(/\/+$/, '');
}

/** Cloudflare Pages `_redirects`: the short links /github, /releases and /download (302s). */
export function redirects(github) {
  return [
    '# Short links, written at build time from src/repo.mjs (SCR-35).',
    `/github     ${github}                                    302`,
    `/releases   ${github}/releases                           302`,
    `/download   ${github}/releases/latest/download/Didja.dmg 302`,
    '',
  ].join('\n');
}
