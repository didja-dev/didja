# didja.dev

The landing page for Didja. Astro, static, deployed on Cloudflare Pages (SCR-28).

- **Source of truth**: the "BRAND V1" comment on SCR-28 (it overrides the canvas). Copy is in `src/content.ts`; change it there only.
- **Logo**: the Prompt done mark (`src/components/Mark.astro`, `public/favicon.svg`, `og/touch.html` → `public/apple-touch-icon.png`).
- **Links**: `src/site.ts`. The repository is `ORG` in `src/repo.mjs` (the one line to change once the organization exists), or `PUBLIC_GITHUB_URL` when building. Download, the version and the release notes come from the repository the signed builds are published to, `didja-dev/releases` (`releasesUrl`, or `PUBLIC_RELEASES_URL`): download points at `<releases>/releases/latest/download/Didja.dmg`, and the version is the newest one in `public/appcast.xml` at build time (its Releases API if that cannot be read; else `[VERSION]`). The code links go to the code repository. The short links `/github`, `/releases`, `/download` are written to `dist/_redirects` at build time from the same setting (`astro.config.mjs`). `public/appcast.xml` is the update feed, written by `scripts/release.sh` with each release.
- **Fonts** are self-hosted (`@fontsource/*`): the page makes no request to any other host.
- **Script**: `public/scripts/site.js`, the only one: the hero's clickable Quick View, the demo driven by scrolling, things fading in and headings lighting up, the highlighter stroke. No inline scripts or styles (CSS is emitted as files; the script sets values through the CSSOM, which the CSP allows), so `public/_headers` sets a strict CSP: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:`. With reduced motion, states change but nothing animates.
- **Demo**: `src/components/MacDesktop.astro`, a Mac drawn in HTML and CSS (no images): Claude gives the steps to make didja.dev public, you do them in Terminal, GitHub and Cloudflare, and Didja ticks them in the menu bar. In "See it" scrolling moves it through five scenes (`story` in `src/content.ts`); "How it works" shows three of them as stills.
- **Share image**: `og/og.html`, rendered to `public/og.png` with headless Chrome:
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --window-size=1200,630 --screenshot="$PWD/public/og.png" "file://$PWD/og/og.html"`

## Work on it

```bash
cd site && bun install && bunx astro dev
```

## Deploy

1. Once: `npx wrangler login` (you sign in to Cloudflare in the browser). The Pages project `didja` exists (created with `--force`, because new wrangler sends Pages commands to Workers by default; later commands go to Pages without it). Live at https://didja.pages.dev.
2. `PUBLIC_GITHUB_URL=https://github.com/<org>/didja bun run deploy` builds and uploads to the Pages project `didja`.
3. Done (2026-11-11): custom domains `didja.dev` and `www.didja.dev` on the Pages project; DNS has proxied CNAMEs `@` and `www` → `didja.pages.dev`; Rules → Redirect Rules sends `https://www.*` to `https://${1}` (301, query kept). Email Routing forwards hello@didja.dev to the maintainer's Gmail (rule "hello@didja.dev to Gmail"). `didya.dev` and `www.didya.dev` have proxied placeholder A records (`192.0.2.1`) and the Redirect Rule "didya.dev to didja.dev" (all requests, 301 to `https://didja.dev` + path, query kept).

The DMG (about 45 MB) is over Cloudflare Pages' 25 MB file limit, so it is not part of the site: host it elsewhere (a public R2 bucket on `dl.didja.dev`, or GitHub Releases once the repository is public) and point the Download link and the short links (`src/repo.mjs`) at it.

## Still placeholders (on purpose)

- The GitHub org is `didja-dev` (`ORG` in `src/repo.mjs`).
- Copy to confirm against the app: the FAQ's "optional AI helper" (Brand V1 marks it "Owner to confirm before launch") and "banking".
