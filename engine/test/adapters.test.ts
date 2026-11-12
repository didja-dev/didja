import { expect, test } from 'bun:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { asana, asanaItems, findTool, fitArgs, jira, jiraItems, jiraStateType, notionItems, objectsIn, todoist, todoistItems } from '../src/adapters.ts';
import type { Connection } from '../src/connections.ts';

/** A stand-in MCP server: the tools it lists, and what each answers. */
function server(tools: Record<string, { props?: string[]; answer: (args: Record<string, unknown>) => unknown }>) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client = {
    listTools: async () => ({ tools: Object.entries(tools).map(([name, t]) => ({ name, inputSchema: { properties: Object.fromEntries((t.props ?? []).map((p) => [p, {}])) } })) }),
    callTool: async ({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) => {
      calls.push({ name, args });
      return { content: [{ type: 'text', text: JSON.stringify(tools[name]!.answer(args)) }] };
    },
  } as unknown as Client;
  return { client, calls };
}
const conn = (kind: Connection['kind'], over: Partial<Connection> = {}): Connection => ({ id: kind, kind, onDone: { state: 'Done' }, whenSure: true, ...over });

test('tools are found by likely names, and only declared arguments are passed', () => {
  const tools = [{ name: 'mcp_asana_search_tasks' }, { name: 'complete-tasks', inputSchema: { properties: { ids: {} } } }];
  expect(findTool(tools, ['asana_search_tasks'])?.name).toBe('mcp_asana_search_tasks');
  expect(findTool(tools, ['complete_tasks'])?.name).toBe('complete-tasks');
  expect(findTool(tools, ['nothing'])).toBeNull();
  expect(fitArgs(tools[1]!, { ids: ['1'], id: '1' })).toEqual({ ids: ['1'] });
  expect(fitArgs(tools[0]!, { a: 1 })).toEqual({ a: 1 }); // declares nothing: pass all
  expect(objectsIn({ data: { results: [{ id: 1 }] } })).toEqual([{ id: 1 }]);
});

test('Jira issues read with their status category, project and address', () => {
  expect(jiraStateType('new', 'To Do')).toBe('unstarted');
  expect(jiraStateType('indeterminate', 'In Progress')).toBe('started');
  expect(jiraStateType('done', 'Done')).toBe('completed');
  expect(jiraStateType('done', "Won't Do")).toBe('canceled');
  expect(jiraStateType('new', 'Backlog')).toBe('backlog');
  const [i] = jiraItems({ issues: [{ id: '10001', key: 'OPS-7', fields: { summary: 'Renew the cert', duedate: '2026-11-11', status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } }, project: { name: 'Ops' }, labels: ['infra'] } }] }, 'https://acme.atlassian.net');
  expect(i).toMatchObject({ id: '10001', key: 'OPS-7', title: 'Renew the cert', url: 'https://acme.atlassian.net/browse/OPS-7', due: '2026-11-11', stateType: 'started', team: 'Ops' });
});

test('Jira: written back by the transition to the chosen state, and a label added to the ones there', async () => {
  const { client, calls } = server({
    getAccessibleAtlassianResources: { answer: () => [{ id: 'cloud-1', url: 'https://acme.atlassian.net' }] },
    getTransitionsForJiraIssue: { props: ['cloudId', 'issueIdOrKey'], answer: () => ({ transitions: [{ id: '21', name: 'Start', to: { name: 'In Progress' } }, { id: '31', name: 'Finish', to: { name: 'Done' } }] }) },
    transitionJiraIssue: { props: ['cloudId', 'issueIdOrKey', 'transition'], answer: () => ({}) },
    getJiraIssue: { props: ['cloudId', 'issueIdOrKey', 'fields'], answer: () => ({ fields: { labels: ['infra'] } }) },
    editJiraIssue: { props: ['cloudId', 'issueIdOrKey', 'fields'], answer: () => ({}) },
  });
  await jira.done(client, conn('jira', { onDone: { state: 'Done', label: 'didja' } }), { id: '10001', key: 'OPS-7' });
  expect(calls.find((c) => c.name === 'transitionJiraIssue')?.args).toEqual({ cloudId: 'cloud-1', issueIdOrKey: 'OPS-7', transition: { id: '31' } });
  expect(calls.find((c) => c.name === 'editJiraIssue')?.args).toEqual({ cloudId: 'cloud-1', issueIdOrKey: 'OPS-7', fields: { labels: ['infra', 'didja'] } });
  // A state it cannot move to from where it is: said, not guessed.
  await expect(jira.done(client, conn('jira', { onDone: { state: 'Shipped' } }), { id: '10001', key: 'OPS-7' })).rejects.toThrow('cannot move to "Shipped"');
});

test('Asana and Todoist tasks read; completing is their way of done', async () => {
  const [a] = asanaItems({ data: [{ gid: '120', name: 'Send the deck', completed: false, due_on: '2026-11-10', permalink_url: 'https://app.asana.com/0/1/120', projects: [{ name: 'Sales' }], memberships: [{ section: { name: 'In Progress' } }] }] });
  expect(a).toMatchObject({ id: '120', title: 'Send the deck', due: '2026-11-10', stateType: 'started', team: 'Sales' });
  const [t] = todoistItems({ tasks: [{ id: '88', content: 'Call the plumber', due: { date: '2026-11-11' }, projectId: 'p1' }] }, new Map([['p1', 'Home']]), false);
  expect(t).toMatchObject({ id: '88', title: 'Call the plumber', due: '2026-11-11', stateType: 'unstarted', team: 'Home' });

  const { client, calls } = server({ 'complete-tasks': { props: ['ids'], answer: () => ({}) } });
  await todoist.done(client, conn('todoist'), { id: '88', key: 'Call the plumber' });
  expect(calls).toEqual([{ name: 'complete-tasks', args: { ids: ['88'] } }]);
  const s = server({ asana_update_task: { props: ['task_id', 'completed'], answer: () => ({}) } });
  await asana.done(s.client, conn('asana'), { id: '120', key: 'Send the deck' });
  expect(s.calls).toEqual([{ name: 'asana_update_task', args: { task_id: '120', completed: true } }]);
});

test('a server without the tool needed is reported by name, and nothing is guessed', async () => {
  const { client, calls } = server({ some_other_tool: { answer: () => ({}) } });
  await expect(todoist.done(client, conn('todoist'), { id: '1', key: 'x' })).rejects.toThrow('Todoist has no tool to complete the task');
  expect(calls).toEqual([]);
});

test('Notion pages read from the usual Status and Due properties', () => {
  const [p] = notionItems({ results: [{ id: 'pg1', url: 'https://notion.so/pg1', properties: {
    Name: { title: [{ plain_text: 'Write the brief' }] }, Status: { status: { name: 'In progress' } }, Due: { date: { start: '2026-11-11' } },
  } }] }, 'Tasks');
  expect(p).toMatchObject({ id: 'pg1', title: 'Write the brief', due: '2026-11-11', state: 'In progress', stateType: 'started', team: 'Tasks' });
});
