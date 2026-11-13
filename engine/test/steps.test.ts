import { expect, test } from 'bun:test';
import { extractChecklists, extractCommands } from '../src/extract.ts';
import { normalizeSteps, stepTarget } from '../src/steps.ts';

// SCR-84: steps in any format are read as numbered lists are. Made-up replies only.
const titles = (text: string, chat = true) =>
  extractChecklists(normalizeSteps(text, { chat })).flatMap((l) => l.items.map((i) => i.title));

test('"Step 1 — …" headings are steps, and their paragraphs stay context', () => {
  const text = ['Here is how to add sign-in:', 'Step 1 — Create the OAuth client', 'In the console, pick Web application.',
    'Step 2 — Add the redirect URI', 'Add https://acme.example.com/callback under Authorized redirect URIs.'].join('\n');
  expect(titles(text)).toEqual(['Create the OAuth client', 'Add the redirect URI']);
});

test('"### 2. …" numbered headings are steps', () => {
  const text = ['To deploy:', '### 1. Set DATABASE_URL in Vercel', 'Use the pooled string.', '### 2. Run the migration', 'It takes a minute.'].join('\n');
  expect(titles(text)).toEqual(['Set DATABASE_URL in Vercel', 'Run the migration']);
});

test('bullets under a "Next steps" or "You\'ll need to:" heading are steps; sub-bullets are details', () => {
  expect(titles(['Next steps:', '- Create a project in Sentry', '- Set SENTRY_DSN in Vercel'].join('\n'))).toEqual(['Create a project in Sentry', 'Set SENTRY_DSN in Vercel']);
  expect(titles(['### Steps', '- Register the app in Azure', '  - pick single tenant', '- Copy the tenant ID'].join('\n')))
    .toEqual(['Register the app in Azure', 'Copy the tenant ID']);
});

test('bullets anywhere else are not steps: a closing "If you want, I can:" offer, or a list of notes', () => {
  expect(titles(['1. Add the DKIM record to your DNS', '2. Set RESEND_API_KEY in Vercel', 'If you want, I can:', '- write the tests', '- add a retry'].join('\n')))
    .toEqual(['Add the DKIM record to your DNS', 'Set RESEND_API_KEY in Vercel']);
  expect(titles(['Things to know:', '- Vercel builds on push', '- Tokens expire after an hour'].join('\n'))).toEqual([]);
});

test('boxes an app draws as glyphs are a checklist in a chat, and a ticked one is skipped', () => {
  expect(titles(['Checklist:', '☐ Add the A record at your registrar', '☑ Buy the domain', '☐ Add the domain in Vercel'].join('\n')))
    .toEqual(['Add the A record at your registrar', 'Add the domain in Vercel']);
  // In a terminal, glyph boxes are an agent's own todo list: left alone.
  expect(normalizeSteps('☐ Add tests', { chat: false })).toBe('☐ Add tests');
});

test('a table of what to set where is a list, one step per row, without its header', () => {
  const text = ['Here are the variables you need:', '| Variable | Where |', '|---|---|', '| DATABASE_URL | Vercel |', '| STRIPE_SECRET_KEY | Vercel |'].join('\n');
  expect(titles(text)).toEqual(['DATABASE_URL — Vercel', 'STRIPE_SECRET_KEY — Vercel']);
});

test('a command in a code block ("bash", "Copy code", the command) is handed over as a command', () => {
  const text = normalizeSteps(['Apply it by running this in your project:', 'bash', 'Copy code', 'npx prisma migrate deploy', 'Then reload.'].join('\n'), { chat: true });
  expect(text).toContain('`npx prisma migrate deploy`');
  expect(extractCommands(text).flatMap((l) => l.items.map((i) => i.title))).toEqual([expect.stringContaining('`npx prisma migrate deploy`')]);
});

test('a step that names its target is a step without a known verb; a note with no target is not', () => {
  expect(stepTarget('Forward events — `stripe listen`')).toBe('stripe listen');
  expect(stepTarget('STRIPE_KEY for production')).toBe('STRIPE_KEY');
  expect(stepTarget('Authentication › URL Configuration')).toBe('Authentication › URL Configuration');
  expect(stepTarget('The callback path /auth/google/callback')).toBe('/auth/google/callback');
  expect(stepTarget('The token line is no longer needed.')).toBe(null);
  expect(stepTarget('Access tokens expire after an hour')).toBe(null);
  expect(titles(['On your side:', '1. Forward events — `stripe listen --forward-to localhost:3000`', '2. Log in — `stripe login`'].join('\n')))
    .toEqual(['Forward events — `stripe listen --forward-to localhost:3000`', 'Log in — `stripe login`']);
});

test('one step is a list when its lead-in hands it to you; one step with an unclear lead-in is not', () => {
  expect(titles(['The only thing left for you:', '1. Add NEXT_PUBLIC_SITE_URL in Vercel'].join('\n'))).toEqual(['Add NEXT_PUBLIC_SITE_URL in Vercel']);
  expect(titles(['Notes:', '1. Add NEXT_PUBLIC_SITE_URL in Vercel'].join('\n'))).toEqual([]);
  expect(titles(["Here's what I changed:", '1. Added NEXT_PUBLIC_SITE_URL to the config'].join('\n'))).toEqual([]);
});

test('"Here\'s what I changed" and "What this does" lists stay Claude\'s, in any shape', () => {
  const changed = extractChecklists(normalizeSteps(["Here's what I changed:", '### 1. Moved the fetch into useOrders()', '### 2. Typed the rows'].join('\n'), { chat: true }), { includeAssistant: true });
  expect(changed.every((l) => l.actor === 'assistant')).toBe(true);
  expect(titles(['What this does:', '1. Reads the cart', '2. Returns the total in cents'].join('\n'))).toEqual([]);
});

test('text with none of these shapes is unchanged', () => {
  const text = ['⟦Message 2⟧', 'Claude responded: Two steps:', '1. Set STRIPE_KEY in Vercel', '2. Run `bun run migrate`'].join('\n');
  expect(normalizeSteps(text, { chat: true })).toBe(text);
});
