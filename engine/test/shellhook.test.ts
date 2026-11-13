/**
 * SCR-87: commands you run. The opt-in shell hook (installed into a made-up home folder, never the
 * real one), its log, exact-match ticking, and outcomes read from prompts (powerlevel10k, fish).
 */
import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pollOnce } from '../src/engine.ts';
import {
  BEGIN, END, bashBlock, hookFiles, hookInstalled, installHook, parseShellLog, readShellLog, removeHook, shellOutcome, withBlock, withoutBlock, zshBlock,
} from '../src/shellhook.ts';
import { Store } from '../src/store.ts';
import { splitSession } from '../src/terminal.ts';

const homes: string[] = [];
function home(): string {
  const h = mkdtempSync(join(tmpdir(), 'didja-home-'));
  homes.push(h);
  return h;
}
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

const RC = '# my settings\nexport PATH="$HOME/bin:$PATH"\nalias gs="git status"\n';

test('turning it on adds one marked block to ~/.zshrc, and ~/.bashrc only if there is one; twice changes nothing', () => {
  const h = home();
  writeFileSync(join(h, '.zshrc'), RC);
  const first = installHook(h);
  expect(first).toEqual([join(h, '.zshrc')]);
  const zshrc = readFileSync(join(h, '.zshrc'), 'utf8');
  expect(zshrc.startsWith(RC)).toBe(true);
  expect(zshrc.split(BEGIN).length - 1).toBe(1);
  expect(zshrc).toContain(END);
  expect(existsSync(join(h, '.bashrc'))).toBe(false);
  installHook(h);
  expect(readFileSync(join(h, '.zshrc'), 'utf8')).toBe(zshrc);
  expect(hookInstalled(h)).toBe(true);

  writeFileSync(join(h, '.bashrc'), RC);
  mkdirSync(join(h, '.config/fish'), { recursive: true });
  expect(installHook(h).sort()).toEqual([join(h, '.bashrc'), join(h, '.config/fish/conf.d/didja.fish'), join(h, '.zshrc')].sort());
});

test('turning it off takes out exactly its lines, the fish function and the log; everything else is as it was', () => {
  const h = home();
  writeFileSync(join(h, '.zshrc'), RC);
  writeFileSync(join(h, '.bashrc'), RC);
  mkdirSync(join(h, '.config/fish'), { recursive: true });
  installHook(h);
  // You add a line after ours meanwhile: it stays.
  writeFileSync(join(h, '.zshrc'), `${readFileSync(join(h, '.zshrc'), 'utf8')}alias ll="ls -l"\n`);
  writeFileSync(hookFiles(h).log, '1700000000\t0\tabc\tls\n');
  removeHook(h);
  expect(readFileSync(join(h, '.zshrc'), 'utf8')).toBe(`${RC}alias ll="ls -l"\n`);
  expect(readFileSync(join(h, '.bashrc'), 'utf8')).toBe(RC);
  expect(existsSync(join(h, '.config/fish/conf.d/didja.fish'))).toBe(false);
  expect(existsSync(hookFiles(h).log)).toBe(false);
  expect(hookInstalled(h)).toBe(false);
  // A file with no final newline gets one; an empty one stays empty.
  expect(withoutBlock(withBlock('a=1', `${BEGIN}\nx\n${END}`))).toBe('a=1\n');
  expect(withoutBlock(withBlock('', `${BEGIN}\nx\n${END}`))).toBe('');
  // A damaged block (no end marker) is left alone rather than guessed at.
  expect(withoutBlock(`a\n${BEGIN}\nx\n`)).toBe(`a\n${BEGIN}\nx\n`);
});

function shellAvailable(name: string): boolean {
  return Bun.spawnSync(['/usr/bin/which', name]).exitCode === 0;
}

test('the zsh lines write the command, its exit code and a hash of the folder; a key-looking command only as a hash', () => {
  if (!shellAvailable('zsh')) return;
  const h = home();
  mkdirSync(join(h, 'Library/Application Support/Didja'), { recursive: true });
  writeFileSync(join(h, 'hook.zsh'), zshBlock());
  const script = [
    'source "$HOME/hook.zsh"',
    '__didja_preexec "npm run migrate"; true; __didja_precmd',
    '__didja_preexec "git push origin main"; false; __didja_precmd',
    '__didja_preexec "export STRIPE_SECRET_KEY=sk_test_000"; true; __didja_precmd',
  ].join('\n');
  const run = Bun.spawnSync(['zsh', '-f', '-c', script], { env: { HOME: h, PATH: '/usr/bin:/bin:/sbin' } });
  expect(run.exitCode).toBe(0);
  const runs = parseShellLog(readFileSync(hookFiles(h).log, 'utf8'));
  expect(runs.map((r) => [r.command.startsWith('hash:') ? 'hash' : r.command, r.exit])).toEqual([['npm run migrate', 0], ['git push origin main', 1], ['hash', 0]]);
  expect(runs[0]!.folder).toMatch(/^[0-9a-f]{32}$/);
  expect(readFileSync(hookFiles(h).log, 'utf8')).not.toContain('sk_test');
});

test('the bash lines do the same from the last history line', () => {
  if (!shellAvailable('bash')) return;
  const h = home();
  mkdirSync(join(h, 'Library/Application Support/Didja'), { recursive: true });
  writeFileSync(join(h, 'hook.bash'), bashBlock());
  const script = [
    'set -o history',
    'source "$HOME/hook.bash"',
    'history -s "npm test"; false; __didja_precmd',
  ].join('\n');
  const run = Bun.spawnSync(['bash', '--norc', '-c', script], { env: { HOME: h, PATH: '/usr/bin:/bin:/sbin', HISTFILE: join(h, '.hist') } });
  expect(run.exitCode).toBe(0);
  const runs = parseShellLog(readFileSync(hookFiles(h).log, 'utf8'));
  expect(runs.map((r) => [r.command, r.exit])).toEqual([['npm test', 1]]);
});

test('the log keeps 24 hours; older lines are dropped from the file', () => {
  const h = home();
  const path = join(h, 'shell.log');
  const now = new Date('2026-11-12T12:00:00Z');
  const s = (iso: string) => Math.round(Date.parse(iso) / 1000);
  writeFileSync(path, `${s('2026-11-11T10:00:00Z')}\t0\tf\told one\n${s('2026-11-12T11:00:00Z')}\t0\tf\tnpm test\nnot a line\n`);
  expect(readShellLog(path, now).map((r) => r.command)).toEqual(['npm test']);
  expect(readFileSync(path, 'utf8')).not.toContain('old one');
  expect(readShellLog(join(h, 'missing.log'), now)).toEqual([]);
});

test('an exact run after the step ended with exit 0 ran it; failures, other arguments, a hash or an earlier run do not', () => {
  const since = Date.parse('2026-11-12T10:00:00Z');
  const at = (min: number) => since + min * 60_000;
  const run = (min: number, exit: number, command: string) => ({ at: at(min), exit, folder: 'f', command });
  expect(shellOutcome([run(2, 0, 'git push -u origin main')], 'git push origin main', since)?.outcome).toBe('ran');
  expect(shellOutcome([run(2, 1, 'git push origin main')], 'git push origin main', since)?.outcome).toBe('failed');
  expect(shellOutcome([run(2, 1, 'git push origin main'), run(3, 0, 'git push origin main')], 'git push origin main', since)?.outcome).toBe('ran');
  expect(shellOutcome([run(2, 0, 'git push origin dev')], 'git push origin main', since)).toBeNull();
  expect(shellOutcome([run(2, 0, 'hash:0123')], 'git push origin main', since)).toBeNull();
  expect(shellOutcome([run(-5, 0, 'git push origin main')], 'git push origin main', since)).toBeNull();
  expect(shellOutcome([run(2, 0, 'git push --dry-run origin main')], 'git push origin main', since)).toBeNull();
});

// --- Through the engine ------------------------------------------------------------------------------

const NOW = new Date('2026-11-12T10:30:00Z');
const at = (min: number) => new Date(Date.parse('2026-11-12T10:00:00Z') + min * 60_000).toISOString();
const STEP = ['⟦Message 2⟧', 'You said: how do I apply it?', '⟦Message 3⟧', 'Claude responded: Apply the migration — run:', '`npm run migrate`'];

function withLog(lines: [number, number, string][]): { store: Store; log: string } {
  const h = home();
  const log = join(h, 'shell.log');
  const store = new Store(':memory:');
  store.insertObservation({ ts: at(0), bundleId: 'com.anthropic.claudefordesktop', app: 'Claude', windowTitle: 'Migrate', url: null, source: 'ax', text: STEP.join('\n') });
  pollOnce(store, new Date(at(0)), { shellLog: log });
  writeFileSync(log, lines.map(([min, exit, cmd]) => `${Math.round(Date.parse(at(min)) / 1000)}\t${exit}\tf\t${cmd}\n`).join(''));
  return { store, log };
}
const step = (store: Store) => store.listTasks({ all: true }).find((t) => t.title.includes('npm run migrate'))!;

test('with the hook on, an exact run with exit 0 ticks the step, with why', () => {
  const { store, log } = withLog([[3, 0, 'npm run migrate']]);
  expect(pollOnce(store, NOW, { shellLog: log }).completed).toBe(1);
  expect(step(store).status).toBe('done');
  expect(store.listEvidence(step(store).id).map((e) => e.detail).join(' ')).toContain('in your shell, exit 0');
  store.close();
});

test('a failed run, a run before the step, another command or a hashed line never ticks', () => {
  for (const lines of [[[3, 1, 'npm run migrate']], [[-2, 0, 'npm run migrate']], [[3, 0, 'npm run migrate:status']], [[3, 0, 'hash:00ff']]] as [number, number, string][][]) {
    const { store, log } = withLog(lines);
    expect(pollOnce(store, NOW, { shellLog: log }).completed).toBe(0);
    expect(step(store).status).toBe('open');
    store.close();
  }
});

test('when the hook saw the run fail, a screen where it looked fine does not tick it', () => {
  const { store, log } = withLog([[3, 1, 'npm run migrate']]);
  store.insertObservation({ ts: at(3), bundleId: 'com.apple.Terminal', app: 'Terminal', windowTitle: 'zsh', url: null, source: 'ax',
    text: 'sam@mac acme-web % npm run migrate\nMigrating…\nsam@mac acme-web % ' });
  expect(pollOnce(store, NOW, { shellLog: log }).completed).toBe(0);
  expect(step(store).status).toBe('open');
  store.close();
});

test('with the hook off, nothing is read from a log', () => {
  const { store, log } = withLog([[3, 0, 'npm run migrate']]);
  expect(pollOnce(store, NOW, { shellLog: null }).completed).toBe(0);
  expect(existsSync(log)).toBe(true);
  store.close();
});

// --- Outcomes in the prompt (no hook) ----------------------------------------------------------------

const lines = (xs: string[]) => xs.map((text, i) => ({ text, ts: new Date(Date.parse('2026-11-12T10:00:00Z') + i * 1000).toISOString(), observationId: 1 }));

test('powerlevel10k\'s "✘ 1" and fish\'s "[1]" on the next prompt mean the command before failed', () => {
  const outcome = (xs: string[]) => splitSession(lines(xs)).map((r) => [r.command, r.outcome]);
  expect(outcome(['❯ npm run migrate', 'Migrating…', '❯                                    ✘ 1  10:42:01'])).toEqual([['npm run migrate', 'failed']]);
  expect(outcome(['❯ npm run migrate', 'Migrating…', '❯                                    ✘ 127'])).toEqual([['npm run migrate', 'failed']]);
  expect(outcome(['❯ npm run migrate', 'Done.', '❯                                    ✔  10:42:01'])).toEqual([['npm run migrate', 'ok']]);
  expect(outcome(['sam@mac ~/acme-web> npm run migrate', 'Migrating…', 'sam@mac ~/acme-web [1]> '])).toEqual([['npm run migrate', 'failed']]);
  expect(outcome(['sam@mac ~/acme-web> npm run migrate', 'Done.', 'sam@mac ~/acme-web> '])).toEqual([['npm run migrate', 'ok']]);
});
