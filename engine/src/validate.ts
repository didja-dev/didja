/**
 * Every field a model answers, checked before the engine uses it (SCR-102). A small model fails
 * mostly on the shape of its answer, not on reading: an enum it made up, a name that is not in what
 * it was shown, a title that runs to three lines. A field that does not pass is turned into the
 * answer that does the least: "unsure" (which asks, never ticks), no verdict, or the field left out.
 * A validator never turns an answer into one that ticks.
 *
 * The answer types themselves (the app's `@Generable` structs) are kept flat: strings, booleans,
 * lists of strings and string enums, no nested types (checked by test/validate.test.ts).
 */

/** The value when it is one of `allowed`; otherwise `fallback`. */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Who a list is for: only "user" or "assistant"; anything else is no verdict (the list waits). */
export function validAudience(value: unknown): 'user' | 'assistant' | null {
  return value === 'user' || value === 'assistant' ? value : null;
}

/** "Looks done?": only "done" or "notDone" count; anything else is "unsure". */
export function validSeen(value: unknown): 'done' | 'notDone' | 'unsure' {
  return oneOf(value, ['done', 'notDone', 'unsure'] as const, 'unsure');
}

/** Your reply to a chat ask: only "settles" or "defers" count; anything else is "unsure" (asks you). */
export function validReplyVerdict(value: unknown): 'settles' | 'defers' | 'unsure' {
  return oneOf(value, ['settles', 'defers', 'unsure'] as const, 'unsure');
}

/** What an email needs: "reply" or "action"; anything else is "none" (no task). */
export function validNeed(value: unknown): 'reply' | 'action' | 'none' {
  return oneOf(value, ['reply', 'action', 'none'] as const, 'none');
}

/** A chat answer: it asks only on a literal `true`; the task is text or nothing. */
export function validChatAnswer(reply: { asks?: unknown; task?: unknown }): { asks: boolean; task: string } {
  return { asks: reply.asks === true, task: typeof reply.task === 'string' ? reply.task : '' };
}

/** A title: one line of text, or null. */
export function validTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const line = value.split(/\r?\n/)[0]!.trim();
  return line.length > 0 ? line : null;
}

/** A calendar day, "YYYY-MM-DD", that exists; anything else is no date. */
export function validDay(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? value : null;
}

const squash = (t: string) => t.toLowerCase().replace(/[\s"“”'‘’]+/g, ' ');

/**
 * A name the model gave, kept only when it is in what the model was shown (or one of your names):
 * its first word, as a word. A name it made up is left out, never written into a title or a note.
 */
export function namedIn(name: unknown, shown: string, yours: string[] = []): string | undefined {
  if (typeof name !== 'string') return undefined;
  const clean = name.replace(/\s+/g, ' ').trim();
  const first = clean.split(' ')[0] ?? '';
  if (first.replace(/[^\p{L}\p{N}]/gu, '').length < 2) return undefined;
  const escaped = squash(first).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const word = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u');
  const haystack = squash([shown, ...yours].join('\n'));
  return word.test(haystack) ? clean : undefined;
}

/** The strings in a list answer, or none when it is not a list. */
export function validStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}
