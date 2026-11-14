/** The local model (Ollama): off by default, a model name only, and only for the jobs it was measured on. */
import { afterEach, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findChatReader, findJudge, findLooker, findMailReader, findReplyJudge, findTitler } from '../src/cli.ts';
import { localModelOf, setLocalModel } from '../src/localmodel.ts';
import { Store } from '../src/store.ts';

const saved = process.env.DIDJA_JUDGE;
afterEach(() => { process.env.DIDJA_JUDGE = saved; });

/** A stand-in for the app's binary: keeps what it was sent, answers yes. */
function fakeJudge(): string {
  const dir = mkdtempSync(join(tmpdir(), 'didja-local-'));
  const bin = join(dir, 'Didja');
  writeFileSync(bin, `#!/bin/sh\ncat > "${dir}/sent-$1.json"\necho '{"available":true,"seen":"done","need":"reply","task":"Send Sam the deck","audience":"user"}'\n`);
  chmodSync(bin, 0o755);
  process.env.DIDJA_JUDGE = bin;
  // A one-shot fake with no judge server (SCR-77): what each flag is sent is checked here.
  process.env.DIDJA_JUDGE_SERVER = '0';
  return dir;
}
const sent = (dir: string, flag: string) => JSON.parse(readFileSync(join(dir, `sent-${flag}.json`), 'utf8'));

test('off until turned on, and only a model name is taken', () => {
  const store = new Store(':memory:');
  expect(localModelOf(store)).toBeNull();
  expect(setLocalModel(store, 'qwen3.8:latest')).toBe(true);
  expect(localModelOf(store)).toBe('qwen3.8:latest');
  for (const bad of ['http://example.com/x', 'qwen; rm -rf', '', ' qwen', '../x']) expect(setLocalModel(store, bad)).toBe(false);
  expect(localModelOf(store)).toBe('qwen3.8:latest');
  setLocalModel(store, null);
  expect(localModelOf(store)).toBeNull();
});

test('emails and "looks done?" carry the local model when it is on, and nothing when it is off', () => {
  const dir = fakeJudge();
  let model: string | null = 'qwen3.8:latest';
  const look = { task: 'Send Sam the deck', app: 'Mail', page: 'Sent', text: 'To: Sam' };
  findLooker(() => model)!(look);
  expect(sent(dir, '--looks-done')).toEqual({ ...look, local: { model: 'qwen3.8:latest' } });
  const email = { fromName: 'Sam Carter', subject: 'Deck', body: ['Can you send the deck?'] };
  findMailReader(() => model)!(email as never);
  expect(sent(dir, '--needs-reply').local).toEqual({ model: 'qwen3.8:latest' });
  model = null;
  findLooker(() => model)!(look);
  expect(sent(dir, '--looks-done')).toEqual(look);
});

test('who a list is for carries the local model when it is on (SCR-70: measured in eval/lists.ts)', () => {
  const dir = fakeJudge();
  let model: string | null = 'qwen3.8:latest';
  findJudge(() => model)!({ leadIn: 'Next steps:', steps: ['Run the migration'] });
  expect(sent(dir, '--judge').local).toEqual({ model: 'qwen3.8:latest' });
  model = null;
  findJudge(() => model)!({ leadIn: 'Next steps:', steps: ['Run the migration'] });
  expect(sent(dir, '--judge').local).toBeUndefined();
});

test('whether a chat message asks something carries the local model when it is on (SCR-108: measured in eval/chats.ts)', () => {
  const dir = fakeJudge();
  let model: string | null = 'qwen3.8:latest';
  const question = { app: 'WhatsApp', chat: 'Sam', group: false, me: ['Mike'], from: 'Sam', message: 'Can you send the deck?', before: [] };
  findChatReader(() => model)!(question);
  expect(sent(dir, '--chat')).toEqual({ ...question, local: { model: 'qwen3.8:latest' } });
  model = null;
  findChatReader(() => model)!(question);
  expect(sent(dir, '--chat')).toEqual(question);
});

test('the jobs not measured against the local model never carry it', () => {
  const dir = fakeJudge();
  findTitler()!({ leadIn: 'Next steps:', steps: ['Run the migration'] } as never);
  expect(sent(dir, '--title').local).toBeUndefined();
  findReplyJudge()!({ app: 'WhatsApp', task: 'Send Sam the deck', ask: 'Can you send the deck?', reply: 'sent' });
  expect(sent(dir, '--chat-reply').local).toBeUndefined();
});
