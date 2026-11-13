import { expect, test } from 'bun:test';
import { pollOnce } from '../src/engine.ts';
import { extractChecklists } from '../src/extract.ts';
import { doneState, namesTask } from '../src/looksdone.ts';
import { withoutLinkTargets } from '../src/markers.ts';
import { findSightings } from '../src/match.ts';
import type { Looker } from '../src/looksdone.ts';
import { Store } from '../src/store.ts';
import type { Observation, Task } from '../src/store.ts';

// SCR-68: ticked boxes, switches and notices that capture writes are strong evidence for
// "looks done?", never a tick by themselves. All names and data here are made up.
const NOW = new Date('2026-11-11T11:00:00Z');
const at = (minutes: number) => new Date(Date.parse('2026-11-11T10:00:00Z') + minutes * 60_000).toISOString();
function observe(store: Store, over: Partial<Omit<Observation, 'id'>>): number {
  return store.insertObservation({ ts: at(0), bundleId: 'com.google.Chrome', app: 'Google Chrome', windowTitle: 'x', url: null, source: 'ax', text: '', ...over });
}
function looker(answer: 'done' | 'notDone' = 'done') {
  const asked: Parameters<Looker>[0][] = [];
  const look: Looker = (input) => { asked.push(input); return answer; };
  return { look, asked };
}
/** A task with nothing exact to look for, captured from a chat. */
function task(store: Store, title: string): number {
  const obs = observe(store, { bundleId: 'com.tinyspeck.slackmacgap', app: 'Slack', windowTitle: 'Noa', ts: at(0), text: `Noa: can you ${title.toLowerCase()} today?` });
  return store.upsertTask({ title, sourceKind: 'chat', sourceRef: 'Slack', confidence: 1, position: null, ts: at(0), observationId: obs, markers: [], criteria: null }).id;
}

test('a ticked box, a switch on, or a notice names the task; one shared word or a box not ticked does not', () => {
  expect(doneState('Approve 4410', 'Checklist\n[x] Approve 4410\nOther')).toEqual({ kind: 'checked', line: '[x] Approve 4410' });
  expect(doneState('Approve 4410', '- [x] Approve 4410')).toMatchObject({ kind: 'checked' });
  expect(doneState('Turn on dark mode banner', '[on] Dark mode banner')).toMatchObject({ kind: 'checked' });
  expect(doneState('Merge pull request #42', '⟦Notice: Pull request #42 merged⟧')).toMatchObject({ kind: 'checked' });
  expect(doneState('Approve 4410', '[ ] Approve 4410')).toEqual({ kind: 'unchecked', line: '[ ] Approve 4410' });
  expect(doneState('Turn on dark mode banner', '[off] Dark mode banner')).toMatchObject({ kind: 'unchecked' });
  // Shares one word only, or the words are not in a box or notice.
  expect(doneState('Approve purchase order 4410', '[x] Approve')).toEqual({ kind: 'none' });
  expect(doneState('Set the repo to Public', '[on] Public')).toEqual({ kind: 'none' });
  expect(doneState('Approve 4410', 'Approve 4410\nApproved')).toEqual({ kind: 'none' });
  expect(doneState('Merge pull request #42', '⟦Notice: Saved⟧')).toEqual({ kind: 'none' });
  expect(namesTask('Send the invoice to Acme', 'Send invoice to Acme')).toBe(true);
  expect(namesTask('Send the invoice to Acme', 'Invoice template')).toBe(false);
});

test('a "[x] Approve 4410" line makes the task a candidate on any site, and the model is shown it; with Ask Me never a tick', () => {
  const store = new Store(':memory:');
  // With Tick When Sure the box and the model are two signs (SCR-74, autotick.test.ts); Ask Me never ticks.
  store.setMeta('looks_done', 'ask');
  store.setMeta('looks_done_sure_once', 'yes');
  const id = task(store, 'Approve 4410');
  observe(store, { windowTitle: 'Team checklist', url: 'https://notes.example.net/p/weekly', ts: at(20),
    text: 'Weekly checklist\n[x] Approve 4410\n[ ] Book the venue' });
  const { look, asked } = looker();
  expect(pollOnce(store, NOW, { looker: look }).suggested).toBe(1);
  expect(asked[0]!.text).toContain('[x] Approve 4410');
  expect(store.getTask(id)!.status).toBe('open'); // asked, never ticked
  store.close();
});

test('without a model, a ticked box ticks nothing', () => {
  const store = new Store(':memory:');
  const id = task(store, 'Approve 4410');
  observe(store, { windowTitle: 'Team checklist', url: 'https://notes.example.net/p/weekly', ts: at(20), text: '[x] Approve 4410' });
  observe(store, { windowTitle: 'Team checklist', url: 'https://notes.example.net/p/weekly', ts: at(21), text: '⟦Notice: Approve 4410 done⟧' });
  pollOnce(store, NOW);
  expect(store.getTask(id)!.status).toBe('open');
  expect(store.getTask(id)!.suggestion).toBeFalsy();
  store.close();
});

test('the model saying not done leaves the task open with no suggestion', () => {
  const store = new Store(':memory:');
  const id = task(store, 'Approve 4410');
  observe(store, { windowTitle: 'Team checklist', url: 'https://notes.example.net/p/weekly', ts: at(20), text: '[x] Approve 4410' });
  const { look, asked } = looker('notDone');
  expect(pollOnce(store, NOW, { looker: look }).suggested).toBe(0);
  expect(asked.length).toBe(1);
  expect(store.getTask(id)!.status).toBe('open');
  store.close();
});

test('a box that names the task but is not ticked keeps the screen from the model, even where the task is done', () => {
  const store = new Store(':memory:');
  task(store, 'Approve 4410 in the Acme portal');
  observe(store, { windowTitle: 'Acme portal', url: 'https://portal.acme.example/po', ts: at(5), text: 'Purchase orders\n[ ] Approve 4410\nWaiting' });
  const { look, asked } = looker();
  expect(pollOnce(store, NOW, { looker: look }).suggested).toBe(0);
  expect(asked).toEqual([]);
  store.close();
});

test('a list whose items are checkboxes is captured with the same titles as before, without the box', () => {
  const text = 'Claude responded: Two things left for you\n1. [ ] Create the bucket\n2. [x] Upload the file';
  expect(extractChecklists(text)[0]!.items.map((i) => i.title)).toEqual(['Create the bucket', 'Upload the file']);
});

test('a link pointing at a URL marker is not seeing it: only the words on screen tick (no looser ticking)', () => {
  const value = 'https://vercel.com/acme/shop/settings/domains';
  const task = { id: 1, status: 'open', createdAt: at(0), markers: [{ kind: 'url', value }],
    criteria: { service: 'vercel', hosts: ['vercel.com'] } } as unknown as Task;
  const page = (text: string): Observation => ({ id: 2, ts: at(5), bundleId: 'com.google.Chrome', app: 'Google Chrome',
    windowTitle: 'Overview', url: 'https://vercel.com/acme/shop', source: 'ax', text });
  expect(findSightings([task], [page(`Overview\nDomains ⟨${value}⟩`)])).toEqual([]);
  expect(findSightings([task], [page(`Settings\n${value}`)]).length).toBe(1);
  expect(withoutLinkTargets(`Open the docs ⟨https://docs.example.com/a⟩ now`)).toBe('Open the docs now');
});

test('a step whose words are a link is captured without where the link points, and gets no URL marker from it', () => {
  const store = new Store(':memory:');
  observe(store, { bundleId: 'com.anthropic.claudefordesktop', app: 'Claude', windowTitle: 'Launch', ts: at(0),
    text: '⟦Message 2⟧\nClaude responded: Two things left for you:\n1. Open the Vercel dashboard ⟨https://vercel.com/acme/shop⟩\n2. Turn on Analytics' });
  pollOnce(store, new Date(at(0)));
  const titles = store.listTasks().map((t) => t.capturedTitle);
  expect(titles).toContain('Open the Vercel dashboard');
  expect(store.listTasks().flatMap((t) => t.markers).filter((m) => m.kind === 'url')).toEqual([]);
  store.close();
});
