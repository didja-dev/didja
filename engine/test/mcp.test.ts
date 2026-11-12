/**
 * `didja mcp` (SCR-42): off until turned on, screen text masked, files only in its own folders,
 * every call logged.
 */
import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpDeps } from '../src/mcp.ts';
import { callTool, mask, OFF_MESSAGE, readLog, TOOLS, UI_WORDS } from '../src/mcp.ts';
import { Store } from '../src/store.ts';

const REPO = join(import.meta.dir, '..', '..');

function setup(on = true): McpDeps & { dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'didja-mcp-'));
  const store = new Store(':memory:');
  if (on) store.setMeta('mcp_enabled', 'on');
  const places = { shared: join(dir, 'Shared with Claude'), drafts: join(dir, 'Profile drafts'), log: join(dir, 'mcp-log.jsonl'), app: null };
  return { dir, store, places };
}
const text = (r: { content: { text: string }[] }) => r.content[0]!.text;

test('masking keeps the shape and the label words, never the content', () => {
  expect(mask('Message from Dana Levi, Can you call 054?, 9 October at 12:34')).toBe('Message from Xxxx Xxxx, Xxx you xxxx 000?, 0 October at 00:00');
  expect(mask('⟦Chat message: Dana (direct) — from me — 10:54⟧')).toBe('⟦Chat message: Xxxx (direct) — from me — 00:00⟧');
  expect(mask('שלום Dana 👍')).toBe('xxxx Xxxx 👍');
});

test('the label words are the same as the app keeps', () => {
  const swift = readFileSync(join(REPO, 'app/Capture/AXOutline.swift'), 'utf8') + readFileSync(join(REPO, 'app/Capture/Redactor.swift'), 'utf8');
  const sets = [...swift.matchAll(/(?:uiWords|didjaWords): Set<String> = \[([^\]]*)\]/g)].map((m) => m[1]!);
  const words = new Set(sets.join(',').match(/"([^"]+)"/g)!.map((w) => w.slice(1, -1)));
  expect(new Set(UI_WORDS)).toEqual(words);
});

test('while off, every tool refuses and gives nothing', () => {
  const d = setup(false);
  for (const tool of TOOLS) {
    const r = callTool(tool.name, { app: 'WhatsApp', name: 'x.txt', id: 'whatsapp', task: 1 }, d);
    expect(r.isError).toBe(true);
    expect(text(r)).toBe(OFF_MESSAGE);
  }
  expect(readLog(d.places).length).toBe(TOOLS.length); // asked, and logged
});

test('kept lines and a task\'s why come masked', () => {
  const d = setup();
  d.store.insertObservation({ ts: new Date().toISOString(), bundleId: 'net.whatsapp.WhatsApp', app: 'WhatsApp', windowTitle: 'WhatsApp', url: null, source: 'ax',
    text: '⟦Chat message: Dana Levi (direct) — from Dana Levi — 10:54⟧\nCan you send the contract?' });
  d.store.insertObservation({ ts: new Date().toISOString(), bundleId: 'com.apple.Notes', app: 'Notes', windowTitle: 'Notes', url: null, source: 'ax', text: 'Other app' });
  const out = text(callTool('observations', { app: 'whatsapp' }, d));
  expect(out).toBe('⟦Chat message: Xxxx Xxxx (direct) — from Xxxx Xxxx — 00:00⟧\nXxx you send the xxxxxxxx?');
  expect(out).not.toContain('Other');
  const id = d.store.upsertTask({ distinct: 'k', title: 'Send Dana the contract', sourceKind: 'chat', sourceRef: 'WhatsApp — Dana Levi', confidence: 1,
    position: null, ts: new Date().toISOString(), observationId: null, markers: [], criteria: { service: null, hosts: [] } }).id;
  const why = text(callTool('why', { task: id }, d));
  expect(why).not.toContain('Dana');
  expect(why).not.toContain('contract');
});

test('a missed task comes to Claude masked, sites kept', () => {
  const d = setup();
  const id = d.store.upsertTask({ distinct: 'm', title: 'Select Import holidays in the dialog', sourceKind: 'claude-code', sourceRef: 'Claude Code — Planner',
    confidence: 1, position: null, ts: new Date(Date.now() - 60_000).toISOString(), observationId: null, markers: [], criteria: { service: null, hosts: [] } }).id;
  d.store.insertObservation({ ts: new Date().toISOString(), bundleId: 'com.microsoft.edgemac', app: 'Microsoft Edge', windowTitle: 'Holidays – Acme',
    url: 'https://acme.example.com/holidays', source: 'ax', text: 'Import holidays\nDana Levi imported 12 holidays' });
  const r = JSON.parse(text(callTool('missed_report', { task: id }, d)));
  expect(r.places[0].site).toBe('acme.example.com');
  expect(JSON.stringify(r)).not.toContain('Dana');
  expect(JSON.stringify(r)).not.toContain('Acme');
  expect(r.places[0].recent[0].lines).toEqual(['Xxxxxx xxxxxxxx', 'Xxxx Xxxx xxxxxxxx 00 xxxxxxxx']);
});

test('reports are read only from their folder, by plain name', () => {
  const d = setup();
  mkdirSync(d.places.shared, { recursive: true });
  writeFileSync(join(d.places.shared, 'didja-diagnostics-whatsapp-2026-11-12.txt'), 'masked file');
  writeFileSync(join(d.dir, 'secret.txt'), 'not for Claude');
  expect(JSON.parse(text(callTool('list_reports', {}, d))).map((r: { name: string }) => r.name)).toEqual(['didja-diagnostics-whatsapp-2026-11-12.txt']);
  expect(text(callTool('read_report', { name: 'didja-diagnostics-whatsapp-2026-11-12.txt' }, d))).toBe('masked file');
  for (const name of ['../secret.txt', '/etc/passwd', 'secret.txt', '..']) expect(callTool('read_report', { name }, d).isError).toBe(true);
});

test('a drafted profile is checked, written only to the drafts folder, and its fixtures are run', () => {
  const d = setup();
  d.runCapture = () => ({ lines: ['⟦Chat message: Family (group) — from Ron Cohen — 9:50⟧', 'Mike, can you pick up the cake?', '⟦Page⟧'], matches: null, profile: 'acme-chat' });
  const bad = callTool('draft_profile', { profile: { id: 'Acme', rules: [] } }, d);
  expect(bad.isError).toBe(true);
  expect(existsSync(d.places.drafts)).toBe(false);
  const profile = { id: 'acme-chat', name: 'Acme Chat', kind: 'chat', about: 'A made-up chat app.', match: { bundleIds: ['com.example.acme'] },
    rules: [{ is: 'message', where: { identifier: { prefix: 'msg-' } }, from: 'title', body: { identifier: 'text' } }] };
  const fixture = { name: 'group', about: 'Ron asks you', app: 'com.example.acme', outline: ['AXWindow'], lines: [] };
  const r = JSON.parse(text(callTool('draft_profile', { profile, fixtures: [fixture] }, d)));
  expect(readdirSync(d.places.drafts).sort()).toEqual(['acme-chat.json', 'fixtures']);
  expect(readdirSync(join(d.places.drafts, 'fixtures'))).toEqual(['acme-chat-group.json']);
  expect(r.fixtures['acme-chat-group.json'].engine.open).toEqual(['Answer Ron Cohen']);
  expect(r.next).toContain('Show the user every file');
  const listed = JSON.parse(text(callTool('list_profiles', {}, d)));
  expect(listed.find((p: { id: string }) => p.id === 'acme-chat')).toMatchObject({ status: 'communityNew', draft: true });
  expect(JSON.parse(text(callTool('show_profile', { id: 'acme-chat' }, d))).name).toBe('Acme Chat');
  expect(callTool('test_profile', { fixture: '../acme-chat.json' }, d).isError).toBe(true);
});

test('the log keeps what was asked, never what was answered', () => {
  const d = setup();
  callTool('observations', { app: 'WhatsApp', count: 5 }, d);
  callTool('draft_profile', { profile: { id: 'x' } }, d);
  const log = readLog(d.places);
  expect(log.map((l) => l.tool)).toEqual(['observations', 'draft_profile']);
  expect(log[0]!.args).toEqual({ app: 'WhatsApp', count: '5' });
  expect(log[1]!.args).toEqual({ profile: '(object)' });
});

test('the server answers over stdio', async () => {
  const d = setup();
  const db = join(d.dir, 'didja.db');
  const store = new Store(db);
  store.setMeta('mcp_enabled', 'on');
  store.close();
  const proc = Bun.spawn(['bun', join(import.meta.dir, '..', 'src', 'cli.ts'), 'mcp'], {
    stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: { ...process.env, DIDJA_DB: db },
  });
  const send = (m: object) => proc.stdin.write(`${JSON.stringify(m)}\n`);
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_profiles', arguments: {} } });
  proc.stdin.end();
  const out = await new Response(proc.stdout).text();
  const replies = out.trim().split('\n').map((l) => JSON.parse(l));
  expect(replies.find((r) => r.id === 2).result.tools.map((t: { name: string }) => t.name)).toEqual(TOOLS.map((t) => t.name));
  const profiles = JSON.parse(replies.find((r) => r.id === 3).result.content[0].text);
  expect(profiles.map((p: { id: string }) => p.id)).toContain('whatsapp');
});
