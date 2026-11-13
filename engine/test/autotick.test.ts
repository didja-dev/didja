/**
 * SCR-74: "looks done" ticked without asking only where Didja is sure: two signs on the same screen,
 * or a place where you said yes often enough. Every path that must not tick has a test here
 * (CLAUDE.md: a wrong tick is the bug this app exists to prevent). All content is made up.
 */
import { expect, test } from 'bun:test';
import { pollOnce } from '../src/engine.ts';
import type { Looker } from '../src/looksdone.ts';
import { siteOfPlace, Store, TRUST_YES, trustKey } from '../src/store.ts';
import type { Observation } from '../src/store.ts';

const NOW = new Date('2026-11-11T11:00:00Z');
const at = (minutes: number) => new Date(Date.parse('2026-11-11T10:00:00Z') + minutes * 60_000).toISOString();
function observe(store: Store, over: Partial<Omit<Observation, 'id'>>): number {
  return store.insertObservation({ ts: at(0), bundleId: 'com.google.Chrome', app: 'Google Chrome', windowTitle: 'x', url: null, source: 'ax', text: '', ...over });
}
function looker(answer: 'done' | 'notDone' | 'unsure' = 'done') {
  const asked: Parameters<Looker>[0][] = [];
  const look: Looker = (input) => { asked.push(input); return answer; };
  return { look, asked };
}
/** A store on the default mode (Tick When Didja Is Sure), with a task that has nothing exact to look for. */
function setup(title: string, mode: 'ask' | 'sure' | 'accept' = 'sure') {
  const store = new Store(':memory:');
  store.setMeta('looks_done', mode);
  store.setMeta('looks_done_sure_once', 'yes');
  const obs = observe(store, { bundleId: 'com.tinyspeck.slackmacgap', app: 'Slack', windowTitle: 'Noa', text: `Noa: can you ${title.toLowerCase()} today?` });
  const id = store.upsertTask({ title, sourceKind: 'chat', sourceRef: 'Slack', confidence: 1, position: null, ts: at(0), observationId: obs, markers: [], criteria: null }).id;
  return { store, id };
}
/** A screen that names the task's site, with no second sign: the model alone would say done. */
const pricing = (store: Store, minute = 20) => observe(store, { windowTitle: 'Pricing', url: 'https://acme.example.com/pricing', ts: at(minute),
  text: 'Pricing\nStarter $9\nTeam $29\nUpdated just now' });
const PLACE = 'Google Chrome — acme.example.com/pricing';
const TITLE = 'Update the pricing page on acme.example.com';
/** A second sign: a box ticked that names the task. */
const box = (store: Store) => observe(store, { windowTitle: 'Team checklist', url: 'https://notes.example.net/p/weekly', ts: at(20),
  text: 'Weekly checklist\n[x] Approve 4410\n[ ] Book the venue' });

test('the trust key is the site or app, the source kind and the first verb', () => {
  expect(siteOfPlace('Google Chrome — www.Vercel.com/acme/settings')).toBe('vercel.com');
  expect(siteOfPlace('Mail — Sent')).toBe('mail');
  expect(siteOfPlace('Terminal')).toBe('terminal');
  expect(trustKey('Google Chrome — vercel.com/acme', 'claude-desktop', 'Set STRIPE_KEY in Vercel')).toBe('vercel.com · claude-desktop · set');
});

test('a second sign on the same screen and the model\'s "done": ticked, labelled, and counted as Didja\'s', () => {
  const { store, id } = setup('Approve 4410');
  box(store);
  const { look, asked } = looker('done');
  pollOnce(store, NOW, { looker: look });
  expect(asked.length).toBe(1);
  const task = store.getTask(id)!;
  expect(task.status).toBe('done');
  expect(task.acceptedFrom).toBe('Google Chrome — notes.example.net/p/weekly');
  expect(store.lastOutcome(id)).toBe('ticked-sure');
  expect(store.listEvidence(id).some((e) => (e.detail ?? '').startsWith('Ticked for you: it looked done in'))).toBe(true);
  store.close();
});

test('the same two signs with Ask Me only ask', () => {
  const { store, id } = setup('Approve 4410', 'ask');
  box(store);
  pollOnce(store, NOW, { looker: looker('done').look });
  expect(store.getTask(id)!.status).toBe('open');
  expect(store.getTask(id)!.suggestion).toBe('Google Chrome — notes.example.net/p/weekly');
  store.close();
});

test('a second sign but the model does not see it done: no tick, no question', () => {
  for (const answer of ['notDone', 'unsure'] as const) {
    const { store, id } = setup('Approve 4410');
    box(store);
    pollOnce(store, NOW, { looker: looker(answer).look });
    expect(store.getTask(id)!.status).toBe('open');
    expect(store.getTask(id)!.suggestion).toBeNull();
    store.close();
  }
});

test('the model alone, with no second sign and no trust, only asks', () => {
  const { store, id } = setup(TITLE);
  pricing(store);
  const { look, asked } = looker('done');
  pollOnce(store, NOW, { looker: look });
  expect(asked.length).toBe(1);
  expect(store.getTask(id)!.status).toBe('open');
  expect(store.getTask(id)!.suggestion).toBe(PLACE);
  store.close();
});

test('one yes is not enough; five are, for that site, kind and verb only', () => {
  const key = trustKey(PLACE, 'chat', TITLE);
  {
    const { store, id } = setup(TITLE);
    store.recordTrust(key, 'yes', new Date(at(1)));
    pricing(store);
    pollOnce(store, NOW, { looker: looker().look });
    expect(store.getTask(id)!.status).toBe('open');
    store.close();
  }
  {
    const { store, id } = setup(TITLE);
    for (let i = 0; i < TRUST_YES; i++) store.recordTrust(key, 'yes', new Date(at(1)));
    // Trust in another verb or site does not count here.
    for (let i = 0; i < TRUST_YES; i++) store.recordTrust(trustKey(PLACE, 'chat', 'Remove the old plan'), 'yes', new Date(at(1)));
    pricing(store);
    pollOnce(store, NOW, { looker: looker().look });
    expect(store.getTask(id)!.status).toBe('done');
    expect(store.lastOutcome(id)).toBe('ticked-sure');
    store.close();
  }
});

test('a "not yet" there blocks it until five more yes; answers older than 30 days do not count', () => {
  const key = trustKey(PLACE, 'chat', TITLE);
  const { store } = setup(TITLE);
  for (let i = 0; i < TRUST_YES; i++) store.recordTrust(key, 'yes', new Date(at(1)));
  store.recordTrust(key, 'no', new Date(at(2)));
  expect(store.isTrusted(key, NOW)).toBe(false);
  for (let i = 0; i < TRUST_YES - 1; i++) store.recordTrust(key, 'yes', new Date(at(3)));
  expect(store.isTrusted(key, NOW)).toBe(false);
  store.recordTrust(key, 'yes', new Date(at(3)));
  expect(store.isTrusted(key, NOW)).toBe(true);
  expect(store.isTrusted(key, new Date(NOW.getTime() + 31 * 86_400_000))).toBe(false);
  store.close();
});

test('your answers earn trust: yes on "looks done?" counts, "not yet" resets it', () => {
  const { store, id } = setup(TITLE, 'ask');
  const key = trustKey(PLACE, 'chat', TITLE);
  pricing(store);
  pollOnce(store, NOW, { looker: looker().look });
  expect(store.getTask(id)!.suggestion).toBe(PLACE);
  store.rejectSuggestion(id, NOW);
  expect(store.lastOutcome(id)).toBe('not-yet');
  for (const thing of ['logo', 'footer', 'banner', 'FAQ', 'plans'].slice(0, TRUST_YES)) {
    const other = store.upsertTask({ title: `Update the ${thing}`, sourceKind: 'chat', sourceRef: 'Slack', confidence: 1, position: null, ts: at(0), observationId: null, markers: [], criteria: null }).id;
    store.suggestDone(other, PLACE, null, NOW);
    store.changeByYou(other, 'done', NOW);
  }
  expect(store.isTrusted(key, NOW)).toBe(true);
  store.close();
});

test('a tick reopened by you demotes the place: the next one there only asks', () => {
  const key = trustKey(PLACE, 'chat', TITLE);
  const { store, id } = setup(TITLE);
  for (let i = 0; i < TRUST_YES; i++) store.recordTrust(key, 'yes', new Date(at(1)));
  pricing(store);
  pollOnce(store, NOW, { looker: looker().look });
  expect(store.getTask(id)!.status).toBe('done');
  // Undo: reopened in the row ("not done").
  expect(store.notDone(id, NOW)).toBe(true);
  expect(store.getTask(id)!.status).toBe('open');
  expect(store.isTrusted(key, NOW)).toBe(false);
  // The same kind of task, seen done at the same site: asked, not ticked.
  const again = store.upsertTask({ title: 'Update the pricing table on acme.example.com', sourceKind: 'chat', sourceRef: 'Slack', confidence: 1, position: null, ts: at(25), observationId: null, markers: [], criteria: null }).id;
  expect(again).not.toBe(id);
  pricing(store, 40);
  pollOnce(store, new Date(at(41)), { looker: looker().look });
  expect(store.getTask(again)!.status).toBe('open');
  expect(store.getTask(again)!.suggestion).toBe(PLACE);
  store.close();
});

test('a step with something exact to look for is never ticked by "looks done", however sure', () => {
  const { store } = setup('Approve 4410');
  const obs = observe(store, { bundleId: 'com.anthropic.claudefordesktop', app: 'Claude', windowTitle: 'Release', ts: at(0),
    text: '⟦Message 2⟧\nClaude responded: On your side:\nOn your side:\n1. Run `git push --tags`\n2. Tell Noa' });
  void obs;
  pollOnce(store, new Date(at(0)));
  const push = store.listTasks().find((t) => t.title.includes('git push'))!;
  for (let i = 0; i < TRUST_YES; i++) store.recordTrust(trustKey('Terminal — zsh', push.sourceKind, push.capturedTitle), 'yes', new Date(at(1)));
  // Typed but not run, three hours later: the model may say done, it still only asks (SCR-69).
  observe(store, { bundleId: 'com.apple.Terminal', app: 'Terminal', windowTitle: 'zsh', ts: at(200), text: 'me@mac acme % git push --tags --dry-run\nEverything up-to-date\nme@mac acme % ' });
  pollOnce(store, new Date(at(201)), { looker: looker().look });
  expect(store.getTask(push.id)!.status).toBe('open');
  store.close();
});

test('existing installs on Ask Me are moved to Tick When Sure once; Accept Automatically is kept; a later Ask Me sticks', () => {
  const moved = new Store(':memory:');
  moved.setMeta('looks_done', 'ask');
  expect(moved.looksDoneMode()).toBe('sure');
  moved.setMeta('looks_done', 'ask');
  expect(moved.looksDoneMode()).toBe('ask');
  moved.close();
  const accepting = new Store(':memory:');
  accepting.setMeta('looks_done', 'accept');
  expect(accepting.looksDoneMode()).toBe('accept');
  accepting.close();
  const fresh = new Store(':memory:');
  expect(fresh.looksDoneMode()).toBe('sure');
  fresh.close();
});
