import { writeFile } from 'node:fs/promises';
import { defineConfig } from 'astro/config';
import { githubUrl, redirects, releasesUrl } from './src/repo.mjs';

// The short links follow the same repository setting as the page (src/repo.mjs), so the
// organization's name is changed in one place (SCR-35).
const shortLinks = {
  name: 'didja-short-links',
  hooks: {
    'astro:build:done': async ({ dir }) => {
      await writeFile(new URL('_redirects', dir), redirects(githubUrl(process.env.PUBLIC_GITHUB_URL), releasesUrl(process.env.PUBLIC_RELEASES_URL)));
    },
  },
};

// Static site for didja.dev, deployed on Cloudflare Pages.
export default defineConfig({
  site: 'https://didja.dev',
  output: 'static',
  build: { inlineStylesheets: 'never' }, // CSS as files: the page's CSP allows no inline styles
  integrations: [shortLinks],
});
