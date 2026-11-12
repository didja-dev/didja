/**
 * Completion matching, tiers 1 and 2 (see docs/ARCHITECTURE.md):
 *   1. Exact markers — the task's env var name, URL or command shows up in a new observation.
 *   2. Context       — and it shows up in the right place: commands at a terminal
 *                      prompt, env vars and URLs on the named service's site.
 *
 * A task is ticked only when every required marker has been seen in context.
 * Anything less leaves it open: a missed tick is cheap, a wrong tick is not.
 * Tier 3 (model judgement) arrives in Milestone 4.
 */

import { TERMINALS } from './extract.ts';
import { requiredMarkers } from './markers.ts';
import type { Marker } from './markers.ts';
import type { Observation, Task } from './store.ts';

export interface Sighting {
  taskId: number;
  marker: Marker;
  observationId: number;
  ts: string;
  /** A description of where the marker was seen. Never raw screen text. */
  detail: string;
}

/** What a shell prompt ends with, just before the typed command. */
const PROMPT_BEFORE_COMMAND = /[%$❯➜>#]\s*$/;

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function onHost(host: string | null, hosts: string[]): boolean {
  return host !== null && hosts.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Location without query string or fragment, which can carry tokens. */
function pageRef(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`.replace(/\/$/, '');
  } catch {
    return 'the page';
  }
}

/**
 * True if the command was typed at a shell prompt: it is the last thing on a
 * line and a prompt character comes right before it. A command merely printed
 * somewhere (in docs, in Claude's own output) does not count.
 */
export function commandAtPrompt(text: string, command: string): boolean {
  for (const line of text.split(/\r?\n/)) {
    const squashed = line.replace(/\s+/g, ' ').trimEnd();
    if (!squashed.endsWith(command)) continue;
    if (PROMPT_BEFORE_COMMAND.test(squashed.slice(0, squashed.length - command.length))) return true;
  }
  return false;
}

function seenIn(o: Observation, marker: Marker, task: Task): string | null {
  if (marker.kind === 'command') {
    if (!TERMINALS.has(o.bundleId)) return null;
    return commandAtPrompt(o.text, marker.value) ? `Ran \`${marker.value}\` in ${o.app}` : null;
  }
  if (marker.kind === 'env' || marker.kind === 'url') {
    if (!task.criteria?.service || !o.url || !onHost(hostOf(o.url), task.criteria.hosts)) return null;
    const found =
      marker.kind === 'env'
        ? new RegExp(`(?<![A-Z0-9_])${marker.value}(?![A-Z0-9_])`).test(o.text)
        : o.text.toLowerCase().includes(marker.value.toLowerCase());
    return found ? `Saw ${marker.value} on ${pageRef(o.url)}` : null;
  }
  return null;
}

/**
 * Look for each open task's required markers in observations made after the
 * task was created. The caller must leave out Claude windows: that is where
 * the task text itself is on screen.
 */
export function findSightings(tasks: Task[], observations: Observation[]): Sighting[] {
  const candidates = tasks
    // A snoozed task can still be seen getting done.
    .filter((t) => t.status === 'open' || t.status === 'snoozed')
    .map((task) => ({ task, required: requiredMarkers(task.markers, task.criteria) }))
    .filter((c) => c.required.length > 0);
  if (candidates.length === 0) return [];

  const sightings: Sighting[] = [];
  const found = new Set<string>();
  for (const o of observations) {
    for (const { task, required } of candidates) {
      if (o.ts <= task.createdAt) continue;
      for (const marker of required) {
        const key = `${task.id}\u0000${marker.value}`;
        if (found.has(key)) continue;
        const detail = seenIn(o, marker, task);
        if (!detail) continue;
        found.add(key);
        sightings.push({ taskId: task.id, marker, observationId: o.id, ts: o.ts, detail });
      }
    }
  }
  return sightings;
}

/** True once every required marker has been seen. */
export function isComplete(task: Task, seen: Set<string>): boolean {
  const required = requiredMarkers(task.markers, task.criteria);
  return required.length > 0 && required.every((m) => seen.has(m.value));
}
