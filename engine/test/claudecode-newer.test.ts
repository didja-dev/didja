/**
 * SCR-80: newer Claude Code in a terminal ("●" replies, "❯" prompt, "✻ Baked for 4s · done" status
 * lines, a plain tab title), its "name + command" steps, checklists written as boxes to tick, and
 * prompts ending in "›". Made-up sessions with the same shape as a real one.
 */
import { expect, test } from 'bun:test';
import { classifySource, extractChecklists } from '../src/extract.ts';
import { commandAtPrompt } from '../src/match.ts';

const GHOSTTY = { bundleId: 'com.mitchellh.ghostty', windowTitle: 'ghostty', url: null };

const SESSION = [
  '❯ make the widget files in checkboxes',
  '',
  '● Run these from the project root.',
  '',
  '  - [ ] 1. Folder',
  '  mkdir -p components/widget',
  '  - [ ] 2. Header',
  '  touch components/widget/Header.tsx',
  '  - [ ] 3. Footer',
  '  touch components/widget/Footer.tsx',
  '',
  '✻ Baked for 4s · done 13:13',
].join('\n');

test('newer Claude Code is recognised by its status line, or by its reply and prompt together', () => {
  expect(classifySource(GHOSTTY, SESSION)).toBe('claude-code');
  expect(classifySource(GHOSTTY, '* Cogitated for 1m 2s\n')).toBe('claude-code');
  expect(classifySource(GHOSTTY, '❯ ls\n● build: passing\n')).toBe('claude-code');
  // A shell with a ❯ prompt, or a status tool printing ●, is not Claude Code on its own.
  expect(classifySource(GHOSTTY, '~/repo ❯ git status\nOn branch main\n')).toBeNull();
  expect(classifySource(GHOSTTY, '● nginx.service - web server\n   Active: active (running)\n')).toBeNull();
  expect(classifySource(GHOSTTY, 'The build finished for 4 apps\n')).toBeNull();
});

test('a named step with its command under it is a task carrying that command', () => {
  const [list] = extractChecklists(SESSION, { joinWrapped: true });
  expect(list!.items.map((i) => i.title)).toEqual([
    'Folder: `mkdir -p components/widget`',
    'Header: `touch components/widget/Header.tsx`',
    'Footer: `touch components/widget/Footer.tsx`',
  ]);
  // Without boxes, with blank lines between the step and its command, as Claude Code also writes it.
  const plain = '● Run these from the project root.\n\n  1. Folder\n\n  mkdir -p components/widget\n\n  2. Header\n\n  touch components/widget/Header.tsx\n';
  expect(extractChecklists(plain, { joinWrapped: true })[0]!.items.map((i) => i.title)).toEqual([
    'Folder: `mkdir -p components/widget`', 'Header: `touch components/widget/Header.tsx`',
  ]);
});

test('names without commands, or prose under a name, still make no tasks', () => {
  const names = '● The parts are:\n\n  1. Folder\n  2. Header\n  3. Footer\n';
  expect(extractChecklists(names, { joinWrapped: true })).toEqual([]);
  const prose = '● Two options:\n\n  1. Postgres\n  It is the default and well supported.\n  2. SQLite\n  It is simpler for one machine.\n';
  expect(extractChecklists(prose, { joinWrapped: true })).toEqual([]);
});

test('a checklist of boxes is read like a numbered list; ticked boxes and app toggles are not tasks', () => {
  const app = [
    "Here's the whole process as a checklist:",
    'Prepare',
    '[ ] Turn up the laptop brightness',
    '[ ] Make sure you have a spare keyboard',
    'Create the installer',
    '[x] Download the installer from the vendor page',
    '[ ] Run the tool as administrator and accept the terms',
    '[ ] Choose the language and edition',
    'If you like, I can make this a printable list.',
  ].join('\n');
  const lists = extractChecklists(app, { includeAssistant: true });
  expect(lists.map((l) => l.title)).toEqual(['Prepare', 'Create the installer']);
  expect(lists[1]!.items.map((i) => i.title)).toEqual(['Run the tool as administrator and accept the terms', 'Choose the language and edition']);
  // Toolbar toggles under a reply are not a list of things to do.
  expect(extractChecklists('[ ] Good response\n[ ] Bad response\n', { includeAssistant: true })).toEqual([]);
  // A Markdown checklist in a terminal too.
  expect(extractChecklists('● Before you ship:\n\n  - [ ] Set API_KEY in Vercel\n  - [ ] Run the prod migration\n', { joinWrapped: true })[0]!.items.length).toBe(2);
});

test('a command after a prompt ending in › counts as run', () => {
  expect(commandAtPrompt('~/repo › mkdir -p components/widget', 'mkdir -p components/widget')).toBe(true);
  expect(commandAtPrompt('~/repo » touch Header.tsx', 'touch Header.tsx')).toBe(true);
  expect(commandAtPrompt('see the docs: mkdir -p components/widget', 'mkdir -p components/widget')).toBe(false);
});

test('a numbered list in the Claude app made of everyday steps (get, back up, make sure) is yours', () => {
  const chat = [
    '⟦Message 1 of 2⟧',
    'You said: give me the first section as numbered steps',
    'give me the first section as numbered steps',
    '⟦Message 2 of 2⟧',
    'Claude responded: Here is the first section.',
    '1. Get a USB stick of at least 8 GB.',
    '2. Back up anything on it, since it will be erased.',
    '3. Make sure you have a working PC to create the installer on.',
  ].join('\n');
  const [list] = extractChecklists(chat, { claudeOnly: true, includeAssistant: true });
  expect(list!.items.map((i) => i.title)).toEqual([
    'Get a USB stick of at least 8 GB.',
    'Back up anything on it, since it will be erased.',
    'Make sure you have a working PC to create the installer on.',
  ]);
});
