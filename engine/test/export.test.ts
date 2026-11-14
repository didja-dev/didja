/** SCR-114: Export All Tasks. Every task, readable without Didja; no screen text unless asked for. */
import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addManualTask, pollOnce } from '../src/engine.ts';
import { EXPORT_FORMAT, exportJson, exportMarkdown, exportTasks } from '../src/export.ts';
import { Store } from '../src/store.ts';

const CHECKLIST = `Claude responded: Before this works in prod:
Before this works in prod:
1. Set STRIPE_WEBHOOK_SECRET in Vercel prod
2. Run the migration with supabase db push
3. Add the redirect URL in Supabase auth settings`;

const NOW = new Date('2026-11-10T10:05:00Z');

function seeded(): Store {
  const store = new Store(':memory:');
  store.insertObservation({
    ts: '2026-11-10T10:00:00.000Z', bundleId: 'com.anthropic.claudefordesktop', app: 'Claude',
    windowTitle: 'Stripe webhooks', url: null, source: 'ax', text: CHECKLIST,
  });
  pollOnce(store, NOW);
  const own = addManualTask(store, 'Call Noa about the Acme invoice', NOW)!;
  const dismissed = addManualTask(store, 'Not a real to-do', NOW)!;
  store.setStatus(dismissed, 'dismissed', NOW);
  store.rename(own, 'Call Noa', NOW);
  const migration = store.listTasks().find((t) => t.title.startsWith('Run the migration'))!;
  store.setStatus(migration.id, 'done', new Date('2026-11-10T11:00:00Z'));
  return store;
}

test('every task is exported, with its title, status, source, dates and why', () => {
  const store = seeded();
  const data = exportTasks(store, { now: NOW });
  expect(data.app).toBe('Didja');
  expect(data.format).toBe(EXPORT_FORMAT);
  expect(data.withContext).toBe(false);
  const titles = data.tasks.map((t) => t.title);
  // The checklist, its three steps, your own task (renamed) and the dismissed one: nothing left out.
  expect(data.tasks.length).toBe(store.listTree({ all: true }).flatMap(function walk(n): unknown[] { return [n, ...n.children.flatMap(walk)]; }).length);
  expect(titles).toContain('Call Noa');
  expect(titles).toContain('Not a real to-do');
  const step = data.tasks.find((t) => t.title.startsWith('Run the migration'))!;
  expect(step.status).toBe('done');
  expect(step.doneAt).not.toBeNull();
  expect(step.parentId).not.toBeNull();
  expect(data.tasks.find((t) => t.id === step.parentId)!.checklist).toBe(true);
  expect(step.source.kind).toBe('claude-desktop');
  expect(step.source.name).toContain('Claude');
  expect(step.why).toContain('supabase db push');
  const renamed = data.tasks.find((t) => t.title === 'Call Noa')!;
  expect(renamed.capturedTitle).toBe('Call Noa about the Acme invoice');
  expect(data.tasks.find((t) => t.title === 'Not a real to-do')!.status).toBe('dismissed');
  store.close();
});

test('no screen text unless asked for: the kept lines come only with context', () => {
  const store = seeded();
  const plain = exportJson(exportTasks(store, { now: NOW }));
  expect(plain).not.toContain('1. Set STRIPE_WEBHOOK_SECRET'); // the line as it was on screen
  expect(plain).not.toContain('"context"');
  expect(exportMarkdown(exportTasks(store, { now: NOW }))).not.toContain('How it looked');

  const full = exportTasks(store, { context: true, now: NOW });
  expect(full.withContext).toBe(true);
  const open = full.tasks.find((t) => t.title.startsWith('Set STRIPE_WEBHOOK_SECRET'))!;
  expect(open.context!.app).toBe('Claude');
  expect(open.context!.lines).toContain('1. Set STRIPE_WEBHOOK_SECRET in Vercel prod');
  // A done task's lines are gone from the database, so none are exported for it.
  expect(full.tasks.find((t) => t.title.startsWith('Run the migration'))!.context).toBeNull();
  expect(exportMarkdown(full)).toContain('> 1. Set STRIPE_WEBHOOK_SECRET in Vercel prod');
  store.close();
});

test('JSON reads back as the same data', () => {
  const store = seeded();
  const data = exportTasks(store, { now: NOW });
  expect(JSON.parse(exportJson(data))).toEqual(data);
  store.close();
});

test('Markdown: by status, then by where it came from, steps under their checklist', () => {
  const store = seeded();
  const md = exportMarkdown(exportTasks(store, { now: NOW }));
  expect(md.startsWith('# Didja tasks\n')).toBe(true);
  const open = md.indexOf('## Open');
  const done = md.indexOf('## Done');
  const dismissed = md.indexOf('## Dismissed');
  expect(open).toBeGreaterThan(0);
  expect(done).toBeGreaterThan(open);
  expect(dismissed).toBeGreaterThan(done);
  expect(md).toContain('  - [ ] Set STRIPE_WEBHOOK_SECRET in Vercel prod');
  expect(md).toMatch(/- \[x\] Run the migration with supabase db push — made 2026-11-10, done 2026-11-10/);
  expect(md).toContain('- [ ] Not a real to-do (dismissed)');
  expect(md).toContain('Captured as: “Call Noa about the Acme invoice”');
  store.close();
});

test('an empty Didja exports an empty list, not an error', () => {
  const store = new Store(':memory:');
  const data = exportTasks(store, { now: NOW });
  expect(data.tasks).toEqual([]);
  expect(exportMarkdown(data)).toContain('0 tasks');
  store.close();
});

test('`didja export --out` writes a file only you can read, and changes no task', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'didja-export-'));
  const db = join(dir, 'didja.db');
  const store = new Store(db);
  addManualTask(store, 'Send the deck to Sam', NOW);
  const before = JSON.stringify(store.listTasks({ all: true }));
  store.close();
  const out = join(dir, 'tasks.json');
  const run = Bun.spawnSync(['bun', join(import.meta.dir, '..', 'src', 'cli.ts'), 'export', 'json', '--out', out], {
    env: { ...process.env, DIDJA_DB: db },
  });
  expect(run.exitCode).toBe(0);
  const written = JSON.parse(readFileSync(out, 'utf8'));
  expect(written.tasks.map((t: { title: string }) => t.title)).toEqual(['Send the deck to Sam']);
  expect(statSync(out).mode & 0o777).toBe(0o600);
  const again = new Store(db);
  expect(JSON.stringify(again.listTasks({ all: true }))).toBe(before);
  again.close();
});

test('a large export printed to a pipe arrives whole', () => {
  const dir = mkdtempSync(join(tmpdir(), 'didja-export-'));
  const db = join(dir, 'didja.db');
  const store = new Store(db);
  // 600 tasks are well over the 128 KB a pipe took before the CLI exited (about 500 bytes each).
  for (let i = 0; i < 600; i++) addManualTask(store, `Send the Acme report part ${i} to Sam before the review`, NOW);
  store.close();
  // Through a real pipe (`| cat`), the way a terminal user reads it: the CLI exits as soon as it is done.
  const cli = join(import.meta.dir, '..', 'src', 'cli.ts');
  const run = Bun.spawnSync(['sh', '-c', `"${process.execPath}" "${cli}" export json | cat`], { env: { ...process.env, DIDJA_DB: db } });
  expect(run.exitCode).toBe(0);
  expect(run.stdout.length).toBeGreaterThan(200 * 1024);
  expect(JSON.parse(run.stdout.toString()).tasks.length).toBe(600);
}, 30_000); // a slow CI machine makes the tasks slowly
