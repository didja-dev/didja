/** SCR-96: every task says why it was made and how sure Didja is, in the engine's own words. Made-up content only. */
import { expect, test } from 'bun:test';
import { loadScenarios, runScenario } from '../bench/run.ts';
import { formatWhy } from '../src/cli.ts';
import { bandOf, captureLine, defaultWhy, WHY } from '../src/capturewhy.ts';
import type { ChatReader } from '../src/chat.ts';
import type { MailReader } from '../src/email.ts';
import { acceptSuggestion, addManualTask, confirmChecking, keepTask, pollOnce } from '../src/engine.ts';
import type { Judge } from '../src/engine.ts';
import { Store } from '../src/store.ts';

const NOW = new Date(2026, 10, 11, 10, 0);
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();
const steps = (store: Store) => store.listTasks({ all: true }).filter((t) => !t.isGroup);
const claude = (store: Store, text: string, ts = at(1)) => store.insertObservation({
  ts, bundleId: 'com.anthropic.claudefordesktop', app: 'Claude', windowTitle: 'Launch', url: null, source: 'ax', text });

const CLEAR = 'Claude responded: On your side:\nOn your side:\n1. Add the redirect URL in the Supabase dashboard\n2. Run `supabase db push`';
const UNCLEAR = 'Claude responded: Almost there.\nNext steps:\n1. Add the redirect URL in the Supabase dashboard\n2. Run the smoke test\nThat should be it.';

test('a list handed to you by its wording, with its command step', () => {
  const store = new Store(':memory:');
  claude(store, CLEAR);
  pollOnce(store, NOW, {});
  expect(steps(store).map((t) => t.capturedWhy)).toEqual([
    'A list from Claude handed to you by its own wording',
    'A list from Claude handed to you by its own wording · a command step',
  ]);
  store.close();
});

test('an unclear list: checking, then judged yours; with no model, unjudged; you ticking one settles it', () => {
  const store = new Store(':memory:');
  claude(store, UNCLEAR);
  pollOnce(store, NOW, { lane: 'fast', judging: true });
  expect(steps(store)[0]!.capturedWhy).toBe(WHY.listChecking('claude-desktop'));
  expect(captureLine(steps(store)[0]!)).toContain('checking whose it is');
  const judge: Judge = () => ({ audience: 'user', model: 'test' });
  pollOnce(store, new Date(NOW.getTime() + 60_000), { judge });
  expect(steps(store).map((t) => t.capturedWhy)).toEqual([WHY.listJudged('claude-desktop'), WHY.listJudged('claude-desktop')]);
  expect(captureLine(steps(store)[0]!)).toContain(' · sure · ');
  store.close();

  const noModel = new Store(':memory:');
  claude(noModel, UNCLEAR);
  pollOnce(noModel, NOW, {});
  expect(steps(noModel)[0]!.capturedWhy).toBe(WHY.listNoModel('claude-desktop'));
  expect(captureLine(steps(noModel)[0]!)).toContain('possibly yours');
  noModel.close();

  const ticked = new Store(':memory:');
  claude(ticked, UNCLEAR);
  pollOnce(ticked, NOW, { lane: 'fast', judging: true });
  expect(confirmChecking(ticked, steps(ticked)[0]!.id, NOW)).toBe(true);
  expect(steps(ticked)[1]!.capturedWhy).toBe(WHY.listYouTicked('claude-desktop'));
  ticked.close();
});

test('emails, chats, accepted suggestions, your own tasks: each says why', () => {
  const store = new Store(':memory:');
  store.setMeta('my_name', 'Mike Rosen');
  const mailReader: MailReader = () => ({ need: 'reply', task: 'Send Dana the updated Q3 numbers' });
  store.insertObservation({ ts: '2026-11-11T09:59:00.000Z', bundleId: 'com.microsoft.Outlook', app: 'Microsoft Outlook', windowTitle: 'Inbox • me@example.com', url: null, source: 'ax',
    text: 'Inbox\n⟦Email⟧\nSubject: Q3 budget numbers\nFrom: Dana Levi, dana@acme.com\nDate: Today at 9:58\nTo: me@example.com\nHi Mike,\nCan you send me the updated Q3 numbers by Thursday?' });
  pollOnce(store, NOW, { mailReader });
  const chat = (kind: string, from: string, extra: string, body: string, title: string) =>
    store.insertObservation({ ts: at(2), bundleId: 'net.whatsapp.WhatsApp', app: 'WhatsApp', windowTitle: title, url: null, source: 'ax',
      text: [`⟦Chat message: ${title} (${kind}) — from ${from}${extra} — Today at 9:05⟧`, body].join('\n') });
  const chatReader = (task: string): ChatReader => () => ({ asks: true, task });
  chat('direct', 'Dana Levi', '', 'Can you send me the signed contract?', 'Dana Levi');
  pollOnce(store, NOW, { chatReader: chatReader('Send Dana the signed contract') });
  chat('group', 'Ron', ', mentions me', 'Mike can you restart staging?', 'Ops');
  pollOnce(store, NOW, { chatReader: chatReader('Restart staging') });
  chat('group', 'Ron', '', 'Everyone please confirm by Thursday', 'Team');
  pollOnce(store, NOW, { chatReader: chatReader('Confirm by Thursday') });
  store.setCaptureLevel('everything');
  chat('group', 'Ron', '', 'Can someone order lunch?', 'Lunch');
  pollOnce(store, NOW, { chatReader: chatReader('Order lunch') });
  acceptSuggestion(store, store.suggestions()[0]!.id, NOW);
  addManualTask(store, 'Call the bank', NOW);
  keepTask(store, 'Buy a gift', NOW);
  const why = Object.fromEntries(store.listTasks({ all: true }).map((t) => [t.title, t.capturedWhy]));
  expect(why).toEqual({
    'Send Dana the updated Q3 numbers': WHY.emailReply,
    'Send Dana the signed contract': WHY.chatDirect,
    'Restart staging': WHY.chatNamed,
    'Confirm by Thursday': WHY.chatEveryone,
    'Order lunch': WHY.chatAccepted,
    'Call the bank': WHY.manual,
    'Buy a gift': WHY.kept,
  });
  // `why` shows it with how sure and when, and no reason names a person or repeats the screen.
  const task = store.listTasks().find((t) => t.title === 'Restart staging')!;
  expect(formatWhy(task, store.listEvidence(task.id))).toContain('Made: Someone tagged or named you in a group');
  for (const reason of Object.values(why)) {
    for (const words of ['Dana', 'Ron', 'Mike', 'contract', 'staging', 'lunch', 'Q3', 'Thursday']) expect(reason).not.toContain(words);
  }
  store.close();
});

test('a reason for any other source, the bands, and tasks from before', () => {
  expect(defaultWhy('external', 'Linear')).toBe("An item from Linear, brought in by your connection's rules");
  expect(defaultWhy('email', 'Gmail')).toBe('An email that asks something of you');
  expect(defaultWhy('codex', 'Codex (iTerm2)')).toBe('A step from Codex handed to you');
  expect([0.1, 0.2, 0.3, 1].map(bandOf)).toEqual(['checking', 'unjudged', 'sure', 'sure']);
  expect(captureLine({ capturedWhy: null, confidence: 1, createdAt: at(0), sourceRef: 'Claude — Launch' })).toBeNull();
});

test('benchmark: every task captured has a reason, and no reason holds screen text', () => {
  for (const s of loadScenarios()) {
    const r = runScenario(s);
    const lines = s.steps.flatMap((step) => step.text).map((l) => l.trim()).filter((l) => l.length >= 12 && !l.startsWith('⟦'));
    for (const why of r.whys) {
      expect({ id: s.id, missing: why === null }).toEqual({ id: s.id, missing: false });
      const leak = lines.find((l) => why!.includes(l)) ?? r.titles.find((t) => t.length >= 8 && why!.includes(t)) ?? null;
      expect({ id: s.id, why, leak }).toEqual({ id: s.id, why, leak: null });
    }
  }
}, 120_000);
