/**
 * What an AI agent in a terminal or an editor did itself (SCR-85), read by its assistant profile
 * (`agentWork` in `profiles/assistants/*.json`, SCR-83), so that:
 *
 *   - a step the agent then runs with its own tools is the agent's, not yours (taken back with
 *     "<agent> ran this itself" in why, never ticked);
 *   - a command the agent asked to run and you declined ("No, and tell Codex…", "Skipped", "n") is
 *     yours, with the command as its marker;
 *   - the agent's own todo list never becomes tasks, nor a step worded like one of its items.
 *
 * Pure: text in, facts out. The engine decides what to do with them.
 */
import { agentWork, type Assistant } from './assistants.ts';
import { shellCommand, stepCommands } from './extract.ts';

export interface AgentCommand {
  command: string;
  /** The line it is settled on: the "ran" line, or the answer that declined it. */
  line: number;
  how: 'ran' | 'declined';
}

/** How far after an approval prompt its answer and its command may be. */
const PROMPT_SPAN = 12;
/** Glyphs and words in front of a "ran" line's command. */
const RAN_LEAD = /^\s*(?:[⏺●•✔✓✦›>$]\s*)*(?:Ran|Running|Shell|Run)?\s*/;

/** The command a "ran" line names, or null: "● Bash(npm test)", "• Ran git push", "Ran `x`", "✔ Shell npm i". */
export function ranCommand(line: string): string | null {
  const call = line.match(/^\s*(?:[⏺●•]\s*)?(?:Bash|Shell|run_shell_command)\((.+)\)\s*…?\s*$/);
  if (call) return shellCommand(call[1]!.trim());
  const quoted = line.match(/`([^`]{2,300})`/);
  if (quoted) return shellCommand(quoted[1]!);
  // "Ran terminal command: bun test".
  const said = line.match(/:\s+(\S.*)$/);
  if (said && shellCommand(said[1]!)) return shellCommand(said[1]!);
  return shellCommand(line.replace(RAN_LEAD, ''));
}

/**
 * Commands the agent ran or was told not to run, in order. An approval prompt's command is the first
 * command line in it (or, as Aider asks, the line before it); the prompt is settled by a "ran" line
 * after it (ran) or a declining answer (declined), and an unanswered prompt is neither. A "ran" line
 * that names its own command counts by itself.
 */
export function agentCommands(a: Assistant, text: string): AgentCommand[] {
  const lines = text.split(/\r?\n/);
  const out: AgentCommand[] = [];
  let prompt: { command: string | null; line: number } | null = null;
  // Aider puts the command on the line before its question.
  const open = (i: number) => ({ command: i > 0 ? shellCommand(lines[i - 1]!) : null, line: i });
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (prompt && i - prompt.line > PROMPT_SPAN) prompt = null;
    const kind = agentWork(a, line);
    if (kind === 'declined') {
      // The answer may be on the question's own line ("… [Yes]: n").
      const command = (prompt ?? open(i)).command;
      if (command) out.push({ command, line: i, how: 'declined' });
      prompt = null;
      continue;
    }
    if (kind === 'approval') {
      prompt ??= open(i);
      continue;
    }
    if (kind === 'ran') {
      const own = ranCommand(line) ?? (/\bRan terminal command\b/.test(line) ? shellCommand(lines[i + 1] ?? '') : null);
      const command = own ?? prompt?.command ?? null;
      if (command) out.push({ command, line: i, how: 'ran' });
      prompt = null;
      continue;
    }
    // The command an open prompt shows ("  $ git push origin main", "  npm test").
    if (prompt && (prompt.command === null || i === prompt.line + 1)) {
      const code = shellCommand(line);
      if (code) prompt.command = code;
    }
  }
  return out;
}

/** A title as a todo key: lower case, letters and digits only. */
export function todoKey(title: string): string {
  return title.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** The agent's own todo items in the text, as keys (its todo headings left out). */
export function agentTodos(a: Assistant, text: string): Set<string> {
  const keys = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (agentWork(a, line) !== 'todo') continue;
    // An item has a box or a mark in front; a heading ("# Todos", "Todos (2/4)") has none.
    const item = line.match(/^\s*(?:[└⎿]\s+)?(?:\[[^\]]?\]|[☐☒◻◼✔✓□○✗•])\s+(.+)$/u)?.[1];
    const key = item ? todoKey(item) : '';
    if (key) keys.add(key);
  }
  return keys;
}

const norm = (c: string) => c.replace(/\s+/g, ' ').trim();

/** Whether the agent ran one of a step's commands after line `from` (alone or in a `&&` chain). */
export function ranByAgent(item: { title: string; fragments: string[] }, done: AgentCommand[], from: number): boolean {
  const commands = stepCommands(item).map(norm);
  if (commands.length === 0) return false;
  return done.some((d) => d.how === 'ran' && d.line > from &&
    d.command.split(/\s*(?:&&|\|\||;)\s*/).map(norm).some((part) => commands.some((c) => part === c || part.startsWith(`${c} `))));
}

/** The text with the agent's prompts, their answers and its "ran" lines blanked; line numbers kept. */
export function withoutAgentWork(a: Assistant, text: string): string {
  return text.split(/\r?\n/).map((line) => {
    const kind = agentWork(a, line);
    return kind === 'approval' || kind === 'ran' || kind === 'declined' ? '' : line;
  }).join('\n');
}
