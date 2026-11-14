import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { examples, jsonl, split, stableHash, write } from '../eval/adapter-data.ts';
import { isHebrew } from '../eval/prompts.ts';

// SCR-118: training data for an adapter for Apple's on-device model, from the made-up samples only.

const samples = (file: string) => JSON.parse(readFileSync(join(import.meta.dir, '../eval', file), 'utf8')) as { id: string }[];

test('every made-up sample of the three jobs becomes one example, and nothing else does', () => {
  const all = examples();
  const ids = (job: string) => all.filter((e) => e.job === job).map((e) => e.id).sort();
  expect(ids('list-owner')).toEqual(samples('lists-samples.json').map((s) => s.id).sort());
  expect(ids('chat-ask')).toEqual(samples('chat-samples.json').map((s) => s.id).sort());
  expect(ids('looks-done')).toEqual(samples('looks-samples.json').map((s) => s.id).sort());
  expect(new Set(all.map((e) => `${e.job}:${e.id}`)).size).toBe(all.length);
});

test('each example is system instructions, the app prompt and the answer as the app types it', () => {
  for (const e of examples()) {
    expect(e.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant']);
    expect(e.messages[0]!.content.length).toBeGreaterThan(200);
    const answer = JSON.parse(e.messages[2]!.content) as Record<string, unknown>;
    if (e.job === 'list-owner') {
      expect(Object.keys(answer)).toEqual(['audience']);
      expect(['user', 'assistant']).toContain(answer.audience as string);
      expect(e.messages[1]!.content).toContain('Who is this list for, taken as a whole?');
      expect(e.messages[1]!.content).toContain("The assistant's whole reply:");
    } else if (e.job === 'chat-ask') {
      expect(Object.keys(answer)).toEqual(['asks', 'task']);
      expect(e.messages[1]!.content).toContain('Does this message ask the reader to do something');
      if (answer.asks) {
        const task = answer.task as string;
        expect(task).not.toBe('none');
        expect(task.split(/\s+/).length).toBeGreaterThanOrEqual(3);
        expect(task.split(/\s+/).length).toBeLessThanOrEqual(9);
      } else {
        expect(answer.task).toBe('none');
      }
    } else {
      expect(Object.keys(answer)).toEqual(['seen']);
      expect(['done', 'notDone']).toContain(answer.seen as string);
      expect(e.messages[1]!.content).toContain('Has the to-do item been carried out?');
    }
  }
});

test('a Hebrew chat message is taught with the Hebrew instructions and answered in Hebrew', () => {
  const chats = examples().filter((e) => e.job === 'chat-ask');
  const hebrew = chats.filter((e) => isHebrew((e.messages[1]!.content.split('who is the person asking:\n')[1] ?? '').split('\n\nDoes this message')[0]!));
  expect(hebrew.length).toBeGreaterThan(0);
  for (const e of hebrew) {
    expect(e.messages[0]!.content).toContain('This message is written in Hebrew.');
    const answer = JSON.parse(e.messages[2]!.content) as { asks: boolean; task: string };
    if (answer.asks) expect(isHebrew(answer.task)).toBe(true);
  }
  const english = chats.filter((e) => !hebrew.includes(e));
  expect(english.length).toBeGreaterThan(0);
  for (const e of english) expect(e.messages[0]!.content).not.toContain('This message is written in Hebrew.');
});

test('the held-out split covers every answer of every job, never overlaps training, and does not move', () => {
  const all = examples();
  const { train, heldOut } = split(all);
  expect(train.length + heldOut.length).toBe(all.length);
  const trained = new Set(train.map((e) => `${e.job}:${e.id}`));
  for (const e of heldOut) expect(trained.has(`${e.job}:${e.id}`)).toBe(false);
  for (const job of ['list-owner', 'chat-ask', 'looks-done']) {
    for (const label of new Set(all.filter((e) => e.job === job).map((e) => e.label))) {
      expect(heldOut.some((e) => e.job === job && e.label === label)).toBe(true);
      expect(train.some((e) => e.job === job && e.label === label)).toBe(true);
    }
  }
  // About one in five held out.
  expect(heldOut.length / all.length).toBeGreaterThan(0.15);
  expect(heldOut.length / all.length).toBeLessThan(0.3);
  // The same whatever the order of the samples.
  const again = split([...all].reverse());
  expect(again.heldOut.map((e) => e.id).sort()).toEqual(heldOut.map((e) => e.id).sort());
  expect(stableHash('chat-ask:dm-thanks')).toBe(stableHash('chat-ask:dm-thanks'));
});

test('writes JSONL the toolkit reads, one list of messages per line, and the split', () => {
  const dir = mkdtempSync(join(tmpdir(), 'didja-adapter-'));
  try {
    const { train, heldOut } = write(dir);
    const lines = (f: string) => readFileSync(join(dir, f), 'utf8').trimEnd().split('\n');
    expect(lines('train.jsonl').length).toBe(train);
    expect(lines('held-out.jsonl').length).toBe(heldOut);
    for (const line of [...lines('train.jsonl'), ...lines('held-out.jsonl')]) {
      const messages = JSON.parse(line) as { role: string; content: string }[];
      expect(Array.isArray(messages)).toBe(true);
      expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant']);
    }
    const ids = JSON.parse(readFileSync(join(dir, 'split.json'), 'utf8')) as { train: string[]; heldOut: string[] };
    expect(ids.train.length).toBe(train);
    expect(ids.heldOut.length).toBe(heldOut);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  expect(jsonl([])).toBe('');
});
