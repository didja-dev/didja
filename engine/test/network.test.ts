/**
 * SCR-112: every network connection Didja can make is listed in docs/NETWORK.md. This scans the app's
 * and the engine's sources for network code and fails when it shows up in a file that list does not
 * name, so a new connection cannot arrive without its documentation (and a maintainer's decision:
 * CLAUDE.md, "Nothing leaves the device").
 */
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '../..');

function files(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, ext);
    return path.endsWith(ext) ? [path] : [];
  });
}

/** Code that opens a connection: Apple's URL loading and Network framework, sockets, fetch, MCP's HTTP transports, a server. */
const SWIFT = [/\bURLSession\b/, /\bURLRequest\b/, /\bNWConnection\b/, /\bNWListener\b/, /\bCFSocket/, /\bCFStream/, /\bURLSessionWebSocketTask\b/];
const TS = [
  /\bfetch\(/, /\bWebSocket\b/, /StreamableHTTPClientTransport/, /SSEClientTransport/, /\bBun\.(?:serve|connect|listen)\b/,
  /from ['"]node:(?:net|http|https|dgram|tls)['"]/,
];
const patterns = (f: string) => (f.endsWith('.swift') ? SWIFT : TS);

/** The files docs/NETWORK.md names as making connections. */
const ALLOWED = new Set(['app/Didja/LocalModel.swift', 'engine/src/connections.ts']);

const strip = (code: string) => code.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

test('network code lives only in the files docs/NETWORK.md lists', () => {
  const sources = [
    ...files(join(ROOT, 'app/Didja'), '.swift'), ...files(join(ROOT, 'app/Capture'), '.swift'),
    ...files(join(ROOT, 'engine/src'), '.ts'),
  ];
  const found = sources
    .filter((f) => patterns(f).some((re) => re.test(strip(readFileSync(f, 'utf8')))))
    .map((f) => relative(ROOT, f));
  expect(found.filter((f) => !ALLOWED.has(f))).toEqual([]);
  // And each allowed file really is one (so the list does not go stale the other way).
  expect(found.sort()).toEqual([...ALLOWED].sort());
});

test('the update check goes only to didja.dev, once a day, and the page names every host', () => {
  const plist = readFileSync(join(ROOT, 'app/Didja-Info.plist'), 'utf8');
  expect(plist).toMatch(/<key>SUFeedURL<\/key>\s*<string>https:\/\/didja\.dev\/appcast\.xml<\/string>/);
  expect(plist).toMatch(/<key>SUScheduledCheckInterval<\/key>\s*<integer>86400<\/integer>/);
  const page = readFileSync(join(ROOT, 'docs/NETWORK.md'), 'utf8');
  const connections = readFileSync(join(ROOT, 'engine/src/connections.ts'), 'utf8');
  const hosts = [...connections.matchAll(/url: 'https:\/\/([^/']+)/g)].map((m) => m[1]!);
  expect(hosts.length).toBeGreaterThan(0);
  for (const host of new Set(hosts)) expect(page).toContain(host);
  expect(page).toContain(`localhost:${connections.match(/CALLBACK_PORT = (\d+)/)![1]}`);
  expect(readFileSync(join(ROOT, 'app/Didja/LocalModel.swift'), 'utf8')).toContain('http://127.0.0.1:11434');
  expect(page).toContain('127.0.0.1:11434');
});
