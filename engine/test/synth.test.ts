/**
 * The generated made-up corpus (eval/synth.ts): the same for the same seed, whole frames held out,
 * only made-up people and addresses, and no wrong tick or wrong owner in its benchmark scenarios.
 */
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runScenario, totals } from '../bench/run.ts';
import { synthExamples } from '../eval/adapter-data.ts';
import { isHebrew } from '../eval/prompts.ts';
import {
  CHAT_FRAMES, LIST_FRAMES, LOOK_FRAMES, ME, PEOPLE, PEOPLE_HE, SCENARIO_FRAMES, synthChats, synthLists, synthLooks, synthScenarios,
} from '../eval/synth.ts';

const roster = new Set(readFileSync(join(import.meta.dir, '../../profiles/fixtures/names.txt'), 'utf8')
  .split('\n').map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith('#')));

const lists = synthLists(400), chats = synthChats(600), looks = synthLooks(200), scenarios = synthScenarios(60);
const label = { lists: (s: (typeof lists)[number]) => s.expect, chats: (s: (typeof chats)[number]) => String(s.expect), looks: (s: (typeof looks)[number]) => s.expect };

test('the same seed gives the same corpus, another seed another', () => {
  expect(synthLists(400)).toEqual(lists);
  expect(synthChats(600)).toEqual(chats);
  expect(synthScenarios(60)).toEqual(scenarios);
  expect(JSON.stringify(synthChats(600, 2))).not.toBe(JSON.stringify(chats));
});

test('every frame is used, ids and samples are unique, and counts are met', () => {
  for (const [list, frames, n] of [[lists, LIST_FRAMES, 400], [chats, CHAT_FRAMES, 600], [looks, LOOK_FRAMES, 200], [scenarios, SCENARIO_FRAMES, 60]] as const) {
    expect(list.length).toBe(n);
    expect(new Set(list.map((s) => s.frame))).toEqual(new Set(frames.map((f) => f.id)));
    expect(new Set(list.map((s) => s.id)).size).toBe(n);
    expect(new Set(list.map((s) => JSON.stringify({ ...s, id: '' }))).size).toBe(n);
  }
});

test('whole frames are held out: never one frame in both splits, and every job and answer has both', () => {
  const check = <S extends { frame: string; split: string }>(list: S[], key: (s: S) => string) => {
    const splits = new Map<string, Set<string>>();
    for (const s of list) splits.set(s.frame, (splits.get(s.frame) ?? new Set()).add(s.split));
    for (const set of splits.values()) expect(set.size).toBe(1);
    for (const answer of new Set(list.map(key))) {
      const of = list.filter((s) => key(s) === answer);
      expect(new Set(of.map((s) => s.split))).toEqual(new Set(['train', 'held-out']));
    }
  };
  check(lists, label.lists);
  check(chats, label.chats);
  check(looks, label.looks);
});

test('no answer is rare: each makes up at least a quarter of its job', () => {
  for (const [list, key] of [[lists, label.lists], [chats, label.chats], [looks, label.looks]] as const) {
    const counts = new Map<string, number>();
    for (const s of list as { expect: unknown }[]) counts.set((key as (x: unknown) => string)(s), (counts.get((key as (x: unknown) => string)(s)) ?? 0) + 1);
    for (const c of counts.values()) expect(c / list.length).toBeGreaterThanOrEqual(0.25);
  }
});

test('only made-up people and addresses', () => {
  for (const p of [...PEOPLE, ...PEOPLE_HE]) expect(roster.has(p.full.toLowerCase())).toBe(true);
  const firsts = new Set([...PEOPLE, ...PEOPLE_HE].map((p) => p.first));
  for (const c of chats) {
    expect(firsts.has(c.from)).toBe(true);
    for (const b of c.before ?? []) expect(b.from === 'me' || firsts.has(b.from)).toBe(true);
  }
  const text = JSON.stringify([lists, chats, looks, scenarios]);
  for (const [, domain] of text.matchAll(/[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g)) expect(['example.com', 'acme.com']).toContain(domain!.toLowerCase());
  for (const [, host] of text.matchAll(/https?:\/\/([\w.-]+)/g)) expect(host!.endsWith('example.com')).toBe(true);
  for (const s of scenarios) {
    for (const line of s.steps.flatMap((step) => step.text)) {
      const m = line.match(/^⟦Chat message: (.+) \((?:direct|group)\) — from (.+?)(?:, mentions me)? — Today at \d+:\d\d⟧$/);
      if (line.startsWith('⟦Chat message')) expect(m).not.toBeNull();
      if (m) for (const name of [m[1]!, m[2]!]) if (name !== 'me') expect({ name, onRoster: roster.has(name.toLowerCase()) }).toEqual({ name, onRoster: true });
    }
  }
});

test('asks name the person who asked, in the language they asked in, never the reader', () => {
  for (const c of chats.filter((x) => x.expect)) {
    expect(c.task).toBeTruthy();
    expect(c.task!).toContain(c.from);
    expect(isHebrew(c.task!)).toBe(isHebrew(c.message));
    for (const me of ME) expect(c.task!).not.toContain(me);
    const words = c.task!.split(/\s+/).length;
    expect(words).toBeGreaterThanOrEqual(3);
  }
  for (const c of chats.filter((x) => !x.expect)) expect(c.task).toBeUndefined();
});

test('as adapter examples, held-out frames go to held out only', () => {
  const { train, heldOut } = synthExamples({ lists: 120, chats: 200, looks: 80, scenarios: 0 });
  const heldIds = new Set([...synthLists(120), ...synthChats(200), ...synthLooks(80)].filter((s) => s.split === 'held-out').map((s) => s.id));
  expect(heldOut.length).toBeGreaterThan(0);
  expect(heldOut.every((e) => heldIds.has(e.id))).toBe(true);
  expect(train.some((e) => heldIds.has(e.id))).toBe(false);
});

test('with no model, the generated scenarios tick nothing wrongly and give nothing to the wrong person', () => {
  const results = scenarios.map((s) => runScenario(s));
  const t = totals(results, scenarios);
  expect(results.flatMap((r) => r.wrongTicks)).toEqual([]);
  expect(t.wrongTicks).toBe(0);
  expect(t.ownerErrors).toBe(0);
  expect(t.unwanted).toBe(0);
}, 60_000);
