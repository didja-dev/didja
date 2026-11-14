import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import schema1 from '../../schema/001_init.sql' with { type: 'text' };
import schema2 from '../../schema/002_evidence.sql' with { type: 'text' };
import schema3 from '../../schema/003_groups.sql' with { type: 'text' };
import schema4 from '../../schema/004_snooze.sql' with { type: 'text' };
import schema5 from '../../schema/005_judgements.sql' with { type: 'text' };
import schema6 from '../../schema/006_tree.sql' with { type: 'text' };
import schema7 from '../../schema/007_model_title.sql' with { type: 'text' };
import schema8 from '../../schema/008_looks_done.sql' with { type: 'text' };
import schema9 from '../../schema/009_email.sql' with { type: 'text' };
import schema10 from '../../schema/010_nudges.sql' with { type: 'text' };
import schema11 from '../../schema/011_email_tasks.sql' with { type: 'text' };
import schema12 from '../../schema/012_accepted.sql' with { type: 'text' };
import schema13 from '../../schema/013_teaching.sql' with { type: 'text' };
import schema14 from '../../schema/014_place.sql' with { type: 'text' };
import schema15 from '../../schema/015_merges.sql' with { type: 'text' };
import schema16 from '../../schema/016_context.sql' with { type: 'text' };
import schema17 from '../../schema/017_merge_index.sql' with { type: 'text' };
import schema18 from '../../schema/018_chat_pending.sql' with { type: 'text' };
import schema19 from '../../schema/019_canvas.sql' with { type: 'text' };
import schema20 from '../../schema/020_canvas_levels.sql' with { type: 'text' };
import schema21 from '../../schema/021_done_places.sql' with { type: 'text' };
import schema22 from '../../schema/022_criteria_model.sql' with { type: 'text' };
import schema23 from '../../schema/023_teaching_any_job.sql' with { type: 'text' };
import schema24 from '../../schema/024_window_key.sql' with { type: 'text' };
import schema25 from '../../schema/025_outcomes.sql' with { type: 'text' };
import schema26 from '../../schema/026_timings.sql' with { type: 'text' };
import schema27 from '../../schema/027_trust.sql' with { type: 'text' };
import schema28 from '../../schema/028_troubleshooting.sql' with { type: 'text' };
import schema29 from '../../schema/029_suggestions.sql' with { type: 'text' };
import schema30 from '../../schema/030_capture_reason.sql' with { type: 'text' };
import { defaultWhy, WHY } from './capturewhy.ts';
import { contextLines } from './context.ts';
import { parseCriteria } from './donecriteria.ts';
import type { DoneCriteria } from './donecriteria.ts';
import type { ContextLine } from './context.ts';
import { renamedSource } from './extract.ts';
import { baseSubject, emailLessonKey, originSender, sameMatter } from './email.ts';
import { requiredMarkers } from './markers.ts';
import { windowKeyFor } from './window.ts';
import type { Criteria, Marker } from './markers.ts';

/** A place a step was done, as you told Didja. */
export interface DonePlace { id: number; taskId: number | null; source: number | null; word: string | null; site: string; createdAt: string }

/** A canvas (SCR-49), as listed: how many of its tasks are still open. */
export interface Canvas { id: number; title: string; updatedAt: string; open: number }
export const MAX_CANVAS_LEVEL = 4;

/**
 * The task items under a heading on a canvas (SCR-59): those after it, up to the next heading.
 * Notes between them are passed over.
 */
export function canvasSection(items: CanvasItem[], headingId: number): CanvasItem[] {
  const at = items.findIndex((i) => i.id === headingId && i.kind === 'heading');
  if (at < 0) return [];
  const out: CanvasItem[] = [];
  for (const item of items.slice(at + 1)) {
    if (item.kind === 'heading') break;
    if (item.kind === 'task' && item.task) out.push(item);
  }
  return out;
}
const clampLevel = (n: number) => Math.max(0, Math.min(MAX_CANVAS_LEVEL, Math.trunc(Number.isFinite(n) ? n : 0)));
export interface CanvasItem {
  id: number;
  kind: 'task' | 'note' | 'heading';
  /** How far it is indented, 0 to 4. */
  level: number;
  /** The task's title, or the note's or heading's text. */
  text: string;
  task?: { id: number; status: TaskStatus; suggestion: string | null; source: string };
  /** On a heading (SCR-59): the tasks under it (not dismissed), and how many are still open or snoozed. */
  section?: { tasks: number; open: number };
}

/** My List (SCR-46): tasks you keep, added by hand or by Siri; never ticked or cleared for you. */
export const KEPT_KIND = 'kept';
export const KEPT_LIST = 'My List';

export const DEFAULT_DB_PATH = join(
  homedir(),
  'Library/Application Support/Didja/didja.db',
);

/**
 * The app was called ScrolledAway until 2026-11-11. Its data moves to the new name the first time
 * either the app or the engine starts: the folder, and the database with SQLite's side files.
 * Nothing is overwritten: if the new place already has a database, the old one is left alone.
 */
export function moveFromOldName(home: string = homedir()): void {
  const oldDir = join(home, 'Library/Application Support/ScrolledAway');
  const newDir = join(home, 'Library/Application Support/Didja');
  try {
    if (existsSync(oldDir) && !existsSync(newDir)) renameSync(oldDir, newDir);
    if (!existsSync(join(newDir, 'didja.db'))) {
      for (const ext of ['', '-wal', '-shm']) {
        const from = join(newDir, `scrolledaway.db${ext}`);
        if (existsSync(from)) renameSync(from, join(newDir, `didja.db${ext}`));
      }
    }
  } catch {
    // Left where it was: the app shows an empty list rather than failing to start.
  }
}
/** Observations older than this are deleted. */
export const OBSERVATION_TTL_MS = 24 * 60 * 60 * 1000;

export type TaskStatus = 'open' | 'done' | 'dismissed' | 'snoozed';

/** New text seen in one window, written by the capture layer. */
export interface Observation {
  id: number;
  ts: string;
  bundleId: string;
  app: string;
  windowTitle: string;
  url: string | null;
  source: 'ax' | 'ocr';
  text: string;
  /** The window it was seen in, as capture keys it (`windowKeyFor`); absent on rows from before schema 24. */
  windowKey?: string;
}

/**
 * What happened to a step (SCR-73), recorded in `outcomes` for "How Didja is doing". `ticked-*` are
 * ticks Didja made for you; the rest are your answers and actions.
 */
export const TICKS = ['ticked-command', 'ticked-link', 'ticked-setting', 'ticked-file', 'ticked-screen', 'ticked-reply', 'ticked-tool', 'ticked-accepted', 'ticked-sure'] as const;
export type Outcome =
  | (typeof TICKS)[number]
  | 'asked' | 'yes' | 'not-yet' | 'done-by-hand' | 'shown-done'
  | 'dismissed' | 'not-an-action' | 'fresh-start' | 'reopened-after-tick';

/**
 * The confidence of a list shown while the model decides whose it is: "checking…" (SCR-78). Below
 * "maybe" (0.2, no model) and every list judged or clear (0.3 and up); not counted, never nudged.
 */
export const CHECKING_CONFIDENCE = 0.1;

/** Yes answers since the last no that make a place trusted for ticking without asking (SCR-74). */
export const TRUST_YES = 5;
/** Only answers this recent count. */
export const TRUST_DAYS = 30;

/** The site or app of a place as "looks done?" names it ("Google Chrome — vercel.com/acme" → vercel.com). */
export function siteOfPlace(place: string): string {
  const [app, ...rest] = place.split(' — ');
  const where = rest.join(' — ').trim();
  const host = where.split('/')[0]!.toLowerCase().replace(/^www\./, '');
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return host;
  return (app ?? place).trim().toLowerCase();
}

/** The trust key for a task and a place (SCR-74): site or app · source kind · first verb. */
export function trustKey(place: string, sourceKind: string, title: string): string {
  const verb = title.match(/[\p{L}][\p{L}'-]*/u)?.[0]?.toLowerCase() ?? '';
  return `${siteOfPlace(place)} · ${sourceKind} · ${verb}`;
}

/** What a timed event is measured against (SCR-75): ≤3 s, ≤10 s, or a chat ask's wait for your reply. */
export type TimingPath = 'fast' | 'model' | 'wait';
export type TimingEvent = 'task' | 'tick' | 'asked';
/** Ticks that need no model: something exact was seen (a command, a link, a setting, a file, your reply). */
const SURE_TICKS: readonly Outcome[] = ['ticked-command', 'ticked-link', 'ticked-setting', 'ticked-file', 'ticked-reply', 'ticked-tool'];

export interface Timing {
  taskId: number;
  event: TimingEvent;
  path: TimingPath;
  kind: string;
  seenAt: string | null;
  engineAt: string;
  shownAt: string;
}

export interface Task {
  id: number;
  title: string;
  sourceId: number;
  sourceKind: string;
  sourceRef: string;
  /** Where the markers must be seen for the task to count as done. */
  criteria: Criteria | null;
  markers: Marker[];
  status: TaskStatus;
  confidence: number;
  position: number | null;
  createdAt: string;
  lastSeenAt: string;
  /** The checklist this step belongs to, if any. */
  parentId: number | null;
  /** True for a parent: the checklist as a whole, not a step. */
  isGroup: boolean;
  doneAt: string | null;
  /** When a snoozed task comes back. */
  snoozedUntil: string | null;
  /** The title as captured from the screen; `title` is your own name for it when you renamed it. */
  capturedTitle: string;
  renamed: boolean;
  /** True when the title shown was written by the on-device model. */
  modelTitled: boolean;
  /** Set while the task looks done and waits for you to confirm: where that was seen. */
  /** Where it looked done, when it was ticked for you because of that. */
  acceptedFrom: string | null;
  suggestion: string | null;
  suggestedAt: string | null;
  /** A parent whose children are folded away. */
  collapsed: boolean;
  /** True when the engine can tick this by itself. */
  auto: boolean;
  /** Why it was made (SCR-96), written by the engine at capture; null on tasks from before. */
  capturedWhy?: string | null;
}

/** A task with everything nested under it. */
export interface TaskNode {
  task: Task;
  children: TaskNode[];
}

/** A step to store, possibly with sub-steps of its own. */
export interface NewNode {
  title: string;
  position: number | null;
  markers?: Marker[];
  criteria?: Criteria | null;
  children?: NewNode[];
}

/** A checklist: a parent task and its steps. `parent` is null for loose tasks. */
export interface TaskGroup {
  sourceId: number;
  sourceKind: string;
  sourceRef: string;
  parent: Task | null;
  tasks: Task[];
}

export interface NewChecklist {
  /** What the checklist is for: the line that introduced it. */
  title: string;
  sourceKind: string;
  sourceRef: string;
  confidence: number;
  ts: string;
  observationId: number | null;
  items: NewNode[];
  /** False to store the items as they are, without a parent named after the list. */
  wrap?: boolean;
  /** Why it was made (SCR-96); a command step adds that it is one. */
  why?: string;
}

export interface NewTask {
  title: string;
  sourceKind: string;
  sourceRef: string;
  confidence: number;
  position: number | null;
  /** When it was seen (ISO, UTC). */
  ts: string;
  /** The observation it was found in. */
  observationId: number | null;
  markers?: Marker[];
  criteria?: Criteria | null;
  /**
   * For a task tied to one message or item (a chat message, an email, a connected tool's item):
   * its identity. Such a task is never merged with another by wording, from its own source or any
   * other; two people asking you to "confirm you got it" are two tasks.
   */
  distinct?: string;
  /** Why it was made (SCR-96). Without one, a line from its kind of source. */
  why?: string;
}

/** How a task looked where it was captured (SCR-31). */
export interface TaskContext {
  app: string;
  window: string;
  url: string | null;
  lines: ContextLine[];
  capturedAt: string;
}

/** A chat ask waiting to become a task (SCR-45): the model's wording, never the message. */
export interface PendingChatAsk {
  key: string;
  app: string;
  chat: string;
  from: string;
  title: string;
  /** When the message was sent (ISO). */
  at: string;
  observationId: number | null;
  ts: string;
  /** Why it is an ask of yours (SCR-96). */
  why?: string;
}

/** How eagerly asks become tasks (SCR-95). Ticking is the same at every level. */
export type CaptureLevel = 'strict' | 'balanced' | 'everything';
export const CAPTURE_LEVELS: CaptureLevel[] = ['strict', 'balanced', 'everything'];

/** A borderline ask kept in the Suggested tray (SCR-95): not a task until you accept it. */
export interface Suggestion {
  id: number;
  kind: 'chat';
  sourceRef: string;
  title: string;
  createdAt: string;
}

/** Suggestions leave without a trace after this long. */
export const SUGGESTION_TTL_MS = 24 * 60 * 60_000;

export interface Evidence {
  taskId: number;
  observationId: number | null;
  ts: string;
  kind: 'captured' | 'marker' | 'judged' | 'suggested' | 'rejected' | 'origin' | 'confirmed';
  marker: string | null;
  detail: string | null;
}

/** Lowercased letters and digits only, so spacing and punctuation don't matter. */
/** The on-device model's jobs that can be taught. */
/** An open task elsewhere is the same task for this long after it was last seen (SCR-71). */
/** A task's key without the source it was kept apart by (SCR-71). */
const plainKey = (key: string) => key.replace(/\u0000source .*$/s, '');

const SAME_TASK_OPEN_MS = 3 * 24 * 3600_000;
/** Any task elsewhere, done or not, is the same task this soon (a conversation renamed while you work). */
const SAME_TASK_ANY_MS = 3600_000;

export const JOBS = ['lists', 'titles', 'emails', 'chats', 'looks-done'] as const;
export type Job = (typeof JOBS)[number];
/** What the model is told for one job, besides its built-in instructions. */
export interface Teaching {
  /** Your instructions, replacing the built-in ones; null for the built-in ones. */
  instructions: string | null;
  /** Your corrections, as sentences, oldest first. */
  examples: string[];
}
export interface Lesson {
  id: number;
  job: Job;
  kind: 'not-an-action' | 'not-done' | 'renamed';
  key: string;
  example: string;
  createdAt: string;
}
/** The model reads instructions and examples on every question: keep both short. */
const MAX_INSTRUCTIONS = 4000;
const MAX_EXAMPLES = 12;

/**
 * A task's wording, for telling the same task seen again: the letters and digits of any script,
 * lowercased, accents and points dropped (SCR-62). A title with none of them gives "", which never
 * matches anything: not another task, not a lesson.
 */
export function dedupeKey(title: string): string {
  return title.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Dice coefficient over character bigrams, 0..1. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let overlap = 0;
  for (const [g, n] of ga) overlap += Math.min(n, gb.get(g) ?? 0);
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

/** Same task seen again: OCR noise, or a line caught mid-stream or cut off. */
function isSameTask(a: string, b: string): boolean {
  if (a.replace(/\u0000.*$/s, '') === '' || b.replace(/\u0000.*$/s, '') === '') return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 12 && long.startsWith(short)) return true;
  return similarity(a, b) >= 0.9;
}

interface ObservationRow {
  id: number;
  ts: string;
  bundle_id: string;
  app: string;
  window_title: string;
  url: string | null;
  source: 'ax' | 'ocr';
  text: string;
  window_key: string;
}

interface TaskRow {
  id: number;
  title: string;
  source: number;
  source_kind: string;
  source_ref: string;
  criteria: string | null;
  markers: string;
  status: TaskStatus;
  confidence: number;
  position: number | null;
  created_at: string;
  last_seen_at: string;
  parent_id: number | null;
  is_group: number;
  done_at: string | null;
  snoozed_until: string | null;
  captured_title: string;
  custom_title: string | null;
  model_title: string | null;
  accepted_from: string | null;
  suggestion: string | null;
  suggested_at: string | null;
  collapsed: number;
  auto: number;
  captured_why: string | null;
}

const SELECT_TASK = `
  SELECT t.id, COALESCE(t.custom_title, NULLIF(t.model_title, ''), t.title) AS title, t.title AS captured_title,
         t.custom_title, t.model_title, t.suggestion, t.suggested_at, t.accepted_from,
         t.collapsed, t.auto, t.source, s.kind AS source_kind, s.ref AS source_ref, t.criteria,
         t.markers, t.status, t.confidence, t.position, t.created_at, t.last_seen_at,
         t.parent_id, t.is_group, t.done_at, t.snoozed_until, t.captured_why
  FROM tasks t JOIN sources s ON s.id = t.source`;

function toObservation(r: ObservationRow): Observation {
  return {
    id: r.id,
    ts: r.ts,
    bundleId: r.bundle_id,
    app: r.app,
    windowTitle: r.window_title,
    url: r.url,
    source: r.source,
    text: r.text,
    ...(r.window_key ? { windowKey: r.window_key } : {}),
  };
}

function toTask(r: TaskRow): Task {
  return {
    id: r.id,
    title: r.title,
    sourceId: r.source,
    sourceKind: r.source_kind,
    sourceRef: r.source_ref,
    criteria: r.criteria ? (JSON.parse(r.criteria) as Criteria) : null,
    markers: JSON.parse(r.markers) as Marker[],
    status: r.status,
    confidence: r.confidence,
    position: r.position,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    parentId: r.parent_id,
    isGroup: r.is_group === 1,
    doneAt: r.done_at,
    snoozedUntil: r.snoozed_until,
    capturedTitle: r.captured_title,
    renamed: r.custom_title !== null,
    modelTitled: r.custom_title === null && !!r.model_title,
    suggestion: r.suggestion,
    acceptedFrom: r.accepted_from,
    suggestedAt: r.suggested_at,
    collapsed: r.collapsed === 1,
    auto: r.auto === 1,
    capturedWhy: r.captured_why,
  };
}

export interface Place {
  bundleId: string;
  app: string;
  window: string;
  url: string | null;
  /** Phrases to find on screen, best first. */
  look: string[];
}

export class Store {
  private db: Database;
  /**
   * The engine pass running now, if any (SCR-75): set by `pollOnce` so that what it writes is timed.
   * `at` is the pass's time, `started` the clock when it began, `seen` the newest observation it
   * read (when a tick has no observation of its own), `path` the target a new task is measured by.
   */
  pass: { at: Date; started: number; seen: string | null; path: TimingPath } | null = null;
  /** Measures time spent inside a pass; the benchmark swaps in a fake clock that charges model calls. */
  clock: () => number = () => Date.now();

  constructor(path: string = process.env.DIDJA_DB ?? DEFAULT_DB_PATH) {
    if (path === DEFAULT_DB_PATH) moveFromOldName();
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    // The app migrates the same file. Take the write lock first so only one side runs each step.
    this.db.transaction(() => {
      const { user_version } = this.db.query('PRAGMA user_version').get() as { user_version: number };
      [schema1, schema2, schema3, schema4, schema5, schema6, schema7, schema8, schema9, schema10, schema11, schema12, schema13, schema14, schema15, schema16, schema17, schema18, schema19, schema20, schema21, schema22, schema23, schema24, schema25, schema26, schema27, schema28, schema29, schema30].forEach((sql, i) => {
        if (user_version < i + 1) this.db.exec(sql);
      });
    }).immediate();
    this.backfillAuto();
    this.renameSources();
  }

  /**
   * Sources named before Claude Code and claude.ai were named after the product
   * (SCR-17). Where the new name is already taken, the tasks move to that source.
   */
  private renameSources(): void {
    if (this.getMeta('sources_named') === '2') return;
    this.db.transaction(() => {
      const rows = this.db.query('SELECT id, kind, ref FROM sources').all() as { id: number; kind: string; ref: string }[];
      for (const row of rows) {
        const ref = renamedSource(row.kind, row.ref);
        if (ref === null) continue;
        const taken = this.db.query('SELECT id FROM sources WHERE kind = ? AND ref = ?').get(row.kind, ref) as { id: number } | null;
        if (taken) {
          this.db.query('UPDATE tasks SET source = ? WHERE source = ?').run(taken.id, row.id);
          this.db.query('DELETE FROM sources WHERE id = ?').run(row.id);
        } else {
          this.db.query('UPDATE sources SET ref = ? WHERE id = ?').run(ref, row.id);
        }
      }
      this.setMeta('sources_named', '2');
    }).immediate();
  }

  /** Tasks captured before the `auto` flag existed: work it out from their markers. */
  private backfillAuto(): void {
    const rows = this.db
      .query("SELECT id, markers, criteria FROM tasks WHERE auto = 0 AND is_group = 0 AND markers != '[]'")
      .all() as { id: number; markers: string; criteria: string | null }[];
    for (const row of rows) {
      const criteria = row.criteria ? (JSON.parse(row.criteria) as Criteria) : null;
      if (requiredMarkers(JSON.parse(row.markers) as Marker[], criteria).length > 0) {
        this.db.query('UPDATE tasks SET auto = 1 WHERE id = ?').run(row.id);
      }
    }
  }

  close(): void {
    this.db.close();
  }

  // --- observations (written by the capture layer; the engine only reads and expires them)

  /** For tests and tooling. In production the Swift capture layer does the writing. */
  insertObservation(o: Omit<Observation, 'id'>): number {
    const key = o.windowKey ?? windowKeyFor(o.bundleId, o.windowTitle, o.url);
    const info = this.db
      .query(
        `INSERT INTO observations (ts, bundle_id, app, window_title, url, source, text, window_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(o.ts, o.bundleId, o.app, o.windowTitle, o.url, o.source, o.text, key);
    return Number(info.lastInsertRowid);
  }

  observationsAfter(id: number, limit = 500): Observation[] {
    const rows = this.db
      .query('SELECT * FROM observations WHERE id > ? ORDER BY id LIMIT ?')
      .all(id, limit) as ObservationRow[];
    return rows.map(toObservation);
  }

  latestObservations(limit: number): Observation[] {
    const rows = this.db
      .query('SELECT * FROM observations ORDER BY id DESC LIMIT ?')
      .all(limit) as ObservationRow[];
    return rows.map(toObservation).reverse();
  }

  /**
   * Everything recently seen in the window `o` was seen in, oldest first: by its window key
   * (SCR-72), or by app and exact title for a row from before schema 24.
   */
  windowObservations(o: Pick<Observation, 'bundleId' | 'windowTitle' | 'windowKey'>, sinceIso: string): Observation[] {
    const rows = (
      o.windowKey
        ? this.db
            .query('SELECT * FROM observations WHERE window_key = ? AND ts >= ? ORDER BY id')
            .all(o.windowKey, sinceIso)
        : this.db
            .query(
              `SELECT * FROM observations
               WHERE bundle_id = ? AND window_title = ? AND window_key = '' AND ts >= ? ORDER BY id`,
            )
            .all(o.bundleId, o.windowTitle, sinceIso)
    ) as ObservationRow[];
    return rows.map(toObservation);
  }

  /** Enforce the 24h TTL. The app does this too; either side running is enough. */
  /**
   * How long observations are kept: 24 hours, or less if you chose so in the
   * app (it writes `retention_hours`). Never more, whatever is written there.
   */
  retentionMs(): number {
    const hours = Number(this.getMeta('retention_hours'));
    return Number.isFinite(hours) && hours > 0 ? Math.min(hours * 3600_000, OBSERVATION_TTL_MS) : OBSERVATION_TTL_MS;
  }

  pruneObservations(now: Date = new Date()): number {
    const cutoff = new Date(now.getTime() - this.retentionMs()).toISOString();
    return this.db.query('DELETE FROM observations WHERE ts < ?').run(cutoff).changes;
  }

  // --- tasks

  private sourceId(kind: string, ref: string): number {
    this.db.query('INSERT OR IGNORE INTO sources (kind, ref) VALUES (?, ?)').run(kind, ref);
    const row = this.db
      .query('SELECT id FROM sources WHERE kind = ? AND ref = ?')
      .get(kind, ref) as { id: number };
    return row.id;
  }

  /**
   * Keep where a task was first captured (app, window, page address) on the task, for
   * "Go to Source": observations expire, tasks do not. Never the screen text.
   */
  private notePlace(taskId: number, observationId: number | null): void {
    if (observationId === null) return;
    this.db
      .query(
        `UPDATE tasks SET place_bundle_id = o.bundle_id, place_app = o.app, place_window = o.window_title, place_url = o.url
         FROM (SELECT bundle_id, app, window_title, url FROM observations WHERE id = ?) AS o
         WHERE tasks.id = ? AND tasks.place_bundle_id IS NULL`,
      )
      .run(observationId, taskId);
  }

  /**
   * Keep the lines around a new task, as they were where it was captured (SCR-31). Nothing is
   * kept when its words are not found in that observation. Deleted when the task is finished.
   */
  private noteContext(taskId: number, observationId: number | null, title: string): void {
    if (observationId === null) return;
    const o = this.db
      .query('SELECT ts, bundle_id, app, window_title, url, text FROM observations WHERE id = ?')
      .get(observationId) as { ts: string; bundle_id: string; app: string; window_title: string; url: string | null; text: string } | null;
    if (!o) return;
    const lines = contextLines(o.text, title);
    if (!lines) return;
    this.db
      .query(
        `INSERT OR IGNORE INTO task_context (task_id, bundle_id, app, window_title, url, lines, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(taskId, o.bundle_id, o.app, o.window_title, o.url, JSON.stringify(lines), o.ts);
  }

  /** How a task looked where it was captured, or null. A checklist shows its first step's. */
  context(id: number): TaskContext | null {
    const row = this.db
      .query(
        `SELECT c.app, c.window_title AS window, c.url, c.lines, c.captured_at AS capturedAt
         FROM task_context c JOIN tasks t ON t.id = c.task_id
         WHERE t.id = ? OR t.parent_id = ?
         ORDER BY t.id = ? DESC, t.position IS NULL, t.position, t.id LIMIT 1`,
      )
      .get(id, id, id) as { app: string; window: string; url: string | null; lines: string; capturedAt: string } | null;
    return row ? { ...row, lines: JSON.parse(row.lines) as ContextLine[] } : null;
  }

  /** Forget the lines kept for finished tasks: they are kept only while a task is open. */
  pruneContext(): number {
    // What done looks like (SCR-67) goes with the kept lines: it was written from them.
    this.db.query(`UPDATE tasks SET criteria_model = NULL WHERE criteria_model IS NOT NULL AND status IN ('done', 'dismissed')`).run();
    return this.db
      .query(`DELETE FROM task_context WHERE task_id IN (SELECT id FROM tasks WHERE status IN ('done', 'dismissed'))`)
      .run().changes;
  }

  /** What done looks like for a task, as the model wrote it (SCR-67); null if not asked or nothing to look for. */
  modelCriteria(id: number): DoneCriteria | null {
    const row = this.db.query('SELECT criteria_model AS c FROM tasks WHERE id = ?').get(id) as { c: string | null } | null;
    return row?.c ? parseCriteria(row.c) : null;
  }

  /** Keep what done looks like for a task; null keeps that it was asked and had nothing. */
  setModelCriteria(id: number, criteria: DoneCriteria | null): void {
    this.db.query('UPDATE tasks SET criteria_model = ? WHERE id = ?').run(JSON.stringify(criteria ?? {}), id);
  }

  /** Open steps with nothing exact to look for that the model has not yet been asked about, newest first. */
  tasksAwaitingCriteria(limit: number): Task[] {
    const rows = this.db
      .query(`${SELECT_TASK} WHERE t.is_group = 0 AND t.status = 'open' AND t.auto = 0 AND t.criteria_model IS NULL ORDER BY t.id DESC LIMIT ?`)
      .all(limit * 4) as TaskRow[];
    return rows.map(toTask).filter((t) => !t.criteria?.reply && !t.criteria?.chat && t.sourceKind !== KEPT_KIND).slice(0, limit);
  }

  /** Where a task was captured, for "Go to Source". A checklist without one uses its first step's. */
  place(id: number): Place | null {
    const row = this.db
      .query(
        `SELECT place_bundle_id AS bundleId, place_app AS app, place_window AS window, place_url AS url FROM tasks
         WHERE place_bundle_id IS NOT NULL AND (id = ? OR parent_id = ?)
         ORDER BY id = ? DESC, position IS NULL, position, id LIMIT 1`,
      )
      .get(id, id, id) as Omit<Place, 'look'> | null;
    if (!row) return null;
    // What to look for on screen: the task's own words as captured, and for an email
    // its subject (what the message list shows), kept in the "origin" note.
    const task = this.getTask(id);
    const look: string[] = [];
    const origin = this.listEvidence(id).filter((e) => e.kind === 'origin').at(-1)?.detail ?? '';
    const subject = /“(.+)”$/.exec(origin)?.[1];
    if (subject) look.push(subject);
    if (task) look.push(task.capturedTitle);
    if (task?.isGroup) {
      const first = this.stepsUnder(id).find((t) => !t.isGroup);
      if (first) look.push(first.capturedTitle);
    }
    return { ...row, look };
  }

  /**
   * Insert a task unless we already have it. Tasks in any status count, so a
   * dismissed or completed task does not come back while it is still on screen.
   */
  upsertTask(input: NewTask): { id: number; created: boolean; parentId: number | null } {
    const base = dedupeKey(input.title);
    // A title with no letters or digits is known only by its exact wording (SCR-62), never by "".
    const key = input.distinct ? `${base}\u0000${input.distinct}` : base === '' ? `\u0000${input.title.trim()}` : base;
    const markers = JSON.stringify(input.markers ?? []);
    const criteria = input.criteria ? JSON.stringify(input.criteria) : null;
    const auto = requiredMarkers(input.markers ?? [], input.criteria ?? null).length > 0 ? 1 : 0;
    return this.db.transaction(() => {
      const all = this.db
        .query(`SELECT t.id, t.dedupe_key, t.markers, t.parent_id, t.status, t.last_seen_at, s.kind AS skind, s.ref AS sref
                FROM tasks t JOIN sources s ON s.id = t.source WHERE t.is_group = 0`)
        .all() as { id: number; dedupe_key: string; markers: string; parent_id: number | null; status: string; last_seen_at: string; skind: string; sref: string }[];
      // The same task is one from the same source, or one still open seen in the last 3 days, or
      // any seen in the last hour (a conversation renamed under you). A recurring step in another
      // conversation later is a new task, not an old done one (SCR-71). An explicit `distinct`
      // key is matched exactly, as before.
      const at = Date.parse(input.ts);
      const candidates = input.distinct ? all : all.filter((c) => {
        if (c.sref === input.sourceRef && c.skind === input.sourceKind) return true;
        const ago = at - Date.parse(c.last_seen_at);
        return ago <= SAME_TASK_ANY_MS || ((c.status === 'open' || c.status === 'snoozed') && ago <= SAME_TASK_OPEN_MS);
      });
      // Keys are unique: the same words in another conversation get a key of their own, kept per source.
      const scoped = `${key}\u0000source ${input.sourceKind} ${input.sourceRef}`;
      const existing =
        candidates.find((c) => c.dedupe_key === key || (!input.distinct && c.dedupe_key === scoped)) ??
        (input.distinct ? undefined : candidates.find((c) => !c.dedupe_key.includes('\u0000') && isSameTask(c.dedupe_key, key)));

      if (existing) {
        // Keep the fuller title if the earlier sighting was cut off or still streaming.
        const fuller =
          key.length > existing.dedupe_key.length && key.startsWith(existing.dedupe_key);
        const taken = fuller && candidates.some((c) => c.id !== existing.id && c.dedupe_key === key);
        if (fuller && !taken) {
          this.db
            .query(
              `UPDATE tasks SET title = ?, dedupe_key = ?, markers = ?, criteria = ?, auto = ?,
                 last_seen_at = MAX(last_seen_at, ?) WHERE id = ?`,
            )
            .run(input.title, key, markers, criteria, auto, input.ts, existing.id);
        } else if (existing.markers === '[]' && markers !== '[]') {
          // First seen before its code or links had rendered: fill the markers in.
          this.db
            .query('UPDATE tasks SET markers = ?, criteria = ?, auto = ?, last_seen_at = MAX(last_seen_at, ?) WHERE id = ?')
            .run(markers, criteria, auto, input.ts, existing.id);
        } else {
          this.db
            .query('UPDATE tasks SET last_seen_at = MAX(last_seen_at, ?) WHERE id = ?')
            .run(input.ts, existing.id);
        }
        return { id: existing.id, created: false, parentId: existing.parent_id };
      }

      const source = this.sourceId(input.sourceKind, input.sourceRef);
      const info = this.db
        .query(
          `INSERT INTO tasks (title, source, confidence, dedupe_key, position, markers, criteria, auto, created_at, last_seen_at, captured_why)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(input.title, source, input.confidence, all.some((c) => c.dedupe_key === key) ? scoped : key, input.position, markers, criteria, auto, input.ts, input.ts,
          input.why ?? defaultWhy(input.sourceKind, input.sourceRef));
      const id = Number(info.lastInsertRowid);
      this.db
        .query('INSERT INTO evidence (task_id, observation_id, ts) VALUES (?, ?, ?)')
        .run(id, input.observationId, input.ts);
      this.recordTiming(id, 'task', this.pass?.path ?? 'fast', input.ts);
      this.notePlace(id, input.observationId);
      this.noteContext(id, input.observationId, input.title);
      return { id, created: true, parentId: null };
    })();
  }

  /**
   * Store a checklist as a tree: its steps under one parent named after the
   * list, and each step's own sub-steps under it, to any depth.
   *
   * Steps we already have keep their place, so a list seen again (or still
   * streaming) lands where it did before; only steps without a parent are
   * gathered under a new one. A step first seen on its own that later gains
   * sub-steps becomes their parent.
   */
  /**
   * A list kept as "maybe" (confidence at or below `maybe`) that is now known to be yours: it and
   * everything under it take `confidence` (SCR-70). Lists that were never "maybe" are left as they are.
   */
  unmarkMaybe(rootId: number, confidence: number, maybe: number): void {
    this.db
      .query(
        `WITH RECURSIVE tree(id) AS (SELECT ?1 UNION ALL SELECT t.id FROM tasks t JOIN tree ON t.parent_id = tree.id)
         UPDATE tasks SET confidence = ?2 WHERE id IN (SELECT id FROM tree) AND confidence <= ?3`,
      )
      .run(rootId, confidence, maybe);
  }

  /**
   * A list's reason changed (SCR-96): the model judged it, or you ticked a step while it was being
   * checked. Every task under `rootId` takes the new reason; a command step keeps saying it is one.
   */
  setListWhy(rootId: number, why: string): void {
    this.db
      .query(
        `WITH RECURSIVE tree(id) AS (SELECT ?1 UNION ALL SELECT t.id FROM tasks t JOIN tree ON t.parent_id = tree.id)
         UPDATE tasks SET captured_why = ?2 || CASE WHEN markers LIKE '%"kind":"command"%' THEN ?3 ELSE '' END
         WHERE id IN (SELECT id FROM tree)`,
      )
      .run(rootId, why, WHY.commandStep);
  }

  upsertChecklist(list: NewChecklist): { rootId: number | null; created: number } {
    return this.db.transaction(() => {
      let created = 0;
      const newGroup = (title: string, position: number | null): number => {
        const source = this.sourceId(list.sourceKind, list.sourceRef);
        const info = this.db
          .query(
            `INSERT INTO tasks (title, source, confidence, dedupe_key, position, is_group, created_at, last_seen_at, captured_why)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
          )
          .run(title, source, list.confidence, `group ${crypto.randomUUID()}`, position, list.ts, list.ts,
            list.why ?? defaultWhy(list.sourceKind, list.sourceRef));
        const id = Number(info.lastInsertRowid);
        this.notePlace(id, list.observationId);
        return id;
      };
      /** Put the children that have no parent yet under `group`, creating it with `make` if they share none. */
      const gather = (kids: { id: number; parentId: number | null }[], make: () => number): number => {
        const group = kids.find((k) => k.parentId !== null)?.parentId ?? make();
        for (const kid of kids) {
          if (kid.parentId === null) this.db.query('UPDATE tasks SET parent_id = ? WHERE id = ?').run(group, kid.id);
        }
        this.syncParent(group, list.ts);
        return group;
      };
      const store = (node: NewNode): { id: number; parentId: number | null } => {
        if (!node.children?.length) {
          const leaf = this.upsertTask({
            title: node.title, position: node.position, markers: node.markers, criteria: node.criteria,
            sourceKind: list.sourceKind, sourceRef: list.sourceRef, confidence: list.confidence,
            ts: list.ts, observationId: list.observationId,
            why: (list.why ?? defaultWhy(list.sourceKind, list.sourceRef)) + (node.markers?.some((m) => m.kind === 'command') ? WHY.commandStep : ''),
          });
          if (leaf.created) created++;
          return { id: leaf.id, parentId: leaf.parentId };
        }
        const kids = node.children.map(store);
        const id = gather(kids, () => {
          // Known until now as a plain step? Then it is that step which has grown sub-steps.
          const known = this.findTaskByTitle(node.title);
          if (known && !known.isGroup) {
            this.db.query("UPDATE tasks SET is_group = 1, markers = '[]', criteria = NULL, auto = 0 WHERE id = ?").run(known.id);
            return known.id;
          }
          return newGroup(node.title, node.position);
        });
        const row = this.db.query('SELECT parent_id FROM tasks WHERE id = ?').get(id) as { parent_id: number | null };
        return { id, parentId: row.parent_id };
      };

      const tops = list.items.map(store);
      if (list.wrap === false) return { rootId: tops[0]?.id ?? null, created };
      return { rootId: gather(tops, () => newGroup(list.title, null)), created };
    })();
  }

  /** Individual tasks (steps and loose tasks), without the parents that group them. */
  listTasks(opts: { all?: boolean } = {}): Task[] {
    const where = opts.all ? 'WHERE t.is_group = 0' : "WHERE t.is_group = 0 AND t.status = 'open'";
    const rows = this.db
      .query(`${SELECT_TASK} ${where} ORDER BY s.id, t.created_at, t.position, t.id`)
      .all() as TaskRow[];
    return rows.map(toTask);
  }

  getTask(id: number): Task | null {
    const row = this.db.query(`${SELECT_TASK} WHERE t.id = ?`).get(id) as TaskRow | null;
    return row ? toTask(row) : null;
  }

/**
   * Every task as a tree. Without `all`: top-level items that are still open,
   * with everything under them that was not dismissed (so progress shows).
   */
  listTree(opts: { all?: boolean } = {}): TaskNode[] {
    const tasks = (this.db
      .query(`${SELECT_TASK} ORDER BY s.id, t.position IS NULL, t.position, t.id`)
      .all() as TaskRow[]).map(toTask);
    const nodes = new Map(tasks.map((task) => [task.id, { task, children: [] } as TaskNode]));
    const roots: TaskNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.task.parentId !== null ? nodes.get(node.task.parentId) : undefined;
      if (parent) {
        if (opts.all || node.task.status !== 'dismissed') parent.children.push(node);
      } else if (opts.all || node.task.status === 'open') {
        roots.push(node);
      }
    }
    // Top level: by source, then in the order they were captured.
    return roots.sort((a, b) => a.task.sourceId - b.task.sourceId || a.task.id - b.task.id);
  }

  /** Top-level checklists with their direct steps, and loose tasks gathered per source. */
  listGroups(opts: { all?: boolean } = {}): TaskGroup[] {
    const groups: TaskGroup[] = [];
    const loose = new Map<number, TaskGroup>();
    for (const root of this.listTree(opts)) {
      const { sourceId, sourceKind, sourceRef } = root.task;
      if (root.task.isGroup) {
        groups.push({ sourceId, sourceKind, sourceRef, parent: root.task, tasks: root.children.map((c) => c.task) });
        continue;
      }
      let group = loose.get(sourceId);
      if (!group) {
        group = { sourceId, sourceKind, sourceRef, parent: null, tasks: [] };
        loose.set(sourceId, group);
        groups.push(group);
      }
      group.tasks.push(root.task);
    }
    return groups;
  }

  /** A task and everything under it, deepest first. */
  private subtree(id: number): { id: number; parent_id: number | null; is_group: number; status: TaskStatus }[] {
    return this.db
      .query(
        `WITH RECURSIVE sub(id, parent_id, is_group, status, depth) AS (
           SELECT id, parent_id, is_group, status, 0 FROM tasks WHERE id = ?
           UNION ALL
           SELECT t.id, t.parent_id, t.is_group, t.status, sub.depth + 1 FROM tasks t JOIN sub ON t.parent_id = sub.id
         )
         SELECT id, parent_id, is_group, status FROM sub ORDER BY depth DESC, id`,
      )
      .all(id) as { id: number; parent_id: number | null; is_group: number; status: TaskStatus }[];
  }

  /**
   * Change a task's status and keep the tree consistent:
   *  - ticking, snoozing, dismissing or reopening a parent does the same to everything under it;
   *  - a parent is done once nothing under it is left open, and reopens when something does.
   * `until` says when a snoozed task comes back.
   */
  setStatus(id: number, status: TaskStatus, now: Date = new Date(), until: Date | null = null): boolean {
    const before = status === 'done' ? this.getTask(id) : null;
    // Reopening a step Didja ticked: that tick was wrong (SCR-73).
    const ticked = status === 'open'
      ? this.steps(id).filter((s) => s.status === 'done' && (TICKS as readonly string[]).includes(this.lastOutcome(s.id) ?? '')).map((s) => s.id)
      : [];
    // Where each was ticked from, read before reopening clears it (SCR-74).
    const tickedFrom = new Map(ticked.map((step) => [step, this.getTask(step)?.acceptedFrom ?? null]));
    const changed = this.setOwnStatus(id, status, now, until);
    for (const step of ticked) {
      const task = this.getTask(step);
      if (task?.status !== 'open') continue;
      this.recordOutcome(step, 'reopened-after-tick', now);
      // A tick from what a screen looked like, reopened: that place is not trusted any more (SCR-74).
      const place = tickedFrom.get(step);
      if (place) this.recordTrust(trustKey(place, task.sourceKind, task.capturedTitle), 'no', now);
    }
    // "Yes, done" on a "looks done?": a positive lesson, kept for trust earned later (SCR-71).
    if (changed && before?.suggestion && before.status !== 'done') this.recordConfirmed(id, before.suggestion, now);
    // Merged tasks are one thing: finishing, reopening or dismissing one does the same to the others.
    if (changed) {
      for (const other of this.mergedWith(id)) {
        if (this.getTask(other)?.status !== status) this.setOwnStatus(other, status, now, until);
      }
    }
    return changed;
  }

  /**
   * Run `change` and record `outcome` for each step whose status it changed (SCR-73): the task
   * itself, or the steps under it when it is a checklist.
   */
  withOutcome<T>(id: number, outcome: Outcome, now: Date, change: () => T): T {
    const before = new Map(this.steps(id).map((s) => [s.id, s.status]));
    const result = change();
    for (const [step, status] of before) {
      if (this.getTask(step)?.status !== status) this.recordOutcome(step, outcome, now);
    }
    return result;
  }

  /**
   * A change you made in the list (done, dismiss, reopen), counted for "How Didja is doing": a tick
   * on a "looks done?" is your yes, any other tick is done by hand.
   */
  changeByYou(id: number, status: 'done' | 'dismissed' | 'open', now: Date = new Date()): boolean {
    const change = () => this.setStatus(id, status, now);
    if (status === 'open') return change();
    const outcome: Outcome = status === 'dismissed' ? 'dismissed' : this.getTask(id)?.suggestion ? 'yes' : 'done-by-hand';
    return this.withOutcome(id, outcome, now, change);
  }

  /** One outcome for one step. Counts only: the row holds the task's id, the time and the outcome. */
  recordOutcome(taskId: number, outcome: Outcome, now: Date = new Date()): void {
    this.db.query('INSERT INTO outcomes (task_id, ts, outcome) VALUES (?, ?, ?)').run(taskId, now.toISOString(), outcome);
    // Ticks for you and "looks done?" are timed too (SCR-75): from the screen that showed it.
    if (outcome === 'asked' || (TICKS as readonly string[]).includes(outcome)) {
      const path: TimingPath = SURE_TICKS.includes(outcome) ? 'fast' : 'model';
      this.recordTiming(taskId, outcome === 'asked' ? 'asked' : 'tick', path, this.seenFor(taskId));
    }
  }

  /**
   * Time a task event written during an engine pass (SCR-75); outside one (your own changes, a
   * connected tool's sync) nothing is recorded. `shown_at` is the pass's time plus the time spent
   * in it so far, so the benchmark's fake clock and the live clock read the same way.
   */
  recordTiming(taskId: number, event: TimingEvent, path: TimingPath, seenAt: string | null): void {
    const pass = this.pass;
    if (!pass) return;
    const shown = new Date(pass.at.getTime() + Math.max(0, this.clock() - pass.started));
    this.db
      .query('INSERT INTO timings (task_id, event, path, seen_at, engine_at, shown_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(taskId, event, path, seenAt, pass.at.toISOString(), shown.toISOString());
  }

  /**
   * When the screen showed a tick's reason: the newest observation its evidence points to (the
   * last marker seen, the screen that looked done), else the newest observation this pass read.
   */
  private seenFor(taskId: number): string | null {
    const row = this.db
      .query(
        `SELECT MAX(o.ts) AS ts FROM evidence e JOIN observations o ON o.id = e.observation_id
         WHERE e.task_id = ? AND e.kind IN ('marker', 'judged', 'suggested')`,
      )
      .get(taskId) as { ts: string | null } | null;
    return row?.ts ?? this.pass?.seen ?? null;
  }

  /** The newest task's id, or 0 (SCR-76: what a pass's looks may consider). */
  maxTaskId(): number {
    return (this.db.query('SELECT COALESCE(MAX(id), 0) AS id FROM tasks').get() as { id: number }).id;
  }

  /** Timed events whose task or tick was written since a moment, with their source kind (SCR-75). */
  timingsSince(sinceIso: string): Timing[] {
    return this.db
      .query(
        `SELECT m.task_id AS taskId, m.event AS event, m.path AS path, COALESCE(s.kind, '') AS kind,
                m.seen_at AS seenAt, m.engine_at AS engineAt, m.shown_at AS shownAt
         FROM timings m LEFT JOIN tasks t ON t.id = m.task_id LEFT JOIN sources s ON s.id = t.source
         WHERE m.shown_at >= ? ORDER BY m.id`,
      )
      .all(sinceIso) as Timing[];
  }

  /** The step's newest outcome, if any. */
  lastOutcome(taskId: number): Outcome | null {
    const row = this.db.query('SELECT outcome FROM outcomes WHERE task_id = ? ORDER BY id DESC LIMIT 1').get(taskId) as { outcome: Outcome } | null;
    return row?.outcome ?? null;
  }

  /** The task itself, or every step under it when it is a checklist (not the checklists inside). */
  private steps(id: number): { id: number; status: TaskStatus }[] {
    return this.db
      .query(
        `WITH RECURSIVE tree(id) AS (SELECT ?1 UNION ALL SELECT t.id FROM tasks t JOIN tree ON t.parent_id = tree.id)
         SELECT id, status FROM tasks WHERE id IN (SELECT id FROM tree) AND is_group = 0`,
      )
      .all(id) as { id: number; status: TaskStatus }[];
  }

  /**
   * Counts for "How Didja is doing" (SCR-73) since a moment: steps made, and outcomes, per kind of
   * source. Numbers only.
   */
  qualityCounts(sinceIso: string): { made: { kind: string; n: number }[]; outcomes: { kind: string; outcome: Outcome; n: number }[] } {
    const made = this.db
      .query(
        `SELECT s.kind AS kind, COUNT(*) AS n FROM tasks t JOIN sources s ON s.id = t.source
         WHERE t.is_group = 0 AND t.created_at >= ? GROUP BY s.kind`,
      )
      .all(sinceIso) as { kind: string; n: number }[];
    const outcomes = this.db
      .query(
        `SELECT COALESCE(s.kind, '') AS kind, o.outcome AS outcome, COUNT(*) AS n
         FROM outcomes o LEFT JOIN tasks t ON t.id = o.task_id LEFT JOIN sources s ON s.id = t.source
         WHERE o.ts >= ? GROUP BY 1, 2`,
      )
      .all(sinceIso) as { kind: string; outcome: Outcome; n: number }[];
    return { made, outcomes };
  }

  /**
   * You confirmed a task done where it was seen (SCR-71): "Yes, done" on a "looks done?", or "This
   * shows it done". Evidence `confirmed`: the place, the task's kind and its verb, never screen text.
   */
  recordConfirmed(id: number, place: string, now: Date = new Date()): void {
    const task = this.getTask(id);
    if (!task) return;
    const verb = task.capturedTitle.match(/[\p{L}][\p{L}'-]*/u)?.[0]?.toLowerCase() ?? '';
    this.addNote(id, 'confirmed', now.toISOString(), `Confirmed by you: done in ${place} · ${task.sourceKind}${verb ? ` · ${verb}` : ''}`);
    this.recordTrust(trustKey(place, task.sourceKind, task.capturedTitle), 'yes', now);
  }

  /** One answer that counts toward trust in a place (SCR-74). */
  recordTrust(key: string, kind: 'yes' | 'no', now: Date = new Date()): void {
    this.db.query('INSERT INTO trust_events (key, kind, ts) VALUES (?, ?, ?)').run(key, kind, now.toISOString());
  }

  /**
   * True when "looks done" there may be ticked without asking (SCR-74): at least `TRUST_YES` yes
   * answers in the last `TRUST_DAYS` days, all after the last no. A no ("not yet", or reopening a
   * task Didja ticked) suspends the place until it has earned `TRUST_YES` more.
   */
  isTrusted(key: string, now: Date = new Date()): boolean {
    const since = new Date(now.getTime() - TRUST_DAYS * 86_400_000).toISOString();
    const rows = this.db.query('SELECT kind FROM trust_events WHERE key = ? AND ts >= ? ORDER BY id').all(key, since) as { kind: string }[];
    let yes = 0;
    for (const row of rows) yes = row.kind === 'no' ? 0 : yes + 1;
    return yes >= TRUST_YES;
  }

  /** How many times you confirmed tasks done (SCR-71), for trust earned later. */
  confirmations(): { taskId: number; detail: string; ts: string }[] {
    return this.db.query("SELECT task_id AS taskId, detail, ts FROM evidence WHERE kind = 'confirmed' ORDER BY id").all() as { taskId: number; detail: string; ts: string }[];
  }

  /** The tasks merged with this one, either way round. */
  mergedWith(id: number): number[] {
    const root = (this.db.query('SELECT merged_into FROM tasks WHERE id = ?').get(id) as { merged_into: number | null } | null)?.merged_into ?? id;
    const rows = this.db.query('SELECT id FROM tasks WHERE (merged_into = ? OR id = ?) AND id != ?').all(root, root, id) as { id: number }[];
    return rows.map((r) => r.id);
  }

  /**
   * Suggest that two tasks are the same thing (seen in two places). Once only: a pair you merged
   * or said are not the same is never suggested again.
   */
  suggestMerge(taskId: number, otherId: number, now: Date): boolean {
    const [a, b] = taskId < otherId ? [taskId, otherId] : [otherId, taskId];
    return this.db.query("INSERT OR IGNORE INTO merge_suggestions (task_id, other_id, status, created_at) VALUES (?, ?, 'suggested', ?)")
      .run(a, b, now.toISOString()).changes > 0;
  }

  /** Waiting suggestions: pairs of tasks that may be the same thing. */
  mergeSuggestions(): { taskId: number; otherId: number }[] {
    return this.db.query("SELECT task_id AS taskId, other_id AS otherId FROM merge_suggestions WHERE status = 'suggested' ORDER BY created_at")
      .all() as { taskId: number; otherId: number }[];
  }

  /**
   * Merge `other` into `keep`: it leaves the list, shown under `keep`, and from now on they finish
   * together. If either is already finished, the other is finished with it.
   */
  merge(keep: number, other: number, now: Date = new Date(), why: 'places' | 'chat' = 'places'): boolean {
    const a = this.getTask(keep);
    const b = this.getTask(other);
    if (!a || !b || keep === other || a.isGroup || b.isGroup) return false;
    const [lo, hi] = keep < other ? [keep, other] : [other, keep];
    this.db.transaction(() => {
      this.db.query('UPDATE tasks SET merged_into = ? WHERE merged_into = ?').run(keep, other); // what was merged into it comes along
      this.db.query('UPDATE tasks SET merged_into = ? WHERE id = ?').run(keep, other);
      this.db.query("INSERT INTO merge_suggestions (task_id, other_id, status, created_at) VALUES (?, ?, 'merged', ?) ON CONFLICT(task_id, other_id) DO UPDATE SET status = 'merged'")
        .run(lo, hi, now.toISOString());
      if (why === 'chat') {
        // One conversation, one task (SCR-45): earlier asks in the same chat.
        this.addNote(other, 'judged', now.toISOString(), `Merged into #${keep}: one task per conversation in ${a.sourceRef}`);
        this.addNote(keep, 'judged', now.toISOString(), `Also asked earlier in this chat: “${b.title}” (#${other}), merged`);
      } else {
        this.addNote(other, 'judged', now.toISOString(), `Merged into #${keep} (${a.sourceRef}): the same thing, seen in two places`);
        this.addNote(keep, 'judged', now.toISOString(), `Also seen in ${b.sourceRef}: “${b.title}” (#${other}), merged`);
      }
    })();
    const done = a.status === 'done' || b.status === 'done';
    if (done) this.setStatus(keep, 'done', now);
    return true;
  }

  /** "Not the same": never suggested again. */
  notSame(taskId: number, otherId: number, now: Date = new Date()): boolean {
    const [a, b] = taskId < otherId ? [taskId, otherId] : [otherId, taskId];
    return this.db.query("INSERT INTO merge_suggestions (task_id, other_id, status, created_at) VALUES (?, ?, 'rejected', ?) ON CONFLICT(task_id, other_id) DO UPDATE SET status = 'rejected'")
      .run(a, b, now.toISOString()).changes > 0;
  }

  private setOwnStatus(id: number, status: TaskStatus, now: Date, until: Date | null): boolean {
    return this.db.transaction(() => {
      const task = this.getTask(id);
      if (!task) return false;
      const stamp = now.toISOString();
      const wake = status === 'snoozed' ? (until ?? new Date(now.getTime() + 60 * 60 * 1000)).toISOString() : null;
      // Any decision about a task settles a pending "looks done?" on it.
      const write = this.db.query(
        'UPDATE tasks SET status = ?, done_at = ?, snoozed_until = ?, suggestion = NULL, suggested_at = NULL, accepted_from = NULL WHERE id = ?',
      );
      // Reopening something ticked for you because it looked done: that place was wrong, so it
      // is never taken as done from there again, as if you had said "Not yet".
      if (status === 'open') {
        for (const row of [task, ...this.subtree(id).map((r) => this.getTask(r.id)!)]) {
          if (!row.acceptedFrom) continue;
          this.db
            .query("INSERT INTO evidence (task_id, observation_id, ts, kind, marker, detail) VALUES (?, NULL, ?, 'rejected', ?, ?)")
            .run(row.id, stamp, row.acceptedFrom, `You reopened it after it was ticked for you (${row.acceptedFrom})`);
        }
      }

      const below = this.subtree(id);
      const steps = below.filter((row) => row.is_group === 0);
      if (!task.isGroup || steps.length === 0) {
        write.run(status, status === 'done' ? stamp : null, wake, id);
      } else {
        for (const step of steps) {
          const pending = step.status === 'open' || step.status === 'snoozed';
          // Acting on a parent settles what is still pending; reopening it brings back what was ticked or snoozed.
          const affected = status === 'open' ? step.status === 'done' || step.status === 'snoozed' : pending;
          if (affected) write.run(status, status === 'done' ? stamp : null, wake, step.id);
        }
        // Parents take their state from what is under them, innermost first.
        for (const group of below.filter((row) => row.is_group === 1)) this.settleParent(group.id, stamp);
      }
      if (task.parentId !== null) this.syncParent(task.parentId, stamp);
      return true;
    })();
  }

  /**
   * Tick everything still open from the conversation a task came from: its open
   * checklists (with their open steps) and its open loose tasks. Snoozed and
   * dismissed top-level tasks, and other conversations, are left alone.
   * Returns the ids ticked, or null when there is no such task.
   */
  completeSource(taskId: number, now: Date = new Date()): number[] | null {
    const task = this.getTask(taskId);
    if (!task) return null;
    const open = this.db
      .query("SELECT id FROM tasks WHERE source = ? AND parent_id IS NULL AND status = 'open' ORDER BY id")
      .all(task.sourceId) as { id: number }[];
    for (const row of open) this.withOutcome(row.id, 'done-by-hand', now, () => this.setStatus(row.id, 'done', now));
    return open.map((row) => row.id);
  }

  /**
   * Fresh Start (SCR-48): every open or snoozed top-level task (a checklist with its steps) is
   * marked done at once, so the list starts empty. What it was is kept, so `undoFreshStart` can put
   * back exactly those that are still done. My List, your own kept list (SCR-46), stays as it is.
   */
  freshStart(now: Date = new Date()): number[] {
    return this.db.transaction(() => {
      const rows = this.db
        .query(`SELECT id, status, snoozed_until AS until FROM tasks
                WHERE parent_id IS NULL AND merged_into IS NULL AND status IN ('open', 'snoozed')
                  AND source NOT IN (SELECT id FROM sources WHERE kind = '${KEPT_KIND}') ORDER BY id`)
        .all() as { id: number; status: TaskStatus; until: string | null }[];
      for (const row of rows) {
        this.withOutcome(row.id, 'fresh-start', now, () => this.setStatus(row.id, 'done', now));
        this.addNote(row.id, 'judged', now.toISOString(), 'Marked done by Fresh Start');
      }
      this.setMeta('fresh_start', JSON.stringify({ at: now.toISOString(), tasks: rows }));
      return rows.map((r) => r.id);
    })();
  }

  /** When the last Fresh Start was and how many it marked done, while it can still be undone. */
  lastFreshStart(): { at: string; count: number } | null {
    const raw = this.getMeta('fresh_start');
    if (!raw) return null;
    const saved = JSON.parse(raw) as { at: string; tasks: unknown[] };
    return { at: saved.at, count: saved.tasks.length };
  }

  /** Put back the tasks the last Fresh Start marked done, as they were, unless you changed them since. */
  undoFreshStart(now: Date = new Date()): number[] {
    const raw = this.getMeta('fresh_start');
    if (!raw) return [];
    const saved = JSON.parse(raw) as { at: string; tasks: { id: number; status: TaskStatus; until: string | null }[] };
    return this.db.transaction(() => {
      const back: number[] = [];
      for (const t of saved.tasks) {
        const task = this.getTask(t.id);
        if (!task || task.status !== 'done' || task.doneAt !== saved.at) continue;
        if (t.status === 'snoozed' && t.until && new Date(t.until) > now) this.setStatus(t.id, 'snoozed', now, new Date(t.until));
        else this.setStatus(t.id, 'open', now);
        back.push(t.id);
      }
      // Undone, so not counted as cleared by Fresh Start (SCR-73).
      for (const id of back) {
        for (const step of this.steps(id)) {
          this.db.query("DELETE FROM outcomes WHERE task_id = ? AND outcome = 'fresh-start' AND ts = ?").run(step.id, saved.at);
        }
      }
      this.db.query("DELETE FROM meta WHERE key = 'fresh_start'").run();
      return back;
    })();
  }

  // --- Where steps get done ("Didja Missed This…") -------------------------------------------

  /** Remember that a task was done at a site (a host, or an app with no address). */
  addDonePlace(taskId: number, site: string, word: string | null, now: Date = new Date()): number | null {
    const task = this.getTask(taskId);
    const clean = site.trim().toLowerCase();
    if (!task || !clean) return null;
    const known = this.db.query('SELECT id FROM done_places WHERE site = ? AND source = ? AND IFNULL(word, \'\') = ?')
      .get(clean, task.sourceId, word ?? '') as { id: number } | null;
    if (known) return known.id;
    return Number(this.db.query('INSERT INTO done_places (task_id, source, word, site, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(taskId, task.sourceId, word, clean, now.toISOString()).lastInsertRowid);
  }

  donePlaces(): DonePlace[] {
    return this.db.query('SELECT id, task_id AS taskId, source, word, site, created_at AS createdAt FROM done_places ORDER BY id')
      .all() as DonePlace[];
  }

  /** The places you taught, with the conversation each applies to, for How It Decides. */
  donePlacesShown(): { id: number; site: string; word: string | null; conversation: string | null; createdAt: string }[] {
    return this.db.query(`SELECT p.id, p.site, p.word, s.ref AS conversation, p.created_at AS createdAt
      FROM done_places p LEFT JOIN sources s ON s.id = p.source ORDER BY p.id`).all() as never;
  }

  setDonePlaceWord(id: number, word: string | null): boolean {
    return this.db.query('UPDATE done_places SET word = ? WHERE id = ?').run(word, id).changes > 0;
  }

  forgetDonePlace(id: number): boolean {
    return this.db.query('DELETE FROM done_places WHERE id = ?').run(id).changes > 0;
  }

  observation(id: number): Observation | null {
    const row = this.db.query('SELECT * FROM observations WHERE id = ?').get(id) as ObservationRow | null;
    return row ? toObservation(row) : null;
  }

  /** Screens kept since a time, oldest first (at most `limit`). */
  observationsSince(iso: string, limit = 2000): Observation[] {
    const rows = this.db.query('SELECT * FROM observations WHERE ts >= ? ORDER BY id DESC LIMIT ?').all(iso, limit) as ObservationRow[];
    return rows.map(toObservation).reverse();
  }

  // --- Canvases (SCR-49) --------------------------------------------------------------------

  createCanvas(title: string, now: Date = new Date()): number {
    const ts = now.toISOString();
    return Number(this.db.query('INSERT INTO canvases (title, created_at, updated_at) VALUES (?, ?, ?)')
      .run(title.trim() || 'Untitled canvas', ts, ts).lastInsertRowid);
  }

  canvases(): Canvas[] {
    return this.db.query(`SELECT c.id, c.title, c.updated_at AS updatedAt,
        (SELECT COUNT(*) FROM canvas_items i JOIN tasks t ON t.id = i.task_id WHERE i.canvas_id = c.id AND t.status IN ('open', 'snoozed')) AS open
      FROM canvases c ORDER BY c.updated_at DESC`).all() as Canvas[];
  }

  canvas(id: number): (Canvas & { items: CanvasItem[] }) | null {
    const head = this.canvases().find((c) => c.id === id);
    if (!head) return null;
    const rows = this.db.query('SELECT id, kind, task_id AS taskId, text, position, level FROM canvas_items WHERE canvas_id = ? ORDER BY position, id')
      .all(id) as { id: number; kind: CanvasItem['kind']; taskId: number | null; text: string | null; position: number; level: number }[];
    const items: CanvasItem[] = rows.flatMap((r): CanvasItem[] => {
      if (r.kind !== 'task') return [{ id: r.id, kind: r.kind, text: r.text ?? '', level: r.level }];
      const task = r.taskId === null ? null : this.getTask(r.taskId);
      if (!task) return [];
      return [{ id: r.id, kind: 'task' as const, text: task.title, level: r.level, task: { id: task.id, status: task.status, suggestion: task.suggestion, source: task.sourceRef } }];
    });
    for (const item of items) {
      if (item.kind !== 'heading') continue;
      const under = canvasSection(items, item.id).filter((t) => t.task!.status !== 'dismissed');
      item.section = { tasks: under.length, open: under.filter((t) => t.task!.status === 'open' || t.task!.status === 'snoozed').length };
    }
    return { ...head, items };
  }

  private touchCanvas(id: number, now: Date): void {
    this.db.query('UPDATE canvases SET updated_at = ? WHERE id = ?').run(now.toISOString(), id);
  }

  private nextPosition(canvasId: number): number {
    const row = this.db.query('SELECT MAX(position) AS p FROM canvas_items WHERE canvas_id = ?').get(canvasId) as { p: number | null };
    return (row.p ?? 0) + 1;
  }

  private addCanvasItem(canvasId: number, kind: CanvasItem['kind'], taskId: number | null, text: string | null, now: Date, level = 0): number | null {
    const info = this.db.query(`INSERT OR IGNORE INTO canvas_items (canvas_id, position, kind, task_id, text, created_at, level) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(canvasId, this.nextPosition(canvasId), kind, taskId, text, now.toISOString(), clampLevel(level));
    this.touchCanvas(canvasId, now);
    return info.changes > 0 ? Number(info.lastInsertRowid) : null;
  }

  /**
   * Send tasks to a canvas. A checklist sends its title as a heading and its steps as tasks. A task
   * already on the canvas is not added twice. Returns the items added.
   */
  sendToCanvas(canvasId: number, taskIds: number[], now: Date = new Date()): number[] {
    if (!this.db.query('SELECT 1 FROM canvases WHERE id = ?').get(canvasId)) return [];
    return this.db.transaction(() => {
      const added: number[] = [];
      for (const id of taskIds) {
        const task = this.getTask(id);
        if (!task) continue;
        if (task.isGroup) {
          const steps = this.subtree(id).filter((r) => r.is_group === 0 && r.parent_id === id);
          const heading = this.addCanvasItem(canvasId, 'heading', null, task.title, now);
          if (heading) added.push(heading);
          for (const step of steps) {
            const item = this.addCanvasItem(canvasId, 'task', step.id, null, now, 1);
            if (item) added.push(item);
          }
        } else {
          const item = this.addCanvasItem(canvasId, 'task', id, null, now);
          if (item) added.push(item);
        }
      }
      return added;
    })();
  }

  addCanvasNote(canvasId: number, kind: 'note' | 'heading', text: string, now: Date = new Date(), level = 0): number | null {
    if (!this.db.query('SELECT 1 FROM canvases WHERE id = ?').get(canvasId)) return null;
    return this.addCanvasItem(canvasId, kind, null, text, now, level);
  }

  /** Put a task on a canvas at a level (a task made there, `canvas line`). */
  addCanvasTask(canvasId: number, taskId: number, level: number, now: Date = new Date()): number | null {
    if (!this.db.query('SELECT 1 FROM canvases WHERE id = ?').get(canvasId)) return null;
    return this.addCanvasItem(canvasId, 'task', taskId, null, now, level);
  }

  /**
   * Tick every task under a heading, as if you ticked each (SCR-59): those open or snoozed become
   * done. With `undo`, those done become open again. Dismissed tasks are left as they are. Returns
   * the tasks changed.
   */
  tickCanvasSection(headingId: number, undo = false, now: Date = new Date()): number[] {
    const row = this.db.query("SELECT canvas_id AS canvasId FROM canvas_items WHERE id = ? AND kind = 'heading'")
      .get(headingId) as { canvasId: number } | null;
    const page = row ? this.canvas(row.canvasId) : null;
    if (!row || !page) return [];
    const wanted: TaskStatus[] = undo ? ['done'] : ['open', 'snoozed'];
    const ids = canvasSection(page.items, headingId).map((t) => t.task!).filter((t) => wanted.includes(t.status)).map((t) => t.id);
    return this.db.transaction(() => {
      const changed = ids.filter((id) => this.changeByYou(id, undo ? 'open' : 'done', now));
      if (changed.length) this.touchCanvas(row.canvasId, now);
      return changed;
    })();
  }

  /** Indent or outdent an item (0 to 4). */
  setCanvasLevel(itemId: number, level: number, now: Date = new Date()): boolean {
    const row = this.db.query('SELECT canvas_id AS canvasId FROM canvas_items WHERE id = ?').get(itemId) as { canvasId: number } | null;
    if (!row) return false;
    this.db.query('UPDATE canvas_items SET level = ? WHERE id = ?').run(clampLevel(level), itemId);
    this.touchCanvas(row.canvasId, now);
    return true;
  }

  /** A note's or heading's text; a task item's text is the task's, renamed through `rename`. */
  editCanvasItem(itemId: number, text: string, now: Date = new Date()): boolean {
    const row = this.db.query("SELECT canvas_id AS canvasId FROM canvas_items WHERE id = ? AND kind != 'task'").get(itemId) as { canvasId: number } | null;
    if (!row) return false;
    this.db.query('UPDATE canvas_items SET text = ? WHERE id = ?').run(text, itemId);
    this.touchCanvas(row.canvasId, now);
    return true;
  }

  /** Move an item to sit before another (or to the end when `before` is null). */
  moveCanvasItem(itemId: number, before: number | null, now: Date = new Date()): boolean {
    const row = this.db.query('SELECT canvas_id AS canvasId FROM canvas_items WHERE id = ?').get(itemId) as { canvasId: number } | null;
    if (!row) return false;
    let position = this.nextPosition(row.canvasId);
    if (before !== null) {
      const target = this.db.query('SELECT position FROM canvas_items WHERE id = ? AND canvas_id = ?').get(before, row.canvasId) as { position: number } | null;
      if (!target) return false;
      const prev = this.db.query('SELECT MAX(position) AS p FROM canvas_items WHERE canvas_id = ? AND position < ? AND id != ?')
        .get(row.canvasId, target.position, itemId) as { p: number | null };
      position = ((prev.p ?? target.position - 1) + target.position) / 2;
    }
    this.db.query('UPDATE canvas_items SET position = ? WHERE id = ?').run(position, itemId);
    this.touchCanvas(row.canvasId, now);
    return true;
  }

  /** Take an item off its canvas. A task stays a task; it is only no longer on the canvas. */
  removeCanvasItem(itemId: number): boolean {
    return this.db.query('DELETE FROM canvas_items WHERE id = ?').run(itemId).changes > 0;
  }

  renameCanvas(id: number, title: string, now: Date = new Date()): boolean {
    const clean = title.trim();
    if (!clean) return false;
    const changed = this.db.query('UPDATE canvases SET title = ? WHERE id = ?').run(clean, id).changes > 0;
    if (changed) this.touchCanvas(id, now);
    return changed;
  }

  deleteCanvas(id: number): boolean {
    return this.db.query('DELETE FROM canvases WHERE id = ?').run(id).changes > 0;
  }

  /** Snooze a task (or a whole checklist) until a given time. */
  snooze(id: number, until: Date, now: Date = new Date()): boolean {
    return this.setStatus(id, 'snoozed', now, until);
  }

  /** Reopen snoozed tasks whose time has come. Returns how many came back. */
  wakeSnoozed(now: Date = new Date()): number {
    return this.db.transaction(() => {
      const due = this.db
        .query("SELECT id, parent_id FROM tasks WHERE is_group = 0 AND status = 'snoozed' AND snoozed_until <= ?")
        .all(now.toISOString()) as { id: number; parent_id: number | null }[];
      for (const row of due) {
        this.db.query("UPDATE tasks SET status = 'open', snoozed_until = NULL WHERE id = ?").run(row.id);
      }
      for (const parent of new Set(due.map((r) => r.parent_id))) {
        if (parent !== null) this.syncParent(parent, now.toISOString());
      }
      return due.length;
    })();
  }

  /** Bring a parent, and every parent above it, in line with what is under them. */
  private syncParent(parentId: number, stamp: string = new Date().toISOString()): void {
    let current: number | null = parentId;
    while (current !== null) {
      this.settleParent(current, stamp);
      const row = this.db.query('SELECT parent_id FROM tasks WHERE id = ?').get(current) as { parent_id: number | null } | null;
      current = row?.parent_id ?? null;
    }
  }

  /** Set one parent's state from its direct children. */
  private settleParent(parentId: number, stamp: string): void {
    const steps = this.db
      .query('SELECT status, snoozed_until FROM tasks WHERE parent_id = ?')
      .all(parentId) as { status: TaskStatus; snoozed_until: string | null }[];
    if (steps.length === 0) return;
    const snoozed = steps.filter((s) => s.status === 'snoozed');
    const target: TaskStatus = steps.some((s) => s.status === 'open')
      ? 'open'
      : snoozed.length > 0
        ? 'snoozed'
        : steps.some((s) => s.status === 'done')
          ? 'done'
          : 'dismissed';
    // A checklist with only snoozed steps left comes back when the first of them does.
    const wake = target === 'snoozed' ? (snoozed.map((s) => s.snoozed_until ?? stamp).sort()[0] ?? null) : null;
    const current = this.db.query('SELECT status, snoozed_until FROM tasks WHERE id = ?').get(parentId) as
      | { status: TaskStatus; snoozed_until: string | null }
      | null;
    if (!current || (current.status === target && current.snoozed_until === wake)) return;
    this.db
      .query('UPDATE tasks SET status = ?, done_at = ?, snoozed_until = ? WHERE id = ?')
      .run(target, target === 'done' ? stamp : null, wake, parentId);
  }

  /** Give an item your own name, or pass null to go back to the captured one. */
  rename(id: number, title: string | null, now: Date = new Date()): boolean {
    // A checklist you renamed shows the titles job what a good heading is (SCR-71).
    const before = title?.trim() ? this.getTask(id) : null;
    if (before?.isGroup && title!.trim() !== before.capturedTitle) {
      this.addLesson('titles', 'renamed', dedupeKey(before.capturedTitle), `A checklist introduced by "${before.capturedTitle.slice(0, 120)}" is better titled "${title!.trim().slice(0, 80)}".`, now);
    }
    const name = title?.replace(/\s+/g, ' ').trim() || null;
    return this.db.query('UPDATE tasks SET custom_title = ? WHERE id = ?').run(name, id).changes > 0;
  }

  /**
   * Open top-level checklists that have not been offered to the model for a
   * title yet and have stopped changing, with their steps.
   */
  checklistsAwaitingTitle(before: Date, limit: number): { id: number; title: string; steps: string[] }[] {
    const rows = this.db
      .query(
        `SELECT id, title FROM tasks
         WHERE is_group = 1 AND parent_id IS NULL AND status = 'open'
           AND model_title IS NULL AND custom_title IS NULL AND last_seen_at <= ?
         ORDER BY id LIMIT ?`,
      )
      .all(before.toISOString(), limit) as { id: number; title: string }[];
    return rows.map((row) => ({
      ...row,
      steps: (this.db.query('SELECT title FROM tasks WHERE parent_id = ? ORDER BY position IS NULL, position, id').all(row.id) as { title: string }[])
        .map((s) => s.title),
    }));
  }

  /** Record the model's title for a checklist. '' records that it was asked and gave nothing usable. */
  setModelTitle(id: number, title: string): void {
    this.db.query('UPDATE tasks SET model_title = ? WHERE id = ?').run(title, id);
  }

  // --- "looks done — confirm?"

  /**
   * Open steps with nothing exact to match and no suggestion waiting: the ones worth a look. With
   * `autoSince`, also steps that do have something exact to match (a command, an env var) but were
   * made before then and are still open: their exact match was missed (SCR-69).
   */
  tasksToWatch(autoSince: string | null = null): Task[] {
    const rows = this.db
      .query(`${SELECT_TASK} WHERE t.is_group = 0 AND t.status = 'open' AND (t.auto = 0 OR (?1 IS NOT NULL AND t.created_at <= ?1)) AND t.suggestion IS NULL ORDER BY t.id`)
      .all(autoSince) as TaskRow[];
    // Replies are noticed by subject and sender, not by showing screens to the model; a chat ask is
    // settled by your reply in that chat, never by some other screen that happens to share its words.
    // Your own list (SCR-46) is ticked only by you.
    return rows.map(toTask).filter((t) => !t.criteria?.reply && !t.criteria?.chat && t.sourceKind !== KEPT_KIND);
  }

  /** Open tasks from emails that pointed somewhere: the pages their links lead to. */
  tasksWithLinks(): Task[] {
    const rows = this.db
      .query(`${SELECT_TASK} WHERE t.is_group = 0 AND t.status = 'open' AND t.criteria LIKE '%"links"%' ORDER BY t.id`)
      .all() as TaskRow[];
    return rows.map(toTask).filter((t) => (t.criteria?.links?.length ?? 0) > 0);
  }

  /** Remember the pages a task's email points to, keeping whatever else is known about it. */
  setLinks(id: number, links: string[]): void {
    const task = this.getTask(id);
    if (!task || links.length === 0) return;
    const criteria: Criteria = { ...(task.criteria ?? { service: null, hosts: [] }), links };
    this.db.query('UPDATE tasks SET criteria = ? WHERE id = ?').run(JSON.stringify(criteria), id);
  }

  /** When each page address was first on screen since a moment, oldest first. */
  pagesSeenSince(ts: string): { ts: string; url: string }[] {
    return this.db
      .query('SELECT MIN(ts) AS ts, url FROM observations WHERE ts > ? AND url IS NOT NULL GROUP BY url ORDER BY ts')
      .all(ts) as { ts: string; url: string }[];
  }

  /** Tick a task because of what was seen, and say why. */
  tickSeen(id: number, observationId: number | null, detail: string, now: Date): void {
    // The evidence first, so the tick is timed from the screen that showed it (SCR-75).
    this.db
      .query("INSERT INTO evidence (task_id, observation_id, ts, kind, detail) VALUES (?, ?, ?, 'judged', ?)")
      .run(id, observationId, now.toISOString(), detail);
    this.withOutcome(id, 'ticked-screen', now, () => this.setStatus(id, 'done', now));
  }

  /** Open "reply to…" tasks with no suggestion waiting. */
  repliesAwaited(): Task[] {
    const rows = this.db
      .query(`${SELECT_TASK} WHERE t.is_group = 0 AND t.status = 'open' AND t.suggestion IS NULL AND t.criteria LIKE '%"reply"%' ORDER BY t.id`)
      .all() as TaskRow[];
    return rows.map(toTask).filter((t) => t.criteria?.reply);
  }

  /** Tasks brought in from a connected tool, whatever their state. */
  externalTasks(connection: string): Task[] {
    const rows = this.db
      .query(`${SELECT_TASK} WHERE t.is_group = 0 AND t.criteria LIKE '%"external"%' ORDER BY t.id`)
      .all() as TaskRow[];
    return rows.map(toTask).filter((t) => t.criteria?.external?.connection === connection);
  }

  // --- Chat asks waiting to become tasks (SCR-45) ---------------------------------------------

  addPendingChatAsk(p: PendingChatAsk, now: Date): void {
    this.db
      .query(
        `INSERT OR IGNORE INTO chat_pending (key, app, chat, sender, title, at, observation_id, ts, created_at, why)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(p.key, p.app, p.chat, p.from, p.title, p.at, p.observationId, p.ts, now.toISOString(), p.why ?? null);
  }

  /** Asks sent at least `waitMs` ago, oldest first. */
  duePendingChatAsks(now: Date, waitMs: number): PendingChatAsk[] {
    return this.db
      .query(
        `SELECT key, app, chat, sender AS "from", title, at, observation_id AS observationId, ts, why FROM chat_pending
         WHERE at <= ? ORDER BY at, key`,
      )
      .all(new Date(now.getTime() - waitMs).toISOString()) as PendingChatAsk[];
  }

  dropPendingChatAsk(key: string): void {
    this.db.query('DELETE FROM chat_pending WHERE key = ?').run(key);
  }

  /** A reply of yours in this chat, sent at `upTo`: the asks sent before it were answered. Returns their keys. */
  answerPendingChatAsks(app: string, chat: string, upTo: Date): string[] {
    const rows = this.db
      .query('SELECT key FROM chat_pending WHERE app = ? AND chat = ? AND at <= ?')
      .all(app, chat, upTo.toISOString()) as { key: string }[];
    for (const { key } of rows) this.dropPendingChatAsk(key);
    return rows.map((r) => r.key);
  }

  /** Keeps a borderline chat ask in the Suggested tray (SCR-95). Once per message; false if it was there. */
  addSuggestion(ask: PendingChatAsk, sourceRef: string, now: Date): boolean {
    const result = this.db
      .query('INSERT OR IGNORE INTO suggestions (key, kind, source_ref, title, ask, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(ask.key, 'chat', sourceRef, ask.title, JSON.stringify(ask), now.toISOString());
    return result.changes > 0;
  }

  /** The suggestions waiting, newest first. Titles and where they came from only. */
  suggestions(): Suggestion[] {
    return this.db
      .query("SELECT id, kind, source_ref AS sourceRef, title, created_at AS createdAt FROM suggestions ORDER BY created_at DESC, id DESC")
      .all() as Suggestion[];
  }

  /** Takes a suggestion out of the tray, with what Accept needs. Null if it is not there. */
  takeSuggestion(id: number): PendingChatAsk | null {
    const row = this.db.query('SELECT ask FROM suggestions WHERE id = ?').get(id) as { ask: string } | null;
    if (!row) return null;
    this.db.query('DELETE FROM suggestions WHERE id = ?').run(id);
    return JSON.parse(row.ask) as PendingChatAsk;
  }

  /** Not an Action on a suggestion: taught as on a chat task, and gone from the tray. */
  notAnActionSuggestion(id: number, now: Date = new Date()): boolean {
    const ask = this.takeSuggestion(id);
    if (!ask) return false;
    this.addLesson('chats', 'not-an-action', dedupeKey(ask.title), `In ${ask.app}, "${ask.title}" was not something asked of me.`, now);
    return true;
  }

  /** A reply of yours in that conversation answers its suggestions too: they leave the tray. */
  answerSuggestions(app: string, chat: string, upTo: Date): number {
    const rows = this.db.query("SELECT id, ask FROM suggestions WHERE kind = 'chat'").all() as { id: number; ask: string }[];
    let gone = 0;
    for (const row of rows) {
      const ask = JSON.parse(row.ask) as PendingChatAsk;
      if (ask.app === app && ask.chat === chat && ask.at <= upTo.toISOString()) {
        this.db.query('DELETE FROM suggestions WHERE id = ?').run(row.id);
        gone++;
      }
    }
    return gone;
  }

  /** Suggestions older than 24 hours are deleted, leaving nothing behind. */
  pruneSuggestions(now: Date): void {
    this.db.query('DELETE FROM suggestions WHERE created_at < ?').run(new Date(now.getTime() - SUGGESTION_TTL_MS).toISOString());
  }

  /**
   * How eagerly asks become tasks (SCR-95, `meta.capture_level`): "strict", "balanced" (the default,
   * what Didja always did) or "everything" (borderline asks go to the Suggested tray).
   */
  captureLevel(): CaptureLevel {
    const level = this.getMeta('capture_level');
    return level === 'strict' || level === 'everything' ? level : 'balanced';
  }

  setCaptureLevel(level: CaptureLevel): void {
    this.setMeta('capture_level', level);
  }

  prunePendingChatAsks(now: Date): void {
    this.db.query('DELETE FROM chat_pending WHERE created_at < ?').run(new Date(now.getTime() - 86_400_000).toISOString());
  }

  /** The open (or snoozed) task for a chat conversation, if there is one; merged tasks never count. */
  openChatTask(app: string, chat: string): Task | null {
    const rows = this.db
      .query(`${SELECT_TASK} WHERE t.is_group = 0 AND t.status IN ('open', 'snoozed') AND t.merged_into IS NULL AND t.criteria LIKE '%"chat"%' ORDER BY t.id DESC`)
      .all() as TaskRow[];
    return rows.map(toTask).find((t) => t.criteria?.chat?.app === app && t.criteria.chat.chat === chat) ?? null;
  }

  /**
   * Another ask in the same chat joins its open task: the task now waits for a reply after this
   * newest ask, a "looks done" it was showing no longer holds, and it is reworded to the newest ask.
   */
  addAskToChatTask(id: number, chat: NonNullable<Criteria['chat']>, title: string, now: Date): void {
    const task = this.getTask(id);
    if (!task?.criteria) return;
    const criteria = { ...task.criteria, chat: { ...chat, asks: (task.criteria.chat?.asks ?? 1) + 1 } };
    this.db
      .query('UPDATE tasks SET criteria = ?, suggestion = NULL, suggested_at = NULL, last_seen_at = MAX(last_seen_at, ?) WHERE id = ?')
      .run(JSON.stringify(criteria), now.toISOString(), id);
    const more = criteria.chat.asks - 1;
    this.retitle(id, `${title} · +${more}`);
    this.addNote(id, 'judged', now.toISOString(), `Asked again in ${chat.app} — ${chat.chat}: “${title}”`);
  }

  /** Open tasks asked of you in a chat, with no suggestion waiting: a reply of yours may settle them. */
  chatTasksAwaited(): Task[] {
    const rows = this.db
      .query(`${SELECT_TASK} WHERE t.is_group = 0 AND t.status = 'open' AND t.suggestion IS NULL AND t.criteria LIKE '%"chat"%' ORDER BY t.id`)
      .all() as TaskRow[];
    return rows.map(toTask).filter((t) => t.criteria?.chat);
  }

  /**
   * Tick a chat task because you replied and the reply settles it. It keeps where, for its label
   * and so that reopening it stops replies there ticking it again.
   */
  tickByReply(id: number, place: string, now: Date): void {
    this.withOutcome(id, 'ticked-reply', now, () => this.setStatus(id, 'done', now));
    this.db.query('UPDATE tasks SET accepted_from = ? WHERE id = ?').run(place, id);
    this.db
      .query("INSERT INTO evidence (task_id, observation_id, ts, kind, detail) VALUES (?, NULL, ?, 'judged', ?)")
      .run(id, now.toISOString(), `Ticked for you: you replied in ${place}, and the reply settles it`);
  }

  /** The task this email became, whatever state it is in now. */
  mailTask(mailKey: string): { id: number; status: TaskStatus } | null {
    return this.db
      .query('SELECT t.id, t.status FROM email_tasks m JOIN tasks t ON t.id = m.task_id WHERE m.mail_key = ?')
      .get(mailKey) as { id: number; status: TaskStatus } | null;
  }

  linkMail(mailKey: string, taskId: number): void {
    this.db.query('INSERT OR REPLACE INTO email_tasks (mail_key, task_id) VALUES (?, ?)').run(mailKey, taskId);
  }

  /**
   * An email task made before emails were linked to their tasks, for this
   * subject: one titled the old way, "Reply to <sender>: <subject>", or one
   * whose note names the subject. An open one is preferred; a finished or
   * dismissed one is returned too, so the email is not made into a second task.
   */
  unlinkedMailTask(subject: string): { id: number; status: TaskStatus } | null {
    const rows = this.db
      .query(
        `SELECT t.id, t.title, t.status,
                (SELECT detail FROM evidence e WHERE e.task_id = t.id AND e.kind = 'origin' ORDER BY e.id DESC LIMIT 1) AS origin
         FROM tasks t JOIN sources s ON s.id = t.source
         WHERE s.kind = 'email' AND t.id NOT IN (SELECT task_id FROM email_tasks)
         ORDER BY t.status = 'open' DESC, t.id`,
      )
      .all() as { id: number; title: string; status: TaskStatus; origin: string | null }[];
    const named = subject.trim();
    const found = rows.find(
      (r) => (r.title.startsWith('Reply to ') && r.title.endsWith(`: ${named}`)) || r.origin?.endsWith(`— “${named.slice(0, 80)}”`),
    );
    return found ? { id: found.id, status: found.status } : null;
  }

  /** A task was on screen again: it counts as recent activity. */
  touch(id: number, ts: string): void {
    this.db.query('UPDATE tasks SET last_seen_at = MAX(last_seen_at, ?) WHERE id = ?').run(ts, id);
  }

  /**
   * The email was archived: its tasks leave the list. They are dismissed, not ticked: archiving
   * says you no longer need it, not that it was done. The email the task came from, or another
   * about the same matter ("Closed: Purchase order 4410" for "Action Required: Purchase order
   * 4410"), in the same mailbox. Returns how many.
   */
  dismissArchived(mailbox: string, subject: string, now: Date): number {
    const rows = this.db
      .query(
        `SELECT t.id,
                (SELECT detail FROM evidence e WHERE e.task_id = t.id AND e.kind = 'origin' ORDER BY e.id DESC LIMIT 1) AS origin
         FROM tasks t JOIN sources s ON s.id = t.source
         WHERE s.kind = 'email' AND s.ref = ? AND t.status IN ('open', 'snoozed')`,
      )
      .all(mailbox) as { id: number; origin: string | null }[];
    const hit = rows.filter((r) => {
      const from = r.origin?.match(/— “(.*)”$/)?.[1];
      return from !== undefined && sameMatter(from, subject.trim());
    });
    for (const { id } of hit) {
      this.setStatus(id, 'dismissed', now);
      this.addNote(id, 'judged', now.toISOString(), 'Dismissed: you archived the email');
    }
    return hit.length;
  }

  /**
   * Open or snoozed email tasks in this mailbox whose request had exactly this subject (reply and
   * forward prefixes aside; an origin note keeps at most 80 characters), with who it was from as
   * the note says.
   */
  mailTasksWithSubject(mailbox: string, subject: string): { id: number; from: string }[] {
    const rows = this.db
      .query(
        `SELECT t.id,
                (SELECT detail FROM evidence e WHERE e.task_id = t.id AND e.kind = 'origin' ORDER BY e.id DESC LIMIT 1) AS origin
         FROM tasks t JOIN sources s ON s.id = t.source
         WHERE s.kind = 'email' AND s.ref = ? AND t.status IN ('open', 'snoozed')`,
      )
      .all(mailbox) as { id: number; origin: string | null }[];
    const want = baseSubject(subject);
    const found: { id: number; from: string }[] = [];
    for (const r of rows) {
      const m = r.origin?.match(/^From an email: (.*) — “(.*)”$/);
      if (!m) continue;
      const kept = baseSubject(m[2]!);
      if (kept === want || (m[2]!.length >= 80 && want.startsWith(kept))) found.push({ id: r.id, from: m[1]! });
    }
    return found;
  }

  /**
   * Tick an email task because you sent the workflow your response to it. It keeps where, so that
   * reopening it stops that response ticking it again.
   */
  tickByResponse(id: number, place: string, now: Date): void {
    this.withOutcome(id, 'ticked-reply', now, () => this.setStatus(id, 'done', now));
    this.db.query('UPDATE tasks SET accepted_from = ? WHERE id = ?').run(place, id);
    this.db
      .query("INSERT INTO evidence (task_id, observation_id, ts, kind, detail) VALUES (?, NULL, ?, 'judged', ?)")
      .run(id, now.toISOString(), `Ticked for you: you sent your response in ${place}`);
  }

  /** The one note that says where a task came from: the newest reading replaces the last. */
  setOrigin(taskId: number, ts: string, detail: string): void {
    this.db.query("DELETE FROM evidence WHERE task_id = ? AND kind = 'origin'").run(taskId);
    this.addNote(taskId, 'origin', ts, detail);
  }

  /** Give a task new wording, keeping everything else about it. False if another task already has that wording. */
  retitle(id: number, title: string): boolean {
    // A task tied to one message keeps that identity under its new wording.
    const old = (this.db.query('SELECT dedupe_key FROM tasks WHERE id = ?').get(id) as { dedupe_key: string } | null)?.dedupe_key ?? '';
    const identity = old.includes('\u0000') ? old.slice(old.indexOf('\u0000')) : '';
    const key = dedupeKey(title) + identity;
    if (this.db.query('SELECT 1 FROM tasks WHERE dedupe_key = ? AND id != ? AND is_group = 0').get(key, id)) return false;
    return this.db.query('UPDATE tasks SET title = ?, dedupe_key = ? WHERE id = ?').run(title, key, id).changes > 0;
  }

  /** Emails are asked about again, once, when what is asked of the model changes. */
  forgetEmailChecksBefore(version: string): void {
    if (this.getMeta('email_checks_version') === version) return;
    this.db.run('DELETE FROM email_checks');
    this.setMeta('email_checks_version', version);
  }

  emailVerdict(key: string): string | null {
    const row = this.db.query('SELECT verdict FROM email_checks WHERE key = ?').get(key) as { verdict: string } | null;
    return row?.verdict ?? null;
  }

  recordEmailCheck(key: string, verdict: string, now: Date): void {
    this.db.query('INSERT OR REPLACE INTO email_checks (key, verdict, created_at) VALUES (?, ?, ?)').run(key, verdict, now.toISOString());
  }

  /** What the model said the last time it was shown exactly this, if it was. */
  looksDoneVerdict(key: string): string | null {
    const row = this.db.query('SELECT verdict FROM looks_done_checks WHERE key = ?').get(key) as { verdict: string } | null;
    return row?.verdict ?? null;
  }

  recordLooksDoneCheck(key: string, taskId: number, verdict: string, now: Date): void {
    this.db
      .query('INSERT OR REPLACE INTO looks_done_checks (key, task_id, verdict, created_at) VALUES (?, ?, ?, ?)')
      .run(key, taskId, verdict, now.toISOString());
  }

  // --- teaching: your instructions for the model, and the corrections you made

  /** What the model is told for one job: your instructions if you wrote some, and your corrections as examples. */
  teaching(job: Job): Teaching {
    const row = this.db.query('SELECT instructions FROM brain_jobs WHERE job = ?').get(job) as { instructions: string } | null;
    const examples = (this.db
      .query('SELECT example FROM lesson_notes WHERE job = ? ORDER BY id DESC LIMIT ?')
      .all(job, MAX_EXAMPLES) as { example: string }[]).map((r) => r.example).reverse();
    return { instructions: row?.instructions ?? null, examples };
  }

  /** Replace the built-in instructions for a job with yours; null or blank goes back to the built-in ones. */
  setInstructions(job: Job, text: string | null, now: Date = new Date()): void {
    const clean = text?.trim() ?? '';
    if (clean === '') {
      this.db.query('DELETE FROM brain_jobs WHERE job = ?').run(job);
      return;
    }
    this.db
      .query('INSERT INTO brain_jobs (job, instructions, updated_at) VALUES (?, ?, ?) ON CONFLICT(job) DO UPDATE SET instructions = excluded.instructions, updated_at = excluded.updated_at')
      .run(job, clean.slice(0, MAX_INSTRUCTIONS), now.toISOString());
  }

  lessons(): Lesson[] {
    return this.db.query('SELECT id, job, kind, key, example, created_at AS createdAt FROM lesson_notes ORDER BY id').all() as Lesson[];
  }

  forgetLesson(id: number): boolean {
    return this.db.query('DELETE FROM lesson_notes WHERE id = ?').run(id).changes > 0;
  }

  private addLesson(job: Job, kind: Lesson['kind'], key: string, example: string, now: Date): void {
    // A lesson keyed by nothing would match every task with no Latin letters (SCR-62).
    if (key === '' || key.startsWith('\u0000')) return;
    const known = this.db.query('SELECT 1 FROM lesson_notes WHERE job = ? AND kind = ? AND key = ?').get(job, kind, key);
    if (known) return;
    this.db
      .query('INSERT INTO lesson_notes (job, kind, key, example, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(job, kind, key, example.slice(0, 240), now.toISOString());
  }

  /** True when you said a task worded like this is not something for you to do. */
  isNotAnAction(title: string, job: Job = 'lists'): boolean {
    const key = dedupeKey(title);
    if (key === '') return false;
    return this.db.query("SELECT 1 FROM lesson_notes WHERE kind = 'not-an-action' AND job = ? AND key = ?").get(job, key) !== null;
  }

  /**
   * Lessons stored under an empty key before titles kept letters of every script (SCR-62): each
   * one matched every Hebrew (or other non-Latin) task. Dropped once; returns how many.
   */
  dropEmptyLessonsOnce(): number {
    if (this.getMeta('empty_lessons_dropped') === 'yes') return 0;
    const n = this.db.query("DELETE FROM lessons WHERE key = '' OR key LIKE char(0) || '%'").run().changes;
    this.db.query("DELETE FROM lesson_notes WHERE key = '' OR key LIKE char(0) || '%'").run();
    this.setMeta('empty_lessons_dropped', 'yes');
    return n;
  }

  /**
   * True when you said an email in this conversation from this sender asks nothing of you (SCR-71:
   * keyed on sender and base subject, read and written the same way, so "Re: Re: X" matches "X").
   * Lessons taught before SCR-71 were keyed on the subject alone and still match any sender.
   */
  isNotAnActionEmail(sender: string, subject: string): boolean {
    const key = emailLessonKey(sender, subject);
    if (this.db.query("SELECT 1 FROM lesson_notes WHERE kind = 'not-an-action' AND job = 'emails' AND key = ?").get(key) !== null) return true;
    const base = key.slice(key.indexOf('\u0001') + 1);
    const legacy = this.db.query("SELECT key FROM lesson_notes WHERE kind = 'not-an-action' AND job = 'emails' AND instr(key, char(1)) = 0").all() as { key: string }[];
    return legacy.some((l) => baseSubject(l.key) === base);
  }

  /**
   * "Not an action": the task, and everything under it, was never for you. It is
   * dismissed and remembered, so the same wording is not captured again and the
   * model sees it as an example. Returns false for an unknown task.
   */
  notAnAction(id: number, now: Date = new Date()): boolean {
    const task = this.getTask(id);
    if (!task) return false;
    const steps = [task, ...this.subtree(id).map((r) => this.getTask(r.id)!)].filter((t) => !t.isGroup);
    for (const step of steps) {
      if (task.sourceKind === 'email') {
        const origin = (this.db
          .query("SELECT detail FROM evidence WHERE task_id = ? AND kind = 'origin' ORDER BY id DESC LIMIT 1")
          .get(step.id) as { detail: string } | null)?.detail ?? '';
        const subject = origin.match(/— “(.*)”$/)?.[1] ?? '';
        if (subject) this.addLesson('emails', 'not-an-action', emailLessonKey(originSender(origin), subject), `An email like ${origin.replace(/^From an email: /, 'one from ')} asked nothing of me ("${step.capturedTitle}" was not a task).`, now);
      } else if (step.criteria?.chat) {
        // A chat ask teaches the chat job, not the list judge (SCR-71).
        this.addLesson('chats', 'not-an-action', dedupeKey(step.capturedTitle), `In ${step.criteria.chat.app}, "${step.capturedTitle}" was not something asked of me.`, now);
      } else {
        this.addLesson('lists', 'not-an-action', dedupeKey(step.capturedTitle), `"${step.capturedTitle}" was not something for me to do.`, now);
      }
    }
    this.withOutcome(id, 'not-an-action', now, () => this.setStatus(id, 'dismissed', now));
    this.addNote(id, 'judged', now.toISOString(), 'Dismissed: you said this is not an action, and it was remembered');
    return true;
  }

  /**
   * "Not done": a task ticked for you because it looked done was not done.
   * It is reopened (which stops that place from ticking it again) and the model
   * is shown the case as an example. Returns false unless it was auto-accepted.
   */
  notDone(id: number, now: Date = new Date()): boolean {
    const task = this.getTask(id);
    if (!task?.acceptedFrom) return false;
    this.addLesson('looks-done', 'not-done', `${dedupeKey(task.capturedTitle)}\u0000${task.acceptedFrom}`,
      `"${task.capturedTitle}" was not done, even though ${task.acceptedFrom} seemed to show it.`, now);
    this.setStatus(id, 'open', now);
    return true;
  }

  /**
   * Tasks come only from what was sent once capture started (`meta.only_new = on`): a chat
   * message or an email dated before that is left out. A Claude reply has no date, so it is
   * always read, even when you scroll back to it. Off by default.
   */
  onlyNewMessages(): boolean {
    return this.getMeta('only_new') === 'on';
  }

  /** When capture last started (the app writes it at launch and on Resume); null if never told. */
  captureStartedAt(): Date | null {
    const raw = this.getMeta('capturing_since');
    const when = raw ? new Date(raw) : null;
    return when && !Number.isNaN(when.getTime()) ? when : null;
  }

  /**
   * When a task looks done (SCR-74): ask you ("ask"), tick it when Didja is sure ("sure", the
   * default), or accept every "looks done" ("accept"). Installs on "ask" before SCR-74 are moved to
   * "sure" once, the maintainer's call; "accept" is kept.
   */
  looksDoneMode(): 'ask' | 'sure' | 'accept' {
    const mode = this.getMeta('looks_done');
    if (this.getMeta('looks_done_sure_once') === null) {
      this.setMeta('looks_done_sure_once', 'yes');
      if (mode !== 'accept') {
        this.setMeta('looks_done', 'sure');
        return 'sure';
      }
    }
    return mode === 'accept' ? 'accept' : mode === 'ask' ? 'ask' : 'sure';
  }

  /**
   * Tick a task that looks done because Didja is sure (SCR-74): two signs agreed, or you said yes
   * there often enough. Labelled like an accepted one, so reopening it teaches and suspends the place.
   */
  tickSure(id: number, place: string, observationId: number | null, why: string, now: Date): void {
    this.db
      .query("INSERT INTO evidence (task_id, observation_id, ts, kind, detail) VALUES (?, ?, ?, 'judged', ?)")
      .run(id, observationId, now.toISOString(), `Ticked for you: it looked done in ${place}, and ${why}`);
    this.withOutcome(id, 'ticked-sure', now, () => this.setStatus(id, 'done', now));
    this.db.query('UPDATE tasks SET accepted_from = ? WHERE id = ?').run(place, id);
  }

  /**
   * Tick a task that looks done, because you chose to accept that automatically.
   * It keeps where it looked done, for its label and in case you reopen it.
   */
  acceptLooksDone(id: number, place: string, now: Date): void {
    this.withOutcome(id, 'ticked-accepted', now, () => this.setStatus(id, 'done', now));
    this.db.query('UPDATE tasks SET accepted_from = ? WHERE id = ?').run(place, id);
    this.db
      .query("INSERT INTO evidence (task_id, observation_id, ts, kind, detail) VALUES (?, NULL, ?, 'judged', ?)")
      .run(id, now.toISOString(), `Ticked for you: it looked done in ${place} (accept "looks done" automatically is on)`);
  }

  /** Open tasks marked "looks done", waiting for a yes or no. */
  tasksLookingDone(): Task[] {
    return (this.db.query(`${SELECT_TASK} WHERE t.status = 'open' AND t.suggestion IS NOT NULL ORDER BY t.id`).all() as TaskRow[]).map(toTask);
  }

  /** Mark a task as looking done. It stays open until confirmed. */
  suggestDone(id: number, place: string, observationId: number | null, now: Date): void {
    const stamp = now.toISOString();
    this.db.query('UPDATE tasks SET suggestion = ?, suggested_at = ? WHERE id = ?').run(place, stamp, id);
    this.db
      .query("INSERT INTO evidence (task_id, observation_id, ts, kind, detail) VALUES (?, ?, ?, 'suggested', ?)")
      .run(id, observationId, stamp, `Looked done in ${place}`);
    this.recordOutcome(id, 'asked', now);
  }

  /** "Not yet": drop the suggestion and do not suggest from that place again. */
  rejectSuggestion(id: number, now: Date = new Date()): boolean {
    const task = this.getTask(id);
    if (!task?.suggestion) return false;
    this.db.query('UPDATE tasks SET suggestion = NULL, suggested_at = NULL WHERE id = ?').run(id);
    this.db
      .query("INSERT INTO evidence (task_id, observation_id, ts, kind, marker, detail) VALUES (?, NULL, ?, 'rejected', ?, ?)")
      .run(id, now.toISOString(), task.suggestion, `You said it was not done yet (${task.suggestion})`);
    this.recordOutcome(id, 'not-yet', now);
    this.recordTrust(trustKey(task.suggestion, task.sourceKind, task.capturedTitle), 'no', now);
    return true;
  }

  /** Places you have said did not show this task done. */
  rejectedPlaces(id: number): Set<string> {
    const rows = this.db
      .query("SELECT marker FROM evidence WHERE task_id = ? AND kind = 'rejected'")
      .all(id) as { marker: string }[];
    return new Set(rows.map((r) => r.marker));
  }

  /** Fold a parent's children away, or show them again. */
  setCollapsed(id: number, collapsed: boolean): boolean {
    return this.db.query('UPDATE tasks SET collapsed = ? WHERE id = ?').run(collapsed ? 1 : 0, id).changes > 0;
  }

  /**
   * Top-level items left open with nothing happening for `hours`: not touched,
   * no step ticked, not snoozed, and not reminded about before. Marks them as
   * reminded, so each is returned once.
   */
  takeNudges(now: Date = new Date(), hours = 4): { id: number; title: string; source: string; left: number; total: number }[] {
    const cutoff = new Date(now.getTime() - hours * 3600_000).toISOString();
    return this.db.transaction(() => {
      const due = this.listTree().filter((node) => {
        const steps = node.children.length > 0 ? this.stepsUnder(node.task.id) : [node.task];
        const lastActivity = [node.task.createdAt, ...steps.map((s) => s.doneAt ?? '')].sort().at(-1)!;
        const nudged = this.db.query('SELECT nudged_at FROM tasks WHERE id = ?').get(node.task.id) as { nudged_at: string | null };
        // A list still being checked is not yours yet: never a nudge (SCR-78).
        if (node.task.confidence <= CHECKING_CONFIDENCE) return false;
        return nudged.nudged_at === null && lastActivity <= cutoff && steps.some((s) => s.status === 'open');
      });
      for (const node of due) this.db.query('UPDATE tasks SET nudged_at = ? WHERE id = ?').run(now.toISOString(), node.task.id);
      return due.map((node) => {
        const steps = node.children.length > 0 ? this.stepsUnder(node.task.id).filter((s) => s.status !== 'dismissed') : [node.task];
        return {
          id: node.task.id, title: node.task.title, source: node.task.sourceRef,
          left: steps.filter((s) => s.status === 'open').length, total: steps.length,
        };
      });
    })();
  }

  /** Fold every parent, or unfold them all. */
  setAllCollapsed(collapsed: boolean): number {
    return this.db.query('UPDATE tasks SET collapsed = ? WHERE is_group = 1').run(collapsed ? 1 : 0).changes;
  }

  /** The steps (not parents) under a task, at any depth. */
  stepsUnder(id: number): Task[] {
    return this.subtree(id)
      .filter((row) => row.is_group === 0 && row.id !== id)
      .map((row) => this.getTask(row.id)!)
      .filter(Boolean);
  }

  // --- evidence

  /** Record that a task's marker was seen. Each marker is recorded once per task. */
  addSighting(taskId: number, marker: string, observationId: number | null, ts: string, detail: string): boolean {
    const known = this.db
      .query("SELECT 1 FROM evidence WHERE task_id = ? AND kind = 'marker' AND marker = ?")
      .get(taskId, marker);
    if (known) return false;
    this.db
      .query("INSERT INTO evidence (task_id, observation_id, ts, kind, marker, detail) VALUES (?, ?, ?, 'marker', ?, ?)")
      .run(taskId, observationId, ts, marker, detail);
    return true;
  }

  seenMarkers(taskId: number): Set<string> {
    const rows = this.db
      .query("SELECT marker FROM evidence WHERE task_id = ? AND kind = 'marker'")
      .all(taskId) as { marker: string }[];
    return new Set(rows.map((r) => r.marker));
  }

  listEvidence(taskId: number): Evidence[] {
    const rows = this.db
      .query('SELECT task_id, observation_id, ts, kind, marker, detail FROM evidence WHERE task_id = ? ORDER BY ts, id')
      .all(taskId) as { task_id: number; observation_id: number | null; ts: string; kind: Evidence['kind']; marker: string | null; detail: string | null }[];
    return rows.map((r) => ({
      taskId: r.task_id, observationId: r.observation_id, ts: r.ts, kind: r.kind, marker: r.marker, detail: r.detail,
    }));
  }

  /** The task we hold for a title, matched the same way duplicates are. */
  /** A task by its title; with `sourceRef`, only one from that source (SCR-71). */
  findTaskByTitle(title: string, sourceRef: string | null = null): Task | null {
    const key = dedupeKey(title);
    if (key === '') return null;
    const candidates = (this.db
      .query("SELECT t.id, t.dedupe_key, s.ref FROM tasks t JOIN sources s ON s.id = t.source WHERE t.dedupe_key NOT LIKE 'group %'")
      .all() as { id: number; dedupe_key: string; ref: string }[]).filter((c) => sourceRef === null || c.ref === sourceRef);
    const match =
      candidates.find((c) => plainKey(c.dedupe_key) === key) ?? candidates.find((c) => isSameTask(plainKey(c.dedupe_key), key));
    if (match) return this.getTask(match.id);
    // A parent created as such has no matching key; find it by its captured title.
    const parent = this.db
      .query('SELECT t.id FROM tasks t JOIN sources s ON s.id = t.source WHERE t.is_group = 1 AND t.title = ? AND (?2 IS NULL OR s.ref = ?2) ORDER BY t.id DESC LIMIT 1')
      .get(title, sourceRef) as { id: number } | null;
    return parent ? this.getTask(parent.id) : null;
  }

  /** Note on a task explaining a decision the engine took about it. */
  addNote(taskId: number, kind: Evidence['kind'], ts: string, detail: string): void {
    this.db
      .query('INSERT INTO evidence (task_id, observation_id, ts, kind, detail) VALUES (?, NULL, ?, ?, ?)')
      .run(taskId, ts, kind, detail);
  }

  // --- judgements (who a list is for, when its wording does not say)

  getJudgement(key: string): 'user' | 'assistant' | null {
    const row = this.db.query('SELECT audience FROM judgements WHERE key = ?').get(key) as
      | { audience: 'user' | 'assistant' }
      | null;
    return row?.audience ?? null;
  }

  saveJudgement(key: string, audience: 'user' | 'assistant', model: string, now: Date): void {
    this.db
      .query('INSERT OR REPLACE INTO judgements (key, audience, model, created_at) VALUES (?, ?, ?, ?)')
      .run(key, audience, model, now.toISOString());
  }

  /** Queue a list for judging. A newer version of the same list replaces the older one. */
  setPendingJudgement(slot: string, key: string, payload: string, now: Date): void {
    this.db
      .query(
        `INSERT INTO pending_judgements (slot, key, payload, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(slot) DO UPDATE SET key = excluded.key, payload = excluded.payload,
           updated_at = CASE WHEN pending_judgements.key = excluded.key THEN pending_judgements.updated_at ELSE excluded.updated_at END`,
      )
      .run(slot, key, payload, now.toISOString());
  }

  /** Queued lists that have not changed since `before`, oldest first. */
  settledPendingJudgements(before: Date, limit: number): { slot: string; key: string; payload: string }[] {
    return this.db
      .query('SELECT slot, key, payload FROM pending_judgements WHERE updated_at <= ? ORDER BY updated_at LIMIT ?')
      .all(before.toISOString(), limit) as { slot: string; key: string; payload: string }[];
  }

  clearPendingJudgement(slot?: string): void {
    if (slot === undefined) this.db.exec('DELETE FROM pending_judgements');
    else this.db.query('DELETE FROM pending_judgements WHERE slot = ?').run(slot);
  }

  // --- troubleshooting (SCR-79): codes and counts only, kept 24 hours

  /** Add this pass's counts of why what was read made no task (keys are `source\treason`). */
  recordDrops(drops: Map<string, number>, now: Date): void {
    const hour = now.toISOString().slice(0, 13);
    const add = this.db.query(
      'INSERT INTO engine_drops (hour, source, reason, n) VALUES (?, ?, ?, ?) ON CONFLICT(hour, source, reason) DO UPDATE SET n = n + excluded.n',
    );
    const cutoff = new Date(now.getTime() - 24 * 3600_000).toISOString().slice(0, 13);
    this.db.transaction(() => {
      for (const [key, n] of drops) {
        const [source, reason] = key.split('\t');
        add.run(hour, source!, reason!, n);
      }
      this.db.query('DELETE FROM engine_drops WHERE hour < ?').run(cutoff);
    })();
  }

  /** Drop counts since `since` (an ISO time; counted by the hour it falls in), summed per source and reason. */
  drops(since: string): { source: string; reason: string; n: number }[] {
    return this.db
      .query('SELECT source, reason, SUM(n) AS n FROM engine_drops WHERE hour >= ? GROUP BY source, reason ORDER BY source, reason')
      .all(since.slice(0, 13)) as { source: string; reason: string; n: number }[];
  }

  /**
   * What capture did when it tried an app (the app writes these; tests and fixtures use this).
   * A repeat of the app's last result moves that row on instead of adding one. Never any text.
   */
  recordCaptureOutcome(bundleId: string, app: string, result: string, lines: number, now: Date = new Date()): void {
    const ts = now.toISOString();
    const last = this.db
      .query('SELECT id, result FROM capture_outcomes WHERE bundle_id = ? ORDER BY id DESC LIMIT 1')
      .get(bundleId) as { id: number; result: string } | null;
    if (last && last.result === result) {
      this.db.query('UPDATE capture_outcomes SET last_ts = ?, lines = ?, n = n + 1 WHERE id = ?').run(ts, lines, last.id);
      return;
    }
    this.db
      .query('INSERT INTO capture_outcomes (ts, last_ts, bundle_id, app, result, lines, n) VALUES (?, ?, ?, ?, ?, ?, 1)')
      .run(ts, ts, bundleId, app, result, lines);
    this.db.query('DELETE FROM capture_outcomes WHERE last_ts < ? OR id <= (SELECT MAX(id) FROM capture_outcomes) - 500')
      .run(new Date(now.getTime() - 24 * 3600_000).toISOString());
  }

  /** Capture's outcomes since `since`, newest first. */
  captureOutcomes(since: string): { ts: string; lastTs: string; bundleId: string; app: string; result: string; lines: number; n: number }[] {
    return this.db
      .query('SELECT ts, last_ts AS lastTs, bundle_id AS bundleId, app, result, lines, n FROM capture_outcomes WHERE last_ts >= ? ORDER BY id DESC')
      .all(since) as { ts: string; lastTs: string; bundleId: string; app: string; result: string; lines: number; n: number }[];
  }

  /**
   * The newest step or loose task from any of these source kinds (SCR-89): its kind, when it was
   * made, and how many steps its list has (1 for a loose task). Null when there is none.
   */
  newestStepFrom(kinds: string[]): { kind: string; at: string; count: number } | null {
    if (kinds.length === 0) return null;
    const row = this.db
      .query(`SELECT t.parent_id AS parent, s.kind AS kind, t.created_at AS at FROM tasks t JOIN sources s ON s.id = t.source
              WHERE t.is_group = 0 AND s.kind IN (${kinds.map(() => '?').join(', ')}) ORDER BY t.created_at DESC, t.id DESC LIMIT 1`)
      .get(...kinds) as { parent: number | null; kind: string; at: string } | null;
    if (!row) return null;
    const count = row.parent === null ? 1
      : (this.db.query('SELECT COUNT(*) AS n FROM tasks WHERE parent_id = ? AND is_group = 0').get(row.parent) as { n: number }).n;
    return { kind: row.kind, at: row.at, count };
  }

  /** How many observations each app gave since `since`. Counts only. */
  observationCountsByApp(since: string): { app: string; bundleId: string; n: number }[] {
    return this.db
      .query('SELECT app, bundle_id AS bundleId, COUNT(*) AS n FROM observations WHERE ts >= ? GROUP BY bundle_id ORDER BY n DESC')
      .all(since) as { app: string; bundleId: string; n: number }[];
  }

  /** The engine's last pass and its recent errors, for the troubleshooting report (messages only, at most 20). */
  notePass(now: Date): void {
    this.setMeta('engine_last_pass', now.toISOString());
  }

  noteEngineError(message: string, now: Date): void {
    const errors = this.engineErrors();
    errors.push({ at: now.toISOString(), message: message.slice(0, 300) });
    this.setMeta('engine_errors', JSON.stringify(errors.slice(-20)));
  }

  engineErrors(): { at: string; message: string }[] {
    try {
      const parsed = JSON.parse(this.getMeta('engine_errors') ?? '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  // --- engine state

  getMeta(key: string): string | null {
    const row = this.db.query('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | null;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .query('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }
}
