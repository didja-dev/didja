/**
 * Connections: task tools you connect over their MCP servers (Linear first). The one place the
 * app uses the network (CLAUDE.md, docs/DECISIONS.md): it reads your items there and writes back
 * the state or label change for an item Didja ticks. Never screen text, observations,
 * evidence or tasks from any other source.
 *
 * Sign-in is OAuth in your browser (the MCP server's own); the secrets it returns are kept in your
 * login keychain, never in the database.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { Store } from './store.ts';

/** A tool Didja knows how to read and update over MCP. */
export interface Kind {
  id: 'linear' | 'jira' | 'asana' | 'todoist' | 'notion';
  name: string;
  /** Its MCP server: the newer transport first, then the older SSE one where there is one. */
  servers: { url: string; sse?: boolean }[];
  /** What it calls the groups items belong to: Linear's teams, Jira's projects, Notion's databases. */
  groups: string;
  /** Tried with a real account. */
  tried: boolean;
}
export const KINDS: Record<string, Kind> = {
  linear: { id: 'linear', name: 'Linear', servers: [{ url: 'https://mcp.linear.app/mcp' }], groups: 'Teams', tried: true },
  jira: { id: 'jira', name: 'Jira', servers: [{ url: 'https://mcp.atlassian.com/v1/mcp' }, { url: 'https://mcp.atlassian.com/v1/sse', sse: true }], groups: 'Projects', tried: false },
  asana: { id: 'asana', name: 'Asana', servers: [{ url: 'https://mcp.asana.com/v2/mcp' }, { url: 'https://mcp.asana.com/sse', sse: true }], groups: 'Projects', tried: false },
  todoist: { id: 'todoist', name: 'Todoist', servers: [{ url: 'https://ai.todoist.net/mcp' }], groups: 'Projects', tried: false },
  notion: { id: 'notion', name: 'Notion', servers: [{ url: 'https://mcp.notion.com/mcp' }, { url: 'https://mcp.notion.com/sse', sse: true }], groups: 'Databases', tried: false },
};

/** One connection, as set up in the app's Connections window. */
export interface Connection {
  id: string;
  kind: Kind['id'];
  /** When Didja ticks an item: move it to this state, and/or add this label, in the tool. */
  onDone: { state?: string; label?: string };
  /** Also write back when Didja ticks on its own (exact markers, or accepted automatically). */
  whenSure: boolean;
  /** What comes in: set in the Connections window. Missing: due today or overdue, from every team. */
  bring?: Bring;
  /** Signed in and working, as of the last sync. */
  status?: 'connected' | 'signed-out' | 'error';
  /** The server address that answered, once one has. */
  server?: string;
  lastSync?: string;
  lastError?: string;
}

/** Which of your items come in. Any one rule is enough; done and cancelled items never come in. */
export interface Bring {
  /** Due today or overdue. */
  due: boolean;
  /** In progress ("started"). */
  started: boolean;
  /** To do ("unstarted"). */
  unstarted: boolean;
  backlog: boolean;
  /** Only these teams (names); empty for all of them. */
  teams: string[];
}
export const DEFAULT_BRING: Bring = { due: true, started: false, unstarted: false, backlog: false, teams: [] };
export const bringOf = (c: Connection): Bring => ({ ...DEFAULT_BRING, ...(c.bring ?? {}) });

const META = 'connections';

export function listConnections(store: Store): Connection[] {
  try {
    const list = JSON.parse(store.getMeta(META) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveConnections(store: Store, list: Connection[]): void {
  store.setMeta(META, JSON.stringify(list));
}

export function updateConnection(store: Store, id: string, change: Partial<Connection>): Connection | null {
  const list = listConnections(store);
  const at = list.findIndex((c) => c.id === id);
  if (at < 0) return null;
  list[at] = { ...list[at]!, ...change, onDone: { ...list[at]!.onDone, ...(change.onDone ?? {}) } };
  saveConnections(store, list);
  return list[at]!;
}

// --- Secrets in the login keychain -----------------------------------------------------------

const SERVICE = 'Didja connection';

export interface Keychain {
  get(account: string): string | null;
  set(account: string, value: string): void;
  remove(account: string): void;
}

/** macOS login keychain through `security`. */
/** Before the rename (2026-11-11) the keys were kept under this name; read once, then kept under the new one. */
const OLD_SERVICE = 'ScrolledAway connection';

export const loginKeychain: Keychain = {
  get(account) {
    const read = (service: string) => {
      const run = Bun.spawnSync(['security', 'find-generic-password', '-s', service, '-a', account, '-w']);
      return run.exitCode === 0 ? run.stdout.toString().replace(/\n$/, '') : null;
    };
    const value = read(SERVICE);
    if (value !== null) return value;
    const old = read(OLD_SERVICE);
    if (old !== null) Bun.spawnSync(['security', 'add-generic-password', '-U', '-s', SERVICE, '-a', account, '-w', old]);
    return old;
  },
  set(account, value) {
    // -w with a value puts it on the command line for a moment; the keychain is the right place
    // to keep it, and only local processes of this user could see the command.
    Bun.spawnSync(['security', 'add-generic-password', '-U', '-s', SERVICE, '-a', account, '-w', value]);
  },
  remove(account) {
    Bun.spawnSync(['security', 'delete-generic-password', '-s', SERVICE, '-a', account]);
  },
};

/** The fixed address your browser is sent back to after signing in. */
export const CALLBACK_PORT = 33418;
const CALLBACK = `http://localhost:${CALLBACK_PORT}/callback`;

class KeychainProvider implements OAuthClientProvider {
  constructor(private id: string, private keychain: Keychain, private open: (url: URL) => void, private expectedState?: string) {}
  /** A one-time value the sign-in page must hand back, so only a sign-in we started completes. */
  state() { return this.expectedState ?? crypto.randomUUID(); }
  get redirectUrl() { return CALLBACK; }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Didja',
      redirect_uris: [CALLBACK],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }
  private read<T>(what: string): T | undefined {
    const raw = this.keychain.get(`${this.id}:${what}`);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }
  clientInformation() {
    // Registered for another return address (an older version): register again.
    const info = this.read<OAuthClientInformationMixed & { redirect_uris?: string[] }>('client');
    return info && (!info.redirect_uris || info.redirect_uris.includes(CALLBACK)) ? info : undefined;
  }
  saveClientInformation(info: OAuthClientInformationMixed) { this.keychain.set(`${this.id}:client`, JSON.stringify(info)); }
  tokens() { return this.read<OAuthTokens>('tokens'); }
  saveTokens(tokens: OAuthTokens) { this.keychain.set(`${this.id}:tokens`, JSON.stringify(tokens)); }
  redirectToAuthorization(url: URL) { this.open(url); }
  saveCodeVerifier(verifier: string) { this.keychain.set(`${this.id}:verifier`, verifier); }
  codeVerifier() { return this.keychain.get(`${this.id}:verifier`) ?? ''; }
}

export function forgetSecrets(id: string, keychain: Keychain = loginKeychain): void {
  for (const what of ['client', 'tokens', 'verifier']) keychain.remove(`${id}:${what}`);
}

function transportFor(server: { url: string; sse?: boolean }, auth: OAuthClientProvider): Transport {
  const url = new URL(server.url);
  return server.sse ? new SSEClientTransport(url, { authProvider: auth }) : new StreamableHTTPClientTransport(url, { authProvider: auth });
}

/** The servers to try for a connection: the one that answered before, first. */
function serversFor(connection: Connection): { url: string; sse?: boolean }[] {
  const all = KINDS[connection.kind]?.servers ?? [];
  const known = all.find((s) => s.url === connection.server);
  return known ? [known, ...all.filter((s) => s !== known)] : all;
}

/** Thrown when you must sign in, naming the server that asked, so sign-in finishes there. */
export class NeedsSignIn extends UnauthorizedError {
  constructor(public server: { url: string; sse?: boolean }) {
    super('sign in from the Connections window');
  }
}

/** Open a session with a connection's server. Throws `NeedsSignIn` when you must sign in. */
export async function openSession(connection: Connection, keychain: Keychain = loginKeychain, open: (url: URL) => void = () => {
  throw new UnauthorizedError('sign in from the Connections window');
}, state?: string): Promise<{ client: Client; server: { url: string; sse?: boolean } }> {
  let last: unknown = new Error(`no server known for ${connection.kind}`);
  for (const server of serversFor(connection)) {
    const client = new Client({ name: 'Didja', version: '0.2.0' });
    try {
      await client.connect(transportFor(server, new KeychainProvider(connection.id, keychain, open, state)));
      return { client, server };
    } catch (error) {
      if (error instanceof UnauthorizedError || /unauthori[sz]ed|401/i.test(String((error as Error)?.message))) throw new NeedsSignIn(server);
      last = error; // this transport is not served here: try the next
    }
  }
  throw last;
}

/**
 * Sign in: your browser opens the tool's own sign-in page; once you approve, it comes back to
 * Didja on 127.0.0.1 and the keys are kept in your keychain. Five minutes to finish.
 */
export async function signIn(connection: Connection, openBrowser: (url: URL) => void, keychain: Keychain = loginKeychain): Promise<void> {
  let deliver: (code: string) => void = () => {};
  let fail: (e: Error) => void = () => {};
  const arrived = new Promise<string>((resolve, reject) => { deliver = resolve; fail = reject; });
  const state = crypto.randomUUID();
  const name = KINDS[connection.kind]?.name ?? connection.kind;
  const fetch = (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname !== '/callback') return new Response('Not found', { status: 404 });
    const code = url.searchParams.get('code');
    const ok = code !== null && url.searchParams.get('state') === state;
    if (ok) deliver(code!);
    else fail(new Error(url.searchParams.get('error_description') ?? url.searchParams.get('error') ?? 'sign-in was not completed'));
    return new Response(callbackPage(name, ok), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
  // "localhost" may be either address: listen on both, never beyond this Mac.
  const servers = ['127.0.0.1', '::1'].flatMap((hostname) => {
    try {
      return [Bun.serve({ hostname, port: CALLBACK_PORT, fetch })];
    } catch {
      return [];
    }
  });
  if (servers.length === 0) throw new Error(`port ${CALLBACK_PORT} is in use; quit what is using it and try again`);
  const timer = setTimeout(() => fail(new Error('sign-in took longer than five minutes')), 5 * 60_000);
  try {
    let asking: { url: string; sse?: boolean };
    try {
      const { client } = await openSession(connection, keychain, openBrowser, state);
      await client.close(); // already signed in
      return;
    } catch (error) {
      if (!(error instanceof NeedsSignIn)) throw error;
      asking = error.server;
    }
    const code = await arrived;
    const transport = transportFor(asking, new KeychainProvider(connection.id, keychain, openBrowser, state));
    await (transport as StreamableHTTPClientTransport).finishAuth(code);
    const { client } = await openSession(connection, keychain);
    await client.close();
  } finally {
    clearTimeout(timer);
    for (const server of servers) server.stop(true);
  }
}

/** The page your browser lands on after signing in: says what happened, and closes itself if it may. */
export function callbackPage(name: string, ok: boolean): string {
  const text = ok
    ? `<h2>Connected to ${name}</h2><p>You can close this tab and go back to Didja.</p>`
    : `<h2>Not connected</h2><p>The sign-in to ${name} was not completed. Go back to Didja and press Connect again.</p>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Didja</title></head>
<body style="font: 15px -apple-system, sans-serif; padding: 48px; color: #222">${text}
<script>${ok ? 'setTimeout(function () { window.close(); }, 1500);' : ''}</script></body></html>`;
}

// --- Items -----------------------------------------------------------------------------------

/** An item in a connected tool, as Didja keeps it. */
export interface ExternalItem {
  id: string;
  /** "PMO-42". */
  key: string;
  title: string;
  url: string | null;
  /** YYYY-MM-DD, or null. */
  due: string | null;
  /** The tool's own words for its state ("In Progress"), and its kind ("started", "completed"). */
  state: string;
  stateType: string;
  /** The team it belongs to, by name, where the tool says. */
  team?: string;
}

/** The text an MCP tool call returned, parsed as JSON where it is JSON. */
export function resultJSON(result: unknown): unknown {
  const content = (result as { content?: { type: string; text?: string }[] })?.content ?? [];
  const text = content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Linear's issues from a `list_issues` answer, whatever wraps them. */
export function linearItems(json: unknown): ExternalItem[] {
  const list: unknown[] = Array.isArray(json) ? json
    : Array.isArray((json as { issues?: unknown[] })?.issues) ? (json as { issues: unknown[] }).issues
    : Array.isArray((json as { nodes?: unknown[] })?.nodes) ? (json as { nodes: unknown[] }).nodes : [];
  return list.flatMap((raw) => {
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.title !== 'string') return [];
    const status = typeof r.status === 'string' ? r.status : (r.status as { name?: string })?.name ?? '';
    return [{
      id: typeof r.uuid === 'string' ? r.uuid : r.id,
      key: typeof r.identifier === 'string' ? r.identifier : r.id,
      title: r.title,
      url: typeof r.url === 'string' ? r.url : null,
      due: typeof r.dueDate === 'string' ? r.dueDate.slice(0, 10) : null,
      state: status,
      stateType: typeof r.statusType === 'string' ? r.statusType : '',
      ...(typeof r.team === 'string' ? { team: r.team } : typeof (r.team as { name?: string })?.name === 'string' ? { team: (r.team as { name: string }).name } : {}),
    }];
  });
}

/** Today's date where you are, YYYY-MM-DD. */
export function localDay(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

const CLOSED = ['completed', 'canceled', 'cancelled', 'duplicate'];

/** Due today or overdue, and still open. */
export function isDueNow(item: ExternalItem, now: Date): boolean {
  if (!item.due) return false;
  if (CLOSED.includes(item.stateType.toLowerCase())) return false;
  return item.due <= localDay(now);
}

/** Whether an item comes in under a connection's rules. */
export function isWanted(item: ExternalItem, bring: Bring, now: Date): boolean {
  const type = item.stateType.toLowerCase();
  if (CLOSED.includes(type)) return false;
  if (bring.teams.length > 0 && !bring.teams.some((t) => t.toLowerCase() === (item.team ?? '').toLowerCase())) return false;
  return (bring.due && isDueNow(item, now)) || (bring.started && type === 'started') ||
    (bring.unstarted && type === 'unstarted') || (bring.backlog && type === 'backlog');
}
