/**
 * The long-lived judge (SCR-77): one `Didja --judge-server` process answers every model question,
 * instead of a new process of the app per question. One JSON request per line, one reply per line.
 *
 * The model lane asks synchronously (each rule waits for its answer, as with the one-shot spawns),
 * so the requests and replies go through two named pipes read and written with blocking calls and
 * a deadline. The pipes are removed from disk as soon as both ends are open. If this process goes,
 * the server's input closes and it stops; if the server goes, its output closes and the next
 * question starts it again. When it cannot start or answer, `ask` returns undefined and the caller
 * spawns the one-shot flag as before, so what is decided never depends on the server.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { closeSync, constants, mkdtempSync, openSync, readSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface JudgeServerOptions {
  /** How long to wait for `{"ready":true}` after starting. */
  readyMs?: number;
  /** After a failed start, ask by one-shot spawns for this long before trying again. */
  retryAfterMs?: number;
  log?: (line: string) => void;
}

export class JudgeServer {
  private child: ChildProcess | null = null;
  private input = -1;
  private output = -1;
  private buffer = '';
  private nextId = 1;
  private failedAt = 0;
  /** The local model last warmed, so a change is warmed once. */
  private warmedLocal: string | null = null;
  /** How many times it was (re)started: for tests and the log. */
  starts = 0;

  constructor(private readonly command: string[], private readonly opts: JudgeServerOptions = {}) {}

  /**
   * Ask `job` (a one-shot flag without its dashes) and wait at most `timeoutMs` for the reply.
   * Undefined when the server could not be asked: the caller falls back to a one-shot spawn.
   * A server that dies mid-question is started again and asked once more.
   */
  ask(job: string, request: unknown, timeoutMs: number): unknown | undefined {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!this.ensure()) return undefined;
      const id = this.nextId++;
      const reply = this.exchange(id, job, request, timeoutMs);
      if (reply !== undefined) return reply;
      // It went away, or did not answer in time: start a fresh one for the next question.
      this.stop();
    }
    return undefined;
  }

  /** Load the local model in Ollama when it changes (nothing when it is off). */
  warm(local: string | null, timeoutMs = 30_000): void {
    if (local === null || local === this.warmedLocal) return;
    this.warmedLocal = local;
    this.ask('warm', { local: { model: local } }, timeoutMs);
  }

  running(): boolean {
    return this.child !== null && this.output >= 0;
  }

  /** Stop the server; the next question starts it again. */
  stop(): void {
    for (const fd of [this.input, this.output]) {
      if (fd >= 0) try { closeSync(fd); } catch { /* already closed */ }
    }
    this.input = this.output = -1;
    this.buffer = '';
    this.child?.kill();
    this.child = null;
    this.warmedLocal = null;
  }

  private ensure(): boolean {
    if (this.running()) return true;
    if (this.failedAt && Date.now() - this.failedAt < (this.opts.retryAfterMs ?? 60_000)) return false;
    this.starts++;
    try {
      this.start();
      const ready = this.readLine(Date.now() + (this.opts.readyMs ?? 5000));
      if (ready !== null && (JSON.parse(ready) as { ready?: boolean }).ready === true) {
        this.failedAt = 0;
        return true;
      }
    } catch {
      // Could not start, or not one of ours.
    }
    this.opts.log?.('judge server did not start; asking one question at a time');
    this.stop();
    this.failedAt = Date.now();
    return false;
  }

  private start(): void {
    const dir = mkdtempSync(join(tmpdir(), 'didja-judge-'));
    try {
      const inPath = join(dir, 'in');
      const outPath = join(dir, 'out');
      const made = Bun.spawnSync(['/usr/bin/mkfifo', '-m', '600', inPath, outPath]);
      if (made.exitCode !== 0) throw new Error('mkfifo failed');
      // Our end of its output first (no writer needed when not blocking), then its end, and the
      // same for its input. Only one writer each way, so either side going closes the pipe.
      this.output = openSync(outPath, constants.O_RDONLY | constants.O_NONBLOCK);
      const childOut = openSync(outPath, constants.O_WRONLY);
      const childIn = openSync(inPath, constants.O_RDONLY | constants.O_NONBLOCK);
      this.input = openSync(inPath, constants.O_WRONLY);
      try {
        this.child = spawn(this.command[0]!, this.command.slice(1), { stdio: [childIn, childOut, 'ignore'] });
        this.child.on('error', () => {});
      } finally {
        closeSync(childIn);
        closeSync(childOut);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private exchange(id: number, job: string, request: unknown, timeoutMs: number): unknown | undefined {
    try {
      writeSync(this.input, `${JSON.stringify({ id, job, request })}\n`);
    } catch {
      return undefined; // EPIPE: it is gone
    }
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const line = this.readLine(deadline);
      if (line === null) return undefined;
      try {
        const reply = JSON.parse(line) as { id?: number; reply?: unknown };
        if (reply.id === id) return reply.reply ?? null;
      } catch {
        // Not a reply line: skip it.
      }
    }
  }

  /** The next whole line, or null at the deadline or when the server's output closed. */
  private readLine(deadline: number): string | null {
    const chunk = Buffer.alloc(65_536);
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline >= 0) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        return line;
      }
      try {
        const n = readSync(this.output, chunk, 0, chunk.length, null);
        if (n === 0) return null; // closed
        this.buffer += chunk.subarray(0, n).toString('utf8');
        continue;
      } catch (err) {
        if ((err as { code?: string }).code !== 'EAGAIN') return null;
      }
      if (Date.now() >= deadline) return null;
      Bun.sleepSync(3);
    }
  }
}

/** One server per app binary, for this process; off with DIDJA_JUDGE_SERVER=0. */
const servers = new Map<string, JudgeServer>();

export function judgeServerFor(binary: string): JudgeServer | null {
  if (process.env.DIDJA_JUDGE_SERVER === '0') return null;
  let server = servers.get(binary);
  if (!server) servers.set(binary, (server = new JudgeServer([binary, '--judge-server'])));
  return server;
}
