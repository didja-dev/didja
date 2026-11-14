/**
 * Measures the chat-ask job (`Didja --chat`: does this chat message ask the reader to do something?)
 * on made-up messages (chat-samples.json, SCR-108): English and Hebrew, one-to-one and groups,
 * "can someone…", thanks and acknowledgements, and deferrals by either side. Apple's on-device model
 * through the built app, against a local Ollama model given the same instructions and prompt (read
 * from app/Didja/ChatJudge.swift, so they cannot drift). Talks only to Ollama on 127.0.0.1. Not part
 * of `bun test` (needs Apple Intelligence and Ollama).
 *
 *   bun eval/chats.ts [ollama-model] [path/to/Didja.app/Contents/MacOS/Didja]
 *
 * "Wrong asks" are messages that ask nothing of the reader taken as asks: a task that should not
 * exist. A model may take this job over only with more right and no more wrong asks.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { askModel } from '../src/cli.ts';
import type { ChatQuestion } from '../src/chat.ts';
import { chatInstructions, chatPrompt, isHebrew } from './prompts.ts';

const model = process.argv[2] ?? 'qwen3.8:latest';
const binary = process.argv[3] ?? join(import.meta.dir, '../../app/build/Build/Products/Debug/Didja.app/Contents/MacOS/Didja');
const OLLAMA = 'http://127.0.0.1:11434/api/chat';

interface Sample { id: string; expect: boolean; group: boolean; addressed?: 'named' | 'everyone' | 'group'; chat: string; from: string; message: string; before?: { from: string; text: string }[] }
const samples = JSON.parse(readFileSync(join(import.meta.dir, 'chat-samples.json'), 'utf8')) as Sample[];
const ME = ['Mike', 'מייק'];

const question = (s: Sample): ChatQuestion => ({
  app: 'WhatsApp', chat: s.chat, group: s.group, ...(s.addressed ? { addressed: s.addressed } : {}), me: ME, from: s.from, message: s.message, before: s.before ?? [],
});

const prompt = chatPrompt;

// The same shape as OnDeviceChat.Ask in ChatJudge.swift, guides included.
const schema = { type: 'object', required: ['asks', 'task'], properties: {
  asks: { type: 'boolean', description: 'true only if the message asks the reader to do something; in a group chat, only if it is addressed to the reader.' },
  task: { type: 'string', description: "The thing to do, 3 to 9 words, starting with a verb and naming the sender who asks, never the reader. 'none' if nothing is asked." },
} };

type Answer = { asks: boolean; task: string } | null;
async function ollama(q: ChatQuestion): Promise<Answer> {
  const system = chatInstructions(q.message);
  try {
    const res = await fetch(OLLAMA, { method: 'POST', body: JSON.stringify({ model, stream: false, think: false, format: schema, options: { temperature: 0 }, keep_alive: '30m',
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt(q) }] }) });
    const body = (await res.json()) as { message?: { content?: string } };
    const a = JSON.parse(body.message?.content ?? '{}') as { asks?: unknown; task?: unknown };
    return typeof a.asks === 'boolean' ? { asks: a.asks, task: typeof a.task === 'string' ? a.task : '' } : null;
  } catch {
    return null;
  }
}
function apple(q: ChatQuestion): Answer {
  try {
    // As the engine asks (SCR-77): the judge server, or one-shot with DIDJA_JUDGE_SERVER=0.
    const a = (askModel(binary, 'chat', q, 60_000) ?? {}) as { available?: boolean; asks?: unknown; task?: unknown };
    return a.available && typeof a.asks === 'boolean' ? { asks: a.asks, task: typeof a.task === 'string' ? a.task : '' } : null;
  } catch {
    return null;
  }
}

interface Tally { right: number; wrongAsks: number; missed: number; none: number; taskLanguage: number; asked: number; ms: number; wrong: string[] }
const blank = (): Tally => ({ right: 0, wrongAsks: 0, missed: 0, none: 0, taskLanguage: 0, asked: 0, ms: 0, wrong: [] });
function score(t: Tally, s: Sample, got: Answer, ms: number) {
  t.ms += ms;
  if (got === null) { t.none++; return; }
  if (got.asks === s.expect) t.right++;
  else if (got.asks) { t.wrongAsks++; t.wrong.push(`${s.id} (asks)`); }
  else { t.missed++; t.wrong.push(`${s.id} (missed)`); }
  if (got.asks && s.expect) {
    t.asked++;
    if (isHebrew(got.task) === isHebrew(s.message)) t.taskLanguage++;
  }
  if (process.env.VERBOSE) console.log(`  ${s.id}: ${got.asks} — ${got.task}`);
}

const runs: Record<string, Tally> = { apple: blank(), [`ollama ${model}`]: blank() };
for (const s of samples) {
  const q = question(s);
  let t = performance.now();
  score(runs.apple!, s, apple(q), performance.now() - t);
  t = performance.now();
  score(runs[`ollama ${model}`]!, s, await ollama(q), performance.now() - t);
}

const asks = samples.filter((s) => s.expect).length;
console.log(`${samples.length} made-up chat messages: ${asks} ask the reader, ${samples.length - asks} do not.\n`);
console.log('model'.padEnd(24), 'right'.padStart(7), 'wrong asks'.padStart(11), 'missed'.padStart(7), 'no answer'.padStart(10), 'task lang'.padStart(10), 'avg s'.padStart(6));
for (const [name, t] of Object.entries(runs)) {
  console.log(name.padEnd(24), `${t.right}/${samples.length}`.padStart(7), String(t.wrongAsks).padStart(11), String(t.missed).padStart(7),
    String(t.none).padStart(10), `${t.taskLanguage}/${t.asked}`.padStart(10), (t.ms / samples.length / 1000).toFixed(1).padStart(6));
  if (t.wrong.length) console.log(' '.repeat(4), 'wrong:', t.wrong.join(', '));
}
