import { suggestMerges } from './related.ts';
import { signedFromEmail } from './esign.ts';
import { accountOf, baseSubject, responseAction, isAutomatic, isMine, isRecent, followsLink, mailKey, mailTime, mailLinks, mailOrigin, mailSnippet, mailSource, mailTaskTitle, parseEmails, replyTitle, settleNeed, signedName } from './email.ts';
import type { MailIdentity, MailReader } from './email.ts';
import { chatApp, chatKey, asksForAcknowledgement, chatTaskTitle, isEmojiOnly, isPositiveEmoji, isReaction, lineHash, plainReactions, reactedTo, namesMe, chatSourceRef, chatTime, isMine as isMyMessage, mayAskOfMe, parseChatMessages, plainlyDefers, sentBefore } from './chat.ts';
import type { ChatMessage, ChatReader, ReplyJudge } from './chat.ts';
import { assemble, classifySource, extractCommands, extractChecklists, sourceRef, TERMINALS } from './extract.ts';
import { rewordPlacesOnce } from './missed.ts';
import { isWhereItIsDone, learnedWhere, placeOf, relevantSnippet, siteOf } from './looksdone.ts';
import type { Looker } from './looksdone.ts';
import { deriveCriteria, extractMarkers } from './markers.ts';
import { findSightings, isComplete, RUN_WINDOW_MS } from './match.ts';
import type { Checklist, ChecklistItem } from './extract.ts';
import type { Job, NewNode, Observation, PendingChatAsk, Store, Task, Teaching } from './store.ts';
import { KEPT_KIND, KEPT_LIST } from './store.ts';

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
export type Judge = (list: { leadIn: string; steps: string[]; after?: string[]; asked?: string | null; teach?: Teaching }) => JudgeReply | null;

/**
 * Asks the on-device model for a short title for a checklist. Returns null
 * when no model is available.
 */
export type Titler = (list: { leadIn: string; steps: string[]; teach?: Teaching }) => string | null;

export interface PollOptions {
  judge?: Judge;
  titler?: Titler;
  looker?: Looker;
  mailReader?: MailReader;
  chatReader?: ChatReader;
  replyJudge?: ReplyJudge;
}

const EMAILS_PER_POLL = 2;

const LOOKS_PER_POLL = 2;

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
/**
 * An observation holds only the lines new to its window, so a list can be
 * spread over several. Extraction re-reads this much of the window's history.
 */
const WINDOW_CONTEXT_MS = 30 * 60 * 1000;

const windowKey = (o: Observation) => `${o.bundleId}\u0000${o.windowTitle}`;

/**
 * One pass: read new observations, find checklists in Claude windows and store
 * them as tasks, then tick tasks whose markers have shown up elsewhere.
 */
export function pollOnce(store: Store, now: Date = new Date(), opts: PollOptions = {}): PollStats {
  store.wakeSnoozed(now);
  const cursor = Number(store.getMeta(CURSOR_KEY) ?? 0);
  const fresh = store.observationsAfter(cursor);
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

  // Latest new observation per window.
  const windows = new Map<string, Observation>();
  for (const o of fresh) windows.set(windowKey(o), o);
  const claudeWindows = new Set<string>();
  stats.windows = windows.size;

  const since = new Date(now.getTime() - WINDOW_CONTEXT_MS).toISOString();
  for (const latest of windows.values()) {
    const history = store.windowObservations(latest.bundleId, latest.windowTitle, since);
    const text = assemble(history.map((o) => o.text));
    const mailbox = mailSource(latest);
    if (mailbox) {
      const mail = readMail(store, text, latest, mailbox, opts.mailReader, now);
      stats.emails += mail.created;
      stats.completed += mail.completed;
      stats.suggested += mail.suggested;
      continue;
    }
    const app = chatApp(latest);
    if (app) {
      const chat = readChat(store, text, latest, app, opts, now);
      stats.chats += chat.created;
      stats.completed += chat.completed;
      stats.suggested += chat.suggested;
      continue;
    }
    const kind = classifySource(latest, text);
    if (!kind) continue;
    stats.claudeWindows++;
    claudeWindows.add(windowKey(latest));

    const chat = kind !== 'claude-code';
    // A Claude reply has no date, so "only new messages" never leaves one out: a list you scroll
    // back to see, or one that arrived while you were in another window, is still yours.
    const source = text;
    const lists = extractChecklists(source, { claudeOnly: chat, joinWrapped: !chat, includeAssistant: true });
    // Commands Claude tells you to run, outside any list (a list's own commands are already in it).
    const listed = lists.flatMap((l) => l.items.flatMap(function all(i: ChecklistItem): string[] {
      return [i.title, ...i.fragments, ...i.children.flatMap(all)];
    })).join('\n');
    for (const commands of extractCommands(source)) {
      commands.items = commands.items.filter((i) => !listed.includes(i.fragments[0]!));
      if (commands.items.length > 0) lists.push(commands);
    }
    for (const list of lists) {
      if (list.actor === 'assistant') {
        // Claude's own plan. It may have been taken as yours before the telling line arrived: take it back.
        stats.retracted += retract(store, list.items.map((i) => i.title), CLAUDE_SAID_SO, now);
        continue;
      }
      // The wording does not say who this list is for: go by the model's verdict
      // if there is one; otherwise take it for now and queue it to be judged.
      const unsettled = list.actor === null && opts.judge !== undefined;
      const key = unsettled ? judgementKey(list) : '';
      const verdict = unsettled ? store.getJudgement(key) : null;
      if (verdict === 'assistant') continue;
      // Steps you said are not actions are not captured again.
      const keep = (items: ChecklistItem[]): ChecklistItem[] =>
        items.filter((i) => !store.isNotAnAction(i.title)).map((i) => ({ ...i, children: keep(i.children) }));
      list.items = keep(list.items);
      if (list.items.length === 0) continue;

      stats.checklists++;
      const only = list.items.length === 1 ? list.items[0]! : null;
      const { rootId, created } = store.upsertChecklist({
        title: list.title ?? 'Checklist',
        sourceKind: kind,
        sourceRef: sourceRef(latest, kind),
        confidence: list.confidence,
        ts: latest.ts,
        observationId: latest.id,
        items: list.items.map(toNode),
        // One step is just a task (or, with sub-steps, its own checklist); it needs no parent around it.
        wrap: only === null,
      });
      stats.newTasks += created;

      if (unsettled && verdict === null && rootId !== null) {
        const slot = `${sourceRef(latest, kind)}\u0000${list.title ?? ''}`;
        const payload = JSON.stringify({
          leadIn: list.title ?? '', steps: list.items.map((i) => i.title), after: list.after.slice(0, 3), ...(list.asked ? { asked: list.asked } : {}), rootId,
        });
        store.setPendingJudgement(slot, key, payload, now);
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
    .filter((o) => TERMINALS.has(o.bundleId) && !claudeWindows.has(windowKey(o)));
  for (const s of findSightings(watchable, elsewhere, [...terminalHistory, ...elsewhere.filter((o) => !terminalHistory.some((h) => h.id === o.id))])) {
    if (store.addSighting(s.taskId, s.marker.value, s.observationId, s.ts, s.detail)) {
      stats.sightings++;
      touched.add(s.taskId);
    }
  }
  for (const id of touched) {
    const task = store.getTask(id);
    if (task && (task.status === 'open' || task.status === 'snoozed') && isComplete(task, store.seenMarkers(id))) {
      store.setStatus(id, 'done');
      stats.completed++;
    }
  }

  // An e-signature request from an email, signed through its link: ticked without asking the model.
  stats.completed += signedFromEmail(store, fresh, now);
  if (opts.looker) {
    const followed = followLinks(store, opts.looker, elsewhere, now);
    stats.completed += followed.completed;
    stats.suggested += followed.suggested;
    stats.suggested += lookForDone(store, opts.looker, elsewhere, now);
  }
  // If you chose to accept "looks done" automatically, every suggestion waiting
  // for a yes is taken as a yes, labelled as ticked for you.
  if (store.looksDoneMode() === 'accept') {
    for (const task of store.tasksLookingDone()) {
      store.acceptLooksDone(task.id, task.suggestion!, now);
      stats.completed++;
    }
  }
  // The same thing seen in two places (a Teams message and the email it announced): suggest merging.
  suggestMerges(store, now);
  if (opts.judge) stats.judged = judgePending(store, opts.judge, now);
  if (opts.titler) stats.titled = titlePending(store, opts.titler, now);

  const last = fresh.at(-1);
  if (last) store.setMeta(CURSOR_KEY, String(last.id));
  // Chat asks that waited long enough without a reply of yours become tasks (SCR-45).
  foldChatConversationsOnce(store, now);
  rewordPlacesOnce(store, now);
  store.dropEmptyLessonsOnce();
  stats.chats += promotePendingChatAsks(store, now);
  stats.expired = store.pruneObservations(now);
  store.pruneContext();
  return stats;
}

/** Bumped when the question put to the model about an email changes. */
const EMAIL_CHECKS_VERSION = '3';

/**
 * Mail (Outlook, Gmail): turn an email that asks something of you into a task
 * that says what to do, and notice when a reply has gone out.
 */
function readMail(
  store: Store, text: string, latest: Observation, mailbox: string, reader: MailReader | undefined, now: Date,
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

  if (!reader) return { created, completed, suggested };
  store.forgetEmailChecksBefore(EMAIL_CHECKS_VERSION);
  // Only new messages: leave out mail plainly sent before capture started.
  const start = store.onlyNewMessages() ? store.captureStartedAt() : null;
  const startMinute = start ? new Date(Math.floor(start.getTime() / 60_000) * 60_000) : null;
  for (const email of emails) {
    // Fresh mail from people, with a body to read: not old mail, not machines.
    if (!isRecent(email.date, now) || isAutomatic(email) || email.body.length === 0) continue;
    const sent = startMinute ? mailTime(email.date, now) : null;
    if (startMinute && sent && sent.getTime() < startMinute.getTime()) continue;
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
    if (answer === null) break; // no model
    const verdict = settleNeed(email, answer);
    store.recordEmailCheck(key, verdict.need, now);
    if (verdict.need === 'none') continue;
    // You said an email in this conversation asks nothing of you.
    if (store.isNotAnActionEmail(baseSubject(email.subject))) continue;
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
  store: Store, text: string, latest: Observation, app: string, opts: PollOptions, now: Date,
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
  if (!reader) return { created, completed, suggested };
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
    if (start && sentBefore(m, start, now)) continue;
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
      ...(m.kind !== 'direct' ? { addressed: namesMe(m, me) ? 'named' as const : 'everyone' as const } : {}), message: m.body.slice(0, 1200), before, ...taught(store, 'emails'),
    });
    if (answer === null) break; // no model
    store.recordEmailCheck(key, answer.asks ? 'ask' : 'none', now);
    if (!answer.asks) continue;
    const title = chatTaskTitle(answer.task) ?? `Reply to ${m.from}`;
    if (store.isNotAnAction(title)) continue;
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
function followLinks(store: Store, looker: Looker, observations: Observation[], now: Date): { completed: number; suggested: number } {
  const result = { completed: 0, suggested: 0 };
  const tasks = store.tasksWithLinks();
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

function lookForDone(store: Store, looker: Looker, observations: Observation[], now: Date): number {
  let suggested = 0;
  let asked = 0;
  const tasks = store.tasksToWatch();
  if (tasks.length === 0) return 0;
  const learned = store.donePlaces();
  // Newest screen first: it is the one most likely to show the finished state.
  for (const o of [...observations].reverse()) {
    for (const task of tasks) {
      if (o.ts <= task.createdAt || task.suggestion) continue;
      // A task is done somewhere in particular: only a screen on the site or app it names (or a site
      // its email linked to) counts, never a page that happens to share its words (the maintainer: all tasks).
      // Or a place you said such a step is done ("Didja Missed This…").
      if (!isWhereItIsDone(task.capturedTitle, o, task.criteria?.links ?? [])
        && !learnedWhere({ title: task.capturedTitle, sourceId: task.sourceId }, o, learned)) continue;
      const snippet = relevantSnippet(task.capturedTitle, o);
      if (!snippet) continue;
      const place = placeOf(o);
      if (store.rejectedPlaces(task.id).has(place)) continue;
      const key = new Bun.CryptoHasher('sha256').update(`${task.id}\n${snippet}`).digest('hex').slice(0, 32);
      if (store.looksDoneVerdict(key) !== null) continue;
      if (asked >= LOOKS_PER_POLL) return suggested;
      asked++;
      const verdict = looker({ task: task.capturedTitle, app: o.app, page: place, text: snippet, ...taught(store, 'looks-done') });
      if (verdict === null) return suggested; // no model: nothing to do
      store.recordLooksDoneCheck(key, task.id, verdict, now);
      if (verdict === 'done') {
        store.suggestDone(task.id, place, o.id, now);
        task.suggestion = place;
        suggested++;
      }
    }
  }
  return suggested;
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
function retract(store: Store, titles: string[], why: string, now: Date): number {
  let count = 0;
  for (const title of titles) {
    const task = store.findTaskByTitle(title);
    if (task) count += dismissOpen(store, task.id, why, now);
  }
  return count;
}

/**
 * Ask the model about queued lists that have stopped changing. A list judged
 * to be Claude's own has its open tasks dismissed, with a note saying why.
 */
function judgePending(store: Store, judge: Judge, now: Date): number {
  let judged = 0;
  const settled = store.settledPendingJudgements(new Date(now.getTime() - JUDGE_SETTLE_MS), JUDGE_PER_POLL);
  for (const row of settled) {
    const list = JSON.parse(row.payload) as { leadIn: string; steps: string[]; after?: string[]; asked?: string | null; rootId: number };
    const reply = judge({ leadIn: list.leadIn, steps: list.steps, after: list.after, ...(list.asked ? { asked: list.asked } : {}), ...taught(store, 'lists') });
    if (!reply) {
      // No model on this machine (or it is switched off): stop queuing, keep the wording-based result.
      store.clearPendingJudgement();
      return judged;
    }
    judged++;
    store.saveJudgement(row.key, reply.audience, reply.model, now);
    store.clearPendingJudgement(row.slot);
    if (reply.audience !== 'assistant') continue;
    const root = store.getTask(list.rootId);
    if (root) dismissOpen(store, root.id, NOT_FOR_YOU, now);
  }
  return judged;
}

/** Poll forever. A failed pass is logged and retried on the next tick. */
export async function runLoop(
  store: Store,
  log: (line: string) => void,
  opts: {
    intervalSeconds?: number; signal?: AbortSignal; judge?: Judge; titler?: Titler; looker?: Looker; mailReader?: MailReader; chatReader?: ChatReader; replyJudge?: ReplyJudge;
    /** Connected tools: synced every five minutes, and soon after a task of theirs is ticked. */
    sync?: () => Promise<{ created: number; closed: number; written: number; errors: string[] }>;
    syncDue?: () => boolean;
  } = {},
): Promise<void> {
  const interval = (opts.intervalSeconds ?? 5) * 1000;
  let lastError = '';
  let lastSync = 0;
  let syncError = '';
  while (!opts.signal?.aborted) {
    if (opts.sync && (Date.now() - lastSync > 5 * 60_000 || opts.syncDue?.())) {
      lastSync = Date.now();
      try {
        const s = await opts.sync();
        if (s.created || s.closed || s.written) log(`${new Date().toISOString()}  connections: new=${s.created} closed=${s.closed} written=${s.written}`);
        const message = s.errors.join('; ');
        if (message && message !== syncError) log(`connections: ${message}`);
        syncError = message;
      } catch (err) {
        log(`connections failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    try {
      const s = pollOnce(store, new Date(), { judge: opts.judge, titler: opts.titler, looker: opts.looker, mailReader: opts.mailReader, chatReader: opts.chatReader, replyJudge: opts.replyJudge });
      lastError = '';
      if (s.newTasks > 0 || s.completed > 0 || s.suggested > 0 || s.emails > 0 || s.chats > 0) {
        log(`${new Date().toISOString()}  observations=${s.observations} new=${s.newTasks} emails=${s.emails} chats=${s.chats} completed=${s.completed}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message !== lastError) log(`poll failed (will keep retrying): ${message}`);
      lastError = message;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, interval);
      opts.signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  }
}
