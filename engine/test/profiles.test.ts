/**
 * App profile fixtures (`profiles/fixtures/*.json`), the engine's half. The app's tests check that
 * each fixture's window comes out as its `lines`; these check what the engine makes of those lines
 * (`engineView`: who wrote each message, which asks are left open, or the emails), and each
 * profile's shape. A message wrongly read as yours would answer an ask and drop it from `open`.
 */
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chatApp } from '../src/chat.ts';
import { mailSource } from '../src/email.ts';
import type { Fixture } from '../src/fixtures.ts';
import { engineView, profileProblems } from '../src/fixtures.ts';
import { profileFor, readProfiles, useProfiles } from '../src/profiles.ts';

const DIR = join(import.meta.dir, '..', '..', 'profiles');
const PROFILES = readProfiles(DIR);

const fixtures = readdirSync(join(DIR, 'fixtures'))
  .filter((n) => n.endsWith('.json'))
  .sort()
  .map((name) => ({ name, f: JSON.parse(readFileSync(join(DIR, 'fixtures', name), 'utf8')) as Fixture }));

test('every profile reads and has a fixture', () => {
  expect(PROFILES.length).toBeGreaterThanOrEqual(6);
  expect(new Set(fixtures.map((x) => x.f.profile))).toEqual(new Set(PROFILES.map((p) => p.id)));
});

for (const name of readdirSync(DIR).filter((n) => n.endsWith('.json')).sort()) {
  test(`${name} is a well-formed profile`, () => {
    expect(profileProblems(JSON.parse(readFileSync(join(DIR, name), 'utf8')), name)).toEqual([]);
  });
}

test('the shape check names what is wrong', () => {
  expect(profileProblems({ id: 'Bad', name: 'x', kind: 'sms', match: {}, rules: [{ is: 'run' }] }, 'x.json')).toEqual([
    'id: lowercase letters, digits and dashes', 'the file must be named Bad.json', 'kind is chat or email',
    'about: say what the app is and how its window is laid out', 'match names no app or site',
    'rule 1: "is" must be one of chatName, message, messageList, reactionList, skip, line, emailHeader, emailSubject, emailSection, emailMessage, emailBody',
    'rule 1: "where" is missing',
  ]);
  expect(profileProblems({ id: 'a', name: 'a', kind: 'chat', about: 'x', match: { urlPrefixes: ['http://a/'] },
    rules: [{ is: 'line', where: {}, text: { pattern: '(x)\\1' } }] })).toEqual([
    'urlPrefixes: http://a/ must start https:// and name its site', 'no back-references or look-behind: (x)\\1',
  ]);
});

for (const { name, f } of fixtures) {
  test(`${name}: ${f.about}`, () => {
    expect(name.startsWith(`${f.profile}-`)).toBe(true);
    const window = { bundleId: f.app, app: f.app, url: f.url ?? null };
    const profile = profileFor(window, PROFILES);
    expect(profile?.id).toBe(f.profile);
    useProfiles(PROFILES);
    if (profile?.kind === 'email') expect(mailSource(window)).not.toBeNull();
    else expect(chatApp(window)).toBe(profile!.name);
    useProfiles(null);
    const seen = engineView(f, PROFILES);
    if (!f.expect) throw new Error(`${name} has no "expect" yet; the engine makes of it:\n${JSON.stringify(seen, null, 2)}`);
    expect(seen).toEqual(f.expect);
  });
}
