/**
 * The engine's two lanes (SCR-76). `didja run` is the fast lane: it is woken by a line on its
 * standard input each time the app writes new screens, and writes what needs no model at once. It
 * starts the model lane, `didja lane`, as a child process and wakes it the same way; that one runs
 * the full pass, models and all, so a slow model never holds up a new task or a sure tick.
 */
import type { Subprocess } from 'bun';
import type { Waker } from './engine.ts';

/** How to start this same engine again: the compiled binary, or Bun with the script it runs. */
export function selfCommand(): string[] {
  return Bun.main.includes('$bunfs') ? [process.execPath] : [process.execPath, Bun.main];
}

/** Wake `waker` for every chunk read from `input` (each line the app writes); `ended` when it closes. */
export function wakeOnInput(input: ReadableStream<Uint8Array>, waker: Waker, ended: () => void = () => {}): void {
  void (async () => {
    try {
      for await (const _chunk of input) waker.wake();
    } catch {
      // A closed or broken pipe is the same as its end.
    }
    ended();
  })();
}

export interface ModelLane {
  /** Ask the model lane to look now (it goes round once more if it is busy). */
  wake(): void;
  /** True while its process is running. */
  running(): boolean;
}

/** Don't start the model lane again more often than this, if it keeps stopping. */
const RESTART_AFTER_MS = 10_000;

/**
 * Start the model lane as a child process, and start it again when it stops (on the next wake, at
 * most every ten seconds). It is stopped with `signal`, and stops by itself when this process goes,
 * because its standard input closes.
 */
export function startModelLane(signal: AbortSignal, log: (line: string) => void, command: string[] = [...selfCommand(), 'lane']): ModelLane {
  let child: Subprocess<'pipe', 'inherit', 'inherit'> | null = null;
  let started = 0;
  const spawn = () => {
    started = Date.now();
    try {
      const proc = Bun.spawn(command, { stdin: 'pipe', stdout: 'inherit', stderr: 'inherit', env: { ...process.env } });
      child = proc;
      void proc.exited.then((code) => {
        if (child === proc) child = null;
        if (!signal.aborted) log(`model lane stopped (exit ${code}); it starts again on the next wake`);
      });
    } catch (err) {
      log(`model lane could not start: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  spawn();
  signal.addEventListener('abort', () => child?.kill(), { once: true });
  return {
    wake() {
      if (signal.aborted) return;
      if (!child && Date.now() - started >= RESTART_AFTER_MS) spawn();
      if (!child) return;
      try {
        child.stdin.write('\n');
        void child.stdin.flush();
      } catch {
        // It is stopping; the next wake starts it again.
      }
    },
    running: () => child !== null,
  };
}
