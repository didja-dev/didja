/**
 * The shell hook (SCR-87): opt-in, off by default (Settings › General › Commands, `didja shell-hook
 * on|off`). It adds a few lines to ~/.zshrc and ~/.bashrc (between marked comments) and a fish
 * function, which append one line per command you run to `shell.log` beside Didja's database:
 *
 *     <unix time> TAB <exit code> TAB <hash of the folder> TAB <command>
 *
 * A command that looks like it holds a key or a token is written as `hash:<md5>` only, so it can
 * never match or be read. The engine reads the log each pass, keeps 24 hours of it, and ticks a
 * command step only on an exact run of the same command (`sameCommand`) after the step was made
 * that ended with exit 0; a failed run never ticks, and when the log saw only failures since the
 * step, a screen that looked fine does not tick it either. Turning it off removes the lines, the
 * fish function and the log. Nothing here leaves the Mac.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sameCommand } from './terminal.ts';

export const BEGIN = '# >>> didja shell hook >>> (added by Didja, Settings › General › Commands; turn it off there to remove)';
export const END = '# <<< didja shell hook <<<';
const LOG_REL = 'Library/Application Support/Didja/shell.log';

/** What looks like a key or a token in a command line: kept as a hash only. */
export const SECRET_LIKE = '(sk_|pk_live|rk_live|ghp_|gho_|github_pat_|xox[abpr]-|AKIA|whsec_|Bearer |[Tt][Oo][Kk][Ee][Nn]=|[Ss][Ee][Cc][Rr][Ee][Tt]|[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]|_KEY=|://[^ /]*:[^ /]*@)';

/** zsh: preexec keeps the command, precmd writes it with its exit status. */
export function zshBlock(): string {
  return [
    BEGIN,
    `__didja_log="$HOME/${LOG_REL}"`,
    `__didja_secret='${SECRET_LIKE}'`,
    '__didja_preexec() { __didja_cmd="$1"; }',
    '__didja_precmd() {',
    '  local s=$?',
    '  [[ -n "$__didja_cmd" ]] || return 0',
    `  local c="\${__didja_cmd//$'\\n'/ }"; c="\${c//$'\\t'/ }"`,
    '  [[ "$c" =~ $__didja_secret ]] && c="hash:$(printf %s "$c" | /sbin/md5)"',
    `  printf '%s\\t%s\\t%s\\t%s\\n' "$(date +%s)" "$s" "$(printf %s "$PWD" | /sbin/md5)" "$c" >> "$__didja_log" 2>/dev/null`,
    '  __didja_cmd=',
    '}',
    'autoload -Uz add-zsh-hook 2>/dev/null && add-zsh-hook preexec __didja_preexec && add-zsh-hook precmd __didja_precmd',
    END,
  ].join('\n');
}

/** bash: the last history line, written once, with the exit status, from PROMPT_COMMAND. */
export function bashBlock(): string {
  return [
    BEGIN,
    `__didja_log="$HOME/${LOG_REL}"`,
    `__didja_secret='${SECRET_LIKE}'`,
    '__didja_precmd() {',
    '  local s=$?',
    `  local n c; n=$(HISTTIMEFORMAT= history 1); c=$(printf %s "$n" | sed 's/^ *[0-9]* *//')`,
    '  [[ -n "$c" && "$n" != "$__didja_last" ]] || return 0',
    '  __didja_last="$n"',
    `  c="\${c//$'\\t'/ }"`,
    '  [[ "$c" =~ $__didja_secret ]] && c="hash:$(printf %s "$c" | /sbin/md5)"',
    `  printf '%s\\t%s\\t%s\\t%s\\n' "$(date +%s)" "$s" "$(printf %s "$PWD" | /sbin/md5)" "$c" >> "$__didja_log" 2>/dev/null`,
    '  return 0',
    '}',
    'case "$PROMPT_COMMAND" in *__didja_precmd*) ;; *) PROMPT_COMMAND="__didja_precmd${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;; esac',
    END,
  ].join('\n');
}

/** fish: a function on fish_postexec, in a file of its own. */
export function fishFunction(): string {
  return [
    BEGIN,
    'function __didja_postexec --on-event fish_postexec',
    '    set -l s $status',
    `    set -l c (string join ' ' -- $argv | string replace -a \\t ' ')`,
    `    if string match -rq -- '${SECRET_LIKE}' $c`,
    '        set c hash:(printf %s $c | /sbin/md5)',
    '    end',
    `    printf '%s\\t%s\\t%s\\t%s\\n' (date +%s) $s (printf %s $PWD | /sbin/md5) $c >> "$HOME/${LOG_REL}" 2>/dev/null`,
    'end',
    END,
  ].join('\n');
}

export interface HookFiles {
  zshrc: string;
  bashrc: string;
  fish: string;
  log: string;
}

export function hookFiles(home: string = process.env.HOME ?? ''): HookFiles {
  return {
    zshrc: join(home, '.zshrc'),
    bashrc: join(home, '.bashrc'),
    fish: join(home, '.config/fish/conf.d/didja.fish'),
    log: join(home, LOG_REL),
  };
}

/** The text without our block (and the one blank line we put before it); other lines untouched. */
export function withoutBlock(text: string): string {
  const start = text.indexOf(BEGIN);
  if (start < 0) return text;
  const end = text.indexOf(END, start);
  if (end < 0) return text; // a damaged block: leave the file alone rather than guess
  let before = text.slice(0, start);
  let after = text.slice(end + END.length);
  if (after.startsWith('\n')) after = after.slice(1);
  if (before.endsWith('\n\n')) before = before.slice(0, -1);
  return before + after;
}

/** The text with our block, once, at the end; the rest exactly as it was. */
export function withBlock(text: string, block: string): string {
  const rest = withoutBlock(text);
  const sep = rest === '' ? '' : rest.endsWith('\n') ? '\n' : '\n\n';
  return `${rest}${sep}${block}\n`;
}

/**
 * Turn the hook on: ~/.zshrc (made if missing: zsh is macOS's shell), ~/.bashrc if there is one,
 * and the fish function if fish is set up. Running it twice changes nothing. Returns the files written.
 */
export function installHook(home: string = process.env.HOME ?? ''): string[] {
  const f = hookFiles(home);
  const written: string[] = [];
  const put = (path: string, block: string) => {
    const before = existsSync(path) ? readFileSync(path, 'utf8') : '';
    const after = withBlock(before, block);
    if (after !== before) writeFileSync(path, after);
    written.push(path);
  };
  put(f.zshrc, zshBlock());
  if (existsSync(f.bashrc)) put(f.bashrc, bashBlock());
  if (existsSync(join(home, '.config/fish'))) {
    mkdirSync(dirname(f.fish), { recursive: true });
    writeFileSync(f.fish, `${fishFunction()}\n`);
    written.push(f.fish);
  }
  mkdirSync(dirname(f.log), { recursive: true });
  return written;
}

/** Turn it off: our lines out of each file (nothing else), the fish function and the log gone. */
export function removeHook(home: string = process.env.HOME ?? ''): void {
  const f = hookFiles(home);
  for (const path of [f.zshrc, f.bashrc]) {
    if (!existsSync(path)) continue;
    const before = readFileSync(path, 'utf8');
    const after = withoutBlock(before);
    if (after !== before) writeFileSync(path, after);
  }
  if (existsSync(f.fish) && readFileSync(f.fish, 'utf8').includes(BEGIN)) rmSync(f.fish);
  rmSync(f.log, { force: true });
}

/** Whether our block is in ~/.zshrc. */
export function hookInstalled(home: string = process.env.HOME ?? ''): boolean {
  const f = hookFiles(home);
  return existsSync(f.zshrc) && readFileSync(f.zshrc, 'utf8').includes(BEGIN);
}

// --- The log ---------------------------------------------------------------------------------------

export interface ShellRun {
  /** Unix time in milliseconds. */
  at: number;
  exit: number;
  folder: string;
  /** The command, or `hash:…` for one that looked like it held a secret. */
  command: string;
}

const DAY_MS = 24 * 3600_000;

export function parseShellLog(text: string): ShellRun[] {
  const out: ShellRun[] = [];
  for (const line of text.split('\n')) {
    const [t, exit, folder, ...rest] = line.split('\t');
    const command = rest.join('\t').trim();
    if (!t || !/^\d+$/.test(t) || !exit || !/^\d+$/.test(exit) || !command) continue;
    out.push({ at: Number(t) * 1000, exit: Number(exit), folder: folder ?? '', command });
  }
  return out;
}

/** The runs of the last 24 hours; older lines are dropped from the file. */
export function readShellLog(path: string, now: Date): ShellRun[] {
  if (!existsSync(path)) return [];
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const runs = parseShellLog(text);
  const kept = runs.filter((r) => now.getTime() - r.at <= DAY_MS);
  if (kept.length < runs.length) {
    try {
      writeFileSync(path, kept.map((r) => `${Math.round(r.at / 1000)}\t${r.exit}\t${r.folder}\t${r.command}\n`).join(''));
    } catch {
      // Read-only or gone: try again next pass.
    }
  }
  return kept;
}

/**
 * What the log says about a command step since it was made: 'ran' (an exact run ended with exit 0),
 * 'failed' (exact runs, none ended well), or null (no exact run, or only a hashed one).
 */
export function shellOutcome(runs: ShellRun[], command: string, since: number): { outcome: 'ran' | 'failed'; run: ShellRun } | null {
  let failedRun: ShellRun | null = null;
  for (const r of runs) {
    if (r.at <= since || r.command.startsWith('hash:')) continue;
    if (!sameCommand(command, r.command)) continue;
    if (r.exit === 0) return { outcome: 'ran', run: r };
    failedRun = r;
  }
  return failedRun ? { outcome: 'failed', run: failedRun } : null;
}
