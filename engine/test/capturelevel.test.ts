/** SCR-95: how eagerly asks become tasks (Strict / Balanced / Everything), and the Suggested tray. Made-up content only. */
import type { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { loadScenarios, runScenario } from '../bench/run.ts';
import { chatAudience } from '../src/chat.ts';
import type { ChatQuestion, ChatReader } from '../src/chat.ts';
import { acceptSuggestion, pollOnce } from '../src/engine.ts';
import { Store } from '../src/store.ts';

// Wednesday 11 November 2026, 10:00 local time.
const NOW = new Date(2026, 10, 11, 10, 0);
const ME = ['Mike Rosen'];
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();
const section = (chat: string, kind: string, from: string, time: string, extra = '') =>
  `⟦Chat message: ${chat} (${kind}) — from ${from}${extra} — ${time}⟧`;

function seeded(lines: string[], title: string, level?: 'strict' | 'balanced' | 'everything'): Store {
  const store = new Store(':memory:');
  store.setMeta('my_name', 'Mike Rosen');
  if (level) store.setCaptureLevel(level);
  observe(store, lines, at(1), title);
  return store;
}
function observe(store: Store, lines: string[], ts: string, title: string): void {
  store.insertObservation({ ts, bundleId: 'net.whatsapp.WhatsApp', app: 'WhatsApp', windowTitle: title, url: null, source: 'ax', text: lines.join('\n') });
}
function reader(task = 'Restart the staging server') {
  const asked: ChatQuestion[] = [];
  const read: ChatReader = (q) => { asked.push(q); return { asks: true, task }; };
  return { read, asked };
}

const DIRECT = [section('Dana Levi', 'direct', 'Dana Levi', 'Today at 9:05'), 'Can you send me the signed contract?'];
const NAMED = [section('Ops', 'group', 'Ron', 'Today at 9:05', ', mentions me'), 'Mike can you restart staging?'];
const EVERYONE = [section('Ops', 'group', 'Ron', 'Today at 9:05'), 'Everyone please confirm by Thursday'];
const NOBODY = [section('Ops', 'group', 'Ron', 'Today at 9:05'), 'Can someone restart the staging server?'];

test('who a message is put to, at each level', () => {
  const m = { chat: 'Ops', kind: 'group' as const, from: 'Ron', mentionsMe: false, time: 'Today at 9:05', body: 'Can someone restart the staging server?' };
  const everyone = { ...m, body: 'Everyone please confirm by Thursday' };
  const named = { ...m, mentionsMe: true };
  const direct = { ...m, kind: 'direct' as const };
  expect(['strict', 'balanced', 'everything'].map((l) => chatAudience(direct, ME, l as 'strict', NOW))).toEqual(['direct', 'direct', 'direct']);
  expect(['strict', 'balanced', 'everything'].map((l) => chatAudience(named, ME, l as 'strict', NOW))).toEqual(['named', 'named', 'named']);
  expect(['strict', 'balanced', 'everything'].map((l) => chatAudience(everyone, ME, l as 'strict', NOW))).toEqual([null, 'everyone', 'everyone']);
  expect(['strict', 'balanced', 'everything'].map((l) => chatAudience(m, ME, l as 'strict', NOW))).toEqual([null, null, 'group']);
  // Your own message, or an old one, is never asked about, at any level.
  expect(chatAudience({ ...m, from: 'me' }, ME, 'everything', NOW)).toBeNull();
  expect(chatAudience({ ...m, time: '1 October at 9:05' }, ME, 'everything', NOW)).toBeNull();
});

test('Balanced is the default and is what Didja always did', () => {
  const store = new Store(':memory:');
  expect(store.captureLevel()).toBe('balanced');
  store.setCaptureLevel('everything');
  expect(store.captureLevel()).toBe('everything');
  store.setMeta('capture_level', 'nonsense');
  expect(store.captureLevel()).toBe('balanced');
  store.close();
});

test('Strict keeps direct asks and asks that name you, and leaves out asks to every member', () => {
  for (const lines of [DIRECT, NAMED]) {
    const store = seeded(lines, 'Chat', 'strict');
    pollOnce(store, NOW, { chatReader: reader().read });
    expect(store.listTasks().length).toBe(1);
    store.close();
  }
  const store = seeded(EVERYONE, 'Ops', 'strict');
  const { read, asked } = reader();
  pollOnce(store, NOW, { chatReader: read });
  expect(asked).toEqual([]);
  expect(store.listTasks()).toEqual([]);
  store.close();
});

test('Everything: a group ask that names nobody goes to Suggested, never to the list, and is never ticked', () => {
  const store = seeded(NOBODY, 'Ops', 'everything');
  const { read, asked } = reader();
  pollOnce(store, NOW, { chatReader: read });
  expect(asked[0]?.addressed).toBe('group');
  expect(store.listTasks({ all: true })).toEqual([]);
  const [s] = store.suggestions();
  expect(s).toMatchObject({ kind: 'chat', sourceRef: 'WhatsApp — Ops', title: 'Restart the staging server' });
  // Only the engine's title is kept, never the message.
  const raw = JSON.stringify((store as unknown as { db: Database }).db.query('SELECT * FROM suggestions').all());
  expect(raw).not.toContain('Can someone');
  // Seen again: not asked again, not suggested twice.
  observe(store, [...NOBODY, 'x'], at(2), 'Ops');
  pollOnce(store, NOW, { chatReader: read });
  expect(asked.length).toBe(1);
  expect(store.suggestions().length).toBe(1);
  // A screen that would tick a chat task (your reply) only clears the suggestion: nothing is ticked.
  observe(store, [...NOBODY, section('Ops', 'group', 'me', 'Today at 9:20'), 'Done, restarted it'], at(3), 'Ops');
  pollOnce(store, NOW, { chatReader: read });
  expect(store.listTasks({ all: true })).toEqual([]);
  expect(store.suggestions()).toEqual([]);
  store.close();
});

test('the same group ask at Balanced is not asked about, as before', () => {
  const store = seeded(NOBODY, 'Ops', 'balanced');
  const { read, asked } = reader();
  pollOnce(store, NOW, { chatReader: read });
  expect(asked).toEqual([]);
  expect(store.suggestions()).toEqual([]);
  store.close();
});

test('Accept makes a suggestion a chat task; Not an Action teaches and it never comes back', () => {
  const store = seeded(NOBODY, 'Ops', 'everything');
  pollOnce(store, NOW, { chatReader: reader().read });
  const [s] = store.suggestions();
  expect(acceptSuggestion(store, s!.id, NOW)).toBe(true);
  expect(store.suggestions()).toEqual([]);
  expect(store.listTasks()).toMatchObject([{ title: 'Restart the staging server', sourceKind: 'chat', sourceRef: 'WhatsApp — Ops', status: 'open' }]);
  expect(acceptSuggestion(store, s!.id, NOW)).toBe(false);
  store.close();

  const other = seeded(NOBODY, 'Ops', 'everything');
  pollOnce(other, NOW, { chatReader: reader().read });
  const [t] = other.suggestions();
  expect(other.notAnActionSuggestion(t!.id, NOW)).toBe(true);
  expect(other.suggestions()).toEqual([]);
  expect(other.isNotAnAction('Restart the staging server', 'chats')).toBe(true);
  // The same ask in another message: the lesson keeps it out.
  observe(other, [section('Ops', 'group', 'Ron', 'Today at 9:30'), 'Could somebody restart the staging server?'], at(4), 'Ops');
  pollOnce(other, NOW, { chatReader: reader().read });
  expect(other.suggestions()).toEqual([]);
  expect(other.listTasks()).toEqual([]);
  other.close();
});

test('suggestions older than 24 hours leave without a trace', () => {
  const store = seeded(NOBODY, 'Ops', 'everything');
  pollOnce(store, NOW, { chatReader: reader().read });
  expect(store.suggestions().length).toBe(1);
  pollOnce(store, new Date(NOW.getTime() + 25 * 3600_000), { chatReader: reader().read });
  expect(store.suggestions()).toEqual([]);
  expect(store.listTasks({ all: true })).toEqual([]);
  store.close();
});

test('Strict leaves out a list whose wording does not say it is yours; a list handed to you stays', () => {
  const unclear = 'Claude responded: Almost there.\nNext steps:\n1. Add the redirect URL in the Supabase dashboard\n2. Run the smoke test\nThat should be it.';
  const clear = 'Claude responded: On your side:\nOn your side:\n1. Add the redirect URL in the Supabase dashboard\n2. Run the smoke test';
  const run = (text: string, level: 'strict' | 'balanced') => {
    const store = new Store(':memory:');
    store.setCaptureLevel(level);
    store.insertObservation({ ts: at(1), bundleId: 'com.anthropic.claudefordesktop', app: 'Claude', windowTitle: 'Launch', url: null, source: 'ax', text });
    pollOnce(store, NOW, {});
    const n = store.listTasks({ all: true }).filter((t) => !t.isGroup).length;
    store.close();
    return n;
  };
  expect(run(unclear, 'balanced')).toBe(2); // kept, greyed, with no model
  expect(run(unclear, 'strict')).toBe(0);
  expect(run(clear, 'strict')).toBe(2);
  expect(run(clear, 'balanced')).toBe(2);
});

test('benchmark: Balanced is exactly today; Strict is a subset; Everything adds only to Suggested; no wrong ticks', () => {
  const sorted = (xs: string[]) => [...xs].sort();
  for (const s of loadScenarios()) {
    const today = runScenario(s);
    const balanced = runScenario(s, {}, 'none', 'balanced');
    const strict = runScenario(s, {}, 'none', 'strict');
    const everything = runScenario(s, {}, 'none', 'everything');
    expect({ id: s.id, titles: sorted(balanced.titles), ticked: balanced.ticked }).toEqual({ id: s.id, titles: sorted(today.titles), ticked: today.ticked });
    expect({ id: s.id, titles: sorted(everything.titles) }).toEqual({ id: s.id, titles: sorted(today.titles) });
    const left = [...today.titles];
    for (const t of strict.titles) {
      const i = left.indexOf(t);
      expect({ id: s.id, strictOnly: i < 0 ? t : null }).toEqual({ id: s.id, strictOnly: null });
      left.splice(i, 1);
    }
    for (const r of [balanced, strict, everything]) expect({ id: s.id, wrong: r.wrongTicks }).toEqual({ id: s.id, wrong: [] });
  }
}, 120_000);
