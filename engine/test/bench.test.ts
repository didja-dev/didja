import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { loadScenarios, runScenario, SCENARIOS, table, totals } from '../bench/run.ts';
import type { Scenario } from '../bench/run.ts';

const scenarios = loadScenarios();
const roster = new Set(readFileSync(join(import.meta.dir, '../../profiles/fixtures/names.txt'), 'utf8')
  .split('\n').map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith('#')));

test('the benchmark has at least 25 scenarios, each well formed and named after its file', () => {
  expect(scenarios.length).toBeGreaterThanOrEqual(25);
  const files = readdirSync(SCENARIOS).filter((f) => f.endsWith('.json')).sort();
  expect(new Set(scenarios.map((s) => s.id)).size).toBe(scenarios.length);
  scenarios.forEach((s, i) => {
    expect(files[i]).toBe(`${String(i + 1).padStart(2, '0')}-${s.id}.json`);
    expect(s.about.length).toBeGreaterThan(10);
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
});

// The runner itself: a tick before the labelled time, or of a task never done, counts as wrong.
const command = (done: Scenario['expect']['tasks'][number]['done']): Scenario => ({
  id: 'runner-check', about: 'A command handed over by Claude and run in Terminal at minute 3.', start: '2026-11-11T09:00',
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
