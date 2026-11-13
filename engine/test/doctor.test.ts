/** SCR-79: the troubleshooting report, built from a made-up store. Codes and counts only. */
import { expect, test } from 'bun:test';
import { doctorReport, formatDoctor } from '../src/doctor.ts';
import type { AppFacts } from '../src/doctor.ts';
import { pollOnce } from '../src/engine.ts';
import { Store } from '../src/store.ts';

const NOW = new Date('2026-11-10T10:05:00Z');
const at = (s: number) => new Date(NOW.getTime() + s * 1000);

const FACTS: AppFacts = {
  version: 'Didja 0.7.0 (8)', macOS: '26.1', chip: 'Apple silicon', appPath: '/Applications/Didja.app', debug: false,
  accessibility: true, screenRecording: false, trustedPath: '/Applications/Didja.app', modelAvailable: true, modelStatus: 'Available',
  excluded: { apps: 2, titles: 1, sites: 0 },
};

function store(facts: AppFacts | null = FACTS, status = 'Capturing (since 2026-11-10T09:00:00Z, app at /Applications/Didja.app)'): Store {
  const s = new Store(':memory:');
  s.setMeta('outcomes_since', '2026-11-01T00:00:00.000Z');
  if (facts) s.setMeta('app_facts', JSON.stringify(facts));
  s.setMeta('capture_status', status);
  s.notePass(at(-2));
  return s;
}

const SECRET = 'Pay Sam 20 for the Acme invoice';

test('capture outcomes keep codes and counts, never what the window said', () => {
  const s = store();
  // A made-up window holding text: what capture records of it is the result and a line count.
  s.recordCaptureOutcome('com.example.notes', 'Notes', 'ok', SECRET.split(' ').length, at(-60));
  s.recordCaptureOutcome('com.example.notes', 'Notes', 'ok', 7, at(-30));
  s.recordCaptureOutcome('com.example.notes', 'Notes', 'ax-tree-empty', 0, at(-10));
  const rows = s.captureOutcomes(at(-3600).toISOString());
  expect(rows.map((r) => [r.result, r.n])).toEqual([['ax-tree-empty', 1], ['ok', 2]]);
  const report = JSON.stringify(doctorReport(s, NOW)) + formatDoctor(doctorReport(s, NOW));
  for (const word of SECRET.split(' ').filter((w) => w.length > 3)) expect(report).not.toContain(word);
});

test('a repeated result moves one row on; at most 500 rows are kept', () => {
  const s = store();
  for (let i = 0; i < 700; i++) s.recordCaptureOutcome(`com.example.app${i % 2}`, 'App', i % 4 < 2 ? 'ok' : 'no-focused-window', 1, at(-700 + i));
  expect(s.captureOutcomes(at(-3600).toISOString()).length).toBeLessThanOrEqual(501);
  s.recordCaptureOutcome('com.example.same', 'Same', 'ok', 3, at(1));
  s.recordCaptureOutcome('com.example.same', 'Same', 'ok', 4, at(2));
  expect(s.captureOutcomes(at(0).toISOString()).filter((r) => r.bundleId === 'com.example.same')).toEqual([
    expect.objectContaining({ result: 'ok', n: 2, lines: 4 }),
  ]);
});

test('Accessibility off is the first finding', () => {
  const s = store({ ...FACTS, accessibility: false }, 'Needs Accessibility access (since 2026-11-10T09:00:00Z, app at /Applications/Didja.app)');
  const r = doctorReport(s, NOW);
  expect(r.capture.state).toBe('needs-accessibility');
  expect(r.findings[0]).toContain('Accessibility is off for Didja');
  expect(r.findings[0]).toContain('System Settings › Privacy & Security › Accessibility');
});

test('Accessibility off after the app moved says so', () => {
  const s = store({ ...FACTS, accessibility: false, appPath: '/Users/sam/Downloads/Didja.app' });
  expect(doctorReport(s, NOW).findings[0]).toContain('Didja has moved since you allowed it');
});

test('an app with an empty accessibility tree is named, with how many tries', () => {
  const s = store();
  for (let i = 0; i < 40; i++) s.recordCaptureOutcome('com.anthropic.claudefordesktop', 'Claude', 'ax-tree-empty', 0, at(-100 + i));
  const f = doctorReport(s, NOW).findings;
  expect(f).toContain('Claude has given no text in 40 tries: its accessibility tree is empty. Quitting and reopening it while Didja runs can help; turning on the OCR fallback (Screen Recording) lets Didja read it from the screen.');
});

test('an excluded app is named', () => {
  const s = store();
  s.recordCaptureOutcome('com.apple.Terminal', 'Terminal', 'excluded', 0, at(-5));
  expect(doctorReport(s, NOW).findings).toContain('Terminal is on your exclude list, so Didja never reads it.');
});

test('paused capture says how to resume', () => {
  const s = store(FACTS, 'Paused (since 2026-11-10T09:00:00Z, app at /Applications/Didja.app)');
  expect(doctorReport(s, NOW).findings).toContain("Capture is paused: choose Resume in Didja's menu.");
});

test('an engine that has stopped is a finding, and its errors are listed', () => {
  const s = store();
  s.notePass(at(-600));
  s.noteEngineError('database is locked', at(-590));
  const r = doctorReport(s, NOW);
  expect(r.engine.running).toBe(false);
  expect(r.findings.some((f) => f.includes('has not run for over a minute'))).toBe(true);
  expect(formatDoctor(r)).toContain('database is locked');
});

test('Apple Intelligence off says what that means', () => {
  const s = store({ ...FACTS, modelAvailable: false, modelStatus: 'Apple Intelligence is turned off' });
  expect(doctorReport(s, NOW).findings.some((f) => f.startsWith("Apple Intelligence can't be used here (Apple Intelligence is turned off): emails and chat messages are not turned into tasks"))).toBe(true);
});

test('Claude read but no list: the engine counts why, and the report suggests a numbered checklist', () => {
  const s = store();
  for (let i = 0; i < 3; i++) {
    s.insertObservation({
      ts: at(-60 + i * 10).toISOString(), bundleId: 'com.anthropic.claudefordesktop', app: 'Claude', windowTitle: `Chat ${i}`, url: null, source: 'ax',
      text: `Claude responded: Here is a short note about caching, part ${i}. It explains how the layers fit together.`,
    });
    pollOnce(s, at(-55 + i * 10));
  }
  const r = doctorReport(s, NOW);
  expect(r.sources).toEqual([expect.objectContaining({ source: 'claude-desktop', read: 3, seen: 0, made: 0, drops: { 'no-list': 3 } })]);
  expect(r.findings).toContain('Didja read 3 screens from Claude but saw no numbered list of steps for you. Try asking Claude for a numbered checklist of what you need to do.');
});

test('an unclear list with no model is counted as no model, and still made a task', () => {
  const s = store();
  s.insertObservation({
    ts: at(-60).toISOString(), bundleId: 'com.anthropic.claudefordesktop', app: 'Claude', windowTitle: 'Deploy', url: null, source: 'ax',
    text: 'Claude responded: Next steps:\n1. Set STRIPE_WEBHOOK_SECRET in Vercel prod\n2. Run the migration with `supabase db push`',
  });
  pollOnce(s, at(-50));
  const claude = doctorReport(s, NOW).sources.find((x) => x.source === 'claude-desktop')!;
  expect(claude.seen).toBeGreaterThan(0);
  expect(claude.made).toBeGreaterThan(0);
});

test('mail with no model is counted as no model', () => {
  const s = store();
  s.insertObservation({
    ts: at(-60).toISOString(), bundleId: 'com.microsoft.Outlook', app: 'Microsoft Outlook', windowTitle: 'Inbox', url: null, source: 'ax',
    text: 'From: Noa <noa@example.com>\nSubject: Budget\nCould you send the Q3 numbers?',
  });
  pollOnce(s, at(-50));
  const email = doctorReport(s, NOW).sources.find((x) => x.source === 'email');
  expect(email?.drops['no-model']).toBe(1);
});

test('the fast lane counts nothing: the full pass counts each window once', () => {
  const s = store();
  s.insertObservation({
    ts: at(-60).toISOString(), bundleId: 'com.anthropic.claudefordesktop', app: 'Claude', windowTitle: 'Notes', url: null, source: 'ax',
    text: 'Claude responded: Just a note, nothing to do.',
  });
  pollOnce(s, at(-55), { lane: 'fast' });
  expect(s.drops(at(-3600).toISOString())).toEqual([]);
  pollOnce(s, at(-50));
  expect(s.drops(at(-3600).toISOString())).toEqual([
    { source: 'claude-desktop', reason: 'no-list', n: 1 }, { source: 'claude-desktop', reason: 'read', n: 1 },
  ]);
});

test('nothing wrong says so; no app report says to open Didja', () => {
  const ok = store();
  ok.insertObservation({ ts: at(-60).toISOString(), bundleId: 'com.apple.Terminal', app: 'Terminal', windowTitle: 'zsh', url: null, source: 'ax', text: 'sam@mac ~ % ls' });
  ok.recordCaptureOutcome('com.apple.Terminal', 'Terminal', 'ok', 1, at(-60));
  expect(doctorReport(ok, NOW).findings).toEqual([]);
  expect(formatDoctor(doctorReport(ok, NOW))).toContain('- Nothing looks wrong.');
  const none = store(null);
  expect(doctorReport(none, NOW).findings[0]).toContain('has not reported to this database yet');
});

test('didja doctor --json has the shape the app reads', () => {
  const s = store();
  s.recordCaptureOutcome('com.apple.Terminal', 'Terminal', 'ok', 12, at(-5));
  const r = JSON.parse(JSON.stringify(doctorReport(s, NOW)));
  expect(Object.keys(r).sort()).toEqual(['app', 'capture', 'engine', 'findings', 'generatedAt', 'settings', 'sources', 'tasks']);
  expect(Object.keys(r.capture).sort()).toEqual(['apps', 'lastObservation', 'state', 'status']);
  expect(r.capture.apps[0]).toEqual({ app: 'Terminal', bundleId: 'com.apple.Terminal', lastHour: 0, lastDay: 0, outcomes: [expect.objectContaining({ result: 'ok', lines: 12, n: 1 })] });
  expect(Object.keys(r.engine).sort()).toEqual(['errors', 'lastPass', 'localModel', 'running']);
  expect(r.settings).toEqual({ retentionHours: '24', newMessagesOnly: false, looksDone: 'sure', excluded: { apps: 2, titles: 1, sites: 0 } });
});
