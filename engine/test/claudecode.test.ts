import { expect, test } from 'bun:test';
import { formatWhy } from '../src/cli.ts';
import { pollOnce } from '../src/engine.ts';
import { classifySource, doneByClaude, splitClaudeCode } from '../src/extract.ts';
import { Store } from '../src/store.ts';

// SCR-65: made-up Claude Code transcripts.
const CURSOR = 'com.todesktop.230313mzl4w4u92';
const NOW = new Date('2026-11-11T10:00:00Z');
const at = (s: number) => new Date(NOW.getTime() - 300_000 + s * 1000).toISOString();
function observe(store: Store, bundleId: string, app: string, windowTitle: string, lines: string[], seconds: number) {
  store.insertObservation({ ts: at(seconds), bundleId, app, windowTitle, url: null, source: 'ax', text: lines.join('\n') });
}
const ghostty = (store: Store, lines: string[], seconds = 0) => observe(store, 'com.mitchellh.ghostty', 'Ghostty', '✳ Email setup', lines, seconds);

const DOC = ['# Acme web', '## Working with Claude Code', '1. Run `bun test` before every commit', '2. Update docs/CHANGELOG.md with each change', '3. Never commit .env files'];

test('an editor is Claude Code only when the panel itself is there, never from a file name or a doc', () => {
  const w = (bundleId: string, windowTitle: string) => ({ bundleId, windowTitle, url: null });
  expect(classifySource(w(CURSOR, 'CLAUDE.md — acme-web'), DOC.join('\n'))).toBeNull();
  expect(classifySource(w('com.microsoft.VSCode', 'claude-notes.md'), 'Claude Code is great\n⏺ quoted in a doc')).toBeNull();
  expect(classifySource(w('com.microsoft.VSCode', 'auth.ts — acme-web'), '⏺ Done.\n? for shortcuts')).toBe('claude-code');
  // Terminals are as before: Claude Code sets their title.
  expect(classifySource(w('com.mitchellh.ghostty', '✳ Fix auth'), '')).toBe('claude-code');
});

test('CLAUDE.md open in Cursor makes no tasks', () => {
  const store = new Store(':memory:');
  observe(store, CURSOR, 'Cursor', 'CLAUDE.md — acme-web', DOC, 0);
  pollOnce(store, NOW);
  expect(store.listTasks({ all: true })).toEqual([]);
  store.close();
});

test("only Claude's replies count: a list in a tool's output (cat of a file) or in your prompt is not yours", () => {
  const t = splitClaudeCode([
    '> 1. make it faster', '  2. and smaller',
    '⏺ Bash(cat docs/steps.md)', '  ⎿  1. Run the seed script', '     2. Update the README',
    '⏺ Here is what you do:', '  1. Set the key in Vercel', '  2. Run the migration',
  ].join('\n'));
  expect(t.replies.split('\n').filter(Boolean)).toEqual(['⏺ Here is what you do:', '  1. Set the key in Vercel', '  2. Run the migration']);
  expect(t.tools).toEqual([{ tool: 'Bash', arg: 'cat docs/steps.md', line: 2 }]);

  const store = new Store(':memory:');
  ghostty(store, ['> show me the steps doc', '⏺ Bash(cat docs/steps.md)', '  ⎿  1. Run the seed script', '     2. Update the README', '     3. Restart the server', '⏺ That is the whole file.', '? for shortcuts']);
  pollOnce(store, NOW);
  expect(store.listTasks({ all: true })).toEqual([]);
  store.close();
});

const REPLY = ['> set up email', '⏺ Almost there. On your side:', '  1. Run `bun run migrate`', '  2. Set RESEND_API_KEY in the Vercel dashboard', '? for shortcuts'];

test('a step Claude then runs itself is taken back as Claude\'s, never ticked; the other stays yours', () => {
  const store = new Store(':memory:');
  ghostty(store, REPLY);
  pollOnce(store, NOW);
  expect(store.listTasks().map((t) => t.title)).toEqual(['Run `bun run migrate`', 'Set RESEND_API_KEY in the Vercel dashboard']);
  ghostty(store, ['⏺ Actually, I can run the migration for you.', '⏺ Bash(cd /tmp/acme && bun run migrate)', '  ⎿  Migrated 3 tables.'], 30);
  const stats = pollOnce(store, NOW);
  expect(stats.completed).toBe(0);
  expect(store.listTasks().map((t) => t.title)).toEqual(['Set RESEND_API_KEY in the Vercel dashboard']);
  const migrate = store.listTasks({ all: true }).find((t) => t.title.includes('migrate'))!;
  expect(migrate.status).toBe('dismissed');
  expect(formatWhy(migrate, store.listEvidence(migrate.id))).toContain('Claude did this itself');
  store.close();
});

test('an edit by Claude of the file a step names carries out that step; reading it, or another file, does not', () => {
  const item = { title: 'Add the redirect URL to `src/config.ts`', fragments: [] };
  expect(doneByClaude(item, [{ tool: 'Update', arg: 'src/config.ts', line: 5 }], 2)).toBe(true);
  expect(doneByClaude(item, [{ tool: 'Edit', arg: '/Users/me/acme/src/config.ts', line: 5 }], 2)).toBe(true);
  expect(doneByClaude(item, [{ tool: 'Read', arg: 'src/config.ts', line: 5 }], 2)).toBe(false);
  expect(doneByClaude(item, [{ tool: 'Update', arg: 'src/other.ts', line: 5 }], 2)).toBe(false);
  // Before the step was listed: not this step.
  expect(doneByClaude(item, [{ tool: 'Update', arg: 'src/config.ts', line: 1 }], 2)).toBe(false);
  // A step that only asks you to look at the file is not carried out by editing it.
  expect(doneByClaude({ title: 'Review `src/config.ts` before merging', fragments: [] }, [{ tool: 'Update', arg: 'src/config.ts', line: 5 }], 2)).toBe(false);
});

test('a Bash call carries out a step only when it runs that very command', () => {
  const item = { title: 'Run `git push origin main`', fragments: [] };
  const bash = (arg: string) => [{ tool: 'Bash', arg, line: 9 }];
  expect(doneByClaude(item, bash('git push origin main'), 1)).toBe(true);
  expect(doneByClaude(item, bash('git add . && git push origin main --follow-tags'), 1)).toBe(true);
  expect(doneByClaude(item, bash('git push origin feature'), 1)).toBe(false);
  expect(doneByClaude(item, bash('git push'), 1)).toBe(false);
  expect(doneByClaude(item, bash('echo git push origin main'), 1)).toBe(false);
});
