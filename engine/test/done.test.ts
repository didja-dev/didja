/**
 * SCR-86: done by target. A catalogue (profiles/done) of where common steps are done; a step is
 * done when its target is an item of the right list on the right page. Near-misses never count.
 * Made-up pages and steps only.
 */
import { afterEach, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { agoMs, compileService, listedOn, readCatalogue, targetsOf, useCatalogue } from '../src/done.ts';
import type { DoneServiceFile } from '../src/done.ts';
import { pollOnce } from '../src/engine.ts';
import { extractMarkers } from '../src/markers.ts';
import type { Looker } from '../src/looksdone.ts';
import { Store, TRUST_YES, trustKey } from '../src/store.ts';
import type { Observation } from '../src/store.ts';

const DIR = join(import.meta.dir, '..', '..', 'profiles');
const ALL = readCatalogue(join(DIR, 'done'));
const FILES = readdirSync(join(DIR, 'done')).filter((n) => n.endsWith('.json'));

interface DoneFixture {
  about: string;
  step: string;
  page: { url: string; lines: string[] };
  expect: { place: string | null };
}
const FIXTURES = readdirSync(join(DIR, 'fixtures', 'done')).filter((n) => n.endsWith('.json')).sort()
  .map((name) => ({ name, f: JSON.parse(readFileSync(join(DIR, 'fixtures', 'done', name), 'utf8')) as DoneFixture }));

afterEach(() => useCatalogue(null));

test('every catalogue file reads, and every place in it has a fixture that finds a step done there', () => {
  for (const name of FILES) {
    expect(() => compileService(JSON.parse(readFileSync(join(DIR, 'done', name), 'utf8')) as DoneServiceFile)).not.toThrow();
  }
  const found = new Set(FIXTURES.map(({ f }) => f.expect.place).filter(Boolean));
  for (const place of ALL.filter((p) => !p.kinds.has('deployment'))) {
    expect({ place: place.id, fixture: found.has(place.id) }).toEqual({ place: place.id, fixture: true });
  }
  // The places the issue names.
  for (const id of ['vercel-env', 'vercel-domains', 'vercel-deployments', 'netlify-env', 'supabase-url-configuration', 'supabase-providers',
    'supabase-function-secrets', 'google-oauth-redirect-uris', 'stripe-webhooks', 'github-visibility', 'github-actions-secrets', 'cloudflare-dns',
    'lovable-secrets', 'replit-secrets']) {
    expect(ALL.some((p) => p.id === id)).toBe(true);
  }
});

test('there is a near-miss fixture for each kind the issue names', () => {
  const misses = FIXTURES.filter(({ f }) => f.expect.place === null).map(({ name }) => name);
  for (const kind of ['without-key', 'form-unsaved', 'other-environment', 'prefix', 'build-log', 'not-saved', 'name-in-chat']) {
    expect({ kind, fixture: misses.some((n) => n.includes(kind)) }).toEqual({ kind, fixture: true });
  }
});

for (const { name, f } of FIXTURES) {
  test(`done fixture ${name}: ${f.about}`, () => {
    const targets = targetsOf(f.step, extractMarkers(f.step));
    const listed = listedOn(f.step, targets, { url: f.page.url, text: f.page.lines.join('\n') }, ALL, null, f.step);
    expect(listed?.place.id ?? null).toBe(f.expect.place);
    // What it says is the place and the step's own target: never other words from the page.
    if (listed) expect(listed.detail.startsWith(listed.place.name)).toBe(true);
  });
}

test("a step's targets: env names and URLs from its markers, a domain, a repository's visibility, a DNS record, a provider", () => {
  const t = (s: string) => targetsOf(s, extractMarkers(s)).map((x) => `${x.kind}:${x.value}${x.type ? `:${x.type}` : ''}`);
  expect(t('Set RESEND_API_KEY in Vercel')).toEqual(['env:RESEND_API_KEY']);
  expect(t('Add https://acme.example.com/cb to Redirect URLs in Supabase')).toEqual(['url:https://acme.example.com/cb']);
  expect(t('Add app.example.com to the project in Vercel')).toEqual(['domain:app.example.com']);
  expect(t('Make the repository public on GitHub')).toEqual(['visibility:public']);
  expect(t('Add a CNAME record for www in Cloudflare')).toEqual(['dns:www:CNAME']);
  expect(t('Enable the Google provider in Supabase')).toEqual(['provider:Google']);
  expect(t('Update src/auth.ts and README.md')).toEqual([]); // file names are not domains
  expect(t('Tell Noa the fix is live')).toEqual([]);
});

test('"2m ago" and "just now" read as times; anything else does not', () => {
  expect(agoMs('just now')).toBe(0);
  expect(agoMs('2m ago')).toBe(120_000);
  expect(agoMs('45s ago')).toBe(45_000);
  expect(agoMs('1h ago')).toBe(3_600_000);
  expect(agoMs('Updated 3d ago')).toBeNull();
});

test('a page is a place only where the step or its source names the service (SCR-66)', () => {
  const page = { url: 'https://github.com/acme/widgets/settings', text: 'Danger Zone\nThis repository is currently public.' };
  const step = 'Set the repo to Public';
  const targets = targetsOf(step, []);
  expect(listedOn(step, targets, page, ALL, null, 'Last steps, on your side:')).toBeNull();
  expect(listedOn(step, targets, page, ALL, null, 'Last steps on GitHub, on your side:')?.place.id).toBe('github-visibility');
});

// --- Through the engine ------------------------------------------------------------------------------

const NOW = new Date('2026-11-12T11:00:00Z');
const at = (min: number) => new Date(Date.parse('2026-11-12T10:00:00Z') + min * 60_000).toISOString();
function observe(store: Store, over: Partial<Omit<Observation, 'id'>>): number {
  return store.insertObservation({ ts: at(0), bundleId: 'com.google.Chrome', app: 'Google Chrome', windowTitle: 'x', url: null, source: 'ax', text: '', ...over });
}
const claude = (store: Store, lines: string[], min = 0) =>
  observe(store, { bundleId: 'com.anthropic.claudefordesktop', app: 'Claude', windowTitle: 'Setup', ts: at(min), text: ['⟦Message 2⟧', 'Claude responded: Ready.', ...lines].join('\n') });
const byTitle = (store: Store, words: string) => store.listTasks({ all: true }).find((t) => t.title.includes(words))!;

const GOOGLE_STEP = ['In Google Cloud:', '1. Add https://acme.example.com/api/auth/callback/google to Authorized redirect URIs', '2. Publish the consent screen'];
const GOOGLE_PAGE = { url: 'https://console.cloud.google.com/apis/credentials/oauthclient/000-acme', windowTitle: 'Edit OAuth client – Google Cloud console',
  text: ['Client ID for Web application', 'Authorized redirect URIs', 'URIs 1', 'https://acme.example.com/api/auth/callback/google', 'Save', '⟦Notice: OAuth client saved⟧'].join('\n') };

test('with no model, a target listed in the right place asks "looks done?", never ticks', () => {
  const store = new Store(':memory:');
  claude(store, GOOGLE_STEP);
  pollOnce(store, new Date(at(0)));
  observe(store, { ...GOOGLE_PAGE, ts: at(6) });
  const stats = pollOnce(store, NOW);
  expect(stats.completed).toBe(0);
  const step = byTitle(store, 'redirect URIs');
  expect(step.status).toBe('open');
  expect(step.suggestion).toContain('console.cloud.google.com');
  expect(byTitle(store, 'consent screen').suggestion ?? null).toBeNull();
  store.close();
});

test('the same page without the save, or in a place the source never names, asks nothing', () => {
  const store = new Store(':memory:');
  claude(store, GOOGLE_STEP);
  pollOnce(store, new Date(at(0)));
  observe(store, { ...GOOGLE_PAGE, text: GOOGLE_PAGE.text.replace('⟦Notice: OAuth client saved⟧', '+ Add URI'), ts: at(6) });
  pollOnce(store, NOW);
  expect(byTitle(store, 'redirect URIs').suggestion ?? null).toBeNull();
  store.close();

  const other = new Store(':memory:');
  claude(other, ['Two things:', '1. Add https://acme.example.com/api/auth/callback/google to Authorized redirect URIs', '2. Publish the consent screen']);
  pollOnce(other, new Date(at(0)));
  observe(other, { ...GOOGLE_PAGE, ts: at(6) });
  pollOnce(other, NOW);
  expect(byTitle(other, 'redirect URIs').suggestion ?? null).toBeNull();
  other.close();
});

test('at a place you trust, the target listed there ticks it alone, labelled; with Ask Me it only asks', () => {
  for (const mode of ['sure', 'ask'] as const) {
    const store = new Store(':memory:');
    store.setMeta('looks_done', mode);
    store.setMeta('looks_done_sure_once', 'yes');
    claude(store, GOOGLE_STEP);
    pollOnce(store, new Date(at(0)));
    const step = byTitle(store, 'redirect URIs');
    const key = trustKey('Google Chrome — console.cloud.google.com/apis/credentials/oauthclient/000-acme', step.sourceKind, step.capturedTitle);
    for (let i = 0; i < TRUST_YES; i++) store.recordTrust(key, 'yes', new Date(at(1)));
    observe(store, { ...GOOGLE_PAGE, ts: at(6) });
    pollOnce(store, NOW);
    const after = byTitle(store, 'redirect URIs');
    if (mode === 'sure') {
      expect(after.status).toBe('done');
    } else {
      expect(after.status).toBe('open');
      expect(after.suggestion).toContain('console.cloud.google.com');
    }
    store.close();
  }
});

test('with the model, the target listed there is the second sign: "done" ticks it, sure', () => {
  const store = new Store(':memory:');
  claude(store, GOOGLE_STEP);
  pollOnce(store, new Date(at(0)));
  observe(store, { ...GOOGLE_PAGE, ts: at(6) });
  const asked: Parameters<Looker>[0][] = [];
  const look: Looker = (input) => { asked.push(input); return 'done'; };
  pollOnce(store, NOW, { looker: look });
  expect(asked.map((a) => a.task)).toEqual(['Add https://acme.example.com/api/auth/callback/google to Authorized redirect URIs']);
  expect(byTitle(store, 'redirect URIs').status).toBe('done');
  store.close();
});

// --- Env names on Vercel: the marker counts only as an item of the env list -------------------------

const VERCEL_ENV = 'https://vercel.com/acme/acme-web/settings/environment-variables';
function envTask(store: Store, step = 'Set POSTHOG_KEY in Vercel for Production') {
  claude(store, ['Almost there:', `1. ${step}`, '2. Tell Noa it is live']);
  pollOnce(store, new Date(at(0)));
}

test('the key typed in the Add form, listed for another environment, a longer name, or in a build log never ticks', () => {
  const pages = [
    { url: VERCEL_ENV, text: 'Environment Variables\nAdd Environment Variable\nKey\nPOSTHOG_KEY\nValue\nSave' },
    { url: VERCEL_ENV, text: 'Environment Variables\nPOSTHOG_KEY\nPreview\nAdded just now' },
    { url: VERCEL_ENV, text: 'Environment Variables\nPOSTHOG_KEY_LEGACY\nProduction\nUpdated 3d ago' },
    { url: 'https://vercel.com/acme/acme-web/deployments/000', text: 'Build Logs\nPOSTHOG_KEY is not set\nBuild failed' },
  ];
  for (const page of pages) {
    const store = new Store(':memory:');
    envTask(store);
    observe(store, { ...page, ts: at(5) });
    const stats = pollOnce(store, NOW);
    expect({ page: page.text.split('\n')[1], completed: stats.completed }).toEqual({ page: page.text.split('\n')[1], completed: 0 });
    expect(byTitle(store, 'POSTHOG_KEY').status).toBe('open');
    store.close();
  }
});

test('the key as a row of the env list, with its environment, ticks it and adds a redeploy step once', () => {
  const store = new Store(':memory:');
  envTask(store);
  observe(store, { url: VERCEL_ENV, text: 'Environment Variables\nPOSTHOG_KEY\nProduction, Preview\nAdded just now', ts: at(5) });
  const stats = pollOnce(store, NOW);
  expect(stats.completed).toBe(1);
  expect(byTitle(store, 'POSTHOG_KEY').status).toBe('done');
  const redeploy = store.listTasks().filter((t) => /redeploy/i.test(t.title));
  expect(redeploy.map((t) => t.title)).toEqual(['Redeploy on Vercel so the new value is used']);
  // Seen again: still one.
  observe(store, { url: VERCEL_ENV, text: 'Environment Variables\nPOSTHOG_KEY\nProduction, Preview\nAdded 1m ago', ts: at(6) });
  pollOnce(store, NOW);
  expect(store.listTasks({ all: true }).filter((t) => /redeploy/i.test(t.title)).length).toBe(1);
  store.close();
});

test('no redeploy step is added when the conversation already has one', () => {
  const store = new Store(':memory:');
  claude(store, ['Almost there:', '1. Set POSTHOG_KEY in Vercel', '2. Redeploy the project on Vercel']);
  pollOnce(store, new Date(at(0)));
  observe(store, { url: VERCEL_ENV, text: 'Environment Variables\nPOSTHOG_KEY\nProduction\nAdded just now', ts: at(5) });
  pollOnce(store, NOW);
  expect(store.listTasks({ all: true }).filter((t) => /redeploy/i.test(t.title)).map((t) => t.title)).toEqual(['Redeploy the project on Vercel']);
  store.close();
});

test('the redeploy step asks only once a deployment newer than it is Ready; an older one never', () => {
  const store = new Store(':memory:');
  envTask(store, 'Set POSTHOG_KEY in Vercel');
  observe(store, { url: VERCEL_ENV, text: 'Environment Variables\nPOSTHOG_KEY\nProduction\nAdded just now', ts: at(5) });
  pollOnce(store, new Date(at(5)));
  const deployments = 'https://vercel.com/acme/acme-web/deployments';
  // At minute 8, a deployment 10 minutes old: before the change.
  observe(store, { url: deployments, text: 'Deployments\nacme-web-a1b2\nProduction\nReady\n10m ago\nmain', ts: at(8) });
  pollOnce(store, new Date(at(8)));
  expect(byTitle(store, 'Redeploy').suggestion ?? null).toBeNull();
  // At minute 12, one a minute old: after it.
  observe(store, { url: deployments, text: 'Deployments\nacme-web-c3d4\nProduction\nReady\n1m ago\nmain', ts: at(12) });
  pollOnce(store, new Date(at(12)));
  const redeploy = byTitle(store, 'Redeploy');
  expect(redeploy.status).toBe('open');
  expect(redeploy.suggestion).toContain('vercel.com');
  store.close();
});
