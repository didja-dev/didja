import { rmSync } from 'node:fs';
import { expect, test } from 'bun:test';
import { formatObservation, formatTasks, formatWhy, parseSnooze } from '../src/cli.ts';
import { MANUAL_SOURCE, addManualTask, cleanModelTitle, needsShortTitle, pollOnce } from '../src/engine.ts';
import type { Judge } from '../src/engine.ts';
import { Store, similarity } from '../src/store.ts';
import type { Observation } from '../src/store.ts';

const NOW = new Date('2026-11-10T10:05:00Z');
const CHECKLIST = `Claude responded: Before this works in prod:
Before this works in prod:
1. Set STRIPE_WEBHOOK_SECRET in Vercel prod
2. Run the migration with supabase db push
3. Add the redirect URL in Supabase auth settings`;

function observe(store: Store, over: Partial<Omit<Observation, 'id'>>): number {
  return store.insertObservation({
    ts: '2026-11-10T10:00:00.000Z',
    bundleId: 'com.anthropic.claudefordesktop',
    app: 'Claude',
    windowTitle: 'Stripe webhooks',
    url: null,
    source: 'ax',
    text: '',
    ...over,
  });
}

test('poll stores checklist items from Claude windows only', () => {
  const store = new Store(':memory:');
  observe(store, { text: CHECKLIST });
  observe(store, { bundleId: 'com.apple.Notes', app: 'Notes', windowTitle: 'Groceries', text: '1. Buy the milk\n2. Call the plumber' });
  const stats = pollOnce(store, NOW);

  expect(stats.observations).toBe(2);
  expect(stats.claudeWindows).toBe(1);
  expect(stats.newTasks).toBe(3);
  const tasks = store.listTasks();
  expect(tasks.map((t) => t.position)).toEqual([1, 2, 3]);
  expect(tasks[0]!.sourceKind).toBe('claude-desktop');
  expect(tasks[0]!.sourceRef).toBe('Claude — Stripe webhooks');
  expect(tasks[0]!.status).toBe('open');
  store.close();
});

test('a list that arrives across several observations is reassembled', () => {
  const store = new Store(':memory:');
  const lines = CHECKLIST.split('\n');
  observe(store, { text: lines.slice(0, 3).join('\n') });
  expect(pollOnce(store, NOW).newTasks).toBe(0); // one item so far: not a list yet
  observe(store, { ts: '2026-11-10T10:00:05.000Z', text: lines.slice(3).join('\n') });
  expect(pollOnce(store, NOW).newTasks).toBe(3);
  store.close();
});

test('lines caught mid-stream merge into the finished task', () => {
  const store = new Store(':memory:');
  observe(store, { text: 'Claude responded: x\n1. Set STRIPE_WEBHOOK\n2. Run the migration with' });
  pollOnce(store, NOW);
  observe(store, { ts: '2026-11-10T10:00:02.000Z', text: '1. Set STRIPE_WEBHOOK_SECRET in Vercel prod\n2. Run the migration with supabase db push' });
  const stats = pollOnce(store, NOW);
  expect(stats.newTasks).toBe(0);
  expect(store.listTasks().map((t) => t.title)).toEqual([
    'Set STRIPE_WEBHOOK_SECRET in Vercel prod',
    'Run the migration with supabase db push',
  ]);
  store.close();
});

test('nothing new means nothing is re-read, and the cursor advances', () => {
  const store = new Store(':memory:');
  observe(store, { text: CHECKLIST });
  pollOnce(store, NOW);
  const stats = pollOnce(store, NOW);
  expect(stats.observations).toBe(0);
  expect(stats.newTasks).toBe(0);
  store.close();
});

test('a dismissed task does not come back while still on screen', () => {
  const store = new Store(':memory:');
  observe(store, { text: CHECKLIST });
  pollOnce(store, NOW);
  store.setStatus(store.listTasks()[0]!.id, 'dismissed');
  observe(store, { ts: '2026-11-10T10:01:00.000Z', text: 'Something else changed on screen' });
  expect(pollOnce(store, NOW).newTasks).toBe(0);
  expect(store.listTasks().length).toBe(2);
  expect(store.listTasks({ all: true }).length).toBe(3);
  store.close();
});

test('your own pasted checklist in a chat window is ignored', () => {
  const store = new Store(':memory:');
  observe(store, { text: 'You said: Steps\n1. Create a private GitHub repo\n2. Write the README' });
  expect(pollOnce(store, NOW).newTasks).toBe(0);
  store.close();
});

test('observations expire after 24 hours', () => {
  const store = new Store(':memory:');
  observe(store, { ts: '2026-11-09T09:00:00.000Z', text: 'old' });
  observe(store, { ts: '2026-11-10T09:00:00.000Z', text: 'recent' });
  expect(pollOnce(store, NOW).expired).toBe(1);
  expect(store.latestObservations(10).map((o) => o.text)).toEqual(['recent']);
  store.close();
});

test('evidence survives its observation expiring', () => {
  const store = new Store(':memory:');
  observe(store, { ts: '2026-11-10T10:00:00.000Z', text: CHECKLIST });
  pollOnce(store, NOW);
  store.pruneObservations(new Date('2026-11-12T00:00:00Z'));
  expect(store.listTasks().length).toBe(3);
  store.close();
});

test('distinct but similar-looking tasks stay separate', () => {
  expect(similarity('set stripe key in vercel prod', 'set stripe key in vercel preview')).toBeLessThan(0.9);
  expect(similarity('set stripe webhook secret', 'set stripe webh0ok secret')).toBeGreaterThanOrEqual(0.9);
});

test('task and observation output', () => {
  const store = new Store(':memory:');
  observe(store, { text: CHECKLIST });
  pollOnce(store, NOW);
  store.setStatus(2, 'done');
  expect(formatTasks(store.listTree(), NOW.getTime()).split('\n')).toEqual([
    'Claude — Stripe webhooks  (claude-desktop)',
    '  [ ] #4    Before this works in prod  (1/3 done)',
    '      [ ] #1    Set STRIPE_WEBHOOK_SECRET in Vercel prod  · seen 5m ago  · auto',
    '      [x] #2    Run the migration with supabase db push  · seen 5m ago',
    '      [ ] #3    Add the redirect URL in Supabase auth settings  · seen 5m ago',
  ]);
  expect(formatTasks([])).toBe('No open tasks.');
  const obs = formatObservation(store.latestObservations(1)[0]!);
  expect(obs).toContain('Claude — Stripe webhooks  [ax]');
  expect(obs).toContain('    1. Set STRIPE_WEBHOOK_SECRET in Vercel prod');
  store.close();
});

// --- Milestone 2: completion

const TERMINAL = { bundleId: 'com.mitchellh.ghostty', app: 'Ghostty', windowTitle: 'zsh' };
const VERCEL = {
  bundleId: 'com.google.Chrome', app: 'Google Chrome', windowTitle: 'Environment Variables – Vercel',
  url: 'https://vercel.com/acme/shop/settings/environment-variables?env=production',
};
const LATER = '2026-11-10T10:02:00.000Z';

function seeded(): Store {
  const store = new Store(':memory:');
  observe(store, { text: CHECKLIST.replace('supabase db push', '`supabase db push`') });
  pollOnce(store, NOW);
  return store;
}
const statusOf = (store: Store, id: number) => store.getTask(id)!.status;

test('markers and criteria are stored with the task', () => {
  const store = seeded();
  const [env, command, vague] = store.listTasks();
  expect(env!.markers).toEqual([{ kind: 'env', value: 'STRIPE_WEBHOOK_SECRET' }]);
  expect(env!.criteria).toEqual({ service: 'vercel', hosts: ['vercel.com'] });
  expect(command!.markers).toEqual([{ kind: 'command', value: 'supabase db push' }]);
  expect(vague!.markers).toEqual([]);
  store.close();
});

test('a command typed at a terminal prompt ticks its task', () => {
  const store = seeded();
  observe(store, { ...TERMINAL, ts: LATER, text: 'me@mac shop % supabase db push\nApplying migration 0007…' });
  const stats = pollOnce(store, NOW);
  expect(stats.completed).toBe(1);
  expect(statusOf(store, 2)).toBe('done');
  expect(statusOf(store, 1)).toBe('open');
  expect(formatWhy(store.getTask(2)!, store.listEvidence(2))).toContain('[x] supabase db push  (typed at a terminal prompt)  — Ran `supabase db push` in Ghostty');
  store.close();
});

test('a command merely shown on screen does not tick', () => {
  const store = seeded();
  observe(store, { ...TERMINAL, ts: LATER, text: 'To apply it run supabase db push\nsupabase db push\n$ supabase db push --dry-run' });
  observe(store, { bundleId: 'com.microsoft.VSCode', app: 'Code', windowTitle: 'README.md', ts: LATER, text: '$ supabase db push\nApplying migration 0007…' });
  expect(pollOnce(store, NOW).completed).toBe(0);
  store.close();
});

test('an env var seen on the named service ticks; seen anywhere else it does not', () => {
  const store = seeded();
  observe(store, { bundleId: 'com.microsoft.VSCode', app: 'Code', windowTitle: '.env', ts: LATER, text: 'STRIPE_WEBHOOK_SECRET=whsec_x' });
  observe(store, { ...VERCEL, url: 'https://dashboard.stripe.com/webhooks', ts: LATER, text: 'STRIPE_WEBHOOK_SECRET' });
  observe(store, { ...VERCEL, ts: LATER, text: 'MY_STRIPE_WEBHOOK_SECRET_OLD' });
  expect(pollOnce(store, NOW).completed).toBe(0);

  observe(store, { ...VERCEL, ts: LATER, text: 'STRIPE_WEBHOOK_SECRET\nProduction\nAdded just now' });
  expect(pollOnce(store, NOW).completed).toBe(1);
  expect(statusOf(store, 1)).toBe('done');
  const why = formatWhy(store.getTask(1)!, store.listEvidence(1));
  expect(why).toContain('Saw STRIPE_WEBHOOK_SECRET on vercel.com/acme/shop/settings/environment-variables');
  expect(why).not.toContain('env=production'); // query strings never go into evidence
  store.close();
});

test('seeing the marker in a Claude window never ticks', () => {
  const store = seeded();
  observe(store, { ts: LATER, text: 'Claude responded: reminder\nme % supabase db push' });
  observe(store, { ...TERMINAL, windowTitle: '✳ Claude Code', ts: LATER, text: '$ supabase db push\nApplying migration 0007…' });
  expect(pollOnce(store, NOW).completed).toBe(0);
  store.close();
});

test('a marker seen before the task existed does not count', () => {
  const store = seeded();
  observe(store, { ...TERMINAL, ts: '2026-11-10T09:59:00.000Z', text: '$ supabase db push\nApplying migration 0007…' });
  expect(pollOnce(store, NOW).completed).toBe(0);
  store.close();
});

test('a task with several markers needs all of them', () => {
  const store = new Store(':memory:');
  observe(store, { text: 'Claude responded: x\n1. Set `API_URL` and `API_KEY` in Vercel\n2. Run `vercel deploy --prod`' });
  pollOnce(store, NOW);
  observe(store, { ...VERCEL, ts: LATER, text: 'API_URL' });
  expect(pollOnce(store, NOW)).toMatchObject({ sightings: 1, completed: 0 });
  observe(store, { ...VERCEL, ts: LATER, text: 'API_KEY' });
  expect(pollOnce(store, NOW)).toMatchObject({ sightings: 1, completed: 1 });
  store.close();
});

test('tasks without a usable marker or a single named service are never auto-ticked', () => {
  const store = new Store(':memory:');
  observe(store, { text: 'Claude responded: x\n1. Copy `SUPABASE_URL` from Supabase into Vercel\n2. Set `SECRET_TOKEN` somewhere safe\n3. Check the login flow works' });
  pollOnce(store, NOW);
  observe(store, { ...VERCEL, ts: LATER, text: 'SUPABASE_URL\nSECRET_TOKEN' });
  expect(pollOnce(store, NOW)).toMatchObject({ sightings: 0, completed: 0 });
  expect(formatWhy(store.getTask(1)!, [])).toContain('names no single service');
  expect(formatWhy(store.getTask(3)!, [])).toContain('nothing exact to look for');
  store.close();
});

test('a task ticked by the engine stays ticked and a manual tick is labelled', () => {
  const store = seeded();
  observe(store, { ...TERMINAL, ts: LATER, text: '$ supabase db push\nApplying migration 0007…' });
  pollOnce(store, NOW);
  observe(store, { ts: '2026-11-10T10:03:00.000Z', text: '2. Run the migration with `supabase db push`' });
  pollOnce(store, NOW);
  expect(statusOf(store, 2)).toBe('done');
  store.setStatus(1, 'done');
  expect(formatWhy(store.getTask(1)!, store.listEvidence(1))).toContain('Marked done by hand.');
  store.close();
});

// --- checklists as parent tasks

test('a checklist becomes a parent task named after its lead-in, with its steps under it', () => {
  const store = seeded();
  const [group] = store.listGroups();
  expect(group!.parent).toMatchObject({ id: 4, title: 'Before this works in prod', isGroup: true, status: 'open' });
  expect(group!.tasks.map((t) => [t.id, t.parentId])).toEqual([[1, 4], [2, 4], [3, 4]]);
  expect(store.listTasks().length).toBe(3); // parents are not steps
  store.close();
});

test('seeing the list again, or more of it, reuses the same parent', () => {
  const store = seeded();
  observe(store, { ts: LATER, text: '3. Add the redirect URL in Supabase auth settings\n4. Redeploy the site' });
  pollOnce(store, NOW);
  const groups = store.listGroups();
  expect(groups.length).toBe(1);
  expect(groups[0]!.tasks.length).toBe(4);
  store.close();
});

test('the parent is done once every step is, and reopens when a step does', () => {
  const store = seeded();
  store.setStatus(1, 'done');
  store.setStatus(2, 'done');
  expect(statusOf(store, 4)).toBe('open');
  store.setStatus(3, 'dismissed');
  expect(statusOf(store, 4)).toBe('done');
  expect(store.listGroups()).toEqual([]);
  store.setStatus(2, 'open');
  expect(statusOf(store, 4)).toBe('open');
  store.close();
});

test('the engine ticking the last step completes the parent', () => {
  const store = seeded();
  store.setStatus(1, 'done');
  store.setStatus(3, 'done');
  observe(store, { ...TERMINAL, ts: LATER, text: '$ supabase db push\nApplying migration 0007…' });
  pollOnce(store, NOW);
  expect(statusOf(store, 4)).toBe('done');
  expect(store.getTask(4)!.doneAt).not.toBeNull();
  store.close();
});

test('ticking the parent ticks its open steps; reopening it reopens them', () => {
  const store = seeded();
  store.setStatus(3, 'dismissed');
  store.setStatus(4, 'done');
  expect([1, 2, 3].map((id) => statusOf(store, id))).toEqual(['done', 'done', 'dismissed']);
  store.setStatus(4, 'open');
  expect([1, 2, 3].map((id) => statusOf(store, id))).toEqual(['open', 'open', 'dismissed']);
  store.setStatus(4, 'dismissed');
  expect([1, 2, 3].map((id) => statusOf(store, id))).toEqual(['dismissed', 'dismissed', 'dismissed']);
  store.close();
});

test('ticking a whole conversation ticks what is open there and nothing else', () => {
  const store = seeded();
  observe(store, { ts: LATER, text: 'Claude responded: And for staging\nAnd for staging:\n1. Create the staging project\n2. Copy the env vars across' });
  observe(store, { ts: LATER, windowTitle: 'Other chat', text: 'Claude responded: On your side\nOn your side:\n1. Rotate the old API key\n2. Delete the unused bucket' });
  pollOnce(store, NOW);
  const all = () => store.listTasks({ all: true });
  const other = all().filter((t) => t.sourceRef.includes('Other chat'));
  const staging = all().filter((t) => t.title.includes('staging') || t.title.includes('env vars'));
  expect(other.length).toBe(2);
  expect(staging.length).toBe(2);
  store.setStatus(3, 'dismissed');
  store.snooze(staging[0]!.parentId!, new Date(NOW.getTime() + 3_600_000), NOW);

  // Any task of the conversation names it, here a step.
  expect(store.completeSource(2, NOW)).toEqual([4]);
  expect([1, 2, 3, 4].map((id) => statusOf(store, id))).toEqual(['done', 'done', 'dismissed', 'done']);
  expect(staging.map((t) => statusOf(store, t.id))).toEqual(['snoozed', 'snoozed']);
  expect(other.map((t) => statusOf(store, t.id))).toEqual(['open', 'open']);

  // Nothing open is left there, so a second go ticks nothing; an unknown task is refused.
  expect(store.completeSource(2, NOW)).toEqual([]);
  expect(store.completeSource(999, NOW)).toBeNull();
  expect(other.map((t) => statusOf(store, t.id))).toEqual(['open', 'open']);
  store.close();
});

test('two checklists in one conversation stay separate', () => {
  const store = seeded();
  observe(store, { ts: LATER, text: 'Claude responded: And for staging\nAnd for staging:\n1. Create the staging project\n2. Copy the env vars across' });
  pollOnce(store, NOW);
  expect(store.listGroups().map((g) => g.parent!.title)).toEqual(['Before this works in prod', 'And for staging']);
  store.close();
});

// --- snooze

test('a snoozed step leaves the list and comes back when its time is up', () => {
  const store = seeded();
  store.snooze(1, new Date('2026-11-10T11:00:00Z'), NOW);
  expect(statusOf(store, 1)).toBe('snoozed');
  expect(statusOf(store, 4)).toBe('open'); // other steps are still open
  pollOnce(store, new Date('2026-11-10T10:59:00Z'));
  expect(statusOf(store, 1)).toBe('snoozed');
  pollOnce(store, new Date('2026-11-10T11:00:01Z'));
  expect(statusOf(store, 1)).toBe('open');
  expect(store.getTask(1)!.snoozedUntil).toBeNull();
  store.close();
});

test('snoozing a checklist snoozes its open steps, and it wakes as a whole', () => {
  const store = seeded();
  store.setStatus(2, 'done');
  store.snooze(4, new Date('2026-11-10T11:00:00Z'), NOW);
  expect([1, 2, 3, 4].map((id) => statusOf(store, id))).toEqual(['snoozed', 'done', 'snoozed', 'snoozed']);
  expect(store.listGroups()).toEqual([]);
  expect(store.wakeSnoozed(new Date('2026-11-10T11:30:00Z'))).toBe(2); // the two steps; the checklist follows them
  expect([1, 2, 3, 4].map((id) => statusOf(store, id))).toEqual(['open', 'done', 'open', 'open']);
  store.close();
});

test('a checklist whose remaining steps are all snoozed is itself snoozed until the first returns', () => {
  const store = seeded();
  store.setStatus(2, 'done');
  store.snooze(1, new Date('2026-11-10T12:00:00Z'), NOW);
  store.snooze(3, new Date('2026-11-10T11:00:00Z'), NOW);
  expect(store.getTask(4)).toMatchObject({ status: 'snoozed', snoozedUntil: '2026-11-10T11:00:00.000Z' });
  store.close();
});

test('a snoozed task still ticks if it is seen being done', () => {
  const store = seeded();
  store.snooze(2, new Date('2026-11-11T09:00:00Z'), NOW);
  observe(store, { ...TERMINAL, ts: LATER, text: '$ supabase db push\nApplying migration 0007…' });
  expect(pollOnce(store, NOW).completed).toBe(1);
  expect(statusOf(store, 2)).toBe('done');
  store.close();
});

test('snooze durations', () => {
  const now = new Date(2026, 10, 10, 15, 30);
  expect(parseSnooze('30m', now)!.getTime() - now.getTime()).toBe(30 * 60_000);
  expect(parseSnooze('2h', now)!.getTime() - now.getTime()).toBe(2 * 3_600_000);
  const tomorrow = parseSnooze('tomorrow', now)!;
  expect([tomorrow.getDate(), tomorrow.getHours(), tomorrow.getMinutes()]).toEqual([11, 9, 0]);
  expect(parseSnooze('soon', now)).toBeNull();
});

test('a list with a single real step becomes a loose task, not a checklist', () => {
  const store = new Store(':memory:');
  observe(store, { text: 'Claude responded: Things you should do:\n1. The recorder is still running.\n2. Stop the old engine tab.' });
  pollOnce(store, NOW);
  const [group] = store.listGroups();
  expect(group!.parent).toBeNull();
  expect(group!.tasks.map((t) => t.title)).toEqual(['Stop the old engine tab.']);
  store.close();
});

// --- the on-device model settles lists whose wording does not say who they are for

const PLAN = 'Claude responded: x\nOrder of work\n1. Add parent tasks to the schema\n2. Run the tests\n3. Update the docs';
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);
function fakeJudge(audience: 'user' | 'assistant' | null) {
  const asked: { leadIn: string; steps: string[]; after?: string[] }[] = [];
  const judge: Judge = (list) => {
    asked.push(list);
    return audience ? { audience, model: 'test-model' } : null;
  };
  return { judge, asked };
}

test('an unsettled list is taken at once, then dismissed if the model says it is Claude\'s own', () => {
  const store = new Store(':memory:');
  const { judge, asked } = fakeJudge('assistant');
  observe(store, { text: PLAN });
  expect(pollOnce(store, NOW, { judge })).toMatchObject({ newTasks: 3, judged: 0 }); // still settling
  expect(store.listTasks().length).toBe(3);

  expect(pollOnce(store, at(7), { judge }).judged).toBe(1);
  expect(asked).toEqual([{ leadIn: 'Order of work', steps: ['Add parent tasks to the schema', 'Run the tests', 'Update the docs'], after: [] }]);
  expect(store.listTasks()).toEqual([]);
  expect(store.getTask(4)!.status).toBe('dismissed'); // the checklist goes with its steps
  expect(formatWhy(store.getTask(1)!, store.listEvidence(1))).toContain("reads as Claude's own plan");

  // Seen again: the verdict is remembered, nothing comes back and the model is not asked twice.
  observe(store, { ts: LATER, text: PLAN });
  expect(pollOnce(store, at(30), { judge })).toMatchObject({ newTasks: 0, judged: 0 });
  expect(asked.length).toBe(1);
  store.close();
});

test('the model is told what you asked just before the list', () => {
  const store = new Store(':memory:');
  const { judge, asked } = fakeJudge('user');
  observe(store, { text: '⟦Message 1⟧\nYou said: How do I tag v0.2.0 and push it?\nHow do I tag v0.2.0 and push it?\n⟦Message 2⟧\nClaude responded: x\nRelease steps\n1. Tag the commit with git tag -a v0.2.0\n2. Push the tag with git push origin v0.2.0' });
  pollOnce(store, NOW, { judge });
  expect(pollOnce(store, at(7), { judge }).judged).toBe(1);
  expect(asked[0]).toMatchObject({ asked: 'How do I tag v0.2.0 and push it?' });
  store.close();
});

test('a list the model says is for you stays', () => {
  const store = new Store(':memory:');
  const { judge } = fakeJudge('user');
  observe(store, { text: PLAN });
  pollOnce(store, NOW, { judge });
  expect(pollOnce(store, at(7), { judge }).judged).toBe(1);
  expect(store.listTasks().length).toBe(3);
  store.close();
});

test('the model is not asked about lists whose wording already settles it', () => {
  const store = new Store(':memory:');
  const { judge, asked } = fakeJudge('assistant');
  observe(store, { text: 'Claude responded: x\nThings you should do:\n1. Stop the old engine tab\n2. Delete the old folder' });
  pollOnce(store, NOW, { judge });
  pollOnce(store, at(7), { judge });
  expect(asked).toEqual([]);
  expect(store.listTasks().length).toBe(2);
  store.close();
});

test('a task you already ticked is not touched by a later verdict', () => {
  const store = new Store(':memory:');
  const { judge } = fakeJudge('assistant');
  observe(store, { text: PLAN });
  pollOnce(store, NOW, { judge });
  store.setStatus(2, 'done');
  pollOnce(store, at(7), { judge });
  expect([1, 2, 3].map((id) => statusOf(store, id))).toEqual(['dismissed', 'done', 'dismissed']);
  store.close();
});

test('a list still being written is judged once, in its settled form', () => {
  const store = new Store(':memory:');
  const { judge, asked } = fakeJudge('user');
  observe(store, { text: 'Claude responded: x\nOrder of work\n1. Add parent tasks to the schema\n2. Run the tests' });
  pollOnce(store, NOW, { judge });
  observe(store, { ts: LATER, text: '3. Update the docs' });
  pollOnce(store, at(4), { judge });
  expect(asked).toEqual([]); // changed 4s ago: not settled yet
  pollOnce(store, at(11), { judge });
  expect(asked.map((a) => a.steps.length)).toEqual([3]);
  store.close();
});

test('with no model available, the wording-based result stands and nothing queues up', () => {
  const store = new Store(':memory:');
  const { judge, asked } = fakeJudge(null);
  observe(store, { text: PLAN });
  pollOnce(store, NOW, { judge });
  pollOnce(store, at(7), { judge });
  expect(asked.length).toBe(1);
  expect(store.listTasks().length).toBe(3);
  expect(store.settledPendingJudgements(at(100), 10)).toEqual([]);
  store.close();
});

// --- nested hierarchy, renaming, collapsing

const NESTED = `Claude responded: x
Before this works in prod you need to:
1. Set the env vars in Vercel:
  • Add \`STRIPE_WEBHOOK_SECRET\`
  • Add \`NEXT_PUBLIC_SITE_URL\`
  • Both are marked sensitive by default.
2. Run the migration: \`supabase db push\`
3. Check the login flow works`;

function shape(nodes: ReturnType<Store['listTree']>): unknown {
  return nodes.map((n) => (n.children.length ? [n.task.title, shape(n.children)] : n.task.title));
}

test('sub-items that are things to do become steps under their item, to any depth', () => {
  const store = new Store(':memory:');
  observe(store, { text: NESTED });
  pollOnce(store, NOW);
  expect(shape(store.listTree())).toEqual([
    ['Before this works in prod you need to', [
      ['Set the env vars in Vercel:', ['Add `STRIPE_WEBHOOK_SECRET`', 'Add `NEXT_PUBLIC_SITE_URL`']],
      'Run the migration: `supabase db push`',
      'Check the login flow works',
    ]],
  ]);
  // The note under step 1 is not a step; the sub-steps carry the markers, their parent none.
  const sub = store.findTaskByTitle('Add `STRIPE_WEBHOOK_SECRET`')!;
  expect(sub.markers).toEqual([{ kind: 'env', value: 'STRIPE_WEBHOOK_SECRET' }]);
  expect(store.findTaskByTitle('Set the env vars in Vercel:')!.markers).toEqual([]);
  store.close();
});

test('ticks travel up and down through every level', () => {
  const store = new Store(':memory:');
  observe(store, { text: NESTED });
  pollOnce(store, NOW);
  const id = (title: string) => store.findTaskByTitle(title)!.id;
  const [root] = store.listTree();
  const inner = id('Set the env vars in Vercel:');

  store.setStatus(id('Add `STRIPE_WEBHOOK_SECRET`'), 'done');
  expect(statusOf(store, inner)).toBe('open');
  store.setStatus(id('Add `NEXT_PUBLIC_SITE_URL`'), 'done');
  expect(statusOf(store, inner)).toBe('done'); // inner parent completes
  expect(statusOf(store, root!.task.id)).toBe('open'); // two steps still open above it

  store.setStatus(root!.task.id, 'done'); // ticking the top ticks everything left
  expect(store.listTasks()).toEqual([]);
  store.setStatus(id('Add `NEXT_PUBLIC_SITE_URL`'), 'open'); // reopening the deepest step reopens every parent
  expect([inner, root!.task.id].map((t) => statusOf(store, t))).toEqual(['open', 'open']);
  store.close();
});

test('a step seen on its own that later gains sub-steps becomes their parent', () => {
  const store = new Store(':memory:');
  observe(store, { text: 'Claude responded: x\nTo finish:\n1. Check the login flow works\n2. Set the env vars in Vercel:' });
  pollOnce(store, NOW);
  const before = store.findTaskByTitle('Set the env vars in Vercel:')!;
  observe(store, { ts: LATER, text: '  • Add `STRIPE_WEBHOOK_SECRET`\n  • Add `NEXT_PUBLIC_SITE_URL`' });
  pollOnce(store, NOW);
  const after = store.getTask(before.id)!;
  expect(after.isGroup).toBe(true);
  expect(shape(store.listTree())).toEqual([
    ['To finish', ['Check the login flow works', ['Set the env vars in Vercel:', ['Add `STRIPE_WEBHOOK_SECRET`', 'Add `NEXT_PUBLIC_SITE_URL`']]]],
  ]);
  store.close();
});

test('a heading item over real steps is kept as their parent', () => {
  const store = new Store(':memory:');
  observe(store, { text: 'Claude responded: x\nOn your side:\n1. Vercel\n  • Set `API_KEY`\n  • Redeploy the site\n2. Supabase\n  • Run `supabase db push`' });
  pollOnce(store, NOW);
  expect(shape(store.listTree())).toEqual([
    ['On your side', [['Vercel', ['Set `API_KEY`', 'Redeploy the site']], ['Supabase', ['Run `supabase db push`']]]],
  ]);
  store.close();
});

test('a renamed item keeps your name when it is seen again, and can be reset', () => {
  const store = seeded();
  store.rename(4, '  Stripe   go-live ');
  store.rename(1, 'Webhook secret');
  observe(store, { ts: LATER, text: CHECKLIST });
  pollOnce(store, NOW);
  expect(store.getTask(4)).toMatchObject({ title: 'Stripe go-live', renamed: true, capturedTitle: 'Before this works in prod' });
  expect(store.getTask(1)!.title).toBe('Webhook secret');
  expect(store.listTasks().length).toBe(3); // still matched by the captured title: no duplicate
  store.rename(1, null);
  expect(store.getTask(1)).toMatchObject({ title: 'Set STRIPE_WEBHOOK_SECRET in Vercel prod', renamed: false });
  store.close();
});

test('collapsed state is stored per parent, and the auto flag marks self-ticking steps', () => {
  const store = seeded();
  expect(store.getTask(4)!.collapsed).toBe(false);
  store.setCollapsed(4, true);
  expect(store.getTask(4)!.collapsed).toBe(true);
  expect([1, 2, 3].map((id) => store.getTask(id)!.auto)).toEqual([true, true, false]);
  expect(formatTasks(store.listTree(), NOW.getTime())).toContain('(0/3 done)');
  store.close();
});

test('tasks taken from a list are taken back when the text after it shows it was Claude\'s plan', () => {
  const store = new Store(':memory:');
  // The list arrives first; the telling sentence a moment later, as when a reply streams in.
  observe(store, { text: 'Claude responded: x\nTwo steps, in this order:\n1. Fix the three capture flaws\n2. Add markers to each task' });
  expect(pollOnce(store, NOW).newTasks).toBe(2);
  store.setStatus(1, 'done'); // one you had already dealt with
  observe(store, { ts: LATER, text: 'Say “go” and I’ll do the fixes and start Milestone 2.' });
  expect(pollOnce(store, NOW).retracted).toBe(1);
  expect([1, 2].map((id) => statusOf(store, id))).toEqual(['done', 'dismissed']);
  expect(formatWhy(store.getTask(2)!, store.listEvidence(2))).toContain('what Claude was going to do');
  // Seen again: nothing comes back and nothing more is taken away.
  observe(store, { ts: '2026-11-10T10:03:00.000Z', text: 'something else' });
  expect(pollOnce(store, NOW)).toMatchObject({ newTasks: 0, retracted: 0 });
  store.close();
});

// --- short checklist titles from the on-device model

const LONG_LEAD_IN = "Claude responded: x\nI can't change that setting for you, and I can't see which step didn't take, so here goes:\n1. Open System Settings\n2. Remove Didja from the list\n3. Add the app again";

test('a checklist introduced by a long sentence gets a short title, once it has settled', () => {
  const store = new Store(':memory:');
  const asked: unknown[] = [];
  const titler = (list: { leadIn: string; steps: string[] }) => { asked.push(list); return '"Re-grant Accessibility access."'; };
  observe(store, { ts: NOW.toISOString(), text: LONG_LEAD_IN });
  expect(pollOnce(store, NOW, { titler }).titled).toBe(0); // just seen: it may still be streaming
  expect(pollOnce(store, at(7), { titler }).titled).toBe(1);
  expect(pollOnce(store, at(14), { titler }).titled).toBe(0); // asked once only
  const root = store.listTree()[0]!.task;
  expect(root.title).toBe('Re-grant Accessibility access');
  expect(root).toMatchObject({ modelTitled: true, renamed: false });
  expect(root.capturedTitle).toContain("I can't change that setting for you");
  expect(asked).toEqual([{ leadIn: root.capturedTitle, steps: ['Open System Settings', 'Remove Didja from the list', 'Add the app again'] }]);
  expect(formatWhy(root, [])).toContain('Titled by the on-device model');
  store.close();
});

test('your own name wins over the model\'s, and a good lead-in is left alone', () => {
  const store = new Store(':memory:');
  let calls = 0;
  const titler = () => { calls++; return 'Something short'; };
  observe(store, { text: LONG_LEAD_IN });
  observe(store, { windowTitle: 'Other', text: CHECKLIST });
  pollOnce(store, NOW);
  const [long, fine] = store.listTree().map((n) => n.task);
  store.rename(long!.id, 'My name for it');
  pollOnce(store, at(7), { titler });
  expect(calls).toBe(0); // one renamed by you, the other already a good title
  expect(store.getTask(long!.id)!.title).toBe('My name for it');
  expect(store.getTask(fine!.id)).toMatchObject({ title: 'Before this works in prod', modelTitled: false });
  store.close();
});

test('with no model the captured title stays, and is offered again later', () => {
  const store = new Store(':memory:');
  observe(store, { text: LONG_LEAD_IN });
  pollOnce(store, NOW, { titler: () => null });
  expect(store.listTree()[0]!.task.modelTitled).toBe(false);
  expect(pollOnce(store, at(7), { titler: () => 'Re-grant access' }).titled).toBe(1);
  store.close();
});

test('which lead-ins need a title, and what counts as a usable one', () => {
  expect(needsShortTitle('Before this works in prod')).toBe(false);
  expect(needsShortTitle('Quick terminal check')).toBe(false);
  expect(needsShortTitle("I can't change that setting for you")).toBe(true);
  expect(needsShortTitle('One thing is still unproven on live data: an auto-tick. Here is a real two-step checklist')).toBe(true);
  expect(needsShortTitle('So the purple does not come from an environment value')).toBe(true);
  expect(cleanModelTitle('  “Rotate the API key.”\nBecause it leaked', 'x')).toBe('Rotate the API key');
  expect(cleanModelTitle('ok', 'x')).toBeNull();
  expect(cleanModelTitle('A'.repeat(80), 'x')).toBeNull();
  expect(cleanModelTitle('Next steps', 'next steps')).toBeNull();
});

// --- reminders for unfinished checklists

test('a checklist left untouched for hours is reported once; one with recent progress is not', () => {
  const store = seeded(); // captured at 10:00
  const hours = (n: number) => new Date(Date.parse('2026-11-10T10:00:00Z') + n * 3600_000);
  expect(store.takeNudges(hours(3))).toEqual([]);
  store.setStatus(1, 'done', hours(3.5)); // some progress
  expect(store.takeNudges(hours(5))).toEqual([]); // 1.5h since the last tick
  expect(store.takeNudges(hours(8))).toEqual([
    { id: 4, title: 'Before this works in prod', source: 'Claude — Stripe webhooks', left: 2, total: 3 },
  ]);
  expect(store.takeNudges(hours(30))).toEqual([]); // once only
  store.close();
});

test('snoozed and finished checklists are not nudged about', () => {
  const store = seeded();
  const later = new Date('2026-11-11T10:00:00Z');
  store.snooze(4, new Date('2026-11-12T09:00:00Z'), NOW);
  expect(store.takeNudges(later)).toEqual([]);
  store.close();
});

test('observations are kept for 24 hours, or less if a shorter time was chosen, never more', () => {
  const store = new Store(':memory:');
  const now = new Date('2026-11-10T12:00:00Z');
  const seen = (hoursAgo: number) => store.insertObservation({ ts: new Date(now.getTime() - hoursAgo * 3600_000).toISOString(),
    bundleId: 'com.apple.Notes', app: 'Notes', windowTitle: `w${hoursAgo}`, url: null, source: 'ax', text: 'x' });
  seen(0.5); seen(2); seen(7); seen(25);
  expect(store.pruneObservations(now)).toBe(1);
  store.setMeta('retention_hours', '72');
  expect(store.retentionMs()).toBe(24 * 3600_000);
  store.setMeta('retention_hours', '6');
  expect(store.pruneObservations(now)).toBe(1);
  store.setMeta('retention_hours', '1');
  expect(store.pruneObservations(now)).toBe(1);
  store.setMeta('retention_hours', 'soon');
  expect(store.pruneObservations(now)).toBe(0);
  store.close();
});

test('sources named the old way are renamed once, merging into one already named the new way', () => {
  const path = `${process.env.TMPDIR ?? '/tmp'}/sa-rename-${Date.now()}.db`;
  let store = new Store(path);
  const add = (ref: string, kind: 'claude-code' | 'claude-web', title: string) => store.upsertTask({
    title, sourceKind: kind, sourceRef: ref, confidence: 1, position: null, ts: '2026-11-10T09:00:00.000Z', observationId: null, markers: [], criteria: null,
  });
  add('Ghostty — Fix auth', 'claude-code', 'Rotate the key');
  add('Claude Code — Fix auth (Ghostty)', 'claude-code', 'Run the migration');
  add('Microsoft Edge — Billing - Claude', 'claude-web', 'Update the plan');
  store.setMeta('sources_named', '1');
  store.close();
  store = new Store(path);
  expect(store.listTasks().map((t) => [t.title, t.sourceRef]).sort()).toEqual([
    ['Rotate the key', 'Claude Code — Fix auth (Ghostty)'],
    ['Run the migration', 'Claude Code — Fix auth (Ghostty)'],
    ['Update the plan', 'Claude — Billing'],
  ]);
  store.close();
  for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
});

test('"not an action" dismisses a step, is never captured again, and is shown to the model as an example', () => {
  const store = new Store(':memory:');
  const claude = (ts: string, text: string) => store.insertObservation({ ts, bundleId: 'com.anthropic.claudefordesktop', app: 'Claude', windowTitle: 'Deploy', url: null, source: 'ax', text });
  claude('2026-11-10T10:00:00.000Z', 'Claude responded: x\nOn your side:\n1. Run `supabase db push`\n2. Review the diff in the PR');
  pollOnce(store, new Date('2026-11-10T10:00:05Z'));
  const review = store.listTasks({ all: true }).find((t) => t.title === 'Review the diff in the PR')!;
  expect(store.notAnAction(review.id, new Date('2026-11-10T10:01:00Z'))).toBe(true);
  expect(store.getTask(review.id)!.status).toBe('dismissed');
  expect(store.isNotAnAction('Review the diff in the PR')).toBe(true);
  expect(store.teaching('lists')).toEqual({ instructions: null, examples: ['"Review the diff in the PR" was not something for me to do.'] });

  // The same step in a later list is not captured again; the rest is.
  claude('2026-11-10T10:05:00.000Z', 'Claude responded: y\nNext, on your side:\n1. Review the diff in the PR\n2. Merge it into main');
  pollOnce(store, new Date('2026-11-10T10:05:05Z'));
  const open = store.listTasks().map((t) => t.title);
  expect(open).toContain('Merge it into main');
  expect(open).not.toContain('Review the diff in the PR');

  // The model is shown the lesson with every question about a list.
  const asked: unknown[] = [];
  claude('2026-11-10T10:10:00.000Z', 'Claude responded: z\nHere:\n1. Open the settings page\n2. Copy the token');
  pollOnce(store, new Date('2026-11-10T10:10:05Z'), { judge: (list) => { asked.push(list.teach); return { audience: 'user', model: 'm' }; } });
  pollOnce(store, new Date('2026-11-10T10:10:20Z'), { judge: (list) => { asked.push(list.teach); return { audience: 'user', model: 'm' }; } });
  expect(asked).toContainEqual({ instructions: null, examples: ['"Review the diff in the PR" was not something for me to do.'] });
  store.close();
});

test('"not done" reopens an auto-accepted task and teaches the looks-done question; it refuses anything else', () => {
  const store = new Store(':memory:');
  const id = store.upsertTask({ title: 'Add the redirect URL in Supabase', sourceKind: 'claude-desktop', sourceRef: 'Claude — Auth', confidence: 1, position: null,
    ts: '2026-11-10T09:00:00.000Z', observationId: null, markers: [], criteria: null }).id;
  expect(store.notDone(id)).toBe(false); // not ticked for you
  store.acceptLooksDone(id, 'Google Chrome — supabase.com/dashboard', new Date('2026-11-10T10:00:00Z'));
  expect(store.notDone(id, new Date('2026-11-10T10:01:00Z'))).toBe(true);
  expect(store.getTask(id)).toMatchObject({ status: 'open', acceptedFrom: null });
  expect(store.rejectedPlaces(id).has('Google Chrome — supabase.com/dashboard')).toBe(true);
  expect(store.teaching('looks-done').examples).toEqual(['"Add the redirect URL in Supabase" was not done, even though Google Chrome — supabase.com/dashboard seemed to show it.']);
  store.close();
});

test('your instructions replace the built-in ones for one job, and can be put back', () => {
  const store = new Store(':memory:');
  store.setInstructions('emails', '  Treat anything from my bank as a task.  ');
  expect(store.teaching('emails').instructions).toBe('Treat anything from my bank as a task.');
  expect(store.teaching('lists').instructions).toBeNull();
  store.setInstructions('emails', 'x'.repeat(5000));
  expect(store.teaching('emails').instructions!.length).toBe(4000);
  store.setInstructions('emails', '   ');
  expect(store.teaching('emails').instructions).toBeNull();
  store.close();
});

test('renamed from ScrolledAway: the data folder and database move once, and nothing is overwritten', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { moveFromOldName } = await import('../src/store.ts');
  const home = mkdtempSync(join(tmpdir(), 'didja-home-'));
  const old = join(home, 'Library/Application Support/ScrolledAway');
  mkdirSync(old, { recursive: true });
  writeFileSync(join(old, 'scrolledaway.db'), 'tasks');
  writeFileSync(join(old, 'scrolledaway.db-wal'), 'wal');
  writeFileSync(join(old, 'exclude.json'), '{}');
  moveFromOldName(home);
  const now = join(home, 'Library/Application Support/Didja');
  expect(readFileSync(join(now, 'didja.db'), 'utf8')).toBe('tasks');
  expect(existsSync(join(now, 'didja.db-wal'))).toBe(true);
  expect(existsSync(join(now, 'exclude.json'))).toBe(true);
  expect(existsSync(old)).toBe(false);
  // A second ScrolledAway folder appearing later never replaces what is there.
  mkdirSync(old, { recursive: true });
  writeFileSync(join(old, 'scrolledaway.db'), 'older');
  moveFromOldName(home);
  expect(readFileSync(join(now, 'didja.db'), 'utf8')).toBe('tasks');
});

// SCR-29: a task you add yourself.
test('a task added by hand is stored as yours, with its markers', () => {
  const store = new Store(':memory:');
  const id = addManualTask(store, '  Run   `supabase db push` before the demo ', NOW)!;
  const task = store.getTask(id)!;
  expect(task.title).toBe('Run `supabase db push` before the demo');
  expect(task.sourceKind).toBe('manual');
  expect(task.sourceRef).toBe(MANUAL_SOURCE);
  expect(task.status).toBe('open');
  expect(task.markers).toEqual([{ kind: 'command', value: 'supabase db push' }]);
  expect(addManualTask(store, '   ', NOW)).toBeNull();
  store.close();
});

test('a task added by hand ticks when it is seen done afterwards', () => {
  const store = new Store(':memory:');
  const id = addManualTask(store, 'Run `supabase db push`', new Date('2026-11-10T10:00:00Z'))!;
  observe(store, { ...TERMINAL, ts: '2026-11-10T10:01:00.000Z', text: 'me@mac shop % supabase db push\nApplying migration 0007…' });
  pollOnce(store, NOW);
  expect(store.getTask(id)!.status).toBe('done');
  store.close();
});

test('a task added by hand is not ticked by what was on screen before you added it', () => {
  const store = new Store(':memory:');
  observe(store, { ...TERMINAL, ts: '2026-11-10T09:59:00.000Z', text: 'me@mac shop % supabase db push\nApplying migration 0007…' });
  const id = addManualTask(store, 'Run `supabase db push`', new Date('2026-11-10T10:00:00Z'))!;
  pollOnce(store, NOW);
  expect(store.getTask(id)!.status).toBe('open');
  store.close();
});

test('a task with no marker added by hand is never ticked on its own', () => {
  const store = new Store(':memory:');
  const id = addManualTask(store, 'Call the plumber', new Date('2026-11-10T10:00:00Z'))!;
  observe(store, { ...TERMINAL, ts: '2026-11-10T10:01:00.000Z', text: 'me@mac ~ % echo call the plumber' });
  pollOnce(store, NOW);
  expect(store.getTask(id)!.status).toBe('open');
  store.close();
});

test('a task added by hand is not merged into a captured one with the same words', () => {
  const store = new Store(':memory:');
  observe(store, { text: CHECKLIST });
  pollOnce(store, NOW);
  const before = store.listTasks().length;
  addManualTask(store, 'Run the migration with supabase db push', NOW);
  expect(store.listTasks().length).toBe(before + 1);
  store.close();
});

test('SCR-61: a command typed but not run does not tick; its output arriving later does', () => {
  const store = seeded();
  observe(store, { ...TERMINAL, ts: LATER, text: 'me@mac shop % supabase db push' });
  expect(pollOnce(store, NOW).completed).toBe(0);
  expect(statusOf(store, 2)).toBe('open');
  // Return pressed: the output comes in the window's next observation (its command line is not captured again).
  observe(store, { ...TERMINAL, ts: '2026-11-10T10:02:30.000Z', text: 'Applying migration 0007…\nme@mac shop %' });
  expect(pollOnce(store, NOW).completed).toBe(1);
  expect(statusOf(store, 2)).toBe('done');
  store.close();
});

test('SCR-61: a failed run does not tick or ask; run again and succeeding, it ticks', () => {
  const store = seeded();
  observe(store, { ...TERMINAL, ts: LATER, text: 'me@mac shop % supabase db push\nError: failed to connect to postgres\nme@mac shop %' });
  const first = pollOnce(store, NOW);
  expect(first.completed).toBe(0);
  expect(first.suggested).toBe(0);
  expect(store.getTask(2)!.suggestion).toBeNull();
  observe(store, { ...TERMINAL, ts: '2026-11-10T10:03:00.000Z', text: 'me@mac shop % supabase db push\nApplying migration 0007…\nme@mac shop %' });
  expect(pollOnce(store, NOW).completed).toBe(1);
  expect(statusOf(store, 2)).toBe('done');
  store.close();
});

test('SCR-61: output in another terminal window does not make a typed command run', () => {
  const store = seeded();
  observe(store, { ...TERMINAL, ts: LATER, text: 'me@mac shop % supabase db push' });
  observe(store, { ...TERMINAL, windowTitle: 'other tab', ts: '2026-11-10T10:02:30.000Z', text: 'Applying migration 0007…\nme@mac shop %' });
  pollOnce(store, NOW);
  expect(statusOf(store, 2)).toBe('open');
  store.close();
});
