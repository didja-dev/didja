import { expect, test } from 'bun:test';
import { pollOnce } from '../src/engine.ts';
import { commandLine, extractCommands } from '../src/extract.ts';
import { Store } from '../src/store.ts';

const REPLY = [
  '⟦Message 2⟧',
  'You said: How do I check my IP from the terminal?',
  'How do I check my IP from the terminal?',
  '⟦Currently streaming message⟧',
  'Claude responded: Here are two ways; you can run either:',
  'Check it (takes a second, works on any Mac):',
  '`curl ipinfo.io`',
  'If you only want the address, run:',
  '`ipconfig getifaddr en0`',
  'Open the Terminal app (Cmd+Space, type “Terminal”), paste the command, and press Return.',
].join('\n');

test('a line that is only a shell command in backticks is a command', () => {
  expect(commandLine('`curl ipinfo.io`')).toBe('curl ipinfo.io');
  expect(commandLine('  - `$ brew install jq`')).toBe('brew install jq');
  expect(commandLine('Use `git status` to check')).toBeNull(); // mid-sentence
  expect(commandLine('`MY_SECRET_KEY`')).toBeNull(); // not a command
});

test('commands Claude hands you become steps, each named by the line that hands it over', () => {
  const [list] = extractCommands(REPLY);
  expect(list!.items.map((i) => i.title)).toEqual([
    'Check it (takes a second, works on any Mac) — run `curl ipinfo.io`',
    'If you only want the address — run `ipconfig getifaddr en0`',
  ]);
});

test('commands carry what you asked, for the model to judge who they are for', () => {
  expect(extractCommands(REPLY)[0]!.asked).toBe('How do I check my IP from the terminal?');
  expect(extractCommands('⟦Message 3⟧\nClaude responded: Run:\n`git status`')[0]!.asked).toBeNull(); // nothing of yours in view
});

test("Claude's own commands, your own message, and a command no line hands you are not steps", () => {
  expect(extractCommands('⟦Message 3⟧\nClaude responded: I checked it for you.\nI ran:\n`git status`\nAll clean.')).toEqual([]);
  expect(extractCommands('⟦Message 1⟧\nYou said: I ran this:\n`git status`')).toEqual([]);
  expect(extractCommands('⟦Message 3⟧\nClaude responded: The repo looks fine.\n`git status`\nNothing to commit.')).toEqual([]);
});

test('in a Claude chat they become tasks with the command as marker, ticked when you run it in a terminal', () => {
  const store = new Store(':memory:');
  const observe = (bundleId: string, app: string, windowTitle: string, text: string, ts: string) =>
    store.insertObservation({ ts, bundleId, app, windowTitle, url: null, source: 'ax', text });
  const NOW = new Date('2026-11-11T15:00:00Z');
  observe('com.anthropic.claudefordesktop', 'Claude', 'Check my IP', REPLY, '2026-11-11T14:52:00.000Z');
  pollOnce(store, NOW);
  const tasks = store.listTasks();
  expect(tasks.map((t) => t.title)).toEqual([
    'Check it (takes a second, works on any Mac) — run `curl ipinfo.io`',
    'If you only want the address — run `ipconfig getifaddr en0`',
  ]);
  expect(tasks.every((t) => t.auto)).toBe(true); // something exact to look for
  observe('com.apple.Terminal', 'Terminal', 'zsh', 'me@mac ~ % curl ipinfo.io\n{ "ip": "1.2.3.4" }', '2026-11-11T14:55:00.000Z');
  pollOnce(store, NOW);
  expect(store.listTasks({ all: true }).find((t) => t.title.includes('curl'))!.status).toBe('done');
  expect(store.listTasks({ all: true }).find((t) => t.title.includes('ipconfig'))!.status).toBe('open');
  store.close();
});

test('a command handed over only by a Terminal hint after it is named by the command alone', () => {
  const [list] = extractCommands('⟦Message 4⟧\nClaude responded: Here.\n9% done 90.6s / 1x\n`curl ipinfo.io`\nOpen the Terminal app, paste the command, and press Return.');
  expect(list!.items.map((i) => i.title)).toEqual(['Run `curl ipinfo.io`']);
});
