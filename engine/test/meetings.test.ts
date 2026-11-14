import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { acceptSuggestion, pollOnce } from '../src/engine.ts';
import { actionItems, isYou, meetingFor, meetingProfiles, ownerOf } from '../src/meetings.ts';
import type { MeetingItem } from '../src/meetings.ts';
import { Store } from '../src/store.ts';

const FIXTURES = join(import.meta.dir, '../../profiles/fixtures/meetings');
interface Fixture { profile: string; app: string; bundle: string; title: string; onSite?: boolean; lines: string[]; expect: { items: MeetingItem[] } }
const fixtures = readdirSync(FIXTURES).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(FIXTURES, f), 'utf8')) as Fixture);
const NOW = new Date('2026-11-11T10:00:00Z');

test('every supported meeting tool has a fixture its window is recognised by, and its action items are read as labelled (SCR-107)', () => {
  const supported = meetingProfiles().filter((p) => p.supported);
  expect(supported.length).toBeGreaterThanOrEqual(5);
  for (const p of supported) {
    const f = fixtures.find((x) => x.profile === p.id);
    expect({ profile: p.id, fixture: !!f }).toEqual({ profile: p.id, fixture: true });
    // A fixture shown in a browser is on the tool's own site (fixtures hold no real addresses).
    const url = f!.onSite ? `https://${p.match.hosts![0]}/notes/1` : null;
    expect(meetingFor({ bundleId: f!.bundle, url })?.id).toBe(p.id);
    expect({ profile: p.id, items: actionItems(p, f!.lines.join('\n')) }).toEqual({ profile: p.id, items: f!.expect.items });
  }
  // A tool that cannot be read yet is listed, with why, and never matched.
  const teams = meetingProfiles().find((p) => p.id === 'teams-recap')!;
  expect(teams.supported).toBe(false);
  expect(teams.about).toContain('Not supported');
  expect(meetingFor({ bundleId: 'com.microsoft.teams2', url: null })).toBeNull();
  // Any other window is no meeting tool.
  expect(meetingFor({ bundleId: 'com.apple.Safari', url: 'https://example.com/notes' })).toBeNull();
});

test('who an item is for, in the ways notes write it', () => {
  expect(ownerOf('Mike: send the deck')).toEqual({ title: 'Send the deck', owner: 'Mike' });
  expect(ownerOf('Send the deck (Mike)')).toEqual({ title: 'Send the deck', owner: 'Mike' });
  expect(ownerOf('Send the deck — Sam Carter')).toEqual({ title: 'Send the deck', owner: 'Sam Carter' });
  expect(ownerOf('Sam to send the deck')).toEqual({ title: 'Send the deck', owner: 'Sam' });
  expect(ownerOf('Send the deck, owner: Dana')).toEqual({ title: 'Send the deck', owner: 'Dana' });
  expect(ownerOf('Me: send the deck')).toEqual({ title: 'Send the deck', owner: 'me' });
  // Words that start an item are not names.
  expect(ownerOf('Follow up: send the deck')).toEqual({ title: 'Follow up: send the deck', owner: null });
  expect(ownerOf('Send the deck (by Friday)')).toEqual({ title: 'Send the deck (by Friday)', owner: null });
  expect(isYou('me', ['Mike Rosen'])).toBe(true);
  expect(isYou('Mike', ['Mike Rosen'])).toBe(true);
  expect(isYou('Mike Carter', ['Mike Rosen'])).toBe(false); // another Mike
  expect(isYou('Sam', ['Mike Rosen'])).toBe(false);
});

function granola(store: Store, lines: string[], minutes = 1) {
  store.insertObservation({ ts: new Date(NOW.getTime() + minutes * 60_000).toISOString(), bundleId: 'com.granola.app', app: 'Granola',
    windowTitle: 'Weekly sync with Acme', url: null, source: 'ax', text: lines.join('\n') });
}
const seeded = () => {
  const store = new Store(':memory:');
  store.setMeta('my_name', 'Mike Rosen');
  return store;
};

test('yours becomes a task; someone else\'s makes nothing; one that names no one goes to Suggested (SCR-107)', () => {
  const store = seeded();
  granola(store, fixtures.find((f) => f.profile === 'granola')!.lines);
  pollOnce(store, NOW, {});
  const tasks = store.listTasks();
  expect(tasks.map((t) => [t.title, t.sourceRef])).toEqual([['Send the revised quote to Acme', 'Granola — Weekly sync with Acme']]);
  expect(tasks[0]!.sourceKind).toBe('meeting');
  expect(tasks[0]!.capturedWhy).toBe("An action item for you in Granola's meeting notes");
  // Sam's item is not on the list or in the tray; the ticked one made nothing.
  expect(store.suggestions().map((s) => [s.kind, s.title, s.sourceRef])).toEqual([['meeting', 'Share the slides with the team', 'Granola — Weekly sync with Acme']]);
  // Read again: nothing new.
  granola(store, ['Action items', 'Mike: send the revised quote to Acme'], 2);
  pollOnce(store, NOW, {});
  expect(store.listTasks().length).toBe(1);
  // Accepting the suggestion makes it a meeting task.
  expect(acceptSuggestion(store, store.suggestions()[0]!.id, NOW)).toBe(true);
  expect(store.listTasks().map((t) => t.title).sort()).toEqual(['Send the revised quote to Acme', 'Share the slides with the team']);
  store.close();
});

test('under Strict an item that names no one makes nothing; another Mike\'s item is not yours (SCR-107)', () => {
  const store = seeded();
  store.setCaptureLevel('strict');
  granola(store, ['Action items', 'Share the slides with the team', 'Mike Carter: send the invoice']);
  pollOnce(store, NOW, {});
  expect(store.listTasks()).toEqual([]);
  expect(store.suggestions()).toEqual([]);
  store.close();
});

test('a box ticked in the tool on your item asks "looks done?", never ticks (SCR-107)', () => {
  const store = seeded();
  granola(store, ['Action items', '☐ Mike: send the revised quote to Acme']);
  pollOnce(store, NOW, {});
  const id = store.listTasks()[0]!.id;
  granola(store, ['Action items', '☑ Mike: send the revised quote to Acme'], 5);
  pollOnce(store, NOW, {});
  const task = store.getTask(id)!;
  expect(task.status).toBe('open');
  expect(task.suggestion).toBe('Granola — Weekly sync with Acme (its box is ticked)');
  store.close();
});
