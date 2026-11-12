import { expect, test } from 'bun:test';
import { formatTasks, formatWhy } from '../src/cli.ts';
import { pollOnce } from '../src/engine.ts';
import { isWhereItIsDone, keywords, placeOf, relevantSnippet } from '../src/looksdone.ts';
import type { Looker } from '../src/looksdone.ts';
import { Store } from '../src/store.ts';
import type { Observation } from '../src/store.ts';

const NOW = new Date('2026-11-10T10:05:00Z');
const LIST = `Claude responded: x
Once the deploy finishes:
1. Check the login flow works
2. Add the redirect URL in Supabase auth settings
3. Run \`supabase db push\``;

function observe(store: Store, over: Partial<Omit<Observation, 'id'>>): number {
  return store.insertObservation({
    ts: '2026-11-10T10:00:00.000Z', bundleId: 'com.anthropic.claudefordesktop', app: 'Claude',
    windowTitle: 'Stripe webhooks', url: null, source: 'ax', text: '', ...over,
  });
}
const SUPABASE = {
  bundleId: 'com.google.Chrome', app: 'Google Chrome', windowTitle: 'URL Configuration | Supabase',
  url: 'https://supabase.com/dashboard/project/abc/auth/url-configuration?tab=1', ts: '2026-11-10T10:02:00.000Z',
};
const SAVED = 'Authentication\nRedirect URLs\nhttps://app.example.com/auth/callback\nSuccessfully saved settings';

function seeded(): Store {
  const store = new Store(':memory:');
  observe(store, { text: LIST });
  pollOnce(store, NOW);
  return store;
}
function fakeLooker(answer: 'done' | 'notDone' | 'unsure' | null) {
  const asked: Parameters<Looker>[0][] = [];
  const looker: Looker = (input) => { asked.push(input); return answer; };
  return { looker, asked };
}

test('keywords are the telling words of a task', () => {
  expect(keywords('Add the redirect URL in Supabase auth settings')).toEqual(['redirect', 'supabase', 'auth', 'settings']);
  expect(keywords('Check the login flow works')).toEqual(['login', 'flow']);
  expect(keywords('Click Done.')).toEqual([]);
});

test('a screen is worth a look only when it has to do with the task', () => {
  const o = { id: 1, source: 'ax' as const, ...SUPABASE, text: `Sidebar\nProjects\n${SAVED}\nFooter` };
  expect(relevantSnippet('Add the redirect URL in Supabase auth settings', o)).toBe(
    'Projects\nAuthentication\nRedirect URLs\nhttps://app.example.com/auth/callback\nSuccessfully saved settings\nFooter');
  expect(relevantSnippet('Rotate the old Stripe key', o)).toBeNull();
  expect(relevantSnippet('Click Done.', o)).toBeNull(); // nothing telling to look for
});

test('placeOf never includes a query string', () => {
  expect(placeOf({ app: 'Google Chrome', windowTitle: 'x', url: SUPABASE.url })).toBe(
    'Google Chrome — supabase.com/dashboard/project/abc/auth/url-configuration');
  expect(placeOf({ app: 'Notes', windowTitle: 'Shopping', url: null })).toBe('Notes — Shopping');
});

test('a task that looks done is suggested, never ticked', () => {
  const store = seeded();
  const { looker, asked } = fakeLooker('done');
  observe(store, { ...SUPABASE, text: SAVED });
  expect(pollOnce(store, NOW, { looker }).suggested).toBe(1);
  const task = store.getTask(2)!;
  expect(task.status).toBe('open');
  expect(task.suggestion).toBe('Google Chrome — supabase.com/dashboard/project/abc/auth/url-configuration');
  expect(asked).toEqual([{ task: 'Add the redirect URL in Supabase auth settings', app: 'Google Chrome', page: task.suggestion!, text: SAVED }]);
  expect(formatTasks(store.listTree(), NOW.getTime())).toContain('looks done? (Google Chrome — supabase.com');
  expect(formatWhy(task, store.listEvidence(2))).toContain('Looks done: seen in Google Chrome');
  // Nothing about the screen itself is kept: only where it was.
  expect(store.listEvidence(2).map((e) => e.detail).join(' ')).not.toContain('Successfully saved');
  store.close();
});

test('confirming ticks it; saying "not yet" keeps it open and stops asking from that place', () => {
  const store = seeded();
  const { looker, asked } = fakeLooker('done');
  observe(store, { ...SUPABASE, text: SAVED });
  pollOnce(store, NOW, { looker });

  expect(store.rejectSuggestion(2, NOW)).toBe(true);
  expect(store.getTask(2)).toMatchObject({ status: 'open', suggestion: null });
  observe(store, { ...SUPABASE, ts: '2026-11-10T10:03:00.000Z', text: `${SAVED}\nSaved again just now` });
  expect(pollOnce(store, NOW, { looker }).suggested).toBe(0);
  expect(asked.length).toBe(1);

  // Seen somewhere else, it may be suggested again; confirming then ticks it and clears the question.
  observe(store, { ...SUPABASE, url: 'https://supabase.com/dashboard/project/abc/auth/providers', ts: '2026-11-10T10:04:00.000Z', text: `Auth settings\nRedirect URL added` });
  expect(pollOnce(store, NOW, { looker }).suggested).toBe(1);
  store.setStatus(2, 'done');
  expect(store.getTask(2)).toMatchObject({ status: 'done', suggestion: null });
  store.close();
});

test('the model is not asked twice about the same screen, nor about tasks that tick themselves', () => {
  const store = seeded();
  const { looker, asked } = fakeLooker('notDone');
  observe(store, { ...SUPABASE, text: SAVED });
  observe(store, { ...SUPABASE, ts: '2026-11-10T10:02:30.000Z', windowTitle: 'Other tab', text: SAVED });
  observe(store, { bundleId: 'com.mitchellh.ghostty', app: 'Ghostty', windowTitle: 'zsh', ts: '2026-11-10T10:02:40.000Z', text: 'supabase db push is what you run to push the supabase migration' });
  pollOnce(store, NOW, { looker });
  pollOnce(store, NOW, { looker });
  expect(asked.length).toBe(1); // same lines for the same task: asked once; task 3 has a command to match and is never asked about
  expect(store.getTask(2)!.suggestion).toBeNull();
  store.close();
});

test('screens in Claude windows, and screens from before the task existed, do not count', () => {
  const store = seeded();
  const { looker, asked } = fakeLooker('done');
  observe(store, { ts: '2026-11-10T10:02:00.000Z', text: 'Claude responded: reminder\nAdd the redirect URL in Supabase auth settings when you can' });
  observe(store, { ...SUPABASE, ts: '2026-11-10T09:59:00.000Z', text: SAVED });
  expect(pollOnce(store, NOW, { looker }).suggested).toBe(0);
  expect(asked).toEqual([]);
  store.close();
});

test('with no model nothing is suggested', () => {
  const store = seeded();
  observe(store, { ...SUPABASE, text: SAVED });
  expect(pollOnce(store, NOW, { looker: () => null }).suggested).toBe(0);
  expect(pollOnce(store, NOW).suggested).toBe(0);
  store.close();
});

test('with "accept automatically" on, a task that looks done is ticked and labelled; by default it is only asked', () => {
  // Default: asked, never ticked.
  let store = seeded();
  observe(store, { ...SUPABASE, text: SAVED });
  pollOnce(store, NOW, { looker: fakeLooker('done').looker });
  expect(store.getTask(2)).toMatchObject({ status: 'open', acceptedFrom: null });
  store.close();

  // On: ticked for you, with where it looked done kept and said in "why".
  store = seeded();
  store.setMeta('looks_done', 'accept');
  observe(store, { ...SUPABASE, text: SAVED });
  expect(pollOnce(store, NOW, { looker: fakeLooker('done').looker }).completed).toBe(1);
  const task = store.getTask(2)!;
  expect(task).toMatchObject({ status: 'done', suggestion: null, acceptedFrom: 'Google Chrome — supabase.com/dashboard/project/abc/auth/url-configuration' });
  expect(formatWhy(task, store.listEvidence(2))).toContain('Ticked for you: it looked done in Google Chrome');
  store.close();
});

test('accepting automatically never ticks what the model was unsure about or said is not done', () => {
  for (const answer of ['notDone', 'unsure', null] as const) {
    const store = seeded();
    store.setMeta('looks_done', 'accept');
    observe(store, { ...SUPABASE, text: SAVED });
    expect(pollOnce(store, NOW, { looker: fakeLooker(answer).looker }).completed).toBe(0);
    expect(store.getTask(2)!.status).toBe('open');
    store.close();
  }
});

test('turning it on takes the suggestions already waiting; reopening one stops it being ticked from there again', () => {
  const store = seeded();
  observe(store, { ...SUPABASE, text: SAVED });
  pollOnce(store, NOW, { looker: fakeLooker('done').looker });
  expect(store.getTask(2)!.suggestion).not.toBeNull();
  store.setMeta('looks_done', 'accept');
  expect(pollOnce(store, NOW).completed).toBe(1);
  expect(store.getTask(2)!.status).toBe('done');

  // You reopen it: it was not done. The same page, seen again, does not tick it.
  store.setStatus(2, 'open', NOW);
  expect(store.getTask(2)).toMatchObject({ status: 'open', acceptedFrom: null });
  observe(store, { ...SUPABASE, ts: '2026-11-10T10:04:00.000Z', text: `${SAVED}\nSaved again` });
  const { looker, asked } = fakeLooker('done');
  expect(pollOnce(store, NOW, { looker }).completed).toBe(0);
  expect(asked).toEqual([]);
  expect(store.getTask(2)!.status).toBe('open');
  expect(store.listEvidence(2).some((e) => e.detail?.startsWith('You reopened it after it was ticked for you'))).toBe(true);
  store.close();
});

test('an email task looks done only where it gets done: the site or app it names, or a page its email linked to', () => {
  const sign = 'Sign the document with Docusign';
  expect(isWhereItIsDone(sign, { app: 'Google Chrome', url: 'https://app.docusign.com/documents/details/abc' })).toBe(true);
  expect(isWhereItIsDone(sign, { app: 'DocuSign', url: null })).toBe(true);
  expect(isWhereItIsDone(sign, { app: 'Linear', url: 'https://linear.app/acme/team/PMO/all' })).toBe(false);
  expect(isWhereItIsDone(sign, { app: 'Microsoft Edge', url: 'https://dashboard.example.net/planner' })).toBe(false);
  // Named nowhere, but the email linked to that site.
  expect(isWhereItIsDone('Approve the purchase request', { app: 'Google Chrome', url: 'https://approvals.acme.com/r/42?x=1' },
    ['https://approvals.acme.com/r/42'])).toBe(true);
  expect(isWhereItIsDone('Approve the purchase request', { app: 'Google Chrome', url: 'https://other.com/r/42' },
    ['https://approvals.acme.com/r/42'])).toBe(false);
});

test('an email task is never asked about from a page that only shares its words', () => {
  const store = new Store(':memory:');
  const { id } = store.upsertTask({ title: 'Sign the document with Docusign', sourceKind: 'email', sourceRef: 'Microsoft Outlook', confidence: 1,
    position: null, ts: '2026-11-10T09:00:00.000Z', observationId: null, markers: [], criteria: null });
  observe(store, { bundleId: 'com.linear', app: 'Linear', windowTitle: 'PMO', url: 'https://linear.app/acme/team/PMO/all',
    ts: '2026-11-10T10:02:00.000Z', text: 'PMO-12 Sign the document with Docusign for the vendor\nDone' });
  const { looker, asked } = fakeLooker('done');
  expect(pollOnce(store, NOW, { looker }).suggested).toBe(0);
  expect(asked).toEqual([]);
  expect(store.getTask(id)!.suggestion).toBeNull();
  store.close();
});

test('a task from Claude too is asked about only where it gets done', () => {
  const store = seeded(); // "Add the redirect URL in Supabase auth settings", from a Claude list
  const { looker, asked } = fakeLooker('done');
  // A Linear issue about the same change: shares the words, is not Supabase.
  observe(store, { bundleId: 'com.linear', app: 'Linear', windowTitle: 'ENG-7', url: 'https://linear.app/acme/issue/ENG-7',
    ts: '2026-11-10T10:02:00.000Z', text: 'ENG-7 Add the redirect URL in Supabase auth settings\nStatus: Done' });
  expect(pollOnce(store, NOW, { looker }).suggested).toBe(0);
  expect(asked).toEqual([]);
  // Supabase itself: asked.
  observe(store, { ...SUPABASE, ts: '2026-11-10T10:03:00.000Z', text: SAVED });
  expect(pollOnce(store, NOW, { looker }).suggested).toBe(1);
  store.close();
});
