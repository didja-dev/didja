/**
 * SCR-113: didja.dev/compare. Every cell about another product cites that product's own pages,
 * the page says when they were read, its tone stays neutral, and Didja's cells stay true to the code.
 */
import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHECKED, NOT_STATED, page, products, rows } from '../../site/src/compare.ts';

const ROOT = join(import.meta.dir, '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

test('every row has a cell for every product, and every cell cites at least one of that product\'s sources', () => {
  expect(rows.map((r) => r.id).sort()).toEqual(['done', 'encryption', 'exclusions', 'licence', 'processing', 'retention', 'screenshots', 'telemetry']);
  for (const r of rows) {
    for (const p of products) {
      const cell = r.cells[p.id];
      expect(cell, `${r.id} / ${p.id}`).toBeDefined();
      expect(cell.text.trim().length, `${r.id} / ${p.id}`).toBeGreaterThan(0);
      expect(cell.cite.length, `${r.id} / ${p.id} cites nothing`).toBeGreaterThan(0);
      for (const key of cell.cite) expect(p.sources[key], `${r.id} / ${p.id} cites unknown source ${key}`).toBeDefined();
    }
  }
});

test("another product's sources are https pages on its own sites; Didja's are files in this repository", () => {
  for (const p of products) {
    for (const [key, s] of Object.entries(p.sources)) {
      if (p.id === 'didja') {
        expect(existsSync(join(ROOT, s.url)), `${key}: ${s.url}`).toBe(true);
        continue;
      }
      const url = new URL(s.url);
      expect(url.protocol).toBe('https:');
      expect(p.domains, `${p.id}/${key}: ${url.hostname}`).toContain(url.hostname);
    }
  }
});

test('the page says when the sources were read', () => {
  expect(CHECKED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(page.method).toContain(CHECKED);
  expect(page.checked).toContain(CHECKED);
});

test('neutral tone: no verdict words about other products', () => {
  const text = rows.flatMap((r) => products.filter((p) => p.id !== 'didja').map((p) => r.cells[p.id].text)).join(' ').toLowerCase();
  for (const word of ['unsafe', 'insecure', 'dangerous', 'creepy', 'spy', 'bad', 'worse', 'fails', 'risky', 'only didja', 'unlike']) {
    expect(text, word).not.toContain(word);
  }
  // A silence in their docs is said as a silence, in the same words everywhere.
  expect(rows.some((r) => products.some((p) => r.cells[p.id].text.startsWith(NOT_STATED)))).toBe(true);
});

test("Didja's cells match the code", () => {
  const didja = Object.fromEntries(rows.map((r) => [r.id, r.cells.didja.text]));
  // Encryption is claimed because screen text is sealed (SCR-101), and only as much as is sealed.
  const sealed = read('engine/src/sealed.ts');
  expect(sealed).toContain('aes-256-gcm');
  expect(didja.encryption).toContain('AES-256-GCM');
  expect(didja.encryption).toContain('Keychain');
  // Licence.
  expect(read('LICENSE').startsWith('MIT License')).toBe(true);
  expect(didja.licence).toContain('MIT');
  // Retention: observations expire after 24 hours.
  expect(read('docs/GUIDE.md')).toContain('Captured text is kept for 24 hours at most');
  expect(didja.retention).toContain('24 hours');
  // Screenshots: none stored.
  expect(read('docs/GUIDE.md')).toContain('No screenshots or video are stored.');
  expect(didja.screenshots?.startsWith('No.')).toBe(true);
  // What leaves the Mac: the daily update check, and task tools only once connected (docs/NETWORK.md, checked by network.test.ts).
  expect(read('docs/NETWORK.md')).toContain('No analytics, crash reporting or telemetry.');
  expect(didja.telemetry).toContain('No analytics');
  expect(didja.telemetry).toContain('update check');
});

test('the page loads nothing from another host and has no inline scripts or styles (the CSP allows neither)', () => {
  const astro = read('site/src/pages/compare.astro');
  const markup = astro.slice(astro.indexOf('<!doctype'), astro.indexOf('<style>'));
  expect(markup).not.toMatch(/<script/);
  expect(markup).not.toMatch(/<img|<iframe|<link[^>]+href="https?:\/\/(?!didja\.dev\/)/);
  expect(markup).not.toMatch(/\sstyle=/);
  expect(read('site/public/_headers')).toContain("default-src 'self'");
});
