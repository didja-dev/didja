/**
 * Task extraction. Milestone 1: heuristics only, numbered checklists in
 * Claude windows only. No model calls, so nothing leaves the machine.
 *
 * The capture layer hands us text as lines: one line per paragraph or list
 * item, list markers kept ("1. ", "• "), nested lists indented.
 */

import type { Observation } from './store.ts';

export type SourceKind = 'claude-desktop' | 'claude-web' | 'claude-code';

export const OUTLOOK = 'com.microsoft.Outlook';

export interface ChecklistItem {
  /** The number shown on screen (1-based). */
  position: number;
  title: string;
  /** Extra lines belonging to the item (wrapped text, notes, code), kept for marker extraction. */
  fragments: string[];
  /** Sub-steps: bullets or numbered lines nested under this item that are themselves things to do. */
  children: ChecklistItem[];
  /** A one-word item such as "Vercel": worth keeping only as a heading over sub-steps. */
  headingOnly?: boolean;
}

export interface Checklist {
  /** What the list is for: the line that introduced it, when there is one. */
  title: string | null;
  items: ChecklistItem[];
  /** Share of items that read as actions for a person to take (0..1). */
  confidence: number;
  /**
   * Who the list is for, as far as its lead-in says. Null means the wording
   * does not settle it, and the on-device model may be asked.
   */
  actor: Actor;
  /** The first lines of ordinary text after the list, for judging who it is for. */
  after: string[];
  /**
   * What you asked just before the reply the list is in ("How do I tag v0.2.0 and push it?"),
   * for judging who it is for. Null when no message of yours is in view above it.
   */
  asked?: string | null;
}

/** The words of one of your messages, without its label, in one line. */
function askedText(lines: string[]): string | null {
  const words = lines
    .filter((l) => !SECTION_LINE.test(l))
    .map((l) => l.replace(USER_LABEL, '').trim())
    .filter((l, i, all) => l !== '' && l !== all[i - 1]) // the app shows your message under its label again
    .join(' ')
    .slice(0, 240)
    .trim();
  return words === '' ? null : words;
}

const CLAUDE_DESKTOP = 'com.anthropic.claudefordesktop';
export const TERMINALS = new Set([
  'com.apple.Terminal', 'com.googlecode.iterm2', 'com.mitchellh.ghostty', 'dev.warp.Warp-Stable',
  'net.kovidgoyal.kitty', 'org.alacritty', 'com.github.wez.wezterm', 'co.zeit.hyper',
]);
const EDITORS = new Set([
  'com.microsoft.VSCode', 'com.todesktop.230313mzl4w4u92', 'dev.zed.Zed', 'com.exafunction.windsurf',
]);
/** Text that only shows up in the Claude Code terminal UI. */
const CLAUDE_CODE_SIGNATURES = /esc to interrupt|\? for shortcuts|shift\+tab to cycle|Claude Code|⏺/;

/** Which Claude surface a window shows, or null if it is not a Claude window. */
export function classifySource(
  window: Pick<Observation, 'bundleId' | 'windowTitle' | 'url'>,
  text: string,
): SourceKind | null {
  if (window.bundleId === CLAUDE_DESKTOP) return 'claude-desktop';
  if (window.url && /^https?:\/\/([^/]+\.)?claude\.ai(\/|$)/i.test(window.url)) return 'claude-web';
  if (TERMINALS.has(window.bundleId) || EDITORS.has(window.bundleId)) {
    if (/claude/i.test(window.windowTitle) || /^\s*✳/.test(window.windowTitle)) return 'claude-code';
    if (CLAUDE_CODE_SIGNATURES.test(text)) return 'claude-code';
  }
  return null;
}

/**
 * A stable, human-readable reference for where a task came from: the product,
 * then the conversation. The product comes first because the app groups and
 * focuses by it: Claude in a browser is "Claude", Claude Code in a terminal or
 * editor is "Claude Code", with the terminal named at the end.
 */
export function sourceRef(window: Pick<Observation, 'app' | 'windowTitle'>, kind: SourceKind | null = null): string {
  // Claude Code prefixes the terminal title with a spinner glyph that changes constantly.
  let title = window.windowTitle.replace(/^[\s✳⠂⠐⠁⠈⠠⠄·*]+/, '').trim();
  if (kind === 'claude-code') {
    title = title.replace(/^claude code$/i, '');
    return title ? `Claude Code — ${title} (${window.app})` : `Claude Code (${window.app})`;
  }
  if (kind === 'claude-web') {
    // A browser tab reads "Stripe webhooks - Claude".
    title = title.replace(/\s+[-–—|]\s+Claude$/i, '').replace(/^Claude$/i, '');
    return title ? `Claude — ${title}` : 'Claude';
  }
  return title && title !== window.app ? `${window.app} — ${title}` : window.app;
}

/**
 * The same, for a source written before sources were named this way, or null if
 * it is already right. "Ghostty — Fix auth" (Claude Code) becomes
 * "Claude Code — Fix auth (Ghostty)"; "Microsoft Edge — Billing - Claude"
 * (claude.ai) becomes "Claude — Billing".
 */
export function renamedSource(kind: string, ref: string): string | null {
  if (kind !== 'claude-code' && kind !== 'claude-web') return null;
  if (kind === 'claude-code' && ref.startsWith('Claude Code')) return null;
  if (kind === 'claude-web' && (ref === 'Claude' || ref.startsWith('Claude — '))) return null;
  const at = ref.indexOf(' — ');
  const app = at === -1 ? ref : ref.slice(0, at);
  const title = at === -1 ? '' : ref.slice(at + 3);
  return sourceRef({ app, windowTitle: title }, kind);
}

const NUMBERED_LINE = /^(\s*)(?:[-•*·●⏺]\s*)?(\d{1,2})\s?[.)]\s+(\S.*)$/;
const BULLET_LINE = /^\s*[-•*·●○◦▪■⎿└├]\s+/;
/** A section line written by the capture layer at the start of each chat message: "⟦Message 23⟧". */
const SECTION_LINE = /^⟦.*⟧$/;
const USER_LABEL = /^\s*You said:/;
/** A Claude message's section: numbered once it is finished, or the one still streaming in. */
const MESSAGE_SECTION = /^⟦(?:Message (\d+)|Currently streaming message)⟧$/;

/**
 * The highest message number among a conversation's message sections; 0 when the only
 * message is one still streaming in; null when the text has no message sections at all.
 */
export function newestMessage(text: string): number | null {
  let newest: number | null = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(MESSAGE_SECTION);
    if (m) newest = Math.max(newest ?? 0, m[1] ? Number(m[1]) : 0);
  }
  return newest;
}

/**
 * The text without the messages numbered `seen` or lower: what was already in the
 * conversation when you first looked at it, including what scrolling back brings up.
 * A message still streaming in is always kept, and so is text outside any message.
 */
export function dropEarlierMessages(text: string, seen: number): string {
  const kept: string[] = [];
  let skipping = false;
  for (const line of text.split(/\r?\n/)) {
    if (SECTION_LINE.test(line)) {
      const n = line.match(MESSAGE_SECTION)?.[1];
      skipping = n !== undefined && Number(n) <= seen;
    }
    if (!skipping) kept.push(line);
  }
  return kept.join('\n');
}

/**
 * Put a window's text back together from its observations.
 *
 * Each observation holds only the lines that were new, each batch under the
 * section line of the message it belongs to. A reply that streams in, or an
 * email whose body loads after its header, therefore arrives in pieces with
 * other things in between. This gathers every section's lines, in the order
 * they arrived, under one heading, so a list or an email reads as one piece.
 * Lines outside any section come first.
 */
export function assemble(observations: string[]): string {
  const outside: string[] = [];
  const sections = new Map<string, string[]>();
  for (const text of observations) {
    let current: string[] = outside; // each observation starts outside any section
    for (const line of text.split(/\r?\n/)) {
      if (SECTION_LINE.test(line)) {
        current = sections.get(line) ?? [];
        sections.set(line, current);
      } else {
        current.push(line);
      }
    }
  }
  return [...outside, ...[...sections].flatMap(([name, lines]) => [name, ...lines])].join('\n');
}
const CLAUDE_LABEL = /^\s*Claude responded:/;
/** Non-empty lines allowed between two items (wrapped text, sub-bullets, code). */
const MAX_GAP_LINES = 8;
const MIN_ITEMS = 2;
const MIN_ACTION_SHARE = 0.5;
const MAX_TITLE_LENGTH = 200;

const ACTION_VERBS = new Set(
  `answer ask attach buy cancel choose clear close drag drop enter find hard-reload hold kill launch
  look note order pay pick plug press quit reboot refresh relaunch renew reset scroll search tap type
  unplug add allow apply approve book build call change check click clone commit configure confirm
  connect copy create decide define delete deploy disable download edit email enable ensure export fill
  fix generate give go grant implement import install keep leave link log make merge migrate move navigate open paste
  point provide publish pull push put read rebuild redeploy register reload remove rename replace
  reply request rerun restart review revoke rotate run save schedule select send set share sign
  start stop submit switch tell test toggle try turn update upgrade upload use verify visit wait
  whitelist write`.split(/\s+/),
);

/** Lead-ins that can precede the verb: "Then run…", "In Vercel, set…", "Don't forget to…". */
/**
 * Who a list is addressed to, judged from the line that introduces it.
 * Claude writes two kinds of list that look alike: things for you to do, and
 * accounts of what it did or is about to do. Only the first kind are tasks.
 */
export type Actor = 'you' | 'assistant' | null;

/** "you need to…", "on your side", "for you to do". */
const ADDRESSED_TO_YOU = /\b(you(?:'ll| will| need| should| must| can| have to| may want)?\b|your\b|yourself\b)/i;
/** "I'll…", "I'm going to…", "here's what I did", "my plan". */
const ASSISTANT_SPEAKING =
  /\b(I(?:'ll| will|'m going to| am going to| plan to|'d| would| can| did| have|'ve| just| already| also| then| changed| added| fixed| made| built| chose| deviated)\b|my (?:plan|approach|next steps?)\b|let me\b)/i;
/** Headings that introduce a report or a plan rather than instructions. */
const REPORT_HEADING =
  /^(what|how|why)\b|^(plan|the plan|approach|implementation(?: plan)?|what(?:'s| is| was)? (?:changed|new|done|verified|fixed|built|included)|what i (?:did|changed|built|tested|verified)|changes|summary|done|completed|fixes|fixed|verified|not verified|tested|results?|status|how it works|what a run does|background|context|options|two options|alternatives)\b/i;

/** Claude offering to do the list itself: "Say go and I'll start", "Want me to…?". */
const OFFER_TO_DO_IT =
  /\bsay\s+["“”'‘’]?(?:go|yes|ok|okay|the word)\b|\bwant me to\b|\bshall I\b|\bshould I (?:go ahead|start|proceed|do|begin)\b|\bI can (?:start|begin|do (?:these|them|this|that|it|both))\b|\band I['’]ll (?:do|start|begin|make|fix|build|implement|take care|go ahead)\b/i;
/** Claude waiting for you to finish: "Tell me when that's done and I'll continue". */
const WAITING_FOR_YOU = /\b(?:when|once|after) (?:you|you['’]ve|you['’]re|that['’]s|that is|it['’]s|they['’]re|those are)\b/i;

/**
 * What the text after a list says about it. A closing offer to do the work
 * means the list was Claude's plan; nothing else here decides anything.
 */
export function followUpActor(after: string[]): Actor {
  return after.some((line) => OFFER_TO_DO_IT.test(line) && !WAITING_FOR_YOU.test(line)) ? 'assistant' : null;
}

export function listActor(leadIn: string | null): Actor {
  if (!leadIn) return null;
  const line = leadIn.replace(/`[^`]*`/g, ' ');
  // "I can't do that for you. On your side:" is still addressed to you.
  if (ADDRESSED_TO_YOU.test(line)) return 'you';
  if (ASSISTANT_SPEAKING.test(line) || REPORT_HEADING.test(line.trim())) return 'assistant';
  return null;
}

const LEAD_INS = [
  /^(first|then|next|finally|lastly|also|now|after that|afterwards|optionally|optional)\b[,:]?\s+/i,
  /^(in|on|from|under|inside|within|at)\s[^,:]{1,50}[,:]\s+/i,
  /^(if|when|once|after|before|while|unless)\s[^,:]{1,80}[,:]\s+/i,
  /^(please|you(?:'ll| will)? need to|you should|you must|make sure to|remember to|don[’']?t forget to|be sure to)\s+/i,
];

export function looksLikeAction(title: string): boolean {
  let rest = title.replace(/^[\s☐☑✓✔□\[\]xX]*\s*/, '');
  for (let pass = 0; pass < 3; pass++) {
    const before = rest;
    for (const re of LEAD_INS) rest = rest.replace(re, '');
    if (rest === before) break;
  }
  const first = rest.match(/^[A-Za-z][A-Za-z-]*/)?.[0]?.toLowerCase();
  if (!first) return false;
  return ACTION_VERBS.has(first) || ACTION_VERBS.has(first.replace(/^re-?/, ''));
}

function cleanTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH).trim();
}

function isPlausibleTitle(title: string): boolean {
  return title.length >= 4 && (title.match(/[A-Za-z]{2,}/g)?.length ?? 0) >= 2;
}

type Author = 'user' | 'claude' | null;

/**
 * A step that ends in a colon is finished by the code that follows it
 * ("…paste this path:" + the path). Put that code in the title.
 */
/**
 * Settle an item once its list is complete: keep the sub-items that are
 * themselves things to do, fold the rest back in as context, and say whether
 * the item is worth keeping (an instruction, or a heading over instructions).
 */
function settle(item: ChecklistItem): boolean {
  completeTitle(item); // before sub-items are folded in: only the item's own lines can finish its title
  item.children = item.children.filter((child) => {
    const keep = settle(child);
    if (!keep) item.fragments.push(child.title, ...child.fragments);
    return keep;
  });
  item.children.forEach((child, i) => { child.position = i + 1; });
  return (!item.headingOnly && looksLikeAction(item.title)) || item.children.length > 0;
}

function completeTitle(item: ChecklistItem): void {
  const code = item.fragments[0];
  if (!/[:：]$/.test(item.title) || !code || BULLET_LINE.test(code) || NUMBERED_LINE.test(code)) return;
  if (code.length > 80 || /[.!?]$/.test(code) || code.split(/\s+/).length > 8) return;
  item.title = cleanTitle(`${item.title} ${code.startsWith('`') ? code : `\`${code}\``}`);
}

const MAX_GROUP_TITLE = 70;

/** Turn a lead-in line ("⏺ Before this works in prod you need to:") into a title, or null if unusable. */
function groupTitle(line: string): string | null {
  let title = line
    .replace(/^[\s⏺●•*·>#-]+/, '')
    .replace(/[\s:：—–-]+$/, '')
    .replace(/\s+/g, ' ');
  // A lead-in that is a whole paragraph: its last sentence is the one introducing the list.
  if (title.length > MAX_GROUP_TITLE) {
    const sentences = title.split(/(?<=[.!?])\s+(?=[A-Z“"])/);
    title = sentences.findLast((s) => s.length >= 12 && s.length <= MAX_GROUP_TITLE)?.replace(/[.\s]+$/, '') ?? title;
  }
  if (title.length < 3 || !/[A-Za-z]{2}/.test(title)) return null;
  return title.length > MAX_GROUP_TITLE ? `${title.slice(0, MAX_GROUP_TITLE - 1).trimEnd()}…` : title;
}

export interface ExtractOptions {
  /**
   * Keep only lists in Claude's messages. Use for chat windows. The capture
   * layer starts each message with a section line, and a message that carries
   * a "You said:" label anywhere in it is yours; every other message is
   * Claude's (its replies after tool use carry no label at all). Text with no
   * section lines falls back to the labels: only what follows "Claude
   * responded:" counts. A view with neither (a document preview, say) is ignored.
   */
  claudeOnly?: boolean;
  /**
   * Also return lists judged to be Claude's own (their `actor` is 'assistant'),
   * so the caller can take back tasks made from them before that was clear.
   */
  includeAssistant?: boolean;
  /**
   * Treat indented lines under an item as the rest of its title. Use for
   * terminals, which wrap long lines; elsewhere indented lines are separate
   * paragraphs or code belonging to the item.
   */
  joinWrapped?: boolean;
}

/**
 * Find numbered checklists in captured text.
 *
 * A checklist is a run of consecutively numbered lines ("1. …", "2) …") with
 * at least two usable items, at least half of which read as actions. The run
 * need not start at 1, since the top of a list is often out of view.
 */
export function extractChecklists(text: string, opts: ExtractOptions = {}): Checklist[] {
  const lists: Checklist[] = [];
  /** Lists as found, each with the line it ended on; who they are for is settled once the text after them is known. */
  const found: { list: Checklist; end: number; forYou: boolean }[] = [];
  let runEnd = 0;
  let run: ChecklistItem[] = [];
  let runIndent = 0;
  let lastPosition: number | null = null;
  /** The item still open for wrapped lines and sub-bullets. */
  let open: ChecklistItem | null = null;
  /** The open item and the sub-items being built under it, outermost first, with each one's indent. */
  let nesting: { indent: number; item: ChecklistItem }[] = [];
  let gap = 0;
  let author: Author = null;
  let runAuthor: Author = null;
  /** The last line of ordinary text, which is the list's lead-in if the list starts right after it. */
  let lastProse: string | null = null;
  /** The opening words of the current message, from its label. */
  let messageSummary: string | null = null;
  let runTitle: string | null = null;
  let runActor: Actor = null;
  /** Your latest message so far, and the one before the list being read. */
  let asked: string | null = null;
  let runAsked: string | null = null;
  const lines = text.split(/\r?\n/);
  // Who wrote each message, decided for the whole message before reading it:
  // the "You said:" label can come after the message's own text.
  // A message can show up several times (new lines of an old message arrive
  // under its section line again), so authorship goes by the section's name.
  const yours = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    if (!SECTION_LINE.test(lines[i]!)) continue;
    let end = i + 1;
    while (end < lines.length && !SECTION_LINE.test(lines[end]!)) end++;
    if (lines.slice(i + 1, end).some((l) => USER_LABEL.test(l))) yours.add(lines[i]!);
  }
  /** Set while inside a message whose author is known from its section. */
  let sectionOwner: Author = null;

  const close = () => {
    if (run.length >= MIN_ITEMS && !(opts.claudeOnly && runAuthor !== 'claude')) {
      // Only steps that tell you to do something are tasks. "After that, the
      // rest of Milestone 3" or "The cache was stale" are statements.
      const actions = run.filter(settle);
      const confidence = Math.round((actions.length / run.length) * 100) / 100;
      const forYou = runActor === 'you';
      // A list introduced as being for you needs only one real step; any other
      // list must be mostly instructions.
      if (actions.length > 0 && (forYou || confidence >= MIN_ACTION_SHARE)) {
        found.push({ list: { title: runTitle, items: actions, confidence, actor: runActor, after: [], asked: runAsked }, end: runEnd, forYou });
      }
    }
    run = [];
    lastPosition = null;
    open = null;
    gap = 0;
  };

  for (const [index, line] of lines.entries()) {
    if (SECTION_LINE.test(line)) {
      close();
      sectionOwner = yours.has(line) ? 'user' : 'claude';
      author = sectionOwner;
      if (sectionOwner === 'user') {
        let end = index + 1;
        while (end < lines.length && !SECTION_LINE.test(lines[end]!)) end++;
        asked = askedText(lines.slice(index + 1, end)) ?? asked;
      }
      messageSummary = null;
      lastProse = null;
      continue;
    }
    if (USER_LABEL.test(line) || CLAUDE_LABEL.test(line)) {
      close();
      if (!sectionOwner) author = USER_LABEL.test(line) ? 'user' : 'claude';
      if (!sectionOwner && USER_LABEL.test(line)) asked = askedText([line]) ?? asked;
      messageSummary = groupTitle(line.replace(/^\s*(You said|Claude responded):/, ''));
      lastProse = null;
      continue;
    }

    const m = line.match(NUMBERED_LINE);
    // A numbered line indented deeper than the list is a sub-step, not the next item.
    if (m && !(lastPosition !== null && m[1]!.length > runIndent)) {
      const position = Number(m[2]);
      if (lastPosition !== null && position !== lastPosition + 1) close();
      if (lastPosition === null) {
        runIndent = m[1]!.length;
        runAuthor = author;
        runTitle = groupTitle(lastProse ?? '') ?? messageSummary;
        runActor = listActor(lastProse);
        runAsked = asked;
      }
      lastProse = null; // a lead-in introduces one list only
      lastPosition = position;
      runEnd = index;
      gap = 0;
      const title = cleanTitle(m[3]!);
      const headingOnly = !isPlausibleTitle(title);
      if (headingOnly && !/[A-Za-z]{2}/.test(title)) {
        open = null; // nothing usable, but the list carries on
        continue;
      }
      // A one-word item ("4. Scaffold:", "1. Vercel") is kept only if real steps turn up under it.
      open = { position, title, fragments: [], children: [], headingOnly };
      nesting = [{ indent: runIndent, item: open }];
      run.push(open);
      continue;
    }

    const trimmed = line.trim();
    if (lastPosition === null) {
      if (trimmed !== '') lastProse = trimmed;
      continue;
    }
    if (trimmed === '') continue;
    const indent = line.length - line.trimStart().length;
    // Lines nested under an item belong to it; only text back at the list's own level counts towards drifting away.
    if (indent <= runIndent && ++gap > MAX_GAP_LINES) {
      close();
      lastProse = trimmed;
      continue;
    }
    if (!open) {
      // Further prose after the list's items: the latest line is the candidate lead-in for a following list.
      if (!BULLET_LINE.test(line) && !m) lastProse = trimmed;
      continue;
    }
    if (indent > runIndent) runEnd = index;
    if (BULLET_LINE.test(line) || m) {
      const title = cleanTitle(m ? m[3]! : line.replace(BULLET_LINE, ''));
      if (indent > runIndent && isPlausibleTitle(title)) {
        // A sub-item: hang it under the nearest item that is indented less.
        while (nesting.length > 1 && nesting.at(-1)!.indent >= indent) nesting.pop();
        const parent = nesting.at(-1)!.item;
        const child: ChecklistItem = { position: parent.children.length + 1, title, fragments: [], children: [] };
        parent.children.push(child);
        nesting.push({ indent, item: child });
      } else {
        open.fragments.push(trimmed);
      }
    } else if (indent > runIndent) {
      // A further paragraph, a line of code, or (in a terminal) a wrapped line:
      // it belongs to the innermost item it is indented under.
      const owner = (nesting.findLast((n) => n.indent < indent) ?? nesting[0]!).item;
      owner.fragments.push(trimmed);
      if (opts.joinWrapped) owner.title = cleanTitle(`${owner.title} ${trimmed}`);
    } else {
      open = null; // unrelated prose
      lastProse = trimmed; // ...which may be introducing the next list
    }
  }
  close();

  for (const { list, end } of found) {
    // The text that follows, up to the end of the message: a closing "Say go and
    // I'll start" shows the list was Claude's plan even when its heading did not.
    for (let i = end + 1; i < lines.length && list.after.length < 6; i++) {
      const line = lines[i]!;
      if (SECTION_LINE.test(line) || USER_LABEL.test(line) || CLAUDE_LABEL.test(line)) break;
      if (line.trim() !== '' && !NUMBERED_LINE.test(line) && !BULLET_LINE.test(line)) list.after.push(line.trim().slice(0, 240));
    }
    if (list.actor === null) list.actor = followUpActor(list.after);
    if (list.actor !== 'assistant' || opts.includeAssistant) lists.push(list);
  }
  return lists;
}

// --- Commands Claude tells you to run ----------------------------------------------------------

/** Programs a shell command usually starts with. */
const SHELL_START =
  /^(?:sudo\s+)?(?:\.{0,2}\/|~\/)?(?:brew|npm|npx|pnpm|yarn|bun|bunx|deno|pip3?|pipx|python3?|node|git|gh|curl|wget|cd|ls|cat|echo|export|unset|mkdir|rm|cp|mv|chmod|chown|defaults|killall|open|launchctl|xcode-select|xcrun|xcodebuild|swift|docker|kubectl|ssh|scp|rsync|supabase|vercel|netlify|firebase|make|cargo|go|ping|dig|nslookup|traceroute|networksetup|ifconfig|ipconfig|scutil|lsof|ps|kill|pkill|df|du|softwareupdate|sw_vers|system_profiler|diskutil|mdfind|mdutil|tail|head|grep|find|sed|awk|tar|unzip|zip|ln|touch|source|tccutil|security|codesign|spctl|plutil|csrutil|pmset|caffeinate|say|uname|whoami|which|env|printenv|nvm|rbenv|pyenv|conda|uv|poetry)\b/;

/** A line that is only a shell command in backticks: "`curl ipinfo.io`", "  `brew install jq`". */
export function commandLine(line: string): string | null {
  const m = line.trim().replace(/^[-•*·]\s+/, '').match(/^`([^`]{2,300})`$/);
  if (!m) return null;
  const code = m[1]!.trim().replace(/^\$\s+/, '');
  return SHELL_START.test(code) ? code : null;
}

/** "… run:", "In Terminal, paste:", "Check it (takes a minute):": a line that hands you what follows. */
const HANDS_OVER = /:\s*$|\b(?:run|paste|type|enter)\b[^.]*$/i;
/** After the command: "Open the Terminal app, paste the command, and press Return." */
const TERMINAL_HINT = /\b(?:terminal|paste (?:the|this|it)|press (?:return|enter))\b/i;

/**
 * Commands a Claude reply tells you to run, one step each: "Check your IP — run `curl ipinfo.io`".
 * Only in Claude's own messages, only a line that is just the command in backticks, and only when
 * the line before hands it to you ("…run:", "…:") or a line after says to use the Terminal.
 * Commands Claude says it ran itself ("I ran:") are left out; an unclear lead-in is left for the
 * model, as with lists. Each command becomes the step's marker, so seeing it run can tick it.
 */
export function extractCommands(text: string): Checklist[] {
  const lists: Checklist[] = [];
  const lines = text.split(/\r?\n/);
  let start = 0;
  /** Your latest message above the reply being read. */
  let asked: string | null = null;
  const flush = (end: number) => {
    const body = lines.slice(start, end);
    if (body.some((l) => USER_LABEL.test(l))) {
      asked = askedText(body) ?? asked; // your own message: what the next reply answers
      return;
    }
    const items: ChecklistItem[] = [];
    let actor: Actor = null;
    for (let i = 0; i < body.length; i++) {
      const code = commandLine(body[i]!);
      if (!code) continue;
      let lead = '';
      for (let j = i - 1; j >= Math.max(0, i - 2); j--) {
        const l = body[j]!.trim();
        if (!l || commandLine(l) || /^\d+ lines?$/i.test(l)) continue;
        lead = l.replace(CLAUDE_LABEL, '').trim();
        break;
      }
      const hinted = body.slice(i + 1, i + 3).some((l) => TERMINAL_HINT.test(l)) || TERMINAL_HINT.test(lead);
      if (!HANDS_OVER.test(lead) && !hinted) continue;
      const who = /\bI (?:ran|executed|used|tried|typed|entered|checked with)\b|^(?:ran|running|executed|output|result)\b/i.test(lead) ? 'assistant' : listActor(lead);
      if (who === 'assistant') continue; // "I ran:", "Here's what I did:"
      if (who === 'you') actor = 'you';
      const said = lead.replace(/[\s,;—–-]*(?:run|paste|type|enter)?\s*:?\s*$/i, '').replace(/[\s,;]+$/, '').trim();
      // Named by the line before only when that line hands the command over; otherwise (it was a
      // Terminal hint after it) the line before may be anything, so the step is just the command.
      const title = HANDS_OVER.test(lead) && isPlausibleTitle(said) && said.length <= 120 ? `${said} — run \`${code}\`` : `Run \`${code}\``;
      if (items.some((x) => x.title === title)) continue;
      items.push({ position: items.length + 1, title: cleanTitle(title), fragments: [`\`${code}\``], children: [] });
    }
    if (items.length === 0) return;
    lists.push({ title: null, items, confidence: 1, actor, after: [], asked });
  };
  for (let i = 0; i < lines.length; i++) {
    if (SECTION_LINE.test(lines[i]!)) {
      flush(i);
      start = i + 1;
    }
  }
  flush(lines.length);
  return lists;
}
