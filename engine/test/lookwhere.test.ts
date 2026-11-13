import { expect, test } from 'bun:test';
import { pollOnce } from '../src/engine.ts';
import { setLocalModel } from '../src/localmodel.ts';
import { hasToken, lookCandidate, serviceWords, strongTokens } from '../src/looksdone.ts';
import type { Looker } from '../src/looksdone.ts';
import { Store } from '../src/store.ts';
import type { Observation } from '../src/store.ts';

// SCR-66: which screens a task with nothing exact to look for is shown to the model on.
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

test('strong tokens: ids and numbers, PR and order numbers, repositories, quoted names; never a year or an amount', () => {
  expect(strongTokens('Approve purchase order 4410 for USD 1,200.00 by 2026')).toEqual(['4410', '#4410']);
  expect(strongTokens('Merge pull request #42 in acme/widgets')).toEqual(['#42', 'acme/widgets']);
  expect(strongTokens('Rename the board to “Q4 launch”')).toEqual(['q4 launch']);
  expect(strongTokens('Update src/auth.ts and/or the README, run `git push 12345`')).toEqual([]);
  expect(hasToken({ text: 'Purchase order 4410 — Approved', windowTitle: '', url: null }, '4410')).toBe(true);
  expect(hasToken({ text: 'Order 44100', windowTitle: '', url: null }, '4410')).toBe(false);
  expect(hasToken({ text: 'Merged', windowTitle: '', url: 'https://github.com/acme/widgets/pull/42' }, '#42')).toBe(true);
  expect(hasToken({ text: '42 pass', windowTitle: '', url: null }, '#42')).toBe(false);
  expect(serviceWords('Last steps on GitHub, then tell Dana. Thanks!')).toEqual(['github', 'dana']);
});

/** An email task whose kept context is the email's lines. */
function approval(store: Store): number {
  const mail = observe(store, { bundleId: 'com.microsoft.Outlook', app: 'Microsoft Outlook', windowTitle: 'Inbox • me@example.com', ts: at(0),
    text: 'Inbox\n⟦Email⟧\nSubject: PO 4410 needs your approval\nFrom: Dana Levi, dana@acme.com\nHi Mike,\nPlease approve purchase order 4410 for the offsite.\nThanks, Dana' });
  pollOnce(store, new Date(at(0)));
  return store.upsertTask({ title: 'Approve purchase order 4410', sourceKind: 'email', sourceRef: 'Microsoft Outlook', confidence: 1, position: null,
    ts: at(0), observationId: mail, markers: [], criteria: null }).id;
}
const PORTAL = { windowTitle: 'Purchase orders', url: 'https://erp.example.org/po/view', text: 'Purchase order 4410\nOffsite catering\nStatus: Approved' };

test('an approval task with an id is shown the portal screen that has the id, right after you read the email', () => {
  const store = new Store(':memory:');
  const id = approval(store);
  observe(store, { ...PORTAL, ts: at(5) });
  const { look, asked } = looker();
  expect(pollOnce(store, NOW, { looker: look }).suggested).toBe(1);
  expect(asked[0]).toMatchObject({ task: 'Approve purchase order 4410', page: 'Google Chrome — erp.example.org/po/view' });
  expect(asked[0]!.text).toContain('Status: Approved');
  expect(store.getTask(id)!.status).toBe('open'); // asked, never ticked
  store.close();
});

test('the same id on an unrelated site long after you read the email, or a screen sharing one common word, is not shown', () => {
  const store = new Store(':memory:');
  approval(store);
  observe(store, { ...PORTAL, ts: at(40) });
  observe(store, { windowTitle: 'News', url: 'https://news.example.com/today', text: 'City council will approve the new park\nOrder of events', ts: at(6) });
  const { look, asked } = looker();
  expect(pollOnce(store, NOW, { looker: look }).suggested).toBe(0);
  expect(asked).toEqual([]);
  store.close();
});

const GITHUB = { windowTitle: 'General · acme/widgets', url: 'https://github.com/acme/widgets/settings',
  text: 'acme / widgets\nPublic\nDanger Zone\nChange repository visibility\nThis repository is currently public.' };

function publicTask(store: Store, leadIn: string): void {
  observe(store, { bundleId: 'com.anthropic.claudefordesktop', app: 'Claude', windowTitle: 'Open source', ts: at(0),
    text: `⟦Message 2⟧\nClaude responded: Ready.\n${leadIn}\n1. Set the repo to Public\n2. Turn on Discussions` });
  pollOnce(store, new Date(at(0)));
}

test('a GitHub visibility screen is shown for "Set the repo to Public" when the conversation names GitHub', () => {
  const store = new Store(':memory:');
  publicTask(store, 'Last steps on GitHub, on your side:');
  observe(store, { ...GITHUB, ts: at(30) });
  const { look, asked } = looker();
  expect(pollOnce(store, NOW, { looker: look }).suggested).toBe(1);
  expect(asked.map((a) => a.task)).toEqual(['Set the repo to Public']);
  store.close();
});

test('without GitHub named anywhere in the source, the GitHub screen is not where that step is done', () => {
  const store = new Store(':memory:');
  publicTask(store, 'Last steps, on your side:');
  observe(store, { ...GITHUB, ts: at(30) });
  const { look, asked } = looker();
  expect(pollOnce(store, NOW, { looker: look }).suggested).toBe(0);
  expect(asked).toEqual([]);
  store.close();
});

test('the local model gets more looks per pass than Apple\'s', () => {
  for (const [local, budget] of [[false, 2], [true, 6]] as const) {
    const store = new Store(':memory:');
    if (local) setLocalModel(store, 'qwen3.8:latest');
    approval(store);
    // Eight portal screens right after the email, each showing the order.
    for (let i = 0; i < 8; i++) observe(store, { windowTitle: 'Purchase orders', url: `https://erp.example.org/po/${i}`, ts: at(2 + i * 0.1),
      text: `Purchase order 4410\nLine ${i}\nStatus: Pending` });
    const { look, asked } = looker('notDone');
    pollOnce(store, NOW, { looker: look });
    expect(asked.length).toBe(budget);
    expect(asked[0]!.page).toBe('Google Chrome — erp.example.org/po/0'); // the same evidence: the one nearest to reading the email first
    store.close();
  }
});

test('a screen that shows an id from the task ranks above one that only shares its words', () => {
  const src = { title: 'Set the repo to Public', context: 'Last steps on GitHub for acme/widgets:\n1. Set the repo to Public', links: [], lastSeenAt: at(0) };
  const o = (url: string, text: string): Observation => ({ id: 1, ts: at(30), bundleId: 'com.google.Chrome', app: 'Google Chrome', windowTitle: 'Settings', url, source: 'ax', text });
  const withId = lookCandidate(src, o('https://github.com/acme/widgets/settings', 'acme / widgets\nThis repository is currently public.'), false)!;
  const wordsOnly = lookCandidate(src, o('https://github.com/other/thing/settings', 'This repository is currently public.'), false)!;
  expect(withId.score).toBeGreaterThan(wordsOnly.score);
  // Not on GitHub and no id: not a candidate.
  expect(lookCandidate(src, o('https://news.example.com/', 'The repository is public now'), false)).toBeNull();
});
