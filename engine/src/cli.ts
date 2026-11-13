#!/usr/bin/env bun
import { profiles, profilesDir } from './profiles.ts';
import { canvasMarkdown, canvasText, parseCanvasLine } from './canvas.ts';
import { doneAt, missedReport, rewordPlacesOnce, wordForPlace } from './missed.ts';
import { enabled, places, readLog, serve } from './mcp.ts';
import { localField, localModelOf, setLocalModel } from './localmodel.ts';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { addManualTask, keepTask, lookAgainAt, myNames, namesOf, pollOnce, runLoop } from './engine.ts';
import { ADAPTERS } from './adapters.ts';
import { bringOf, forgetSecrets, KINDS, listConnections, openSession, saveConnections, signIn, updateConnection } from './connections.ts';
import type { Bring, Connection } from './connections.ts';
import { mcpRemote, syncConnections, writebackWaiting } from './sync.ts';
import type { Judge, Titler } from './engine.ts';
import type { MailReader } from './email.ts';
import type { ChatReader, ReplyJudge } from './chat.ts';
import type { Looker } from './looksdone.ts';
import { cleanCriteria, describeCriteria } from './donecriteria.ts';
import type { CriteriaWriter, DoneCriteria } from './donecriteria.ts';
import { JOBS, Store } from './store.ts';
import { formatQuality, qualityReport } from './quality.ts';
import { requiredMarkers } from './markers.ts';
import type { Evidence, Job, Observation, Task, TaskNode, TaskStatus } from './store.ts';

const USAGE = `didja <command>

  observations [--tail] [--full] [-n <count>]
                      show what the capture layer has written (--tail follows live)
  tasks [--all] [--json]
                      show open tasks (--all includes done/dismissed)
  status              is capture running, and when did it last see something
  profiles [--json]   the app profiles: how each chat and email app is read
  mcp                 serve your own Claude over MCP (stdio), when turned on; see docs/AGENTS.md
  mcp on|off|status|log [--json]
                      let your Claude read Didja (masked), or not; and what it has asked
  local-model [status [--json] | on <model> | off]
                      use a model in Ollama on this Mac (127.0.0.1) for emails and "looks done?", before Apple's
  run                 extract tasks from new observations every 5s
  poll                one extraction pass, then exit
  nudges              checklists left unfinished for hours, as JSON (each is reported once)
  why <id>            what would tick a task, and what has been seen so far
  place <id>          where a task was captured (JSON), for "Go to Source"
  context <id>        how it looked there: the lines around it (JSON), kept while it is open
  add <title>         add a task yourself; it is ticked like any other when it is seen done
  canvas list | new <title> | show <id> | send <id> <task…> | add <id> <title> | note <id> <text>
         | heading <id> <text> | line <id> [--note] [--level n] <markdown> | level <item> <0-4>
         | edit <item> <text> | move <item> <before|end> | remove <item>
         | rename <id> <title> | delete <id> | export <id> [md|txt]
                      canvases: pages of tasks, headings and notes you keep open while you work (JSON)
  missed <id> [--learn <site> | --done-at <screen id>] | places | forget <place id>
                      "Didja Missed This…": what Didja knows about a task you finished unnoticed (JSON);
                      --learn: it was done at <site>, so look there for steps like it
  keep <title>        add a task to My List: it stays until you tick it (Siri adds here)
  fresh-start [--undo | --status]
                      mark every open task done for a clean list (My List stays); --undo puts them back
  done <id>           mark a task done (a checklist's id ticks all its steps)
  done-all <id>       mark done everything still open from the same conversation as task <id>
  quality [--days N] [--json]
                      how Didja is doing: tasks made, ticked for you, asked, answered, cleared (counts only, last 7 days by default)
  snooze <id> [for]   hide a task for a while: 30m, 2h, 3d or tomorrow (default 1h)
  notyet <id>         a task marked "looks done?" is not done: keep it open
  dismiss <id>        dismiss a task (not a real to-do)
  connections [--json]  connected task tools (Linear) and how they are doing
  connect <tool>      connect linear, jira, asana, todoist or notion: sign in in your browser (network: that tool only)
  connection <id> state|label [<name>] | whensure on|off | choices
                      what to change in the tool when an item is ticked here
  connection <id> bring due|started|unstarted|backlog on|off | team <name> on|off | team all
                      which of your items come in, and from which teams
  disconnect <id>     forget a connection and its keys
  sync                sync connected tools now
  merge <keep> <other>  the same thing seen in two places: shown as one, finished together
  notsame <id> <id>   two tasks suggested as the same are not
  names [--json] | set [<name>] | add <name> | remove <name>
                      your name and nicknames, in any language, for chats (empty set: the Mac's name)
  rename <id> <name>  give an item your own name (no name: back to the captured one)
  collapse <id|all>   fold a parent's steps away
  expand <id|all>     show them again
  reopen <id>         put a task back to open
`;

const MARK: Record<TaskStatus, string> = { open: '[ ]', done: '[x]', dismissed: '[-]', snoozed: '[z]' };

function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 90 * 60) return `${Math.round(s / 60)}m ago`;
  if (s < 36 * 3600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function taskLine(node: TaskNode, indent: string, now: number): string {
  const t = node.task;
  const head = `${indent}${MARK[t.status]} #${String(t.id).padEnd(4)} ${t.title}`;
  if (node.children.length > 0) {
    const steps = leaves(node);
    return `${head}  (${steps.filter((s) => s.status === 'done').length}/${steps.length} done)`;
  }
  // "auto" marks tasks that can tick themselves once their markers are seen.
  const hint = t.suggestion ? `  · looks done? (${t.suggestion})` : t.status === 'open' && t.auto ? '  · auto' : '';
  return `${head}  · seen ${ago(t.lastSeenAt, now)}${hint}`;
}

/** The steps under a node, at any depth. */
function leaves(node: TaskNode): Task[] {
  return node.children.length === 0 ? [node.task] : node.children.flatMap(leaves);
}

/** Tasks by source, each checklist with its steps (and their sub-steps) nested under it. */
export function formatTasks(tree: TaskNode[], now = Date.now()): string {
  if (tree.length === 0) return 'No open tasks.';
  const lines: string[] = [];
  let current = -1;
  const print = (node: TaskNode, depth: number) => {
    lines.push(taskLine(node, '  ' + '    '.repeat(depth), now));
    for (const child of node.children) print(child, depth + 1);
  };
  for (const root of tree) {
    if (root.task.sourceId !== current) {
      if (lines.length) lines.push('');
      lines.push(`${root.task.sourceRef}  (${root.task.sourceKind})`);
      current = root.task.sourceId;
    }
    print(root, 0);
  }
  return lines.join('\n');
}

export function formatObservation(o: Observation, full = false): string {
  const time = new Date(o.ts).toLocaleTimeString('en-GB');
  const where = o.windowTitle && o.windowTitle !== o.app ? `${o.app} — ${o.windowTitle}` : o.app;
  const all = o.text.split('\n');
  const shown = full ? all : all.slice(0, 8);
  const body = shown.map((l) => `    ${full ? l : l.slice(0, 160)}`);
  if (shown.length < all.length) body.push(`    … ${all.length - shown.length} more lines`);
  return `${time}  ${where}  [${o.source}]${o.url ? `  ${o.url}` : ''}\n${body.join('\n')}`;
}

/** "30m", "2h", "3d" or "tomorrow" (9:00 the next morning). */
export function parseSnooze(spec: string, now: Date = new Date()): Date | null {
  if (spec === 'tomorrow') {
    const next = new Date(now);
    next.setDate(next.getDate() + 1);
    next.setHours(9, 0, 0, 0);
    return next;
  }
  const m = spec.match(/^(\d+)([mhd])$/);
  if (!m) return null;
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 'm' | 'h' | 'd'];
  return new Date(now.getTime() + Number(m[1]) * unit);
}

/**
 * The on-device model, reached through the app's own binary (`Didja --judge`),
 * which sits next to this one inside the app bundle. Undefined when the engine
 * is run outside the bundle, in which case lists are judged by wording alone.
 */
export function findJudge(local: () => string | null = () => null): Judge | undefined {
  const binary = process.env.DIDJA_JUDGE ?? join(dirname(process.execPath), '../MacOS/Didja');
  if (!existsSync(binary)) return undefined;
  return (list) => {
    try {
      // The local model, if one is on, is asked first (SCR-70: it measured better on engine/eval/lists.ts).
      const run = Bun.spawnSync([binary, '--judge'], { stdin: Buffer.from(JSON.stringify({ ...list, ...localField(local()) })), timeout: 45_000 });
      const reply = JSON.parse(run.stdout.toString()) as { available?: boolean; audience?: string; model?: string };
      if (!reply.available || (reply.audience !== 'user' && reply.audience !== 'assistant')) return null;
      return { audience: reply.audience, model: reply.model ?? 'on-device' };
    } catch {
      return null;
    }
  };
}

/** The on-device model again, asked for a short checklist title (`Didja --title`). */
export function findTitler(): Titler | undefined {
  const binary = process.env.DIDJA_JUDGE ?? join(dirname(process.execPath), '../MacOS/Didja');
  if (!existsSync(binary)) return undefined;
  return (list) => {
    try {
      const run = Bun.spawnSync([binary, '--title'], { stdin: Buffer.from(JSON.stringify(list)), timeout: 30_000 });
      const reply = JSON.parse(run.stdout.toString()) as { available?: boolean; title?: string };
      return reply.available && typeof reply.title === 'string' ? reply.title : null;
    } catch {
      return null;
    }
  };
}

/**
 * The on-device model once more, asked whether a screen shows a task done (`Didja --looks-done`).
 * `local` names the local model in use, if one is on (localmodel.ts): the app asks it first.
 */
export function findLooker(local: () => string | null = () => null): Looker | undefined {
  const binary = process.env.DIDJA_JUDGE ?? join(dirname(process.execPath), '../MacOS/Didja');
  if (!existsSync(binary)) return undefined;
  return (input) => {
    try {
      const run = Bun.spawnSync([binary, '--looks-done'], { stdin: Buffer.from(JSON.stringify({ ...input, ...localField(local()) })), timeout: 45_000 });
      const reply = JSON.parse(run.stdout.toString()) as { available?: boolean; seen?: string };
      if (!reply.available) return null;
      return reply.seen === 'done' || reply.seen === 'notDone' ? reply.seen : 'unsure';
    } catch {
      return null;
    }
  };
}

/** The on-device model asked whether a chat message asks something of you (`Didja --chat`). */
export function findChatReader(): ChatReader | undefined {
  const binary = process.env.DIDJA_JUDGE ?? join(dirname(process.execPath), '../MacOS/Didja');
  if (!existsSync(binary)) return undefined;
  return (question) => {
    try {
      const run = Bun.spawnSync([binary, '--chat'], { stdin: Buffer.from(JSON.stringify(question)), timeout: 30_000 });
      const reply = JSON.parse(run.stdout.toString()) as { available?: boolean; asks?: boolean; task?: string };
      if (!reply.available) return null;
      return { asks: reply.asks === true, task: reply.task ?? '' };
    } catch {
      return null;
    }
  };
}

/** The on-device model asked whether your reply settles an ask or puts it off (`Didja --chat-reply`). */
export function findReplyJudge(): ReplyJudge | undefined {
  const binary = process.env.DIDJA_JUDGE ?? join(dirname(process.execPath), '../MacOS/Didja');
  if (!existsSync(binary)) return undefined;
  return (question) => {
    try {
      const run = Bun.spawnSync([binary, '--chat-reply'], { stdin: Buffer.from(JSON.stringify(question)), timeout: 30_000 });
      const reply = JSON.parse(run.stdout.toString()) as { available?: boolean; verdict?: string };
      if (!reply.available) return null;
      return reply.verdict === 'settles' || reply.verdict === 'defers' ? reply.verdict : 'unsure';
    } catch {
      return null;
    }
  };
}

/** The on-device model asked what a screen showing a task done would have (`Didja --criteria`, SCR-67). */
export function findCriteriaWriter(): CriteriaWriter | undefined {
  const binary = process.env.DIDJA_JUDGE ?? join(dirname(process.execPath), '../MacOS/Didja');
  if (!existsSync(binary)) return undefined;
  return (question) => {
    try {
      const run = Bun.spawnSync([binary, '--criteria'], { stdin: Buffer.from(JSON.stringify(question)), timeout: 30_000 });
      const reply = JSON.parse(run.stdout.toString()) as { available?: boolean; where?: unknown; success?: unknown; pending?: unknown; tokens?: unknown };
      if (!reply.available) return null;
      return cleanCriteria(reply);
    } catch {
      return null;
    }
  };
}

/** The on-device model asked whether an email needs a reply (`Didja --needs-reply`); the local model first, if one is on. */
export function findMailReader(local: () => string | null = () => null): MailReader | undefined {
  const binary = process.env.DIDJA_JUDGE ?? join(dirname(process.execPath), '../MacOS/Didja');
  if (!existsSync(binary)) return undefined;
  return (email) => {
    try {
      const run = Bun.spawnSync([binary, '--needs-reply'], { stdin: Buffer.from(JSON.stringify({ ...email, ...localField(local()) })), timeout: 45_000 });
      const reply = JSON.parse(run.stdout.toString()) as { available?: boolean; need?: string; task?: string; asker?: string };
      if (!reply.available) return null;
      const need = reply.need === 'reply' || reply.need === 'action' ? reply.need : 'none';
      return { need, task: reply.task ?? '', asker: reply.asker };
    } catch {
      return null;
    }
  };
}

export function formatWhy(task: Task, evidence: Evidence[], done: DoneCriteria | null = null): string {
  const lines = [`#${task.id} ${MARK[task.status]} ${task.title}`, `  from ${task.sourceRef}`];
  for (const note of evidence.filter((e) => e.kind === 'origin')) lines.push(`  ${note.detail}`);
  if (task.isGroup) {
    lines.push('  A checklist: done when none of its steps is left open. Ticking it ticks every open step.');
    if (task.modelTitled) lines.push(`  Titled by the on-device model. Introduced on screen as: “${task.capturedTitle}”`);
    if (task.renamed) lines.push(`  Renamed by you. Captured as: “${task.capturedTitle}”`);
    return lines.join('\n');
  }
  const required = requiredMarkers(task.markers, task.criteria);
  const seen = new Map(evidence.filter((e) => e.kind === 'marker').map((e) => [e.marker, e]));
  if (required.length === 0) {
    lines.push(
      task.criteria?.reply
        ? '  When a reply in that conversation is seen in your mail, you are asked to confirm it is done.'
        : task.markers.some((m) => m.kind === 'env' || m.kind === 'url')
        ? '  Not ticked automatically: it names no single service to look on.'
        : '  Not ticked automatically: nothing exact to look for (no command, env var or URL).',
    );
  } else {
    lines.push('  Ticked when all of these have been seen:');
    for (const m of required) {
      const where = m.kind === 'command' ? 'typed at a terminal prompt' : `on ${task.criteria?.service}`;
      const hit = seen.get(m.value);
      lines.push(`    ${hit ? '[x]' : '[ ]'} ${m.value}  (${where})${hit ? `  — ${hit.detail}, ${new Date(hit.ts).toLocaleString('en-GB')}` : ''}`);
    }
  }
  if (done && required.length === 0 && !task.criteria?.reply && (task.status === 'open' || task.status === 'snoozed')) lines.push(`  ${describeCriteria(done)}`);
  if (task.status === 'done' && required.some((m) => !seen.has(m.value))) lines.push('  Marked done by hand.');
  for (const note of evidence.filter((e) => e.kind === 'judged')) lines.push(`  ${note.detail}.`);
  if (task.status === 'done' && task.acceptedFrom) lines.push(`  Ticked for you: it looked done in ${task.acceptedFrom}. Reopen it if it is not done.`);
  if (task.suggestion) lines.push(`  Looks done: seen in ${task.suggestion}. Confirm with "done ${task.id}", or "notyet ${task.id}".`);
  for (const note of evidence.filter((e) => e.kind === 'rejected')) lines.push(`  ${note.detail}.`);
  if (task.status === 'snoozed' && task.snoozedUntil) lines.push(`  Snoozed until ${new Date(task.snoozedUntil).toLocaleString('en-GB')}.`);
  return lines.join('\n');
}

async function observations(store: Store, args: string[]): Promise<number> {
  const full = args.includes('--full');
  const nAt = args.indexOf('-n');
  const count = nAt === -1 ? 10 : Number(args[nAt + 1]);
  if (!Number.isInteger(count) || count < 0) {
    console.error('usage: didja observations [--tail] [--full] [-n <count>]');
    return 1;
  }
  const recent = store.latestObservations(count);
  for (const o of recent) console.log(formatObservation(o, full));
  if (!args.includes('--tail')) {
    if (recent.length === 0) console.log('No observations yet. Is the Didja app running with Accessibility access?');
    return 0;
  }

  let last = recent.at(-1)?.id ?? 0;
  let stop = false;
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { stop = true; });
  console.error('Following new observations. Ctrl-C to stop.');
  while (!stop) {
    for (const o of store.observationsAfter(last)) {
      console.log(formatObservation(o, full));
      last = o.id;
    }
    await Bun.sleep(1000);
  }
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(USAGE);
    return command ? 0 : 1;
  }

  const store = new Store();
  try {
    switch (command) {
      case 'observations':
        return await observations(store, args);
      case 'nudges': {
        console.log(JSON.stringify(store.takeNudges()));
        return 0;
      }
      case 'status': {
        const last = store.latestObservations(1)[0];
        console.log(`Capture: ${store.getMeta('capture_status') ?? 'the app has not reported yet'}`);
        console.log(`Last observation: ${last ? `${ago(last.ts)} (${last.app})` : 'none'}`);
        console.log(`Open tasks: ${store.listTasks().length}`);
        return 0;
      }
      case 'local-model': {
        const sub = args[0];
        if (sub === 'on' && args[1]) {
          if (!setLocalModel(store, args[1])) { console.error(`not a model name: ${args[1]}`); return 1; }
          console.log(`Emails and "looks done?" are asked of ${args[1]} in Ollama on this Mac first, then Apple's model.`);
          return 0;
        }
        if (sub === 'off') {
          setLocalModel(store, null);
          console.log("Only Apple's on-device model is used.");
          return 0;
        }
        if (sub === 'status' || sub === undefined) {
          const model = localModelOf(store);
          console.log(args.includes('--json') ? JSON.stringify({ on: model !== null, model }) : model ? `On: ${model}` : 'Off');
          return 0;
        }
        console.error('usage: didja local-model [status [--json] | on <model> | off]');
        return 1;
      }
      case 'mcp': {
        const sub = args[0];
        const p = places();
        if (sub === 'on' || sub === 'off') {
          store.setMeta('mcp_enabled', sub);
          console.log(sub === 'on' ? 'Your Claude can read Didja over MCP (masked).' : 'Your Claude cannot read Didja.');
          return 0;
        }
        if (sub === 'status') {
          const log = readLog(p, 1000);
          const status = { on: enabled(store), calls: log.length, last: log.at(-1)?.ts ?? null, shared: p.shared, drafts: p.drafts };
          console.log(args.includes('--json') ? JSON.stringify(status) : `${status.on ? 'On' : 'Off'}; ${status.calls} calls${status.last ? `, last ${status.last}` : ''}`);
          return 0;
        }
        if (sub === 'log') {
          const log = readLog(p);
          console.log(args.includes('--json') ? JSON.stringify(log) : log.map((l) => `${l.ts}  ${l.tool} ${JSON.stringify(l.args)}`).join('\n'));
          return 0;
        }
        if (sub !== undefined) {
          console.error('usage: didja mcp [on|off|status|log]');
          return 1;
        }
        await serve(store, p);
        return 0;
      }
      case 'profiles': {
        const list = profiles();
        if (args.includes('--json')) {
          console.log(JSON.stringify(list, null, 2));
        } else {
          console.log(`From ${profilesDir() ?? 'nowhere: no profiles were found'}`);
          for (const p of list) {
            const where = [...(p.match.bundleIds ?? []), ...(p.match.urlPrefixes ?? []), ...(p.match.hosts ?? [])].join(', ');
            console.log(`  ${p.id.padEnd(14)} ${p.kind.padEnd(6)} ${p.name}${p.status && p.status !== 'builtIn' ? ` (${p.status})` : ''} — ${where}`);
          }
        }
        return 0;
      }
      case 'tasks': {
        const tree = store.listTree({ all: args.includes('--all') });
        console.log(args.includes('--json') ? JSON.stringify(tree, null, 2) : formatTasks(tree));
        return 0;
      }
      case 'run': {
        const controller = new AbortController();
        for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => controller.abort());
        console.log('Extracting tasks from new observations every 15s. Ctrl-C to stop.');
        await runLoop(store, console.log, { signal: controller.signal, judge: findJudge(() => localModelOf(store)), titler: findTitler(), looker: findLooker(() => localModelOf(store)), mailReader: findMailReader(() => localModelOf(store)), chatReader: findChatReader(), replyJudge: findReplyJudge(), criteria: findCriteriaWriter(),
          sync: () => syncConnections(store, mcpRemote(store)), syncDue: () => writebackWaiting(store) });
        return 0;
      }
      case 'poll': {
        const s = pollOnce(store, new Date(), { judge: findJudge(() => localModelOf(store)), titler: findTitler(), looker: findLooker(() => localModelOf(store)), mailReader: findMailReader(() => localModelOf(store)), chatReader: findChatReader(), replyJudge: findReplyJudge(), criteria: findCriteriaWriter() });
        console.log(
          `observations=${s.observations} windows=${s.windows} claude=${s.claudeWindows} checklists=${s.checklists} new=${s.newTasks} sightings=${s.sightings} completed=${s.completed} judged=${s.judged} retracted=${s.retracted} titled=${s.titled} suggested=${s.suggested} emails=${s.emails} archived=${s.archived} expired=${s.expired}`,
        );
        return 0;
      }
      case 'why': {
        const task = store.getTask(Number(args[0]));
        if (!task) {
          console.error('usage: didja why <id>');
          return 1;
        }
        console.log(formatWhy(task, store.listEvidence(task.id), store.modelCriteria(task.id)));
        return 0;
      }
      case 'place': {
        const id = Number(args[0]);
        if (!Number.isInteger(id) || !store.getTask(id)) {
          console.error('usage: didja place <id>');
          return 1;
        }
        console.log(JSON.stringify(store.place(id)));
        return 0;
      }
      case 'notanaction': {
        const id = Number(args[0]);
        if (!Number.isInteger(id) || !store.notAnAction(id)) {
          console.error('usage: didja notanaction <id>');
          return 1;
        }
        console.log(`#${id} dismissed and remembered as not an action`);
        return 0;
      }
      case 'notdone': {
        const id = Number(args[0]);
        if (!Number.isInteger(id) || !store.notDone(id)) {
          console.error('usage: didja notdone <id>   (for a task ticked for you because it looked done)');
          return 1;
        }
        console.log(`#${id} reopened, and remembered as not done`);
        return 0;
      }
      case 'connections': {
        // connections [--json]: what is connected, and how it is doing.
        const list = listConnections(store);
        if (args.includes('--json')) console.log(JSON.stringify(list.map((c) => ({ ...c, name: KINDS[c.kind]?.name ?? c.kind, groups: KINDS[c.kind]?.groups ?? 'Teams', tried: KINDS[c.kind]?.tried ?? false }))));
        else for (const c of list) console.log(`${c.id}  ${KINDS[c.kind]?.name ?? c.kind}  ${c.status ?? 'not synced yet'}${c.lastError ? ` (${c.lastError})` : ''}  on done: ${[c.onDone.state && `state ${c.onDone.state}`, c.onDone.label && `label ${c.onDone.label}`].filter(Boolean).join(', ') || 'nothing'}${c.whenSure ? ', also when very sure' : ''}`);
        return 0;
      }
      case 'connect': {
        // connect <kind>: add it (once) and sign in in your browser.
        const kind = args[0] ?? '';
        if (!KINDS[kind]) {
          console.error(`usage: didja connect <${Object.keys(KINDS).join('|')}>`);
          return 1;
        }
        const list = listConnections(store);
        let connection = list.find((c) => c.kind === kind);
        if (!connection) {
          connection = { id: kind, kind: kind as Connection['kind'], onDone: { state: 'Done' }, whenSure: true };
          saveConnections(store, [...list, connection]);
        }
        console.log(`Opening ${KINDS[kind]!.name} in your browser to sign in…`);
        await signIn(connection, (url) => { Bun.spawnSync(['open', url.toString()]); });
        const s = await syncConnections(store, mcpRemote(store));
        console.log(s.errors.length ? `Signed in, but: ${s.errors.join('; ')}` : `Connected. ${s.created} item(s) due today or overdue.`);
        return s.errors.length ? 1 : 0;
      }
      case 'connection': {
        // connection <id> state <name…> | label <name…> | whensure on|off | choices
        const [id, what, ...rest] = args;
        const value = rest.join(' ').trim();
        const found = listConnections(store).find((c) => c.id === id);
        if (!found) {
          console.error('usage: didja connection <id> state [<name>] | label [<name>] | whensure on|off | choices');
          return 1;
        }
        if (what === 'choices') {
          const { client } = await openSession(found);
          try {
            console.log(JSON.stringify(await ADAPTERS[found.kind]!.choices(client, found)));
          } finally {
            await client.close();
          }
          return 0;
        }
        if (what === 'state') updateConnection(store, found.id, { onDone: { ...found.onDone, state: value || undefined } });
        else if (what === 'label') updateConnection(store, found.id, { onDone: { ...found.onDone, label: value || undefined } });
        else if (what === 'whensure' && (value === 'on' || value === 'off')) updateConnection(store, found.id, { whenSure: value === 'on' });
        else if (what === 'bring' && /^(due|started|unstarted|backlog) (on|off)$/.test(value)) {
          const [rule, onOff] = value.split(' ') as [keyof Omit<Bring, 'teams'>, string];
          updateConnection(store, found.id, { bring: { ...bringOf(found), [rule]: onOff === 'on' } });
        } else if (what === 'team' && /^(.+) (on|off)$/.test(value)) {
          const team = value.replace(/ (on|off)$/, '');
          const teams = bringOf(found).teams.filter((t) => t.toLowerCase() !== team.toLowerCase());
          updateConnection(store, found.id, { bring: { ...bringOf(found), teams: value.endsWith(' on') ? [...teams, team] : teams } });
        } else if (what === 'team' && value === 'all') updateConnection(store, found.id, { bring: { ...bringOf(found), teams: [] } });
        else {
          console.error('usage: didja connection <id> state [<name>] | label [<name>] | whensure on|off | bring due|started|unstarted|backlog on|off | team <name> on|off | team all | choices');
          return 1;
        }
        console.log(JSON.stringify(listConnections(store).find((c) => c.id === found.id)));
        return 0;
      }
      case 'disconnect': {
        // disconnect <id>: forget the connection and its keys; its open tasks leave the list.
        const id = args[0] ?? '';
        const list = listConnections(store);
        if (!list.some((c) => c.id === id)) {
          console.error('usage: didja disconnect <id>');
          return 1;
        }
        for (const task of store.externalTasks(id)) if (task.status === 'open' || task.status === 'snoozed') store.setStatus(task.id, 'dismissed');
        saveConnections(store, list.filter((c) => c.id !== id));
        forgetSecrets(id);
        console.log(`${id} disconnected`);
        return 0;
      }
      case 'sync': {
        const s = await syncConnections(store, mcpRemote(store));
        console.log(`new=${s.created} closed=${s.closed} written=${s.written}${s.errors.length ? ` errors: ${s.errors.join('; ')}` : ''}`);
        return s.errors.length ? 1 : 0;
      }
      case 'merge': {
        // merge <keep> <other>: the same thing seen in two places; they finish together.
        const [keep, other] = args.map(Number);
        if (!Number.isInteger(keep) || !Number.isInteger(other) || !store.merge(keep!, other!)) {
          console.error('usage: didja merge <keep id> <other id>');
          return 1;
        }
        console.log(`#${other} merged into #${keep}`);
        return 0;
      }
      case 'notsame': {
        const [a, b] = args.map(Number);
        if (!Number.isInteger(a) || !Number.isInteger(b)) {
          console.error('usage: didja notsame <id> <id>');
          return 1;
        }
        store.notSame(a!, b!);
        console.log(`#${a} and #${b} will not be suggested again`);
        return 0;
      }
      case 'names': {
        // names [--json] | names set [<name…>] | names add <name…> | names remove <name…>
        // Your name and the other names you are tagged or called by in chats, in any language.
        const json = args.includes('--json');
        const [action, ...rest] = args.filter((a) => a !== '--json');
        const name = rest.join(' ').trim();
        const others = (store.getMeta('my_other_names') ?? '').split('\n').map((n) => n.trim()).filter(Boolean);
        if (action === 'add' && name) {
          if (!others.some((n) => n.toLowerCase() === name.toLowerCase())) others.push(name);
          store.setMeta('my_other_names', others.join('\n'));
        } else if (action === 'remove' && name) {
          store.setMeta('my_other_names', others.filter((n) => n.toLowerCase() !== name.toLowerCase()).join('\n'));
        } else if (action === 'set') {
          store.setMeta('my_chosen_name', name); // empty: back to the Mac account's name
        } else if (action !== undefined) {
          console.error('usage: didja names [--json] | set [<name>] | add <name> | remove <name>');
          return 1;
        }
        console.log(json ? JSON.stringify(namesOf(store)) : myNames(store).join('\n'));
        return 0;
      }
      case 'brain': {
        // brain show | brain set <job> (instructions on standard input) | brain reset <job> | brain forget <lesson id>
        const [action, which] = args;
        if (action === 'show') {
          console.log(JSON.stringify({
            jobs: Object.fromEntries(JOBS.map((job) => [job, store.teaching(job).instructions])),
            lessons: store.lessons(),
            places: store.donePlacesShown(),
          }, null, 2));
          return 0;
        }
        if ((action === 'set' || action === 'reset') && JOBS.includes(which as Job)) {
          const text = action === 'set' ? await new Response(Bun.stdin.stream()).text() : null;
          store.setInstructions(which as Job, text);
          console.log(action === 'set' && text?.trim() ? `${which}: your instructions saved` : `${which}: back to the built-in instructions`);
          return 0;
        }
        if (action === 'forget' && Number.isInteger(Number(which)) && store.forgetLesson(Number(which))) {
          console.log(`lesson ${which} forgotten`);
          return 0;
        }
        console.error(`usage: didja brain show | set <${JOBS.join('|')}> < file | reset <job> | forget <lesson id>`);
        return 1;
      }
      case 'add': {
        const id = addManualTask(store, args.join(' '));
        if (id === null) {
          console.error('usage: didja add <title>');
          return 1;
        }
        console.log(`#${id} → added`);
        return 0;
      }
      case 'context': {
        const id = Number(args[0]);
        if (!Number.isInteger(id)) {
          console.error('usage: didja context <id>');
          return 1;
        }
        console.log(JSON.stringify(store.context(id)));
        return 0;
      }
      case 'notyet': {
        const id = Number(args[0]);
        if (!Number.isInteger(id) || !store.rejectSuggestion(id)) {
          console.error('usage: didja notyet <id>   (for a task marked "looks done?")');
          return 1;
        }
        console.log(`#${id} stays open`);
        return 0;
      }
      case 'rename': {
        const id = Number(args[0]);
        if (!Number.isInteger(id) || !store.rename(id, args.slice(1).join(' ') || null)) {
          console.error('usage: didja rename <id> <new name>');
          return 1;
        }
        console.log(`#${id} → ${store.getTask(id)!.title}`);
        return 0;
      }
      case 'collapse':
      case 'expand': {
        if (args[0] === 'all') {
          store.setAllCollapsed(command === 'collapse');
          return 0;
        }
        const id = Number(args[0]);
        if (!Number.isInteger(id) || !store.setCollapsed(id, command === 'collapse')) {
          console.error(`usage: didja ${command} <id>`);
          return 1;
        }
        return 0;
      }
      case 'snooze': {
        const id = Number(args[0]);
        const until = parseSnooze(args[1] ?? '1h');
        if (!Number.isInteger(id) || !until) {
          console.error('usage: didja snooze <id> [30m|2h|3d|tomorrow]');
          return 1;
        }
        if (!store.snooze(id, until)) {
          console.error(`No task #${id}`);
          return 1;
        }
        console.log(`#${id} → snoozed until ${until.toLocaleString('en-GB')}`);
        return 0;
      }
      case 'canvas': {
        const [sub, a, ...rest] = args;
        const n = Number(a);
        const text = rest.join(' ');
        const json = (v: unknown) => { console.log(JSON.stringify(v)); return 0; };
        switch (sub) {
          case 'list': return json(store.canvases());
          case 'new': return json({ id: store.createCanvas([a, ...rest].filter(Boolean).join(' ')) });
          case 'show': { const c = store.canvas(n); if (c) return json(c); break; }
          case 'send': return json({ added: store.sendToCanvas(n, rest.map(Number).filter(Number.isInteger)) });
          case 'add': {
            const id = addManualTask(store, text);
            if (id !== null) return json({ task: id, added: store.sendToCanvas(n, [id]) });
            break;
          }
          case 'line': {
            // canvas line <id> [--note] [--level n] <typed text>: read as Markdown (canvas.ts).
            const words = [...rest];
            const asNote = words[0] === '--note' ? (words.shift(), true) : false;
            const base = words[0] === '--level' ? (words.shift(), Number(words.shift())) : 0;
            const line = parseCanvasLine(words.join(' '), asNote ? 'note' : 'task', base);
            if (!line || !store.canvas(n)) break;
            if (line.kind === 'task') {
              const task = addManualTask(store, line.text);
              if (task === null) break;
              if (line.done) store.setStatus(task, 'done');
              return json({ task, item: store.addCanvasTask(n, task, line.level), kind: 'task' });
            }
            return json({ item: store.addCanvasNote(n, line.kind, line.text, new Date(), line.level), kind: line.kind });
          }
          case 'level': if (store.setCanvasLevel(n, Number(rest[0]))) return json({ ok: true }); break;
          case 'note': case 'heading': { const id = store.addCanvasNote(n, sub, text); if (id !== null) return json({ id }); break; }
          case 'edit': if (store.editCanvasItem(n, text)) return json({ ok: true }); break;
          case 'move': if (store.moveCanvasItem(n, rest[0] === 'end' || rest[0] === undefined ? null : Number(rest[0]))) return json({ ok: true }); break;
          case 'remove': if (store.removeCanvasItem(n)) return json({ ok: true }); break;
          case 'rename': if (store.renameCanvas(n, text)) return json({ ok: true }); break;
          case 'delete': if (store.deleteCanvas(n)) return json({ ok: true }); break;
          case 'export': {
            const c = store.canvas(n);
            if (c) { console.log(rest[0] === 'txt' ? canvasText(c) : canvasMarkdown(c)); return 0; }
            break;
          }
        }
        console.error('usage: didja canvas list | new <title> | show <id> | send <id> <task…> | add <id> <title> | note|heading <id> <text> | edit <item> <text> | move <item> <before|end> | remove <item> | rename <id> <title> | delete <id> | export <id> [md|txt]');
        return 1;
      }
      case 'missed': {
        if (args[0] === 'places') {
          for (const p of store.donePlaces()) console.log(`#${p.id}  ${p.site}${p.word ? `  (steps naming "${p.word}")` : ''}  from task #${p.taskId ?? '?'}`);
          return 0;
        }
        if (args[0] === 'forget') {
          if (store.forgetDonePlace(Number(args[1]))) { console.log(`place #${args[1]} forgotten`); return 0; }
          console.error('usage: didja missed forget <place id>');
          return 1;
        }
        const id = Number(args[0]);
        const shown = args.indexOf('--done-at');
        if (shown >= 0) {
          // This screen shows it done: tick it, remember the site, and look again there now.
          const done = doneAt(store, id, Number(args[shown + 1]));
          if (!done) { console.error('usage: didja missed <id> --done-at <screen id>'); return 1; }
          const looker = findLooker(() => localModelOf(store));
          const suggested = looker ? lookAgainAt(store, looker, done.site) : 0;
          console.log(JSON.stringify({ ...done, suggested }));
          return 0;
        }
        const at = args.indexOf('--learn');
        if (at >= 0) {
          const task = store.getTask(id);
          const site = (args[at + 1] ?? '').toLowerCase();
          const place = task ? store.addDonePlace(id, site, wordForPlace(store, task, site)) : null;
          if (place === null) { console.error('usage: didja missed <id> --learn <site>'); return 1; }
          const looker = findLooker(() => localModelOf(store));
          const suggested = looker ? lookAgainAt(store, looker, args[at + 1]!) : 0;
          console.log(JSON.stringify({ place, suggested }));
          return 0;
        }
        const report = missedReport(store, id);
        if (!report) { console.error('usage: didja missed <id> [--learn <site>]'); return 1; }
        console.log(JSON.stringify(report));
        return 0;
      }
      case 'keep': {
        const id = keepTask(store, args.join(' '));
        if (id === null) {
          console.error('usage: didja keep <title>');
          return 1;
        }
        console.log(`#${id} on My List`);
        return 0;
      }
      case 'fresh-start': {
        if (args.includes('--status')) {
          console.log(JSON.stringify(store.lastFreshStart()));
          return 0;
        }
        if (args.includes('--undo')) {
          const back = store.undoFreshStart();
          console.log(`${back.length} ${back.length === 1 ? 'task' : 'tasks'} back`);
          return 0;
        }
        const done = store.freshStart();
        console.log(`Fresh start: ${done.length} ${done.length === 1 ? 'task' : 'tasks'} marked done`);
        return 0;
      }
      case 'quality': {
        const at = args.indexOf('--days');
        const days = at === -1 ? 7 : Number(args[at + 1]);
        if (!Number.isFinite(days) || days <= 0) {
          console.error('usage: didja quality [--days N] [--json]');
          return 1;
        }
        const report = qualityReport(store, days);
        console.log(args.includes('--json') ? JSON.stringify(report) : formatQuality(report));
        return 0;
      }
      case 'done-all': {
        const id = Number(args[0]);
        const task = Number.isInteger(id) ? store.getTask(id) : null;
        const ticked = task && store.completeSource(id);
        if (!task || !ticked) {
          console.error(Number.isInteger(id) ? `No task #${id}` : 'usage: didja done-all <id>');
          return 1;
        }
        console.log(`${ticked.length} open ${ticked.length === 1 ? 'task' : 'tasks'} from ${task.sourceRef} → done`);
        return 0;
      }
      case 'done':
      case 'dismiss':
      case 'reopen': {
        const id = Number(args[0]);
        if (!Number.isInteger(id)) {
          console.error(`usage: didja ${command} <id>`);
          return 1;
        }
        const status = command === 'done' ? 'done' : command === 'dismiss' ? 'dismissed' : 'open';
        // Counted in "How Didja is doing" (SCR-73).
        if (!store.changeByYou(id, status)) {
          console.error(`No task #${id}`);
          return 1;
        }
        console.log(`#${id} → ${status}`);
        return 0;
      }
      default:
        console.error(`Unknown command: ${command}\n\n${USAGE}`);
        return 1;
    }
  } finally {
    store.close();
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
