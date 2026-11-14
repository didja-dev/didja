/**
 * A doc open in the Claude app's side pane: capture keeps its boxes as "[ ]" and "[x]" under a
 * "⟦section⟧" line (an AXDocumentArticle). Its unticked boxes are steps for you; ticked ones are not.
 */
import { expect, test } from 'bun:test';
import { pollOnce } from '../src/engine.ts';
import { Store } from '../src/store.ts';

const DOC = `⟦Message 12⟧
You said: write up what's left for me
⟦Message 13⟧
Claude responded: Here it is, with your action items as a checklist.
Done.
⟦section⟧
Launch build update — 14 Nov 2026
Your action items
Start with 1: it unblocks the most. Full details are in docs/owner/ in the repo.
1. Tables and columns. Unblocks scoring, states and timesheets.
[ ] Paste \`docs/owner/lists-plan.md\` into Copilot in SharePoint to create the 9 lists.
[ ] Import each list in Power Apps, then apply the fixes in \`docs/owner/schema-fixes.md\`.
[x] Add the 16 columns to the 6 existing tables.
[ ] Work in this order: Sandbox, then Test, then Production.
2. Decisions.
[ ] Deploy \`functions/ask/\` to the staging API, following its README.
[ ] Look at the "Group created, not linked" error in Test.`;

function observe(store: Store, text: string, ts = '2026-11-14T15:30:00.000Z') {
  store.insertObservation({ ts, bundleId: 'com.anthropic.claudefordesktop', app: 'Claude', windowTitle: 'Launch work - Claude Code', url: null, source: 'ax', text });
}

test('a doc in the Claude app: its unticked boxes become tasks, the ticked one does not', () => {
  const store = new Store(':memory:');
  observe(store, DOC);
  pollOnce(store, new Date('2026-11-14T15:30:05Z'), { judge: () => ({ audience: 'user', model: 'm' }) });
  const titles = store.listTasks({ all: true }).filter((t) => !t.isGroup).map((t) => t.title);
  expect(titles).toContain('Paste `docs/owner/lists-plan.md` into Copilot in SharePoint to create the 9 lists.');
  expect(titles).toContain('Deploy `functions/ask/` to the staging API, following its README.');
  expect(titles.some((t) => t.startsWith('Add the 16 columns'))).toBe(false);
  // The doc's numbered headings are not steps.
  expect(titles.some((t) => t.startsWith('Tables and columns'))).toBe(false);
  store.close();
});

test('the same doc without boxes (as it was read before) still makes no tasks', () => {
  const store = new Store(':memory:');
  observe(store, DOC.replace(/^\[[ x]\] /gm, ''));
  pollOnce(store, new Date('2026-11-14T15:30:05Z'), { judge: () => ({ audience: 'user', model: 'm' }) });
  expect(store.listTasks({ all: true })).toEqual([]);
  store.close();
});
