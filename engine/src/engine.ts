import { suggestMerges } from './related.ts';
import { signedFromEmail } from './esign.ts';
import { accountOf, baseSubject, responseAction, isAutomatic, isMine, isRecent, followsLink, mailKey, mailTime, mailLinks, mailOrigin, mailSnippet, mailSource, mailTaskTitle, parseEmails, replyTitle, settleNeed, signedName } from './email.ts';
import type { MailIdentity, MailReader } from './email.ts';
import { chatApp, chatKey, asksForAcknowledgement, chatTaskTitle, isEmojiOnly, isPositiveEmoji, isReaction, lineHash, plainReactions, reactedTo, namesMe, chatSourceRef, chatTime, isMine as isMyMessage, mayAskOfMe, parseChatMessages, plainlyDefers, sentBefore } from './chat.ts';
import type { ChatMessage, ChatReader, ReplyJudge } from './chat.ts';
import { agentWork, assistantFor, hasTurns } from './assistants.ts';
import { agentCommands, agentTodos, ranByAgent, todoKey, withoutAgentWork } from './agents.ts';
import { normalizeSteps } from './steps.ts';
import { assemble, doneByClaude, EDITORS, extractCommands, extractChecklists, replyAround, sourceRef, splitClaudeCode, stepCommands, stepLine, TERMINALS } from './extract.ts';
import { rewordPlacesOnce } from './missed.ts';
import { localModelOf } from './localmodel.ts';
import { cleanCriteria, groundCriteria, matchCriteria, matchedWords } from './donecriteria.ts';
import type { CriteriaWriter } from './donecriteria.ts';
import { doneState, hasToken, learnedWhere, lookCandidate, placeOf, relevantSnippet, siteOf, strongTokens } from './looksdone.ts';
import type { Looker } from './looksdone.ts';
import { deriveCriteria, extractMarkers, withoutLinkTargets } from './markers.ts';
import { findSightings, isComplete, RUN_WINDOW_MS } from './match.ts';
import { splitSession, terminalLines } from './terminal.ts';
import type { Checklist, ChecklistItem } from './extract.ts';
import type { Job, NewChecklist, NewNode, Observation, Outcome, PendingChatAsk, Store, Task, Teaching, TimingPath } from './store.ts';
import { CHECKING_CONFIDENCE, KEPT_KIND, KEPT_LIST, trustKey, TRUST_YES } from './store.ts';

export interface PollStats {
  observations: number;
  windows: number;
  claudeWindows: number;
  checklists: number;
  newTasks: number;
  /** Markers newly seen in the right place. */
  sightings: number;
  /** Tasks ticked because all their markers have now been seen. */
  completed: number;
  /** Lists the on-device model was asked about in this pass. */
  judged: number;
  /** Steps taken back because their list turned out to be Claude's own. */
  retracted: number;
  /** Checklists given a short title by the on-device model. */
  titled: number;
  /** Tasks newly marked "looks done — confirm?". */
  suggested: number;
  /** Emails that became "reply to…" tasks. */
  emails: number;
  /** Email tasks taken off the list because the email was archived. */
  archived: number;
  /** Chat messages that became tasks. */
  chats: number;
  expired: number;
}

/** Counts why something read made no task (SCR-79): a source kind, a reason code, how many. */
export type Drop = (source: string, reason: string, n?: number) => void;

/** What the on-device model said about a list, or null if it could not be asked. */
export interface JudgeReply {
  audience: 'user' | 'assistant';
  model: string;
}
/**
 * Asks the on-device model who a list is for. Returns null when no model is
 * available. Only the list's lead-in and its steps are passed, and they never
 * leave the machine.
 */
export type Judge = (list: { leadIn: string; steps: string[]; after?: string[]; asked?: string | null; reply?: string; teach?: Teaching }) => JudgeReply | null;

/**
 * Asks the on-device model for a short title for a checklist. Returns null
 * when no model is available.
 */
export type Titler = (list: { leadIn: string; steps: string[]; teach?: Teaching }) => string | null;

export interface PollOptions {
  /**
   * Which lane runs this pass (SCR-76). 'fast' asks no model and never waits for one: it reads new
   * screens on its own cursor and writes what needs no model (clear lists, commands, markers, archives,
   * signed requests); mail and chats, verdicts, looks, criteria and titles are left to the full pass.
   * 'full' (the default) is the whole pass, as before; the model lane runs it.
   */
  lane?: 'fast' | 'full';
  /** For the fast lane: a judge exists in the model lane, so an unclear list waits for it instead of being "maybe". */
  judging?: boolean;
  judge?: Judge;
  titler?: Titler;
  looker?: Looker;
  mailReader?: MailReader;
  chatReader?: ChatReader;
  replyJudge?: ReplyJudge;
  /** Writes what done looks like for a new task (SCR-67). */
  criteria?: CriteriaWriter;
}

const EMAILS_PER_POLL = 2;
/** New tasks given "what done looks like" per pass. */
const CRITERIA_PER_POLL = 2;

const LOOKS_PER_POLL = 2;
/** A step with a command (or another exact marker) still open this long after it was made may be looked at too (SCR-69). */
export const AUTO_FALLBACK_MS = 2 * 3600_000;
/** For this long after it joins, its earlier terminal screens are looked at too, once each (the model's answer is kept). */
const AUTO_LOOKBACK_MS = 5 * 60_000;
/** With the local model on (it answers in about two seconds). */
const LOOKS_PER_POLL_LOCAL = 6;

/** What you taught the model for a job, to send with a question; nothing when you taught it nothing. */
function taught(store: Store, job: Job): { teach?: Teaching } {
  const teach = store.teaching(job);
  return teach.instructions === null && teach.examples.length === 0 ? {} : { teach };
}

/** A lead-in that works as a title is short and is not a sentence about something else. */
/** Where a task you typed yourself comes from (SCR-29). */
export const MANUAL_SOURCE = 'Added by you';

/**
 * A task you typed yourself (SCR-29). It is ticked the way a captured one is: by its
 * markers (a command run at a prompt, an env var or URL on the service it names) and by
 * "looks done" where it gets done, and only from what is seen after you added it. It is
 * never merged by wording with a task already on the list: you asked for this one.
 * Null when the title is empty.
 */
export function addManualTask(store: Store, title: string, now: Date = new Date()): number | null {
  const clean = title.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const ts = now.toISOString();
  const { id } = store.upsertTask({
    distinct: `manual ${crypto.randomUUID()}`,
    title: clean,
    sourceKind: 'manual',
    sourceRef: MANUAL_SOURCE,
    confidence: 1,
    position: null,
    ts,
    observationId: null,
    markers: extractMarkers(clean),
    criteria: deriveCriteria(clean),
  });
  store.setOrigin(id, ts, 'You added it by hand');
  return id;
}

/**
 * Add a task to My List (SCR-46), from Siri, Shortcuts or `didja keep`. It stays until you tick it:
 * nothing seen on screen ticks it or suggests it done, and Fresh Start leaves it.
 */
export function keepTask(store: Store, title: string, now: Date = new Date()): number | null {
  const clean = title.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const ts = now.toISOString();
  const { id } = store.upsertTask({
    distinct: `kept ${crypto.randomUUID()}`,
    title: clean.slice(0, 300),
    sourceKind: KEPT_KIND,
    sourceRef: KEPT_LIST,
    confidence: 1,
    position: null,
    ts,
    observationId: null,
    markers: [],
    criteria: { service: null, hosts: [] },
  });
  store.setOrigin(id, ts, 'You added it to My List');
  return id;
}

export function needsShortTitle(title: string): boolean {
  return title.length > 48 || /[.!?…]/.test(title) || /^(I|I['’]\w+|We|It|This|That|There|So|The)\b/.test(title);
}

/** Tidy what the model wrote; null if it is not usable as a title. */
export function cleanModelTitle(raw: string, leadIn: string): string | null {
  const title = raw
    .split(/\r?\n/)[0]!
    .replace(/^["“”'‘’\s]+|["“”'‘’\s.:;,]+$/g, '')
    .replace(/\s+/g, ' ');
  if (title.length < 3 || title.length > 60 || !/[A-Za-z]{2}/.test(title)) return null;
  if (title.toLowerCase() === leadIn.toLowerCase()) return null;
  return title;
}

const TITLES_PER_POLL = 2;

/** How long a queued list must sit unchanged before it is judged (it may still be streaming). */
const JUDGE_SETTLE_MS = 6_000;
const JUDGE_PER_POLL = 2;
/**
 * The confidence of a list kept while no model could say who it is for: shown as "maybe" (SCR-70).
 * Every other list is stored at `MIN_SHOWN_CONFIDENCE` or above, so only these fall below it.
 */
export const MAYBE_CONFIDENCE = 0.2;
const MIN_SHOWN_CONFIDENCE = 0.3;
const CLAUDE_DID_IT = 'Claude did this itself: its own tools ran it after listing it, so it was not yours to do';
/** Why a step an agent then ran with its own tools was taken back (SCR-85). */
const agentRanIt = (name: string) => `${name} ran this itself: it ran the step's command after listing it, so it was not yours to do`;
const CLAUDE_SAID_SO = 'The text around this list shows it is what Claude was going to do, not something asked of you';
const NOT_FOR_YOU = "On-device model: this list reads as Claude's own plan or report, not something asked of you";

/** A captured item as the store wants it: steps carry markers, parents only their sub-steps. */
function toNode(item: ChecklistItem): NewNode {
  if (item.children.length > 0) {
    return { title: item.title, position: item.position, children: item.children.map(toNode) };
  }
  return {
    title: item.title,
    position: item.position,
    markers: extractMarkers(item.title, item.fragments),
    criteria: deriveCriteria(item.title, item.fragments),
  };
}

function judgementKey(list: Checklist): string {
  const text = [list.title ?? '', ...list.items.map((i) => i.title)].join('\n');
  return new Bun.CryptoHasher('sha256').update(text).digest('hex').slice(0, 32);
}

const CURSOR_KEY = 'last_observation_id';
/** The fast lane's own place in the observations (SCR-76). */
const FAST_CURSOR_KEY = 'fast_observation_id';
/**
 * An observation holds only the lines new to its window, so a list can be
 * spread over several. Extraction re-reads this much of the window's history.
 */
const WINDOW_CONTEXT_MS = 30 * 60 * 1000;

/** How a marker tick is counted in "How Didja is doing" (SCR-73): by the kind of thing seen. */
function tickedBy(task: Task): Outcome {
  const kinds = new Set(task.markers.map((m) => m.kind));
  if (kinds.has('command')) return 'ticked-command';
  if (kinds.has('url')) return 'ticked-link';
  if (kinds.has('env')) return 'ticked-setting';
  return 'ticked-file';
}

/** Capture's window key (SCR-72); app and exact title for a row from before schema 24. */
const windowKey = (o: Observation) => o.windowKey ?? `${o.bundleId}\u0000${o.windowTitle}`;

/**
 * One pass: read new observations, find checklists in Claude windows and store
 * them as tasks, then tick tasks whose markers have shown up elsewhere.
 */
export function pollOnce(store: Store, now: Date = new Date(), opts: PollOptions = {}): PollStats {
  // What this pass writes is timed from the screen that showed it (SCR-75).
  store.pass = { at: now, started: store.clock(), seen: null, path: 'fast' };
  try {
    return pass(store, now, opts);
  } finally {
    store.pass = null;
  }
}

/** Run `work` with new tasks measured against `path` (a model's verdict, a chat ask's wait). */
function timedAs<T>(store: Store, path: TimingPath, work: () => T): T {
  const pass = store.pass;
  if (!pass) return work();
  const before = pass.path;
  pass.path = path;
  try {
    return work();
  } finally {
    pass.path = before;
  }
}

function pass(store: Store, now: Date, options: PollOptions): PollStats {
  const fast = options.lane === 'fast';
  // The fast lane never asks a model, whatever it was given.
  const opts: PollOptions = fast ? { lane: 'fast', judging: options.judging } : options;
  store.wakeSnoozed(now);
  // The fast lane keeps its own place; it starts where the full pass is, never from the beginning.
  const cursorKey = fast ? FAST_CURSOR_KEY : CURSOR_KEY;
  if (fast && store.getMeta(FAST_CURSOR_KEY) === null) store.setMeta(FAST_CURSOR_KEY, store.getMeta(CURSOR_KEY) ?? '0');
  const cursor = Number(store.getMeta(cursorKey) ?? 0);
  const fresh = store.observationsAfter(cursor);
  if (store.pass) store.pass.seen = fresh.reduce<string | null>((m, o) => (m === null || o.ts > m ? o.ts : m), null);
  const stats: PollStats = {
    observations: fresh.length,
    windows: 0,
    claudeWindows: 0,
    checklists: 0,
    newTasks: 0,
    sightings: 0,
    completed: 0,
    judged: 0,
    retracted: 0,
    titled: 0,
    suggested: 0,
    emails: 0,
    archived: 0,
    chats: 0,
    expired: 0,
  };

  // Why what was read made no task, counted per source (SCR-79): codes and counts, no text.
  const drops = new Map<string, number>();
  const drop: Drop = (source, reason, n = 1) => {
    if (n <= 0) return;
    const key = `${source}\t${reason}`;
    drops.set(key, (drops.get(key) ?? 0) + n);
  };

  // Latest new observation per window.
  const windows = new Map<string, Observation>();
  for (const o of fresh) windows.set(windowKey(o), o);
  const claudeWindows = new Set<string>();
  stats.windows = windows.size;

  const since = new Date(now.getTime() - WINDOW_CONTEXT_MS).toISOString();
  for (const latest of windows.values()) {
    const history = store.windowObservations(latest, since);
    const text = assemble(history.map((o) => o.text));
    const mailbox = mailSource(latest);
    // Mail and chats are read by the full pass: what they make depends on a model (SCR-76).
    if (fast && (mailbox || chatApp(latest))) continue;
    if (mailbox) {
      drop('email', 'read');
      const mail = readMail(store, text, latest, mailbox, opts.mailReader, now, drop);
      stats.emails += mail.created;
      stats.completed += mail.completed;
      stats.suggested += mail.suggested;
      continue;
    }
    const app = chatApp(latest);
    if (app) {
      drop('chat', 'read');
      const chat = readChat(store, text, latest, app, opts, now, drop);
      stats.chats += chat.created;
      stats.completed += chat.completed;
      stats.suggested += chat.suggested;
      continue;
    }
    const assistant = assistantFor(latest, text);
    const kind = assistant?.sourceKind ?? null;
    if (!assistant || !kind) {
      drop(TERMINALS.has(latest.bundleId) ? 'terminal' : 'other', 'read');
      continue;
    }
    drop(kind, 'read');
    stats.claudeWindows++;
    claudeWindows.add(windowKey(latest));

    const chat = assistant.kind === 'chat';
    // A Claude reply has no date, so "only new messages" never leaves one out: a list you scroll
    // back to see, or one that arrived while you were in another window, is still yours.
    // In Claude Code only Claude's replies hold steps for you: not its tool calls and their output
    // (a file it read, `cat` of a doc), nor what you typed (SCR-65).
    const transcript = kind === 'claude-code' ? splitClaudeCode(text) : null;
    // Where a link in a reply points is not a step's words, nor a marker to tick it by (SCR-68).
    // Steps written as headings, bullets under "Next steps:", boxes, a table or a code block are
    // read as the numbered lines and commands below already are (SCR-84).
    // An agent's approval prompts, their options and answers, and its "ran" lines are its own work,
    // never steps for you: blanked (line numbers kept) so "1. Yes / 2. No, and tell…" is not read
    // as a list, nor swallows the list after it (SCR-85).
    const read = chat ? text : withoutAgentWork(assistant, transcript?.replies ?? text);
    const source = normalizeSteps(withoutLinkTargets(chat ? (transcript?.replies ?? text) : read), { chat });
    // A chat keeps only the assistant's messages. One whose text shows no turns at all is ignored
    // (Claude: a document preview) or read whole (a site with no labels, such as Gemini), by its profile.
    const claudeOnly = chat && (assistant.turns.whenUnlabelled === 'ignore' || hasTurns(assistant, source));
    const lists = extractChecklists(source, { claudeOnly, joinWrapped: !chat, includeAssistant: true });
    // Commands Claude tells you to run, outside any list (a list's own commands are already in it).
    const listed = lists.flatMap((l) => l.items.flatMap(function all(i: ChecklistItem): string[] {
      return [i.title, ...i.fragments, ...i.children.flatMap(all)];
    })).join('\n');
    for (const commands of extractCommands(source)) {
      commands.items = commands.items.filter((i) => !listed.includes(i.fragments[0]!));
      if (commands.items.length > 0) lists.push(commands);
    }
    // What an agent in a terminal or an editor did itself, by its profile (SCR-85): the commands
    // it ran or you declined, and its own todo items.
    const agent = assistant.kind === 'chat' ? null : { commands: agentCommands(assistant, text), todos: agentTodos(assistant, text) };
    if (agent) {
      // A command you declined to let the agent run is yours to run, with the command as its marker.
      const all = lists.flatMap((l) => l.items.flatMap(function each(i: ChecklistItem): string[] {
        return [i.title, ...i.fragments, ...i.children.flatMap(each)];
      })).join('\n');
      // Kept even when the agent ran it afterwards, so the step below is taken back as the agent's.
      const declined = agent.commands.filter((d) => d.how === 'declined');
      const items: ChecklistItem[] = [];
      for (const d of declined) {
        const code = `\`${d.command}\``;
        if (all.includes(code) || items.some((i) => i.fragments[0] === code)) continue;
        items.push({ position: items.length + 1, title: `Run ${code}`, fragments: [code], children: [] });
      }
      if (items.length > 0) lists.push({ title: null, items, confidence: 1, actor: 'you', after: [], asked: null });
    }
    if (lists.length === 0) drop(kind, 'no-list');
    for (const list of lists) {
      drop(kind, 'seen');
      // A list under the agent's own plan or todo heading ("Planned for 3 steps", "# Todos"), by its
      // profile (SCR-83), is the agent's work, not steps for you.
      if (list.actor !== 'assistant' && list.title && agentWork(assistant, list.title) === 'todo') list.actor = 'assistant';
      if (list.actor === 'assistant') {
        drop(kind, 'claude-own');
        // Claude's own plan. It may have been taken as yours before the telling line arrived: take it back.
        stats.retracted += retract(store, list.items.map((i) => i.title), CLAUDE_SAID_SO, now, sourceRef(latest, kind));
        continue;
      }
      // The wording does not say who this list is for: go by the model's verdict. Until there is one,
      // the list is held and makes no task (SCR-70); with no model at all it is kept as "maybe".
      const unclear = list.actor === null;
      const key = unclear ? judgementKey(list) : '';
      const verdict = unclear ? store.getJudgement(key) : null;
      if (verdict === 'assistant') {
        drop(kind, 'claude-own');
        continue;
      }
      // Steps you said are not actions are not captured again.
      const keep = (items: ChecklistItem[]): ChecklistItem[] =>
        items.filter((i) => !store.isNotAnAction(i.title)).map((i) => ({ ...i, children: keep(i.children) }));
      list.items = keep(list.items);
      if (list.items.length === 0) {
        drop(kind, 'not-an-action');
        continue;
      }
      // The agent's own todo items are its work, and so is a step worded like one (SCR-85).
      if (agent && agent.todos.size > 0) {
        const mine = (items: ChecklistItem[]): ChecklistItem[] =>
          items.filter((i) => !agent.todos.has(todoKey(i.title))).map((i) => ({ ...i, children: mine(i.children) }));
        list.items = mine(list.items);
        if (list.items.length === 0) {
          drop(kind, 'claude-own');
          continue;
        }
      }

      const only = list.items.length === 1 ? list.items[0]! : null;
      const checklist: NewChecklist = {
        title: list.title ?? 'Checklist',
        sourceKind: kind,
        sourceRef: sourceRef(latest, kind),
        confidence: Math.max(list.confidence, MIN_SHOWN_CONFIDENCE),
        ts: latest.ts,
        observationId: latest.id,
        items: list.items.map(toNode),
        // One step is just a task (or, with sub-steps, its own checklist); it needs no parent around it.
        wrap: only === null,
      };
      if (unclear && verdict === null) {
        if (opts.judge || opts.judging) {
          // Shown at once as "checking…" while the model decides (SCR-78): greyed, not counted.
          const shown = store.upsertChecklist({ ...checklist, confidence: CHECKING_CONFIDENCE });
          stats.newTasks += shown.created;
          drop(kind, 'checking');
          const slot = `${sourceRef(latest, kind)}\u0000${list.title ?? ''}`;
          const payload = JSON.stringify({
            leadIn: list.title ?? '', steps: list.items.map((i) => i.title), after: list.after.slice(0, 3),
            ...(list.asked ? { asked: list.asked } : {}), reply: replyAround(source, list.items[0]!.title), list: checklist,
            ...(shown.rootId !== null ? { rootId: shown.rootId } : {}),
          });
          store.setPendingJudgement(slot, key, payload, now);
          continue;
        }
        checklist.confidence = MAYBE_CONFIDENCE;
        drop(kind, 'no-model');
      }

      stats.checklists++;
      const { rootId, created } = store.upsertChecklist(checklist);
      stats.newTasks += created;
      // Judged yours after it was kept as "maybe" (a model became available): no longer maybe.
      if (verdict === 'user' && rootId !== null) store.unmarkMaybe(rootId, checklist.confidence, MAYBE_CONFIDENCE);
      // Steps Claude then carried out with its own tools are its, not yours: taken back, never ticked.
      if (transcript?.split) {
        const steps = list.items.flatMap(function all(i: ChecklistItem): ChecklistItem[] { return [i, ...i.children.flatMap(all)]; });
        const did = steps.filter((i) => i.children.length === 0 && doneByClaude(i, transcript.tools, stepLine(source, i.title)));
        stats.retracted += retract(store, did.map((i) => i.title), CLAUDE_DID_IT, now, sourceRef(latest, kind));
      }
      // Steps any agent then ran with its own tools, after the step was listed (or, for a command
      // you declined, after you declined it): the agent's, taken back, never ticked (SCR-85).
      if (agent && agent.commands.some((c) => c.how === 'ran')) {
        const steps = list.items.flatMap(function all(i: ChecklistItem): ChecklistItem[] { return [i, ...i.children.flatMap(all)]; });
        const did = steps.filter((i) => {
          if (i.children.length > 0) return false;
          let from = stepLine(text, i.title);
          if (from < 0) {
            const commands = stepCommands(i);
            from = agent.commands.filter((d) => d.how === 'declined' && commands.includes(d.command)).reduce((m, d) => Math.max(m, d.line), -1);
          }
          return ranByAgent(i, agent.commands, from);
        });
        stats.retracted += retract(store, did.map((i) => i.title), agentRanIt(assistant.name), now, sourceRef(latest, kind));
      }
    }
  }

  // Emails archived since the last pass: the capture layer writes a line for each.
  // After the mail above was read, so a task made in this same pass is covered.
  for (const o of fresh) {
    const mailbox = mailSource(o);
    if (!mailbox) continue;
    for (const line of o.text.split(/\r?\n/)) {
      const subject = line.match(/^⟦Archived email: (.+)⟧$/)?.[1];
      if (subject) stats.archived += store.dismissArchived(mailbox, subject, now);
    }
  }

  // Completion: markers seen outside Claude windows, where the task text itself lives.
  // Mail is read by its own rules above; a screen full of email must not tick or suggest anything else.
  const elsewhere = fresh.filter((o) => !claudeWindows.has(windowKey(o)) && mailSource(o) === null);
  const touched = new Set<number>();
  // My List (SCR-46) is ticked only by you, never by what is seen on screen.
  const watchable = store.listTasks({ all: true }).filter((t) => (t.status === 'open' || t.status === 'snoozed') && t.sourceKind !== KEPT_KIND);
  // A command counts once the lines after it show it ran (SCR-61); those may come in a later
  // observation, and the command's own line in an earlier one, so terminals' recent lines are given too.
  const firstFresh = elsewhere.reduce<string | null>((m, o) => (m === null || o.ts < m ? o.ts : m), null);
  const terminalHistory = firstFresh === null ? [] : store
    .observationsSince(new Date(Date.parse(firstFresh) - RUN_WINDOW_MS).toISOString())
    .filter((o) => (TERMINALS.has(o.bundleId) || EDITORS.has(o.bundleId)) && !claudeWindows.has(windowKey(o)));
  for (const s of findSightings(watchable, elsewhere, [...terminalHistory, ...elsewhere.filter((o) => !terminalHistory.some((h) => h.id === o.id))])) {
    if (store.addSighting(s.taskId, s.marker.value, s.observationId, s.ts, s.detail)) {
      stats.sightings++;
      touched.add(s.taskId);
    }
  }
  for (const id of touched) {
    const task = store.getTask(id);
    if (task && (task.status === 'open' || task.status === 'snoozed') && isComplete(task, store.seenMarkers(id))) {
      store.withOutcome(id, tickedBy(task), now, () => store.setStatus(id, 'done', now));
      stats.completed++;
    }
  }

  // An e-signature request from an email, signed through its link: ticked without asking the model.
  stats.completed += signedFromEmail(store, fresh, now);
  if (fast) {
    const last = fresh.at(-1);
    if (last) store.setMeta(cursorKey, String(last.id));
    return stats;
  }

  // Model jobs, most wanted first (SCR-76): verdicts on new tasks (mail and chats were read above,
  // lists here), then what done looks like, then "looks done?", then titles. Each queue picks only
  // what still needs it: an open task, a list not yet judged.
  const lookable = store.maxTaskId();
  if (opts.judge) stats.judged = timedAs(store, 'model', () => judgePending(store, opts.judge!, now));
  // What done looks like, written while the task's source is still at hand (SCR-67).
  if (opts.criteria) writeCriteria(store, opts.criteria);
  if (opts.looker) {
    // A list judged just now is looked at from the next pass, as before verdicts came first:
    // these screens were read before it was a task.
    const followed = followLinks(store, opts.looker, elsewhere, now, lookable);
    stats.completed += followed.completed;
    stats.suggested += followed.suggested;
    stats.suggested += lookForDone(store, opts.looker, elsewhere, now, lookable);
  }
  // If you chose to accept "looks done" automatically, every suggestion waiting
  // for a yes is taken as a yes, labelled as ticked for you.
  if (store.looksDoneMode() === 'accept') {
    for (const task of store.tasksLookingDone()) {
      // A step with something exact to look for (a command) that was only suggested after its
      // exact match was missed waits for your yes (SCR-69).
      if (task.auto) continue;
      store.acceptLooksDone(task.id, task.suggestion!, now);
      stats.completed++;
    }
  }
  // The same thing seen in two places (a Teams message and the email it announced): suggest merging.
  suggestMerges(store, now);
  if (opts.titler) stats.titled = titlePending(store, opts.titler, now);

  const last = fresh.at(-1);
  if (last) store.setMeta(CURSOR_KEY, String(last.id));
  // Chat asks that waited long enough without a reply of yours become tasks (SCR-45).
  foldChatConversationsOnce(store, now);
  rewordPlacesOnce(store, now);
  store.dropEmptyLessonsOnce();
  stats.chats += timedAs(store, 'wait', () => promotePendingChatAsks(store, now));
  stats.expired = store.pruneObservations(now);
  store.pruneContext();
  store.recordDrops(drops, now);
  return stats;
}

/** Bumped when the question put to the model about an email changes. */
const EMAIL_CHECKS_VERSION = '3';

/**
 * Mail (Outlook, Gmail): turn an email that asks something of you into a task
 * that says what to do, and notice when a reply has gone out.
 */
function readMail(
  store: Store, text: string, latest: Observation, mailbox: string, reader: MailReader | undefined, now: Date, drop: Drop = () => {},
): { created: number; completed: number; suggested: number } {
  const emails = parseEmails(text);
  const me = learnIdentity(store, latest, mailbox, emails);
  let created = 0;
  let completed = 0;
  let suggested = 0;
  let asked = 0;

  // A message in a conversation we are waiting to answer, from someone other than the person who asked.
  const awaited = store.repliesAwaited();
  const answers = new Set<object>();
  for (const email of emails) {
    for (const task of awaited) {
      const want = task.criteria!.reply!;
      if (task.suggestion || baseSubject(email.subject) !== want.subject) continue;
      const sameSender = email.fromAddress !== null && want.from !== null
        ? email.fromAddress === want.from
        : email.fromName.toLowerCase() === (want.fromName ?? '').toLowerCase();
      if (sameSender) {
        // Their message, with a reaction on it ("1 Like"). Outlook does not say whose, and 👍 can
        // mean "will do": it only asks you, like an emoji reply in a chat.
        if (email.reactions) {
          const place = `${mailbox} — a reaction (${email.reactions}) on “${email.subject.trim().slice(0, 80)}”`;
          if (!store.rejectedPlaces(task.id).has(place)) {
            store.suggestDone(task.id, place, latest.id, now);
            task.suggestion = place;
            suggested++;
          }
        }
        continue; // them again, not you
      }
      answers.add(email);
      const place = `${mailbox} — a reply in “${email.subject.trim().slice(0, 80)}”`;
      if (store.rejectedPlaces(task.id).has(place)) continue;
      store.suggestDone(task.id, place, latest.id, now);
      task.suggestion = place;
      suggested++;
    }
  }

  // Your response to an approval workflow's request (SCR-55): its Approve, Reject or Forward link
  // sends a new email, not a reply, with the request's own subject and a "Response Action:" line.
  // Only an email sent as you, in the same mailbox, with exactly that subject and that line.
  for (const email of emails) {
    const action = responseAction(email);
    if (action === null || !isMine(email, me)) continue;
    answers.add(email);
    for (const task of store.mailTasksWithSubject(mailbox, email.subject)) {
      const place = `${mailbox} — your “${action}” response to “${email.subject.trim().slice(0, 80)}”`;
      if (store.rejectedPlaces(task.id).has(place)) continue;
      store.tickByResponse(task.id, place, now);
      completed++;
    }
  }

  if (!reader) {
    drop('email', 'no-model');
    return { created, completed, suggested };
  }
  store.forgetEmailChecksBefore(EMAIL_CHECKS_VERSION);
  // Only new messages: leave out mail plainly sent before capture started.
  const start = store.onlyNewMessages() ? store.captureStartedAt() : null;
  const startMinute = start ? new Date(Math.floor(start.getTime() / 60_000) * 60_000) : null;
  for (const email of emails) {
    // Fresh mail from people, with a body to read: not old mail, not machines.
    if (!isRecent(email.date, now) || isAutomatic(email) || email.body.length === 0) continue;
    const sent = startMinute ? mailTime(email.date, now) : null;
    if (startMinute && sent && sent.getTime() < startMinute.getTime()) {
      drop('email', 'older');
      continue;
    }
    // Your own message asks nothing of you: an answer just noticed above, or,
    // where the page says who it went to (Gmail's "to me"), one not sent to you.
    // Outlook shows names, not "me": a message sent as the account the window
    // belongs to is yours.
    if (answers.has(email) || isMine(email, me) || (mailbox === 'Gmail' && email.to !== '' && !/\bme\b/i.test(email.to))) continue;
    const mail = mailKey(email);
    const shown = store.mailTask(mail);
    if (shown) store.touch(shown.id, latest.ts); // on screen again: recent activity
    const key = `${mail}:${email.body.length}`;
    if (store.emailVerdict(key) !== null) continue;
    if (asked >= EMAILS_PER_POLL) break;
    asked++;
    const answer = reader({ ...mailSnippet(email), ...taught(store, 'emails') });
    if (answer === null) {
      drop('email', 'no-model');
      break;
    }
    const verdict = settleNeed(email, answer);
    store.recordEmailCheck(key, verdict.need, now);
    drop('email', 'seen');
    if (verdict.need === 'none') {
      drop('email', 'not-for-you');
      continue;
    }
    // You said an email in this conversation asks nothing of you.
    if (store.isNotAnActionEmail(email.fromName, email.subject)) {
      drop('email', 'not-an-action');
      continue;
    }
    const title = mailTaskTitle(email, verdict);
    const origin = mailOrigin(email, signedName(email, verdict.asker));
    const links = mailLinks(email);
    // Reading an email again (more of it has loaded, or the question put to the
    // model changed) rewords its task; it never makes a second one, and never
    // brings back one you have dealt with.
    // A task made before emails were linked counts too, finished or not.
    const known = store.mailTask(mail) ?? store.unlinkedMailTask(email.subject);
    if (known !== null) {
      const earlier = known.id;
      store.linkMail(mail, earlier);
      if (known.status !== 'open') continue;
      store.setLinks(earlier, links);
      if (title !== replyTitle(email)) {
        store.retitle(earlier, title);
        store.setOrigin(earlier, latest.ts, origin);
      }
      continue;
    }
    const result = store.upsertTask({
      distinct: mail,
      title,
      sourceKind: 'email',
      sourceRef: mailbox,
      confidence: 1,
      position: null,
      ts: latest.ts,
      observationId: latest.id,
      markers: [],
      // An answer is noticed in the conversation; something to do elsewhere is
      // left to "looks done", which watches the screens where it would happen.
      criteria: verdict.need === 'reply'
        ? { service: null, hosts: [], reply: { subject: baseSubject(email.subject), from: email.fromAddress, fromName: email.fromName }, ...(links.length ? { links } : {}) }
        : links.length ? { service: null, hosts: [], links } : null,
    });
    store.linkMail(mail, result.id);
    if (result.created) {
      created++;
      store.setOrigin(result.id, latest.ts, origin);
    }
  }
  return { created, completed, suggested };
}

const CHATS_PER_POLL = 3;

/** Who you are, for chats: set in the app's Your Names window (or `didja names`). */
export interface Names {
  /** Your Mac account's full name, written by the app. */
  mac: string | null;
  /** The name you set; when none, the Mac name is used. */
  name: string | null;
  /** Names your own emails are sent under, learned from mail windows. */
  mail: string[];
  /** Other names and nicknames you are called or tagged by, in any language. */
  others: string[];
}

export function namesOf(store: Store): Names {
  let mail: string[] = [];
  try {
    const saved = JSON.parse(store.getMeta(IDENTITY_KEY) ?? 'null');
    if (saved && Array.isArray(saved.names)) mail = saved.names.filter((n: unknown): n is string => typeof n === 'string' && n.trim() !== '').map((n: string) => n.trim());
  } catch {
    // unreadable: none from mail
  }
  const clean = (v: string | null) => (v?.trim() ? v.trim() : null);
  return {
    mac: clean(store.getMeta('my_name')),
    name: clean(store.getMeta('my_chosen_name')),
    mail,
    others: (store.getMeta('my_other_names') ?? '').split('\n').map((n) => n.trim()).filter(Boolean),
  };
}

/** All your names, once each: your name (or the Mac's), the others you added, and your mail names. */
export function myNames(store: Store): string[] {
  const n = namesOf(store);
  const all = [n.name ?? n.mac, ...n.others, ...n.mail].filter((v): v is string => !!v);
  const seen = new Set<string>();
  return all.filter((v) => (seen.has(v.toLowerCase()) ? false : (seen.add(v.toLowerCase()), true)));
}

/**
 * Chat apps: a message that asks something of you becomes a task, and your reply after it ticks
 * it, unless the reply puts it off. See chat.ts for the rules.
 */
function readChat(
  store: Store, text: string, latest: Observation, app: string, opts: PollOptions, now: Date, drop: Drop = () => {},
): { created: number; completed: number; suggested: number } {
  const messages = parseChatMessages(text);
  const me = myNames(store);
  let created = 0;
  let completed = 0;
  let suggested = 0;

  // Your replies to asks already on the list.
  const plain = plainReactions(text);
  for (const task of store.chatTasksAwaited()) {
    const want = task.criteria!.chat!;
    if (want.app !== app) continue;
    // A reaction seen in plain text names the message it is on, not the chat: it is placed in the
    // ask's chat only when its first line is the ask's own.
    for (const r of plain) {
      if (lineHash(r.quote) === want.key.split(':').pop()) {
        messages.push({ chat: want.chat, kind: 'unknown', from: 'me', mentionsMe: false, time: 'reaction', body: `[reacted ${r.emoji} to “${r.quote.slice(0, 200)}”]` });
      }
    }
    const place = `${app} — ${want.chat}`;
    if (store.rejectedPlaces(task.id).has(place)) continue;
    const askedAt = new Date(want.at);
    const askIndex = messages.findIndex((m) => chatKey(app, m) === want.key);
    for (const [index, m] of messages.entries()) {
      if (m.chat !== want.chat || !isMyMessage(m, me) || m.body.trim() === '') continue;
      // Your reaction on the ask itself (WhatsApp's chat list names the message, not the time):
      // it answers the ask whenever it was made. On some other message it is not about the ask.
      const onMessage = isReaction(m.body) ? reactedTo(m.body) : null;
      const onTheAsk = onMessage !== null && lineHash(onMessage) === want.key.split(':').pop();
      if (m.time === 'reaction' && !onTheAsk) continue;
      // Sent after the ask. Order on screen is the order lines were seen, not sent (scrolling up
      // shows older messages last), so it goes by the time shown; within the same minute, it
      // must also come below the ask. A time that cannot be read never counts.
      const when = chatTime(m.time, now);
      if (!onTheAsk) {
        if (when === null || when.getTime() < askedAt.getTime()) continue;
        if (when.getTime() === askedAt.getTime() && !(askIndex >= 0 && index > askIndex)) continue;
      }
      const key = `reply:${task.id}:${chatKey(app, m)}`;
      if (store.emailVerdict(key) !== null) continue;
      const emoji = isReaction(m.body) || isEmojiOnly(m.body);
      const ask = messages[askIndex]?.body ?? '';
      // 👍 (or ✅, 🙏…) to an ask that only wants you to acknowledge it is the whole answer.
      const acknowledged = emoji && isPositiveEmoji(m.body) && asksForAcknowledgement(task.capturedTitle, ask);
      let verdict = acknowledged ? 'settles' : plainlyDefers(m.body) ? 'defers' : opts.replyJudge?.({ app, task: task.capturedTitle, ask, reply: m.body.slice(0, 600) }) ?? null;
      if (verdict === null) verdict = 'unsure';
      // Otherwise only emoji, or a reaction: never ticked on the model's word alone (👍 to "send
      // it" means "will do"); you are asked.
      if (verdict === 'settles' && emoji && !acknowledged) verdict = 'unsure';
      store.recordEmailCheck(key, verdict, now);
      if (verdict === 'defers') continue; // still to do
      if (verdict === 'settles') {
        store.tickByReply(task.id, place, now);
        completed++;
      } else {
        // The model could not tell, or there is none: ask you rather than tick.
        store.suggestDone(task.id, `${place} (your reply)`, latest.id, now);
        suggested++;
      }
      break;
    }
  }

  // A reply of yours in a chat answers the asks still waiting there (SCR-45): a conversation you are
  // having live makes no tasks. A reply that puts things off does not count.
  for (const m of messages) {
    if (!isMyMessage(m, me) || isReaction(m.body) || m.body.trim() === '' || plainlyDefers(m.body)) continue;
    const when = chatTime(m.time, now);
    if (when === null) continue;
    for (const key of store.answerPendingChatAsks(app, m.chat, when)) store.recordEmailCheck(key, 'answered', now);
  }

  const reader = opts.chatReader;
  if (!reader) {
    drop('chat', 'no-model');
    return { created, completed, suggested };
  }
  let asked = 0;
  // Only new messages: leave out what was plainly sent before capture started.
  const start = store.onlyNewMessages() ? store.captureStartedAt() : null;
  for (const [index, m] of messages.entries()) {
    if (!mayAskOfMe(m, me, now)) continue;
    const key = chatKey(app, m);
    const shown = store.mailTask(key);
    if (shown) {
      store.touch(shown.id, latest.ts);
      continue;
    }
    if (start && sentBefore(m, start, now)) {
      drop('chat', 'older');
      continue;
    }
    if (store.emailVerdict(key) !== null) continue;
    // Already answered on screen: a reply of yours sent after it that does not put it off.
    const sent = chatTime(m.time, now);
    const later = messages.slice(index + 1).filter((r) => {
      const when = chatTime(r.time, now);
      return r.chat === m.chat && isMyMessage(r, me) && !isReaction(r.body) && sent !== null && when !== null && when.getTime() >= sent.getTime();
    });
    if (later.some((r) => !plainlyDefers(r.body))) {
      store.recordEmailCheck(key, 'answered', now);
      continue;
    }
    if (asked >= CHATS_PER_POLL) break;
    asked++;
    const before = messages.slice(Math.max(0, index - 6), index).filter((b) => b.chat === m.chat)
      .map((b: ChatMessage) => ({ from: isMyMessage(b, me) ? 'me' : b.from, text: b.body.slice(0, 300) }));
    const answer = reader({
      app, chat: m.chat, group: m.kind !== 'direct', me, from: m.from,
      ...(m.kind !== 'direct' ? { addressed: namesMe(m, me) ? 'named' as const : 'everyone' as const } : {}), message: m.body.slice(0, 1200), before, ...taught(store, 'chats'),
    });
    if (answer === null) {
      drop('chat', 'no-model');
      break;
    }
    store.recordEmailCheck(key, answer.asks ? 'ask' : 'none', now);
    drop('chat', 'seen');
    if (!answer.asks) {
      drop('chat', 'not-for-you');
      continue;
    }
    const title = chatTaskTitle(answer.task) ?? `Reply to ${m.from}`;
    // Chat lessons are the chat job's (SCR-71); ones taught before that were stored with lists.
    if (store.isNotAnAction(title, 'chats') || store.isNotAnAction(title)) {
      drop('chat', 'not-an-action');
      continue;
    }
    // Worded around you ("Lena asks Mike to respond…"): the model misread who asks whom.
    if (namesMe({ body: title, mentionsMe: false }, me)) {
      store.recordEmailCheck(key, 'none', now);
      continue;
    }
    const sentAt = chatTime(m.time, now);
    const ask: PendingChatAsk = {
      key, app, chat: m.chat, from: m.from, title, at: (sentAt ?? now).toISOString(), observationId: latest.id, ts: latest.ts,
    };
    // Sent moments ago: wait, in case you answer it while the conversation goes on. A time that
    // cannot be read cannot be waited on, so it is not.
    if (sentAt !== null && now.getTime() - sentAt.getTime() < CHAT_ASK_WAIT_MS) {
      store.addPendingChatAsk(ask, now);
      drop('chat', 'waiting');
      continue;
    }
    if (addChatAsk(store, ask, now)) created++;
  }
  return { created, completed, suggested };
}

/** How long a chat ask waits for a reply of yours before it becomes a task (SCR-45). */
export const CHAT_ASK_WAIT_MS = 10 * 60_000;

/**
 * A chat ask becomes a task, or joins the open task already there for that conversation: one
 * task per chat, which waits for a reply of yours after its newest ask (SCR-45). True if a task
 * was made.
 */
function addChatAsk(store: Store, ask: PendingChatAsk, now: Date): boolean {
  const chat = { app: ask.app, chat: ask.chat, from: ask.from, at: ask.at, key: ask.key };
  const open = store.openChatTask(ask.app, ask.chat);
  if (open) {
    store.addAskToChatTask(open.id, chat, ask.title, now);
    store.linkMail(ask.key, open.id);
    return false;
  }
  const result = store.upsertTask({
    distinct: ask.key,
    title: ask.title,
    sourceKind: 'chat',
    sourceRef: chatSourceRef(ask.app, ask.chat),
    confidence: 1,
    position: null,
    ts: ask.ts,
    observationId: ask.observationId,
    markers: [],
    criteria: { service: null, hosts: [], chat },
  });
  store.linkMail(ask.key, result.id);
  return result.created;
}

/** Asks that waited without a reply of yours: they become tasks now, even if the chat is no longer on screen. */
function promotePendingChatAsks(store: Store, now: Date): number {
  let created = 0;
  for (const ask of store.duePendingChatAsks(now, CHAT_ASK_WAIT_MS)) {
    store.dropPendingChatAsk(ask.key);
    if (addChatAsk(store, ask, now)) created++;
  }
  store.prunePendingChatAsks(now);
  return created;
}

/**
 * Once: chats that already became several open tasks, one per message, are folded into one task
 * per conversation (its newest), so a single reply or confirm settles them (SCR-45).
 */
function foldChatConversationsOnce(store: Store, now: Date): void {
  const FLAG = 'chat_conversations_folded';
  if (store.getMeta(FLAG)) return;
  const groups = new Map<string, Task[]>();
  for (const t of store.listTasks()) {
    const c = t.criteria?.chat;
    if (!c || t.isGroup || (t.status !== 'open' && t.status !== 'snoozed')) continue;
    const k = `${c.app}\u0000${c.chat}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  for (const tasks of groups.values()) {
    if (tasks.length < 2) continue;
    const [keep, ...others] = [...tasks].sort((a, b) => b.id - a.id);
    for (const other of others) store.merge(keep!.id, other.id, now, 'chat');
  }
  store.setMeta(FLAG, now.toISOString());
}

const IDENTITY_KEY = 'mail_identity';
const IDENTITY_MAX = 6;

/**
 * Who you are in your mail, learned from what mail windows show and kept in
 * `meta`: the account in the window's title, and the name your own messages
 * carry once one is seen sent from that account's address. Only a name or an
 * address is kept, never anything else from the window.
 */
function learnIdentity(store: Store, window: Observation, mailbox: string, emails: ReturnType<typeof parseEmails>): MailIdentity {
  let me: MailIdentity = { addresses: [], names: [] };
  try {
    const saved = JSON.parse(store.getMeta(IDENTITY_KEY) ?? 'null');
    if (saved && Array.isArray(saved.addresses) && Array.isArray(saved.names)) me = { addresses: saved.addresses, names: saved.names };
  } catch {
    // unreadable: start again
  }
  const seen = accountOf(window, mailbox);
  for (const email of emails) {
    if (email.fromAddress !== null && (me.addresses.includes(email.fromAddress) || seen.addresses.includes(email.fromAddress)) && email.fromName !== email.from) {
      seen.names.push(email.fromName);
    }
  }
  const add = (list: string[], value: string) => {
    if (list.some((v) => v.toLowerCase() === value.toLowerCase())) return false;
    list.push(value);
    if (list.length > IDENTITY_MAX) list.shift();
    return true;
  };
  let changed = false;
  for (const a of seen.addresses) changed = add(me.addresses, a) || changed;
  for (const n of seen.names) changed = add(me.names, n) || changed;
  if (changed) store.setMeta(IDENTITY_KEY, JSON.stringify(me));
  return me;
}

/** How long you must have been on a linked page before what appears there can tick a task. */
const LINK_SETTLE_MS = 10_000;
const TICKED_BY_LINK = 'Ticked: you opened the link from the email, and the page then showed it done';

/**
 * A task from an email that linked somewhere: when you are on that very page,
 * ask the model whether what is on it shows the task done.
 *
 * It ticks only when all of this holds: the page is the one the email's own
 * link points to (same site, path and record id); you had already been on it
 * for a while, so what the model is shown is what appeared after you arrived,
 * not the page as it first loaded; the model says done; and the task has not
 * been ticked this way before (if you reopened it, it will only ask). A "done"
 * on arrival, when you may simply be looking at the request, asks you to confirm.
 */
function followLinks(store: Store, looker: Looker, observations: Observation[], now: Date, upTo = Infinity): { completed: number; suggested: number } {
  const result = { completed: 0, suggested: 0 };
  const tasks = store.tasksWithLinks().filter((t) => t.id <= upTo);
  if (tasks.length === 0) return result;
  let asked = 0;
  for (const o of [...observations].reverse()) {
    if (!o.url) continue;
    for (const task of tasks) {
      if (task.status !== 'open' || o.ts <= task.createdAt) continue;
      const links = task.criteria!.links!.filter((link) => followsLink(o.url, link));
      if (links.length === 0) continue;
      const place = placeOf(o);
      const snippet = (relevantSnippet(task.capturedTitle, o) ?? o.text.split(/\r?\n/).map((l) => l.trim().slice(0, 200)).filter(Boolean).slice(0, 14).join('\n')).slice(0, 900);
      if (!snippet) continue;
      const key = new Bun.CryptoHasher('sha256').update(`link\n${task.id}\n${snippet}`).digest('hex').slice(0, 32);
      if (store.looksDoneVerdict(key) !== null) continue;
      if (asked >= LOOKS_PER_POLL) return result;
      asked++;
      const verdict = looker({ task: task.capturedTitle, app: o.app, page: place, text: snippet, ...taught(store, 'looks-done') });
      if (verdict === null) return result; // no model
      store.recordLooksDoneCheck(key, task.id, verdict, now);
      if (verdict !== 'done') continue;

      const arrived = store.pagesSeenSince(task.createdAt).find((page) => links.some((link) => followsLink(page.url, link)));
      const settled = arrived !== undefined && Date.parse(o.ts) - Date.parse(arrived.ts) >= LINK_SETTLE_MS;
      const before = store.listEvidence(task.id).some((e) => e.detail?.startsWith(TICKED_BY_LINK));
      if (settled && !before) {
        store.tickSeen(task.id, o.id, `${TICKED_BY_LINK} (${place})`, now);
        task.status = 'done';
        result.completed++;
      } else if (!task.suggestion && !store.rejectedPlaces(task.id).has(place)) {
        store.suggestDone(task.id, place, o.id, now);
        task.suggestion = place;
        result.suggested++;
      }
    }
  }
  return result;
}

/**
 * For tasks with nothing exact to match: show the model the screens that have
 * to do with them and, where it says the task looks done, ask the user to
 * confirm. Never ticks. Screens in Claude windows are left out by the caller.
 */
/**
 * Look again at the screens already kept from a site ("Didja Missed This…", after you taught it):
 * the open steps that place now applies to may show "looks done?" at once instead of waiting for
 * a new screen. The model still decides; nothing is ticked here.
 */
export function lookAgainAt(store: Store, looker: Looker, site: string, now: Date = new Date()): number {
  const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const screens = store.observationsSince(since).filter((o) => siteOf(o) === site.toLowerCase());
  return lookForDone(store, looker, screens, now);
}

function lookForDone(store: Store, looker: Looker, observations: Observation[], now: Date, upTo = Infinity): number {
  let suggested = 0;
  let asked = 0;
  const tasks = store.tasksToWatch(new Date(now.getTime() - AUTO_FALLBACK_MS).toISOString()).filter((t) => t.id <= upTo);
  if (tasks.length === 0) return 0;
  const learned = store.donePlaces();
  // Every screen worth a look for every task, best first (SCR-66): a screen that shows an id from the
  // task beats one that only shares words; a task you looked at more recently comes before an older one;
  // then the newest screen, the one most likely to show the finished state.
  // A second sign besides the model (SCR-74): what done looks like matched there, or a box ticked
  // or a notice naming the task. With the model's "done" that is two signs: sure enough to tick.
  const candidates: { task: Task; o: Observation; snippet: string; score: number; sign?: string }[] = [];
  for (const task of tasks) {
    const kept = store.context(task.id);
    const source = {
      title: task.capturedTitle,
      context: kept ? [kept.window, kept.url ?? '', ...kept.lines.map((l) => l.text)].join('\n') : '',
      links: task.criteria?.links ?? [],
      lastSeenAt: task.lastSeenAt,
    };
    const done = store.modelCriteria(task.id);
    // A command step whose exact run was not seen (SCR-69): only a terminal where a run of the same
    // program and subcommand ended well, for the model to judge. Never a run that failed or was only typed.
    const command = task.auto ? task.markers.find((m) => m.kind === 'command')?.value ?? null : null;
    let screens = observations;
    if (command !== null) {
      // Just joined: the terminal screens since it was made count too, not only new ones.
      const joined = Date.parse(task.createdAt) + AUTO_FALLBACK_MS;
      if (now.getTime() - joined <= AUTO_LOOKBACK_MS) {
        const earlier = store.observationsSince(task.createdAt, 500)
          .filter((h) => (TERMINALS.has(h.bundleId) || EDITORS.has(h.bundleId)) && !observations.some((o) => o.id === h.id));
        screens = [...earlier, ...observations];
      }
    }
    for (const o of screens) {
      if (o.ts <= task.createdAt) continue;
      if (command !== null) {
        const snippet = commandScreen(command, o);
        if (snippet) candidates.push({ task, o, snippet, score: 6 });
        continue;
      }
      // What done looks like (SCR-67): a "not yet" phrase on the screen, or one of its places
      // without the ids it needs, rules the screen out; its place, ids and a done phrase make it
      // a strong candidate. The looks-done model still has to see it done.
      const match = done ? matchCriteria(done, o) : 'none';
      if (match === 'pending' || match === 'missing') continue;
      // A box ticked, a switch turned on or a notice that names the task (SCR-68): a strong candidate,
      // still for the model to judge. A box that names it but is not ticked says it is not done yet.
      const state = doneState(task.capturedTitle, o.text);
      if (state.kind === 'unchecked') continue;
      if (state.kind === 'checked') {
        const ids = strongTokens(task.capturedTitle).filter((t) => hasToken(o, t));
        const near = relevantSnippet(task.capturedTitle, o, ids) ?? '';
        const snippet = near.includes(state.line) ? near : [state.line, near].filter(Boolean).join('\n');
        candidates.push({ task, o, snippet, score: 9, sign: 'a box was ticked or a notice named it' });
        continue;
      }
      if (match === 'match') {
        const snippet = relevantSnippet(task.capturedTitle, o, matchedWords(done!, o));
        if (snippet) {
          candidates.push({ task, o, snippet, score: 10, sign: 'what done looks like was there' });
          continue;
        }
      }
      // A task is done somewhere in particular: a site or app it or its source names, a site its email
      // linked to, or a place you said such a step is done ("Didja Missed This…"); never a page that
      // only happens to share its words (the maintainer: all tasks).
      const taughtHere = learnedWhere({ title: task.capturedTitle, sourceId: task.sourceId }, o, learned);
      const found = lookCandidate(source, o, taughtHere);
      if (found) candidates.push({ task, o, ...found });
    }
  }
  candidates.sort((a, b) => b.score - a.score || b.task.lastSeenAt.localeCompare(a.task.lastSeenAt) || b.o.id - a.o.id);
  // The local model answers in about two seconds, Apple's in several: it gets more looks.
  const budget = localModelOf(store) ? LOOKS_PER_POLL_LOCAL : LOOKS_PER_POLL;
  const mode = store.looksDoneMode();
  for (const { task, o, snippet, sign } of candidates) {
    if (task.suggestion || task.status !== 'open') continue;
    const place = placeOf(o);
    if (store.rejectedPlaces(task.id).has(place)) continue;
    const key = new Bun.CryptoHasher('sha256').update(`${task.id}\n${snippet}`).digest('hex').slice(0, 32);
    if (store.looksDoneVerdict(key) !== null) continue;
    if (asked >= budget) return suggested;
    asked++;
    const verdict = looker({ task: task.capturedTitle, app: o.app, page: place, text: snippet, ...taught(store, 'looks-done') });
    if (verdict === null) return suggested; // no model: nothing to do
    store.recordLooksDoneCheck(key, task.id, verdict, now);
    if (verdict === 'done') {
      const why = mode === 'sure' ? sureBecause(store, task, place, sign, now) : null;
      if (why) {
        store.tickSure(task.id, place, o.id, why, now);
        task.status = 'done';
      } else {
        store.suggestDone(task.id, place, o.id, now);
        task.suggestion = place;
      }
      suggested++;
    }
  }
  return suggested;
}

/**
 * Why Didja is sure a task the model saw done is done, or null to ask you (SCR-74): a second sign on
 * the same screen, or a place where you said yes often enough with no "not yet" since. One sign alone
 * only asks. A step with something exact to look for (a command) always asks (SCR-69).
 */
export function sureBecause(store: Store, task: Task, place: string, sign: string | undefined, now: Date): string | null {
  if (task.auto) return null;
  if (sign) return `${sign} too`;
  const key = trustKey(place, task.sourceKind, task.capturedTitle);
  if (store.isTrusted(key, now)) return `you said steps like it were done there ${TRUST_YES} times or more, with no "not yet" since`;
  return null;
}

/**
 * The lines of a terminal screen where a run of the same program and subcommand as `command` ended
 * well (output and no failure, or the next prompt), or null. For "looks done?" only (SCR-69).
 */
export function commandScreen(command: string, o: Observation): string | null {
  const editor = EDITORS.has(o.bundleId);
  if (!TERMINALS.has(o.bundleId) && !editor) return null;
  const head = command.split(' ').slice(0, 2).join(' ');
  const lines = terminalLines(o.text, editor).map((text) => ({ text, ts: o.ts, observationId: o.id }));
  const run = splitSession(lines).find((r) => r.outcome === 'ok' && r.command.split(' ').slice(0, 2).join(' ') === head);
  if (!run) return null;
  const shown = [run.line.text, ...run.output.map((l) => l.text)].map((l) => l.trim().slice(0, 200)).slice(0, 14);
  return shown.join('\n').slice(0, 900);
}

/** Ask the model what done looks like for the newest tasks that have nothing exact to look for. */
function writeCriteria(store: Store, writer: CriteriaWriter): number {
  let written = 0;
  for (const task of store.tasksAwaitingCriteria(CRITERIA_PER_POLL)) {
    const parent = task.parentId === null ? null : store.getTask(task.parentId);
    const kept = store.context(task.id);
    const question = {
      task: task.capturedTitle,
      leadIn: parent?.capturedTitle ?? '',
      neighbours: parent ? store.stepsUnder(parent.id).filter((t) => t.id !== task.id && !t.isGroup).map((t) => t.capturedTitle).slice(0, 6) : [],
      source: task.sourceRef,
      context: kept ? kept.lines.map((l) => l.text) : [],
      links: task.criteria?.links ?? [],
    };
    const answer = writer(question);
    if (answer === null) break; // no model: ask again when there is one
    const clean = groundCriteria(cleanCriteria(answer), question);
    const any = clean.where.length + clean.success.length + clean.pending.length + clean.tokens.length > 0;
    store.setModelCriteria(task.id, any ? clean : null);
    written++;
  }
  return written;
}

/**
 * Give settled checklists a short title when the line that introduced them
 * does not work as one. Each checklist is offered to the model once.
 */
function titlePending(store: Store, titler: Titler, now: Date): number {
  let titled = 0;
  let asked = 0;
  for (const list of store.checklistsAwaitingTitle(new Date(now.getTime() - JUDGE_SETTLE_MS), 20)) {
    if (!needsShortTitle(list.title)) {
      store.setModelTitle(list.id, ''); // fine as it is
      continue;
    }
    if (asked++ >= TITLES_PER_POLL) break;
    const raw = titler({ leadIn: list.title, steps: list.steps, ...taught(store, 'titles') });
    if (raw === null) break; // no model: leave them for when there is one
    const title = cleanModelTitle(raw, list.title);
    store.setModelTitle(list.id, title ?? '');
    if (title) titled++;
  }
  return titled;
}

/**
 * Dismiss what is still open under a task. Anything you ticked, snoozed or
 * dismissed yourself is left alone, and each dismissed step says why.
 */
function dismissOpen(store: Store, id: number, why: string, now: Date): number {
  const task = store.getTask(id);
  if (!task) return 0;
  const open = (task.isGroup ? store.stepsUnder(id) : [task]).filter((t) => t.status === 'open');
  for (const step of open) {
    store.setStatus(step.id, 'dismissed', now);
    store.addNote(step.id, 'judged', now.toISOString(), why);
  }
  return open.length;
}

/** Take back the tasks made from a list's items, found by their titles. */
function retract(store: Store, titles: string[], why: string, now: Date, source: string): number {
  let count = 0;
  for (const title of titles) {
    // Only in the conversation the list is in: the same words elsewhere are another task (SCR-71).
    const task = store.findTaskByTitle(title, source);
    if (task) count += dismissOpen(store, task.id, why, now);
  }
  return count;
}

/**
 * Ask the model about queued lists that have stopped changing. A list judged
 * to be Claude's own has its open tasks dismissed, with a note saying why.
 */
/** A list waiting for the model's verdict: what it is asked, and what is kept if it is yours. */
interface PendingList {
  leadIn: string;
  steps: string[];
  after?: string[];
  asked?: string | null;
  reply?: string;
  /** The checklist to keep once judged yours (SCR-70). */
  list?: NewChecklist;
  /** Lists queued before SCR-70 were already kept: their root. */
  rootId?: number;
}

function judgePending(store: Store, judge: Judge, now: Date): number {
  let judged = 0;
  const settled = store.settledPendingJudgements(new Date(now.getTime() - JUDGE_SETTLE_MS), JUDGE_PER_POLL);
  for (const row of settled) {
    const list = JSON.parse(row.payload) as PendingList;
    // Judged already, under another window (SCR-76): nothing to ask; that verdict is applied.
    const known = store.getJudgement(row.key);
    if (known !== null) {
      store.clearPendingJudgement(row.slot);
      applyVerdict(store, list, known, now);
      continue;
    }
    const reply = judge({ leadIn: list.leadIn, steps: list.steps, after: list.after, ...(list.asked ? { asked: list.asked } : {}),
      ...(list.reply ? { reply: list.reply } : {}), ...taught(store, 'lists') });
    if (!reply) {
      // No model on this machine (or it is switched off): what waits is kept, marked "maybe" (SCR-70).
      for (const waiting of store.settledPendingJudgements(new Date(now.getTime() + 86_400_000), 1000)) {
        const held = JSON.parse(waiting.payload) as PendingList;
        if (held.list) {
          const { rootId } = store.upsertChecklist({ ...held.list, confidence: MAYBE_CONFIDENCE });
          // Shown as "checking…" until now (SCR-78): no model could say, so it is "maybe".
          const root = rootId ?? held.rootId ?? null;
          if (root !== null) store.unmarkMaybe(root, MAYBE_CONFIDENCE, CHECKING_CONFIDENCE);
        }
      }
      store.clearPendingJudgement();
      return judged;
    }
    judged++;
    store.saveJudgement(row.key, reply.audience, reply.model, now);
    store.clearPendingJudgement(row.slot);
    applyVerdict(store, list, reply.audience, now);
  }
  return judged;
}

/**
 * A verdict on a queued list. Claude's: what is shown of it ("checking…", SCR-78, or a list kept
 * before SCR-70) is taken back, leaving what you ticked yourself. Yours: kept, at full confidence.
 */
function applyVerdict(store: Store, list: PendingList, audience: 'user' | 'assistant', now: Date): void {
  if (audience === 'assistant') {
    const root = list.rootId === undefined ? null : store.getTask(list.rootId);
    if (root) dismissOpen(store, root.id, NOT_FOR_YOU, now);
    return;
  }
  if (list.list) {
    const { rootId } = store.upsertChecklist(list.list);
    if (rootId !== null) store.unmarkMaybe(rootId, list.list.confidence, MAYBE_CONFIDENCE);
  } else if (list.rootId !== undefined) {
    store.unmarkMaybe(list.rootId, MIN_SHOWN_CONFIDENCE, MAYBE_CONFIDENCE);
  }
}

/**
 * You ticked a step of a list still being checked (SCR-78): that says the list is yours. It is
 * kept as yours, at full confidence, and the model is not asked about it any more.
 */
export function confirmChecking(store: Store, id: number, now: Date = new Date()): boolean {
  let task = store.getTask(id);
  if (!task || task.confidence > CHECKING_CONFIDENCE) return false;
  while (task.parentId !== null) {
    const parent = store.getTask(task.parentId);
    if (!parent) break;
    task = parent;
  }
  const root = task.id;
  for (const row of store.settledPendingJudgements(new Date('9999-12-31T00:00:00Z'), 1000)) {
    const list = JSON.parse(row.payload) as PendingList;
    if (list.rootId !== root) continue;
    store.saveJudgement(row.key, 'user', 'you', now);
    store.clearPendingJudgement(row.slot);
    store.unmarkMaybe(root, list.list?.confidence ?? MIN_SHOWN_CONFIDENCE, MAYBE_CONFIDENCE);
    return true;
  }
  store.unmarkMaybe(root, MIN_SHOWN_CONFIDENCE, MAYBE_CONFIDENCE);
  return true;
}

/**
 * Wakes a sleeping loop at once (SCR-76): the app wrote new screens. A wake that comes while a pass
 * runs is kept, so the loop goes round once more as soon as it is done.
 */
export class Waker {
  private pending = false;
  private resolve: (() => void) | null = null;

  wake(): void {
    this.pending = true;
    this.resolve?.();
  }

  /** Wait for a wake or `ms`, whichever comes first, or until `signal` aborts. True when woken. */
  async sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
    if (this.pending) {
      this.pending = false;
      return true;
    }
    if (signal?.aborted) return false;
    const woken = await new Promise<boolean>((done) => {
      const finish = (w: boolean) => {
        clearTimeout(timer);
        this.resolve = null;
        done(w);
      };
      const timer = setTimeout(() => finish(false), ms);
      this.resolve = () => finish(true);
      signal?.addEventListener('abort', () => finish(false), { once: true });
    });
    this.pending = false;
    return woken;
  }
}

/** Wakes this close together make one pass: capture writes a burst of windows at once. */
export const WAKE_COALESCE_MS = 50;

export interface LoopOptions extends PollOptions {
  /** The heartbeat: a pass this often even when nothing wakes the loop (default 5 s). */
  intervalSeconds?: number;
  signal?: AbortSignal;
  /** Woken when new screens are written (SCR-76). */
  waker?: Waker;
  /** After each pass, with what it did: the fast lane wakes the model lane here. */
  afterPass?: (stats: PollStats) => void;
  /** Connected tools: synced every five minutes, and soon after a task of theirs is ticked. */
  sync?: () => Promise<{ created: number; closed: number; written: number; errors: string[] }>;
  syncDue?: () => boolean;
}

/**
 * Pass after pass, forever: at once when woken, else every few seconds. A failed pass is logged
 * and retried on the next one. `lane` and the models in `opts` say which pass this loop runs.
 */
export async function runLoop(store: Store, log: (line: string) => void, opts: LoopOptions = {}): Promise<void> {
  const { intervalSeconds, signal, waker = new Waker(), afterPass, sync, syncDue, ...poll } = opts;
  const interval = (intervalSeconds ?? 5) * 1000;
  let lastError = '';
  let lastSync = 0;
  let syncError = '';
  while (!signal?.aborted) {
    if (sync && (Date.now() - lastSync > 5 * 60_000 || syncDue?.())) {
      lastSync = Date.now();
      try {
        const s = await sync();
        if (s.created || s.closed || s.written) log(`${new Date().toISOString()}  connections: new=${s.created} closed=${s.closed} written=${s.written}`);
        const message = s.errors.join('; ');
        if (message && message !== syncError) log(`connections: ${message}`);
        syncError = message;
      } catch (err) {
        log(`connections failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    try {
      const s = pollOnce(store, new Date(), poll);
      store.notePass(new Date());
      lastError = '';
      afterPass?.(s);
      if (s.newTasks > 0 || s.completed > 0 || s.suggested > 0 || s.emails > 0 || s.chats > 0) {
        log(`${new Date().toISOString()}  ${poll.lane === 'fast' ? 'fast ' : ''}observations=${s.observations} new=${s.newTasks} emails=${s.emails} chats=${s.chats} completed=${s.completed}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message !== lastError) {
        log(`poll failed (will keep retrying): ${message}`);
        // Kept for the troubleshooting report (SCR-79); a database too busy to write it is let be.
        try { store.noteEngineError(message, new Date()); } catch { /* the same failure */ }
      }
      lastError = message;
    }
    if (await waker.sleep(interval, signal)) await Bun.sleep(WAKE_COALESCE_MS);
  }
}
