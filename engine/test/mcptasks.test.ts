/**
 * `didja mcp` task tools (SCR-120): your own Claude reads your open tasks, read-only, only while
 * their own switch is on; titles as they are, never kept lines, observations or evidence.
 */
import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keepTask } from '../src/engine.ts';
import type { McpDeps } from '../src/mcp.ts';
import { callTool, OFF_MESSAGE, readLog, TASK_TOOLS, TASKS_OFF_MESSAGE, tasksEnabled, toolsFor } from '../src/mcp.ts';
import { Store } from '../src/store.ts';

const NOW = new Date(2026, 10, 14, 10, 0);
const text = (r: { content: { text: string }[] }) => r.content[0]!.text;

function setup(opts: { tasks?: boolean; mcp?: boolean } = {}): McpDeps & { ids: Record<string, number> } {
  const dir = mkdtempSync(join(tmpdir(), 'didja-mcptasks-'));
  const store = new Store(':memory:');
  if (opts.tasks) store.setMeta('mcp_tasks', 'on');
  if (opts.mcp) store.setMeta('mcp_enabled', 'on');
  const ts = NOW.toISOString();
  const obs = store.insertObservation({ ts, bundleId: 'net.whatsapp.WhatsApp', app: 'WhatsApp', windowTitle: 'Dana', url: null, source: 'ax',
    text: '⟦Chat message: Dana (direct) — from Dana — 10:54⟧\nCan you send the signed contract by Thursday?\nAlso the private code 4417' });
  const add = (title: string, sourceKind: string, sourceRef: string, observationId: number | null = null) =>
    store.upsertTask({ distinct: title, title, sourceKind, sourceRef, why: 'Someone asked you in a direct chat', confidence: 1, position: null, ts, observationId, markers: [],
      criteria: { service: null, hosts: [] } }).id;
  const chat = add('Send Dana the signed contract', 'chat', 'WhatsApp — Dana', obs);
  store.setDue(chat, '2026-11-19');
  store.setOrigin(chat, ts, 'Origin note with Subject: Quarterly secret');
  const mail = add('Pay the Acme invoice', 'email', 'Mail — Inbox');
  store.setDue(mail, '2026-11-30');
  const snoozed = add('Book the venue', 'chat', 'Slack — #offsite');
  store.snooze(snoozed, new Date(NOW.getTime() + 86_400_000), NOW);
  const done = add('Already sent the deck', 'chat', 'WhatsApp — Sam');
  store.setStatus(done, 'done', NOW);
  const kept = keepTask(store, 'Renew the passport', NOW)!;
  return { store, places: { shared: join(dir, 's'), drafts: join(dir, 'd'), log: join(dir, 'mcp-log.jsonl'), app: null }, now: () => NOW,
    ids: { chat, mail, snoozed, done, kept } };
}

test('off by default: the task tools are not listed, and a call to one is refused and logged', () => {
  const d = setup({ mcp: true });
  expect(tasksEnabled(d.store)).toBe(false);
  const names = toolsFor(d.store).map((t) => t.name);
  for (const t of TASK_TOOLS) expect(names).not.toContain(t.name);
  for (const t of TASK_TOOLS) {
    const r = callTool(t.name, { id: d.ids.chat }, d);
    expect(r.isError).toBe(true);
    expect(text(r)).toBe(TASKS_OFF_MESSAGE);
    expect(text(r)).not.toContain('Send Dana');
  }
  expect(readLog(d.places).map((l) => l.tool)).toEqual(['list_tasks', 'task']);
});

test('the task switch is its own: on alone lists them, and the diagnostics tools stay off', () => {
  const d = setup({ tasks: true });
  const names = toolsFor(d.store).map((t) => t.name);
  expect(names).toContain('list_tasks');
  expect(names).toContain('task');
  expect(text(callTool('observations', { app: 'WhatsApp' }, d))).toBe(OFF_MESSAGE);
  expect(callTool('list_tasks', {}, d).isError).toBeUndefined();
});

test('list_tasks gives open and snoozed tasks with titles as they are, and nothing from the screen', () => {
  const d = setup({ tasks: true });
  const out = text(callTool('list_tasks', {}, d));
  const tasks = JSON.parse(out) as Record<string, unknown>[];
  expect(tasks.map((t) => t.title).sort()).toEqual(['Book the venue', 'Pay the Acme invoice', 'Renew the passport', 'Send Dana the signed contract']);
  const chat = tasks.find((t) => t.id === d.ids.chat)!;
  expect(Object.keys(chat).sort()).toEqual(['captured', 'checklist', 'due', 'id', 'snoozedUntil', 'source', 'status', 'title']);
  expect(chat).toMatchObject({ status: 'open', source: { kind: 'chat', name: 'WhatsApp — Dana' }, due: '2026-11-19' });
  expect(tasks.find((t) => t.id === d.ids.snoozed)!.status).toBe('snoozed');
  // No kept lines, observations or notes: not the rest of the message, not the origin note.
  for (const word of ['private code', '4417', 'Thursday?', 'Quarterly secret', 'Chat message']) expect(out).not.toContain(word);
});

test('list_tasks filters by source and by due day', () => {
  const d = setup({ tasks: true });
  const titles = (args: Record<string, unknown>) => (JSON.parse(text(callTool('list_tasks', args, d))) as { title: string }[]).map((t) => t.title).sort();
  expect(titles({ source: 'whatsapp' })).toEqual(['Send Dana the signed contract']);
  expect(titles({ source: 'EMAIL' })).toEqual(['Pay the Acme invoice']);
  expect(titles({ due_before: '2026-11-20' })).toEqual(['Send Dana the signed contract']);
  expect(titles({ due_before: '2026-12-01' })).toEqual(['Pay the Acme invoice', 'Send Dana the signed contract']);
  expect(callTool('list_tasks', { due_before: 'next week' }, d).isError).toBe(true);
});

test('task gives one open task with the reason the engine wrote, and nothing else', () => {
  const d = setup({ tasks: true });
  const out = text(callTool('task', { id: d.ids.chat }, d));
  const t = JSON.parse(out) as Record<string, unknown>;
  expect(t.title).toBe('Send Dana the signed contract');
  expect(t.why).toBe('Someone asked you in a direct chat');
  for (const word of ['private code', '4417', 'Quarterly secret']) expect(out).not.toContain(word);
  // Done tasks and unknown ids are not given.
  expect(callTool('task', { id: d.ids.done }, d).isError).toBe(true);
  expect(callTool('task', { id: 9999 }, d).isError).toBe(true);
});

test('reading changes nothing, and every call is logged with what was asked, not what was answered', () => {
  const d = setup({ tasks: true });
  const before = JSON.stringify(d.store.listTasks({ all: true }));
  callTool('list_tasks', { source: 'mail' }, d);
  callTool('task', { id: d.ids.kept }, d);
  expect(JSON.stringify(d.store.listTasks({ all: true }))).toBe(before);
  const log = readLog(d.places);
  expect(log.map((l) => l.tool)).toEqual(['list_tasks', 'task']);
  expect(log[0]!.args).toEqual({ source: 'mail' });
  expect(JSON.stringify(log)).not.toContain('Renew the passport');
});

test('`didja mcp tasks on|off` sets the switch, and status says so', () => {
  const dir = mkdtempSync(join(tmpdir(), 'didja-mcptasks-cli-'));
  const db = join(dir, 'didja.db');
  new Store(db).close();
  const cli = join(import.meta.dir, '..', 'src', 'cli.ts');
  const run = (...args: string[]) => Bun.spawnSync(['bun', cli, 'mcp', ...args], { env: { ...process.env, DIDJA_DB: db } });
  expect(run('tasks').stdout.toString().trim()).toBe('off');
  expect(run('tasks', 'on').exitCode).toBe(0);
  expect(JSON.parse(run('status', '--json').stdout.toString())).toMatchObject({ on: false, tasks: true });
  expect(run('tasks', 'off').exitCode).toBe(0);
  expect(run('tasks').stdout.toString().trim()).toBe('off');
  expect(run('tasks', 'sometimes').exitCode).toBe(1);
});
