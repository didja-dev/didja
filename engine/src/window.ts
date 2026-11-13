/**
 * One window identity for capture and the engine (SCR-72).
 *
 * Capture writes `window_key` on every observation with `Differ.windowKey` (Swift); this is the
 * same rule, used for observations written without one (tests, the benchmark, rows from before
 * schema step 24). Keep the two in step: `test/window.test.ts` and `DifferTests` check the same cases.
 *
 * A window is its app plus its page (web content, query and fragment dropped) or, with no page,
 * its title without the parts that change while it is the same window: a spinner or unread dot in
 * front ("✳ Fix auth", "⠂ Fix auth"), an unread count ("(3) Inbox", "Inbox (3)") and "— Edited".
 */
export function windowKeyFor(bundleId: string, title: string, url: string | null | undefined): string {
  if (url) {
    const page = url.split(/[?#]/)[0];
    if (page) return `${bundleId}|${page}`;
  }
  return `${bundleId}|${stableTitle(title)}`;
}

const LEADING = /^(?:\s|\([0-9]+\)|[^\p{L}\p{N}])+/u;
const TRAILING = /(?:\s*[—–-]\s*edited|\s*\([0-9]+\)|\s)+$/iu;

/** A window title without decorations that come and go: see `windowKeyFor`. */
export function stableTitle(title: string): string {
  return title.replace(LEADING, '').replace(TRAILING, '');
}
