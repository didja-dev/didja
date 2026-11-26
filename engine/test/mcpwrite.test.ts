/**
 * Changing your tasks from your own Claude over `didja mcp`: add, tick, reopen, dismiss, snooze,
 * rename, undo, and canvases. Behind a switch of its own (`mcp_tasks_write`), off by default, that
 * works only with the read switch on. Every change goes through the engine's rules and undo history,
 * is noted on the task, and is logged without its words.
 */
import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpDeps } from '../src/mcp.ts';
import { callTool, readLog, toolsFor, WRITE_OFF_MESSAGE, WRITE_TOOLS, writeEnabled } from '../src/mcp.ts';
import { Store } from '../src/store.ts';

const NOW = new Date(2026, 10, 26, 10, 0);
const text = (r: { content: { text: string }[] }) => r.content[0]!.text;
const json = (r: { content: { text: string }[]; isError?: boolean }) => {
  expect(r.isError).toBeUndefined();
  return JSON.parse(text(r));
};

function setup(opts: { read?: boolean; write?: boolean } = { read: true, write: true }): McpDeps & { ids: { deck: number; venue: number } } {
  const dir = mkdtempSync(join(tmpdir(), 'didja-mcpwrite-'));
  const store = new Store(':memory:');
  if (opts.read) store.setMeta('mcp_tasks', 'on');
  if (opts.write) store.setMeta('mcp_tasks_write', 'on');
  const ts = NOW.toISOString();
  const add = (title: string, sourceRef: string) =>
    store.upsertTask({ distinct: title, title, sourceKind: 'chat', sourceRef, why: 'Someone asked you', confidence: 1, position: null, ts,
      observationId: null, markers: [], criteria: { service: null, hosts: [] } }).id;
  const deck = add('Send Sam the deck', 'WhatsApp — Sam');
  const venue = add('Book the venue', 'Slack — #offsite');
  return { store, places: { shared: join(dir, 's'), drafts: join(dir, 'd'), log: join(dir, 'mcp-log.jsonl'), app: null }, now: () => NOW,
    ids: { deck, venue } };
}

test('off by default, and on only with the read switch too: not listed, and every call refused', () => {
  for (const opts of [{}, { read: true }, { write: true }]) {
    const d = setup(opts);
    expect(writeEnabled(d.store)).toBe(false);
    const names = toolsFor(d.store).map((t) => t.name);
    for (const t of WRITE_TOOLS) expect(names).not.toContain(t.name);
    const r = callTool('complete_task', { id: d.ids.deck }, d);
    expect(text(r)).toBe(WRITE_OFF_MESSAGE);
    expect(d.store.getTask(d.ids.deck)!.status).toBe('open');
    expect(text(callTool('add_task', { title: 'Sneaky' }, d))).toBe(WRITE_OFF_MESSAGE);
    expect(d.store.listTasks({ all: true }).some((t) => t.title === 'Sneaky')).toBe(false);
  }
  const d = setup();
  for (const t of WRITE_TOOLS) expect(toolsFor(d.store).map((x) => x.name)).toContain(t.name);
});

test('add a task: on the list as yours, noted as added by your Claude', () => {
  const d = setup();
  const r = json(callTool('add_task', { title: '  Call   Noa about the lease ' }, d));
  const task = d.store.getTask(r.id)!;
  expect(task).toMatchObject({ title: 'Call Noa about the lease', status: 'open', sourceKind: 'manual' });
  expect(r.canvas).toBeNull();
  expect(callTool('add_task', { title: '   ' }, d).isError).toBe(true);
});

test('make a canvas by name, then add to it by name: a new task, an existing one, a heading and a note', () => {
  const d = setup();
  const made = json(callTool('create_canvas', { name: 'Acme launch' }, d));
  expect(json(callTool('list_canvases', {}, d)).map((c: { name: string }) => c.name)).toEqual(['Acme launch']);
  const added = json(callTool('add_task', { title: 'Write the press note', canvas: 'acme launch' }, d));
  expect(added.canvas).toEqual({ id: made.id, name: 'Acme launch' });
  const more = json(callTool('add_to_canvas', { canvas: 'Acme', task_ids: [d.ids.deck], heading: 'Before Friday', note: 'Ask Dana first' }, d));
  expect(more.tasksAdded).toBe(1);
  const view = json(callTool('canvas', { canvas: made.id }, d));
  expect(view.items.map((i: { kind: string; title?: string; text?: string }) => i.title ?? i.text))
    .toEqual(['Write the press note', 'Send Sam the deck', 'Before Friday', 'Ask Dana first']);
  expect(view.items.find((i: { task?: number }) => i.task === d.ids.deck).status).toBe('open');
  // A name that is not there, or that matches two, is refused: nothing is guessed.
  json(callTool('create_canvas', { name: 'Acme hiring' }, d));
  expect(callTool('add_to_canvas', { canvas: 'Acme', title: 'Something' }, d).isError).toBe(true);
  expect(callTool('add_task', { title: 'Lost', canvas: 'Nowhere' }, d).isError).toBe(true);
  expect(d.store.listTasks({ all: true }).some((t) => t.title === 'Lost' || t.title === 'Something')).toBe(false);
  expect(callTool('add_to_canvas', { canvas: made.id }, d).isError).toBe(true);
});

test('tick, undo, reopen, dismiss, snooze and rename go through the engine and are noted on the task', () => {
  const d = setup();
  const { deck, venue } = d.ids;
  expect(json(callTool('complete_task', { id: deck }, d)).status).toBe('done');
  expect(d.store.listEvidence(deck).some((e) => e.kind === 'judged' && /by your Claude/.test(e.detail ?? ''))).toBe(true);
  // Undo, as Undo in the app.
  expect(json(callTool('undo_last', {}, d)).tasks).toEqual([deck]);
  expect(d.store.getTask(deck)!.status).toBe('open');
  json(callTool('complete_task', { id: deck }, d));
  expect(json(callTool('reopen_task', { id: deck }, d)).status).toBe('open');
  expect(json(callTool('dismiss_task', { id: venue }, d)).status).toBe('dismissed');
  json(callTool('reopen_task', { id: venue }, d));
  const snoozed = json(callTool('snooze_task', { id: venue, until: '2h' }, d));
  expect(snoozed.status).toBe('snoozed');
  expect(snoozed.until).toBe(new Date(NOW.getTime() + 2 * 3_600_000).toISOString());
  expect(callTool('snooze_task', { id: venue, until: 'someday' }, d).isError).toBe(true);
  expect(json(callTool('rename_task', { id: deck, title: 'Deck to Sam' }, d)).title).toBe('Deck to Sam');
  expect(json(callTool('rename_task', { id: deck, title: '' }, d)).title).toBe('Send Sam the deck');
  // A task that is not there: nothing changes.
  expect(text(callTool('complete_task', { id: 999 }, d))).toContain('No task #999');
});

test('the call log keeps tool names and ids, never the words your Claude wrote', () => {
  const d = setup();
  json(callTool('create_canvas', { name: 'Secret project Orion' }, d));
  json(callTool('add_task', { title: 'Wire money to Ron', canvas: 'Secret project Orion' }, d));
  json(callTool('complete_task', { id: d.ids.deck }, d));
  const raw = readFileSync(d.places.log, 'utf8');
  expect(raw).not.toContain('Orion');
  expect(raw).not.toContain('Wire money');
  expect(readLog(d.places).map((l) => l.tool)).toEqual(['create_canvas', 'add_task', 'complete_task']);
  expect(readLog(d.places)[2]!.args).toEqual({ id: String(d.ids.deck) });
});
