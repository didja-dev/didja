/**
 * Export All Tasks (SCR-114): every task, in a file you keep, readable without Didja.
 *
 * Markdown to read, JSON to import elsewhere. What goes in: each task's title, status, where it came
 * from (source kind and name), its dates and why it is there, as `didja why` says it. What does not,
 * unless you ask for it (`context`): the few lines kept with an open task (SCR-31), which are screen
 * text. Observations, evidence rows, lessons and logs are never exported. Nothing is sent anywhere:
 * the engine prints the export, and the app or you write it to a file.
 */
import { formatWhy } from './cli.ts';
import type { Store, Task, TaskStatus } from './store.ts';

/** Bumped only when a field changes meaning or goes away; new fields may be added without it. */
export const EXPORT_FORMAT = 1;

export interface ExportedTask {
  id: number;
  title: string;
  /** The words it was captured with, when you renamed it or the model titled it. */
  capturedTitle: string | null;
  status: TaskStatus;
  /** A checklist (the parent of steps) rather than a single task. */
  checklist: boolean;
  /** The checklist this step belongs to. */
  parentId: number | null;
  source: { kind: string; name: string };
  createdAt: string;
  lastSeenAt: string;
  doneAt: string | null;
  snoozedUntil: string | null;
  dueAt: string | null;
  /** Why it is there and what would tick it, as `didja why` shows it (its first two lines left out). */
  why: string;
  /** How it looked where it was captured: only with `context`, only while the task is open. */
  context?: { app: string; window: string; url: string | null; capturedAt: string; lines: string[] } | null;
}

export interface TaskExport {
  app: 'Didja';
  format: number;
  exportedAt: string;
  withContext: boolean;
  tasks: ExportedTask[];
}

/** Every task (dismissed ones too), in the order they were made. */
export function exportTasks(store: Store, opts: { context?: boolean; now?: Date } = {}): TaskExport {
  const withContext = opts.context === true;
  // With `all`, the tree holds every task once: checklists, their steps and dismissed ones.
  const all = store.listTree({ all: true }).flatMap(function walk(node): Task[] {
    return [node.task, ...node.children.flatMap(walk)];
  });
  const tasks = all
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id)
    .map((t): ExportedTask => {
      const out: ExportedTask = {
        id: t.id,
        title: t.title,
        capturedTitle: t.renamed || t.modelTitled ? t.capturedTitle : null,
        status: t.status,
        checklist: t.isGroup,
        parentId: t.parentId,
        source: { kind: t.sourceKind, name: t.sourceRef },
        createdAt: t.createdAt,
        lastSeenAt: t.lastSeenAt,
        doneAt: t.doneAt,
        snoozedUntil: t.snoozedUntil,
        dueAt: t.dueAt ?? null,
        why: whyOf(store, t),
      };
      if (withContext) {
        const c = t.status === 'open' || t.status === 'snoozed' ? store.context(t.id) : null;
        out.context = c ? { app: c.app, window: c.window, url: c.url, capturedAt: c.capturedAt, lines: c.lines.map((l) => l.text) } : null;
      }
      return out;
    });
  return { app: 'Didja', format: EXPORT_FORMAT, exportedAt: (opts.now ?? new Date()).toISOString(), withContext, tasks };
}

function whyOf(store: Store, t: Task): string {
  return formatWhy(t, store.listEvidence(t.id), store.modelCriteria(t.id))
    .split('\n')
    .slice(2)
    .map((l) => l.replace(/^ {2}/, ''))
    .join('\n')
    .trim();
}

export function exportJson(data: TaskExport): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

const HEADINGS: [TaskStatus, string][] = [['open', 'Open'], ['snoozed', 'Snoozed'], ['done', 'Done'], ['dismissed', 'Dismissed']];

/** The same tasks to read: by status, then by where they came from, steps under their checklist. */
export function exportMarkdown(data: TaskExport): string {
  const out = ['# Didja tasks', '', `Exported ${data.exportedAt}. ${data.tasks.length} task${data.tasks.length === 1 ? '' : 's'}.`];
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  // A step goes under its checklist; a step whose checklist is in another section stands alone.
  for (const [status, heading] of HEADINGS) {
    const top = data.tasks.filter((t) => t.status === status && !(t.parentId !== null && byId.get(t.parentId)?.status === status));
    if (top.length === 0) continue;
    out.push('', `## ${heading}`);
    const sources = [...new Set(top.map((t) => t.source.name))];
    for (const source of sources) {
      out.push('', `### ${source}`, '');
      for (const t of top.filter((x) => x.source.name === source)) {
        out.push(...item(t, ''));
        for (const step of data.tasks.filter((s) => s.parentId === t.id && s.status === status)) out.push(...item(step, '  '));
      }
    }
  }
  return `${out.join('\n')}\n`;
}

function item(t: ExportedTask, pad: string): string[] {
  const box = t.status === 'done' ? '[x]' : '[ ]';
  const dates = [`made ${day(t.createdAt)}`];
  if (t.doneAt) dates.push(`done ${day(t.doneAt)}`);
  if (t.dueAt) dates.push(`due ${t.dueAt}`);
  if (t.snoozedUntil && t.status === 'snoozed') dates.push(`until ${day(t.snoozedUntil)}`);
  const lines = [`${pad}- ${box} ${t.title}${t.status === 'dismissed' ? ' (dismissed)' : ''} — ${dates.join(', ')} · ${t.source.kind}`];
  if (t.capturedTitle) lines.push(`${pad}  Captured as: “${t.capturedTitle}”`);
  for (const w of t.why.split('\n').filter(Boolean)) lines.push(`${pad}  ${w.trim()}`);
  if (t.context) {
    lines.push(`${pad}  How it looked (${t.context.app} — ${t.context.window}):`);
    for (const l of t.context.lines) lines.push(`${pad}  > ${l}`);
  }
  return lines;
}

function day(iso: string): string {
  return iso.slice(0, 10);
}
