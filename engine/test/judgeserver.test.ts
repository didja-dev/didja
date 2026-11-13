/** SCR-77: the engine's side of the long-lived judge, against made-up servers (shell scripts). */
import { afterAll, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { askModel } from '../src/cli.ts';
import { JudgeServer } from '../src/judgeserver.ts';

const dir = mkdtempSync(join(tmpdir(), 'didja-judge-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function script(name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

/** Answers each request with its id and job; `extra` runs after each answer. */
const ID = `id=$(printf '%s' "$line" | sed -E 's/^[{]"id":([0-9]+).*/\\1/')`;
const JOB = `job=$(printf '%s' "$line" | sed -E 's/.*"job":"([a-z-]+)".*/\\1/')`;
const server = (extra = '', before = '') => `${before}
echo '{"ready":true}'
while IFS= read -r line; do
  ${ID}; ${JOB}
  echo 'a stray line the client must skip'
  echo "{\\"id\\":$id,\\"reply\\":{\\"available\\":true,\\"job\\":\\"$job\\",\\"n\\":$id}}"
  ${extra}
done`;

test('a server answers each question in order, by its id, skipping other lines', () => {
  const judge = new JudgeServer([script('ordered', server())]);
  try {
    expect(judge.ask('judge', { steps: ['a'] }, 3000)).toEqual({ available: true, job: 'judge', n: 1 });
    expect(judge.ask('looks-done', { text: 'b' }, 3000)).toEqual({ available: true, job: 'looks-done', n: 2 });
    expect(judge.ask('title', { steps: ['c'] }, 3000)).toEqual({ available: true, job: 'title', n: 3 });
    expect(judge.starts).toBe(1);
  } finally {
    judge.stop();
  }
});

test('a server that dies is started again, and the question is asked again', () => {
  // Answers one question, then exits: every second question finds it gone.
  const judge = new JudgeServer([script('crashing', server('exit 0'))]);
  try {
    expect(judge.ask('judge', {}, 3000)).toMatchObject({ n: 1 });
    expect(judge.ask('judge', {}, 3000)).toMatchObject({ available: true });
    expect(judge.starts).toBe(2);
  } finally {
    judge.stop();
  }
});

test('a server that never says it is ready is not used: the question goes to a one-shot spawn', () => {
  const started = performance.now();
  const judge = new JudgeServer([script('silent', 'sleep 30')], { readyMs: 300 });
  expect(judge.ask('judge', {}, 3000)).toBeUndefined();
  expect(performance.now() - started).toBeLessThan(2000);
  // Not tried again straight away.
  expect(judge.ask('judge', {}, 3000)).toBeUndefined();
  expect(judge.starts).toBe(1);
  judge.stop();
});

test('a server that does not answer in time is replaced, and the question is given up', () => {
  const judge = new JudgeServer([script('stuck', `echo '{"ready":true}'\nwhile IFS= read -r line; do sleep 30; done`)]);
  const started = performance.now();
  expect(judge.ask('judge', {}, 200)).toBeUndefined();
  expect(performance.now() - started).toBeLessThan(3000);
  judge.stop();
});

test('askModel: the server when it answers, else the one-shot flag, with the same reply', () => {
  const saved = process.env.DIDJA_JUDGE_SERVER;
  delete process.env.DIDJA_JUDGE_SERVER;
  try {
    // An app binary whose server answers, and whose one-shot flag answers differently.
    const both = script('app-both', `if [ "$1" = "--judge-server" ]; then\n${server()}\nelse cat > /dev/null; echo '{"available":true,"via":"spawn"}'; fi`);
    expect(askModel(both, 'judge', { steps: ['x'] }, 3000)).toMatchObject({ job: 'judge' });
    // An older app binary with no server: the one-shot flag, as before.
    const old = script('app-old', `if [ "$1" = "--judge-server" ]; then exit 1; fi\ncat > /dev/null; echo '{"available":true,"via":"spawn","flag":"'$1'"}'`);
    expect(askModel(old, 'looks-done', { text: 'y' }, 3000)).toEqual({ available: true, via: 'spawn', flag: '--looks-done' });
    // Turned off: always the one-shot flag.
    process.env.DIDJA_JUDGE_SERVER = '0';
    expect(askModel(both, 'judge', { steps: ['x'] }, 3000)).toEqual({ available: true, via: 'spawn' });
  } finally {
    if (saved === undefined) delete process.env.DIDJA_JUDGE_SERVER;
    else process.env.DIDJA_JUDGE_SERVER = saved;
  }
});

test('the local model is warmed once when it is first used, and again only when it changes', () => {
  const log = join(dir, 'warm.log');
  const judge = new JudgeServer([script('warming', server(`[ "$job" = "warm" ] && echo warm >> ${log}`))]);
  try {
    judge.warm(null);
    judge.warm('qwen3.8:latest');
    judge.warm('qwen3.8:latest');
    judge.warm('llama3.3:latest');
    expect(Bun.spawnSync(['cat', log]).stdout.toString().trim().split('\n')).toEqual(['warm', 'warm']);
  } finally {
    judge.stop();
  }
});
