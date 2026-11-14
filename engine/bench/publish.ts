/**
 * The benchmark's headline, published (SCR-111): tick precision, right and wrong ticks, recall,
 * capture precision, owner errors and how many scenarios, from a run with no model. Written to
 * site/src/bench.json (read by didja.dev's build) and to the marked block in README.md, so the
 * numbers are never typed by hand. `engine/test/benchpublish.test.ts` fails when either differs
 * from what the benchmark gives now; run this to bring them up to date:
 *
 *   bun bench/publish.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadScenarios, runScenario, totals, type Totals } from './run.ts';

export interface Published {
  /** How many made-up sessions were replayed. */
  scenarios: number;
  /** Right ticks over all ticks, 0–1; null when nothing was ticked. */
  tickPrecision: number | null;
  rightTicks: number;
  wrongTicks: number;
  /** Tasks found over tasks that should exist, 0–1. */
  recall: number | null;
  /** Tasks found that should exist over all tasks made, 0–1. */
  precision: number | null;
  ownerErrors: number;
  /** The benchmark was run without a language model: rules only. */
  model: 'none';
}

export function published(t: Totals): Published {
  return {
    scenarios: t.scenarios, tickPrecision: t.tickPrecision, rightTicks: t.ticked, wrongTicks: t.wrongTicks,
    recall: t.recall, precision: t.precision, ownerErrors: t.ownerErrors, model: 'none',
  };
}

/** What the benchmark gives now, with no model. */
export function current(): Published {
  const scenarios = loadScenarios();
  return published(totals(scenarios.map((s) => runScenario(s, {}, 'none')), scenarios));
}

export const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);

export const README_START = '<!-- benchmark:start (written by engine/bench/publish.ts; do not edit by hand) -->';
export const README_END = '<!-- benchmark:end -->';

/** The README's lines between the markers. */
export function readmeBlock(p: Published): string {
  return [
    `- **Tick precision: ${pct(p.tickPrecision)}.** Of the ${p.rightTicks + p.wrongTicks} ticks Didja made across ${p.scenarios} made-up sessions, ${p.wrongTicks} ${p.wrongTicks === 1 ? 'was' : 'were'} wrong. CI fails on any wrong tick.`,
    `- **It found ${pct(p.recall)} of the tasks it should have** (recall), and ${pct(p.precision)} of the tasks it made were real ones (capture precision). ${p.ownerErrors} ${p.ownerErrors === 1 ? 'task was' : 'tasks were'} given to the wrong person. Rules only, no language model.`,
    '- The sessions are made up, written to look like real chats, emails, terminals and AI replies, so they show how Didja behaves on those shapes, not how it does on your Mac. How it works: [engine/bench/README.md](engine/bench/README.md).',
  ].join('\n');
}

/** The README with its block replaced; the README unchanged if it has no markers. */
export function withBlock(readme: string, block: string): string {
  const a = readme.indexOf(README_START);
  const b = readme.indexOf(README_END);
  if (a < 0 || b < a) return readme;
  return `${readme.slice(0, a + README_START.length)}\n${block}\n${readme.slice(b)}`;
}

export const ROOT = join(import.meta.dir, '../..');
export const SITE_JSON = join(ROOT, 'site/src/bench.json');
export const README = join(ROOT, 'README.md');
export const json = (p: Published) => `${JSON.stringify(p, null, 2)}\n`;

if (import.meta.main) {
  const p = current();
  writeFileSync(SITE_JSON, json(p));
  writeFileSync(README, withBlock(readFileSync(README, 'utf8'), readmeBlock(p)));
  console.log(`Tick precision ${pct(p.tickPrecision)} (${p.rightTicks} right, ${p.wrongTicks} wrong) over ${p.scenarios} scenarios; written to site/src/bench.json and README.md.`);
}
