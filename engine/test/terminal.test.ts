import { expect, test } from 'bun:test';
import { commandScreen, pollOnce } from '../src/engine.ts';
import type { Looker } from '../src/looksdone.ts';
import { commandOutcome } from '../src/match.ts';
import { Store } from '../src/store.ts';
import { cleanCommand, parsePrompt, promptCore, sameCommand, sectionOf, splitSession, terminalLines } from '../src/terminal.ts';
import type { TerminalLine } from '../src/terminal.ts';

// SCR-69: terminals read as prompts, commands, output and outcome. Every session here is made up.
const lines = (text: string, minute = 0): TerminalLine[] =>
  text.split('\n').map((t) => ({ text: t, ts: new Date(Date.UTC(2026, 10, 10, 10, minute)).toISOString(), observationId: 1 }));
const runs = (text: string) => splitSession(lines(text)).map((r) => `${r.command} → ${r.outcome}`);

test('zsh, oh-my-zsh, a starship-like prompt, bash and fish: commands split, outcomes right', () => {
  expect(runs([
    'sam@mac acme-web % git pull --rebase',
    'Successfully rebased and updated refs/heads/main.',
    'sam@mac acme-web % git push origin main',
    ' ! [rejected]        main -> main (fetch first)',
    "error: failed to push some refs to 'example.com:acme/web.git'",
    'sam@mac acme-web % ',
  ].join('\n'))).toEqual(['git pull --rebase → ok', 'git push origin main → failed']);

  // oh-my-zsh: the ✗ after the branch is a dirty tree, not a failed command.
  expect(runs([
    '➜  acme-web git:(main) ✗ bun test',
    ' 290 pass',
    ' 0 fail',
    '➜  acme-web git:(main) ✗ git push origin main',
    'Everything up-to-date',
    '➜  acme-web git:(main) ',
  ].join('\n'))).toEqual(['bun test → ok', 'git push origin main → ok']);

  // Starship-like: the path and branch on one line, ❯ on the next; ✘ before ❯ when the last one failed.
  expect(runs([
    'acme-web on  main via  v22.1.0',
    '❯ npm run build',
    'npm ERR! code ELIFECYCLE',
    'acme-web on  main via  v22.1.0',
    '✘ ❯ npm run lint',
    'All files pass linting.',
    'acme-web on  main via  v22.1.0',
    '❯ ',
  ].join('\n'))).toEqual(['npm run build → failed', 'npm run lint → ok']);

  expect(runs([
    'noa@build-box:~/acme-web$ make deploy',
    'Deployed acme-web to staging.',
    'noa@build-box:~/acme-web$ ',
  ].join('\n'))).toEqual(['make deploy → ok']);

  expect(runs([
    'noa@build-box ~/acme-web> git status',
    'On branch main',
    'nothing to commit, working tree clean',
    'noa@build-box ~/acme-web> git push origin main',
  ].join('\n'))).toEqual(['git status → ok', 'git push origin main → typed']);

  expect(sectionOf(splitSession(lines('❯ make deploy'))[0]!)).toBe('⟦Command: make deploy — unknown⟧');
});

test('a right-side prompt and a trailing comment are not part of the command; output is not a prompt', () => {
  expect(parsePrompt('sam@mac acme-web % git push origin main                 10:42:01')).toEqual({ prompt: 'sam@mac acme-web %', command: 'git push origin main', right: '10:42:01' });
  expect(parsePrompt('❯ git push origin main   ✔  took 3s  at 10:42')!.command).toBe('git push origin main');
  expect(cleanCommand('git push origin main # ship it')).toBe('git push origin main');
  expect(cleanCommand('git commit -m "fix #42"')).toBe('git commit -m "fix #42"');
  expect(cleanCommand('echo "a   b"')).toBe('echo "a b"');
  expect(parsePrompt('Everything up-to-date')).toBeNull();
  expect(parsePrompt('Then run the build, and you are done > ok')).toBeNull();
  expect(promptCore('[1] ~/repo %')).toBe('~/repo %');
  expect(promptCore('✘ ❯')).toBe('❯');
});

test('the same command: flag order and an extra flag that still does it match; other args, a dry run or help do not', () => {
  expect(sameCommand('git push origin main', 'git push -u origin main')).toBe(true);
  expect(sameCommand('git push origin main', 'git push origin main --force-with-lease')).toBe(true);
  expect(sameCommand('npm install --save-dev typescript', 'npm install typescript --save-dev')).toBe(true);
  expect(sameCommand('git commit -m "Release"', 'git commit -am "Release"')).toBe(true);
  expect(sameCommand('./scripts/release.sh', 'scripts/release.sh')).toBe(true);
  // Not the same.
  expect(sameCommand('git push origin main', 'git push origin dev')).toBe(false);
  expect(sameCommand('git push origin main', 'git push')).toBe(false);
  expect(sameCommand('git push origin main', 'git push origin main extra')).toBe(false);
  expect(sameCommand('git push origin main', 'git push --dry-run origin main')).toBe(false);
  expect(sameCommand('git push origin main', 'git push -n origin main')).toBe(false);
  expect(sameCommand('vercel deploy --prod', 'vercel deploy')).toBe(false); // a flag the task gives is missing
  expect(sameCommand('vercel deploy --prod', 'vercel deploy --prod --help')).toBe(false);
  expect(sameCommand('kubectl apply --context=prod', 'kubectl apply --context=staging')).toBe(false);
  expect(sameCommand('rm -rf build', 'rm -rf build/cache')).toBe(false);
});

test('`git push -u origin main` ticks a `git push origin main` step; a failed or typed one does not', () => {
  expect(commandOutcome(lines('~/repo % git push -u origin main\nbranch \'main\' set up to track \'origin/main\'.\n~/repo %'), 'git push origin main')?.outcome).toBe('ran');
  expect(commandOutcome(lines('~/repo % git push -u origin main\nfatal: could not read from remote repository.\n~/repo %'), 'git push origin main')?.outcome).toBe('failed');
  expect(commandOutcome(lines('~/repo % git push -u origin main'), 'git push origin main')?.outcome).toBe('typed');
  expect(commandOutcome(lines('~/repo % git push --dry-run origin main\nTo example.com:acme/web.git\n~/repo %'), 'git push origin main')).toBeNull();
});

test('an editor keeps only the lines under its ⟦Terminal⟧ section', () => {
  const text = 'README.md\n⟦Terminal⟧\n~/repo % make deploy\nDeployed.\n⟦Page⟧\n~/repo % git push origin main';
  expect(terminalLines(text, true)).toEqual(['~/repo % make deploy', 'Deployed.']);
  expect(terminalLines(text, false).length).toBe(6);
});

// --- end to end ------------------------------------------------------------------------------------

const T0 = Date.parse('2026-11-11T10:00:00Z');
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();
function claudeAsks(store: Store, command: string): number {
  store.insertObservation({ ts: at(0), bundleId: 'com.anthropic.claudefordesktop', app: 'Claude', windowTitle: 'Release', url: null, source: 'ax',
    text: `⟦Message 4⟧\nClaude responded: Committed. Now push:\nNow push:\n\`${command}\`` });
  pollOnce(store, new Date(at(0)));
  const task = store.listTasks().find((t) => t.title.includes(command));
  expect(task?.auto).toBe(true);
  return task!.id;
}
const editor = (store: Store, minute: number, text: string) => store.insertObservation({ ts: at(minute), bundleId: 'com.microsoft.VSCode',
  app: 'Code', windowTitle: 'release.ts — acme-web', url: null, source: 'ax', text });

test('a run in an editor\'s own terminal ticks the step', () => {
  const store = new Store(':memory:');
  const id = claudeAsks(store, 'git push origin main');
  editor(store, 2, '⟦Terminal⟧\nsam@mac acme-web % git push -u origin main\nTo example.com:acme/web.git\n   1a2b3c4..5d6e7f8  main -> main\nsam@mac acme-web % \n⟦Page⟧');
  pollOnce(store, new Date(at(3)));
  expect(store.getTask(id)!.status).toBe('done');
  store.close();
});

test('the same command in an editor outside its terminal (a doc, a file) does not tick', () => {
  const store = new Store(':memory:');
  const id = claudeAsks(store, 'git push origin main');
  editor(store, 2, 'DEPLOY.md\nsam@mac acme-web % git push origin main\nTo example.com:acme/web.git\nsam@mac acme-web % ');
  pollOnce(store, new Date(at(3)));
  expect(store.getTask(id)!.status).toBe('open');
  store.close();
});

test('a command step still open after two hours may be shown to "looks done?" on a terminal where a like run went well; never ticked', () => {
  const store = new Store(':memory:');
  const id = claudeAsks(store, 'npm run deploy:prod');
  const asked: Parameters<Looker>[0][] = [];
  const look: Looker = (input) => { asked.push(input); return 'done'; };
  const terminal = (minute: number, text: string) => store.insertObservation({ ts: at(minute), bundleId: 'com.mitchellh.ghostty', app: 'Ghostty',
    windowTitle: 'acme-web', url: null, source: 'ax', text });
  terminal(30, 'sam@mac acme-web % npm run deploy -- --prod\n> acme-web@1.0.0 deploy\nDeployed to production.\nsam@mac acme-web % ');
  // Within two hours: an exact match is still waited for.
  expect(pollOnce(store, new Date(at(60)), { looker: look }).suggested).toBe(0);
  expect(asked).toEqual([]);
  // Later: shown, suggested, still open; and with Accept Automatically on, still not ticked.
  store.setMeta('looks_done', 'accept');
  expect(pollOnce(store, new Date(at(122)), { looker: look }).suggested).toBe(1);
  expect(asked[0]!.text).toContain('npm run deploy -- --prod');
  expect(store.getTask(id)!.status).toBe('open');
  pollOnce(store, new Date(at(123)), { looker: look });
  expect(store.getTask(id)!.status).toBe('open');
  store.close();
});

test('a failed or only typed run of the same program is never shown to "looks done?"', () => {
  const o = (text: string) => ({ id: 1, ts: at(30), bundleId: 'com.mitchellh.ghostty', app: 'Ghostty', windowTitle: 'acme-web', url: null, source: 'ax' as const, text });
  expect(commandScreen('npm run deploy:prod', o('~/w % npm run deploy -- --prod\nnpm ERR! code ELIFECYCLE\n~/w % '))).toBeNull();
  expect(commandScreen('npm run deploy:prod', o('~/w % npm run deploy -- --prod'))).toBeNull();
  expect(commandScreen('npm run deploy:prod', o('~/w % git status\nclean\n~/w % '))).toBeNull();
  expect(commandScreen('npm run deploy:prod', { ...o('~/w % npm run deploy\nok\n~/w % '), bundleId: 'com.apple.Safari' })).toBeNull();
  expect(commandScreen('npm run deploy:prod', o('~/w % npm run deploy\nok\n~/w % '))).toContain('npm run deploy');
});
