/**
 * Assistant profiles (`profiles/assistants/*.json`, SCR-83): which windows are an AI tool, and how
 * to read them. One data file per tool, so a new tool, or a new version of one, is a profile and a
 * fixture rather than a code change, the same idea as the app profiles for chat and email apps.
 *
 * A profile says:
 *   - `match`: the tool's own app (`bundleIds`), its site (`hosts`), or, inside a terminal or an
 *     editor, the text only that tool shows (`terminal` / `editor`: `titles`, `signatures` that are
 *     enough alone, and `together`: weak signs, such as a "●" or "❯" glyph, that count only all at once);
 *   - `turns`: how your turn is told from the assistant's (labels such as "You said:");
 *   - `agentWork`: the lines that are the agent's own work (approval prompts, "ran" lines, the answer
 *     that declines a prompt, its todo list), for the rules that keep those from becoming, or
 *     ticking, your tasks (SCR-85, `agents.ts`);
 *   - `steps`: step shapes only that tool writes.
 *
 * Profiles hold patterns as data. They can only say which window is which tool; what is read, and
 * the exclude list, are decided before any profile is looked at.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { profilesDir } from './profiles.ts';

export type AssistantKind = 'chat' | 'terminal' | 'editor';

/** Text signs inside a terminal or an editor. */
export interface TextMatch {
  /** The window title matches any of these. */
  titles?: string[];
  /** Any one of these in the window's text is enough. */
  signatures?: string[];
  /** Each inner list counts only when all of its patterns are in the text. */
  together?: string[][];
}

export interface AssistantProfileFile {
  id: string;
  name: string;
  kind: AssistantKind;
  status?: 'builtIn' | 'community' | 'communityNew';
  about?: string;
  /** What its tasks' `source_kind` is; the id when not given. Claude's keep their older names. */
  sourceKind?: string;
  /** Profiles are tried lowest first (default 100), then by file name: Claude's come first, as before. */
  order?: number;
  match: {
    bundleIds?: string[];
    /** A site, and any subdomain of it, over http or https. */
    hosts?: string[];
    terminal?: TextMatch;
    editor?: TextMatch;
  };
  turns?: {
    user?: string[]; assistant?: string[]; userPrompt?: string[]; reply?: string[];
    /**
     * A chat window whose text has neither message sections nor these labels: `ignore` it (Claude:
     * a document preview, say), or read it all as the assistant's (`assistant`, the default: a
     * site such as Gemini shows no labels at all).
     */
    whenUnlabelled?: 'ignore' | 'assistant';
  };
  agentWork?: { approval?: string[]; ran?: string[]; declined?: string[]; todo?: string[] };
  steps?: string[];
}

export interface Assistant {
  id: string;
  name: string;
  kind: AssistantKind;
  sourceKind: string;
  order: number;
  status: 'builtIn' | 'community' | 'communityNew';
  about: string;
  file: AssistantProfileFile;
  match: {
    bundleIds: string[];
    hosts: string[];
    terminal: CompiledText | null;
    editor: CompiledText | null;
  };
  turns: { user: RegExp[]; assistant: RegExp[]; userPrompt: RegExp[]; reply: RegExp[]; whenUnlabelled: 'ignore' | 'assistant' };
  agentWork: { approval: RegExp[]; ran: RegExp[]; declined: RegExp[]; todo: RegExp[] };
  steps: string[];
}

interface CompiledText {
  titles: RegExp[];
  signatures: RegExp[];
  together: RegExp[][];
}

export const TERMINALS = new Set([
  'com.apple.Terminal', 'com.googlecode.iterm2', 'com.mitchellh.ghostty', 'dev.warp.Warp-Stable',
  'net.kovidgoyal.kitty', 'org.alacritty', 'com.github.wez.wezterm', 'co.zeit.hyper',
]);
export const EDITORS = new Set([
  'com.microsoft.VSCode', 'com.todesktop.230313mzl4w4u92', 'dev.zed.Zed', 'com.exafunction.windsurf',
]);

const MAX_PATTERN = 300;

/**
 * A profile's pattern as a regular expression, or an error. JavaScript syntax with the `m` and `u`
 * flags; a leading `(?i)` ignores case. The same limits as app profiles: at most 300 characters, no
 * back-references, no look-behind, and no repeated group that repeats inside.
 */
export function compilePattern(source: string): RegExp {
  if (typeof source !== 'string' || source.length === 0) throw new Error('empty pattern');
  if (source.length > MAX_PATTERN) throw new Error(`pattern over ${MAX_PATTERN} characters`);
  if (/\\[1-9]|\\k</.test(source)) throw new Error('back-references are not allowed');
  if (/\(\?<[=!]/.test(source)) throw new Error('look-behind is not allowed');
  if (/\((?:\?:)?[^()]*[+*][^()]*\)[+*{]/.test(source)) throw new Error('a repeated group that repeats inside is not allowed');
  const ignoreCase = source.startsWith('(?i)');
  return new RegExp(ignoreCase ? source.slice(4) : source, ignoreCase ? 'imu' : 'mu');
}

const list = (xs: unknown): string[] => (Array.isArray(xs) ? xs.filter((x): x is string => typeof x === 'string') : []);

function compileText(t: TextMatch | undefined): CompiledText | null {
  if (!t) return null;
  return {
    titles: list(t.titles).map(compilePattern),
    signatures: list(t.signatures).map(compilePattern),
    together: (Array.isArray(t.together) ? t.together : []).map((group) => list(group).map(compilePattern)).filter((g) => g.length > 0),
  };
}

/** A profile file as an assistant, or an error saying what is wrong with it. */
export function compileAssistant(f: AssistantProfileFile): Assistant {
  if (typeof f.id !== 'string' || !/^[a-z0-9-]+$/.test(f.id)) throw new Error('id: lowercase letters, digits and dashes');
  if (typeof f.name !== 'string' || !f.name) throw new Error('name is missing');
  if (f.kind !== 'chat' && f.kind !== 'terminal' && f.kind !== 'editor') throw new Error('kind is chat, terminal or editor');
  if (!f.match || typeof f.match !== 'object') throw new Error('match is missing');
  const a: Assistant = {
    id: f.id, name: f.name, kind: f.kind, sourceKind: f.sourceKind ?? f.id, order: typeof f.order === 'number' ? f.order : 100, status: f.status ?? 'builtIn', about: f.about ?? '', file: f,
    match: {
      bundleIds: list(f.match.bundleIds), hosts: list(f.match.hosts).map((h) => h.toLowerCase()),
      terminal: compileText(f.match.terminal), editor: compileText(f.match.editor),
    },
    turns: {
      user: list(f.turns?.user).map(compilePattern), assistant: list(f.turns?.assistant).map(compilePattern),
      userPrompt: list(f.turns?.userPrompt).map(compilePattern), reply: list(f.turns?.reply).map(compilePattern),
      whenUnlabelled: f.turns?.whenUnlabelled === 'ignore' ? 'ignore' : 'assistant',
    },
    agentWork: {
      approval: list(f.agentWork?.approval).map(compilePattern), ran: list(f.agentWork?.ran).map(compilePattern),
      declined: list(f.agentWork?.declined).map(compilePattern), todo: list(f.agentWork?.todo).map(compilePattern),
    },
    steps: list(f.steps),
  };
  const m = a.match;
  if (!m.bundleIds.length && !m.hosts.length && !m.terminal && !m.editor) throw new Error('match names no app, site, terminal or editor');
  return a;
}

export function assistantsDir(): string | null {
  const dir = profilesDir();
  return dir && existsSync(join(dir, 'assistants')) ? join(dir, 'assistants') : null;
}

/** Every assistant profile in a folder that reads as one, in file-name order; a broken one is left out. */
export function readAssistants(dir: string | null = assistantsDir()): Assistant[] {
  if (!dir || !existsSync(dir)) return [];
  const out: Assistant[] = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    try {
      out.push(compileAssistant(JSON.parse(readFileSync(join(dir, name), 'utf8')) as AssistantProfileFile));
    } catch {
      // Left out, as the app leaves out an unreadable app profile.
    }
  }
  // Stable: equal orders keep file-name order.
  return out.sort((a, b) => a.order - b.order);
}

let cached: Assistant[] | null = null;
export function assistants(): Assistant[] {
  cached ??= readAssistants();
  return cached;
}
/** For tests: use these assistants instead of the ones on disk. */
export function useAssistants(list: Assistant[] | null): void {
  cached = list;
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** How strongly a profile's text signs match: by title (1), a signature (2), weak signs together (3), or not (0). */
function textStrength(t: CompiledText | null, title: string, text: string): 0 | 1 | 2 | 3 {
  if (!t) return 0;
  if (title && t.titles.some((r) => r.test(title))) return 1;
  if (t.signatures.some((r) => r.test(text))) return 2;
  return t.together.some((group) => group.every((r) => r.test(text))) ? 3 : 0;
}

/** The first profile by strength, then order: a title beats a signature, which beats weak signs together. */
function strongest(all: Assistant[], which: 'terminal' | 'editor', title: string, text: string): Assistant | null {
  let best: Assistant | null = null;
  let bestStrength = 4;
  for (const a of all) {
    const k = textStrength(a.match[which], title, text);
    if (k > 0 && k < bestStrength) {
      best = a;
      bestStrength = k;
    }
  }
  return best;
}

/**
 * The AI tool a window shows, or null. Its own app first, then its site; in a terminal, a title
 * that names the tool, then the text only that tool shows; in an editor, only the tool's own panel
 * text, never a title or a document's words (a CLAUDE.md open in Cursor is not Claude Code, SCR-65).
 * In a terminal or an editor a title beats a signature, which beats weak signs together (a "●"
 * reply and a "❯" prompt); within each, profiles are tried in their order (`order`, then file name).
 */
export function assistantFor(
  window: { bundleId: string; windowTitle: string; url: string | null },
  text: string,
  all: Assistant[] = assistants(),
): Assistant | null {
  const byApp = all.find((a) => a.match.bundleIds.includes(window.bundleId));
  if (byApp) return byApp;
  const host = hostOf(window.url);
  if (host) {
    const bySite = all.find((a) => a.match.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
    if (bySite) return bySite;
  }
  if (TERMINALS.has(window.bundleId)) return strongest(all, 'terminal', window.windowTitle, text);
  if (EDITORS.has(window.bundleId)) return strongest(all, 'editor', '', text);
  return null;
}

/** The assistant whose tasks carry this source kind, or null. */
export function assistantByKind(kind: string, all: Assistant[] = assistants()): Assistant | null {
  return all.find((a) => a.sourceKind === kind) ?? null;
}

/** Whether a chat window's text has turns this profile can tell apart: a message section or a label. */
export function hasTurns(a: Assistant, text: string): boolean {
  return /^⟦.*⟧$/m.test(text) || [...a.turns.user, ...a.turns.assistant].some((r) => r.test(text));
}

/** What part of the agent's own work a line is, by its profile, or null (SCR-83; used by SCR-85). */
export function agentWork(a: Assistant, line: string): 'approval' | 'ran' | 'declined' | 'todo' | null {
  // Declining is checked first: its answer ("Skipped", "› 2. No, and tell…") can look like an option.
  if (a.agentWork.declined.some((r) => r.test(line))) return 'declined';
  if (a.agentWork.approval.some((r) => r.test(line))) return 'approval';
  if (a.agentWork.ran.some((r) => r.test(line))) return 'ran';
  if (a.agentWork.todo.some((r) => r.test(line))) return 'todo';
  return null;
}
