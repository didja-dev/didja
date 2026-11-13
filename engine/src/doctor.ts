/**
 * The troubleshooting report (SCR-79): when Didja reads nothing, or reads but makes no tasks, say
 * why in plain words. Built from what is already on this Mac: the app's facts (versions,
 * permissions, whether Apple's model can run), capture's outcome log, how many screens each app
 * gave, the engine's last pass and errors, why what was read made no task, and the task counts of
 * `didja quality`. Codes and counts only: never screen text, a window title or a task's words.
 * `didja doctor` prints it; the app shows it in Help › Troubleshooting Report…, where you choose
 * whether to send it. Didja never sends it.
 */
import { localModelOf } from './localmodel.ts';
import { qualityReport, sourceGroup } from './quality.ts';
import type { Store } from './store.ts';
import { EDITORS } from './extract.ts';

/** What the app writes to `meta.app_facts` each time it starts, and before it shows the report. */
export interface AppFacts {
  version?: string;
  macOS?: string;
  /** "Apple silicon" or "Intel". */
  chip?: string;
  appPath?: string;
  debug?: boolean;
  accessibility?: boolean;
  screenRecording?: boolean;
  /** Where the app was when Accessibility was last seen allowed. */
  trustedPath?: string | null;
  /** Whether Apple's on-device model can be used, and in words why not. */
  modelAvailable?: boolean;
  modelStatus?: string;
  excluded?: { apps: number; titles: number; sites: number };
  at?: string;
}

export interface OutcomeRow { result: string; lines: number; n: number; since: string; last: string }

export interface DoctorReport {
  generatedAt: string;
  findings: string[];
  app: AppFacts | null;
  capture: {
    status: string | null;
    /** The capture status code: 'capturing', 'paused', 'needs-accessibility', 'failed', 'starting' or 'unknown'. */
    state: string;
    lastObservation: string | null;
    apps: { app: string; bundleId: string; lastHour: number; lastDay: number; outcomes: OutcomeRow[] }[];
  };
  engine: { lastPass: string | null; running: boolean; errors: { at: string; message: string }[]; localModel: string | null };
  /** Per source kind: windows read, lists or messages seen, and why they made no task (last 24 hours). */
  sources: { source: string; read: number; seen: number; made: number; drops: Record<string, number> }[];
  tasks: { source: string; made: number; ticked: number; dismissed: number }[];
  settings: { retentionHours: string; newMessagesOnly: boolean; looksDone: string; excluded: AppFacts['excluded'] | null };
  /**
   * Commands (SCR-87): open steps with a command to run, editors read and how many of their
   * readings held their built-in terminal's text, Warp's empty readings, and whether the shell hook is on.
   */
  commands: { openSteps: number; editorsRead: string[]; editorTerminalReadings: number; warpEmpty: number; shellHook: boolean };
}

/** The words for each outcome capture records (`capture_outcomes.result`). */
export const OUTCOME_WORDS: Record<string, string> = {
  ok: 'read',
  'no-focused-window': 'no window in front',
  'ax-tree-empty': 'gave no text',
  'ax-error': 'refused to answer',
  'electron-switch-failed': 'did not switch on its accessibility',
  excluded: 'on your exclude list',
  'secure-field': 'a password field',
  'ocr-used': 'read with OCR',
  'ocr-denied': 'gave no text, and OCR needs Screen Recording',
  paused: 'capture paused',
  'not-trusted': 'Accessibility is off for Didja',
};

/** The words for each reason the engine records (`engine_drops.reason`). */
export const DROP_WORDS: Record<string, string> = {
  'no-list': 'no numbered list of steps',
  'claude-own': "Claude's own plan, not steps for you",
  checking: 'waiting for the model to say whose list it is',
  'no-model': 'no model to judge it',
  older: 'older than New Messages Only',
  'not-for-you': 'asks nothing of you',
  'not-an-action': 'you said it is not an action',
  waiting: 'waiting for your reply first',
};

/** The words for each source kind. */
export const SOURCE_WORDS: Record<string, string> = {
  'claude-desktop': 'Claude', 'claude-web': 'Claude (web)', 'claude-code': 'Claude Code', terminal: 'Terminal',
  email: 'Email', chat: 'Chat', other: 'Other apps',
};

const HOUR = 3600_000;

function captureState(status: string | null): string {
  if (status === null) return 'unknown';
  if (status.startsWith('Capturing')) return 'capturing';
  if (status.startsWith('Paused')) return 'paused';
  if (status.startsWith('Needs Accessibility')) return 'needs-accessibility';
  if (status.startsWith('Starting')) return 'starting';
  return 'failed';
}

function readFacts(store: Store): AppFacts | null {
  const raw = store.getMeta('app_facts');
  if (!raw) return null;
  try {
    const facts = JSON.parse(raw);
    return facts && typeof facts === 'object' ? facts as AppFacts : null;
  } catch {
    return null;
  }
}

export function doctorReport(store: Store, now: Date = new Date()): DoctorReport {
  const hourAgo = new Date(now.getTime() - HOUR).toISOString();
  const dayAgo = new Date(now.getTime() - 24 * HOUR).toISOString();
  const app = readFacts(store);
  const status = store.getMeta('capture_status');

  const lastHour = new Map(store.observationCountsByApp(hourAgo).map((r) => [r.bundleId, r.n]));
  const byApp = new Map<string, DoctorReport['capture']['apps'][number]>();
  for (const r of store.observationCountsByApp(dayAgo)) {
    byApp.set(r.bundleId, { app: r.app, bundleId: r.bundleId, lastHour: lastHour.get(r.bundleId) ?? 0, lastDay: r.n, outcomes: [] });
  }
  for (const o of store.captureOutcomes(dayAgo)) {
    let entry = byApp.get(o.bundleId);
    if (!entry) byApp.set(o.bundleId, (entry = { app: o.app, bundleId: o.bundleId, lastHour: 0, lastDay: 0, outcomes: [] }));
    if (entry.outcomes.length < 20) entry.outcomes.push({ result: o.result, lines: o.lines, n: o.n, since: o.ts, last: o.lastTs });
  }
  const apps = [...byApp.values()].sort((a, b) => b.lastDay - a.lastDay || a.app.localeCompare(b.app));

  const lastPass = store.getMeta('engine_last_pass');
  const quality = qualityReport(store, 1, now);
  const made = new Map(quality.sources.map((s) => [s.source, s.made]));
  const sourceMap = new Map<string, DoctorReport['sources'][number]>();
  for (const d of store.drops(dayAgo)) {
    let s = sourceMap.get(d.source);
    if (!s) sourceMap.set(d.source, (s = { source: d.source, read: 0, seen: 0, made: 0, drops: {} }));
    if (d.reason === 'read') s.read += d.n;
    else if (d.reason === 'seen') s.seen += d.n;
    else s.drops[d.reason] = (s.drops[d.reason] ?? 0) + d.n;
  }
  for (const s of sourceMap.values()) s.made = made.get(sourceGroup(s.source)) ?? 0;

  // Commands: an editor draws its terminal as a picture, readable only in screen-reader mode, so a
  // command run there is never seen unless its text arrives (SCR-87). Counts only.
  const editorsRead = apps.filter((a) => EDITORS.has(a.bundleId) && a.lastDay > 0).map((a) => a.app);
  const editorTerminalReadings = editorsRead.length === 0 ? 0 : store.observationsSince(dayAgo, 5000)
    .filter((o) => EDITORS.has(o.bundleId) && o.text.includes('⟦Terminal⟧')).length;
  const warp = apps.find((a) => a.bundleId === 'dev.warp.Warp-Stable');
  const commands = {
    openSteps: store.listTasks().filter((t) => t.markers.some((m) => m.kind === 'command')).length,
    editorsRead, editorTerminalReadings,
    warpEmpty: warp ? warp.outcomes.filter((o) => o.result === 'ax-tree-empty').reduce((n, o) => n + o.n, 0) : 0,
    shellHook: store.getMeta('shell_hook') === 'on',
  };

  const report: DoctorReport = {
    generatedAt: now.toISOString(),
    findings: [],
    app,
    capture: { status, state: captureState(status), lastObservation: store.latestObservations(1)[0]?.ts ?? null, apps },
    engine: {
      lastPass,
      running: lastPass !== null && now.getTime() - Date.parse(lastPass) < 60_000,
      errors: store.engineErrors(),
      localModel: localModelOf(store),
    },
    sources: [...sourceMap.values()].sort((a, b) => b.read - a.read),
    tasks: quality.sources.map((s) => ({ source: s.source, made: s.made, ticked: s.ticked.total + s.byHand + s.shownDone, dismissed: s.dismissed + s.notAnAction })),
    settings: {
      retentionHours: store.getMeta('retention_hours') ?? '24',
      newMessagesOnly: store.getMeta('only_new') === 'on',
      looksDone: store.getMeta('looks_done') ?? 'sure',
      excluded: app?.excluded ?? null,
    },
    commands,
  };
  report.findings = findings(report);
  return report;
}

/** What is wrong, most blocking first, in plain words. Empty when nothing looks wrong. */
export function findings(r: DoctorReport): string[] {
  const out: string[] = [];
  const facts = r.app;
  if (facts === null) {
    out.push('The Didja app has not reported to this database yet: open Didja (it lives in the menu bar).');
  }
  if (r.capture.state === 'needs-accessibility' || facts?.accessibility === false) {
    const moved = facts?.trustedPath && facts.appPath && facts.trustedPath !== facts.appPath;
    out.push(moved
      ? `Accessibility is off for Didja, and Didja has moved since you allowed it (from ${facts!.trustedPath} to ${facts!.appPath}). In System Settings › Privacy & Security › Accessibility, remove Didja with the minus button, add it again, then quit and reopen Didja.`
      : 'Accessibility is off for Didja: turn it on in System Settings › Privacy & Security › Accessibility, then quit and reopen Didja.');
  }
  if (r.capture.state === 'paused') out.push('Capture is paused: choose Resume in Didja\'s menu.');
  if (r.capture.state === 'failed') out.push(`Capture stopped: ${r.capture.status}.`);
  if (facts !== null && !r.engine.running) {
    out.push(r.engine.lastPass === null
      ? 'The engine that turns what Didja reads into tasks has not run yet: quit and reopen Didja.'
      : 'The engine that turns what Didja reads into tasks has not run for over a minute: quit and reopen Didja.');
  }
  if (r.engine.errors.length > 0) out.push(`The engine reported ${r.engine.errors.length === 1 ? 'an error' : `${r.engine.errors.length} errors`} (listed below).`);

  for (const a of r.capture.apps) {
    const latest = a.outcomes[0];
    if (!latest) continue;
    const tries = a.outcomes.filter((o) => o.result === latest.result).reduce((n, o) => n + o.n, 0);
    switch (latest.result.split(' ')[0]) {
      case 'ax-tree-empty':
      case 'electron-switch-failed':
        out.push(`${a.app} has given no text in ${tries} ${tries === 1 ? 'try' : 'tries'}: its accessibility tree is empty. ${latest.result === 'electron-switch-failed' ? 'It did not switch its accessibility on when Didja asked; quit and reopen it while Didja runs.' : 'Quitting and reopening it while Didja runs can help; turning on the OCR fallback (Screen Recording) lets Didja read it from the screen.'}`);
        break;
      case 'ocr-denied':
        out.push(`${a.app} gives no text through Accessibility, and the OCR fallback needs Screen Recording: turn it on in Didja's menu › Privacy › Enable OCR Fallback.`);
        break;
      case 'excluded':
        out.push(`${a.app} is on your exclude list, so Didja never reads it.`);
        break;
      case 'no-focused-window':
        if (tries >= 5) out.push(`${a.app} shows Didja no window in front (${tries} tries).`);
        break;
      case 'ax-error':
        out.push(`${a.app} refused Didja's accessibility questions in ${tries} ${tries === 1 ? 'try' : 'tries'}.`);
        break;
    }
  }

  const model = facts?.modelAvailable;
  if (model === false) {
    out.push(`Apple Intelligence can't be used here (${facts?.modelStatus ?? 'unavailable'}): emails and chat messages are not turned into tasks, and lists that don't say whose they are show only as "maybe".`);
  }
  for (const s of r.sources) {
    const name = SOURCE_WORDS[s.source] ?? s.source;
    if (s.read === 0 || s.made > 0) continue;
    if ((s.source.startsWith('claude')) && s.seen === 0) {
      out.push(`Didja read ${s.read} ${s.read === 1 ? 'screen' : 'screens'} from ${name} but saw no numbered list of steps for you. Try asking Claude for a numbered checklist of what you need to do.`);
    } else if (s.seen > 0) {
      const top = Object.entries(s.drops).sort((a, b) => b[1] - a[1])[0];
      if (top) out.push(`${name}: ${s.seen} ${s.seen === 1 ? 'list or message' : 'lists or messages'} seen, none became a task; most often because of ${DROP_WORDS[top[0]] ?? top[0]} (${top[1]}).`);
    }
  }
  const c = r.commands;
  if (c && !c.shellHook && c.openSteps > 0) {
    if (c.editorsRead.length > 0 && c.editorTerminalReadings === 0) {
      out.push(`${c.editorsRead.join(', ')} ${c.editorsRead.length === 1 ? 'was' : 'were'} read, but never ${c.editorsRead.length === 1 ? 'its' : 'their'} built-in terminal: editors draw it as a picture, readable only in screen-reader mode. For commands you run there to tick their steps, turn on the shell hook (Settings › General › Commands), or set "editor.accessibilitySupport" to "on" in the editor's settings. Didja never changes the editor's settings.`);
    }
    if (c.warpEmpty > 0) {
      out.push(`Warp gave no text in ${c.warpEmpty} ${c.warpEmpty === 1 ? 'try' : 'tries'}, so commands run there are not seen: turn on the shell hook (Settings › General › Commands) for them to tick their steps.`);
    }
  }
  const reading = r.capture.apps.some((a) => a.lastDay > 0);
  if (out.length === 0 && r.capture.state === 'capturing' && !reading) {
    out.push('Capture is on, but nothing has been read in the last 24 hours. Click into a Claude window or a terminal and wait a few seconds.');
  }
  return out;
}

function ago(iso: string | null, now: Date): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 1000));
  if (s < 90) return `${s} s ago`;
  if (s < 90 * 60) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

/** The report as plain text, findings first. Counts and codes only. */
export function formatDoctor(r: DoctorReport): string {
  const now = new Date(r.generatedAt);
  const yes = (b: boolean | undefined) => (b === undefined ? 'unknown' : b ? 'yes' : 'no');
  const f = r.app;
  const lines: string[] = [
    `Didja troubleshooting report, ${r.generatedAt}`,
    'Counts and codes only: no screen text, window titles or task words.',
    '',
    'Findings',
    ...(r.findings.length ? r.findings.map((x) => `- ${x}`) : ['- Nothing looks wrong.']),
    '',
    'Versions',
    `  Didja ${f?.version ?? 'unknown'}${f?.debug ? ' (Debug build)' : ''} on macOS ${f?.macOS ?? 'unknown'}, ${f?.chip ?? 'unknown chip'}`,
    `  App at ${f?.appPath ?? 'unknown'}`,
    '',
    'Permissions',
    `  Accessibility: ${yes(f?.accessibility)}${f?.trustedPath && f.appPath && f.trustedPath !== f.appPath ? ` (allowed for ${f.trustedPath})` : ''}`,
    `  Screen Recording (OCR fallback): ${yes(f?.screenRecording)}`,
    '',
    'Capture',
    `  ${r.capture.status ?? 'the app has not reported yet'}`,
    `  Last reading: ${ago(r.capture.lastObservation, now)}`,
  ];
  for (const a of r.capture.apps) {
    lines.push(`  ${a.app} (${a.bundleId}): ${a.lastHour} readings in the last hour, ${a.lastDay} in 24 h`);
    for (const o of a.outcomes) {
      lines.push(`    ${o.result}${o.result === 'ok' || o.result === 'ocr-used' ? ` ${o.lines} lines` : ''} ×${o.n}, last ${ago(o.last, now)}${OUTCOME_WORDS[o.result] ? ` (${OUTCOME_WORDS[o.result]})` : ''}`);
    }
  }
  if (r.commands) {
    lines.push(`  Commands: ${r.commands.openSteps} open steps to run; shell hook ${r.commands.shellHook ? 'on' : 'off'}; editors read: ${r.commands.editorsRead.length ? r.commands.editorsRead.join(', ') : 'none'}, ${r.commands.editorTerminalReadings} readings with their terminal`);
  }
  lines.push(
    '',
    'Engine',
    `  ${r.engine.running ? 'Running' : 'Not running'}; last pass ${ago(r.engine.lastPass, now)}`,
    `  Apple's model: ${f?.modelStatus ?? 'unknown'}`,
    `  Local model: ${r.engine.localModel ?? 'off'}`,
    ...r.engine.errors.map((e) => `  error ${e.at}: ${e.message}`),
    '',
    'What was read, and why it made no task (last 24 h)',
  );
  if (r.sources.length === 0) lines.push('  nothing yet');
  for (const s of r.sources) {
    const why = Object.entries(s.drops).map(([k, n]) => `${DROP_WORDS[k] ?? k} ${n}`).join(', ');
    lines.push(`  ${SOURCE_WORDS[s.source] ?? s.source}: read ${s.read}, lists or messages seen ${s.seen}, tasks made ${s.made}${why ? `; not made: ${why}` : ''}`);
  }
  lines.push('', 'Tasks (last 24 h)');
  if (r.tasks.length === 0) lines.push('  none');
  for (const t of r.tasks) lines.push(`  ${t.source}: made ${t.made}, ticked ${t.ticked}, dismissed ${t.dismissed}`);
  const ex = r.settings.excluded;
  lines.push(
    '',
    'Settings',
    `  Keep captured text for ${r.settings.retentionHours} h; New Messages Only ${r.settings.newMessagesOnly ? 'on' : 'off'}; when a task looks done: ${r.settings.looksDone}`,
    `  Exclude list: ${ex ? `${ex.apps} apps, ${ex.titles} window titles, ${ex.sites} sites` : 'unknown'}`,
  );
  return lines.join('\n') + '\n';
}
