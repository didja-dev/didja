/**
 * SCR-115: the site's hero, its description, the README's opening and the Welcome window lead with
 * the two things Didja is for, in this order: it ticks a task off when it sees you do it, and it
 * reads text on your Mac without storing screenshots. Each claim is also checked against the docs.
 */
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hero, meta } from '../../site/src/content.ts';

const ROOT = join(import.meta.dir, '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** Where `a` comes before `b` in `text`, both present. */
function before(text: string, a: RegExp, b: RegExp): boolean {
  const i = text.search(a);
  const j = text.search(b);
  return i >= 0 && j >= 0 && i < j;
}

const TICK = /ticks? (it|them|the steps?|off)/i;
const TEXT_ONLY = /no screenshots|keeps no screenshots|stores no screenshots/i;
const CATCH = /\*\*Catch\.\*\*/; // the old first bullet

test("the site's hero line and description lead with ticking, then text only", () => {
  expect(hero.bold.search(TICK)).toBe(hero.bold.search(/ticks off/));
  expect(before(hero.bold, TICK, TEXT_ONLY)).toBe(true);
  expect(before(meta.description, TICK, TEXT_ONLY)).toBe(true);
  expect(hero.meta).toMatch(TEXT_ONLY);
});

test("the README's opening says ticking first, text only second, and catching after them", () => {
  const readme = read('README.md');
  const opening = readme.slice(0, readme.indexOf('It works in the apps you already use'));
  expect(before(opening, TICK, TEXT_ONLY)).toBe(true);
  expect(before(opening, /\*\*Ticks it off when you do it/, /\*\*Text only, on your Mac, no screenshots/)).toBe(true);
  expect(before(opening, /\*\*Text only/, /\*\*Catches/)).toBe(true);
  expect(opening).not.toMatch(CATCH);
});

test("the Welcome window's first line leads with ticking, then text only", () => {
  const welcome = read('app/Didja/WelcomeView.swift');
  const first = welcome.match(/Text\("(Ticks off[^"]+)"\)/)?.[1] ?? '';
  expect(first).not.toBe('');
  expect(before(first, TICK, TEXT_ONLY)).toBe(true);
});

test('the claims are true to the docs: no screenshots stored, Accessibility first, the fallback named', () => {
  const guide = read('docs/GUIDE.md');
  expect(guide).toContain('No screenshots or video are stored.');
  expect(read('docs/ARCHITECTURE.md')).toContain('**Primary source, Accessibility API:**');
  expect(read('docs/ARCHITECTURE.md')).toContain('**Fallback, OCR:**');
  // The README does not hide the OCR fallback behind "Accessibility only".
  expect(read('README.md')).toMatch(/optional fallback reads it from the window's pixels in memory/);
});
