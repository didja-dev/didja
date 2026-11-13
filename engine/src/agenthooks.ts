/**
 * Agent hooks (SCR-88): opt-in, one switch per tool, off by default. Claude Code, Cursor and
 * Windsurf can run a command after their own tool calls; with a switch on, Didja adds one to the
 * tool's user-level hooks file (never a repository's), which runs the bundled engine as
 * `didja hook <tool> <event>` with the event on its standard input. The engine keeps only:
 * the tool, the event, the time, a shell tool's command line and exit code (when the tool gives
 * one), and the titles of the agent's own plan items. Never file contents, prompts, responses,
 * output or transcripts. Kept 24 hours in `agent-hooks.jsonl` beside Didja's database.
 *
 * What it is used for: a step from that tool whose command the agent then ran is the agent's
 * (taken back with why, never ticked), and a step worded like one of the agent's plan items is the
 * agent's. Nothing from a hook ever ticks a task: only your own shell's run does (SCR-87).
 *
 * Hooks files are JSON, which has no comments: our entries are known by their command, which
 * always holds ` hook <tool> `. Installing twice changes nothing; the file is backed up first.
 */
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { todoKey } from './agents.ts';
import { sameCommand } from './terminal.ts';

export type HookTool = 'claude-code' | 'cursor' | 'windsurf';
export const HOOK_TOOLS: HookTool[] = ['claude-code', 'cursor', 'windsurf'];

interface ToolSpec {
  name: string;
  /** Where its user-level hooks file is, from the home folder. */
  file: string;
  /** The events we listen to, and how each is written in its file. */
  events: string[];
}

export const TOOLS: Record<HookTool, ToolSpec> = {
  // ~/.claude/settings.json: { "hooks": { "PostToolUse": [{ "matcher": "Bash|TodoWrite", "hooks": [{ "type": "command", "command": … }] }] } }
  'claude-code': { name: 'Claude Code', file: '.claude/settings.json', events: ['PostToolUse'] },
  // ~/.cursor/hooks.json: { "version": 1, "hooks": { "afterShellExecution": [{ "command": … }] } }
  cursor: { name: 'Cursor', file: '.cursor/hooks.json', events: ['afterShellExecution'] },
  // ~/.codeium/windsurf/hooks.json: { "hooks": { "post_run_command": [{ "command": …, "show_output": false }] } }
  windsurf: { name: 'Windsurf', file: '.codeium/windsurf/hooks.json', events: ['post_run_command'] },
};

const MARK = ' hook ';

/** The command a hook runs: the engine, quoted, then `hook <tool> <event>`. */
export function hookCommand(engine: string, tool: HookTool, event: string): string {
  return `"${engine.replace(/"/g, '\\"')}"${MARK}${tool} ${event}`;
}

const ours = (command: unknown, tool: HookTool) => typeof command === 'string' && command.includes(`${MARK}${tool} `) && command.includes('didja');

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? v as Json : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The hooks file with our entries for this tool, and nothing else of it changed. */
export function withHooks(file: Json, tool: HookTool, engine: string): Json {
  const out: Json = { ...withoutHooks(file, tool) };
  const hooks = { ...obj(out.hooks) };
  for (const event of TOOLS[tool].events) {
    const command = hookCommand(engine, tool, event);
    const list = [...arr(hooks[event])];
    if (tool === 'claude-code') {
      list.push({ matcher: 'Bash|TodoWrite', hooks: [{ type: 'command', command }] });
    } else if (tool === 'cursor') {
      list.push({ command });
    } else {
      list.push({ command, show_output: false });
    }
    hooks[event] = list;
  }
  out.hooks = hooks;
  if (tool === 'cursor' && out.version === undefined) out.version = 1;
  return out;
}

/** The hooks file without our entries for this tool; a group or event left empty by that goes too. */
export function withoutHooks(file: Json, tool: HookTool): Json {
  const out: Json = { ...file };
  if (!out.hooks || typeof out.hooks !== 'object') return out;
  const hooks: Json = {};
  for (const [event, value] of Object.entries(obj(out.hooks))) {
    if (!Array.isArray(value)) {
      hooks[event] = value;
      continue;
    }
    const kept: unknown[] = [];
    for (const entry of value) {
      const e = obj(entry);
      if (Array.isArray(e.hooks)) {
        // Claude Code: a matcher group of hooks.
        const inner = e.hooks.filter((h) => !ours(obj(h).command, tool));
        if (inner.length === 0 && e.hooks.length > 0) continue;
        kept.push(inner.length === e.hooks.length ? entry : { ...e, hooks: inner });
      } else if (!ours(e.command, tool)) {
        kept.push(entry);
      }
    }
    if (kept.length > 0 || value.length === 0) hooks[event] = kept;
  }
  if (Object.keys(hooks).length === 0) delete out.hooks;
  else out.hooks = hooks;
  return out;
}

function readJson(path: string): Json | null {
  if (!existsSync(path)) return {};
  try {
    return obj(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return null; // not JSON we can read: leave it alone
  }
}

/**
 * Turn a tool's hook on: back its file up (`<file>.didja-backup`), then add our entries. Returns the
 * file written, or an error when the file is not JSON Didja can read (it is then left untouched).
 */
export function installAgentHook(tool: HookTool, engine: string, home: string = process.env.HOME ?? ''): { file: string } | { error: string } {
  const path = join(home, TOOLS[tool].file);
  const file = readJson(path);
  if (file === null) return { error: `${path} is not JSON Didja can read; it was left as it is` };
  const next = withHooks(file, tool, engine);
  if (JSON.stringify(next) === JSON.stringify(file)) return { file: path };
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) copyFileSync(path, `${path}.didja-backup`);
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  return { file: path };
}

/** Turn it off: our entries out of the tool's file; everything else stays. */
export function removeAgentHook(tool: HookTool, home: string = process.env.HOME ?? ''): void {
  const path = join(home, TOOLS[tool].file);
  if (!existsSync(path)) return;
  const file = readJson(path);
  if (file === null) return;
  const next = withoutHooks(file, tool);
  if (JSON.stringify(next) !== JSON.stringify(file)) writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
}

/** Whether our entries are in the tool's file. */
export function agentHookInstalled(tool: HookTool, home: string = process.env.HOME ?? ''): boolean {
  const file = readJson(join(home, TOOLS[tool].file));
  return file !== null && JSON.stringify(file).includes(`${MARK}${tool} `);
}

// --- What a hook says ------------------------------------------------------------------------------

/** One event, as kept: the listed fields and nothing else. */
export interface AgentEvent {
  ts: string;
  tool: HookTool;
  event: string;
  /** A shell tool's command line. */
  command?: string;
  /** Its exit code, when the tool gives one. */
  exit?: number;
  /** The agent's own plan item titles. */
  plan?: string[];
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, 500) : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : undefined);

/** The fields Didja keeps from one hook event; null when it holds none of them. */
export function parseHookEvent(tool: HookTool, event: string, input: unknown, now: Date): AgentEvent | null {
  const p = obj(input);
  const base = { ts: now.toISOString(), tool, event };
  if (tool === 'claude-code') {
    const name = p.tool_name;
    const toolInput = obj(p.tool_input);
    if (name === 'Bash') {
      const command = str(toolInput.command);
      const response = obj(p.tool_response);
      const exit = num(response.exit_code) ?? num(response.exitCode);
      return command ? { ...base, command, ...(exit !== undefined ? { exit } : {}) } : null;
    }
    if (name === 'TodoWrite') {
      const plan = arr(toolInput.todos).map((t) => str(obj(t).content)).filter((t): t is string => !!t).slice(0, 50);
      return plan.length > 0 ? { ...base, plan } : null;
    }
    return null;
  }
  if (tool === 'cursor') {
    const command = str(p.command);
    const exit = num(p.exit_code) ?? num(p.exitCode);
    return command ? { ...base, command, ...(exit !== undefined ? { exit } : {}) } : null;
  }
  const info = obj(p.tool_info);
  const command = str(info.command_line) ?? str(p.command_line);
  const exit = num(info.exit_code) ?? num(p.exit_code);
  return command ? { ...base, command, ...(exit !== undefined ? { exit } : {}) } : null;
}

const DAY_MS = 24 * 3600_000;

export function appendAgentEvent(path: string, e: AgentEvent): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(e)}\n`);
}

/** The events of the last 24 hours; older lines are dropped from the file. */
export function readAgentEvents(path: string, now: Date): AgentEvent[] {
  if (!existsSync(path)) return [];
  let lines: string[];
  try {
    lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
  const all: AgentEvent[] = [];
  for (const line of lines) {
    try {
      const e = JSON.parse(line) as AgentEvent;
      if (typeof e.ts === 'string' && HOOK_TOOLS.includes(e.tool)) all.push(e);
    } catch {
      // a broken line is skipped
    }
  }
  const kept = all.filter((e) => now.getTime() - Date.parse(e.ts) <= DAY_MS);
  if (kept.length < all.length) {
    try {
      writeFileSync(path, kept.map((e) => `${JSON.stringify(e)}\n`).join(''));
    } catch {
      // try again next pass
    }
  }
  return kept;
}

/** Whether the agent ran this command (its hook said so) after `since`. */
export function agentRanCommand(events: AgentEvent[], tool: HookTool, command: string, since: number): boolean {
  return events.some((e) => e.tool === tool && e.command !== undefined && Date.parse(e.ts) > since && sameCommand(command, e.command));
}

/** The agent's plan items, as todo keys. */
export function agentPlanKeys(events: AgentEvent[], tool: HookTool): Set<string> {
  return new Set(events.filter((e) => e.tool === tool).flatMap((e) => e.plan ?? []).map(todoKey).filter(Boolean));
}

/** Which assistant source kind a hook tool's tasks carry. */
export const SOURCE_KIND: Record<HookTool, string> = { 'claude-code': 'claude-code', cursor: 'cursor', windsurf: 'windsurf' };
