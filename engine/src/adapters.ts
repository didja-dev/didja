/**
 * One adapter per task tool: how to read your items over its MCP server, how to write a
 * completion back, and what to offer in the Connections window. Linear was tried live; Jira,
 * Asana, Todoist and Notion were built from their servers' published tools without an account to
 * try them (the maintainer: "build untested"), so each picks its tools at run time from the server's own
 * list, by a few likely names, passes only the arguments a tool declares, and reports a tool it
 * cannot find rather than guess.
 */
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Connection, ExternalItem } from './connections.ts';
import { bringOf, linearItems, localDay, resultJSON } from './connections.ts';

export interface Choices { states: string[]; labels: string[]; teams: string[] }

export interface Adapter {
  /** Your items, open and recently finished (so finishing one there closes it here). */
  mine(client: Client, connection: Connection, now: Date): Promise<ExternalItem[]>;
  /** Write a completion back: the state and/or label set up for the connection. */
  done(client: Client, connection: Connection, item: { id: string; key: string }): Promise<void>;
  choices(client: Client, connection: Connection): Promise<Choices>;
}

// --- Finding tools and reading answers -------------------------------------------------------

interface Tool { name: string; inputSchema?: { properties?: Record<string, unknown> } }

const toolLists = new WeakMap<Client, Promise<Tool[]>>();

async function toolsOf(client: Client): Promise<Tool[]> {
  let list = toolLists.get(client);
  if (!list) {
    list = client.listTools().then((r) => r.tools as Tool[]);
    toolLists.set(client, list);
  }
  return list;
}

/** A tool by one of its likely names: exactly (ignoring case, "-" and "_"), else one containing it. */
export function findTool(tools: Tool[], names: string[]): Tool | null {
  const plain = (s: string) => s.toLowerCase().replace(/[-_]/g, '');
  for (const n of names) {
    const hit = tools.find((t) => plain(t.name) === plain(n));
    if (hit) return hit;
  }
  for (const n of names) {
    const hit = tools.find((t) => plain(t.name).endsWith(plain(n)));
    if (hit) return hit;
  }
  return null;
}

export class MissingTool extends Error {
  constructor(server: string, what: string) {
    super(`${server} has no tool to ${what}; its tools may have changed`);
  }
}

/** Only the arguments a tool declares, when it declares any. */
export function fitArgs(tool: Tool, args: Record<string, unknown>): Record<string, unknown> {
  const declared = tool.inputSchema?.properties;
  if (!declared || Object.keys(declared).length === 0) return args;
  return Object.fromEntries(Object.entries(args).filter(([k, v]) => k in declared && v !== undefined));
}

async function call(client: Client, server: string, names: string[], what: string, args: Record<string, unknown>): Promise<unknown> {
  const tool = findTool(await toolsOf(client), names);
  if (!tool) throw new MissingTool(server, what);
  const result = await client.callTool({ name: tool.name, arguments: fitArgs(tool, args) });
  if ((result as { isError?: boolean }).isError) {
    throw new Error(`${server} refused to ${what}: ${JSON.stringify(resultJSON(result) ?? '').slice(0, 200)}`);
  }
  return resultJSON(result);
}

async function has(client: Client, names: string[]): Promise<boolean> {
  return findTool(await toolsOf(client), names) !== null;
}

/** The first list of objects in an answer, however it is wrapped. */
export function objectsIn(json: unknown, depth = 0): Record<string, unknown>[] {
  if (Array.isArray(json)) return json.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x));
  if (!json || typeof json !== 'object' || depth > 3) return [];
  for (const value of Object.values(json)) {
    const found = objectsIn(value, depth + 1);
    if (found.length > 0) return found;
  }
  return [];
}

/** A value by dotted path, first path that has one. */
export function pick(o: unknown, ...paths: string[]): unknown {
  for (const path of paths) {
    let v: unknown = o;
    for (const part of path.split('.')) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[part] : undefined;
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}
const str = (o: unknown, ...paths: string[]): string | undefined => {
  const v = pick(o, ...paths);
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;
};
const names = (list: Record<string, unknown>[], ...paths: string[]) =>
  [...new Set(list.map((o) => str(o, ...paths)).filter((n): n is string => !!n))];
const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);

// --- Linear (tried live) ---------------------------------------------------------------------

export const linear: Adapter = {
  async mine(client) {
    const items: ExternalItem[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 4; page++) {
      const json = await call(client, 'Linear', ['list_issues'], 'list your issues', {
        assignee: 'me', limit: 250, fields: ['id', 'uuid', 'title', 'url', 'dueDate', 'status', 'statusType', 'team'], ...(cursor ? { cursor } : {}),
      }) as { hasNextPage?: boolean; cursor?: string } | null;
      items.push(...linearItems(json));
      if (!json?.hasNextPage || !json.cursor) break;
      cursor = json.cursor;
    }
    return items;
  },
  async done(client, connection, item) {
    const args: Record<string, unknown> = { id: item.id };
    if (connection.onDone.state) args.state = connection.onDone.state;
    if (connection.onDone.label) args.addLabels = [connection.onDone.label];
    if (Object.keys(args).length === 1) return;
    await call(client, 'Linear', ['save_issue'], 'update the issue', args);
  },
  async choices(client) {
    const teams = names(objectsIn(await call(client, 'Linear', ['list_teams'], 'list your teams', { limit: 50 }).catch(() => null)), 'name');
    const states: string[] = [];
    for (const team of teams.slice(0, 10)) {
      const found = names(objectsIn(await call(client, 'Linear', ['list_issue_statuses'], 'list states', { team }).catch(() => null)), 'name');
      for (const s of found) if (!states.includes(s)) states.push(s);
    }
    const labels = names(objectsIn(await call(client, 'Linear', ['list_issue_labels'], 'list labels', { limit: 250 }).catch(() => null)), 'name');
    return { states, labels, teams };
  },
};

// --- Jira (Atlassian's remote MCP server) ----------------------------------------------------

async function jiraSite(client: Client): Promise<{ cloudId: string; url: string }> {
  const sites = objectsIn(await call(client, 'Jira', ['getAccessibleAtlassianResources'], 'find your Jira site', {}));
  const site = sites.find((s) => str(s, 'id')) ?? {};
  const cloudId = str(site, 'id');
  if (!cloudId) throw new Error('Jira: no Atlassian site is open to this sign-in');
  return { cloudId, url: (str(site, 'url') ?? '').replace(/\/$/, '') };
}

/** Jira's status category ("new", "indeterminate", "done") in the words the rules use. */
export function jiraStateType(category: string | undefined, status: string | undefined): string {
  if (/backlog/i.test(status ?? '')) return 'backlog';
  switch ((category ?? '').toLowerCase()) {
    case 'done': return /cancel|won.?t|reject|duplicate/i.test(status ?? '') ? 'canceled' : 'completed';
    case 'indeterminate': return 'started';
    default: return 'unstarted';
  }
}

export function jiraItems(json: unknown, site: string): ExternalItem[] {
  return objectsIn(json).flatMap((i) => {
    const key = str(i, 'key');
    const title = str(i, 'fields.summary', 'summary');
    if (!key || !title) return [];
    const status = str(i, 'fields.status.name', 'status.name', 'status');
    return [{
      id: str(i, 'id') ?? key, key, title,
      url: site ? `${site}/browse/${key}` : null,
      due: (str(i, 'fields.duedate', 'duedate') ?? '').slice(0, 10) || null,
      state: status ?? '',
      stateType: jiraStateType(str(i, 'fields.status.statusCategory.key', 'status.statusCategory.key'), status),
      team: str(i, 'fields.project.name', 'project.name'),
      labels: (pick(i, 'fields.labels', 'labels') as string[] | undefined) ?? [],
    } as ExternalItem];
  });
}

export const jira: Adapter = {
  async mine(client) {
    const site = await jiraSite(client);
    // Open ones, and ones finished lately, so finishing one in Jira closes it here.
    const json = await call(client, 'Jira', ['searchJiraIssuesUsingJql'], 'search your issues', {
      cloudId: site.cloudId,
      jql: 'assignee = currentUser() AND (statusCategory != Done OR updated >= -14d) ORDER BY updated DESC',
      fields: ['summary', 'status', 'duedate', 'project', 'labels'], maxResults: 100,
    });
    return jiraItems(json, site.url);
  },
  async done(client, connection, item) {
    const { cloudId } = await jiraSite(client);
    const want = connection.onDone.state;
    if (want) {
      const transitions = objectsIn(await call(client, 'Jira', ['getTransitionsForJiraIssue'], 'list the issue\'s transitions', { cloudId, issueIdOrKey: item.key }));
      const go = transitions.find((t) => [str(t, 'to.name'), str(t, 'name')].some((n) => n?.toLowerCase() === want.toLowerCase()));
      if (!go) throw new Error(`Jira: ${item.key} cannot move to "${want}" from where it is`);
      await call(client, 'Jira', ['transitionJiraIssue'], 'move the issue', { cloudId, issueIdOrKey: item.key, transition: { id: str(go, 'id') } });
    }
    if (connection.onDone.label) {
      const issue = await call(client, 'Jira', ['getJiraIssue'], 'read the issue', { cloudId, issueIdOrKey: item.key, fields: ['labels'] });
      const current = (pick(issue, 'fields.labels', 'labels') as string[] | undefined) ?? [];
      if (!current.includes(connection.onDone.label)) {
        await call(client, 'Jira', ['editJiraIssue'], 'label the issue', { cloudId, issueIdOrKey: item.key, fields: { labels: [...current, connection.onDone.label] } });
      }
    }
  },
  async choices(client, connection) {
    const items = await jira.mine(client, connection, new Date());
    const projects = (await has(client, ['getVisibleJiraProjects']))
      ? names(objectsIn(await call(client, 'Jira', ['getVisibleJiraProjects'], 'list projects', { cloudId: (await jiraSite(client)).cloudId }).catch(() => null)), 'name')
      : [];
    return {
      states: [...new Set(items.map((i) => i.state).filter(Boolean))],
      labels: [...new Set(items.flatMap((i) => (i as ExternalItem & { labels?: string[] }).labels ?? []))],
      teams: [...new Set([...projects, ...items.map((i) => i.team).filter((t): t is string => !!t)])],
    };
  },
};

// --- Asana ----------------------------------------------------------------------------------

const ASANA_SEARCH = ['asana_search_tasks', 'search_tasks', 'asana_get_tasks', 'get_tasks'];
const ASANA_FIELDS = 'name,completed,due_on,permalink_url,projects.name,memberships.section.name';

async function asanaWorkspaces(client: Client): Promise<string[]> {
  const list = objectsIn(await call(client, 'Asana', ['asana_list_workspaces', 'list_workspaces', 'get_workspaces'], 'list your workspaces', {}));
  return list.map((w) => str(w, 'gid', 'id')).filter((g): g is string => !!g).slice(0, 3);
}

export function asanaItems(json: unknown): ExternalItem[] {
  return objectsIn(json).flatMap((t) => {
    const id = str(t, 'gid', 'id');
    const title = str(t, 'name');
    if (!id || !title) return [];
    const section = str(t, 'memberships.0.section.name') ?? '';
    const completed = pick(t, 'completed') === true;
    return [{
      id, key: title.slice(0, 24), title,
      url: str(t, 'permalink_url') ?? null,
      due: (str(t, 'due_on') ?? '').slice(0, 10) || null,
      state: completed ? 'Completed' : section,
      stateType: completed ? 'completed' : /progress|doing|working/i.test(section) ? 'started' : /backlog|someday|later/i.test(section) ? 'backlog' : 'unstarted',
      team: str(t, 'projects.0.name'),
    }];
  });
}

export const asana: Adapter = {
  async mine(client, _c, now) {
    const items: ExternalItem[] = [];
    for (const workspace of await asanaWorkspaces(client)) {
      for (const completed of [false, true]) {
        items.push(...asanaItems(await call(client, 'Asana', ASANA_SEARCH, 'search your tasks', {
          workspace, workspace_gid: workspace, assignee_any: 'me', assignee: 'me', completed, opt_fields: ASANA_FIELDS,
          ...(completed ? { completed_on_after: localDay(daysAgo(now, 14)) } : {}),
        })));
      }
    }
    return items;
  },
  async done(client, _connection, item) {
    // Asana's own "done" is completing the task; a chosen state other than Completed is not a thing there.
    await call(client, 'Asana', ['asana_update_task', 'update_task'], 'complete the task', { task_id: item.id, task_gid: item.id, completed: true });
  },
  async choices(client, connection) {
    const items = await asana.mine(client, connection, new Date());
    return { states: ['Completed'], labels: [], teams: [...new Set(items.map((i) => i.team).filter((t): t is string => !!t))] };
  },
};

// --- Todoist --------------------------------------------------------------------------------

async function todoistProjects(client: Client): Promise<Map<string, string>> {
  if (!(await has(client, ['find-projects', 'get-projects']))) return new Map();
  const list = objectsIn(await call(client, 'Todoist', ['find-projects', 'get-projects'], 'list projects', {}).catch(() => null));
  return new Map(list.flatMap((p) => (str(p, 'id') && str(p, 'name') ? [[str(p, 'id')!, str(p, 'name')!]] : [])));
}

export function todoistItems(json: unknown, projects: Map<string, string>, completed: boolean): ExternalItem[] {
  return objectsIn(json).flatMap((t) => {
    const id = str(t, 'id');
    const title = str(t, 'content', 'title');
    if (!id || !title) return [];
    return [{
      id, key: title.slice(0, 24), title,
      url: str(t, 'url') ?? `https://app.todoist.com/app/task/${id}`,
      due: (str(t, 'due.date', 'dueDate', 'due') ?? '').slice(0, 10) || null,
      state: completed ? 'Completed' : 'Open',
      stateType: completed ? 'completed' : 'unstarted',
      team: projects.get(str(t, 'projectId', 'project_id') ?? '') ?? undefined,
    }];
  });
}

export const todoist: Adapter = {
  async mine(client, _c, now) {
    const projects = await todoistProjects(client);
    const open = todoistItems(await call(client, 'Todoist', ['find-tasks', 'get-tasks'], 'list your tasks', { limit: 200 }), projects, false);
    const done = (await has(client, ['find-completed-tasks']))
      ? todoistItems(await call(client, 'Todoist', ['find-completed-tasks'], 'list finished tasks', { since: localDay(daysAgo(now, 14)), until: localDay(now), limit: 200 }).catch(() => null), projects, true)
      : [];
    return [...open, ...done];
  },
  async done(client, connection, item) {
    if (connection.onDone.label) {
      await call(client, 'Todoist', ['update-tasks'], 'label the task', { tasks: [{ id: item.id, labels: [connection.onDone.label] }] }).catch(() => undefined);
    }
    await call(client, 'Todoist', ['complete-tasks', 'close-task', 'complete-task'], 'complete the task', { ids: [item.id], id: item.id });
  },
  async choices(client) {
    const labels = (await has(client, ['find-labels']))
      ? names(objectsIn(await call(client, 'Todoist', ['find-labels'], 'list labels', {}).catch(() => null)), 'name') : [];
    return { states: ['Completed'], labels, teams: [...(await todoistProjects(client)).values()] };
  },
};

// --- Notion ---------------------------------------------------------------------------------

/** A page's property, by the usual names a task database gives it. */
function notionProp(page: unknown, kind: 'status' | 'due' | 'assignee'): unknown {
  const props = (pick(page, 'properties') ?? {}) as Record<string, unknown>;
  const wanted = { status: /^(status|state|stage)$/i, due: /^(due|due date|deadline|date)$/i, assignee: /^(assignee|assigned to|owner|person)$/i }[kind];
  const key = Object.keys(props).find((k) => wanted.test(k));
  return key ? props[key] : undefined;
}

export function notionItems(json: unknown, database: string): ExternalItem[] {
  return objectsIn(json).flatMap((p) => {
    const id = str(p, 'id');
    const title = str(p, 'title', 'properties.Name.title.0.plain_text', 'properties.Task.title.0.plain_text', 'properties.Title.title.0.plain_text');
    if (!id || !title) return [];
    const statusProp = notionProp(p, 'status');
    const status = str(statusProp, 'status.name', 'select.name', 'name') ?? (typeof statusProp === 'string' ? statusProp : '');
    const due = str(notionProp(p, 'due'), 'date.start', 'start') ?? (typeof notionProp(p, 'due') === 'string' ? notionProp(p, 'due') as string : '');
    return [{
      id, key: title.slice(0, 24), title, url: str(p, 'url') ?? null,
      due: due.slice(0, 10) || null,
      state: status,
      stateType: /done|complete|closed/i.test(status) ? 'completed' : /cancel|won.?t/i.test(status) ? 'canceled'
        : /progress|doing/i.test(status) ? 'started' : /backlog|someday/i.test(status) ? 'backlog' : 'unstarted',
      team: database,
    }];
  });
}

export const notion: Adapter = {
  async mine(client, connection) {
    // Tasks live in databases you choose ("From"); with none chosen, nothing comes in.
    const items: ExternalItem[] = [];
    for (const database of bringOf(connection).teams) {
      const found = objectsIn(await call(client, 'Notion', ['notion-search', 'search'], 'find the database', { query: database, filters: { object_type: 'database' } }));
      const db = found.find((d) => (str(d, 'title', 'name') ?? '').toLowerCase() === database.toLowerCase()) ?? found[0];
      const id = str(db, 'id');
      if (!id) continue;
      items.push(...notionItems(await call(client, 'Notion', ['notion-query-database', 'query-database', 'notion-fetch', 'fetch'], 'read the database', { id, database_id: id }), database));
    }
    return items;
  },
  async done(client, connection, item) {
    const state = connection.onDone.state ?? 'Done';
    await call(client, 'Notion', ['notion-update-page', 'update-page'], 'update the page', {
      data: { page_id: item.id, command: 'update_properties', properties: { Status: state } }, page_id: item.id, properties: { Status: state },
    });
  },
  async choices(client) {
    const dbs = names(objectsIn(await call(client, 'Notion', ['notion-search', 'search'], 'list databases', { query: '', filters: { object_type: 'database' } }).catch(() => null)), 'title', 'name');
    return { states: ['Done', 'Complete', 'Completed'], labels: [], teams: dbs };
  },
};

export const ADAPTERS: Record<string, Adapter> = { linear, jira, asana, todoist, notion };
