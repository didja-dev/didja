import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { byFamily, FAMILIES, FAMILY_TOOLS, familyTable, loadScenarios, recognition, runScenario, SCENARIOS, table, totals } from '../bench/run.ts';
import type { Scenario } from '../bench/run.ts';

const scenarios = loadScenarios();
/** Running every scenario takes about 2 s here and more on a CI runner: well past the 5 s default there. */
const BENCH_MS = 60_000;
const roster = new Set(readFileSync(join(import.meta.dir, '../../profiles/fixtures/names.txt'), 'utf8')
  .split('\n').map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith('#')));

test('the benchmark has at least 99 scenarios, each well formed, named after its file and in a known tool family', () => {
  expect(scenarios.length).toBeGreaterThanOrEqual(99);
  const files = readdirSync(SCENARIOS).filter((f) => f.endsWith('.json')).sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b));
  expect(new Set(scenarios.map((s) => s.id)).size).toBe(scenarios.length);
  scenarios.forEach((s, i) => {
    expect(files[i]).toBe(`${String(i + 1).padStart(2, '0')}-${s.id}.json`);
    expect(s.about.length).toBeGreaterThan(10);
    expect(FAMILIES).toContain(s.family);
    expect(Number.isNaN(new Date(s.start).getTime())).toBe(false);
    expect(s.steps.length).toBeGreaterThan(0);
    for (const step of s.steps) {
      expect(typeof step.at).toBe('number');
      expect(step.app && step.bundle && step.title).toBeTruthy();
      expect(Array.isArray(step.text)).toBe(true);
    }
    for (const t of s.expect.tasks) expect(t.words.length).toBeGreaterThan(0);
  });
});

test('scenarios hold only made-up people and addresses', () => {
  for (const s of scenarios) {
    for (const line of s.steps.flatMap((step) => step.text)) {
      const sender = line.match(/^⟦Chat message: (.+) \((?:direct|group|unknown)\) — from (.+?)(?:, mentions me)? — .+⟧$/);
      if (sender) {
        for (const name of [sender[1]!, sender[2]!]) {
          if (name !== 'me') expect({ id: s.id, name, onRoster: roster.has(name.toLowerCase()) }).toEqual({ id: s.id, name, onRoster: true });
        }
      }
      const from = line.match(/^From: ([^,]+)/)?.[1];
      if (from && !/acme/i.test(from)) expect({ id: s.id, from, onRoster: roster.has(from.toLowerCase()) }).toEqual({ id: s.id, from, onRoster: true });
      for (const [, domain] of line.matchAll(/[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g)) {
        expect(['example.com', 'acme.com']).toContain(domain!.toLowerCase());
      }
    }
  }
});

test('with no model, nothing in the benchmark is ticked wrongly', () => {
  const results = scenarios.map((s) => runScenario(s));
  const t = totals(results, scenarios);
  expect(results.flatMap((r) => r.wrongTicks)).toEqual([]);
  expect(t.wrongTicks).toBe(0);
  expect(table(results, t)).toContain('Wrong ticks: 0.');
}, BENCH_MS);

test('every AI tool the corpus covers has scenarios, with at least one that must make a task and one that must not (SCR-82)', () => {
  const tools = ['claude-app', 'chatgpt', 'gemini', 'copilot', 'claude-code', 'codex', 'gemini-cli', 'copilot-cli', 'aider', 'opencode',
    'goose', 'vscode-copilot', 'cursor', 'windsurf'] as const;
  for (const family of tools) {
    const own = scenarios.filter((s) => s.family === family);
    expect({ family, makes: own.some((s) => s.expect.tasks.length > 0) }).toEqual({ family, makes: true });
    expect({ family, refuses: own.some((s) => s.expect.none.length > 0) }).toEqual({ family, refuses: true });
  }
  // The first day: one session across Claude Code and the Claude app that must make at least six tasks.
  expect(Math.max(...scenarios.filter((s) => s.family === 'first-day').map((s) => s.expect.tasks.length))).toBeGreaterThanOrEqual(6);
  // Near-misses at a done target: labelled tasks that were never done, with the target page on screen.
  expect(scenarios.filter((s) => s.family === 'done-target' && s.expect.tasks.some((t) => t.done === null)).length).toBeGreaterThanOrEqual(3);
});

test('every AI tool family is recognised in every one of its scenarios (SCR-83)', () => {
  const results = scenarios.map((s) => runScenario(s));
  for (const family of Object.keys(FAMILY_TOOLS) as (keyof typeof FAMILY_TOOLS)[]) {
    const r = recognition(family, results)!;
    expect({ family, ...r }).toEqual({ family, seen: r.of, of: r.of });
  }
  // A plain document or app is never taken for an AI tool.
  for (const r of results.filter((x) => x.family === 'editor' || x.family === 'notes')) expect(r.recognised).toEqual([]);
}, BENCH_MS);

test('the report has one row per tool family, and its totals add up to the whole', () => {
  const some = scenarios.filter((s) => s.family === 'chatgpt' || s.family === 'codex');
  const results = some.map((s) => runScenario(s));
  const rows = byFamily(results, some);
  expect(rows.map((r) => r.family)).toEqual(['chatgpt', 'codex']);
  const all = totals(results, some);
  expect(rows.reduce((n, r) => n + r.t.expected, 0)).toBe(all.expected);
  expect(rows.reduce((n, r) => n + r.t.matched, 0)).toBe(all.matched);
  expect(familyTable(rows).split('\n')).toHaveLength(4);
});

// The runner itself: a tick before the labelled time, or of a task never done, counts as wrong.
const command = (done: Scenario['expect']['tasks'][number]['done']): Scenario => ({
  id: 'runner-check', family: 'claude-app', about: 'A command handed over by Claude and run in Terminal at minute 3.', start: '2026-11-11T09:00',
  steps: [
    { at: 0, app: 'Claude', bundle: 'com.anthropic.claudefordesktop', title: 'Check', text: ['⟦Message 2⟧', 'Claude responded: Run this:', 'Check it:', '`curl ipinfo.io`'] },
    { at: 3, app: 'Terminal', bundle: 'com.apple.Terminal', title: 'zsh', text: ['me@mac ~ % curl ipinfo.io', '{ "ip": "203.0.113.7" }', 'me@mac ~ % '] },
  ],
  expect: { tasks: [{ words: ['curl ipinfo.io'], done }], none: [] },
});

test('the runner counts a tick at or after the labelled time as right, and measures how long it took', () => {
  const r = runScenario(command({ at: 3, where: 'Terminal' }));
  expect(r).toMatchObject({ expected: 1, captured: 1, matched: 1, ticked: 1, missed: 0, wrongTicks: [], latencies: [0] });
});

test('the runner counts a tick before the task was done, or of one never done, as wrong', () => {
  expect(runScenario(command({ at: 10, where: 'Terminal' })).wrongTicks).toHaveLength(1);
  expect(runScenario(command(null)).wrongTicks).toHaveLength(1);
});

test('the runner counts a missing task, and one that must not exist', () => {
  const s = command({ at: 3, where: 'Terminal' });
  s.expect = { tasks: [{ words: ['something else'], done: { at: 3, where: 'x' } }], none: [['curl']] };
  const r = runScenario(s);
  expect(r).toMatchObject({ matched: 0, missed: 1, unwanted: ['Check it — run `curl ipinfo.io`'] });
  // Ticked, and it should never have existed: a wrong tick too.
  expect(r.wrongTicks).toEqual(['Check it — run `curl ipinfo.io`']);
});
