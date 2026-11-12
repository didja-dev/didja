/**
 * Canvases (SCR-49): typing a line, and the export. A canvas is kept in SQLite (schemas 019 and 020,
 * `Store.canvas`).
 *
 * A typed line is read as Markdown, so it reads the way it would in a notes app:
 *   `# Before you ship`              a heading
 *   `[] Run the migration`, `- [ ] …` a task (`[x]` one already done)
 *   `- Ask Noa first`, `* …`          a bullet note
 *   `> Downtime is 22:00`             a note
 *   anything else                     what the composer is set to: a task, or a note
 * Two leading spaces (or a tab) indent one level, up to four.
 */
import type { Canvas, CanvasItem } from './store.ts';
import { MAX_CANVAS_LEVEL } from './store.ts';

export interface CanvasLine {
  kind: 'task' | 'note' | 'heading';
  text: string;
  level: number;
  /** A task typed as `[x] …`. */
  done: boolean;
}

export function parseCanvasLine(raw: string, plain: 'task' | 'note' = 'task', baseLevel = 0): CanvasLine | null {
  const expanded = raw.replace(/\t/g, '  ').replace(/\s+$/, '');
  const indent = expanded.length - expanded.trimStart().length;
  const level = Math.min(MAX_CANVAS_LEVEL, baseLevel + Math.floor(indent / 2));
  let line = expanded.trimStart();
  if (!line) return null;
  let m: RegExpMatchArray | null;
  if ((m = line.match(/^#{1,6}\s+(.+)$/))) return { kind: 'heading', text: m[1]!.trim(), level: 0, done: false };
  if ((m = line.match(/^(?:[-*+]\s+)?\[( |x|X)?\]\s+(.+)$/))) {
    return { kind: 'task', text: m[2]!.trim(), level, done: (m[1] ?? '').toLowerCase() === 'x' };
  }
  if ((m = line.match(/^[-*+•]\s+(.+)$/))) return { kind: 'note', text: `• ${m[1]!.trim()}`, level, done: false };
  if ((m = line.match(/^>\s?(.+)$/))) return { kind: 'note', text: m[1]!.trim(), level, done: false };
  line = line.trim();
  return { kind: plain, text: line, level, done: false };
}

const pad = (item: CanvasItem) => '  '.repeat(item.level ?? 0);

export function canvasMarkdown(c: Canvas & { items: CanvasItem[] }): string {
  const out = [`# ${c.title}`, ''];
  for (const item of c.items) {
    if (item.kind === 'heading') out.push('', `## ${item.text}`, '');
    else if (item.kind === 'note') {
      const lines = item.text.split('\n');
      const bullet = lines[0]!.startsWith('• ');
      out.push(...lines.map((l, i) => pad(item) + (bullet && i === 0 ? `- ${l.slice(2)}` : l)));
      if (!bullet) out.push('');
    } else out.push(`${pad(item)}- [${item.task?.status === 'done' ? 'x' : ' '}] ${item.text}${item.task?.status === 'dismissed' ? ' (dismissed)' : ''}`);
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

export function canvasText(c: Canvas & { items: CanvasItem[] }): string {
  const out = [c.title, '='.repeat(Math.min(60, c.title.length)), ''];
  for (const item of c.items) {
    if (item.kind === 'heading') out.push('', item.text.toUpperCase());
    else if (item.kind === 'note') out.push(...item.text.split('\n').map((l) => pad(item) + l));
    else out.push(`${pad(item)}${item.task?.status === 'done' ? '✓' : '○'} ${item.text}`);
  }
  return `${out.join('\n').trim()}\n`;
}
