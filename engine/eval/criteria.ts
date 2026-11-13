/**
 * Measures the "what done looks like" job (SCR-67) on made-up samples (criteria-samples.json):
 * Apple's on-device model writes the criteria for each task, through the built app, and the
 * engine's own matching then checks them against a screen that shows the task done and one that
 * does not. A match on the not-done screen is the bad case (it would put a wrong "looks done?" in
 * front of the looks-done model); a veto or nothing on the done screen is a miss.
 * Not part of `bun test` (needs Apple Intelligence). The local model is not used for this job
 * until a run like this shows it does better with no new wrong matches.
 *
 *   bun eval/criteria.ts [path/to/Didja.app/Contents/MacOS/Didja]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findCriteriaWriter } from '../src/cli.ts';
import { cleanCriteria, groundCriteria, matchCriteria } from '../src/donecriteria.ts';
import type { CriteriaQuestion } from '../src/donecriteria.ts';

process.env.DIDJA_JUDGE = process.argv[2] ?? join(import.meta.dir, '../../app/build/Build/Products/Debug/Didja.app/Contents/MacOS/Didja');
const write = findCriteriaWriter();
if (!write) {
  console.error('No app binary: build the app first, or pass its path.');
  process.exit(2);
}
interface Screen { app: string; url: string | null; windowTitle: string; text: string }
interface Sample { id: string; question: CriteriaQuestion; done: Screen; notDone: Screen }
const samples = JSON.parse(readFileSync(join(import.meta.dir, 'criteria-samples.json'), 'utf8')) as Sample[];

let found = 0;
let wrong = 0;
for (const s of samples) {
  const raw = write(s.question);
  if (!raw) {
    console.log(`${s.id}: no model`);
    continue;
  }
  const c = groundCriteria(cleanCriteria(raw), s.question);
  const onDone = matchCriteria(c, s.done);
  const onNot = matchCriteria(c, s.notDone);
  if (onDone === 'match') found++;
  if (onNot === 'match') wrong++;
  console.log(`${s.id}: done screen → ${onDone}, not-done screen → ${onNot}${onNot === 'match' ? '  WRONG' : ''}`);
  console.log(`  ${JSON.stringify(c)}`);
}
console.log(`\nDone screens matched: ${found}/${samples.length}. Not-done screens matched (wrong): ${wrong}/${samples.length}.`);
