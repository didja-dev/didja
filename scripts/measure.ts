/**
 * Measures what Didja costs this Mac while it runs (SCR-110): CPU (median and p95 over the
 * period), energy impact (macOS's own "Energy Impact" number, from `top`'s POWER column, which needs
 * no root), resident memory of the app and the engine, and how fast the database and logs grow.
 *
 *   bun scripts/measure.ts                 # 10 minutes, a sample every 5 s
 *   bun scripts/measure.ts --hour          # a full hour
 *   bun scripts/measure.ts --minutes 3 --every 2
 *
 * It only watches: process statistics (`ps`, `top`) and file sizes in Didja's folder. It never
 * reads the database or the logs, never opens a window, moves the pointer or scrolls. So it
 * measures Didja as it runs on whatever this Mac shows during the period: say what was on screen
 * when you publish the numbers. Prints a Markdown block to paste into docs/PERFORMANCE.md.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** `ps -o time=` for cumulative CPU: "0:01.23", "12:34.56", "1:02:03.45" or "1-02:03:04". Seconds. */
export function parseCpuTime(text: string): number {
  const t = text.trim();
  const [days, rest] = t.includes('-') ? [Number(t.split('-')[0]), t.split('-')[1]!] : [0, t];
  const parts = rest.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return NaN;
  const secs = parts.reduce((acc, n) => acc * 60 + n, 0);
  return days * 86_400 + secs;
}

/** The p-th percentile (0–100) by nearest rank; NaN for none. */
export function percentile(values: number[], p: number): number {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  const rank = Math.min(v.length, Math.max(1, Math.ceil((p / 100) * v.length)));
  return v[rank - 1]!;
}

/** CPU % for each interval from cumulative CPU seconds and wall-clock seconds (100% = one core). */
export function cpuPercents(samples: { wall: number; cpu: number }[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const dw = samples[i]!.wall - samples[i - 1]!.wall;
    const dc = samples[i]!.cpu - samples[i - 1]!.cpu;
    if (dw > 0 && dc >= 0) out.push((dc / dw) * 100);
  }
  return out;
}

/** Bytes an hour, from a size at the start and the end of `minutes`. */
export const perHour = (start: number, end: number, minutes: number) => (minutes > 0 ? ((end - start) * 60) / minutes : NaN);

export function bytes(n: number): string {
  if (!Number.isFinite(n)) return '–';
  const sign = n < 0 ? '−' : '';
  const a = Math.abs(n);
  if (a < 1024) return `${sign}${Math.round(a)} B`;
  if (a < 1024 ** 2) return `${sign}${(a / 1024).toFixed(1)} KB`;
  if (a < 1024 ** 3) return `${sign}${(a / 1024 ** 2).toFixed(1)} MB`;
  return `${sign}${(a / 1024 ** 3).toFixed(2)} GB`;
}

export interface Result {
  minutes: number;
  machine: string;
  app: { cpu: number[]; power: number[]; rssKb: number[] };
  engine: { cpu: number[]; power: number[]; rssKb: number[] };
  db: { start: number; end: number };
  logs: { start: number; end: number };
}

/** The largest finite value, or NaN. */
export const peak = (values: number[]) => {
  const v = values.filter(Number.isFinite);
  return v.length ? Math.max(...v) : NaN;
};

const fixed = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '–');

/** The Markdown block for docs/PERFORMANCE.md and the README. */
export function report(r: Result): string {
  const row = (name: string, p: Result['app']) =>
    `| ${name} | ${fixed(percentile(p.cpu, 50))}% | ${fixed(percentile(p.cpu, 95))}% | ${fixed(percentile(p.power, 50))} | ${fixed(percentile(p.power, 95))} | ${bytes(percentile(p.rssKb, 50) * 1024)} | ${bytes(peak(p.rssKb) * 1024)} |`;
  return [
    `Measured for ${r.minutes} min on ${r.machine}.`,
    '',
    '| Process | CPU median | CPU p95 | Energy impact median | Energy impact p95 | Memory median | Memory peak |',
    '|---|---|---|---|---|---|---|',
    row('App (capture, Quick View, model judge)', r.app),
    row('Engine (`didja run`, `didja lane`)', r.engine),
    '',
    `Database (didja.db with its WAL): ${bytes(r.db.end)}, growing ${bytes(perHour(r.db.start, r.db.end, r.minutes))} an hour. Logs: ${bytes(r.logs.end)}, growing ${bytes(perHour(r.logs.start, r.logs.end, r.minutes))} an hour.`,
    '',
    'CPU is a share of one core (100% = one core busy), from `ps` cumulative CPU time over each interval. Energy impact is the number Activity Monitor shows, from `top`. Memory is resident memory.',
  ].join('\n');
}

// --- Watching the running app -------------------------------------------------------------------

const run = (cmd: string, args: string[]) => spawnSync(cmd, args, { encoding: 'utf8' }).stdout ?? '';

/** Didja's processes: the app binary (including its judge server) and the engine helper. */
function pids(): { app: number[]; engine: number[] } {
  const app: number[] = [], engine: number[] = [];
  for (const line of run('ps', ['-axo', 'pid=,command=']).split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.*)$/);
    if (!m) continue;
    if (/Didja\.app\/Contents\/MacOS\/Didja(\s|$)/.test(m[2]!)) app.push(Number(m[1]));
    else if (/Didja\.app\/Contents\/Helpers\/didja(\s|$)/.test(m[2]!)) engine.push(Number(m[1]));
  }
  return { app, engine };
}

function cpuSeconds(list: number[]): { cpu: number; rssKb: number } {
  if (list.length === 0) return { cpu: NaN, rssKb: NaN };
  let cpu = 0, rss = 0;
  for (const line of run('ps', ['-o', 'time=,rss=', '-p', list.join(',')]).split('\n')) {
    const [time, kb] = line.trim().split(/\s+/);
    if (!time) continue;
    cpu += parseCpuTime(time);
    rss += Number(kb);
  }
  return { cpu, rssKb: rss };
}

/** Energy impact by pid: `top`'s second sample (the first has no history). */
function power(list: number[]): Map<number, number> {
  const out = new Map<number, number>();
  if (list.length === 0) return out;
  const text = run('top', ['-l', '2', '-s', '1', '-stats', 'pid,power', ...list.flatMap((p) => ['-pid', String(p)])]);
  const second = text.split(/^PID\s+POWER\s*$/m).at(-1) ?? '';
  for (const line of second.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+([\d.]+)/);
    if (m) out.set(Number(m[1]), Number(m[2]));
  }
  return out;
}

function sizes(dir: string): { db: number; logs: number } {
  const size = (f: string) => (existsSync(join(dir, f)) ? statSync(join(dir, f)).size : 0);
  return {
    db: ['didja.db', 'didja.db-wal', 'didja.db-shm'].reduce((n, f) => n + size(f), 0),
    logs: ['shell.log', 'agent-hooks.jsonl', 'mcp-log.jsonl'].reduce((n, f) => n + size(f), 0),
  };
}

function machine(): string {
  const chip = run('sysctl', ['-n', 'machdep.cpu.brand_string']).trim();
  const gb = Math.round(Number(run('sysctl', ['-n', 'hw.memsize']).trim()) / 1024 ** 3);
  const os = run('sw_vers', ['-productVersion']).trim();
  return `${chip || 'a Mac'}, ${gb} GB, macOS ${os}`;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const value = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? Number(args[i + 1]) : undefined; };
  const minutes = args.includes('--hour') ? 60 : value('--minutes') ?? 10;
  const every = value('--every') ?? 5;
  if (!(minutes > 0) || !(every >= 2)) {
    console.error('usage: bun scripts/measure.ts [--hour | --minutes <n>] [--every <seconds, 2 or more>]');
    return 1;
  }
  const dir = process.env.DIDJA_DB ? join(process.env.DIDJA_DB, '..') : join(homedir(), 'Library/Application Support/Didja');
  const start = pids();
  if (start.app.length === 0 && start.engine.length === 0) {
    console.error('Didja is not running.');
    return 1;
  }
  const first = sizes(dir);
  const series = { app: [] as { wall: number; cpu: number }[], engine: [] as { wall: number; cpu: number }[] };
  const result: Result = { minutes, machine: machine(), app: { cpu: [], power: [], rssKb: [] }, engine: { cpu: [], power: [], rssKb: [] }, db: { start: first.db, end: first.db }, logs: { start: first.logs, end: first.logs } };
  const end = Date.now() + minutes * 60_000;
  console.error(`Measuring Didja for ${minutes} min, every ${every} s…`);
  while (Date.now() < end) {
    const now = pids(); // a restarted engine or judge server is picked up
    const watts = power([...now.app, ...now.engine]);
    for (const kind of ['app', 'engine'] as const) {
      const s = cpuSeconds(now[kind]);
      series[kind].push({ wall: Date.now() / 1000, cpu: s.cpu });
      result[kind].rssKb.push(s.rssKb);
      result[kind].power.push(now[kind].reduce((n, p) => n + (watts.get(p) ?? 0), 0));
    }
    await Bun.sleep(Math.max(0, every * 1000 - 1000));
  }
  for (const kind of ['app', 'engine'] as const) result[kind].cpu = cpuPercents(series[kind]);
  const last = sizes(dir);
  result.db.end = last.db;
  result.logs.end = last.logs;
  console.log(report(result));
  return 0;
}

if (import.meta.main) process.exit(await main());
