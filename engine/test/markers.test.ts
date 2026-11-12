import { expect, test } from 'bun:test';
import { deriveCriteria, extractMarkers, requiredMarkers } from '../src/markers.ts';
import { commandAtPrompt } from '../src/match.ts';

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
