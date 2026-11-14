/**
 * The instructions and prompts the app's judges give Apple's on-device model, for the jobs measured
 * on made-up samples in this folder: who a list is for (`--judge`, Judge.swift), whether a chat
 * message asks something of the reader (`--chat`, ChatJudge.swift) and whether a screen shows a task
 * done (`--looks-done`, Judge.swift). The instructions are read from the Swift sources, so they
 * cannot drift; the prompts are copies of the Swift ones. Shared by the evals and by the adapter
 * training data (adapter-data.ts, SCR-118), so both ask the model the same way.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatQuestion } from '../src/chat.ts';

const appDir = join(import.meta.dir, '../../app/Didja');

/** A Swift multi-line string literal by its name, with `\` line continuations joined as Swift does. */
export function swiftString(file: string, name: string): string {
  const swift = readFileSync(join(appDir, file), 'utf8');
  const m = swift.match(new RegExp(`static let ${name} = """\\n([\\s\\S]*?)\\n\\s*"""`));
  if (!m) throw new Error(`${name} not found in ${file}`);
  return m[1]!.split('\n').map((l) => l.trim()).join('\n').replace(/\\\n/g, '');
}

export const isHebrew = (t: string) => (t.match(/[א-ת]/g)?.length ?? 0) > (t.match(/[A-Za-z]/g)?.length ?? 0);

// MARK: Who is a list for?

export interface ListRequest { leadIn: string; steps: string[]; after?: string[]; asked?: string; reply?: string }

/** Judge.prompt(for:), the same as in Judge.swift. */
export function listPrompt(r: ListRequest): string {
  const steps = r.steps.slice(0, 12).map((t, i) => `${i + 1}. ${t.slice(0, 300)}`).join('\n');
  const after = (r.after ?? []).slice(0, 3).map((t) => t.slice(0, 240)).join(' ');
  const tail = after ? `\nText after the list: "${after}"` : '';
  const asked = (r.asked ?? '').trim();
  const head = asked ? `The person asked: "${asked.slice(0, 240)}"\n` : '';
  const reply = (r.reply ?? '').trim();
  const whole = reply ? `The assistant's whole reply:\n"""\n${reply.slice(0, 2000)}\n"""\n` : '';
  return `${head}${whole}Introduced by: "${r.leadIn.slice(0, 200)}"\n${steps}${tail}\n\nWho is this list for, taken as a whole?`;
}

export const listInstructions = () => swiftString('Judge.swift', 'instructions');

// MARK: Does a chat message ask the reader to do something?

/** Judge.chatPrompt(for:), the same as in ChatJudge.swift. */
export function chatPrompt(q: ChatQuestion): string {
  const earlier = q.before.slice(-6).map((b) => `${b.from === 'me' ? 'The reader' : b.from.slice(0, 60)}: ${b.text.slice(0, 300)}`).join('\n');
  const addressed = q.addressed === 'everyone' ? '\nIt does not name the reader; it may be addressed to every member.'
    : q.addressed === 'named' ? '\nIt tags or names the reader.'
    : q.addressed === 'group' ? '\nIt names no one: it was said to the whole group. Answer true only if it asks the group for something the reader, as a member, could be the one to do.' : '';
  const names = q.group ? `The reader's names: ${q.me.slice(0, 4).join(', ').slice(0, 160)}\n` : '';
  const from = q.from.slice(0, 60);
  return `App: ${q.app.slice(0, 40)}
Chat: ${q.chat.slice(0, 80)} (${q.group ? 'a group chat' : 'a one-to-one chat with the sender'})${addressed}
${names}${earlier ? `Earlier messages:\n${earlier}\n` : ''}The message, from ${from}, who is the person asking:
${q.message.slice(0, 1200)}

Does this message ask the reader to do something, and what? In the task, "me" in the message is ${from}; name ${from}, never the reader.`;
}

/** Judge.chatInstructions(for:) with nothing taught: the English ones, plus the Hebrew paragraph for a Hebrew message. */
export function chatInstructions(message: string): string {
  const base = swiftString('ChatJudge.swift', 'chatInstructions');
  return isHebrew(message) ? `${base} ${swiftString('ChatJudge.swift', 'hebrewChatInstructions')}` : base;
}

// MARK: Does a screen show a task done?

export interface LookRequest { task: string; app: string; page: string; text: string }

/** Judge.lookPrompt(for:), the same as in Judge.swift. */
export const lookPrompt = (r: LookRequest) =>
  `To-do item: ${r.task.slice(0, 300)}\nApp: ${r.app.slice(0, 80)}\nPage: ${r.page.slice(0, 200)}\nText on screen:\n${r.text.slice(0, 1200)}\n\nHas the to-do item been carried out?`;

export const lookInstructions = () => swiftString('Judge.swift', 'lookInstructions');
