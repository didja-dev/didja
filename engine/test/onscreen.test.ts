/** SCR-119: "add this to Didja": text Siri passes from the screen becomes a My List item. */
import type { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keepFromScreen, keepTask, pollOnce, titleFromScreen } from '../src/engine.ts';
import { KEPT_LIST, Store } from '../src/store.ts';

const NOW = new Date(2026, 10, 14, 10, 0);
const raw = (store: Store) => (store as unknown as { db: Database }).db;
const origin = (store: Store, id: number) => store.listEvidence(id).filter((n) => n.kind === 'origin').map((n) => n.detail);

test('the title is the first line with words, without bullets or quotes, to its first sentence end', () => {
  expect(titleFromScreen('Renew the passport on gov.example.com')).toBe('Renew the passport on gov.example.com');
  expect(titleFromScreen('\n\n  • "Send Dana the signed contract"  \nSecond line')).toBe('Send Dana the signed contract');
  expect(titleFromScreen('2. Book the venue for the offsite. Then send the invite to everyone.')).toBe('Book the venue for the offsite.');
  expect(titleFromScreen('— — —\n\nCall the Acme office')).toBe('Call the Acme office');
  expect(titleFromScreen('שלח לנועה את החשבונית של מרץ')).toBe('שלח לנועה את החשבונית של מרץ');
  // A version number is not a sentence end.
  expect(titleFromScreen('Update to 2.1.4 before the release')).toBe('Update to 2.1.4 before the release');
});

test('a long line is cut at a word to at most 80 characters', () => {
  const long = 'Read the whole onboarding document for the new project and write down every question you have about the billing setup and the reports';
  const title = titleFromScreen(long)!;
  expect(title.length).toBeLessThanOrEqual(81);
  expect(title.endsWith('…')).toBe(true);
  expect(long.startsWith(title.slice(0, -1))).toBe(true);
  expect(title.slice(0, -1).endsWith(' ')).toBe(false);
});

test('nothing with words in it adds nothing', () => {
  expect(titleFromScreen('')).toBeNull();
  expect(titleFromScreen('  \n — \n ...  ')).toBeNull();
  const store = new Store(':memory:');
  expect(keepFromScreen(store, ' \n ', 'Mail', NOW)).toBeNull();
  expect(store.listTasks({ all: true })).toEqual([]);
  store.close();
});

test('text from the screen becomes one My List item, titled by the engine, noting the app, keeping nothing else', () => {
  const store = new Store(':memory:');
  const text = 'Renew the passport before March. The form is on gov.example.com.\nRef 00412-B\nSam Carter';
  const id = keepFromScreen(store, text, 'Mail', NOW)!;
  const task = store.getTask(id)!;
  expect(task.title).toBe('Renew the passport before March.');
  expect(task.sourceRef).toBe(KEPT_LIST);
  expect(task.status).toBe('open');
  expect(origin(store, id)).toEqual(['You added it to My List with Siri, from Mail']);
  // The rest of the passed text is not kept anywhere with the task: no kept lines, no other note.
  for (const n of store.listEvidence(id)) expect(n.detail ?? '').not.toContain('00412');
  expect(raw(store).query('SELECT COUNT(*) AS n FROM task_context').get()).toEqual({ n: 0 });
  expect(raw(store).query('SELECT COUNT(*) AS n FROM observations').get()).toEqual({ n: 0 });
  store.close();
});

test('with no app named it says it came from the screen, and it stays like any My List item', () => {
  const store = new Store(':memory:');
  const id = keepFromScreen(store, 'Call the Acme office', null, NOW)!;
  expect(origin(store, id)).toEqual(['You added it to My List with Siri, from the screen']);
  // Fresh Start leaves it, as it leaves My List.
  store.freshStart(NOW);
  expect(store.getTask(id)!.status).toBe('open');
  // Nothing seen on screen ticks it.
  pollOnce(store, new Date(NOW.getTime() + 60_000));
  expect(store.getTask(id)!.status).toBe('open');
  store.close();
});

test('without screen text, adding to My List behaves as before', () => {
  const store = new Store(':memory:');
  const id = keepTask(store, 'Water the plants', NOW)!;
  expect(store.getTask(id)!.title).toBe('Water the plants');
  expect(origin(store, id)).toEqual(['You added it to My List']);
  store.close();
});

test('`didja keep --screen --from <app> <text>` adds it and prints the title the engine wrote', () => {
  const dir = mkdtempSync(join(tmpdir(), 'didja-onscreen-'));
  try {
    const db = join(dir, 'didja.db');
    new Store(db).close();
    const cli = join(import.meta.dir, '..', 'src', 'cli.ts');
    const run = (...args: string[]) => Bun.spawnSync(['bun', cli, 'keep', ...args], { env: { ...process.env, DIDJA_DB: db } });
    const added = run('--screen', '--from', 'Notes', '- Book the venue for the offsite.\nThen the invites');
    expect(added.exitCode).toBe(0);
    expect(added.stdout.toString().trim()).toMatch(/^#\d+ on My List: Book the venue for the offsite\.$/);
    expect(run('--screen', '--from', 'Notes', ' \n ').exitCode).toBe(1);
    const store = new Store(db);
    const [task] = store.listTasks({ all: true });
    expect(store.listTasks({ all: true }).length).toBe(1);
    expect(origin(store, task!.id)).toEqual(['You added it to My List with Siri, from Notes']);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
