/**
 * Training data for a Didja adapter for Apple's on-device model (SCR-118), built from the made-up
 * samples in this folder only (lists-samples.json, chat-samples.json, looks-samples.json); never
 * from anything captured on a Mac. Three jobs, asked exactly as the app asks them (prompts.ts):
 *
 * - list-owner: who a list is for (`--judge`), answered `{"audience": "user" | "assistant"}`;
 * - chat-ask: whether a chat message asks the reader to do something (`--chat`),
 *   answered `{"asks": true | false, "task": "…" | "none"}`;
 * - looks-done: whether a screen shows a task done (`--looks-done`), answered `{"seen": "done" | "notDone"}`.
 *
 * Each example is one line of JSONL in the shape Apple's adapter training toolkit reads: a list of
 * messages, system (the instructions), user (the prompt), assistant (the answer as JSON, in the
 * property order of the app's @Generable type). About one in five of each job and answer is held
 * out, chosen by a hash of its id so the split never changes when samples are added elsewhere; an
 * adapter may be measured only on the held-out examples, never on what it was trained on.
 *
 *   bun eval/adapter-data.ts [out-dir]     (default: $TMPDIR/didja-adapter-data)
 *
 * Writes train.jsonl, held-out.jsonl and split.json (which ids went where). Nothing is sent anywhere.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatQuestion } from '../src/chat.ts';
import { chatInstructions, chatPrompt, listInstructions, listPrompt, lookInstructions, lookPrompt, type LookRequest } from './prompts.ts';

export type Job = 'list-owner' | 'chat-ask' | 'looks-done';
export interface Message { role: 'system' | 'user' | 'assistant'; content: string }
export interface Example { job: Job; id: string; label: string; messages: Message[] }

interface ListSample { id: string; expect: 'user' | 'assistant'; leadIn: string; steps: string[]; before?: string[]; after?: string[]; asked?: string }
interface ChatSample { id: string; expect: boolean; task?: string; group: boolean; addressed?: 'named' | 'everyone' | 'group'; chat: string; from: string; message: string; before?: { from: string; text: string }[] }
interface LookSample { id: string; expect: 'done' | 'notDone' | 'unsure'; request: LookRequest }

/** The reader's names in the made-up chats, as eval/chats.ts gives them. */
const ME = ['Mike', 'מייק'];
const read = <T>(file: string) => JSON.parse(readFileSync(join(import.meta.dir, file), 'utf8')) as T;
const example = (job: Job, id: string, label: string, system: string, user: string, answer: object): Example =>
  ({ job, id, label, messages: [{ role: 'system', content: system }, { role: 'user', content: user }, { role: 'assistant', content: JSON.stringify(answer) }] });

/** Every example, from the made-up samples only. */
export function examples(): Example[] {
  const out: Example[] = [];

  const lists = listInstructions();
  for (const s of read<ListSample[]>('lists-samples.json')) {
    // With the whole reply, as the engine asks (`replyAround`).
    const reply = [...(s.before ?? []), s.leadIn, ...s.steps.map((t, i) => `${i + 1}. ${t}`), ...(s.after ?? [])].join('\n');
    const prompt = listPrompt({ leadIn: s.leadIn, steps: s.steps, after: s.after ?? [], ...(s.asked ? { asked: s.asked } : {}), reply });
    out.push(example('list-owner', s.id, s.expect, lists, prompt, { audience: s.expect }));
  }

  for (const s of read<ChatSample[]>('chat-samples.json')) {
    // An ask with no written task cannot teach the task's wording: left out rather than guessed.
    if (s.expect && !s.task?.trim()) continue;
    const q: ChatQuestion = { app: 'WhatsApp', chat: s.chat, group: s.group, ...(s.addressed ? { addressed: s.addressed } : {}), me: ME, from: s.from, message: s.message, before: s.before ?? [] };
    out.push(example('chat-ask', s.id, String(s.expect), chatInstructions(s.message), chatPrompt(q), { asks: s.expect, task: s.expect ? s.task!.trim() : 'none' }));
  }

  const looks = lookInstructions();
  for (const s of read<LookSample[]>('looks-samples.json')) {
    out.push(example('looks-done', s.id, s.expect, looks, lookPrompt(s.request), { seen: s.expect }));
  }
  return out;
}

/** FNV-1a, 32 bits: a stable hash, so the split does not depend on the order of the samples. */
export function stableHash(text: string): number {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Holds out one in `every` of each job and answer (at least one of each), the ones whose ids hash
 * lowest, so every answer of every job is measured and the rest is trained on.
 */
export function split(all: Example[], every = 5): { train: Example[]; heldOut: Example[] } {
  const groups = new Map<string, Example[]>();
  for (const e of all) {
    const key = `${e.job}\u0000${e.label}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const held = new Set<Example>();
  for (const group of groups.values()) {
    const ranked = [...group].sort((a, b) => stableHash(`${a.job}:${a.id}`) - stableHash(`${b.job}:${b.id}`) || a.id.localeCompare(b.id));
    for (const e of ranked.slice(0, Math.max(1, Math.round(group.length / every)))) held.add(e);
  }
  return { train: all.filter((e) => !held.has(e)), heldOut: all.filter((e) => held.has(e)) };
}

/** One line per example: the messages only, as the toolkit reads them. */
export const jsonl = (list: Example[]) => list.map((e) => JSON.stringify(e.messages)).join('\n') + (list.length ? '\n' : '');

export function write(outDir: string): { train: number; heldOut: number } {
  const { train, heldOut } = split(examples());
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'train.jsonl'), jsonl(train));
  writeFileSync(join(outDir, 'held-out.jsonl'), jsonl(heldOut));
  const ids = (list: Example[]) => list.map((e) => `${e.job}:${e.id}`);
  writeFileSync(join(outDir, 'split.json'), JSON.stringify({ train: ids(train), heldOut: ids(heldOut) }, null, 1) + '\n');
  return { train: train.length, heldOut: heldOut.length };
}

if (import.meta.main) {
  const outDir = process.argv[2] ?? join(process.env.TMPDIR ?? tmpdir(), 'didja-adapter-data');
  const { train, heldOut } = write(outDir);
  const all = examples();
  for (const job of ['list-owner', 'chat-ask', 'looks-done'] as const) {
    const of = all.filter((e) => e.job === job);
    const labels = [...new Set(of.map((e) => e.label))].map((l) => `${of.filter((e) => e.label === l).length} ${l}`).join(', ');
    console.log(`${job.padEnd(11)} ${String(of.length).padStart(3)} examples (${labels})`);
  }
  console.log(`\n${train} to train on, ${heldOut} held out, in ${outDir}`);
}
