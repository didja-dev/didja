/**
 * The capture coverage sweep: each `profiles/fixtures/surfaces/*.json` is a place an AI tool shows
 * steps, with the lines capture keeps from it (checked by the app's SurfaceFixtureTests) and the
 * tasks the engine must make from them: every one of `expect.tasks`, none of `expect.notTasks`.
 * docs/COVERAGE.md lists the surfaces.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { pollOnce } from '../src/engine.ts';
import { Store } from '../src/store.ts';

interface Surface {
  about: string;
  window: { app: string; bundle: string; title: string; url?: string };
  lines: string[];
  expect: { tasks: string[]; notTasks: string[] };
}

const DIR = join(import.meta.dir, '..', '..', 'profiles', 'fixtures', 'surfaces');
const FIXTURES = readdirSync(DIR).filter((n) => n.endsWith('.json')).sort()
  .map((name) => ({ name, f: JSON.parse(readFileSync(join(DIR, name), 'utf8')) as Surface }));

test('there are surfaces to check', () => {
  expect(FIXTURES.length).toBeGreaterThan(0);
});

for (const { name, f } of FIXTURES) {
  test(`${name}: ${f.about.slice(0, 60)}`, () => {
    const store = new Store(':memory:');
    store.insertObservation({ ts: '2026-11-14T10:00:00.000Z', bundleId: f.window.bundle, app: f.window.app, windowTitle: f.window.title,
      url: f.window.url ?? null, source: 'ax', text: f.lines.join('\n') });
    // The stand-in model says every list is yours, so a list wrongly read as one shows up here.
    pollOnce(store, new Date('2026-11-14T10:00:05Z'), { judge: () => ({ audience: 'user', model: 'm' }) });
    const titles = store.listTasks({ all: true }).filter((t) => !t.isGroup && t.status === 'open').map((t) => t.title);
    expect([...titles].sort()).toEqual([...f.expect.tasks].sort());
    for (const not of f.expect.notTasks) expect(titles).not.toContain(not);
    store.close();
  });
}
