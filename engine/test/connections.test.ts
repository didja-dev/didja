import { expect, test } from 'bun:test';
import { DEFAULT_BRING, isDueNow, isWanted, linearItems, listConnections, resultJSON, saveConnections, updateConnection } from '../src/connections.ts';
import type { Connection, ExternalItem } from '../src/connections.ts';
import { Store } from '../src/store.ts';
import { syncConnections } from '../src/sync.ts';
import type { Remote } from '../src/sync.ts';

const NOW = new Date(2026, 10, 11, 10, 0);
const item = (over: Partial<ExternalItem>): ExternalItem => ({
  id: 'u1', key: 'PMO-1', title: 'Send the vendor contract', url: 'https://linear.app/x/issue/PMO-1', due: '2026-11-11', state: 'Todo', stateType: 'unstarted', ...over,
});
const LINEAR: Connection = { id: 'linear', kind: 'linear', onDone: { state: 'Done' }, whenSure: true };

function fake(items: ExternalItem[]) {
  const written: string[] = [];
  const remote: Remote = { mine: async () => items, markDone: async (_c, id) => { written.push(id); } };
  return { remote, written, set: (next: ExternalItem[]) => { items = next; } };
}
function connected(c: Connection = LINEAR): Store {
  const store = new Store(':memory:');
  saveConnections(store, [c]);
  return store;
}

test("Linear's list_issues answer is read, whatever wraps it", () => {
  const answer = { content: [{ type: 'text', text: JSON.stringify({ issues: [
    { id: 'PMO-1', uuid: 'u1', identifier: 'PMO-1', title: 'A', url: 'https://l/1', dueDate: '2026-11-11T00:00:00.000Z', status: 'Todo', statusType: 'unstarted' },
    { id: 'PMO-2', title: 'B', status: { name: 'Done' }, statusType: 'completed' },
    { nothing: true },
  ], hasNextPage: false }) }] };
  expect(linearItems(resultJSON(answer))).toEqual([
    { id: 'u1', key: 'PMO-1', title: 'A', url: 'https://l/1', due: '2026-11-11', state: 'Todo', stateType: 'unstarted' },
    { id: 'PMO-2', key: 'PMO-2', title: 'B', url: null, due: null, state: 'Done', stateType: 'completed' },
  ]);
});

test('due today or overdue, and still open, comes in; later, undated or finished does not', () => {
  expect(isDueNow(item({ due: '2026-11-11' }), NOW)).toBe(true);
  expect(isDueNow(item({ due: '2026-11-02' }), NOW)).toBe(true);
  expect(isDueNow(item({ due: '2026-11-12' }), NOW)).toBe(false);
  expect(isDueNow(item({ due: null }), NOW)).toBe(false);
  expect(isDueNow(item({ stateType: 'completed' }), NOW)).toBe(false);
  expect(isDueNow(item({ stateType: 'canceled' }), NOW)).toBe(false);
});

test('your due items become tasks under the tool, once', async () => {
  const store = connected();
  const { remote } = fake([item({}), item({ id: 'u2', key: 'PMO-2', due: '2026-12-01' })]);
  expect((await syncConnections(store, remote, NOW)).created).toBe(1);
  expect((await syncConnections(store, remote, NOW)).created).toBe(0);
  const [task] = store.listTasks();
  expect(task).toMatchObject({ title: 'Send the vendor contract', sourceKind: 'external', sourceRef: 'Linear',
    criteria: { external: { connection: 'linear', id: 'u1', key: 'PMO-1', url: 'https://linear.app/x/issue/PMO-1' } } });
  expect(listConnections(store)[0]).toMatchObject({ status: 'connected' });
  store.close();
});

test('done or cancelled there closes it here, and nothing is written back for it', async () => {
  const store = connected();
  const f = fake([item({}), item({ id: 'u2', key: 'PMO-2', title: 'Other' })]);
  await syncConnections(store, f.remote, NOW);
  f.set([item({ stateType: 'completed', state: 'Done' }), item({ id: 'u2', key: 'PMO-2', title: 'Other', stateType: 'canceled' })]);
  expect((await syncConnections(store, f.remote, NOW)).closed).toBe(2);
  const all = store.listTasks({ all: true });
  expect(all.map((t) => t.status)).toEqual(['done', 'dismissed']);
  expect(f.written).toEqual([]);
  store.close();
});

test('ticked here: written back once, with the state set up', async () => {
  const store = connected();
  const f = fake([item({})]);
  await syncConnections(store, f.remote, NOW);
  store.setStatus(store.listTasks()[0]!.id, 'done', NOW);
  expect((await syncConnections(store, f.remote, NOW)).written).toBe(1);
  expect((await syncConnections(store, f.remote, NOW)).written).toBe(0);
  expect(f.written).toEqual(['u1']);
  store.close();
});

test('ticked on its own: written back only when the connection allows it; nothing set up, nothing written', async () => {
  for (const [whenSure, expected] of [[true, ['u1']], [false, []]] as const) {
    const store = connected({ ...LINEAR, whenSure });
    const f = fake([item({})]);
    await syncConnections(store, f.remote, NOW);
    const id = store.listTasks()[0]!.id;
    store.acceptLooksDone(id, 'Google Chrome — vendor.com/contracts', NOW);
    await syncConnections(store, f.remote, NOW);
    expect(f.written).toEqual([...expected]);
    store.close();
  }
  const store = connected({ ...LINEAR, onDone: {} });
  const f = fake([item({})]);
  await syncConnections(store, f.remote, NOW);
  store.setStatus(store.listTasks()[0]!.id, 'done', NOW);
  await syncConnections(store, f.remote, NOW);
  expect(f.written).toEqual([]);
  store.close();
});

test('a connection that cannot be reached is marked, and the list is left alone', async () => {
  const store = connected();
  const remote: Remote = { mine: async () => { throw new Error('401 Unauthorized'); }, markDone: async () => {} };
  const stats = await syncConnections(store, remote, NOW);
  expect(stats.errors.length).toBe(1);
  expect(listConnections(store)[0]).toMatchObject({ status: 'signed-out' });
  expect(store.listTasks()).toEqual([]);
  expect(updateConnection(store, 'nope', {})).toBeNull();
  store.close();
});

test('the page after signing in says what happened, and closes itself only when it worked', async () => {
  const { callbackPage } = await import('../src/connections.ts');
  expect(callbackPage('Linear', true)).toContain('Connected to Linear');
  expect(callbackPage('Linear', true)).toContain('window.close()');
  expect(callbackPage('Linear', false)).toContain('Not connected');
  expect(callbackPage('Linear', false)).not.toContain('window.close()');
});

test('what comes in follows the connection\'s rules: which kinds of issue, which teams', () => {
  const todo = item({ due: null, stateType: 'unstarted', team: 'PMO' });
  const doing = item({ due: null, stateType: 'started', team: 'ENG' });
  const due = item({ due: '2026-11-10', stateType: 'backlog', team: 'PMO' });
  const done = item({ due: '2026-11-10', stateType: 'completed', team: 'PMO' });
  const pick = (over: Partial<typeof DEFAULT_BRING>) => [todo, doing, due, done].filter((i) => isWanted(i, { ...DEFAULT_BRING, ...over }, NOW));
  expect(pick({})).toEqual([due]); // the default: due today or overdue
  expect(pick({ due: false, started: true })).toEqual([doing]);
  expect(pick({ due: false, unstarted: true, backlog: true })).toEqual([todo, due]);
  expect(pick({ started: true, unstarted: true, teams: ['pmo'] })).toEqual([todo, due]); // teams match ignoring case
  expect(pick({ due: false, started: false })).toEqual([]);
});

test('a connection with in-progress on brings those in on the next sync', async () => {
  const store = connected({ ...LINEAR, bring: { ...DEFAULT_BRING, due: false, started: true } });
  const f = fake([item({ due: null, stateType: 'started', team: 'ENG' }), item({ id: 'u2', key: 'PMO-2', due: null, stateType: 'unstarted' })]);
  expect((await syncConnections(store, f.remote, NOW)).created).toBe(1);
  expect(store.listTasks().map((t) => t.title)).toEqual(['Send the vendor contract']);
  store.close();
});
