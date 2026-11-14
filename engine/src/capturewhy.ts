/**
 * Why a task was made (SCR-96): one plain line written by the engine when it captures a task, kept
 * with it, and shown in `why` and in the app with how sure Didja is and when it was captured.
 *
 * Never screen text: no message words, no list or step titles, no names of people. Only the kind of
 * source, the AI tool's or app's name, the connection's name, and how it was decided.
 */
import { assistantName } from './firstrun.ts';

export type Band = 'sure' | 'unjudged' | 'checking';

/** How sure Didja is that the task is yours, from its confidence (checking 0.1, unjudged 0.2). */
export function bandOf(confidence: number): Band {
  if (confidence <= 0.1) return 'checking';
  if (confidence <= 0.2) return 'unjudged';
  return 'sure';
}

const BAND_WORDS: Record<Band, string> = {
  sure: 'sure',
  unjudged: 'possibly yours (no model could judge it)',
  checking: 'checking whose it is',
};

/** The line shown: "<why> · <how sure> · captured <when> from <where>". Null for tasks from before SCR-96. */
export function captureLine(task: { capturedWhy?: string | null; confidence: number; createdAt: string; sourceRef: string }): string | null {
  if (!task.capturedWhy) return null;
  const when = new Date(task.createdAt);
  const at = Number.isNaN(when.getTime()) ? task.createdAt : when.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  return `${task.capturedWhy} · ${BAND_WORDS[bandOf(task.confidence)]} · captured ${at} from ${task.sourceRef}`;
}

/** The reasons, by capture path. */
export const WHY = {
  listByWording: (kind: string) => `A list from ${assistantName(kind)} handed to you by its own wording`,
  listChecking: (kind: string) => `A list from ${assistantName(kind)} whose wording did not say whose it is; the model is checking`,
  listJudged: (kind: string) => `A list from ${assistantName(kind)} whose wording did not say whose it is; the model judged it yours`,
  listYouTicked: (kind: string) => `A list from ${assistantName(kind)} whose wording did not say whose it is; you ticked a step, so it is yours`,
  listNoModel: (kind: string) => `A list from ${assistantName(kind)} whose wording did not say whose it is; no model could judge it`,
  commandStep: ' · a command step',
  emailReply: 'An email that asks you for a reply; the model read what it asks',
  emailAction: 'An email that asks you to do something; the model read what it asks',
  chatDirect: 'Someone asked you in a one-to-one chat; the model read it as an ask',
  chatNamed: 'Someone tagged or named you in a group and asked you to do something; the model read it as an ask',
  chatEveryone: 'Someone asked every member of a group; the model read it as an ask',
  chatAccepted: 'Someone asked a group without naming anyone; you accepted it from Suggested',
  chatPromise: 'You promised it in a chat message of yours; its wording names what you will do',
  emailPromise: 'You promised it in an email of yours; its wording names what you will do',
  promiseAccepted: 'You promised it in a chat message of yours; you accepted it from Suggested',
  manual: 'You added it',
  kept: 'You added it to My List',
  external: (connection: string) => `An item from ${connection}, brought in by your connection's rules`,
  followUp: 'Added by Didja: a step that usually follows one you did',
};

/** A reason for a task whose capture path gave none: by its kind of source. */
export function defaultWhy(kind: string, ref: string): string {
  if (kind === 'email') return 'An email that asks something of you';
  if (kind === 'chat') return 'A chat message that asks something of you';
  if (kind === 'manual') return WHY.manual;
  if (kind === 'kept') return WHY.kept;
  if (kind === 'external') return WHY.external(ref);
  return `A step from ${assistantName(kind)} handed to you`;
}
