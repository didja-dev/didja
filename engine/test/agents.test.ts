/**
 * SCR-85: what an AI agent did itself, by its profile. Approval prompts it ran, "Ran …" lines and
 * its own todo list mark steps as the agent's; a command you declined is yours; nothing the agent
 * did ever ticks a task of yours. Made-up sessions and fixtures only.
 */
import { afterEach, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentCommands, agentTodos, ranByAgent, ranCommand, todoKey } from '../src/agents.ts';
import { readAssistants, useAssistants } from '../src/assistants.ts';
import { formatWhy } from '../src/cli.ts';
import { pollOnce } from '../src/engine.ts';
import { Store } from '../src/store.ts';

const DIR = join(import.meta.dir, '..', '..', 'profiles');
const ALL = readAssistants(join(DIR, 'assistants'));
const tool = (id: string) => ALL.find((a) => a.id === id)!;

interface AgentFixture {
  about: string;
  profile: string;
  lines: string[];
  expect: { assistant: string; agent?: { ran: string[]; declined: string[]; todos: string[] } };
}
const FIXTURES = readdirSync(join(DIR, 'fixtures', 'assistants')).filter((n) => n.endsWith('.json')).sort()
  .map((name) => ({ name, f: JSON.parse(readFileSync(join(DIR, 'fixtures', 'assistants', name), 'utf8')) as AgentFixture }))
  .filter(({ f }) => f.expect.agent);

afterEach(() => useAssistants(null));

test('every agent that runs commands has a fixture of what it ran, declined or keeps as its todo list', () => {
  const covered = new Set(FIXTURES.map(({ f }) => f.profile));
  for (const id of ['claude-code', 'codex', 'copilot-cli', 'gemini-cli', 'aider', 'opencode', 'vscode-copilot', 'cursor']) {
    expect({ id, covered: covered.has(id) }).toEqual({ id, covered: true });
  }
});

for (const { name, f } of FIXTURES) {
  test(`agent fixture ${name}: ${f.about}`, () => {
    const a = tool(f.profile);
    const text = f.lines.join('\n');
    const done = agentCommands(a, text);
    expect(done.filter((d) => d.how === 'ran').map((d) => d.command)).toEqual(f.expect.agent!.ran);
    expect(done.filter((d) => d.how === 'declined').map((d) => d.command)).toEqual(f.expect.agent!.declined);
    expect([...agentTodos(a, text)].sort()).toEqual([...f.expect.agent!.todos].sort());
  });
}

test('a "ran" line names its command in each tool\'s shape; one without a command names none', () => {
  expect(ranCommand('● Bash(bun run db:push)')).toBe('bun run db:push');
  expect(ranCommand('⏺ Bash(cd /tmp/acme && bun run migrate)')).toBe('cd /tmp/acme && bun run migrate');
  expect(ranCommand('• Ran git push origin main')).toBe('git push origin main');
  expect(ranCommand('✔ Shell npm install zod')).toBe('npm install zod');
  expect(ranCommand('Running npm run lint')).toBe('npm run lint');
  expect(ranCommand('Ran `npm run build`')).toBe('npm run build');
  expect(ranCommand('Ran terminal command: bun test')).toBe('bun test');
  expect(ranCommand('● Run tests (shell)')).toBeNull();
  expect(ranCommand('    ✓ • 5ms')).toBeNull();
  expect(ranCommand('  └ 12 passed')).toBeNull();
});

test('a prompt still waiting for your answer is neither ran nor declined', () => {
  const codex = tool('codex');
  const waiting = ['• Would you like to run the following command?', '  $ git push origin main', '› 1. Yes, proceed', '  2. No, and tell Codex what to do differently'].join('\n');
  expect(agentCommands(codex, waiting)).toEqual([]);
});

test('a command the agent ran before the step was listed does not take the step back', () => {
  const item = { title: 'Run `npm test`', fragments: ['`npm test`'] };
  expect(ranByAgent(item, [{ command: 'npm test', line: 2, how: 'ran' }], 5)).toBe(false);
  expect(ranByAgent(item, [{ command: 'npm test', line: 7, how: 'ran' }], 5)).toBe(true);
  expect(ranByAgent(item, [{ command: 'cd web && npm test --watch=false', line: 7, how: 'ran' }], 5)).toBe(true);
  expect(ranByAgent(item, [{ command: 'npm test', line: 7, how: 'declined' }], 5)).toBe(false);
  expect(ranByAgent(item, [{ command: 'npm testing', line: 7, how: 'ran' }], 5)).toBe(false);
  expect(todoKey('☐ Write the tests!')).toBe('write the tests');
});

// --- End to end, through the engine --------------------------------------------------------------

const NOW = new Date('2026-11-12T10:10:00Z');
const at = (min: number) => new Date(Date.parse('2026-11-12T10:00:00Z') + min * 60_000).toISOString();
function observe(store: Store, bundleId: string, app: string, windowTitle: string, lines: string[], min: number) {
  store.insertObservation({ ts: at(min), bundleId, app, windowTitle, url: null, source: 'ax', text: lines.join('\n') });
}
const iterm = (store: Store, title: string, lines: string[], min: number) => observe(store, 'com.googlecode.iterm2', 'iTerm2', title, lines, min);
const shell = (store: Store, lines: string[], min: number) => observe(store, 'com.apple.Terminal', 'Terminal', 'zsh', lines, min);
const titles = (store: Store) => store.listTasks().map((t) => t.title);
const byTitle = (store: Store, words: string) => store.listTasks({ all: true }).find((t) => t.title.includes(words));

const CODEX_LIST = ['codex', ['>_ OpenAI Codex (v0.0.0)', '• Done. Next steps for you:', '  1. Run `npm test`', '  2. Set STRIPE_KEY in the Vercel dashboard']] as const;

test('Codex runs a listed step after you approve it: taken back as Codex\'s, with why, never ticked', () => {
  useAssistants(ALL);
  const store = new Store(':memory:');
  iterm(store, CODEX_LIST[0], [...CODEX_LIST[1]], 0);
  pollOnce(store, NOW);
  expect(titles(store)).toEqual(['Run `npm test`', 'Set STRIPE_KEY in the Vercel dashboard']);
  iterm(store, 'codex', ['• Would you like to run the following command?', '  $ npm test', '› 1. Yes, proceed',
    '  2. No, and tell Codex what to do differently', '• Ran npm test', '  └ 31 passing', '    ✓ • 5ms'], 2);
  const stats = pollOnce(store, NOW);
  expect(stats.completed).toBe(0);
  expect(titles(store)).toEqual(['Set STRIPE_KEY in the Vercel dashboard']);
  const ran = byTitle(store, 'npm test')!;
  expect(ran.status).toBe('dismissed');
  expect(formatWhy(ran, store.listEvidence(ran.id))).toContain('Codex ran this itself');
  store.close();
});

test('a command you decline stays yours, with the command as marker; you run it later and it ticks', () => {
  useAssistants(ALL);
  const store = new Store(':memory:');
  iterm(store, 'codex', ['>_ OpenAI Codex (v0.0.0)', '• Would you like to run the following command?', '  $ git push origin main',
    '  1. Yes, proceed', '› 2. No, and tell Codex what to do differently', '• Okay, I won\'t push.'], 0);
  pollOnce(store, NOW);
  expect(titles(store)).toEqual(['Run `git push origin main`']);
  shell(store, ['mike@mac acme-web % git push origin main', 'To github.com:acme/widgets.git', '   a1b2c3d..e4f5a6b  main -> main', 'mike@mac acme-web % '], 4);
  pollOnce(store, NOW);
  expect(byTitle(store, 'git push')!.status).toBe('done');
  store.close();
});

test('a command you declined and then let the agent run is the agent\'s after all', () => {
  useAssistants(ALL);
  const store = new Store(':memory:');
  const declined = ['aider> add an index', 'npm run migrate', "Run shell command? (Y)es/(N)o/(D)on't ask again [Yes]: n"];
  observe(store, 'com.apple.Terminal', 'Terminal', 'aider', declined, 0);
  pollOnce(store, NOW);
  expect(titles(store)).toEqual(['Run `npm run migrate`']);
  observe(store, 'com.apple.Terminal', 'Terminal', 'aider', ['aider> ok, run it', 'npm run migrate',
    "Run shell command? (Y)es/(N)o/(D)on't ask again [Yes]: y", 'Running npm run migrate', 'Applied 0008_orders_index.sql'], 3);
  const stats = pollOnce(store, NOW);
  expect(stats.completed).toBe(0);
  expect(titles(store)).toEqual([]);
  expect(byTitle(store, 'npm run migrate')!.status).toBe('dismissed');
  store.close();
});

test('an approved command the agent runs, with no step for it, makes no task', () => {
  useAssistants(ALL);
  const store = new Store(':memory:');
  observe(store, 'dev.warp.Warp-Stable', 'Warp', 'gemini', ['✦ I\'ll install the dependencies.', 'Allow execution of [Shell]?', '  npm install zod',
    '● 1. Yes, allow once', '  2. Yes, allow always', '  3. No (esc)', '✔ Shell npm install zod', '  added 1 package in 2s'], 0);
  pollOnce(store, NOW);
  expect(store.listTasks({ all: true })).toEqual([]);
  store.close();
});

test("the approval prompt's options are not a list, and do not hide the step after them", () => {
  useAssistants(ALL);
  const store = new Store(':memory:');
  iterm(store, 'copilot', ['Do you want to run this command?', '  npm test', '❯ 1. Yes', '  2. No, and tell Copilot what to do differently (Esc)',
    '● Run tests (shell)', '  └ 12 passed', '● All green. One thing left for you:', '  1. Add the NPM_TOKEN secret to the repository on GitHub'], 0);
  pollOnce(store, NOW);
  expect(titles(store)).toEqual(['Add the NPM_TOKEN secret to the repository on GitHub']);
  store.close();
});

test("the agent's todo items never become tasks, nor does a step worded like one; your other steps do", () => {
  useAssistants(ALL);
  const store = new Store(':memory:');
  observe(store, 'dev.warp.Warp-Stable', 'Warp', 'gemini', ['✦ Working on it.', 'Todo 1/2 completed', '✔ Add the schema', '○ Wire up the route',
    '✦ Next steps for you:', '  1. Wire up the route', '  2. Set DATABASE_URL in Vercel'], 0);
  pollOnce(store, NOW);
  expect(store.listTasks({ all: true }).map((t) => t.title)).toEqual(['Set DATABASE_URL in Vercel']);
  store.close();
});

// --- Never a wrong tick (CLAUDE.md): nothing the agent did ticks a task of yours --------------------

const CLAUDE_STEP = ['⟦Message 2⟧', 'You said: how do I check the build?', '⟦Message 3⟧', 'Claude responded: Check it yourself — run:', '`npm run build`'];
function yourBuildTask(store: Store) {
  observe(store, 'com.anthropic.claudefordesktop', 'Claude', 'Build', CLAUDE_STEP, 0);
  pollOnce(store, NOW);
  expect(titles(store).some((t) => t.includes('npm run build'))).toBe(true);
}

test("an agent's \"Ran\" and ✓ for the same command never tick your task", () => {
  useAssistants(ALL);
  const store = new Store(':memory:');
  yourBuildTask(store);
  iterm(store, 'codex', ['>_ OpenAI Codex (v0.0.0)', '• Ran npm run build', '  └ Build succeeded.', '    ✓ • 820ms'], 2);
  const stats = pollOnce(store, NOW);
  expect(stats.completed).toBe(0);
  const task = byTitle(store, 'npm run build')!;
  expect(task.status).toBe('open');
  expect(task.suggestion ?? null).toBeNull();
  store.close();
});

test('an approval panel, or an editor agent\'s "Ran" card with its output, never ticks your task', () => {
  useAssistants(ALL);
  const store = new Store(':memory:');
  yourBuildTask(store);
  iterm(store, 'copilot', ['Do you want to run this command?', '  npm run build', '❯ 1. Yes', '  2. No, and tell Copilot what to do differently (Esc)'], 1);
  observe(store, 'com.microsoft.VSCode', 'Code', 'acme-web', ['⟦Chat⟧', 'Run zsh command?', 'npm run build', 'Allow', 'Skip', 'Ran `npm run build`', 'Build succeeded.'], 2);
  const stats = pollOnce(store, NOW);
  expect(stats.completed).toBe(0);
  expect(byTitle(store, 'npm run build')!.status).toBe('open');
  store.close();
});

test('a step the agent ran itself never ticks, even when its output says it worked', () => {
  useAssistants(ALL);
  const store = new Store(':memory:');
  observe(store, 'com.mitchellh.ghostty', 'Ghostty', 'zsh', ['❯ set up the db', '● Next steps:', '  1. Run `bun run db:push`', '  2. Add DATABASE_URL in Vercel', '✻ Cogitated for 6s'], 0);
  pollOnce(store, NOW);
  observe(store, 'com.mitchellh.ghostty', 'Ghostty', 'zsh', ['❯ go ahead and run it', '● Bash(bun run db:push)', '  ⎿  Pushed schema in 1.1s', '✻ Baked for 3s'], 2);
  const stats = pollOnce(store, NOW);
  expect(stats.completed).toBe(0);
  const step = byTitle(store, 'db:push')!;
  expect(step.status).toBe('dismissed');
  expect(formatWhy(step, store.listEvidence(step.id))).toContain('Claude Code ran this itself');
  expect(titles(store)).toEqual(['Add DATABASE_URL in Vercel']);
  store.close();
});
