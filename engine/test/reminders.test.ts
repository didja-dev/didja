/** SCR-121: captured tasks written to Apple Reminders (opt-in), kept in step both ways. */
import { afterEach, expect, test } from 'bun:test';
import { useAssistants } from '../src/assistants.ts';
import type { Assistant } from '../src/assistants.ts';
import { keepTask } from '../src/engine.ts';
import { MAX_CREATES, remindersPlan, remindersSettings, remindersWritten, reminderSourceOf, setRemindersSettings, taskIdOfLink, taskLink } from '../src/reminders.ts';
import { Store } from '../src/store.ts';

const T0 = new Date('2026-11-14T09:00:00Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

afterEach(() => useAssistants(null));

function task(store: Store, title: string, sourceKind = 'chat', sourceRef = 'Slack — Design', min = 5): number {
  return store.upsertTask({ title, sourceKind, sourceRef, confidence: 1, position: null, ts: at(min).toISOString(), observationId: null, markers: [], criteria: null }).id;
}

/** Turn it on at T0 and write what the first sync asks for, as the app would. */
function writeAll(store: Store, min = 10): Map<number, string> {
  const plan = remindersPlan(store, [], at(min));
  const ids = new Map(plan.create.map((c) => [c.taskId, `R-${c.taskId}`]));
  remindersWritten(store, { created: [...ids].map(([taskId, reminderId]) => ({ taskId, reminderId })) }, at(min));
  return ids;
}

test('off: nothing is written, and what Reminders shows changes nothing', () => {
  const store = new Store(':memory:');
  const id = task(store, 'Send Noa the March invoice');
  expect(remindersSettings(store).on).toBe(false);
  const plan = remindersPlan(store, [{ id: 'R-1', completed: true }], at(10));
  expect(plan.create).toEqual([]);
  expect(plan.complete).toEqual([]);
  // Even a link the engine knows is left alone while it is off.
  store.linkReminder(id, 'R-1', at(6));
  expect(remindersPlan(store, [], at(11))).toMatchObject({ create: [], complete: [], ticked: 0, dismissed: 0 });
  expect(store.getTask(id)!.status).toBe('open');
  store.close();
});

test('on: the title and a link back only, for tasks captured from when it was turned on', () => {
  const store = new Store(':memory:');
  const before = store.upsertTask({ title: 'Old task', sourceKind: 'chat', sourceRef: 'Slack — Design', confidence: 1, position: null, ts: at(-60).toISOString(), observationId: null, markers: [], criteria: null }).id;
  setRemindersSettings(store, { on: true }, T0);
  const id = task(store, 'Send Noa the March invoice');
  const plan = remindersPlan(store, [], at(10));
  expect(plan.list).toBe('Didja');
  expect(plan.create).toEqual([{ taskId: id, title: 'Send Noa the March invoice', url: `didja://task/${id}`, notes: null }]);
  expect(plan.create.some((c) => c.taskId === before)).toBe(false);
  store.close();
});

test('"include who asked" adds the chat as the note; otherwise there is none', () => {
  const store = new Store(':memory:');
  setRemindersSettings(store, { on: true, who: true }, T0);
  const id = task(store, 'Book the venue', 'chat', 'Slack — Offsite');
  expect(remindersPlan(store, [], at(10)).create).toEqual([{ taskId: id, title: 'Book the venue', url: taskLink(id), notes: 'Slack — Offsite' }]);
  store.close();
});

test('what is written once is not written again', () => {
  const store = new Store(':memory:');
  setRemindersSettings(store, { on: true }, T0);
  task(store, 'Send Noa the March invoice');
  writeAll(store);
  expect(remindersPlan(store, [{ id: [...store.reminderLinks()][0]!.reminderId, completed: false }], at(12)).create).toEqual([]);
  store.close();
});

test('the sources chosen decide which tasks go there', () => {
  const store = new Store(':memory:');
  useAssistants([{ sourceKind: 'claude-code' } as unknown as Assistant]);
  setRemindersSettings(store, { on: true, sources: ['mylist', 'ai'] }, T0);
  const chat = task(store, 'Reply to Sam');
  const mail = task(store, 'Pay the Acme invoice', 'email', 'Inbox');
  const ai = task(store, 'Run the migration', 'claude-code', 'Claude Code — api');
  const kept = keepTask(store, 'Renew the passport', at(5))!;
  expect(reminderSourceOf(store.getTask(chat)!)).toBe('chat');
  expect(reminderSourceOf(store.getTask(mail)!)).toBe('email');
  const made = remindersPlan(store, [], at(10)).create.map((c) => c.taskId).sort();
  expect(made).toEqual([ai, kept].sort());
  store.close();
});

test('ticked in Didja: the reminder is completed, and recorded once the app wrote it', () => {
  const store = new Store(':memory:');
  setRemindersSettings(store, { on: true }, T0);
  const id = task(store, 'Send Noa the March invoice');
  const ids = writeAll(store);
  store.changeByYou(id, 'done', at(20));
  const plan = remindersPlan(store, [{ id: ids.get(id)!, completed: false }], at(21));
  expect(plan.complete).toEqual([ids.get(id)!]);
  // Not yet confirmed: asked for again.
  expect(remindersPlan(store, [{ id: ids.get(id)!, completed: false }], at(22)).complete).toEqual([ids.get(id)!]);
  remindersWritten(store, { completed: [ids.get(id)!] });
  expect(remindersPlan(store, [{ id: ids.get(id)!, completed: true }], at(23)).complete).toEqual([]);
  expect(store.getTask(id)!.status).toBe('done');
  store.close();
});

test('completed in Reminders: the task is ticked as done by you, once', () => {
  const store = new Store(':memory:');
  setRemindersSettings(store, { on: true }, T0);
  const id = task(store, 'Send Noa the March invoice');
  const other = task(store, 'Book the venue');
  const ids = writeAll(store);
  const plan = remindersPlan(store, [{ id: ids.get(id)!, completed: true }, { id: ids.get(other)!, completed: false }], at(20));
  expect(plan.ticked).toBe(1);
  expect(plan.complete).toEqual([]);
  expect(store.getTask(id)!.status).toBe('done');
  expect(store.getTask(other)!.status).toBe('open');
  expect(store.listEvidence(id).some((e) => e.detail === 'Done: you completed its reminder in Reminders')).toBe(true);

  // Reopened in Didja afterwards: the reminder is reopened, the task is not ticked again.
  store.changeByYou(id, 'open', at(30));
  const again = remindersPlan(store, [{ id: ids.get(id)!, completed: true }, { id: ids.get(other)!, completed: false }], at(31));
  expect(again.ticked).toBe(0);
  expect(again.reopen).toEqual([ids.get(id)!]);
  expect(store.getTask(id)!.status).toBe('open');
  store.close();
});

test('un-completed in Reminders: nothing reopens here, and the reminder is not completed again', () => {
  const store = new Store(':memory:');
  setRemindersSettings(store, { on: true }, T0);
  const id = task(store, 'Send Noa the March invoice');
  const ids = writeAll(store);
  store.changeByYou(id, 'done', at(20));
  remindersPlan(store, [{ id: ids.get(id)!, completed: false }], at(21));
  remindersWritten(store, { completed: [ids.get(id)!] });
  const plan = remindersPlan(store, [{ id: ids.get(id)!, completed: false }], at(30));
  expect(plan).toMatchObject({ complete: [], reopen: [], ticked: 0 });
  expect(store.getTask(id)!.status).toBe('done');
  store.close();
});

test('deleted in Reminders: the task is dismissed', () => {
  const store = new Store(':memory:');
  setRemindersSettings(store, { on: true }, T0);
  const id = task(store, 'Send Noa the March invoice');
  const keep = task(store, 'Book the venue');
  const ids = writeAll(store);
  const plan = remindersPlan(store, [{ id: ids.get(keep)!, completed: false }], at(20));
  expect(plan.dismissed).toBe(1);
  expect(store.getTask(id)!.status).toBe('dismissed');
  expect(store.getTask(keep)!.status).toBe('open');
  expect(store.reminderLinks().map((l) => l.taskId)).toEqual([keep]);
  store.close();
});

test('every reminder missing at once dismisses nothing (a lost list, not your deletions)', () => {
  const store = new Store(':memory:');
  setRemindersSettings(store, { on: true }, T0);
  const tasks = ['Send Noa the invoice', 'Book the venue', 'Call the Acme office'].map((t) => task(store, t));
  writeAll(store);
  const plan = remindersPlan(store, [], at(20));
  expect(plan.held).toBe(true);
  expect(plan.dismissed).toBe(0);
  expect(tasks.map((t) => store.getTask(t)!.status)).toEqual(['open', 'open', 'open']);
  expect(store.reminderLinks().length).toBe(3);
  store.close();
});

test('a reminder Didja did not write is never touched, even with a Didja link in it', () => {
  const store = new Store(':memory:');
  setRemindersSettings(store, { on: true }, T0);
  const id = task(store, 'Send Noa the March invoice');
  const ids = writeAll(store);
  const yours = { id: 'YOURS', completed: false };
  const plan = remindersPlan(store, [{ id: ids.get(id)!, completed: false }, yours, { id: 'YOURS-DONE', completed: true }], at(20));
  expect(plan).toMatchObject({ complete: [], reopen: [], ticked: 0, dismissed: 0 });
  expect(store.getTask(id)!.status).toBe('open');
  // And recording a write for it changes nothing.
  remindersWritten(store, { completed: ['YOURS'], reopened: ['YOURS-DONE'] });
  expect(store.reminderLinks()).toEqual([{ taskId: id, reminderId: ids.get(id)!, writtenAt: at(10).toISOString(), synced: 'open' }]);
  store.close();
});

test('when Reminders could not be read, nothing is applied', () => {
  const store = new Store(':memory:');
  setRemindersSettings(store, { on: true }, T0);
  const id = task(store, 'Send Noa the March invoice');
  writeAll(store);
  expect(remindersPlan(store, null, at(20))).toMatchObject({ create: [], dismissed: 0 });
  expect(store.getTask(id)!.status).toBe('open');
  store.close();
});

test('anything past the cap waits for the next sync', () => {
  const store = new Store(':memory:');
  setRemindersSettings(store, { on: true }, T0);
  for (let i = 0; i < MAX_CREATES + 5; i++) store.upsertTask({ distinct: `cap ${i}`, title: `Item ${i}`, sourceKind: 'chat', sourceRef: `Slack — c${i}`, confidence: 1, position: null, ts: at(5).toISOString(), observationId: null, markers: [], criteria: null });
  expect(remindersPlan(store, [], at(10)).create.length).toBe(MAX_CREATES);
  store.close();
});

test('settings: a list name, sources, and turning on again restarts the clock', () => {
  const store = new Store(':memory:');
  expect(setRemindersSettings(store, { list: '  ' }).list).toBe('Didja');
  expect(setRemindersSettings(store, { list: 'Work' }).list).toBe('Work');
  expect(setRemindersSettings(store, { sources: ['email', 'chat'] }).sources).toEqual(['chat', 'email']);
  setRemindersSettings(store, { on: true }, T0);
  setRemindersSettings(store, { on: false }, at(5));
  expect(setRemindersSettings(store, { on: true }, at(60)).since).toBe(at(60).toISOString());
  expect(taskIdOfLink('didja://task/42')).toBe(42);
  expect(taskIdOfLink('https://example.com/task/42')).toBeNull();
  store.close();
});
