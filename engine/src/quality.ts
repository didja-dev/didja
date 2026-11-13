/**
 * "How Didja is doing" (SCR-73): counts of what happened to tasks, per kind of source, over the
 * last few days. Read from `outcomes` (recorded since schema 25) and the tasks' creation times.
 * Numbers only: no titles, no text. Never sent anywhere; `didja quality` prints it, the app shows it.
 */
import type { Outcome, Store } from './store.ts';

export interface Counts {
  /** Steps captured or added. */
  made: number;
  /** Ticked for you, by what showed it done. */
  ticked: { command: number; link: number; setting: number; file: number; screen: number; reply: number; tool: number; accepted: number; total: number };
  /** "Looks done?" asked, and your answers; `noAnswer` is still waiting or settled another way. */
  asked: number;
  yes: number;
  notYet: number;
  noAnswer: number;
  /** Ticked by you in the list. */
  byHand: number;
  /** Ticked from Didja Missed This ("This shows it done"). */
  shownDone: number;
  dismissed: number;
  notAnAction: number;
  freshStart: number;
  /** Reopened by you after Didja ticked it: the wrong ticks. */
  reopenedAfterTick: number;
}

export interface QualityReport {
  days: number;
  /** Counted from here: `days` ago, or when recording began if that is later. */
  since: string;
  overall: Counts;
  sources: ({ source: string } & Counts)[];
}

/** The groups a report is split into, in the order they are shown. */
export const SOURCES = ['Claude', 'Claude Code', 'Email', 'Chat', 'Added by you', 'Connected tools', 'Other'] as const;

/** Which group a task's source kind falls in. */
export function sourceGroup(kind: string): (typeof SOURCES)[number] {
  switch (kind) {
    case 'claude-desktop':
    case 'claude-web':
      return 'Claude';
    case 'claude-code':
      return 'Claude Code';
    case 'email':
      return 'Email';
    case 'chat':
      return 'Chat';
    case 'manual':
    case 'kept':
      return 'Added by you';
    case 'external':
      return 'Connected tools';
    default:
      return 'Other';
  }
}

function empty(): Counts {
  return {
    made: 0,
    ticked: { command: 0, link: 0, setting: 0, file: 0, screen: 0, reply: 0, tool: 0, accepted: 0, total: 0 },
    asked: 0, yes: 0, notYet: 0, noAnswer: 0, byHand: 0, shownDone: 0, dismissed: 0, notAnAction: 0, freshStart: 0, reopenedAfterTick: 0,
  };
}

const TICK_FIELD: Partial<Record<Outcome, keyof Counts['ticked']>> = {
  'ticked-command': 'command', 'ticked-link': 'link', 'ticked-setting': 'setting', 'ticked-file': 'file',
  'ticked-screen': 'screen', 'ticked-reply': 'reply', 'ticked-tool': 'tool', 'ticked-accepted': 'accepted',
};

function add(c: Counts, outcome: Outcome, n: number): void {
  const tick = TICK_FIELD[outcome];
  if (tick) {
    c.ticked[tick] += n;
    c.ticked.total += n;
    return;
  }
  switch (outcome) {
    case 'asked': c.asked += n; break;
    case 'yes': c.yes += n; break;
    case 'not-yet': c.notYet += n; break;
    case 'done-by-hand': c.byHand += n; break;
    case 'shown-done': c.shownDone += n; break;
    case 'dismissed': c.dismissed += n; break;
    case 'not-an-action': c.notAnAction += n; break;
    case 'fresh-start': c.freshStart += n; break;
    case 'reopened-after-tick': c.reopenedAfterTick += n; break;
  }
}

/** The report for the last `days` days. */
export function qualityReport(store: Store, days: number, now: Date = new Date()): QualityReport {
  const from = new Date(now.getTime() - days * 24 * 3600_000);
  const recorded = store.getMeta('outcomes_since');
  const start = recorded && Date.parse(recorded) > from.getTime() ? new Date(recorded) : from;
  const { made, outcomes } = store.qualityCounts(start.toISOString());
  const groups = new Map<string, Counts>();
  const group = (kind: string) => {
    const name = sourceGroup(kind);
    let c = groups.get(name);
    if (!c) groups.set(name, (c = empty()));
    return c;
  };
  const overall = empty();
  for (const m of made) {
    group(m.kind).made += m.n;
    overall.made += m.n;
  }
  for (const o of outcomes) {
    add(group(o.kind), o.outcome, o.n);
    add(overall, o.outcome, o.n);
  }
  const settle = (c: Counts) => { c.noAnswer = Math.max(0, c.asked - c.yes - c.notYet); };
  settle(overall);
  for (const c of groups.values()) settle(c);
  return {
    days,
    since: start.toISOString(),
    overall,
    sources: SOURCES.filter((s) => groups.has(s)).map((source) => ({ source, ...groups.get(source)! })),
  };
}

/** The report as text, one block per source and the total. Numbers only. */
export function formatQuality(r: QualityReport): string {
  const block = (name: string, c: Counts): string[] => {
    const t = c.ticked;
    const how = [
      ['command run', t.command], ['link opened', t.link], ['setting seen', t.setting], ['file', t.file],
      ['seen on screen', t.screen], ['reply', t.reply], ['connected tool', t.tool], ['accepted "looks done"', t.accepted],
    ].filter(([, n]) => (n as number) > 0).map(([w, n]) => `${n} ${w}`);
    return [
      name,
      `  made ${c.made}`,
      `  ticked for you ${t.total}${how.length ? ` (${how.join(', ')})` : ''}`,
      `  "looks done?" asked ${c.asked}: yes ${c.yes}, not yet ${c.notYet}, no answer ${c.noAnswer}`,
      `  ticked by you ${c.byHand}, shown done in Didja Missed This ${c.shownDone}`,
      `  dismissed ${c.dismissed}, Not an Action ${c.notAnAction}, Fresh Start ${c.freshStart}`,
      `  reopened after Didja ticked it ${c.reopenedAfterTick}`,
    ];
  };
  const since = new Date(r.since).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  return [
    `How Didja is doing: the last ${r.days} ${r.days === 1 ? 'day' : 'days'}, counted since ${since}. These numbers never leave this Mac.`,
    '',
    ...r.sources.flatMap((s) => [...block(s.source, s), '']),
    ...block('All sources', r.overall),
  ].join('\n');
}
