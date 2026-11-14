/** SCR-102: every model field is checked before use, and the answer types stay flat. Made-up content only. */
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  namedIn, oneOf, validAudience, validChatAnswer, validDay, validNeed, validReplyVerdict, validSeen, validStrings, validTitle,
} from '../src/validate.ts';

const ODD: unknown[] = ['Done', 'yes', 'settled', '', ' done', 'notdone', 'user ', 42, true, null, undefined, {}, ['done']];

test('enums: only the allowed values count; anything else is the answer that does the least', () => {
  expect(oneOf('b', ['a', 'b'] as const, 'a')).toBe('b');
  expect(oneOf('c', ['a', 'b'] as const, 'a')).toBe('a');
  expect(validAudience('user')).toBe('user');
  expect(validAudience('assistant')).toBe('assistant');
  expect(validSeen('done')).toBe('done');
  expect(validSeen('notDone')).toBe('notDone');
  expect(validReplyVerdict('settles')).toBe('settles');
  expect(validReplyVerdict('defers')).toBe('defers');
  expect(validNeed('reply')).toBe('reply');
  expect(validNeed('action')).toBe('action');
  for (const odd of ODD) {
    expect(validAudience(odd)).toBeNull();
    expect(validSeen(odd)).toBe('unsure');
    expect(validReplyVerdict(odd)).toBe('unsure');
    expect(validNeed(odd)).toBe('none');
  }
});

test('a validator never turns an answer into one that ticks or makes a task', () => {
  for (const odd of [...ODD, 'unsure', 'notDone', 'defers', 'none']) {
    expect(validSeen(odd) === 'done').toBe(odd === 'done');
    expect(validReplyVerdict(odd) === 'settles').toBe(odd === 'settles');
    expect(validNeed(odd) !== 'none').toBe(odd === 'reply' || odd === 'action');
    expect(validChatAnswer({ asks: odd, task: 'Send the slides' }).asks).toBe(odd === true);
  }
});

test('chat answers: asks only on a literal true; the task is text', () => {
  expect(validChatAnswer({ asks: true, task: 'Send Noa the slides' })).toEqual({ asks: true, task: 'Send Noa the slides' });
  expect(validChatAnswer({ asks: 'true', task: 'Send Noa the slides' })).toEqual({ asks: false, task: 'Send Noa the slides' });
  expect(validChatAnswer({ asks: true, task: ['Send'] })).toEqual({ asks: true, task: '' });
  expect(validChatAnswer({})).toEqual({ asks: false, task: '' });
});

test('titles are one line of text; days must exist; lists keep only strings', () => {
  expect(validTitle('Stripe webhooks\nand more')).toBe('Stripe webhooks');
  expect(validTitle('   ')).toBeNull();
  expect(validTitle(7)).toBeNull();
  expect(validDay('2026-11-20')).toBe('2026-11-20');
  expect(validDay('2026-02-30')).toBeNull();
  expect(validDay('20/11/2026')).toBeNull();
  expect(validDay(null)).toBeNull();
  expect(validStrings(['a', 3, null, 'b'])).toEqual(['a', 'b']);
  expect(validStrings('a')).toEqual([]);
});

test('a name must be in what the model was shown, or one of yours; a made-up one is left out', () => {
  const shown = 'From: Dana Levi\nPlease send the signed contract.\nThanks,\nTamar - Finance';
  expect(namedIn('Tamar - Finance', shown)).toBe('Tamar - Finance');
  expect(namedIn('Dana Levi', shown)).toBe('Dana Levi');
  expect(namedIn('Rachel Green', shown)).toBeUndefined();
  expect(namedIn('Dan', shown)).toBeUndefined();
  expect(namedIn('Mike', shown, ['Mike Rosen'])).toBe('Mike');
  expect(namedIn('נועה כץ', 'מאת: נועה כץ\nאפשר את הקובץ?')).toBe('נועה כץ');
  expect(namedIn('', shown)).toBeUndefined();
  expect(namedIn(42, shown)).toBeUndefined();
});

/**
 * The answer types the app asks Apple's on-device model to fill (`@Generable`): flat. A struct's
 * fields are text, true/false, numbers, lists of text, or a `@Generable` string enum; never another
 * struct. Small models follow flat schemas far more reliably than nested ones.
 */
test('every @Generable answer type in the app is flat', () => {
  const dir = join(import.meta.dir, '../../app/Didja');
  const source = readdirSync(dir).filter((f) => f.endsWith('.swift')).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
  const enums = new Set([...source.matchAll(/@Generable\s+enum\s+(\w+)\s*:\s*String/g)].map((m) => m[1]!));
  const structs = [...source.matchAll(/@Generable\s+struct\s+(\w+)\s*\{([\s\S]*?)\n\s*\}/g)];
  expect(structs.length).toBeGreaterThanOrEqual(6);
  const allowed = new Set(['String', 'Bool', 'Int', 'Double', '[String]', ...enums]);
  for (const [, name, body] of structs) {
    for (const field of body!.matchAll(/^\s*var\s+\w+\s*:\s*([\w[\]?]+)/gm)) {
      expect({ type: name, field: field[1] }).toEqual({ type: name, field: allowed.has(field[1]!) ? field[1] : 'flat' });
    }
  }
});
