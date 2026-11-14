/**
 * `didja mcp` (SCR-42): a local MCP server, over stdin and stdout, for your own Claude (Claude Code,
 * Claude Desktop) to help you fix how Didja reads an app. Off until you turn it on in Settings ›
 * General (`didja mcp on`); while off, every tool says so and returns nothing.
 *
 * What it gives, all read from this Mac and nothing else:
 *   - the diagnostics files you chose to give it (Report a Problem › Give to My Claude), as you
 *     left them: masked except the lines you chose to show;
 *   - recent lines kept from an app, and a task's "why", always masked (`mask`);
 *   - the app profiles, and a way to draft one with fixtures (into a folder of its own) and test it;
 *   - a GitHub issue about a miss, drafted from what it knows, masked, with Claude's diagnosis
 *     checked for anything from the screen (`draft_issue`, issue.ts). The user posts it.
 *
 * Whatever it returns goes to your AI provider, which is why it starts only on request, masks
 * screen text, and logs every call (`mcp-log.jsonl`, shown in Privacy). It makes no network calls
 * itself and never writes outside its drafts folder.
 */
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { formatWhy } from './cli.ts';
import type { Fixture } from './fixtures.ts';
import { engineView, profileProblems } from './fixtures.ts';
import type { Diagnosis, IssueFacts, IssueKind } from './issue.ts';
import { contentWords, draftIssue, ISSUE_KINDS } from './issue.ts';
import { missedReport } from './missed.ts';
import type { ProfileInfo } from './profiles.ts';
import { profiles as builtInProfiles, matchesApp, profilesDir, readProfiles } from './profiles.ts';
import { DEFAULT_DB_PATH, Store } from './store.ts';

/** Beside the database in use ($DIDJA_DB, else the app's own). */
export const SUPPORT = dirname(process.env.DIDJA_DB ?? DEFAULT_DB_PATH);

export interface McpPlaces {
  shared: string;
  drafts: string;
  log: string;
  /** The app's own binary, which runs a fixture through capture (`--profile-test`). */
  app: string | null;
}

export function places(support = SUPPORT): McpPlaces {
  const fromBundle = join(dirname(process.execPath), '..', 'MacOS', 'Didja');
  const candidates = [process.env.DIDJA_APP_BINARY, fromBundle, '/Applications/Didja.app/Contents/MacOS/Didja'];
  return {
    shared: join(support, 'Shared with Claude'),
    drafts: join(support, 'Profile drafts'),
    log: join(support, 'mcp-log.jsonl'),
    app: candidates.find((p): p is string => !!p && existsSync(p)) ?? null,
  };
}

// --- Masking ---------------------------------------------------------------------------------

/** The same words as the app's `AXOutline.uiWords` and `Redactor.didjaWords` (a test keeps them in step). */
export const UI_WORDS = new Set([
  'message', 'messages', 'from', 'your', 'you', 'sent', 'received', 'delivered', 'read', 'seen', 'at', 'in',
  'chat', 'chats', 'with', 'today', 'yesterday', 'reply', 'replied', 'replies', 'forwarded', 'mentioned',
  'mention', 'edited', 'group', 'to', 'by', 'and', 'of', 'on', 'the', 'a', 'an', 'thread', 'unread',
  'pinned', 'reaction', 'reactions', 'january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december', 'monday', 'tuesday', 'wednesday', 'thursday',
  'friday', 'saturday', 'sunday', 'am', 'pm', 'said', 'says', 'new', 'more', 'type', 'send', 'posted',
  'terminal', 'copilot', 'claude', 'agent', 'ask', 'edit', 'input', 'question', 'accept', 'allow',
  'yes', 'no', 'continue', 'cancel', 'y', 'n', 'press', 'enter', 'panel', 'editor', 'explorer', 'status',
  'react', 'reacted', 'like', 'likes', 'love', 'heart', 'celebrate', 'laugh', 'surprised', 'sad', 'thumbs', 'up',
  'other', 'others', 'people', 'person', "you've", 'liked', 'haha', 'wow', 'only', 'yours',
  'mine', 'data', 'one', 'two', 'selected', 'button', 'add', 'remove', 'show', 'list', 'see', 'all', 'who',
  'direct', 'unknown', 'page', 'email', 'open', 'done', 'dismissed', 'snoozed', 'waiting', 'ticked', 'looks', 'me',
]);

/** Every letter x (X for a capital), every digit 0, except the words apps use in their labels. */
export function mask(text: string): string {
  return text.replace(/[\p{L}\p{M}]+|\p{N}/gu, (w) => {
    if (/^\p{N}$/u.test(w)) return '0';
    if (UI_WORDS.has(w.toLowerCase())) return w;
    return [...w].map((c) => (/\p{M}/u.test(c) ? '' : c !== c.toLowerCase() ? 'X' : 'x')).join('');
  });
}

// --- Tools -----------------------------------------------------------------------------------

export interface ToolResult { [key: string]: unknown; content: { type: 'text'; text: string }[]; isError?: boolean }
const ok = (value: unknown): ToolResult => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const fail = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true });

export const OFF_MESSAGE = 'Didja does not let your Claude read it right now. Turn it on in Didja: Settings › General › "Let My Own Claude Read Didja" (or run `didja mcp on`).';

export const TOOLS = [
  { name: 'list_reports', description: 'The diagnostics files the user gave you from Didja (Report a Problem with This Window › Give to My Claude): name, size and when.', inputSchema: { type: 'object', properties: {} } },
  { name: 'read_report', description: "One diagnostics file, as the user left it: the app's window outline (roles, ids, class names), what capture keeps, what Didja kept and its tasks. Text is masked (letters x, digits 0) except lines the user chose to show.", inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'observations', description: 'The latest lines Didja kept from an app, masked (letters x, digits 0, label words kept). Give the app name ("WhatsApp") or bundle id.', inputSchema: { type: 'object', properties: { app: { type: 'string' }, count: { type: 'number', description: 'at most 200; default 60' } }, required: ['app'] } },
  { name: 'why', description: 'What would tick a task and what has been seen so far (didja why), masked.', inputSchema: { type: 'object', properties: { task: { type: 'number' } }, required: ['task'] } },
  { name: 'missed_report', description: "A task the user finished that Didja did not notice (Didja Missed This…): what would tick it, how it looked, where Didja looks for it done, and the places and screens it saw since, masked (sites kept). Use it to work out why it was missed and where the user did it; the user teaches the place in Didja.", inputSchema: { type: 'object', properties: { task: { type: 'number' } }, required: ['task'] } },
  { name: 'list_profiles', description: "The app profiles: the ones in Didja and the user's drafts.", inputSchema: { type: 'object', properties: {} } },
  { name: 'show_profile', description: 'One profile as JSON (a draft before a built-in one with the same id). The format is in profiles/README.md of the Didja repository.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'draft_profile', description: "Write a profile and its fixtures into the user's drafts folder (nowhere else), check them and run every fixture. Fixtures must use made-up text only, names from profiles/fixtures/names.txt.", inputSchema: { type: 'object', properties: { profile: { type: 'object' }, fixtures: { type: 'array', items: { type: 'object' } } }, required: ['profile'] } },
  { name: 'draft_issue', description: "Once you have found why Didja missed or misread something, draft a GitHub issue for the user to post on the public Didja repository. Give the task (number) or the report (file name), the kind, a miss type (lowercase words joined by hyphens, e.g. place-missing-no-address) and your diagnosis in general words: what was missed, the likely cause, a suggested fix. Didja writes the rest (app, bundle id, profile, versions, what capture kept, masked) and refuses words from the user's screen, email addresses, links with paths and long numbers. Returns the title, body, a link that opens the issue filled in, a search for the same fingerprint, and whether the body must be pasted. Show the user the whole draft; nothing is posted unless they do it or say yes.", inputSchema: { type: 'object', properties: {
    task: { type: 'number' }, report: { type: 'string' }, kind: { type: 'string', enum: ['missed-task', 'app-support'] }, miss: { type: 'string' },
    what: { type: 'string' }, cause: { type: 'string' }, fix: { type: 'string' },
    app: { type: 'string', description: 'for a report: the app it is about' }, bundleId: { type: 'string', description: 'for a report: that app\'s bundle id' } },
    required: ['kind', 'miss', 'what', 'cause', 'fix'] } },
  { name: 'test_profile', description: "Run one fixture (the object, or the file name of a drafted one) through Didja's capture with the drafts in place, and through the engine: the lines kept, whether they match, and what the engine makes of them (messages and open asks, or emails).", inputSchema: { type: 'object', properties: { fixture: { description: 'a fixture object, or the file name of a drafted fixture' } }, required: ['fixture'] } },
] as const;

export interface McpDeps {
  store: Store;
  places: McpPlaces;
  /** Runs the app's `--profile-test`; returns its JSON output. */
  runCapture?: (fixturePath: string, profilesFolder: string) => { lines: string[]; matches?: boolean | null; problem?: string | null; profile?: string | null };
  now?: () => Date;
  /** Didja's and macOS's versions, for an issue. */
  versions?: () => { didja: string | null; macos: string | null };
}

/** What your Claude is told when it connects: how to use the tools, and what to do after a diagnosis. */
export const INSTRUCTIONS = `Didja is a Mac app that captures to-dos from the screen and ticks them off when it sees them done. These tools help the user find out why Didja missed or misread something, and fix it. Everything here is masked (letters x, digits 0) except words apps use in their labels and lines the user chose to show; read docs/AGENTS.md in the Didja repository for the rules.

When you have found the cause of a miss (with missed_report, read_report, why or observations), offer to report it to Didja's makers as a GitHub issue: call draft_issue with your diagnosis, phrased as a bug ("missed-task") or a request to support an app ("app-support"). Write the diagnosis in general words. Use only masked text, label words, the app's name and bundle id, and versions; never unmasked lines, names, email addresses, subjects, message text, or links with ids. Show the user the whole draft (title and body) before anything is posted. If they agree, they open the link it gives (one click); or, if GitHub is connected to you (a connector or gh), you may file it yourself after they approve that exact text. Search for its fingerprint first (the search link): if an issue with it exists, offer a thumbs-up or a comment there instead of a new issue.`;

/** Didja's version from the app the engine is in, and the Mac's. */
function defaultVersions(p: McpPlaces): { didja: string | null; macos: string | null } {
  let didja: string | null = null;
  try {
    const plist = p.app ? readFileSync(join(dirname(p.app), '..', 'Info.plist'), 'utf8') : '';
    didja = plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1] ?? null;
  } catch {
    // not inside an app
  }
  let macos: string | null = null;
  try {
    macos = Bun.spawnSync(['/usr/bin/sw_vers', '-productVersion']).stdout.toString().trim() || null;
  } catch {
    // not a Mac
  }
  return { didja, macos };
}

/** The facts for an issue about a task: its app, what was kept there, and every word that could be the user's. */
function taskFacts(deps: McpDeps, id: number, now: Date): IssueFacts | null {
  const r = missedReport(deps.store, id, now);
  const task = deps.store.getTask(id);
  if (!r || !task) return null;
  const app = r.context?.app ?? r.source.split(' — ')[0] ?? 'unknown app';
  const seen = deps.store.latestObservations(2000).find((o) => o.app === app);
  const bundleId = seen?.bundleId ?? null;
  const own = r.places.find((p) => p.app === app);
  const kept = [...(r.context?.lines ?? []), ...(own?.recent[0]?.lines ?? [])];
  const raw = [task.title, task.capturedTitle, r.source, r.why, r.context?.window ?? '', ...(r.context?.lines ?? []),
    ...r.places.flatMap((p) => p.recent.flatMap((s) => [s.window, ...s.lines]))].join('\n');
  const v = (deps.versions ?? (() => defaultVersions(deps.places)))();
  return { app, bundleId, profile: bundleId ? allProfiles(deps.places).find((p) => matchesApp(p, bundleId))?.id ?? null : null,
    didja: v.didja, macos: v.macos, kept, privateWords: contentWords(raw) };
}

/** The facts for an issue about a report the user gave: masked again here, whatever lines they showed. */
function reportFacts(deps: McpDeps, text: string, app: string, bundleId: string | null): IssueFacts {
  const lines = text.split('\n').slice(2).filter((l) => l.trim() && !/^== .* ==$/.test(l));
  const v = (deps.versions ?? (() => defaultVersions(deps.places)))();
  return { app, bundleId, profile: bundleId ? allProfiles(deps.places).find((p) => matchesApp(p, bundleId))?.id ?? null : null,
    didja: v.didja, macos: v.macos, kept: lines, privateWords: contentWords(text) };
}

export function enabled(store: Store): boolean {
  return store.getMeta('mcp_enabled') === 'on';
}

function logCall(p: McpPlaces, tool: string, args: Record<string, unknown>, at: Date): void {
  // What was asked, never what was returned: names and numbers, cut short.
  const brief = Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === 'object' ? '(object)' : String(v).slice(0, 80)]));
  try {
    mkdirSync(dirname(p.log), { recursive: true });
    appendFileSync(p.log, `${JSON.stringify({ ts: at.toISOString(), tool, args: brief })}\n`, { mode: 0o600 });
  } catch {
    // A log that cannot be written does not stop the answer.
  }
}

/** The calls your Claude made, newest last. */
export function readLog(p: McpPlaces, limit = 50): { ts: string; tool: string; args: Record<string, string> }[] {
  if (!existsSync(p.log)) return [];
  return readFileSync(p.log, 'utf8').trim().split('\n').filter(Boolean).slice(-limit).flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
}

/** A plain file name in a folder: no paths, nothing outside it. */
function inside(folder: string, name: string, ext: string): string | null {
  const plain = basename(String(name));
  if (plain !== name || !plain.endsWith(ext) || plain.startsWith('.')) return null;
  const path = join(folder, plain);
  return existsSync(path) ? path : null;
}

function allProfiles(p: McpPlaces): ProfileInfo[] {
  const drafts = existsSync(p.drafts) ? readProfiles(p.drafts) : [];
  const ids = new Set(drafts.map((d) => d.id));
  return [...drafts.map((d) => ({ ...d, status: 'communityNew' as const, draft: true })), ...builtInProfiles().filter((b) => !ids.has(b.id))];
}

function defaultRunCapture(p: McpPlaces) {
  return (fixturePath: string, folder: string) => {
    if (!p.app) throw new Error('Didja.app was not found, so a fixture cannot be run through capture');
    const r = Bun.spawnSync([p.app, '--profile-test', fixturePath, '--profiles', folder]);
    const out = r.stdout.toString();
    if (!out.trim()) throw new Error(r.stderr.toString().trim() || 'the app gave no answer');
    return JSON.parse(out);
  };
}

function testFixture(fixture: Fixture, deps: McpDeps, folder: string): unknown {
  const dir = mkdtempSync(join(tmpdir(), 'didja-fixture-'));
  const path = join(dir, 'fixture.json');
  writeFileSync(path, JSON.stringify(fixture));
  const capture = (deps.runCapture ?? defaultRunCapture(deps.places))(path, folder);
  let engine: unknown;
  try {
    engine = engineView({ ...fixture, lines: capture.lines }, allProfiles(deps.places));
  } catch (e) {
    engine = { problem: e instanceof Error ? e.message : String(e) };
  }
  const expected = fixture.expect ? JSON.stringify(engine) === JSON.stringify(fixture.expect) : null;
  return { capture, engine, engineMatches: expected };
}

export function callTool(name: string, args: Record<string, unknown>, deps: McpDeps): ToolResult {
  const now = deps.now?.() ?? new Date();
  logCall(deps.places, name, args, now);
  if (!enabled(deps.store)) return fail(OFF_MESSAGE);
  const p = deps.places;
  switch (name) {
    case 'list_reports': {
      if (!existsSync(p.shared)) return ok([]);
      return ok(readdirSync(p.shared).filter((n) => n.endsWith('.txt')).sort().map((n) => {
        const s = statSync(join(p.shared, n));
        return { name: n, bytes: s.size, saved: s.mtime.toISOString() };
      }));
    }
    case 'read_report': {
      const path = inside(p.shared, String(args.name ?? ''), '.txt');
      return path ? ok(readFileSync(path, 'utf8')) : fail('No such report. list_reports names them.');
    }
    case 'observations': {
      const app = String(args.app ?? '').toLowerCase();
      const count = Math.min(200, Math.max(1, Number(args.count ?? 60) || 60));
      const lines = deps.store.latestObservations(2000)
        .filter((o) => o.app.toLowerCase() === app || o.bundleId.toLowerCase() === app)
        .flatMap((o) => o.text.split('\n'));
      return ok(lines.slice(-count).map(mask).join('\n') || '(nothing kept from that app in the last 24 hours)');
    }
    case 'why': {
      const task = deps.store.getTask(Number(args.task));
      return task ? ok(mask(formatWhy(task, deps.store.listEvidence(task.id), deps.store.modelCriteria(task.id)))) : fail('No such task.');
    }
    case 'missed_report': {
      const r = missedReport(deps.store, Number(args.task), now);
      if (!r) return fail('No such task.');
      const m = (lines: string[]) => lines.map(mask);
      return ok({
        task: r.id, status: r.status, why: mask(r.why),
        context: r.context ? { app: r.context.app, window: mask(r.context.window), lines: m(r.context.lines) } : null,
        watching: m(r.watching),
        places: r.places.map((p) => ({ site: p.site, app: p.app, screens: p.screens, lookedAt: p.watched,
          recent: p.recent.map((s) => ({ ts: s.ts, window: mask(s.window), lines: m(s.lines) })) })),
      });
    }
    case 'list_profiles':
      return ok(allProfiles(p).map((x) => ({ id: x.id, name: x.name, kind: x.kind, status: x.status ?? 'builtIn', draft: 'draft' in x, match: x.match })));
    case 'show_profile': {
      const id = String(args.id ?? '');
      const path = inside(p.drafts, `${id}.json`, '.json') ?? (profilesDir() ? inside(profilesDir()!, `${id}.json`, '.json') : null);
      return path ? ok(readFileSync(path, 'utf8')) : fail('No such profile. list_profiles names them.');
    }
    case 'draft_profile': {
      const profile = args.profile as Record<string, unknown>;
      const problems = profileProblems(profile);
      if (problems.length) return fail(`The profile was not saved:\n- ${problems.join('\n- ')}`);
      const fixtures = (Array.isArray(args.fixtures) ? args.fixtures : []) as Fixture[];
      mkdirSync(join(p.drafts, 'fixtures'), { recursive: true });
      writeFileSync(join(p.drafts, `${profile.id}.json`), `${JSON.stringify(profile, null, 2)}\n`);
      const results: Record<string, unknown> = {};
      for (const [i, f] of fixtures.entries()) {
        const file = `${profile.id}-${String((f as { name?: string }).name ?? i + 1).replace(/[^a-z0-9-]/gi, '-').toLowerCase()}.json`;
        const { name: _drop, ...clean } = f as Fixture & { name?: string };
        writeFileSync(join(p.drafts, 'fixtures', file), `${JSON.stringify({ ...clean, profile: profile.id }, null, 2)}\n`);
        try {
          results[file] = testFixture({ ...clean, profile: String(profile.id) }, deps, p.drafts);
        } catch (e) {
          results[file] = { problem: e instanceof Error ? e.message : String(e) };
        }
      }
      return ok({ saved: join(p.drafts, `${profile.id}.json`), fixtures: results,
        next: 'Show the user every file before it leaves this Mac. To contribute: copy the profile and fixtures into a fork of the Didja repository (profiles/ and profiles/fixtures/), run its tests, and open a pull request.' });
    }
    case 'draft_issue': {
      const kind = String(args.kind ?? '') as IssueKind;
      if (!ISSUE_KINDS.includes(kind)) return fail('kind must be "missed-task" or "app-support".');
      let facts: IssueFacts | null = null;
      if (args.task !== undefined) {
        facts = taskFacts(deps, Number(args.task), now);
        if (!facts) return fail('No such task.');
      } else if (args.report !== undefined) {
        const path = inside(p.shared, String(args.report), '.txt');
        if (!path) return fail('No such report. list_reports names them.');
        const bundle = typeof args.bundleId === 'string' && /^[A-Za-z0-9][A-Za-z0-9.-]{1,120}$/.test(args.bundleId) ? args.bundleId : null;
        facts = reportFacts(deps, readFileSync(path, 'utf8'), String(args.app ?? 'unknown app').slice(0, 60), bundle);
      } else {
        return fail('Give the task (number) or the report (file name) the issue is about.');
      }
      const diagnosis: Diagnosis = { what: String(args.what ?? ''), cause: String(args.cause ?? ''), fix: String(args.fix ?? '') };
      const draft = draftIssue(kind, String(args.miss ?? ''), diagnosis, facts);
      if ('problems' in draft) return fail(`Not drafted. Change these and call draft_issue again:\n- ${draft.problems.join('\n- ')}`);
      return ok({ ...draft,
        next: draft.pasteBody
          ? 'Show the user the title and body. The body is too long for a link: the link opens the form; they paste the body into it.'
          : 'Show the user the title and body. If they agree, they open the link: the form is filled in. Check the search link first for the same fingerprint.' });
    }
    case 'test_profile': {
      let fixture = args.fixture as Fixture | string;
      if (typeof fixture === 'string') {
        const path = inside(join(p.drafts, 'fixtures'), fixture, '.json');
        if (!path) return fail('No such drafted fixture.');
        fixture = JSON.parse(readFileSync(path, 'utf8')) as Fixture;
      }
      try {
        mkdirSync(p.drafts, { recursive: true });
        return ok(testFixture(fixture, deps, p.drafts));
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    }
    default:
      return fail(`No tool ${name}.`);
  }
}

/** Serve over stdin and stdout until the client goes away. */
export async function serve(store: Store, p: McpPlaces = places()): Promise<void> {
  const server = new Server({ name: 'didja', version: '1' }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS.map((t) => ({ ...t })) }));
  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    callTool(req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>, { store, places: p }));
  await server.connect(new StdioServerTransport());
  await new Promise<void>((resolve) => process.stdin.on('close', resolve));
}
