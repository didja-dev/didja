/**
 * SCR-88: opt-in agent hooks. Installed into made-up home folders only; events are made up.
 * Only the tool, event, time, a command line and exit code, and plan titles are ever kept.
 */
import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  agentHookInstalled, appendAgentEvent, HOOK_TOOLS, installAgentHook, parseHookEvent, readAgentEvents, removeAgentHook, TOOLS, withHooks, withoutHooks,
} from '../src/agenthooks.ts';
import type { AgentEvent } from '../src/agenthooks.ts';
import { formatWhy } from '../src/cli.ts';
import { pollOnce } from '../src/engine.ts';
import { Store } from '../src/store.ts';

const dirs: string[] = [];
function temp(): string {
  const d = mkdtempSync(join(tmpdir(), 'didja-hooks-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const ENGINE = '/Applications/Didja.app/Contents/Helpers/didja';

// Made-up files people may already have.
const EXISTING: Record<string, Record<string, unknown>> = {
  'claude-code': {
    permissions: { allow: ['Bash(npm test)'] },
    hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'prettier --write' }] }], Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] },
  },
  cursor: { version: 1, hooks: { afterFileEdit: [{ command: './format.sh' }], afterShellExecution: [{ command: './audit.sh' }] } },
  windsurf: { hooks: { pre_run_command: [{ command: 'echo pre' }] } },
};

for (const tool of HOOK_TOOLS) {
  test(`${tool}: on adds our entry once, keeps everything else, backs the file up; off takes out only ours`, () => {
    const home = temp();
    const path = join(home, TOOLS[tool].file);
    mkdirSync(join(path, '..'), { recursive: true });
    const before = `${JSON.stringify(EXISTING[tool], null, 2)}\n`;
    writeFileSync(path, before);
    expect(installAgentHook(tool, ENGINE, home)).toEqual({ file: path });
    const on = readFileSync(path, 'utf8');
    expect(readFileSync(`${path}.didja-backup`, 'utf8')).toBe(before);
    expect(on.split(` hook ${tool} `).length - 1).toBe(TOOLS[tool].events.length);
    expect(agentHookInstalled(tool, home)).toBe(true);
    // What was there is still there.
    for (const kept of ['prettier --write', 'say done', 'Bash(npm test)', './format.sh', './audit.sh', 'echo pre']) {
      if (before.includes(kept)) expect(on).toContain(kept);
    }
    // Twice changes nothing.
    installAgentHook(tool, ENGINE, home);
    expect(readFileSync(path, 'utf8')).toBe(on);
    removeAgentHook(tool, home);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(EXISTING[tool]!);
    expect(agentHookInstalled(tool, home)).toBe(false);
  });
}

test('the shape each tool reads: a Claude Code matcher group, a Cursor command with a version, a Windsurf command without output', () => {
  const claude = withHooks({}, 'claude-code', ENGINE) as { hooks: { PostToolUse: { matcher: string; hooks: { type: string; command: string }[] }[] } };
  expect(claude.hooks.PostToolUse[0]!.matcher).toBe('Bash|TodoWrite');
  expect(claude.hooks.PostToolUse[0]!.hooks[0]).toEqual({ type: 'command', command: `"${ENGINE}" hook claude-code PostToolUse` });
  expect(withHooks({}, 'cursor', ENGINE)).toEqual({ hooks: { afterShellExecution: [{ command: `"${ENGINE}" hook cursor afterShellExecution` }] }, version: 1 });
  expect(withHooks({}, 'windsurf', ENGINE)).toEqual({ hooks: { post_run_command: [{ command: `"${ENGINE}" hook windsurf post_run_command`, show_output: false }] } });
  // One tool's entries are never another's.
  const both = withHooks(withHooks({}, 'cursor', ENGINE), 'claude-code', ENGINE);
  expect(JSON.stringify(withoutHooks(both, 'claude-code'))).toContain('hook cursor');
});

test('a hooks file that is not JSON is left as it is', () => {
  const home = temp();
  const path = join(home, TOOLS.cursor.file);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, '{ not json');
  expect('error' in installAgentHook('cursor', ENGINE, home)).toBe(true);
  expect(readFileSync(path, 'utf8')).toBe('{ not json');
  removeAgentHook('cursor', home);
  expect(readFileSync(path, 'utf8')).toBe('{ not json');
});

const NOW = new Date('2026-11-12T10:30:00Z');
const SECRET = 'Pay Sam 20 for the Acme invoice';

test('only the tool, event, time, a command line and exit code, and plan titles are kept', () => {
  const claudeBash = parseHookEvent('claude-code', 'PostToolUse', {
    session_id: 's1', transcript_path: '/Users/x/.claude/projects/p/t.jsonl', cwd: '/Users/x/acme-web', hook_event_name: 'PostToolUse',
    tool_name: 'Bash', tool_input: { command: 'npm   test', description: SECRET }, tool_response: { stdout: SECRET, stderr: '', exit_code: 1 },
  }, NOW)!;
  expect(claudeBash).toEqual({ ts: NOW.toISOString(), tool: 'claude-code', event: 'PostToolUse', command: 'npm test', exit: 1 });
  const todo = parseHookEvent('claude-code', 'PostToolUse', {
    tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'Add the invoices table', status: 'completed', activeForm: SECRET }, { content: 'Write tests', status: 'pending' }] },
  }, NOW)!;
  expect(todo).toEqual({ ts: NOW.toISOString(), tool: 'claude-code', event: 'PostToolUse', plan: ['Add the invoices table', 'Write tests'] });
  expect(parseHookEvent('claude-code', 'PostToolUse', { tool_name: 'Read', tool_input: { file_path: '/x/secret.md' }, tool_response: { content: SECRET } }, NOW)).toBeNull();
  expect(parseHookEvent('claude-code', 'PostToolUse', { tool_name: 'Edit', tool_input: { file_path: 'a.ts', old_string: SECRET } }, NOW)).toBeNull();
  const cursor = parseHookEvent('cursor', 'afterShellExecution', { command: 'bun run db:push', output: SECRET, cwd: '/x', conversation_id: 'c' }, NOW)!;
  expect(Object.keys(cursor).sort()).toEqual(['command', 'event', 'tool', 'ts']);
  const windsurf = parseHookEvent('windsurf', 'post_run_command', { agent_action_name: 'post_run_command', tool_info: { command_line: 'git push origin main', cwd: '/x' }, trajectory_id: 't' }, NOW)!;
  expect(windsurf).toEqual({ ts: NOW.toISOString(), tool: 'windsurf', event: 'post_run_command', command: 'git push origin main' });
  for (const e of [claudeBash, todo, cursor, windsurf]) expect(JSON.stringify(e)).not.toContain('Sam');
});

test('the events keep 24 hours', () => {
  const path = join(temp(), 'agent-hooks.jsonl');
  appendAgentEvent(path, { ts: '2026-11-11T09:00:00.000Z', tool: 'cursor', event: 'afterShellExecution', command: 'old' });
  appendAgentEvent(path, { ts: '2026-11-12T10:00:00.000Z', tool: 'cursor', event: 'afterShellExecution', command: 'npm test' });
  expect(readAgentEvents(path, NOW).map((e) => e.command)).toEqual(['npm test']);
  expect(readFileSync(path, 'utf8')).not.toContain('old');
});

// --- Through the engine ------------------------------------------------------------------------------

const at = (min: number) => new Date(Date.parse('2026-11-12T10:00:00Z') + min * 60_000).toISOString();
function claudeCodeSteps(store: Store) {
  store.insertObservation({ ts: at(0), bundleId: 'com.mitchellh.ghostty', app: 'Ghostty', windowTitle: '✳ Setup', url: null, source: 'ax',
    text: ['> set it up', '⏺ On your side:', '  1. Run `npm run migrate`', '  2. Add the invoices table', '  3. Set STRIPE_KEY in the Vercel dashboard', '? for shortcuts'].join('\n') });
  store.insertObservation({ ts: at(0), bundleId: 'com.anthropic.claudefordesktop', app: 'Claude', windowTitle: 'Migrate', url: null, source: 'ax',
    text: '⟦Message 3⟧\nClaude responded: Apply the migration — run:\n`npm run migrate`' });
  pollOnce(store, new Date(at(0)), { agentLog: null });
}
const find = (store: Store, words: string, kind: string) => store.listTasks({ all: true }).find((t) => t.title.includes(words) && t.sourceKind === kind)!;

test("the agent's hook says it ran a step's command, or keeps it in its plan: that tool's step is taken back, never ticked", () => {
  const store = new Store(':memory:');
  claudeCodeSteps(store);
  const log = join(temp(), 'agent-hooks.jsonl');
  const events: AgentEvent[] = [
    { ts: at(2), tool: 'claude-code', event: 'PostToolUse', command: 'npm run migrate', exit: 0 },
    { ts: at(2), tool: 'claude-code', event: 'PostToolUse', plan: ['Add the invoices table'] },
  ];
  for (const e of events) appendAgentEvent(log, e);
  const stats = pollOnce(store, NOW, { agentLog: log });
  expect(stats.completed).toBe(0);
  const migrate = find(store, 'npm run migrate', 'claude-code');
  expect(migrate.status).toBe('dismissed');
  expect(formatWhy(migrate, store.listEvidence(migrate.id))).toContain('Claude Code ran this itself (its hook said so)');
  expect(find(store, 'invoices table', 'claude-code').status).toBe('dismissed');
  expect(find(store, 'STRIPE_KEY', 'claude-code').status).toBe('open');
  // The same command asked of you in the Claude app is yours: the hook does not touch it, nor tick it.
  expect(find(store, 'npm run migrate', 'claude-desktop').status).toBe('open');
  store.close();
});

test('a run the hook saw before the step, another tool, or no log changes nothing', () => {
  for (const events of [
    [{ ts: '2026-11-12T09:58:00.000Z', tool: 'claude-code', event: 'PostToolUse', command: 'npm run migrate' }],
    [{ ts: at(2), tool: 'cursor', event: 'afterShellExecution', command: 'npm run migrate' }],
    [],
  ] as AgentEvent[][]) {
    const store = new Store(':memory:');
    claudeCodeSteps(store);
    const log = join(temp(), 'agent-hooks.jsonl');
    for (const e of events) appendAgentEvent(log, e);
    pollOnce(store, NOW, { agentLog: log });
    expect(find(store, 'npm run migrate', 'claude-code').status).toBe('open');
    store.close();
  }
});

test('`didja hook` keeps only the listed fields, prints nothing and never fails the tool', () => {
  const dir = temp();
  const env = { ...process.env, DIDJA_DB: join(dir, 'didja.db') };
  const cli = join(import.meta.dir, '..', 'src', 'cli.ts');
  const run = (args: string[], input: string) => Bun.spawnSync(['bun', cli, 'hook', ...args], { env, stdin: Buffer.from(input) });
  const ok = run(['claude-code', 'PostToolUse'], JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { stdout: SECRET } }));
  expect(ok.exitCode).toBe(0);
  expect(ok.stdout.toString()).toBe('');
  expect(run(['claude-code', 'PostToolUse'], '{ not json').exitCode).toBe(0);
  expect(run(['nobody', 'x'], '{}').exitCode).toBe(0);
  const kept = readFileSync(join(dir, 'agent-hooks.jsonl'), 'utf8');
  expect(kept.trim().split('\n').length).toBe(1);
  expect(Object.keys(JSON.parse(kept)).sort()).toEqual(['command', 'event', 'tool', 'ts']);
  expect(kept).not.toContain('Sam');
  expect(existsSync(join(dir, 'didja.db'))).toBe(false); // the database is not even opened
});
