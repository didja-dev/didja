/**
 * Runs the made-up emails in mail-samples.json through the on-device model
 * (`Didja --needs-reply`) and prints what came back. For prompt work
 * on `Judge.mailInstructions`: run before and after a change. Not part of
 * `bun test`, because it needs Apple Intelligence and is not deterministic
 * across macOS versions.
 *
 *   bun eval/mail.ts [path/to/Didja.app/Contents/MacOS/Didja]
 */
import { join } from 'node:path';
import { signedName } from '../src/email.ts';
import { namedIn, validNeed } from '../src/validate.ts';

interface Sample {
  id: string;
  /** Allowed needs, `|`-separated. */
  expect: string;
  /** Each entry is a `|`-separated set of words; the task must contain one word of every entry. */
  about: string[];
  /** Who should come out as asking, after the engine completes the signature; `|`-separated. A name cut short is the miss. */
  asker?: string;
  email: { from: string; subject: string; body: string; forwarded?: boolean; writtenBy?: string };
}

const binary = process.argv[2] ?? join(import.meta.dir, '../../app/build/Build/Products/Debug/Didja.app/Contents/MacOS/Didja');
const samples = (await Bun.file(join(import.meta.dir, 'mail-samples.json')).json()) as Sample[];
let pass = 0;
// Before and after the engine's field checks (SCR-102), on the same answers.
let passRaw = 0;
let askersDropped = 0;
for (const s of samples) {
  const run = Bun.spawnSync([binary, '--needs-reply'], { stdin: Buffer.from(JSON.stringify(s.email)), timeout: 60_000 });
  const reply = JSON.parse(run.stdout.toString() || '{}') as { available?: boolean; need?: string; task?: string; asker?: string; reason?: string };
  if (!reply.available) {
    console.log(`${s.id}: unavailable (${reply.reason})`);
    continue;
  }
  const task = (reply.task ?? '').toLowerCase();
  const needOk = s.expect.split('|').includes(reply.need ?? '');
  const aboutOk = s.about.every((words) => words.split('|').some((w) => task.includes(w.toLowerCase())));
  // The same completion the engine applies before showing who asked.
  const email = { fromName: s.email.from, subject: s.email.subject, body: s.email.body.split('\n') } as Parameters<typeof signedName>[0];
  const rawAsker = signedName(email, reply.asker);
  const rawOk = needOk && aboutOk && (!s.asker || s.asker.split('|').includes(rawAsker ?? ''));
  if (rawOk) passRaw++;
  // As the engine now does: the need from the allowed set, the asker only when the email shows them.
  const checked = namedIn(reply.asker, [s.email.from, s.email.writtenBy ?? '', s.email.subject, s.email.body].join('\n'));
  if (reply.asker && !checked) askersDropped++;
  const asker = signedName(email, checked);
  const askerOk = !s.asker || s.asker.split("|").includes(asker ?? "");
  const ok = s.expect.split('|').includes(validNeed(reply.need)) && aboutOk && askerOk;
  if (ok) pass++;
  console.log(`${ok ? 'ok  ' : 'MISS'} ${s.id}: ${reply.need} — ${reply.task} — asker: ${asker}${needOk ? '' : ` [need, wanted ${s.expect}]`}${aboutOk ? '' : ' [wording]'}${askerOk ? '' : ` [asker, wanted ${s.asker}]`}`);
}
console.log(`${pass}/${samples.length} as expected (before the field checks: ${passRaw}; askers not in the email, left out: ${askersDropped})`);
