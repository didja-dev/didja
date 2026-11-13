/**
 * Measures a local Ollama model against Apple's on-device model on the made-up samples
 * (mail-samples.json for `--needs-reply`, looks-samples.json for `--looks-done`), with the same
 * instructions and prompts: they are read from app/Didja/Judge.swift, so they cannot drift.
 * For deciding whether Didja should offer a local model; nothing in the app uses Ollama.
 * Talks only to Ollama on 127.0.0.1. Not part of `bun test` (needs Apple Intelligence and Ollama).
 *
 *   bun eval/ollama.ts [model] [path/to/Didja.app/Contents/MacOS/Didja]
 *
 * With SHAPE=words, the local model answers an email with the words the instructions use
 * (reply, action, none) instead of the app's answer shape (asks + writeBack/elsewhere/nothing).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { askModel } from '../src/cli.ts';
import { signedName } from '../src/email.ts';

const model = process.argv[2] ?? 'qwen3.8:latest';
const binary = process.argv[3] ?? join(import.meta.dir, '../../app/build/Build/Products/Debug/Didja.app/Contents/MacOS/Didja');
const OLLAMA = 'http://127.0.0.1:11434/api/chat';
const swift = readFileSync(join(import.meta.dir, '../../app/Didja/Judge.swift'), 'utf8');

/** A Swift multi-line string literal by its name, with `\` line continuations joined as Swift does. */
function swiftString(name: string): string {
  const m = swift.match(new RegExp(`static let ${name} = """\\n([\\s\\S]*?)\\n\\s*"""`));
  if (!m) throw new Error(`${name} not found in Judge.swift`);
  return m[1]!.split('\n').map((l) => l.trim()).join('\n').replace(/\\\n/g, '');
}
const mailInstructions = swiftString('mailInstructions');
const hebrewMailInstructions = swiftString('hebrewMailInstructions');
const lookInstructions = swiftString('lookInstructions');
const isHebrew = (t: string) => (t.match(/[א-ת]/g)?.length ?? 0) > (t.match(/[A-Za-z]/g)?.length ?? 0);

async function ollama(system: string, prompt: string, schema: object): Promise<Record<string, unknown>> {
  const res = await fetch(OLLAMA, {
    method: 'POST',
    body: JSON.stringify({ model, stream: false, think: false, format: schema, options: { temperature: 0 }, keep_alive: '30m',
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
  });
  const body = (await res.json()) as { message?: { content?: string }; error?: string };
  if (!body.message?.content) throw new Error(body.error ?? 'no answer');
  return JSON.parse(body.message.content);
}
function apple(flag: string, request: object): Record<string, unknown> {
  // As the engine asks (SCR-77): the judge server, or one-shot with DIDJA_JUDGE_SERVER=0.
  try {
    return (askModel(binary, flag.replace(/^--/, ''), request, 60_000) ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}
async function timed<T>(f: () => T | Promise<T>): Promise<[T, number]> {
  const t = performance.now();
  const r = await f();
  return [r, performance.now() - t];
}

// The same shapes as the @Generable types in Judge.swift, guides included.
const mailSchema = { type: 'object', required: ['asks', 'task', 'doneBy', 'asker'], properties: {
  asks: { type: 'boolean', description: 'true only if the email explicitly asks the reader to answer a question or to do something. false if it thanks, agrees, confirms, informs or says something is available.' },
  task: { type: 'string', description: "The thing to do, 3 to 9 words, starting with a verb and naming the person or service. 'none' if nothing is asked." },
  doneBy: { type: 'string', enum: ['writeBack', 'elsewhere', 'nothing'], description: 'How that task gets done. writeBack: by writing an answer to the sender, who is a person waiting for it. elsewhere: on a website, in an app, on a document, by paying or signing; no written answer needed. nothing: no task.' },
  asker: { type: 'string', description: 'The name signed under the request, after the thanks or regards, copied exactly as written there in its own language. If nobody signed, the sender. For a forwarded message never the forwarder.' },
} };
const wordsSchema = { type: 'object', required: ['need', 'task', 'asker'], properties: {
  need: { type: 'string', enum: ['reply', 'action', 'none'] },
  task: mailSchema.properties.task,
  asker: mailSchema.properties.asker,
} };
const words = process.env.SHAPE === 'words';
const lookSchema = { type: 'object', required: ['seen'], properties: {
  seen: { type: 'string', enum: ['done', 'notDone', 'unsure'], description: 'done: the screen shows the outcome of the task. notDone: it only mentions it, or shows instructions, code, an unused form or an error. unsure: cannot tell.' },
} };

interface MailSample { id: string; expect: string; about: string[]; asker?: string; email: { from: string; subject: string; body: string; forwarded?: boolean; writtenBy?: string } }
interface LookSample { id: string; expect: string; request: { task: string; app: string; page: string; text: string } }

function mailPrompt(e: MailSample['email']): string {
  let header = `From: ${e.from.slice(0, 120)}`;
  if (e.forwarded) {
    header = `Forwarded to the reader by: ${e.from.slice(0, 120)}, who did not write it.`;
    if (e.writtenBy) header += `\nThe original message came from: ${e.writtenBy.slice(0, 120)}. Whoever signed it by name is the person asking.`;
  }
  return `${header}\nSubject: ${e.subject.slice(0, 200)}\n\n${e.body.slice(0, 1600)}\n\nWhat does the reader have to do, and who is asking?`;
}
const lookPrompt = (r: LookSample['request']) =>
  `To-do item: ${r.task.slice(0, 300)}\nApp: ${r.app.slice(0, 80)}\nPage: ${r.page.slice(0, 200)}\nText on screen:\n${r.text.slice(0, 1200)}\n\nHas the to-do item been carried out?`;

type Score = { ok: number; wrong: number; ms: number[]; lines: string[] };
const blank = (): Score => ({ ok: 0, wrong: 0, ms: [], lines: [] });

function scoreMail(s: MailSample, need: string, task: string, rawAsker: string | undefined) {
  const t = task.toLowerCase();
  const needOk = s.expect.split('|').includes(need);
  const aboutOk = s.about.every((w) => w.split('|').some((x) => t.includes(x.toLowerCase())));
  const email = { fromName: s.email.from, subject: s.email.subject, body: s.email.body.split('\n') } as Parameters<typeof signedName>[0];
  const asker = signedName(email, rawAsker);
  const askerOk = !s.asker || s.asker.split('|').includes(asker ?? '');
  return { ok: needOk && aboutOk && askerOk, wrong: s.expect === 'none' && need !== 'none', said: `${need} — ${task} — ${asker}` };
}

const mails = (await Bun.file(join(import.meta.dir, 'mail-samples.json')).json()) as MailSample[];
const looks = (await Bun.file(join(import.meta.dir, 'looks-samples.json')).json()) as LookSample[];
const result = { mail: { apple: blank(), local: blank() }, looks: { apple: blank(), local: blank() } };

for (const s of mails) {
  const [a, ams] = await timed(() => apple('--needs-reply', s.email));
  const sa = scoreMail(s, String(a.need ?? 'unavailable'), String(a.task ?? ''), a.asker as string | undefined);
  const system = isHebrew(`${s.email.subject}\n${s.email.body}`) ? `${mailInstructions} ${hebrewMailInstructions}` : mailInstructions;
  const [o, oms] = await timed(() => ollama(system, mailPrompt(s.email), words ? wordsSchema : mailSchema));
  const need = words ? String(o.need) : { writeBack: 'reply', elsewhere: 'action', nothing: 'none' }[(o.asks ? o.doneBy : 'nothing') as string] ?? 'none';
  const so = scoreMail(s, need, String(o.task ?? ''), o.asker as string | undefined);
  for (const [k, v, ms] of [['apple', sa, ams], ['local', so, oms]] as const) {
    const r = result.mail[k];
    if (v.ok) r.ok++;
    if (v.wrong) r.wrong++;
    r.ms.push(ms);
  }
  console.log(`mail ${s.id.padEnd(22)} apple ${sa.ok ? 'ok  ' : 'MISS'} ${sa.said}\n${''.padEnd(27)} local ${so.ok ? 'ok  ' : 'MISS'} ${so.said}`);
}
for (const s of looks) {
  const [a, ams] = await timed(() => apple('--looks-done', s.request));
  const [o, oms] = await timed(() => ollama(lookInstructions, lookPrompt(s.request), lookSchema));
  for (const [k, seen, ms] of [['apple', String(a.seen ?? a.reason), ams], ['local', String(o.seen), oms]] as const) {
    const r = result.looks[k];
    if (seen === s.expect) r.ok++;
    if (seen === 'done' && s.expect !== 'done') r.wrong++;
    r.ms.push(ms);
  }
  console.log(`look ${s.id.padEnd(22)} want ${s.expect.padEnd(8)} apple ${String(a.seen ?? a.reason).padEnd(8)} local ${o.seen}`);
}
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
console.log(`\nmodel: ${model}${words ? ' (email answers in words)' : ''}`);
for (const [job, n] of [['mail', mails.length], ['looks', looks.length]] as const) {
  for (const k of ['apple', 'local'] as const) {
    const r = result[job][k];
    console.log(`${job.padEnd(6)} ${k.padEnd(6)} ${r.ok}/${n} right, ${r.wrong} wrong ${job === 'looks' ? 'ticks' : 'tasks from mail asking nothing'}, median ${(median(r.ms) / 1000).toFixed(1)} s`);
  }
}
