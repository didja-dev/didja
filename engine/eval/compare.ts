/**
 * Tries a proposal from Propose Upstream… (SCR-42) against the built-in instructions, on the
 * made-up samples for its job, through the built app's on-device model. A proposal is taken only if
 * it gets more right and makes no new wrong ticks. Needs Apple Intelligence, so it is not part of
 * `bun test`; the maintainers run it when reviewing a proposal.
 *
 *   bun eval/compare.ts <didja-instructions-<job>.json> [path/to/Didja.app/Contents/MacOS/Didja]
 *
 * Samples: emails, mail-samples.json (`--needs-reply`); looks done, looks-samples.json
 * (`--looks-done`): a wrong tick is "done" where the screen does not show it done. The other jobs
 * have no samples yet, so a proposal for them cannot be judged here.
 */
import { join } from 'node:path';

interface Proposal { kind: string; job: string; proposed: string }
interface Verdict { ok: boolean; wrongTick: boolean; said: string }

const [file, binaryArg] = process.argv.slice(2);
if (!file) {
  console.error('usage: bun eval/compare.ts <proposal.json> [Didja binary]');
  process.exit(2);
}
const binary = binaryArg ?? join(import.meta.dir, '../../app/build/Build/Products/Debug/Didja.app/Contents/MacOS/Didja');
const proposal = (await Bun.file(file).json()) as Proposal;
if (proposal.kind !== 'didja-instructions-proposal') throw new Error('not a proposal from Propose Upstream…');

function ask(flag: string, request: object): Record<string, string | boolean> {
  const run = Bun.spawnSync([binary, flag], { stdin: Buffer.from(JSON.stringify(request)), timeout: 60_000 });
  return JSON.parse(run.stdout.toString() || '{}');
}

type Runner = (instructions: string | null) => Map<string, Verdict>;
const runners: Record<string, Runner> = {
  emails: (instructions) => {
    const samples = require('./mail-samples.json') as { id: string; expect: string; about: string[]; email: object }[];
    return new Map(samples.map((s) => {
      const r = ask('--needs-reply', { ...s.email, ...(instructions ? { teach: { instructions } } : {}) });
      const task = String(r.task ?? '').toLowerCase();
      const ok = s.expect.split('|').includes(String(r.need)) && s.about.every((w) => w.split('|').some((x) => task.includes(x)));
      // For mail, a wrong "tick" is a task made from mail that asks nothing.
      return [s.id, { ok, wrongTick: s.expect === 'none' && r.need !== 'none', said: `${r.need} — ${r.task ?? ''}` }];
    }));
  },
  'looks-done': (instructions) => {
    const samples = require('./looks-samples.json') as { id: string; expect: string; request: object }[];
    return new Map(samples.map((s) => {
      const r = ask('--looks-done', { ...s.request, ...(instructions ? { teach: { instructions } } : {}) });
      return [s.id, { ok: r.seen === s.expect, wrongTick: r.seen === 'done' && s.expect !== 'done', said: String(r.seen ?? r.reason) }];
    }));
  },
};

const run = runners[proposal.job];
if (!run) {
  console.log(`No samples for "${proposal.job}" yet: this proposal cannot be judged here. Add made-up samples first.`);
  process.exit(2);
}
const before = run(null);
const after = run(proposal.proposed);
const score = (m: Map<string, Verdict>) => [...m.values()].filter((v) => v.ok).length;
const newWrong = [...after].filter(([id, v]) => v.wrongTick && !before.get(id)?.wrongTick).map(([id]) => id);
for (const [id, b] of before) {
  const a = after.get(id)!;
  if (a.ok !== b.ok || a.wrongTick !== b.wrongTick) console.log(`${a.ok ? 'better' : 'worse '} ${id}: built-in "${b.said}" → proposed "${a.said}"`);
}
console.log(`built-in ${score(before)}/${before.size}, proposed ${score(after)}/${after.size}, new wrong ticks: ${newWrong.join(', ') || 'none'}`);
const accept = score(after) > score(before) && newWrong.length === 0;
console.log(accept ? 'TAKE: better, and no new wrong ticks.' : 'DO NOT TAKE: not better, or it ticks wrongly where the built-in did not.');
process.exit(accept ? 0 : 1);
