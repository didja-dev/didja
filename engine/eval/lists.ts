/**
 * Measures the list judge (`Didja --judge`: is this list for you, or Claude's own plan?) on made-up
 * lists (lists-samples.json, SCR-70): Apple's on-device model through the built app, with and
 * without the whole reply, against a local Ollama model given the same instructions and prompt (read
 * from app/Didja/Judge.swift, so they cannot drift), and the wording rules alone. Talks only to
 * Ollama on 127.0.0.1. Not part of `bun test` (needs Apple Intelligence and Ollama).
 *
 *   bun eval/lists.ts [ollama-model|none] [path/to/Didja.app/Contents/MacOS/Didja]
 *
 * "False yours" is a list of Claude's own taken as yours (a task that should not exist); "false
 * Claude's" is one of yours taken as Claude's (a task missed). A model may replace another for this
 * job only with more right and no more false yours.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { followUpActor, listActor, planActor } from '../src/extract.ts';

const model = process.argv[2] ?? 'qwen3.8:latest';
const binary = process.argv[3] ?? join(import.meta.dir, '../../app/build/Build/Products/Debug/Didja.app/Contents/MacOS/Didja');
const OLLAMA = 'http://127.0.0.1:11434/api/chat';
const swift = readFileSync(join(import.meta.dir, '../../app/Didja/Judge.swift'), 'utf8');

function swiftString(name: string): string {
  const m = swift.match(new RegExp(`static let ${name} = """\\n([\\s\\S]*?)\\n\\s*"""`));
  if (!m) throw new Error(`${name} not found in Judge.swift`);
  return m[1]!.split('\n').map((l) => l.trim()).join('\n').replace(/\\\n/g, '');
}
const instructions = swiftString('instructions');

interface Sample { id: string; expect: 'user' | 'assistant'; leadIn: string; steps: string[]; before?: string[]; after?: string[]; asked?: string }
interface Request { leadIn: string; steps: string[]; after?: string[]; asked?: string; reply?: string }

const samples = JSON.parse(readFileSync(join(import.meta.dir, 'lists-samples.json'), 'utf8')) as Sample[];

/** The whole reply as the engine gives it (`replyAround`): the prose, the lead-in, the steps, what follows. */
const replyOf = (s: Sample) => [...(s.before ?? []), s.leadIn, ...s.steps.map((t, i) => `${i + 1}. ${t}`), ...(s.after ?? [])].join('\n');
const request = (s: Sample, withReply: boolean): Request => ({
  leadIn: s.leadIn, steps: s.steps, after: s.after ?? [], ...(s.asked ? { asked: s.asked } : {}), ...(withReply ? { reply: replyOf(s) } : {}),
});

/** Judge.prompt(for:), the same as in Judge.swift. */
function prompt(r: Request): string {
  const steps = r.steps.slice(0, 12).map((t, i) => `${i + 1}. ${t.slice(0, 300)}`).join('\n');
  const after = (r.after ?? []).slice(0, 3).map((t) => t.slice(0, 240)).join(' ');
  const tail = after ? `\nText after the list: "${after}"` : '';
  const asked = (r.asked ?? '').trim();
  const head = asked ? `The person asked: "${asked.slice(0, 240)}"\n` : '';
  const reply = (r.reply ?? '').trim();
  const whole = reply ? `The assistant's whole reply:\n"""\n${reply.slice(0, 2000)}\n"""\n` : '';
  return `${head}${whole}Introduced by: "${r.leadIn.slice(0, 200)}"\n${steps}${tail}\n\nWho is this list for, taken as a whole?`;
}

const schema = { type: 'object', required: ['audience'], properties: {
  audience: { type: 'string', enum: ['user', 'assistant'], description: "user: the list tells the reader what to do themselves. assistant: the list is the assistant's own plan, or a report of what it did or how something works." },
} };

async function ollama(r: Request): Promise<string | null> {
  try {
    const res = await fetch(OLLAMA, { method: 'POST', body: JSON.stringify({ model, stream: false, think: false, format: schema, options: { temperature: 0 },
      messages: [{ role: 'system', content: instructions }, { role: 'user', content: prompt(r) }] }) });
    const body = (await res.json()) as { message?: { content?: string } };
    return (JSON.parse(body.message?.content ?? '{}') as { audience?: string }).audience ?? null;
  } catch {
    return null;
  }
}
function apple(r: Request): string | null {
  const run = Bun.spawnSync([binary, '--judge'], { stdin: Buffer.from(JSON.stringify(r)), timeout: 60_000 });
  try {
    return (JSON.parse(run.stdout.toString() || '{}') as { audience?: string }).audience ?? null;
  } catch {
    return null;
  }
}
function wording(s: Sample): string | null {
  const actor = listActor(s.leadIn) ?? followUpActor(s.after ?? []) ?? planActor(s.steps);
  return actor === 'you' ? 'user' : actor;
}

interface Tally { right: number; falseYours: number; falseClaudes: number; none: number; ms: number; wrong: string[] }
const blank = (): Tally => ({ right: 0, falseYours: 0, falseClaudes: 0, none: 0, ms: 0, wrong: [] });
function score(t: Tally, s: Sample, got: string | null, ms: number) {
  t.ms += ms;
  if (got === null) t.none++;
  else if (got === s.expect) t.right++;
  else if (got === 'user') { t.falseYours++; t.wrong.push(s.id); }
  else { t.falseClaudes++; t.wrong.push(s.id); }
}

const runs: Record<string, Tally> = { wording: blank(), apple: blank(), 'apple, no reply': blank() };
if (model !== 'none') runs[`ollama ${model}`] = blank();
for (const s of samples) {
  score(runs.wording!, s, wording(s), 0);
  for (const withReply of [true, false]) {
    const t = performance.now();
    const got = apple(request(s, withReply));
    score(runs[withReply ? 'apple' : 'apple, no reply']!, s, got, performance.now() - t);
  }
  if (model !== 'none') {
    const t = performance.now();
    const got = await ollama(request(s, true));
    score(runs[`ollama ${model}`]!, s, got, performance.now() - t);
  }
}

const yours = samples.filter((s) => s.expect === 'user').length;
console.log(`${samples.length} made-up lists: ${yours} yours, ${samples.length - yours} Claude's own.\n`);
console.log('judge'.padEnd(28), 'right'.padStart(6), 'false yours'.padStart(12), "false Claude's".padStart(15), 'no answer'.padStart(10), 'avg s'.padStart(6));
for (const [name, t] of Object.entries(runs)) {
  const answered = samples.length - (name === 'wording' ? 0 : 0);
  console.log(name.padEnd(28), `${t.right}/${answered}`.padStart(6), String(t.falseYours).padStart(12), String(t.falseClaudes).padStart(15),
    String(t.none).padStart(10), (t.ms / samples.length / 1000).toFixed(1).padStart(6));
  if (t.wrong.length) console.log(' '.repeat(4), 'wrong:', t.wrong.join(', '));
}
console.log('\n(wording: "no answer" is a list the rules leave to the model.)');
