/** SCR-49 canvases: tasks stay tasks, notes and headings are yours, the export follows. */
import { expect, test } from 'bun:test';
import { canvasMarkdown, canvasText, parseCanvasLine } from '../src/canvas.ts';
import { addManualTask } from '../src/engine.ts';
import { Store } from '../src/store.ts';

const NOW = new Date(2026, 10, 12, 10, 0);

function checklist(store: Store): { parent: number; steps: number[] } {
  const { rootId } = store.upsertChecklist({
    title: 'Before you ship', sourceKind: 'claude-desktop', sourceRef: 'Claude — Deploy', confidence: 1, ts: NOW.toISOString(),
    observationId: null, items: [{ title: 'Set STRIPE_KEY in Vercel', position: 1 }, { title: 'Run the migration', position: 2 }],
  });
  const all = store.listTasks({ all: true });
  return { parent: rootId!, steps: all.filter((t) => !t.isGroup).map((t) => t.id) };
}

test('a canvas holds tasks, headings and notes in your order', () => {
  const store = new Store(':memory:');
  const id = store.createCanvas('Ship to production', NOW);
  const own = addManualTask(store, 'Tell the team', NOW)!;
  store.addCanvasNote(id, 'note', 'Check with Noa before 5pm', NOW);
  store.sendToCanvas(id, [own], NOW);
  expect(store.sendToCanvas(id, [own], NOW)).toEqual([]); // not twice
  const c = store.canvas(id)!;
  expect(c.items.map((i) => [i.kind, i.text])).toEqual([['note', 'Check with Noa before 5pm'], ['task', 'Tell the team']]);
  expect(c.open).toBe(1);
  // Moving the task before the note.
  store.moveCanvasItem(c.items[1]!.id, c.items[0]!.id, NOW);
  expect(store.canvas(id)!.items.map((i) => i.kind)).toEqual(['task', 'note']);
  store.close();
});

test('a task on a canvas is the task itself: ticking it anywhere ticks it there', () => {
  const store = new Store(':memory:');
  const id = store.createCanvas('Ship', NOW);
  const t = addManualTask(store, 'Tell the team', NOW)!;
  store.sendToCanvas(id, [t], NOW);
  store.setStatus(t, 'done', NOW);
  expect(store.canvas(id)!.items[0]!.task!.status).toBe('done');
  expect(store.canvases()[0]!.open).toBe(0);
  // Removing it from the canvas, or deleting the canvas, leaves the task.
  store.removeCanvasItem(store.canvas(id)!.items[0]!.id);
  expect(store.getTask(t)).not.toBeNull();
  store.sendToCanvas(id, [t], NOW);
  store.deleteCanvas(id);
  expect(store.getTask(t)).not.toBeNull();
  expect(store.canvases()).toEqual([]);
  store.close();
});

test('a checklist sends its title as a heading and its steps as tasks', () => {
  const store = new Store(':memory:');
  const { parent, steps } = checklist(store);
  expect(steps.length).toBe(2);
  const id = store.createCanvas('Ship', NOW);
  store.sendToCanvas(id, [parent], NOW);
  const items = store.canvas(id)!.items;
  expect(items.map((i) => [i.kind, i.text])).toEqual([['heading', 'Before you ship'], ['task', 'Set STRIPE_KEY in Vercel'], ['task', 'Run the migration']]);
  store.close();
});

test('notes and headings are edited; a task item is not edited through the canvas', () => {
  const store = new Store(':memory:');
  const id = store.createCanvas('', NOW);
  expect(store.canvas(id)!.title).toBe('Untitled canvas');
  const note = store.addCanvasNote(id, 'heading', 'Later', NOW)!;
  expect(store.editCanvasItem(note, 'Tomorrow', NOW)).toBe(true);
  const t = addManualTask(store, 'Tell the team', NOW)!;
  const [item] = store.sendToCanvas(id, [t], NOW);
  expect(store.editCanvasItem(item!, 'renamed', NOW)).toBe(false);
  expect(store.renameCanvas(id, '  Ship it ', NOW)).toBe(true);
  expect(store.renameCanvas(id, '  ', NOW)).toBe(false);
  expect(store.addCanvasNote(999, 'note', 'x', NOW)).toBeNull();
  store.close();
});

test('exported as Markdown and as text', () => {
  const c = {
    id: 1, title: 'Ship to production', updatedAt: '', open: 1,
    items: [
      { id: 1, kind: 'heading' as const, text: 'Before you ship', level: 0 },
      { id: 2, kind: 'task' as const, text: 'Set STRIPE_KEY in Vercel', level: 0, task: { id: 5, status: 'done' as const, suggestion: null, source: 'Claude — Deploy' } },
      { id: 3, kind: 'task' as const, text: 'Run the migration', level: 1, task: { id: 6, status: 'open' as const, suggestion: null, source: 'Claude — Deploy' } },
      { id: 4, kind: 'note' as const, text: 'Ask Noa about the downtime window', level: 0 },
      { id: 5, kind: 'note' as const, text: '• Check the logs', level: 1 },
    ],
  };
  expect(canvasMarkdown(c)).toBe('# Ship to production\n\n## Before you ship\n\n- [x] Set STRIPE_KEY in Vercel\n  - [ ] Run the migration\nAsk Noa about the downtime window\n\n  - Check the logs\n');
  expect(canvasText(c)).toContain('✓ Set STRIPE_KEY in Vercel\n  ○ Run the migration');
});

test('a typed line is read as Markdown, with indents as levels', () => {
  expect(parseCanvasLine('# Before you ship')).toEqual({ kind: 'heading', text: 'Before you ship', level: 0, done: false });
  expect(parseCanvasLine('[] Run the migration')).toEqual({ kind: 'task', text: 'Run the migration', level: 0, done: false });
  expect(parseCanvasLine('- [ ] Run the migration')).toEqual({ kind: 'task', text: 'Run the migration', level: 0, done: false });
  expect(parseCanvasLine('  - [x] Set the key')).toEqual({ kind: 'task', text: 'Set the key', level: 1, done: true });
  expect(parseCanvasLine('\t\t- Ask Noa first')).toEqual({ kind: 'note', text: '• Ask Noa first', level: 2, done: false });
  expect(parseCanvasLine('> Downtime is 22:00')).toEqual({ kind: 'note', text: 'Downtime is 22:00', level: 0, done: false });
  expect(parseCanvasLine('Tell the team')).toEqual({ kind: 'task', text: 'Tell the team', level: 0, done: false });
  expect(parseCanvasLine('Tell the team', 'note', 1)).toEqual({ kind: 'note', text: 'Tell the team', level: 1, done: false });
  expect(parseCanvasLine('            deep', 'task')!.level).toBe(4);
  expect(parseCanvasLine('   ')).toBeNull();
  expect(parseCanvasLine('#hashtag is not a heading')!.kind).toBe('task');
});

test("items keep their level, and a checklist's steps sit one level in", () => {
  const store = new Store(':memory:');
  const { parent } = checklist(store);
  const id = store.createCanvas('Ship', NOW);
  store.sendToCanvas(id, [parent], NOW);
  expect(store.canvas(id)!.items.map((i) => i.level)).toEqual([0, 1, 1]);
  const note = store.addCanvasNote(id, 'note', 'later', NOW, 2)!;
  expect(store.setCanvasLevel(note, 9, NOW)).toBe(true);
  expect(store.canvas(id)!.items.at(-1)!.level).toBe(4);
  store.setCanvasLevel(note, -3, NOW);
  expect(store.canvas(id)!.items.at(-1)!.level).toBe(0);
  store.close();
});

/** SCR-59: ticking a heading ticks the tasks under it, up to the next heading, and nothing else. */
test('a heading ticks every task under it, and only those', () => {
  const store = new Store(':memory:');
  const id = store.createCanvas('Ship', NOW);
  const { parent, steps } = checklist(store); // heading "Before you ship", its two steps
  store.sendToCanvas(id, [parent], NOW);
  const own = addManualTask(store, 'Run it again tomorrow', NOW)!;
  store.addCanvasTask(id, own, 1, NOW);
  store.addCanvasNote(id, 'note', 'Downtime is 22:00', NOW);
  const snoozed = addManualTask(store, 'Tell the team', NOW)!;
  store.addCanvasTask(id, snoozed, 1, NOW);
  store.setStatus(snoozed, 'snoozed', NOW, new Date(NOW.getTime() + 3_600_000));
  const dismissed = addManualTask(store, 'Order pizza', NOW)!;
  store.addCanvasTask(id, dismissed, 1, NOW);
  store.setStatus(dismissed, 'dismissed', NOW);
  store.addCanvasNote(id, 'heading', 'Later', NOW);
  const later = addManualTask(store, 'Write the release notes', NOW)!;
  store.sendToCanvas(id, [later], NOW);

  const page = () => store.canvas(id)!;
  const [first, second] = page().items.filter((i) => i.kind === 'heading');
  expect(first!.section).toEqual({ tasks: 4, open: 4 }); // the dismissed one is not counted
  expect(second!.section).toEqual({ tasks: 1, open: 1 });

  const changed = store.tickCanvasSection(first!.id, false, NOW);
  expect(changed.sort()).toEqual([...steps, own, snoozed].sort());
  const status = (t: number) => store.getTask(t)!.status;
  expect(steps.map(status)).toEqual(['done', 'done']);
  expect([own, snoozed].map(status)).toEqual(['done', 'done']);
  expect(status(dismissed)).toBe('dismissed');
  expect(status(later)).toBe('open'); // under the next heading
  expect(page().items.find((i) => i.id === first!.id)!.section).toEqual({ tasks: 4, open: 0 });
  expect(store.tickCanvasSection(first!.id, false, NOW)).toEqual([]); // nothing left to tick

  // Undo: those done are open again; the dismissed one stays dismissed.
  expect(store.tickCanvasSection(first!.id, true, NOW).sort()).toEqual([...steps, own, snoozed].sort());
  expect([...steps, own, snoozed].map(status)).toEqual(['open', 'open', 'open', 'open']);
  expect(status(dismissed)).toBe('dismissed');

  // Only a heading ticks: a note, a task item or no item does nothing.
  const note = page().items.find((i) => i.kind === 'note')!;
  const task = page().items.find((i) => i.kind === 'task')!;
  expect(store.tickCanvasSection(note.id, false, NOW)).toEqual([]);
  expect(store.tickCanvasSection(task.id, false, NOW)).toEqual([]);
  expect(store.tickCanvasSection(9999, false, NOW)).toEqual([]);
  expect(status(later)).toBe('open');
  store.close();
});

test('a heading with nothing under it has nothing to tick', () => {
  const store = new Store(':memory:');
  const id = store.createCanvas('Ship', NOW);
  store.addCanvasNote(id, 'heading', 'Empty', NOW);
  store.addCanvasNote(id, 'note', 'Only a note', NOW);
  const heading = store.canvas(id)!.items[0]!;
  expect(heading.section).toEqual({ tasks: 0, open: 0 });
  expect(store.tickCanvasSection(heading.id, false, NOW)).toEqual([]);
  store.close();
});
