import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { addManualTask, keepTask } from '../src/engine.ts';
import { describeForget, forget, LOG_FILES, withoutSince } from '../src/forget.ts';
import type { ForgetResult } from '../src/forget.ts';
import { Store } from '../src/store.ts';

const NOW = new Date('2026-11-14T10:00:00Z');
const OLD = '2026-11-14T08:00:00.000Z';   // two hours ago
const RECENT = '2026-11-14T09:40:00.000Z'; // twenty minutes ago

/** Every store Forget can reach, with one old row and one from the last hour where it has a time. */
function seeded(): { store: Store; db: Database; dir: string; ids: Record<string, number> } {
  const store = new Store(':memory:');
  const db = (store as unknown as { db: Database }).db;
  const dir = mkdtempSync(join(tmpdir(), 'didja-forget-'));
  const obs = (ts: string) => store.insertObservation({ ts, bundleId: 'com.example.app', app: 'Example', windowTitle: 'Window', url: null, source: 'ax', text: 'Please send the report' });
  const o1 = obs(OLD);
  const o2 = obs(RECENT);
  const task = (title: string, ts: string, obsId: number) => store.upsertTask({ title, sourceKind: 'claude', sourceRef: 'Claude — Plan', confidence: 1, position: null, ts, observationId: obsId }).id;
  const oldTask = task('Send the old report', OLD, o1);
  const newTask = task('Send the new report', RECENT, o2);
  const manual = addManualTask(store, 'Call the bank')!;
  const kept = keepTask(store, 'Water the plants')!;
  const ctx = (id: number, at: string) => db.query("INSERT OR REPLACE INTO task_context (task_id, app, lines, captured_at) VALUES (?, 'Example', '[]', ?)").run(id, at);
  ctx(oldTask, OLD);
  ctx(newTask, RECENT);
  db.query("UPDATE tasks SET criteria_model = '{}' WHERE id IN (?, ?)").run(oldTask, newTask);
  db.query("INSERT INTO lesson_notes (job, kind, key, example, created_at) VALUES ('lists', 'not-an-action', 'k', 'x', ?)").run(OLD);
  db.query("INSERT INTO lessons (job, kind, key, example, created_at) VALUES ('lists', 'not-an-action', 'k', 'x', ?)").run(OLD);
  db.query("INSERT INTO outcomes (task_id, ts, outcome) VALUES (?, ?, 'ticked')").run(oldTask, OLD);
  db.query("INSERT INTO trust_events (key, kind, ts) VALUES ('k', 'yes', ?)").run(OLD);
  db.query("INSERT INTO done_places (task_id, site, created_at) VALUES (?, 'example.com', ?)").run(oldTask, OLD);
  db.query("INSERT INTO timings (task_id, event, path, engine_at, shown_at) VALUES (?, 'task', 'fast', ?, ?)").run(oldTask, OLD, OLD);
  db.query("INSERT INTO capture_outcomes (ts, last_ts, bundle_id, app, result) VALUES (?, ?, 'com.example.app', 'Example', 'read')").run(OLD, OLD);
  db.query("INSERT INTO engine_drops (hour, source, reason, n) VALUES ('2026-11-14T08', 'claude', 'chrome', 1)").run();
  db.query("INSERT INTO judgements (key, audience, model, created_at) VALUES ('k', 'user', 'apple', ?)").run(OLD);
  db.query("INSERT INTO email_checks (key, verdict, created_at) VALUES ('k', 'none', ?)").run(OLD);
  db.query("INSERT INTO looks_done_checks (key, task_id, verdict, created_at) VALUES ('k', ?, 'no', ?)").run(oldTask, OLD);
  db.query("INSERT INTO merge_suggestions (task_id, other_id, created_at) VALUES (?, ?, ?)").run(oldTask, newTask, OLD);
  db.query("INSERT INTO brain_jobs (job, instructions, updated_at) VALUES ('lists', 'Mine', ?)").run(OLD);
  const wait = (at: string, key: string) => db.query(`INSERT INTO waiting (key, via, app, place, who, direct, title, asked_at, quiet_until, status, created_at)
    VALUES (?, 'chat', 'WhatsApp', 'Sam Carter', 'Sam Carter', 1, 'Waiting on Sam: the invoice', ?, ?, 'waiting', ?)`).run(key, at, at, at);
  wait(OLD, 'w-old');
  wait(RECENT, 'w-new');
  // Logs: one line two hours ago and one twenty minutes ago in each, plus a line with no time.
  const secs = (iso: string) => Math.floor(Date.parse(iso) / 1000);
  writeFileSync(join(dir, 'shell.log'), `${secs(OLD)}\t0\tabc\tgit status\n${secs(RECENT)}\t0\tabc\tgit push\nnot a line\n`);
  for (const f of ['agent-hooks.jsonl', 'mcp-log.jsonl']) writeFileSync(join(dir, f), `${JSON.stringify({ ts: OLD, tool: 'x' })}\n${JSON.stringify({ ts: RECENT, tool: 'y' })}\n`);
  return { store, db, dir, ids: { oldTask, newTask, manual, kept } };
}

const count = (db: Database, table: string, where = '1') => (db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n;
const DERIVED = ['lesson_notes', 'lessons', 'outcomes', 'trust_events', 'done_places', 'timings', 'capture_outcomes', 'engine_drops', 'judgements', 'email_checks', 'looks_done_checks', 'merge_suggestions'];

test('captured text only: observations and kept lines go; everything learned, the logs and the tasks stay (SCR-104)', () => {
  const { store, db, dir } = seeded();
  const r = forget(store, dir, 'captured', { now: NOW });
  expect(count(db, 'observations')).toBe(0);
  expect(count(db, 'task_context')).toBe(0);
  for (const t of DERIVED) expect({ t, n: count(db, t) }).toEqual({ t, n: 1 });
  expect(count(db, 'tasks')).toBe(4);
  expect(count(db, 'tasks', 'criteria_model IS NOT NULL')).toBe(2);
  for (const f of LOG_FILES) expect(existsSync(join(dir, f))).toBe(true);
  expect(r.cleared.map((c) => [c.store, c.removed])).toEqual([['observations', 2], ['task_context', 2]]);
});

test('everything Didja learned: every derived store and the three logs are emptied; tasks and your own instructions stay (SCR-104)', () => {
  const { store, db, dir } = seeded();
  const r = forget(store, dir, 'everything', { now: NOW });
  for (const t of ['observations', 'task_context', ...DERIVED]) expect({ t, n: count(db, t) }).toEqual({ t, n: 0 });
  expect(count(db, 'tasks', 'criteria_model IS NOT NULL')).toBe(0);
  for (const f of LOG_FILES) expect(existsSync(join(dir, f))).toBe(false);
  // Tasks and Waiting on are kept without --tasks; instructions you wrote are not "learned".
  expect(count(db, 'tasks')).toBe(4);
  expect(count(db, 'waiting')).toBe(2);
  expect(count(db, 'brain_jobs')).toBe(1);
  // Every store it touched is listed, with what went.
  const listed = Object.fromEntries(r.cleared.map((c) => [c.store, c.removed]));
  expect(listed).toMatchObject({ observations: 2, task_context: 2, lessons: 1, criteria: 2, outcomes: 1, trust_events: 1, done_places: 1,
    timings: 1, capture_outcomes: 1, engine_drops: 1, verdicts: 3, merge_suggestions: 1, 'shell.log': 3, 'agent-hooks.jsonl': 2, 'mcp-log.jsonl': 2 });
  expect(r.cleared.every((c) => c.label.length > 0)).toBe(true);
  // How Didja Is Doing starts counting again from the moment of forgetting.
  expect(store.getMeta('outcomes_since')).toBe(NOW.toISOString());
  expect(store.getMeta('timings_since')).toBe(NOW.toISOString());
});

test('with tasks: captured tasks and Waiting on go; My List, your own and connected items stay (SCR-104)', () => {
  const { store, db, dir, ids } = seeded();
  const r = forget(store, dir, 'everything', { tasks: true, now: NOW });
  const left = (db.query('SELECT id FROM tasks ORDER BY id').all() as { id: number }[]).map((x) => x.id);
  expect(left).toEqual([ids.manual!, ids.kept!].sort((a, b) => a - b));
  expect(count(db, 'waiting')).toBe(0);
  expect(count(db, 'evidence', `task_id IN (${ids.oldTask}, ${ids.newTask})`)).toBe(0);
  expect(r.cleared.find((c) => c.store === 'tasks')?.removed).toBe(2);
});

test('the last hour: only text, kept lines and log lines from the last 60 minutes go; nothing older is touched (SCR-104)', () => {
  const { store, db, dir, ids } = seeded();
  const r = forget(store, dir, 'hour', { now: NOW });
  expect((db.query('SELECT ts FROM observations').all() as { ts: string }[]).map((x) => x.ts)).toEqual([OLD]);
  expect((db.query('SELECT task_id FROM task_context').all() as { task_id: number }[]).map((x) => x.task_id)).toEqual([ids.oldTask!]);
  for (const t of DERIVED) expect({ t, n: count(db, t) }).toEqual({ t, n: 1 });
  expect(count(db, 'tasks')).toBe(4);
  expect(count(db, 'waiting')).toBe(2);
  expect(count(db, 'tasks', 'criteria_model IS NOT NULL')).toBe(2);
  // The old line and the line with no time stay; the recent one goes.
  expect(readFileSync(join(dir, 'shell.log'), 'utf8')).toBe(`${Math.floor(Date.parse(OLD) / 1000)}\t0\tabc\tgit status\nnot a line\n`);
  for (const f of ['agent-hooks.jsonl', 'mcp-log.jsonl']) expect(readFileSync(join(dir, f), 'utf8')).toBe(`${JSON.stringify({ ts: OLD, tool: 'x' })}\n`);
  expect(r.since).toBe('2026-11-14T09:00:00.000Z');
  expect(Object.fromEntries(r.cleared.map((c) => [c.store, c.removed]))).toEqual({ observations: 1, task_context: 1, 'shell.log': 1, 'agent-hooks.jsonl': 1, 'mcp-log.jsonl': 1 });
});

test('the last hour with tasks: only tasks captured in that hour go (SCR-104)', () => {
  const { store, db, dir, ids } = seeded();
  // Your own task was added just now: it stays all the same.
  forget(store, dir, 'hour', { tasks: true, now: NOW });
  const left = (db.query('SELECT id FROM tasks ORDER BY id').all() as { id: number }[]).map((x) => x.id);
  expect(left).toEqual([ids.oldTask!, ids.manual!, ids.kept!].sort((a, b) => a - b));
  expect((db.query('SELECT key FROM waiting').all() as { key: string }[]).map((x) => x.key)).toEqual(['w-old']);
});

test('what was cleared is kept for Privacy and read back by `forget last` (SCR-104)', () => {
  const { store, dir } = seeded();
  const r = forget(store, dir, 'hour', { tasks: true, now: NOW });
  const saved = JSON.parse(store.getMeta('last_forget')!) as ForgetResult;
  expect(saved).toEqual(r);
  const words = describeForget(saved);
  expect(words.split('\n')[0]).toBe('Forgot the last hour, with tasks:');
  expect(words).toContain('Captured text: 1 removed');
  expect(words).toContain('Commands you ran (shell.log): 1 removed');
});

test('a log line that does not say when it was written is never taken by "the last hour" (SCR-104)', () => {
  const since = new Date('2026-11-14T09:00:00Z');
  expect(withoutSince('mcp-log.jsonl', '{"tool":"x"}\nnot json\n', since)).toEqual({ text: '{"tool":"x"}\nnot json\n', removed: 0 });
  expect(withoutSince('shell.log', '', since)).toEqual({ text: '', removed: 0 });
});
