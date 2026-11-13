/**
 * Markers: the exact strings in a task that we can later look for on screen
 * (env var names, URLs, commands, file names), plus where they must be seen
 * for the task to count as done.
 */

export type MarkerKind = 'env' | 'url' | 'command' | 'file';

export interface Marker {
  kind: MarkerKind;
  value: string;
}

/** Where a task's env/url markers must show up. Commands always need a terminal. */
export interface Criteria {
  /** Service named in the task, e.g. "vercel". Null when none, or more than one, is named. */
  service: string | null;
  /** Hosts that count as that service. */
  hosts: string[];
  /** For a task to reply to an email: which conversation, and who wrote. */
  reply?: { subject: string; from: string | null; fromName?: string };
  /** For a task that came from an email: the pages its links point to. */
  links?: string[];
  /** For a task asked of you in a chat: where, by whom, when (ISO), and the message's key. */
  /** A chat ask; `asks` counts the asks in the same conversation that this one task stands for (SCR-45). */
  chat?: { app: string; chat: string; from: string; at: string; key: string; asks?: number };
  /** For an item brought in from a connected tool (Linear): which connection, its id, key and address. */
  external?: { connection: string; id: string; key: string; url: string | null };
}

const SERVICES: { name: string; pattern: RegExp; hosts: string[] }[] = [
  { name: 'vercel', pattern: /\bvercel\b/i, hosts: ['vercel.com'] },
  { name: 'supabase', pattern: /\bsupabase\b/i, hosts: ['supabase.com'] },
  { name: 'github', pattern: /\bgithub\b/i, hosts: ['github.com'] },
  { name: 'stripe', pattern: /\bstripe\b/i, hosts: ['stripe.com'] },
  { name: 'cloudflare', pattern: /\bcloudflare\b/i, hosts: ['cloudflare.com'] },
  { name: 'netlify', pattern: /\bnetlify\b/i, hosts: ['netlify.com'] },
  { name: 'railway', pattern: /\brailway\b/i, hosts: ['railway.app', 'railway.com'] },
  { name: 'render', pattern: /\brender\.com\b|\bon render\b|\bin render\b/i, hosts: ['render.com'] },
  { name: 'fly', pattern: /\bfly\.io\b/i, hosts: ['fly.io'] },
  { name: 'aws', pattern: /\baws\b/i, hosts: ['aws.amazon.com'] },
  { name: 'google cloud', pattern: /\bgoogle cloud\b|\bgcp\b/i, hosts: ['console.cloud.google.com'] },
  { name: 'firebase', pattern: /\bfirebase\b/i, hosts: ['console.firebase.google.com'] },
  { name: 'clerk', pattern: /\bclerk\b/i, hosts: ['clerk.com'] },
  { name: 'resend', pattern: /\bresend\b(?! the| it| this| that)/i, hosts: ['resend.com'] },
  { name: 'sentry', pattern: /\bsentry\b/i, hosts: ['sentry.io'] },
  { name: 'posthog', pattern: /\bposthog\b/i, hosts: ['posthog.com'] },
  { name: 'neon', pattern: /\bneon\b/i, hosts: ['neon.tech', 'neon.com'] },
  { name: 'upstash', pattern: /\bupstash\b/i, hosts: ['upstash.com'] },
  { name: 'auth0', pattern: /\bauth0\b/i, hosts: ['auth0.com'] },
  { name: 'twilio', pattern: /\btwilio\b/i, hosts: ['twilio.com'] },
  { name: 'sendgrid', pattern: /\bsendgrid\b/i, hosts: ['sendgrid.com'] },
  { name: 'openai', pattern: /\bopenai\b/i, hosts: ['platform.openai.com'] },
  { name: 'anthropic', pattern: /\banthropic\b/i, hosts: ['console.anthropic.com', 'platform.claude.com'] },
  { name: 'linear', pattern: /\blinear\b/i, hosts: ['linear.app'] },
  { name: 'slack', pattern: /\bslack\b/i, hosts: ['slack.com'] },
];

/**
 * Text with the link targets capture writes after a link's words (" ⟨https://…⟩") taken out:
 * where a link points is not something you saw, nor something you were asked to do (SCR-68).
 */
export function withoutLinkTargets(text: string): string {
  return text.replace(/ ?⟨https?:\/\/[^⟩\s]*⟩/g, '');
}

const ENV_VAR = /\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/g;
const URL = /https?:\/\/[^\s"'`<>)\]”’]+/g;
const FILE =
  /(?:^|[\s"'`(“])((?:[\w.-]+\/)*(?:\.env(?:\.[\w-]+)*|[\w-]+(?:\.[\w-]+)*\.(?:ts|tsx|js|jsx|mjs|json|md|sql|ya?ml|toml|py|swift|sh|css|html|env|lock|rb|go|rs)))(?=$|[\s"'`),.:;”])/g;
const CLI =
  'npm|npx|pnpm|yarn|bun|bunx|git|gh|supabase|vercel|docker|brew|pip3?|python3?|node|cargo|swift|make|psql|stripe|wrangler|terraform|kubectl|curl|prisma|flyctl|netlify|firebase|gcloud|rails|bundle|deno' +
  '|wget|ssh|rsync|ipconfig|defaults|killall|launchctl|networksetup|scutil|softwareupdate|diskutil|tccutil|codesign|spctl|plutil|pmset|xcode-select|xcrun|xcodebuild|pipx|uv|poetry|nvm';
const WHOLE_COMMAND = new RegExp(`^(?:${CLI})\\s+\\S.{0,150}$`);
const COMMAND_IN_PROSE = new RegExp(`(?:^|[\\s\`“"(:])((?:${CLI})\\s+[a-z0-9@:./=_-][^\\n\`”"]{0,120})`, 'g');
/** Where a command written inside a sentence most likely ends. */
const COMMAND_END = /\s+(?:and|then|to|in|from|on|so|before|after|when|if|which|for)\s|[,;)]|\.\s|\.$/;

function normaliseCommand(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

function normaliseUrl(raw: string): string {
  return raw.replace(/[.,;:!?]+$/, '').replace(/\/+$/, '');
}

/**
 * Pull markers out of a task. `fragments` are the other lines belonging to it
 * (sub-bullets, paragraphs, lines of a code block). The capture layer wraps
 * inline code in backticks, which gives exact command boundaries.
 */
export function extractMarkers(title: string, fragments: string[] = []): Marker[] {
  const seen = new Set<string>();
  const out: Marker[] = [];
  const add = (kind: MarkerKind, value: string) => {
    const key = `${kind}:${value}`;
    if (value && !seen.has(key)) {
      seen.add(key);
      out.push({ kind, value });
    }
  };

  const texts = [title, ...fragments];
  for (const text of texts) {
    for (const m of text.match(URL) ?? []) {
      if (!m.includes('[')) add('url', normaliseUrl(m)); // skip Screenpipe redaction placeholders
    }
  }
  for (const text of texts) {
    const withoutUrls = text.replace(URL, ' ');
    for (const m of withoutUrls.match(ENV_VAR) ?? []) add('env', m);
    for (const m of withoutUrls.matchAll(FILE)) add('file', m[1]!);
  }
  const codeSpans = texts.flatMap((t) => [...t.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!));
  // A fragment that is a command and nothing else is a line of a code block.
  for (const candidate of [...codeSpans, ...fragments]) {
    const whole = normaliseCommand(candidate);
    if (WHOLE_COMMAND.test(whole) && whole.split(' ').length <= 12) add('command', whole);
  }
  if (!out.some((m) => m.kind === 'command')) {
    for (const m of title.matchAll(COMMAND_IN_PROSE)) {
      const raw = m[1]!;
      const end = raw.search(COMMAND_END);
      add('command', normaliseCommand(end === -1 ? raw : raw.slice(0, end)));
    }
  }
  return out;
}

/** Work out which service, if any, a task's env/url markers belong on. */
export function deriveCriteria(title: string, fragments: string[] = []): Criteria {
  // Service names inside URLs and commands don't say where the task happens.
  const prose = [title, ...fragments].join(' \n ').replace(URL, ' ').replace(/`[^`\n]*`/g, ' ');
  const named = SERVICES.filter((s) => s.pattern.test(prose));
  // Two services ("copy the key from Supabase into Vercel") is ambiguous: don't guess.
  if (named.length !== 1) return { service: null, hosts: [] };
  return { service: named[0]!.name, hosts: named[0]!.hosts };
}

/** Markers that must each be seen before a task is ticked. Empty means never auto-tick. */
export function requiredMarkers(markers: Marker[], criteria: Criteria | null): Marker[] {
  const required = markers.filter((m) => m.kind !== 'file');
  const needsService = required.some((m) => m.kind === 'env' || m.kind === 'url');
  if (needsService && !criteria?.service) return [];
  return required;
}
