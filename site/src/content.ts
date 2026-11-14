/**
 * Every word on didja.dev, word for word from SCR-28's "BRAND V1" comment (the source of truth;
 * it overrides the canvas). Copy changes go here only; the page reads from this file.
 *
 * Placeholders kept on purpose: [VERSION] (filled from the releases repository at build time).
 * The FAQ's privacy answer was rewritten before launch (2026-11-12): Brand V1's "optional AI helper"
 * that sends a snippet does not exist; the optional local model runs on the Mac.
 */
export const nav = { how: 'How it works', privacy: 'Privacy', github: 'GitHub', download: 'Download' };

export const hero = {
  tag: 'Didja finish that?',
  titleBefore: 'Ten tabs, four Claude sessions,',
  titleMark: 'one forgotten step.',
  lead: "You're vibe coding in five places at once. Claude gives you a checklist, you do three steps, a new prompt pulls you away, and step four quietly disappears, until production breaks.",
  bold: "Didja remembers the steps you didn't finish, and ticks them off when you do.",
  download: 'Download for Mac',
  star: 'Star on GitHub',
  meta: 'Free · open source · runs 100% on your Mac · macOS 14+ · Windows later',
  mockTitle: 'Didja',
  mockLeft: 'open',
  mockSearch: 'Search',
  mockFooter: 'Capturing · on this Mac only',
  mockKeys: '⇧⌘J',
  mockClock: 'Wed 21:45',
  confirmLead: 'Looks done?',
  confirmBody: 'An email to Mike was just sent from Gmail.',
  confirmYes: 'Yes, done',
  confirmNo: 'Not yet',
  mockNote: '[PLACEHOLDER — illustrative mock; swap for a real app screenshot or the demo]',
};

/**
 * The hero: Didja's popover hanging from its menu bar icon, as on a real Mac, filled with made-up
 * work from four places at once. `startsDone` items are ticked already; `auto` is the one that
 * ticks itself a moment after the hero comes into view (site.js), saying what Didja saw; `asks`
 * is the one Didja asks about ("Looks done?"). `kind` styles the line under the title: `seen`,
 * `watch` (it knows what would tick it), `nudge` (left behind), `sync` (a connected tool).
 */
export const mockGroups = [
  {
    source: 'Claude Code — api-server',
    title: 'Ship auth to production',
    time: '9:20',
    items: [
      { id: 'a', title: 'Set STRIPE_KEY in Vercel → Production', kind: 'seen', open: 'watching vercel.com', done: 'seen on vercel.com', startsDone: true },
      { id: 'b', title: 'Run the prod migration', kind: 'seen', open: 'ticks when it runs', done: 'seen in Terminal', startsDone: true },
      { id: 'c', title: 'Add the redirect URL in Supabase Auth', kind: 'watch', open: 'watching supabase.com', done: 'seen on supabase.com · just now', startsDone: false, auto: true },
      { id: 'e', title: 'Tag v1.4.0 and push it', kind: 'nudge', open: 'scrolled away 2h ago', done: 'you ticked it', startsDone: false },
    ],
  },
  {
    source: 'Gmail — Sarah Cohen',
    items: [
      { id: 'd', title: 'Email Mike the signed contract', kind: 'watch', open: 'from “don’t forget…” · 40 min ago', done: 'sent · seen in Gmail', startsDone: false, asks: true },
    ],
  },
  {
    source: 'Slack — #launch',
    items: [
      { id: 'f', title: 'Answer Dana: does Tuesday work?', kind: 'nudge', open: 'asked you · 3h ago', done: 'you answered', startsDone: false },
    ],
  },
  {
    source: 'Linear — ACME-212',
    items: [
      { id: 'g', title: 'Review the onboarding copy', kind: 'sync', open: 'synced · ticks in Linear too', done: 'done here and in Linear', startsDone: false },
    ],
  },
];

/** What the hero's Mac shows around the popover. */
export const heroDesk = {
  app: 'Terminal',
  menus: ['Shell', 'Edit', 'View', 'Window', 'Help'],
  terminal: ['~/api-server % npm run migrate:prod', '✓ 3 migrations applied', '~/api-server % ▍'],
  fullView: 'Full View',
  recently: 'Recently done',
  recentlyCount: '5',
  pause: 'Pause',
};

export const zigzag = {
  eyebrow: 'THE ZIGZAG',
  title: 'Out of sight, out of mind. Then it breaks.',
  lead: "You jump between chats, dashboards, inboxes and tabs all day. The step you didn't finish doesn't wave at you. It just scrolls away.",
  steps: [
    { title: 'You get a checklist.', body: 'Claude gives you four steps to ship to production. Or Sarah writes: "Don\'t forget to email Mike."' },
    { title: 'Something pulls you away.', body: 'You finish step three. A ping, a new prompt, the next email. You move on.' },
    { title: 'Step four is gone.', body: 'Production breaks. Mike never got the email. Didja would have asked.' },
  ],
};

export const how = {
  eyebrow: 'HOW IT WORKS',
  title: 'Catch. Watch. Tick.',
  lead: 'No setup, no integrations to connect. Install it and it works in every app you already use.',
  steps: [
    {
      title: 'Catch',
      body: 'Didja spots checklists, setup steps and "don\'t forget" lines as they appear, and turns each one into an open loop.',
      shot: '[SCREENSHOT: Claude reply with a numbered list → items appear in the Didja menu]',
      shotLabel: 'Placeholder for a screenshot of a checklist being captured',
    },
    {
      title: 'Watch',
      body: 'As you work, it looks for proof each step is done: the right variable on the right page, the email actually sent.',
      shot: '[SCREENSHOT: env var page showing STRIPE_KEY → task ticks with evidence]',
      shotLabel: 'Placeholder for a screenshot of a task being matched',
    },
    {
      title: 'Tick — or ask',
      body: 'Sure? It ticks it off. Not sure? It asks. A step left hanging gets a gentle nudge, not a siren.',
      shot: '[SCREENSHOT: "Looks done — confirm?" and a nudge for a step left behind]',
      shotLabel: 'Placeholder for a screenshot of the confirm prompt',
    },
  ],
  appsLead: 'Works wherever you work:',
  apps: ['Claude', 'Claude Code', 'Terminal', 'Gmail', 'Outlook', 'Slack', 'Linear', 'Jira', 'Notion', 'Any browser tab'],
};

export const demo = {
  eyebrow: 'SEE IT',
  title: '30 seconds of zigzag, zero loose ends.',
  pause: 'Pause',
  play: 'Play',
  placeholder: '[DEMO PLACEHOLDER — 30s looping video]',
  storyboard: 'Storyboard: checklist arrives → user zigzags away → Didja catches it → three steps tick themselves → step four gets a nudge.',
};

export const privacy = {
  eyebrow: 'PRIVACY',
  title: 'It watches your screen. So it never leaves your Mac.',
  lead: "Trust is the product. Every line of Didja is open source, so you don't have to take our word for any of this.",
  readCode: 'Read the code',
  promises: [
    { title: 'On-device only', body: 'Reading, matching and the model all run on your Mac. No account, no cloud.' },
    { title: 'Text, never pixels', body: 'It keeps short text snippets. No screenshots or video are stored.' },
    { title: 'Forgets in 24 hours', body: 'Captured text auto-deletes within a day. Your task list stays, with a few lines beside each open task until it is done.' },
    { title: 'Skips the sensitive stuff', body: 'Password and card fields, password managers, private windows, and well-known banking, payment and patient-portal sites are never read. Edit the list any time.' },
    { title: 'Pause anytime', body: 'One click or a hotkey stops it until you say go.' },
    { title: 'Open source', body: 'Audit it, fork it, build it yourself.' },
  ],
};

export const faq = {
  title: 'Questions',
  items: [
    { q: 'Is Didja free?', a: 'Yes. Didja is free and open source.' },
    { q: 'Does anything leave my Mac?', a: "Nothing from your screen. Reading, matching and the language model run on your Mac: Apple's on-device model, or a model you run yourself in Ollama if you turn that on. Didja makes one request of its own, a daily check for updates that carries only its version (you can turn it off). It talks to a task tool only if you connect one, and then only about that tool's own items. And if you let your own Claude read Didja, to help fix how it reads an app, what Claude reads (masked) goes to your AI provider, as anything you show Claude does." },
    { q: 'Why does it need Accessibility and Screen Recording permission?', a: 'Accessibility lets it read the text of the window you are working in. Screen Recording is only a fallback for apps that hide their text, and frames are read and dropped immediately.' },
    { q: 'How much CPU and memory does it use?', a: 'Measured on an Apple M5 Pro during ordinary work, with a development build: the app about 14% of one core and 93 MB of memory, the engine under 1% and about 250 MB. Its database grows about 11 MB an hour and levels off after a day, because captured text is deleted after 24 hours. The script, the full table and how to measure your own Mac are in docs/PERFORMANCE.md in the repository.' },
    { q: 'Windows?', a: 'Mac first. Windows is on the roadmap.' },
  ],
};

export const cta = {
  title: 'Well… didja?',
  lead: 'Download Didja free and stop losing the last step.',
  download: 'Download for Mac (.dmg)',
  source: 'View source',
  /** "{version}" is filled from the GitHub Releases API at build time, else stays [VERSION]. */
  fine: 'Signed & notarized by Apple · v{version} ·',
  notes: 'Release notes',
};

export const footer = {
  name: 'didja',
  domain: 'didja.dev',
  license: 'MIT licensed',
  github: 'GitHub',
  privacy: 'Privacy',
  changelog: 'Changelog',
  email: 'hello@didja.dev',
};

export const meta = {
  title: 'Didja — one forgotten step, remembered',
  description: "Ten tabs, four Claude sessions, one forgotten step. Didja remembers the steps you didn't finish, and ticks them off when you do.",
};

/**
 * The real thing, under the drawn story: a recording of Didja on the maintainer's Mac (2026-11-12),
 * in a made-up repo (acme-notes) with Didja on an empty list, reviewed frame by frame before it
 * was added (CLAUDE.md, "Personal content").
 */
export const real = {
  eyebrow: 'FOR REAL',
  title: 'Recorded on a Mac, not drawn.',
  lead: 'Ask Claude, run the steps in Terminal, and watch Didja tick them off in the menu bar. In real time, not sped up.',
  label: 'Recording: Claude answers a git question, the steps run in Terminal, and Didja ticks two of them in its menu bar list.',
};

/**
 * The demo: a scroll-driven story on a Mac (in place of the placeholder video,
 * 2026-11-12): Claude gives the steps to make didja.dev public, you do them in Terminal,
 * GitHub and Cloudflare, Didja ticks each with what it saw, asks about one, and nudges about the last.
 * Everything in it is made up except Didja's own names (didja.dev, didja-dev/didja).
 */
export const story = {
  conversation: 'Make didja.dev public',
  ask: "Let's open-source Didja: make the repo public and put didja.dev on Cloudflare Pages.",
  intro: "Here's the plan. Five steps, about ten minutes:",
  steps: [
    { title: 'Push `main` to `didja-dev/didja`', short: 'Push main to didja-dev/didja', evidence: 'seen in Terminal' },
    { title: 'Set the repo to **Public** (Settings › Danger Zone)', short: 'Set the repo to Public', evidence: 'seen on github.com' },
    { title: 'Connect `didja-dev/didja` in Cloudflare Pages', short: 'Connect the repo in Cloudflare Pages', evidence: 'seen on dash.cloudflare.com' },
    { title: 'Add the custom domain `didja.dev`', short: 'Add the custom domain didja.dev', evidence: 'looks done: Active on dash.cloudflare.com' },
    { title: 'Upload the social preview (`og.png`)', short: 'Upload the social preview', evidence: '' },
  ],
  outro: "Tell me when you're done and I'll check the deploy.",
  scenes: [
    { n: '01', title: 'Claude gives you five steps.', body: 'Didja catches them the moment they appear: five open loops in the menu bar.' },
    { n: '02', title: 'You push. Didja sees it in Terminal.', body: 'The push finishes, and step one ticks itself, with what it saw.' },
    { n: '03', title: 'You flip the repo to Public.', body: 'GitHub says so on the settings page. Step two, done.' },
    { n: '04', title: 'Not sure? It asks.', body: 'The domain shows Active in Cloudflare. Didja asks before it ticks it.' },
    { n: '05', title: 'A ping pulls you away. Didja doesn\'t forget.', body: 'Step five is still open. A gentle nudge, not a siren.' },
  ],
  ping: { from: 'Noa', text: 'Lunch in 10? 🍜' },
  nudge: { title: 'Didja finish that?', body: 'Upload the social preview: 1 step left from “Make didja.dev public”.' },
};

/**
 * Full View: the big window, drawn in the real one's shape (components/FullView.astro), with the
 * same made-up work as the hero and the detail pane open on the step left behind.
 */
export const fullView = {
  eyebrow: 'FULL VIEW',
  title: 'Everything it caught, and why.',
  lead: 'Open Full View for every loop by where it came from, what would tick each one, and the way back to where you saw it. Settings, connections and privacy live here too, all of it from the keyboard.',
  label: "Didja's Full View window: a sidebar of tasks, sources and settings; the pending list grouped by source; and the details of one step, with what would tick it.",
  filters: [
    { name: 'Pending', count: '6', on: true },
    { name: 'Snoozed', count: '1' },
    { name: 'Done', count: '23' },
    { name: 'Dismissed', count: '2' },
  ],
  sources: [
    { name: 'Everything', on: true },
    { name: 'Claude Code — api-server', count: '2' },
    { name: 'Gmail — Sarah Cohen', count: '1' },
    { name: 'Slack — #launch', count: '1' },
    { name: 'Linear — ACME-212', count: '1' },
    { name: 'Claude — Pricing page copy', count: '1' },
  ],
  settings: ['General', 'Connections', 'Your Names', 'How It Decides', 'Exclude List', 'Privacy'],
  status: 'Capturing · on this Mac only',
  groups: [
    {
      source: 'Claude Code — api-server',
      title: 'Ship auth to production',
      progress: '3/4 · 9:20',
      items: [
        { title: 'Set STRIPE_KEY in Vercel → Production', meta: '✓ seen on vercel.com', tone: 'seen', done: true },
        { title: 'Run the prod migration', meta: '✓ seen in Terminal', tone: 'seen', done: true },
        { title: 'Add the redirect URL in Supabase Auth', meta: '✓ seen on supabase.com', tone: 'seen', done: true },
        { title: 'Tag v1.4.0 and push it', meta: 'scrolled away 2h ago', tone: 'nudge', selected: true },
      ],
    },
    { source: 'Gmail — Sarah Cohen', items: [{ title: 'Email Mike the signed contract', meta: 'from “don’t forget…”', when: '40 min ago' }] },
    { source: 'Slack — #launch', items: [{ title: 'Answer Dana: does Tuesday work?', meta: 'asked you', tone: 'nudge', when: '3h ago' }] },
    { source: 'Linear — ACME-212', items: [{ title: 'Review the onboarding copy', meta: '⇄ synced · ticks in Linear too', when: 'yesterday' }] },
  ],
  detail: {
    parent: 'Ship auth to production',
    title: 'Tag v1.4.0 and push it',
    source: 'Claude Code — api-server',
    progress: '3 of 4 steps done',
    whyTitle: 'Why it is open',
    why: 'Ticked when all of these have been seen:\n  [ ] git tag v1.4.0\n      (typed at a terminal prompt)\n  [ ] git push origin v1.4.0\n      (typed at a terminal prompt)\nSeen so far: nothing yet.',
    notAction: 'Not an action: never was for me to do',
  },
  hints: '↑↓ move · Space tick · R rename · ⌘C copy · S snooze · D dismiss · W why · V how it looked · X Didja missed it · F search · 1–4 switch view · ⌘1–9 open a canvas · O Quick View · Esc close',
};
