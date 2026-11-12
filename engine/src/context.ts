/**
 * How a task looked where it was captured (SCR-31): the lines around it in the observation
 * it came from. Kept with the task while it is open (store.ts `task_context`), so you can see
 * it as it was, with what came before and after. Pure, so it can be tested.
 */

export interface ContextLine {
  text: string;
  /** The task's own line. */
  task: boolean;
}

/** Lines kept before and after the task's own line. */
export const AROUND = 3;
/** Each line is cut to this many characters. */
const MAX_LINE = 240;

/** Lowercased letters and digits in any script, single-spaced: what two lines are compared by. */
function normal(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** The capture layer's section markers (⟦Chat message: …⟧) are not screen text. */
function isMarker(line: string): boolean {
  return /^\s*⟦.*⟧\s*$/.test(line);
}

function cut(line: string): string {
  const flat = line.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_LINE ? `${flat.slice(0, MAX_LINE - 1)}…` : flat;
}

/**
 * The task's line in `text` and up to `around` non-empty lines on each side, or null when the
 * task's words are not found there (then nothing is kept: a guess would show the wrong place).
 * A line matches when it contains the task's words, or (for a title the model shortened) when
 * the task's words make up most of it.
 */
export function contextLines(text: string, title: string, around: number = AROUND): ContextLine[] | null {
  const want = normal(title.replace(/`/g, ''));
  if (want.length < 3) return null;
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '' && !isMarker(l));
  let at = lines.findIndex((l) => normal(l).includes(want));
  if (at === -1) {
    const words = new Set(want.split(' ').filter((w) => w.length > 2));
    if (words.size < 2) return null;
    let best = 0;
    lines.forEach((l, i) => {
      const have = new Set(normal(l).split(' '));
      const shared = [...words].filter((w) => have.has(w)).length / words.size;
      if (shared > best) {
        best = shared;
        at = i;
      }
    });
    if (best < 0.75) return null;
  }
  return lines
    .slice(Math.max(0, at - around), at + around + 1)
    .map((l, i) => ({ text: cut(l), task: i === Math.min(at, around) }));
}
