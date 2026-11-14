/** SCR-101: screen text encrypted at rest. Made-up content only. */
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pollOnce } from '../src/engine.ts';
import { isSealed, keyFromEnv, seal, unseal } from '../src/sealed.ts';
import { Store } from '../src/store.ts';

const KEY = randomBytes(32);
const OTHER = randomBytes(32);
const SECRET = 'Dana Levi: can you send me the Acme contract?';

function tempDb(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'didja-sealed-'));
  return { dir, path: join(dir, 'didja.db') };
}

function raw(path: string, sql: string): unknown[] {
  const db = new Database(path, { readonly: true });
  try {
    return db.query(sql).all();
  } finally {
    db.close();
  }
}

const OBS = {
  ts: new Date().toISOString(), bundleId: 'com.anthropic.claudefordesktop', app: 'Claude', windowTitle: 'Release', url: null,
  source: 'ax' as const,
  text: ['⟦Message 2⟧', 'Claude responded: Before this works in prod:', 'Before this works in prod:', '1. Set STRIPE_WEBHOOK_SECRET in Vercel', '2. Run the migration'].join('\n'),
};

test('sealing round-trips, is never the plain text, and fails closed without the right key', () => {
  const sealed = seal(SECRET, KEY);
  expect(isSealed(sealed)).toBe(true);
  expect(sealed).not.toContain('Dana');
  expect(seal(SECRET, KEY)).not.toBe(sealed);
  expect(unseal(sealed, KEY)).toBe(SECRET);
  expect(unseal(sealed, OTHER)).toBeNull();
  expect(unseal(sealed, null)).toBeNull();
  expect(unseal('enc1:garbage', KEY)).toBeNull();
  expect(unseal('plain text', null)).toBe('plain text');
  expect(keyFromEnv({ DIDJA_DB_KEY: KEY.toString('base64') })?.equals(KEY)).toBe(true);
  expect(keyFromEnv({ DIDJA_DB_KEY: 'short' })).toBeNull();
  expect(keyFromEnv({})).toBeNull();
});

test('with a key, observation text, kept lines and email notes are stored sealed and read back', () => {
  const { dir, path } = tempDb();
  try {
    const store = new Store(path, KEY);
    store.insertObservation(OBS);
    pollOnce(store, new Date());
    const tasks = store.listTasks();
    expect(tasks.map((t) => t.title)).toContain('Run the migration');
    const id = tasks[0]!.id;
    store.addNote(id, 'origin', new Date().toISOString(), 'From an email: Dana Levi — “Acme contract”');
    expect(store.latestObservations(1)[0]!.text).toBe(OBS.text);
    expect(store.context(id)?.lines.length).toBeGreaterThan(0);
    expect(store.listEvidence(id).find((e) => e.kind === 'origin')?.detail).toBe('From an email: Dana Levi — “Acme contract”');
    expect(store.encryptionState()).toEqual({ state: 'on', clear: 0 });
    store.close();
    for (const row of raw(path, 'SELECT text FROM observations') as { text: string }[]) expect(row.text.startsWith('enc1:')).toBe(true);
    for (const row of raw(path, 'SELECT lines FROM task_context') as { lines: string }[]) expect(row.lines.startsWith('enc1:')).toBe(true);
    const [note] = raw(path, "SELECT detail FROM evidence WHERE kind = 'origin'") as { detail: string }[];
    expect(note!.detail.startsWith('enc1:')).toBe(true);
    expect(JSON.stringify(raw(path, 'SELECT * FROM observations'))).not.toContain('STRIPE_WEBHOOK_SECRET');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an old database is sealed the first time the engine opens it with the key, and nothing is lost', () => {
  const { dir, path } = tempDb();
  try {
    const old = new Store(path, null);
    old.insertObservation(OBS);
    pollOnce(old, new Date());
    const id = old.listTasks()[0]!.id;
    old.addNote(id, 'origin', new Date().toISOString(), 'From an email: Dana Levi — “Acme contract”');
    expect(old.encryptionState().state).toBe('off');
    old.close();
    expect((raw(path, 'SELECT text FROM observations') as { text: string }[])[0]!.text).toBe(OBS.text);

    const store = new Store(path, KEY);
    expect(store.encryptionState()).toEqual({ state: 'on', clear: 0 });
    expect(store.latestObservations(1)[0]!.text).toBe(OBS.text);
    expect(store.context(id)).not.toBeNull();
    expect(store.listEvidence(id).find((e) => e.kind === 'origin')?.detail).toContain('Acme contract');
    expect(store.sealExisting()).toBe(0);
    store.close();
    expect(JSON.stringify(raw(path, 'SELECT text FROM observations'))).not.toContain('STRIPE');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the wrong key, or none, fails closed: nothing read, nothing overwritten, no crash; no screens passed over', () => {
  const { dir, path } = tempDb();
  try {
    const store = new Store(path, KEY);
    store.insertObservation(OBS);
    pollOnce(store, new Date());
    const id = store.listTasks()[0]!.id;
    store.close();
    const before = JSON.stringify(raw(path, 'SELECT text FROM observations'));

    const wrong = new Store(path, OTHER);
    expect(wrong.latestObservations(1)[0]!.text).toBe('');
    expect(wrong.context(id)).toBeNull();
    expect(wrong.sealExisting()).toBe(0);
    wrong.close();
    const none = new Store(path, null);
    expect(none.latestObservations(1)[0]!.text).toBe('');
    expect(none.lacksKey()).toBe(true);
    expect(none.encryptionState().state).toBe('no-key');
    none.close();
    expect(JSON.stringify(raw(path, 'SELECT text FROM observations'))).toBe(before);

    const again = new Store(path, KEY);
    expect(again.latestObservations(1)[0]!.text).toBe(OBS.text);
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('only you can read the folder and the database', () => {
  const { dir, path } = tempDb();
  try {
    new Store(path, KEY).close();
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cost: sealing and opening 1,000 observations of 2 KB takes well under the speed targets', () => {
  const text = 'x'.repeat(2048);
  const start = performance.now();
  for (let i = 0; i < 1000; i++) expect(unseal(seal(text, KEY), KEY)!.length).toBe(2048);
  const ms = performance.now() - start;
  // A pass reads tens of observations, not thousands: this is ample room under 3 s.
  expect(ms).toBeLessThan(1000);
});

test('the app and the engine read each other: a value sealed by CryptoKit opens here, and one sealed here opens there', () => {
  const key = Buffer.alloc(32, 7);
  // Sealed by the app (CryptoKit AES.GCM, combined box), the same vector the Swift test seals with.
  expect(unseal('enc1:EVtl4Cf8FHwAscbVFEq8a126Z1NEvq7rEjjGtyZxAYaVQfHDTh0TBt1PrwcD6U4=', key)).toBe('Send Noa the slides');
  // Sealed here; the Swift test opens this exact value (SealedTests).
  expect(unseal('enc1:yy44zCZLOARkDkakPTVg0+/xt0W2XKIhm0++WjEJLlM1Trw7w/lI95FfK+EbKl3iKeyvojrLPq+xrhvVLbVJ', key)).toBe('Run the migration: supabase db push');
});

test('an engine without the key will not read screens (it would pass over them unread), unless the app started it', () => {
  const { dir, path } = tempDb();
  try {
    new Store(path, KEY).close();
    const run = (env: Record<string, string>) => Bun.spawnSync(['bun', 'src/cli.ts', 'poll'], {
      cwd: join(import.meta.dir, '..'), env: { ...process.env, DIDJA_DB_KEY: '', DIDJA_DB: path, ...env },
    });
    const outside = run({});
    expect(outside.exitCode).toBe(1);
    expect(outside.stderr.toString()).toContain('no key');
    expect(run({ DIDJA_FROM_APP: '1' }).exitCode).toBe(0);
    expect(run({ DIDJA_DB_KEY: KEY.toString('base64') }).exitCode).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
