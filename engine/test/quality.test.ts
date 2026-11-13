/** SCR-73: "How Didja is doing", counted on a made-up store. */
import { expect, test } from 'bun:test';
import { addManualTask, pollOnce } from '../src/engine.ts';
import { doneAt } from '../src/missed.ts';
import { formatQuality, qualityReport, sourceGroup } from '../src/quality.ts';
import { Store } from '../src/store.ts';

const NOW = new Date('2026-11-10T10:05:00Z');
const at = (m: number) => new Date(NOW.getTime() + m * 60_000);
/** A store recording since before the made-up times here (schema 25 stamps the real clock). */
function fresh(): Store {
  const store = new Store(':memory:');
  store.setMeta('outcomes_since', '2026-11-01T00:00:00.000Z');
  return store;
}

function claudeList(store: Store): number[] {
  store.insertObservation({
    ts: '2026-11-10T10:00:00.000Z', bundleId: 'com.anthropic.claudefordesktop', app: 'Claude', windowTitle: 'Stripe webhooks', url: null, source: 'ax',
    text: 'Claude responded: Before this works in prod:\nBefore this works in prod:\n1. Set STRIPE_WEBHOOK_SECRET in Vercel prod\n2. Run the migration with `supabase db push`',
  });
  pollOnce(store, NOW);
  return store.listTasks({ all: true }).filter((t) => !t.isGroup && t.sourceKind === 'claude-desktop').map((t) => t.id);
}

function runInTerminal(store: Store): void {
  store.insertObservation({
    ts: '2026-11-10T10:06:00.000Z', bundleId: 'com.apple.Terminal', app: 'Terminal', windowTitle: 'zsh', url: null, source: 'ax',
    text: 'sam@mac acme-web % supabase db push\nApplying migration 20261110_webhooks.sql...\nFinished supabase db push.\nsam@mac acme-web % ',
  });
  pollOnce(store, at(2));
}

test('a tick from a command run is counted, and reopening it counts as a wrong tick', () => {
  const store = fresh();
  const [, push] = claudeList(store);
  runInTerminal(store);
  expect(store.getTask(push!)!.status).toBe('done');
  expect(store.lastOutcome(push!)).toBe('ticked-command');

  store.changeByYou(push!, 'open', at(3));
  expect(store.lastOutcome(push!)).toBe('reopened-after-tick');
  // Reopening something you ticked yourself is not a wrong tick.
  const mine = addManualTask(store, 'Send Sam the deck', NOW)!;
  store.changeByYou(mine, 'done', at(3));
  store.changeByYou(mine, 'open', at(4));
  expect(store.lastOutcome(mine)).toBe('done-by-hand');

  const r = qualityReport(store, 7, at(5));
  const claude = r.sources.find((s) => s.source === 'Claude')!;
  expect(claude.made).toBe(2);
  expect(claude.ticked).toMatchObject({ command: 1, total: 1 });
  expect(claude.reopenedAfterTick).toBe(1);
  expect(r.sources.find((s) => s.source === 'Added by you')).toMatchObject({ made: 1, byHand: 1, reopenedAfterTick: 0 });
  expect(r.overall.reopenedAfterTick).toBe(1);
  store.close();
});

test('"looks done?": asked, yes, not yet and no answer', () => {
  const store = fresh();
  const [a, b, c] = [1, 2, 3].map((n) => addManualTask(store, `Call Noa about item ${n}`, NOW)!);
  for (const id of [a, b, c]) store.suggestDone(id!, 'vercel.com', null, at(1));
  store.changeByYou(a!, 'done', at(2)); // "Yes, done"
  store.rejectSuggestion(b!, at(2)); // "Not yet"
  const r = qualityReport(store, 7, at(3)).overall;
  expect(r).toMatchObject({ asked: 3, yes: 1, notYet: 1, noAnswer: 1, byHand: 0 });
  store.close();
});

test('accepted automatically, a reply, shown done, dismissed, Not an Action and Fresh Start are each counted once per step', () => {
  const store = fresh();
  const [accepted, replied, shown, dismissed, notAction, cleared] =
    ['Approve the Acme order', 'Answer Sam about Friday', 'Rotate the API key', 'Read the newsletter', 'Lunch at noon', 'Renew the domain']
      .map((t) => addManualTask(store, t, NOW)!);
  store.acceptLooksDone(accepted!, 'acme.example.com', at(1));
  store.tickByReply(replied!, 'WhatsApp — Sam', at(1));
  const o = store.insertObservation({ ts: at(1).toISOString(), bundleId: 'com.google.Chrome', app: 'Chrome', windowTitle: 'Keys', url: 'https://dashboard.example.com/keys', source: 'ax', text: 'Key rotated' });
  doneAt(store, shown!, o, at(1));
  store.changeByYou(dismissed!, 'dismissed', at(1));
  store.notAnAction(notAction!, at(1));
  store.freshStart(at(2));
  const r = qualityReport(store, 7, at(3)).overall;
  expect(r.ticked).toMatchObject({ accepted: 1, reply: 1, total: 2 });
  expect(r).toMatchObject({ made: 6, shownDone: 1, dismissed: 1, notAnAction: 1, freshStart: 1, byHand: 0 });
  expect(store.lastOutcome(cleared!)).toBe('fresh-start');
  // Undoing the Fresh Start takes it back out of the count.
  store.undoFreshStart(at(4));
  expect(qualityReport(store, 7, at(5)).overall.freshStart).toBe(0);
  store.close();
});

test('ticking a checklist by hand counts each step it changed, not the checklist', () => {
  const store = fresh();
  const [first] = claudeList(store);
  store.changeByYou(first!, 'done', at(1));
  const root = store.getTask(first!)!.parentId!;
  store.changeByYou(root, 'done', at(2));
  const r = qualityReport(store, 7, at(3));
  expect(r.overall.byHand).toBe(2);
  store.close();
});

test('only the last N days are counted, and nothing before recording began', () => {
  const store = fresh();
  const old = addManualTask(store, 'Old thing', new Date('2026-11-02T10:00:00Z'))!;
  store.changeByYou(old, 'done', new Date('2026-11-02T11:00:00Z'));
  const recent = addManualTask(store, 'New thing', NOW)!;
  store.changeByYou(recent, 'done', at(1));
  expect(qualityReport(store, 7, at(2)).overall).toMatchObject({ made: 1, byHand: 1 });
  const wide = qualityReport(store, 30, at(2));
  expect(wide.overall).toMatchObject({ made: 2, byHand: 2 });
  expect(wide.since).toBe('2026-11-01T00:00:00.000Z');
  store.close();
});

test('the report holds numbers only: no titles, no text from the screen', () => {
  const store = fresh();
  claudeList(store);
  runInTerminal(store);
  const r = qualityReport(store, 7, at(3));
  for (const out of [JSON.stringify(r), formatQuality(r)]) {
    expect(out).not.toContain('STRIPE');
    expect(out).not.toContain('supabase');
    expect(out).not.toContain('webhooks');
  }
  expect(formatQuality(r)).toContain('never leave this Mac');
  store.close();
});

test('sources fall into the groups shown', () => {
  expect(['claude-desktop', 'claude-web', 'claude-code', 'email', 'chat', 'manual', 'kept', 'external', 'window'].map(sourceGroup))
    .toEqual(['Claude', 'Claude', 'Claude Code', 'Email', 'Chat', 'Added by you', 'Added by you', 'Connected tools', 'Other']);
});
