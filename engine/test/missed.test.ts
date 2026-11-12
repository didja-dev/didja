/** "Didja Missed This…": the report, and places you teach, which only let screens be looked at. */
import { expect, test } from 'bun:test';
import { pollOnce } from '../src/engine.ts';
import { learnedWhere, siteOf } from '../src/looksdone.ts';
import { doneAt, missedReport, placeWord, rewordPlacesOnce } from '../src/missed.ts';
import { lookAgainAt } from '../src/engine.ts';
import { Store } from '../src/store.ts';

const NOW = new Date(2026, 10, 12, 10, 0);
const later = (m: number) => new Date(NOW.getTime() + m * 60_000);

function seeded() {
  const store = new Store(':memory:');
  const { rootId } = store.upsertChecklist({
    title: 'Use the Planner app in your list', sourceKind: 'claude-code', sourceRef: 'Claude Code — Planner setup', confidence: 1,
    ts: NOW.toISOString(), observationId: null,
    items: [{ title: 'Set Schedule Mode to Fixed effort and select Save', position: 1 },
            { title: 'Turn on Project Level Override and select Save', position: 2 }],
  });
  const steps = store.listTasks().filter((t) => !t.isGroup);
  return { store, root: rootId!, first: steps[0]!, second: steps[1]! };
}
const screen = (store: Store, m: number, url: string, text: string) => store.insertObservation({
  ts: later(m).toISOString(), bundleId: 'com.microsoft.edgemac', app: 'Microsoft Edge', windowTitle: 'Parameters', url, source: 'ax', text,
});

test('the word a place is remembered for comes from the site, then the conversation, never the step', () => {
  const at = (url: string, text = '', windowTitle = 'Edge') => ({ url, text, windowTitle });
  expect(placeWord('Claude Code — Planner_Workbench repo', [at('https://x.example.net/planner/#main'), at('https://x.example.net/planner/admin'), at('https://x.example.net/')])).toBe('planner');
  // Plumbing in the path is not an app: then the conversation's name, if it shows on those screens.
  expect(placeWord('Claude Code — Planner_Workbench repo', [at('https://x.example.net/main.aspx', 'Planner settings')])).toBe('planner');
  expect(placeWord('Claude Code — Planner_Workbench repo', [at('https://x.example.net/main.aspx', 'Holidays')])).toBeNull();
  expect(placeWord('Claude — Ship it', [at('https://x.example.net/admin/users')])).toBeNull();
});

test('places taught with a word from the step are given the site\'s word, once', () => {
  const { store, first } = seeded();
  screen(store, 5, 'https://acme.crm4.example.com/planner/holidays', 'Holidays');
  const id = store.addDonePlace(first.id, 'acme.crm4.example.com', 'import', later(6))!;
  expect(rewordPlacesOnce(store, later(7))).toBe(1);
  expect(store.donePlacesShown().find((p) => p.id === id)!.word).toBe('planner');
  store.setDonePlaceWord(id, 'import');
  expect(rewordPlacesOnce(store, later(8))).toBe(0); // once only
  store.close();
});

test('a taught place counts only at that site, for the same conversation or the same app word', () => {
  const o = { app: 'Microsoft Edge', url: 'https://acme.crm4.example.com/main.aspx?id=1' };
  expect(siteOf(o)).toBe('acme.crm4.example.com');
  expect(siteOf({ app: 'Planner', url: null })).toBe('planner');
  const place = { site: 'acme.crm4.example.com', source: 7, word: 'planner' };
  expect(learnedWhere({ title: 'Select Save', sourceId: 7 }, o, [place])).toBe(true);
  expect(learnedWhere({ title: 'Open Planner settings', sourceId: 9 }, o, [place])).toBe(true);
  expect(learnedWhere({ title: 'Select Save', sourceId: 9 }, o, [place])).toBe(false);
  expect(learnedWhere({ title: 'Select Save', sourceId: 7 }, { ...o, url: 'https://other.example.com/' }, [place])).toBe(false);
  expect(learnedWhere({ title: 'Select Save', sourceId: 7 }, o, [])).toBe(false);
});

test('before you teach a place, its screens are not looked at; after, they are, and only the model can suggest done', () => {
  const { store, first, second } = seeded();
  const site = 'https://acme.crm4.example.com/main.aspx?pagetype=entityrecord';
  const asked: string[] = [];
  const looker = (q: { task: string }) => { asked.push(q.task); return 'done' as const; };
  screen(store, 5, site, 'Project Parameters\nSchedule Mode: Fixed effort\nSet Schedule Mode to Fixed effort and select Save\nSaved');
  pollOnce(store, later(6), { looker });
  expect(asked).toEqual([]); // the site names nothing in the step

  store.addDonePlace(first.id, 'acme.crm4.example.com', 'planner', later(7));
  store.setStatus(first.id, 'done', later(7));
  screen(store, 8, site, 'Project Parameters\nProject Level Override: Yes\nTurn on Project Level Override and select Save\nSaved');
  pollOnce(store, later(9), { looker });
  expect(asked).toEqual(['Turn on Project Level Override and select Save']);
  expect(store.getTask(second.id)!.status).toBe('open'); // suggested, never ticked by the place itself
  expect(store.getTask(second.id)!.suggestion).not.toBeNull();
  store.close();
});

test('a taught place does not make the model say done', () => {
  const { store, first, second } = seeded();
  store.addDonePlace(first.id, 'acme.crm4.example.com', null, NOW);
  screen(store, 8, 'https://acme.crm4.example.com/x', 'Project Parameters\nTurn on Project Level Override and select Save');
  pollOnce(store, later(9), { looker: () => 'notDone' });
  expect(store.getTask(second.id)!.suggestion).toBeNull();
  expect(store.getTask(second.id)!.status).toBe('open');
  store.close();
});

test('the report says where Didja looks and what it saw since', () => {
  const { store, first } = seeded();
  screen(store, 5, 'https://acme.crm4.example.com/x', 'Project Parameters\nSaved');
  screen(store, 6, 'https://acme.crm4.example.com/y', 'Schedule Mode: Fixed effort');
  store.insertObservation({ ts: later(7).toISOString(), bundleId: 'com.apple.Notes', app: 'Notes', windowTitle: 'Notes', url: null, source: 'ax', text: 'groceries' });
  const r = missedReport(store, first.id, later(10))!;
  expect(r.title).toBe('Set Schedule Mode to Fixed effort and select Save');
  expect(r.why).toContain('Not ticked automatically');
  // Where you were most recently comes first.
  expect(r.places.map((p) => [p.site, p.screens, p.watched, p.word])).toEqual([['notes', 1, false, null], ['acme.crm4.example.com', 2, false, null]]); // no app in its paths, and the screens never name "planner"
  expect(r.places[1]!.recent.map((s) => s.lines)).toEqual([['Schedule Mode: Fixed effort'], ['Project Parameters', 'Saved']]);
  expect(r.places[1]!.lines).toEqual(['Project Parameters', 'Saved', 'Schedule Mode: Fixed effort']);
  expect(r.watching[0]).toContain('schedule');
  expect(r.keywords).toContain('schedule');
  expect(r.conversation).toBe('Claude Code — Planner setup');
  expect(r.openInConversation).toBe(1);
  expect(r.acceptsLooksDone).toBe(false);
  store.addDonePlace(first.id, 'acme.crm4.example.com', 'planner', later(11));
  const after = missedReport(store, first.id, later(12))!;
  expect(after.places[1]!.watched).toBe(true);
  expect(after.watching.at(-1)).toContain('acme.crm4.example.com');
  expect(missedReport(store, 999)).toBeNull();
  store.close();
});

test('this screen shows it done: ticked with that screen as evidence, the site taught, and the rest looked at again', () => {
  const { store, first, second } = seeded();
  const shown = screen(store, 5, 'https://acme.crm4.example.com/x', 'Project Parameters\nSchedule Mode: Fixed effort\nSaved');
  screen(store, 6, 'https://acme.crm4.example.com/y', 'Project Parameters\nTurn on Project Level Override and select Save\nSaved');
  expect(doneAt(store, first.id, shown, later(10))).toEqual({ site: 'acme.crm4.example.com' });
  expect(store.getTask(first.id)!.status).toBe('done');
  expect(store.listEvidence(first.id).some((e) => e.detail?.includes('You showed it done'))).toBe(true);
  expect(store.donePlaces().map((p) => p.site)).toEqual(['acme.crm4.example.com']);
  // The screens already kept there are looked at again for the other step: suggested, not ticked.
  const asked: string[] = [];
  expect(lookAgainAt(store, (q) => { asked.push(q.task); return 'done'; }, 'acme.crm4.example.com', later(11))).toBe(1);
  expect(asked).toEqual(['Turn on Project Level Override and select Save']);
  expect(store.getTask(second.id)!.status).toBe('open');
  expect(store.getTask(second.id)!.suggestion).not.toBeNull();
  expect(doneAt(store, first.id, 99999, later(12))).toBeNull();
  store.close();
});

test('the places you taught are shown with their conversation, and can be forgotten', () => {
  const { store, first } = seeded();
  const id = store.addDonePlace(first.id, 'acme.crm4.example.com', 'planner', NOW)!;
  expect(store.donePlacesShown()).toEqual([{ id, site: 'acme.crm4.example.com', word: 'planner', conversation: 'Claude Code — Planner setup', createdAt: NOW.toISOString() }]);
  expect(store.forgetDonePlace(id)).toBe(true);
  expect(store.donePlacesShown()).toEqual([]);
  store.close();
});
