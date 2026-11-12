/**
 * Keeping connected tools and the task list in step (see connections.ts).
 *
 * In: your items due today or overdue become tasks, filed under the tool ("Linear"), with the
 * item's key and address kept on the task. An item finished or cancelled in the tool, or no
 * longer yours, is closed here too. Out: a task Didja ticks is written back once, with the
 * state and/or label set up for its connection; one ticked on its own (exact markers, a reply, or
 * accepted automatically) only when the connection allows it ("also when very sure").
 */
import { ADAPTERS } from './adapters.ts';
import { bringOf, isWanted, listConnections, openSession, updateConnection } from './connections.ts';
import type { Connection, ExternalItem, Keychain } from './connections.ts';
import { KINDS, loginKeychain } from './connections.ts';
import type { Store, Task } from './store.ts';

/** What a sync needs from a connection; replaced in tests. */
export interface Remote {
  mine(connection: Connection): Promise<ExternalItem[]>;
  markDone(connection: Connection, itemId: string, key: string): Promise<void>;
}

/** The real thing: over the connection's MCP server. */
export function mcpRemote(store: Store, keychain: Keychain = loginKeychain): Remote {
  return {
    async mine(connection) {
      const { client, server } = await openSession(connection, keychain);
      if (connection.server !== server.url) updateConnection(store, connection.id, { server: server.url });
      try {
        return await ADAPTERS[connection.kind]!.mine(client, connection, new Date());
      } finally {
        await client.close();
      }
    },
    async markDone(connection, itemId, key) {
      const { client } = await openSession(connection, keychain);
      try {
        await ADAPTERS[connection.kind]!.done(client, connection, { id: itemId, key });
      } finally {
        await client.close();
      }
    },
  };
}

export interface SyncStats { created: number; closed: number; written: number; errors: string[] }

const itemKey = (connection: Connection, itemId: string) => `ext:${connection.id}:${itemId}`;
const WRITTEN = (taskId: number) => `ext-written:${taskId}`;

/** Ticked on its own rather than by you: a marker, a reply, or accepted automatically. */
function tickedOnItsOwn(store: Store, task: Task): boolean {
  if (task.acceptedFrom) return true;
  return store.listEvidence(task.id).some((e) => e.kind === 'marker');
}

/** A task of a connected tool ticked here and not yet written back: sync soon. */
export function writebackWaiting(store: Store): boolean {
  return listConnections(store).some((c) => (c.onDone.state || c.onDone.label) &&
    store.externalTasks(c.id).some((t) => t.status === 'done' && store.emailVerdict(WRITTEN(t.id)) === null));
}

export async function syncConnections(store: Store, remote: Remote, now: Date = new Date()): Promise<SyncStats> {
  const stats: SyncStats = { created: 0, closed: 0, written: 0, errors: [] };
  for (const connection of listConnections(store)) {
    const name = KINDS[connection.kind]?.name ?? connection.kind;
    try {
      const items = await remote.mine(connection);
      const byId = new Map(items.map((i) => [i.id, i]));

      // In: what the connection's rules ask for (due today or overdue, in progress, …; some teams).
      const bring = bringOf(connection);
      for (const item of items.filter((i) => isWanted(i, bring, now))) {
        const key = itemKey(connection, item.id);
        const known = store.mailTask(key);
        if (known) {
          if (known.status === 'open') store.touch(known.id, now.toISOString());
          continue;
        }
        const result = store.upsertTask({
          distinct: key,
          title: item.title,
          sourceKind: 'external',
          sourceRef: name,
          confidence: 1,
          position: null,
          ts: now.toISOString(),
          observationId: null,
          markers: [],
          criteria: { service: null, hosts: [], external: { connection: connection.id, id: item.id, key: item.key, url: item.url } },
        });
        store.linkMail(key, result.id);
        if (result.created) {
          stats.created++;
          store.setOrigin(result.id, now.toISOString(), `From ${name}: ${item.key}${item.due ? `, due ${item.due}` : ''}`);
        }
      }

      // Their side: finished, cancelled, or no longer yours there.
      for (const task of store.externalTasks(connection.id)) {
        if (task.status !== 'open' && task.status !== 'snoozed') continue;
        const ext = task.criteria!.external!;
        const item = byId.get(ext.id);
        const type = item?.stateType.toLowerCase() ?? '';
        if (item && type === 'completed') {
          store.setStatus(task.id, 'done', now);
          store.addNote(task.id, 'judged', now.toISOString(), `Done in ${name} (${item.state || 'completed'})`);
          store.recordEmailCheck(WRITTEN(task.id), 'theirs', now); // nothing to write back
          stats.closed++;
        } else if (!item || type === 'canceled' || type === 'cancelled' || type === 'duplicate') {
          store.setStatus(task.id, 'dismissed', now);
          store.addNote(task.id, 'judged', now.toISOString(), item ? `Cancelled in ${name}` : `No longer assigned to you in ${name}`);
          stats.closed++;
        }
      }

      // Out: ticked here, not yet written back.
      const wants = connection.onDone.state || connection.onDone.label;
      for (const task of store.externalTasks(connection.id)) {
        if (task.status !== 'done' || !wants || store.emailVerdict(WRITTEN(task.id)) !== null) continue;
        if (tickedOnItsOwn(store, task) && !connection.whenSure) continue;
        const ext = task.criteria!.external!;
        await remote.markDone(connection, ext.id, ext.key);
        store.recordEmailCheck(WRITTEN(task.id), 'written', now);
        const what = [connection.onDone.state && `moved to ${connection.onDone.state}`, connection.onDone.label && `labelled ${connection.onDone.label}`]
          .filter(Boolean).join(' and ');
        store.addNote(task.id, 'judged', now.toISOString(), `Updated in ${name}: ${ext.key} ${what}`);
        stats.written++;
      }
      updateConnection(store, connection.id, { status: 'connected', lastSync: now.toISOString(), lastError: undefined });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const signedOut = /unauthor|sign in|401|invalid_token/i.test(message);
      updateConnection(store, connection.id, { status: signedOut ? 'signed-out' : 'error', lastError: message.slice(0, 300) });
      stats.errors.push(`${name}: ${message}`);
    }
  }
  return stats;
}
