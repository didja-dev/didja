import { expect, test } from 'bun:test';
import { formatWhy } from '../src/cli.ts';
import { cleanCriteria, groundCriteria, inWhere, matchCriteria, phraseOn } from '../src/donecriteria.ts';
import type { CriteriaQuestion, CriteriaWriter, DoneCriteria } from '../src/donecriteria.ts';
import { pollOnce } from '../src/engine.ts';
import type { Looker } from '../src/looksdone.ts';
import { Store } from '../src/store.ts';
import type { Observation } from '../src/store.ts';

// SCR-67: "what done looks like", with fake criteria (made-up content).
const NOW = new Date('2026-11-11T11:00:00Z');
const at = (minutes: number) => new Date(Date.parse('2026-11-11T10:00:00Z') + minutes * 60_000).toISOString();
function observe(store: Store, over: Partial<Omit<Observation, 'id'>>): number {
  return store.insertObservation({ ts: at(0), bundleId: 'com.google.Chrome', app: 'Google Chrome', windowTitle: 'x', url: null, source: 'ax', text: '', ...over });
}
const CRITERIA: DoneCriteria = { where: ['portal.example.org/orders'], success: ['Approved'], pending: ['Awaiting your approval'], tokens: ['4410'] };

/** A task from Claude with nothing exact to look for, whose criteria the fake model writes. */
function seeded(criteria: DoneCriteria | null = CRITERIA) {
  const store = new Store(':memory:');
  observe(store, { bundleId: 'com.anthropic.claudefordesktop', app: 'Claude', windowTitle: 'Catering', ts: at(0),
    text: '⟦Message 2⟧\nClaude responded: Two things for you:\nTwo things for you:\n1. Approve order 4410 for the offsite catering\n2. Tell Dana the menu is final' });
  const asked: CriteriaQuestion[] = [];
  const writer: CriteriaWriter = (q) => { asked.push(q); return q.task.includes('4410') ? criteria : { where: [], success: [], pending: [], tokens: [] }; };
  pollOnce(store, new Date(at(0)), { criteria: writer });
  pollOnce(store, new Date(at(0)), { criteria: writer });
  const task = store.listTasks().find((t) => t.title.includes('4410'))!;
  return { store, task, asked, writer };
}
function looker(answer: 'done' | 'notDone' = 'done') {
  const asked: Parameters<Looker>[0][] = [];
  const look: Looker = (input) => { asked.push(input); return answer; };
  return { look, asked };
}
const portal = (text: string, url = 'https://portal.example.org/orders/view') => ({ windowTitle: 'Orders', url, text, ts: at(30) });

test('each new task is asked once, with its list, and what the model wrote is kept and shown in why', () => {
  const { store, task, asked } = seeded();
  expect(asked.map((q) => q.task).sort()).toEqual(['Approve order 4410 for the offsite catering', 'Tell Dana the menu is final']);
  const q = asked.find((x) => x.task.includes('4410'))!;
  expect(q).toMatchObject({ leadIn: 'Two things for you', neighbours: ['Tell Dana the menu is final'], source: 'Claude — Catering' });
  expect(q.context.join('\n')).toContain('Approve order 4410');
  // The path part "orders" was never shown to the model: only the site is kept.
  expect(store.modelCriteria(task.id)).toEqual({ ...CRITERIA, where: ['portal.example.org'] });
  // Asked once: a nothing answer is kept as nothing, not asked again.
  const other = store.listTasks().find((t) => t.title.startsWith('Tell'))!;
  expect(store.modelCriteria(other.id)).toBeNull();
  expect(store.tasksAwaitingCriteria(5)).toEqual([]);
  expect(formatWhy(task, store.listEvidence(task.id), store.modelCriteria(task.id)))
    .toContain('Didja is looking for: a screen in portal.example.org, showing “Approved”, with 4410, not while it shows “Awaiting your approval”.');
  store.close();
});

test('its place, its id and a done phrase: shown to the looks-done model, and a suggestion, never a tick', () => {
  const { store, task } = seeded();
  observe(store, portal('Order 4410\nOffsite catering\nStatus: Approved'));
  const { look, asked } = looker();
  expect(pollOnce(store, NOW, { looker: look }).suggested).toBe(1);
  expect(asked[0]!.text).toContain('Status: Approved');
  const after = store.getTask(task.id)!;
  expect(after.status).toBe('open');
  expect(after.suggestion).toBe('Google Chrome — portal.example.org/orders/view');
  store.close();
});

test('a "not yet" phrase on the screen vetoes it, even with the id and a done phrase', () => {
  const { store } = seeded();
  observe(store, portal('Order 4410\nAwaiting your approval\nApproved by Sam: 2 of 3'));
  const { look, asked } = looker();
  expect(pollOnce(store, NOW, { looker: look }).suggested).toBe(0);
  expect(asked).toEqual([]);
  store.close();
});

test('its place without the id it needs is not shown, though the old rules would have', () => {
  const { store } = seeded();
  observe(store, portal('Order 5521 for the offsite catering\nStatus: Approved'));
  const { look, asked } = looker();
  expect(pollOnce(store, NOW, { looker: look }).suggested).toBe(0);
  expect(asked).toEqual([]);
  store.close();
});

test('with no model nothing is written, and the task is asked about once one is there', () => {
  const store = new Store(':memory:');
  observe(store, { bundleId: 'com.anthropic.claudefordesktop', app: 'Claude', windowTitle: 'Catering', ts: at(0),
    text: '⟦Message 2⟧\nClaude responded: For you:\nFor you:\n1. Approve order 4410\n2. Tell Dana the menu is final' });
  pollOnce(store, new Date(at(0)), { criteria: () => null });
  expect(store.tasksAwaitingCriteria(5).length).toBe(2);
  store.close();
});

test('criteria are cleaned, kept to what the model was shown, and forgotten when the task is finished', () => {
  expect(cleanCriteria({ where: ['GitHub', 7], success: ['"Approved."', 'Approve', 'none', 'x'], pending: ['Approve'], tokens: ['4410', '4410'] }))
    .toEqual({ where: ['GitHub'], success: ['Approved'], pending: ['Approve'], tokens: ['4410'] });
  const q: CriteriaQuestion = { task: 'Set the repo to Public', leadIn: 'Last steps on GitHub', neighbours: [], source: 'Claude — Open source', context: [], links: [] };
  // Copied from the instructions' examples: the repository and a "main" never in the question.
  expect(groundCriteria({ where: ['github.com/acme/widgets/settings', 'Terminal'], success: ['Public'], pending: [], tokens: ['main', 'public'] }, q))
    .toEqual({ where: ['github.com', 'Terminal'], success: ['Public'], pending: [], tokens: [] });
  // Ids only, and only from the step or the lines around it: not a plain word, not the conversation's name.
  const kept = { ...q, task: 'Close ENG-412 and order 4410', source: 'Claude — Q4', context: ['Set RESEND_API_KEY in acme/web'] };
  expect(groundCriteria({ where: [], success: [], pending: [], tokens: ['ENG-412', '4410', 'RESEND_API_KEY', 'acme/web', 'Q4', 'Claude', 'order'] }, kept).tokens)
    .toEqual(['ENG-412', '4410', 'RESEND_API_KEY', 'acme/web']);

  const { store, task } = seeded();
  store.setStatus(task.id, 'done', NOW);
  store.pruneContext();
  expect(store.modelCriteria(task.id)).toBeNull();
  store.close();
});

test('phrases are words, places are apps or the site and path given', () => {
  expect(phraseOn('Status: Approved', 'Approve')).toBe(false);
  expect(phraseOn('main -> main', 'main -> main')).toBe(true);
  expect(phraseOn('Visibility:   Public', 'Visibility: Public')).toBe(true);
  const c = (where: string[]): DoneCriteria => ({ where, success: [], pending: [], tokens: [] });
  expect(inWhere(c(['github.com/<org>/<repo>/settings']), { app: 'Google Chrome', url: 'https://github.com/acme/widgets/settings' })).toBe(true);
  expect(inWhere(c(['github.com/acme/widgets/settings']), { app: 'Google Chrome', url: 'https://github.com/acme/other' })).toBe(false);
  expect(inWhere(c(['Terminal']), { app: 'Terminal', url: null })).toBe(true);
  expect(inWhere(c(['DocuSign']), { app: 'Google Chrome', url: 'https://app.docusign.com/documents/1' })).toBe(true);
  expect(inWhere(c(['GitHub']), { app: 'Google Chrome', url: 'https://github.com/acme/widgets' })).toBe(true);
  expect(inWhere(c(['GitHub']), { app: 'Google Chrome', url: 'https://notgithub.example.org/' })).toBe(false);
  expect(inWhere(c(['Com']), { app: 'Google Chrome', url: 'https://com.example.org/' })).toBe(false);
  expect(inWhere(c(['vercel.com']), { app: 'Google Chrome', url: 'https://notvercel.com.example.org/' })).toBe(false);
  expect(matchCriteria(c(['Terminal']), { app: 'Notes', url: null, windowTitle: '', text: 'Approved' })).toBe('none');
});
