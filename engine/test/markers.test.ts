import { expect, test } from 'bun:test';
import { deriveCriteria, extractMarkers, requiredMarkers } from '../src/markers.ts';
import { commandAtPrompt, commandOutcome, failed } from '../src/match.ts';

const values = (title: string, fragments: string[] = []) =>
  extractMarkers(title, fragments).map((m) => `${m.kind}:${m.value}`);

test('env vars, URLs, files and commands', () => {
  expect(values('Set `STRIPE_WEBHOOK_SECRET` in Vercel prod')).toEqual(['env:STRIPE_WEBHOOK_SECRET']);
  expect(values('Add https://app.example.com/auth/callback as a redirect URL in Supabase.')).toEqual([
    'url:https://app.example.com/auth/callback',
  ]);
  expect(values('Add the key to .env.local and update config/app.yaml')).toEqual(['file:.env.local', 'file:config/app.yaml']);
  expect(values('Run `supabase db push`, then check the dashboard')).toEqual(['command:supabase db push']);
});

test('commands come from backticks, code-block lines, or plain prose', () => {
  expect(values('Run the migration:', ['supabase db push', 'It takes a minute.'])).toEqual(['command:supabase db push']);
  expect(values('Run supabase db push and then restart the server')).toEqual(['command:supabase db push']);
  expect(values('Push with `git push origin main` to deploy')).toEqual(['command:git push origin main']);
  expect(values('Use `--force` only if needed')).toEqual([]);
});

test('ordinary words and names inside URLs are not markers', () => {
  expect(values('Read the README and the FAQ, then go on')).toEqual([]);
  expect(values('Open https://vercel.com/acme/API_KEYS/settings')).toEqual(['url:https://vercel.com/acme/API_KEYS/settings']);
});

test('criteria name one service or none', () => {
  expect(deriveCriteria('Set `FOO_BAR` in Vercel prod').service).toBe('vercel');
  expect(deriveCriteria('Copy the URL from Supabase into Vercel').service).toBeNull();
  expect(deriveCriteria('Open https://vercel.com/acme and look around').service).toBeNull();
  expect(deriveCriteria('Run `vercel deploy`').service).toBeNull();
});

test('required markers', () => {
  const env = [{ kind: 'env' as const, value: 'FOO_BAR' }];
  expect(requiredMarkers(env, { service: 'vercel', hosts: ['vercel.com'] })).toEqual(env);
  expect(requiredMarkers(env, { service: null, hosts: [] })).toEqual([]);
  expect(requiredMarkers([{ kind: 'file', value: '.env' }], null)).toEqual([]);
});

test('commandAtPrompt needs a prompt right before the command and nothing after it', () => {
  expect(commandAtPrompt('me@mac app % npm run build', 'npm run build')).toBe(true);
  expect(commandAtPrompt('❯ npm   run build  ', 'npm run build')).toBe(true);
  expect(commandAtPrompt('npm run build', 'npm run build')).toBe(false);
  expect(commandAtPrompt('then run npm run build', 'npm run build')).toBe(false);
  expect(commandAtPrompt('$ npm run build --watch', 'npm run build')).toBe(false);
});

// SCR-61: typed is not run, and a failed run is not done.
const at = (texts: [string, number][]) => texts.flatMap(([text, m], i) =>
  text.split('\n').map((t) => ({ text: t, ts: new Date(Date.UTC(2026, 10, 10, 10, m)).toISOString(), observationId: i + 1 })));
const outcome = (texts: [string, number][], command = 'git push origin main') => commandOutcome(at(texts), command)?.outcome ?? null;

test('a command typed but not entered has not run', () => {
  expect(outcome([['~/repo % git push origin main', 0]])).toBe('typed');
  expect(outcome([['some output', 0]])).toBeNull();
});

test('a command with output, or a new prompt after it, has run', () => {
  expect(outcome([['~/repo % git push origin main\nTo example.com:acme/shop.git\n   1a2b3c4..5d6e7f8  main -> main\n~/repo %', 0]])).toBe('ran');
  expect(outcome([['~/repo % git push origin main', 0], ['Everything up-to-date', 1]])).toBe('ran');
  expect(outcome([['❯ git push origin main', 0], ['❯', 1]])).toBe('ran');
  // Output that comes too late is not this command's.
  expect(outcome([['~/repo % git push origin main', 0], ['Everything up-to-date', 9]])).toBe('typed');
});

test('a run that printed a failure, or whose prompt shows a non-zero exit, has not been done', () => {
  const fails = [
    'fatal: could not read from remote repository.',
    'error: failed to push some refs to the remote',
    ' ! [rejected]        main -> main (fetch first)',
    'zsh: command not found: gti',
    'npm ERR! code ELIFECYCLE',
    'error: script "build" exited with code 1',
    '** BUILD FAILED **',
    'HTTP/2 404',
    'gh: Not Found (HTTP 404)',
    'curl: (6) Could not resolve host: example.com',
    '✘ [ERROR] Could not find a wrangler.toml',
    'Error response from daemon: no such container',
    ' 3 fail',
    'Traceback (most recent call last):',
  ];
  for (const line of fails) {
    expect(failed(line)).toBe(true);
    expect(outcome([[`~/repo % git push origin main\n${line}\n~/repo %`, 0]])).toBe('failed');
  }
  expect(outcome([['❯ git push origin main\nsome output\n✘ ❯', 0]])).toBe('failed');
  expect(outcome([['~/repo % git push origin main\nsome output\n[1] ~/repo %', 0]])).toBe('failed');
  expect(outcome([['~/repo % git push origin main\nsome output\n[0] ~/repo %', 0]])).toBe('ran');
  // Ordinary output is not a failure.
  for (const line of ['Everything up-to-date', ' 0 fail', '290 pass', 'found 0 vulnerabilities', 'Applying migration 0007…', 'No errors found', '** TEST SUCCEEDED **']) {
    expect(failed(line)).toBe(false);
  }
});

test('the same command run again after a failure, and succeeding, has run', () => {
  expect(outcome([
    ['~/repo % git push origin main\nfatal: could not read from remote repository.\n~/repo %', 0],
    ['~/repo % git push origin main\nEverything up-to-date\n~/repo %', 1],
  ])).toBe('ran');
});
