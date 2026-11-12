import { expect, test } from 'bun:test';
import { pollOnce } from '../src/engine.ts';
import { Store } from '../src/store.ts';

const NOW = new Date('2026-11-10T10:05:00Z');
const LIST = `Claude responded: x
Once the deploy finishes:
1. Check the login flow works
2. Add the redirect URL in Supabase auth settings`;

function seeded(): Store {
  const store = new Store(':memory:');
  store.insertObservation({
    ts: '2026-11-10T10:00:00.000Z', bundleId: 'com.anthropic.claudefordesktop', app: 'Claude',
    windowTitle: 'Stripe webhooks', url: null, source: 'ax', text: LIST,
  });
  pollOnce(store, NOW);
  return store;
}

test('a task keeps the app and window it was captured in, and what to look for there', () => {
  const store = seeded();
  const step = store.listTasks().find((t) => t.title.startsWith('Add the redirect'))!;
  expect(store.place(step.id)).toEqual({
    bundleId: 'com.anthropic.claudefordesktop', app: 'Claude', window: 'Stripe webhooks', url: null,
    look: ['Add the redirect URL in Supabase auth settings'],
  });
  store.close();
});

test('the place outlives the observation it came from', () => {
  const store = seeded();
  const step = store.listTasks().find((t) => t.title.startsWith('Check the login'))!;
  store.pruneObservations(new Date('2026-11-20T10:00:00Z'));
  expect(store.place(step.id)?.window).toBe('Stripe webhooks');
  store.close();
});

test('a checklist is found by its own words and its first step', () => {
  const store = seeded();
  const step = store.listTasks().find((t) => t.title.startsWith('Check the login'))!;
  expect(step.parentId).not.toBeNull();
  const place = store.place(step.parentId!)!;
  expect(place.window).toBe('Stripe webhooks');
  expect(place.look).toContain('Check the login flow works');
  store.close();
});

test('an email task is looked for by its subject first', () => {
  const store = seeded();
  const step = store.listTasks().find((t) => t.title.startsWith('Check the login'))!;
  store.setOrigin(step.id, '2026-11-10T10:01:00.000Z', 'From an email: Dana Levi — “Q3 budget numbers”');
  expect(store.place(step.id)!.look[0]).toBe('Q3 budget numbers');
  store.close();
});
