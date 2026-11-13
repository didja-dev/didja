/**
 * Terminals (SCR-69): a scrollback read as prompts, commands, their output and how each ended, and
 * whether a command run is the one a task asks for. Pure functions; `match.ts` uses them to tick
 * command steps, and `engine.ts` to decide which terminal screens "looks done?" may see.
 *
 * Prompts this knows (made-up examples):
 *   zsh            me@mac acme-web % git push origin main
 *   oh-my-zsh      ➜  acme-web git:(main) ✗ git push origin main
 *   starship-like  ❯ git push origin main          (the line above holds the path and branch)
 *   bash           sam@host:~/acme-web$ git push origin main   ·   bash-5.2$ make
 *   fish           sam@host ~/acme-web> git push origin main
 * A right-side prompt (zsh RPROMPT: a time, ✔ / ✘, "took 3s") after the command is not part of it,
 * and neither is a trailing # comment.
 */

/** One line of a terminal window, with when it was seen. */
export interface TerminalLine { text: string; ts: string; observationId: number }

/** What a shell prompt ends with, just before the typed command. */
const PROMPT_CHARS = '%$❯➜>#›»';
/** oh-my-zsh's default theme: arrow, folder, git branch, a ✗ when the tree is dirty (not a failure). */
const OH_MY_ZSH = /^(➜\s+\S+(?:\s+git:\([^)]*\))?(?:\s+✗)?)(?:\s+(.*))?$/;
/** A prompt: up to 80 characters of anything, then a prompt character, then a space or the end. */
const GENERAL = new RegExp(`^(.{0,80}?[${PROMPT_CHARS}])(?:\\s+(.*))?$`);
/** What a right-side prompt holds: times, durations, status marks, a branch, an exit code. */
const RPROMPT_PART = /^(?:\d{1,2}:\d{2}(?::\d{2})?(?:[AP]M)?|[AP]M|took|at|\d+(?:\.\d+)?(?:ms|s|m)|[✔✘✗✓]|\[\d+\]|\(\d+\)|git:\([^)]*\)|[\w.-]+@[\w.-]+)$/i;

/**
 * The command typed on a prompt line, the prompt before it, and a right-side prompt after it (which
 * shows how the command before ended: "✘ 1"); null when the line is not a prompt.
 */
export function parsePrompt(line: string): { prompt: string; command: string; right: string } | null {
  const text = line.replace(/\s+$/, '');
  if (text.trim() === '') return null;
  const lead = text.trimStart();
  const m = OH_MY_ZSH.exec(lead) ?? GENERAL.exec(lead);
  if (!m) return null;
  const prompt = m[1]!.replace(/\s+/g, ' ').trim();
  // The prompt itself has no sentence in it: a line of output that happens to hold "$ " or "> ".
  if (/[.!?,;]\s|\b(the|and|then|run|please|you)\b/i.test(prompt)) return null;
  const rest = m[2] ?? '';
  // Nothing typed, only a right-side prompt (powerlevel10k's "✘ 1  10:42:01" after a failure, SCR-87).
  if (onlyRightPrompt(rest)) return { prompt, command: '', right: rest.replace(/\s+/g, ' ').trim() };
  const gap = /\s{3,}(\S.*)$/.exec(rest);
  const right = gap && rightPrompt(gap[1]!) ? gap[1]!.replace(/\s+/g, ' ').trim() : '';
  return { prompt, command: cleanCommand(rest), right };
}

/** Whether text is a right-side prompt: times, durations, status marks, an exit code. */
function rightPrompt(text: string): boolean {
  // powerlevel10k writes the exit code after the mark: "✘ 1", "✘ 127".
  const parts = text.trim().replace(/([✘✗])\s*\d{1,3}\b/g, '$1').split(/\s+/);
  return text.length <= 40 && parts.every((part) => RPROMPT_PART.test(part));
}

/** A line's text after the prompt that is only a right-side prompt with a status or a time in it. */
function onlyRightPrompt(text: string): boolean {
  return text.trim() !== '' && rightPrompt(text.trim()) && /[✔✘✗✓]|\[\s*\d+\s*\]|\d{1,2}:\d{2}/.test(text);
}

/** A typed command without a right-side prompt or a trailing comment, its spaces squashed. */
export function cleanCommand(raw: string): string {
  let text = raw;
  // A right-side prompt is set off by three or more spaces at the end of the line.
  const gap = /\s{3,}(\S.*)$/.exec(text);
  if (gap && gap[1]!.split(/\s+/).every((part) => RPROMPT_PART.test(part)) && gap[1]!.length <= 40) {
    text = text.slice(0, gap.index);
  }
  text = stripComment(text);
  return text.replace(/\s+/g, ' ').trim();
}

/** Text before an unquoted " #": a shell comment. */
function stripComment(text: string): string {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '#' && i > 0 && /\s/.test(text[i - 1]!)) {
      return text.slice(0, i);
    }
  }
  return text;
}

/** A prompt without what changes between runs (times, exit marks, codes), so the next prompt is recognised. */
export function promptCore(prompt: string): string {
  return prompt
    // fish's "~/acme-web [1]>" after a failure is the same prompt as "~/acme-web>" (SCR-87).
    .replace(/\s*\[\s*\d+\s*\](?=[%$❯➜>#›»]$)/, '')
    .replace(/\d{1,2}:\d{2}(:\d{2})?(\s?[AP]M)?/gi, ' ')
    .replace(/[✔✘✓]|\[\s*\d+\s*\]|\(\s*\d+\s*\)|\bexit \d+\b/g, ' ')
    // oh-my-zsh: the ✗ after the branch says the tree is dirty, which changes as you work.
    .replace(/(git:\([^)]*\))\s*✗/g, '$1')
    .replace(/^✗\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Flags that make a command do nothing (or only print): an extra one of these is not the command. */
const NO_EFFECT_FLAGS = new Set(['--dry-run', '-n', '--help', '-h', '--version', '-V', '--check', '--noop', '--no-op',
  '--simulate', '--what-if', '--whatif', '--list', '--print', '--plan', '--preview', '--diff']);

function tokens(command: string): string[] {
  const out: string[] = [];
  for (const m of command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3]!);
  return out;
}

function shape(command: string): { args: string[]; flags: Set<string> } {
  const args: string[] = [];
  const flags = new Set<string>();
  let rest = false;
  for (const [i, raw] of tokens(command).entries()) {
    let t = raw;
    if (i === 0) t = t.replace(/^\.\//, '');
    if (rest || !t.startsWith('-') || t === '-') {
      args.push(t.replace(/\/+$/, '') || t);
    } else if (t === '--') {
      rest = true;
    } else if (/^-[A-Za-z]{2,3}$/.test(t)) {
      for (const c of t.slice(1)) flags.add(`-${c}`); // -am is -a -m
    } else {
      flags.add(t);
    }
  }
  return { args, flags };
}

/**
 * Whether a command that was run is the one a task asks for (SCR-69): the same program,
 * subcommand and arguments (branch, path, package) in the same order, every flag the task gives,
 * in any order, and no extra flag that makes it a dry run or a help page. `git push -u origin main`
 * is `git push origin main`; `git push origin dev`, `git push --dry-run origin main` and
 * `git push origin main extra` are not.
 */
export function sameCommand(wanted: string, ran: string): boolean {
  const a = wanted.replace(/\s+/g, ' ').trim();
  const b = ran.replace(/\s+/g, ' ').trim();
  if (a === '' || b === '') return false;
  if (a === b) return true;
  const want = shape(a);
  const got = shape(b);
  if (want.args.length !== got.args.length || want.args.some((x, i) => x !== got.args[i])) return false;
  if ([...want.flags].some((f) => !got.flags.has(f))) return false;
  return ![...got.flags].some((f) => !want.flags.has(f) && NO_EFFECT_FLAGS.has(f.split('=')[0]!));
}

/** How long after a command its output or the next prompt may show up and still count (SCR-61). */
export const RUN_WINDOW_MS = 5 * 60_000;

/**
 * Output that says a command failed (SCR-61). Any of these between a command and the next prompt
 * means it did not get done: no tick, no "looks done?". Shells, git, npm/bun/yarn/pnpm, gh,
 * docker, xcodebuild, wrangler, curl, test runners.
 */
export const FAILURE_LINES: RegExp[] = [
  /^\s*(error|fatal|err!?)\b\s*[:!\]]/i, // error: …, fatal: …, ERR! …, error] …
  /^\s*error\s+\S/i, // yarn: error Command failed …
  /\bnpm (ERR!|error\b)/i,
  /\bcommand not found\b|: not found\s*$|\bno such file or directory\b|\bpermission denied\b/i,
  /^\s*(zsh|bash|sh|fish):\s/i, // the shell itself complaining
  /\*\* (BUILD|TEST|ARCHIVE|ANALYZE) FAILED \*\*/,
  /\bHTTP\/[\d.]+\s+[45]\d\d\b|\(HTTP [45]\d\d\)|\bHTTP [45]\d\d\b/,
  /^\s*curl: \(\d+\)/,
  /\[(remote )?rejected\]|\berror: failed to push\b/i,
  /\[ERROR\]|^\s*✘|^\s*✗/,
  /^\s*Error\b/,
  /\bexit(ed)? (with )?(code|status):? *[1-9]\d*\b/i,
  /(^|\s)[1-9]\d* (fail|failed|failing|failures?|errors?)\b/i,
  /^\s*FAIL\s/,
  /\bTraceback \(most recent call last\)/,
  /\bpanic:|\bSegmentation fault\b|\bAborted\b/,
];

/** A prompt that shows the last command's exit status as non-zero: ✘, ✗, [1], "exit 1". */
const FAILED_PROMPT = /✘|✗|\[\s*[1-9]\d*\s*\]|\bexit [1-9]\d*\b/;

export function failed(line: string): boolean {
  return FAILURE_LINES.some((re) => re.test(line));
}

/** Whether a prompt line says the command before it failed. oh-my-zsh's dirty-tree ✗ does not. */
function promptSaysFailed(prompt: string): boolean {
  return FAILED_PROMPT.test(prompt.replace(/(git:\([^)]*\))\s*✗/g, '$1'));
}

/** Whether the next prompt, left or right side, says the command before it failed. */
function nextSaysFailed(p: { prompt: string; right: string }): boolean {
  return promptSaysFailed(p.prompt) || (p.right !== '' && FAILED_PROMPT.test(p.right));
}

/** One command typed at a prompt, what followed it, and how it ended. */
export interface CommandRun {
  command: string;
  prompt: string;
  line: TerminalLine;
  output: TerminalLine[];
  /** 'ok' when output or a new prompt followed and nothing failed; 'failed'; 'typed' when nothing followed (yet). */
  outcome: 'ok' | 'failed' | 'typed';
  /** The line that settles it: the next prompt, the last output, or the command itself. */
  evidence: TerminalLine;
}

/** A scrollback split into the commands typed in it, each with its output and outcome. */
export function splitSession(lines: TerminalLine[]): CommandRun[] {
  const runs: CommandRun[] = [];
  for (let i = 0; i < lines.length; i++) {
    const parsed = parsePrompt(lines[i]!.text);
    if (!parsed || parsed.command === '') continue;
    const core = promptCore(parsed.prompt);
    if (core === '') continue;
    const start = Date.parse(lines[i]!.ts);
    const after = lines.slice(i + 1).filter((l) => Date.parse(l.ts) - start <= RUN_WINDOW_MS && l.text.trim() !== '');
    // The next prompt: a line with the same prompt (a status mark or time may differ).
    const next = after.findIndex((l) => {
      const p = parsePrompt(l.text);
      return p !== null && promptCore(p.prompt) === core;
    });
    const output = next === -1 ? after : after.slice(0, next);
    let outcome: CommandRun['outcome'];
    if (after.length === 0) outcome = 'typed';
    else if (output.some((l) => failed(l.text)) || (next !== -1 && nextSaysFailed(parsePrompt(after[next]!.text)!))) outcome = 'failed';
    else outcome = 'ok';
    const evidence = after[next === -1 ? after.length - 1 : next] ?? lines[i]!;
    runs.push({ command: parsed.command, prompt: parsed.prompt, line: lines[i]!, output, outcome, evidence });
  }
  return runs;
}

/** A run written as a section, for reading: "⟦Command: git push origin main — ok⟧". */
export function sectionOf(run: CommandRun): string {
  return `⟦Command: ${run.command} — ${run.outcome === 'typed' ? 'unknown' : run.outcome}⟧`;
}

/** Editors whose built-in terminal capture marks as `⟦Terminal⟧` while it has focus (SCR-69). */
export const EDITOR_TERMINAL_SECTION = '⟦Terminal⟧';

/**
 * The lines of an observation that are a terminal's: all of them in a terminal app, and in an
 * editor only those under a `⟦Terminal⟧` section line (up to the next section line).
 */
export function terminalLines(text: string, isEditor: boolean): string[] {
  const lines = text.split(/\r?\n/);
  if (!isEditor) return lines;
  const out: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (/^⟦.*⟧$/.test(line)) {
      inside = line === EDITOR_TERMINAL_SECTION;
      continue;
    }
    if (inside) out.push(line);
  }
  return out;
}
