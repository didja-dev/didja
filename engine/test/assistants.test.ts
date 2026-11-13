import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, test } from 'bun:test';
import { agentWork, assistantFor, compileAssistant, compilePattern, readAssistants, useAssistants } from '../src/assistants.ts';
import type { AssistantProfileFile } from '../src/assistants.ts';
import { classifySource, extractChecklists, sourceRef } from '../src/extract.ts';

// SCR-83: which windows are an AI tool comes from profiles/assistants, checked against made-up fixtures.
const DIR = join(import.meta.dir, '..', '..', 'profiles');
const FILES = readdirSync(join(DIR, 'assistants')).filter((n) => n.endsWith('.json')).sort();
const ALL = readAssistants(join(DIR, 'assistants'));

interface Fixture {
  about: string;
  profile: string | null;
  window: { app: string; bundle: string; title: string; url?: string };
  lines: string[];
  expect: { assistant: string | null };
}
const FIXTURES = readdirSync(join(DIR, 'fixtures', 'assistants')).filter((n) => n.endsWith('.json')).sort()
  .map((name) => ({ name, f: JSON.parse(readFileSync(join(DIR, 'fixtures', 'assistants', name), 'utf8')) as Fixture }));

afterEach(() => useAssistants(null));

test('every assistant profile reads, is named after its file, and has a fixture that recognises it', () => {
  expect(ALL.map((a) => `${a.id}.json`).sort()).toEqual(FILES);
  for (const a of ALL) {
    expect({ id: a.id, fixtures: FIXTURES.some(({ f }) => f.expect.assistant === a.id) }).toEqual({ id: a.id, fixtures: true });
  }
  expect(ALL.length).toBeGreaterThanOrEqual(16);
});

for (const { name, f } of FIXTURES) {
  test(`fixture ${name}: ${f.about}`, () => {
    const window = { bundleId: f.window.bundle, windowTitle: f.window.title, url: f.window.url ?? null };
    expect(assistantFor(window, f.lines.join('\n'), ALL)?.id ?? null).toBe(f.expect.assistant);
    expect(f.profile).toBe(f.expect.assistant);
  });
}

test('there are fixtures of windows that are no AI tool: a plain terminal, a prompt glyph alone, a doc in an editor, another site', () => {
  expect(FIXTURES.filter(({ f }) => f.expect.assistant === null).length).toBeGreaterThanOrEqual(4);
});

test("Claude's windows keep their source kinds, so tasks made before keep grouping with new ones", () => {
  useAssistants(ALL);
  expect(classifySource({ bundleId: 'com.anthropic.claudefordesktop', windowTitle: 'x', url: null }, '')).toBe('claude-desktop');
  expect(classifySource({ bundleId: 'com.google.Chrome', windowTitle: 'x', url: 'https://claude.ai/chat/1' }, '')).toBe('claude-web');
  expect(classifySource({ bundleId: 'com.google.Chrome', windowTitle: 'x', url: 'https://eu.claude.ai/chat/1' }, '')).toBe('claude-web');
  expect(classifySource({ bundleId: 'com.mitchellh.ghostty', windowTitle: '✳ Fix auth', url: null }, '')).toBe('claude-code');
  expect(classifySource({ bundleId: 'com.google.Chrome', windowTitle: 'x', url: 'https://notclaude.ai/' }, '')).toBe(null);
});

test('a title beats a signature, which beats weak signs together: Copilot CLI with "❯ 1. Yes" and "● …" is not Claude Code', () => {
  const text = ['Do you want to run this command?', '❯ 1. Yes', '  2. No, and tell Copilot what to do differently (Esc)', '● Run tests (shell)', '  └ 12 passed'].join('\n');
  expect(assistantFor({ bundleId: 'com.googlecode.iterm2', windowTitle: 'zsh', url: null }, text, ALL)?.id).toBe('copilot-cli');
  // Only the weak pair, no signature or title: Claude Code, as before.
  expect(assistantFor({ bundleId: 'com.googlecode.iterm2', windowTitle: 'zsh', url: null }, '❯ fix it\n● Fixed it.', ALL)?.id).toBe('claude-code');
});

test('an editor is recognised only by a panel, never by its title', () => {
  expect(assistantFor({ bundleId: 'com.todesktop.230313mzl4w4u92', windowTitle: 'Claude Code — Cascade — Copilot', url: null }, 'notes', ALL)).toBe(null);
});

test('without a profiles folder, nothing is an AI tool', () => {
  useAssistants([]);
  expect(classifySource({ bundleId: 'com.anthropic.claudefordesktop', windowTitle: 'x', url: null }, '')).toBe(null);
});

test("a profile's patterns are limited like an app profile's", () => {
  expect(() => compilePattern('x'.repeat(301))).toThrow();
  expect(() => compilePattern('(a)\\1')).toThrow();
  expect(() => compilePattern('(?<=a)b')).toThrow();
  expect(() => compilePattern('(a+)+')).toThrow();
  expect(compilePattern('(?i)^codex').test('Codex')).toBe(true);
  const base: AssistantProfileFile = { id: 'x', name: 'X', kind: 'chat', match: { hosts: ['example.com'] } };
  expect(() => compileAssistant({ ...base, id: 'Bad Id' })).toThrow();
  expect(() => compileAssistant({ ...base, kind: 'robot' as never })).toThrow();
  expect(() => compileAssistant({ ...base, match: {} })).toThrow();
  expect(compileAssistant(base).sourceKind).toBe('x');
});

test("the agent's own work is told by its profile: approvals, ran lines and its todo list", () => {
  const codex = ALL.find((a) => a.id === 'codex')!;
  expect(agentWork(codex, '• Would you like to run the following command?')).toBe('approval');
  expect(agentWork(codex, '• Ran npm test')).toBe('ran');
  expect(agentWork(codex, '    □ Document the endpoint')).toBe('todo');
  expect(agentWork(codex, 'Next steps:')).toBe(null);
});

test('ChatGPT\'s "ChatGPT said:" counts as the assistant\'s turn, and "You said:" as yours', () => {
  useAssistants(ALL);
  const text = ['⟦Message 1⟧', 'You said:', '1. Add a test', '2. Fix the bug', '⟦Message 2⟧', 'ChatGPT said:', 'To finish:', '1. Set RESEND_API_KEY in Vercel', '2. Verify the domain in Resend'].join('\n');
  const lists = extractChecklists(text, { claudeOnly: true });
  expect(lists.flatMap((l) => l.items.map((i) => i.title))).toEqual(['Set RESEND_API_KEY in Vercel', 'Verify the domain in Resend']);
});

test('other tools name their tasks by the tool first', () => {
  useAssistants(ALL);
  expect(sourceRef({ app: 'iTerm2', windowTitle: 'codex' }, 'codex')).toBe('Codex (iTerm2)');
  expect(sourceRef({ app: 'Google Chrome', windowTitle: 'Launch checklist - ChatGPT' }, 'chatgpt')).toBe('ChatGPT — Launch checklist');
  expect(sourceRef({ app: 'Google Chrome', windowTitle: 'Gemini' }, 'gemini')).toBe('Gemini');
  // Claude's names are unchanged.
  expect(sourceRef({ app: 'Claude', windowTitle: 'Stripe webhooks' }, 'claude-desktop')).toBe('Claude — Stripe webhooks');
});
