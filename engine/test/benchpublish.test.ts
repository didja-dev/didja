/**
 * SCR-111: the tick precision on didja.dev and in the README comes from the benchmark, never typed by
 * hand. These fail when site/src/bench.json or the README's block differ from what the benchmark
 * gives now: run `bun bench/publish.ts` in engine/ to bring them up to date.
 */
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { current, json, published, README, README_END, README_START, readmeBlock, SITE_JSON, withBlock } from '../bench/publish.ts';
import type { Totals } from '../bench/run.ts';

const now = current();

test('site/src/bench.json is what the benchmark gives now (run `bun bench/publish.ts` if not)', () => {
  expect(readFileSync(SITE_JSON, 'utf8')).toBe(json(now));
});

test("the README's benchmark block is what the benchmark gives now (run `bun bench/publish.ts` if not)", () => {
  const readme = readFileSync(README, 'utf8');
  expect(readme).toContain(README_START);
  expect(withBlock(readme, readmeBlock(now))).toBe(readme);
});

test('published numbers: a wrong tick is said, and the limit of made-up data is always there', () => {
  const p = published({ scenarios: 10, tickPrecision: 0.9, ticked: 9, wrongTicks: 1, recall: 0.5, precision: 0.75, ownerErrors: 1 } as Totals);
  expect(p).toEqual({ scenarios: 10, tickPrecision: 0.9, rightTicks: 9, wrongTicks: 1, recall: 0.5, precision: 0.75, ownerErrors: 1, model: 'none' });
  const block = readmeBlock(p);
  expect(block).toContain('**Tick precision: 90%.** Of the 10 ticks Didja made across 10 made-up sessions, 1 was wrong.');
  expect(block).toContain('1 task was given to the wrong person');
  expect(block).toContain('The sessions are made up');
  // Replacing keeps everything outside the markers, and a README without them is left alone.
  const readme = `top\n${README_START}\nold\n${README_END}\nbottom\n`;
  expect(withBlock(readme, 'new')).toBe(`top\n${README_START}\nnew\n${README_END}\nbottom\n`);
  expect(withBlock('no markers', 'new')).toBe('no markers');
});
