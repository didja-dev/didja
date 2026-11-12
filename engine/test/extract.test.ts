import { expect, test } from 'bun:test';
import { assemble, classifySource, extractChecklists, followUpActor, listActor, sourceRef, renamedSource } from '../src/extract.ts';

test('finds a numbered checklist of actions', () => {
  const text = `Done! Before this works in prod you need to:
1. Set SUPABASE_SERVICE_ROLE_KEY in Vercel prod
2. Run the migration: supabase db push
3. Add https://app.example.com/auth/callback as a redirect URL in Supabase
Let me know when that's done.`;
  const lists = extractChecklists(text);
  expect(lists.length).toBe(1);
  expect(lists[0]!.items.map((i) => i.position)).toEqual([1, 2, 3]);
  expect(lists[0]!.items[0]!.title).toBe('Set SUPABASE_SERVICE_ROLE_KEY in Vercel prod');
  expect(lists[0]!.items[2]!.title).toBe('Add https://app.example.com/auth/callback as a redirect URL in Supabase');
  expect(lists[0]!.confidence).toBe(1);
  expect(lists[0]!.title).toBe('Done! Before this works in prod you need to');
});

test('a paragraph-long lead-in is cut down to the sentence that introduces the list', () => {
  const text = `One thing is still unproven on live data: an auto-tick. Here is a real two-step checklist to try it with. Run each command in Ghostty and, within about a minute, each step should tick itself and the parent should move on.
1. Run the first command
2. Run the second command`;
  expect(extractChecklists(text)[0]!.title).toBe('Here is a real two-step checklist to try it with');
});

test('a list with no lead-in is named after its message, or not at all', () => {
  const labelled = 'Claude responded: Three things left for you\n1. Create the bucket\n2. Upload the file';
  expect(extractChecklists(labelled)[0]!.title).toBe('Three things left for you');
  expect(extractChecklists('1. Create the bucket\n2. Upload the file')[0]!.title).toBeNull();
  expect(extractChecklists('⏺ Next steps:\n  1. Create the bucket\n  2. Upload the file')[0]!.title).toBe('Next steps');
});

test('nested bullets, sub-steps and paragraphs stay with their item', () => {
  // The shape the capture layer produces for a rendered list with nested lists.
  const text = `1. Fix the two capture flaws first (small):
  • Inline code is cut out of titles
  • Steps 4–6 were missed
  1. Check the first sub-step
  2. Check the second sub-step
Milestone 2 depends on those code fragments.
2. Start the exact-marker completion work
  • Pull markers out of each task`;
  const [list] = extractChecklists(text);
  expect(list!.items.map((i) => i.title)).toEqual([
    'Fix the two capture flaws first (small):',
    'Start the exact-marker completion work',
  ]);
  // The two numbered sub-steps are things to do, so they are steps of their own;
  // the two bullets are statements and stay with the item as context.
  expect(list!.items[0]!.children.map((c) => c.title)).toEqual(['Check the first sub-step', 'Check the second sub-step']);
  expect(list!.items[0]!.fragments).toEqual(['Inline code is cut out of titles', 'Steps 4–6 were missed']);
  expect(list!.items[1]!.children.map((c) => c.title)).toEqual(['Pull markers out of each task']);
});

test('wrapped terminal lines are joined into the title', () => {
  const text = `1) In Vercel, add the env var
   NEXT_PUBLIC_SITE_URL for Production
2) Then redeploy the project`;
  const [list] = extractChecklists(text, { joinWrapped: true });
  expect(list!.items[0]!.title).toBe('In Vercel, add the env var NEXT_PUBLIC_SITE_URL for Production');
  // In a chat window the same indented line is a separate paragraph of the item.
  const [chat] = extractChecklists(text);
  expect(chat!.items[0]!.title).toBe('In Vercel, add the env var');
  expect(chat!.items[0]!.fragments).toEqual(['NEXT_PUBLIC_SITE_URL for Production']);
});

test('a short item like "4. Scaffold:" is skipped without ending the list', () => {
  const text = `3. Write the docs from the matching sections
4. Scaffold:
- the app
- the engine
5. Implement Milestone 1 only
6. Commit in small logical commits, push`;
  const [list] = extractChecklists(text);
  expect(list!.items.map((i) => i.position)).toEqual([3, 5, 6]);
});

test('a step ending in a colon takes the code that follows into its title', () => {
  const text = `1. Click +, paste this path, and add the app:
  ~/Documents/GitHub/app/build/Didja.app
2. Run the migration:
  \`supabase db push\`
3. Check these things:
  It should say Capturing within about five seconds.`;
  expect(extractChecklists(text)[0]!.items.map((i) => i.title)).toEqual([
    'Click +, paste this path, and add the app: `~/Documents/GitHub/app/build/Didja.app`',
    'Run the migration: `supabase db push`',
    'Check these things:',
  ]);
});

test('accepts a list whose top is out of view', () => {
  const [list] = extractChecklists('3. Restart the dev server\n4. Verify the login flow works');
  expect(list!.items.map((i) => i.position)).toEqual([3, 4]);
});

test('ignores numbered prose that is not a to-do list', () => {
  const text = `There were two causes:
1. The cache was stale after the deploy
2. The cookie domain was wrong`;
  expect(extractChecklists(text)).toEqual([]);
});

test('ignores single items, version numbers and code line numbers', () => {
  expect(extractChecklists('1. Run the tests')).toEqual([]);
  expect(extractChecklists('1.2.3 released\n1.2.4 released')).toEqual([]);
  expect(extractChecklists('1 import foo\n2 import bar\n3 run()')).toEqual([]);
});

test('a break in numbering starts a new list', () => {
  const text = `1. Create the bucket
2. Upload the file
1. Open the dashboard
2. Check the logs`;
  expect(extractChecklists(text).length).toBe(2);
});

test('claudeOnly ignores a view with no message labels, such as a document preview', () => {
  const text = '1. Create a private repo\n2. Write the README';
  expect(extractChecklists(text, { claudeOnly: true })).toEqual([]);
  expect(extractChecklists(text).length).toBe(1);
});

test('unrelated text between items ends the list', () => {
  const filler = Array.from({ length: 10 }, (_, i) => `some unrelated line ${i}`).join('\n');
  expect(extractChecklists(`1. Create the bucket\n${filler}\n2. Upload the file`)).toEqual([]);
});

test('claudeOnly keeps lists Claude wrote and drops the ones you wrote', () => {
  const text = `You said: Steps: 1. Create a repo
Steps:
1. Create a private GitHub repo
2. Write the README
Claude responded: Done. Two things left for you:
Done. Two things left for you:
1. Set STRIPE_WEBHOOK_SECRET in Vercel prod
2. Run supabase db push`;
  const lists = extractChecklists(text, { claudeOnly: true });
  expect(lists.length).toBe(1);
  expect(lists[0]!.items[0]!.title).toBe('Set STRIPE_WEBHOOK_SECRET in Vercel prod');
  expect(extractChecklists(text).length).toBe(2);
});

test('claudeOnly ignores a view with no message labels, such as a document preview', () => {
  const text = '1. Create a private repo\n2. Write the README';
  expect(extractChecklists(text, { claudeOnly: true })).toEqual([]);
  expect(extractChecklists(text).length).toBe(1);
});

test('classifies Claude surfaces and ignores everything else', () => {
  const w = (bundleId: string, windowTitle = '', url: string | null = null) => ({ bundleId, windowTitle, url });
  expect(classifySource(w('com.anthropic.claudefordesktop', 'Claude'), '')).toBe('claude-desktop');
  expect(classifySource(w('com.google.Chrome', 'x', 'https://claude.ai/chat/1'), '')).toBe('claude-web');
  expect(classifySource(w('com.mitchellh.ghostty', '✳ Fix auth redirect'), '')).toBe('claude-code');
  expect(classifySource(w('com.mitchellh.ghostty', 'zsh'), '⏺ Done.\n? for shortcuts')).toBe('claude-code');
  expect(classifySource(w('com.mitchellh.ghostty', 'zsh'), 'npm test')).toBeNull();
  expect(classifySource(w('com.apple.mail', 'Inbox'), '')).toBeNull();
  expect(classifySource(w('com.apple.Safari', 'x', 'https://notclaude.ai.evil.com/'), '')).toBeNull();
});

test('sourceRef strips the Claude Code spinner glyph and repeated app names', () => {
  expect(sourceRef({ app: 'Ghostty', windowTitle: '✳ Fix auth redirect' })).toBe('Ghostty — Fix auth redirect');
  expect(sourceRef({ app: 'Claude', windowTitle: 'Claude' })).toBe('Claude');
});

// --- what is being asked of you, versus what Claude says it did or will do

test('only steps that ask you to do something are kept', () => {
  const text = `Next steps
1. Re-grant Accessibility, then ask Claude for a short checklist.
2. Run one of its backticked commands in Ghostty.
3. After that, the rest of Milestone 3: snooze and dismiss in the menu.`;
  const [list] = extractChecklists(text);
  expect(list!.items.map((i) => i.position)).toEqual([1, 2]);
});

test("a list Claude introduces as its own plan or report is not yours to do", () => {
  for (const leadIn of [
    "Two options, and I'd do them in this order:",
    "I'll take these in order:",
    'What I changed:',
    'Plan',
    "Here is what I did:",
    'Let me:',
  ]) {
    const text = `${leadIn}\n1. Fix the two capture flaws\n2. Add markers to each task\n3. Run the tests`;
    expect(extractChecklists(text)).toEqual([]);
  }
});

test('a list addressed to you is kept, even when Claude speaks first or most lines are notes', () => {
  const blocked = `I can't change that setting for you, so on your side:
1. Open System Settings.
2. Select Didja and remove it.`;
  expect(extractChecklists(blocked)[0]!.items.length).toBe(2);

  const mostlyNotes = `Things you should do:
1. The recorder is still running in its own tab.
2. Stop the old engine tab.
3. The token line is no longer needed.`;
  expect(extractChecklists(mostlyNotes)[0]!.items.map((i) => i.title)).toEqual(['Stop the old engine tab.']);
});

test('conditions in front of an instruction do not hide it', () => {
  const text = `1. If there is no app value: set the colour yourself
2. Once that returns JSON, restart the engine
3. The same setting is also in the app designer
4. Close the tab and open it again, then hard-reload`;
  expect(extractChecklists(text)[0]!.items.map((i) => i.position)).toEqual([1, 2, 4]);
});

test('listActor', () => {
  expect(listActor('Before this works in prod you need to:')).toBe('you');
  expect(listActor('On your side:')).toBe('you');
  expect(listActor("I've added the endpoint. Next I'll:")).toBe('assistant');
  expect(listActor('Verified')).toBe('assistant');
  expect(listActor('Next steps')).toBeNull();
  expect(listActor('What Orbit writes')).toBe('assistant');
  expect(listActor('What you need to do')).toBe('you');
  expect(listActor('Run `you` to see who is logged in, then I mean nothing')).toBeNull();
  expect(listActor(null)).toBeNull();
});

test('each list in a message gets its own lead-in', () => {
  const text = `Claude responded: x
Order of work
1. Add a colour setting to the schema.
2. Run the tests and update the docs.
Quick terminal check
1. Run \`git --version\` in Ghostty.
2. Run \`node --version\` in Ghostty.
I will do these next:
1. Tidy the README.
2. Add a test for the panel.`;
  expect(extractChecklists(text, { claudeOnly: true }).map((l) => [l.title, l.actor])).toEqual([
    ['Order of work', null],
    ['Quick terminal check', null],
  ]);
});

// --- whose message a list is in, from the capture layer's section lines

test('a reply with no "Claude responded:" label is still Claude\'s, because it is not your message', () => {
  const text = `⟦Message 40⟧
give me a checklist on how to check it
You said: give me a checklist on how to check it
Just now
⟦Message 41⟧
Ran 3 commands
Here is what you do:
1. Wait about 20 seconds, then open the panel.
2. Run \`git --version\` in Ghostty.`;
  const lists = extractChecklists(text, { claudeOnly: true });
  expect(lists.map((l) => [l.title, l.actor, l.items.length])).toEqual([['Here is what you do', 'you', 2]]);
});

test('a list in your own message is skipped wherever its label sits', () => {
  const text = `⟦Message 1⟧
Steps:
1. Create a private GitHub repo
2. Write the README
You said: Steps: 1. Create a private GitHub repo 2. Write the…
⟦Message 2⟧
Claude responded: Done.
Two things left for you:
1. Set the key in Vercel
2. Run the migration`;
  expect(extractChecklists(text, { claudeOnly: true }).map((l) => l.title)).toEqual(['Two things left for you']);
});

test('new lines of an older message arrive under its section line and keep its author', () => {
  const text = `⟦Message 1⟧
You said: do it
⟦Message 2⟧
Order of work
1. Add the schema
⟦Message 1⟧
1. Create a private GitHub repo
2. Write the README
⟦Message 2⟧
2. Run the tests`;
  // Message 1 is yours both times it appears; message 2's list is split by the interruption.
  expect(extractChecklists(text, { claudeOnly: true })).toEqual([]);
  expect(extractChecklists(text.replace('⟦Message 1⟧\n1. Create a private GitHub repo\n2. Write the README\n⟦Message 2⟧\n', ''), { claudeOnly: true }).length).toBe(1);
});

// --- what the text after a list says about it

const PLAN_WITH_OFFER = `⟦Message 35⟧
Claude responded: Two steps, in this order:
Two steps, in this order:
1. Fix the three flaws from the live run (small, all in code that Milestone 2 builds on):
  • Titles cut off at file links.
2. Milestone 2 — exact-marker completion:
  • Pull markers out of each task at capture time.
  • Log evidence for every tick.
The first fix matters most for Milestone 2.
On your side, just keep working normally. Say “go” and I’ll do the fixes and start Milestone 2.`;

test('a list followed by Claude offering to do it is Claude\'s plan, not yours', () => {
  expect(extractChecklists(PLAN_WITH_OFFER, { claudeOnly: true })).toEqual([]);
  const [plan] = extractChecklists(PLAN_WITH_OFFER, { claudeOnly: true, includeAssistant: true });
  expect(plan!.actor).toBe('assistant');
  expect(plan!.after[0]).toBe('The first fix matters most for Milestone 2.');
});

test('a list followed by Claude waiting for you stays yours', () => {
  const text = `Next steps
1. Set STRIPE_WEBHOOK_SECRET in Vercel prod
2. Run the migration
Tell me when that's done and I'll continue with the webhook handler.`;
  const [list] = extractChecklists(text);
  expect(list!.actor).toBeNull();
  expect(list!.after).toEqual(["Tell me when that's done and I'll continue with the webhook handler."]);
});

test('followUpActor', () => {
  expect(followUpActor(['Say "go" and I\'ll do the fixes.'])).toBe('assistant');
  expect(followUpActor(['Want me to start with the first one?'])).toBe('assistant');
  expect(followUpActor(['Shall I go ahead?'])).toBe('assistant');
  expect(followUpActor(["Once you've done that, say go and I'll deploy."])).toBeNull();
  expect(followUpActor(['Let me know how it goes.'])).toBeNull();
  expect(followUpActor([])).toBeNull();
});

// --- putting a window back together from its observations

test('a reply that streams in over several observations reads as one list', () => {
  const pieces = [
    '⟦Message 4⟧\ngive me the steps\nYou said: give me the steps',
    '⟦Currently streaming message⟧\nOn your side:\n1. Set the key in Vercel',
    'Capturing · 12 observations', // something else on screen changed
    '⟦Currently streaming message⟧\n2. Run the migration',
    '⟦Message 4⟧\nJust now\n⟦Currently streaming message⟧\n3. Check the login flow works',
  ];
  const text = assemble(pieces);
  expect(text.split('\n')).toEqual([
    'Capturing · 12 observations',
    '⟦Message 4⟧', 'give me the steps', 'You said: give me the steps', 'Just now',
    '⟦Currently streaming message⟧', 'On your side:', '1. Set the key in Vercel', '2. Run the migration', '3. Check the login flow works',
  ]);
  const lists = extractChecklists(text, { claudeOnly: true });
  expect(lists.map((l) => [l.title, l.items.length])).toEqual([['On your side', 3]]);
});

test('text with no sections is left in the order it arrived', () => {
  expect(assemble(['$ npm test', '1. Run the build\n2. Push it'])).toBe('$ npm test\n1. Run the build\n2. Push it');
});

test('Claude Code and claude.ai are named after the product, so they group and focus as Claude', () => {
  expect(sourceRef({ app: 'Ghostty', windowTitle: '✳ Fix auth redirect' }, 'claude-code')).toBe('Claude Code — Fix auth redirect (Ghostty)');
  expect(sourceRef({ app: 'Ghostty', windowTitle: '✳ Claude Code' }, 'claude-code')).toBe('Claude Code (Ghostty)');
  expect(sourceRef({ app: 'Microsoft Edge', windowTitle: 'Stripe webhooks - Claude' }, 'claude-web')).toBe('Claude — Stripe webhooks');
  expect(sourceRef({ app: 'Google Chrome', windowTitle: 'Claude' }, 'claude-web')).toBe('Claude');
  expect(sourceRef({ app: 'Claude', windowTitle: 'Billing' }, 'claude-desktop')).toBe('Claude — Billing');

  expect(renamedSource('claude-code', 'Ghostty — Fix auth redirect')).toBe('Claude Code — Fix auth redirect (Ghostty)');
  expect(renamedSource('claude-code', 'Claude Code — Fix auth redirect (Ghostty)')).toBeNull();
  expect(renamedSource('claude-web', 'Microsoft Edge — Billing - Claude')).toBe('Claude — Billing');
  expect(renamedSource('claude-web', 'Claude — Billing')).toBeNull();
  expect(renamedSource('claude-desktop', 'Claude — Billing')).toBeNull();
  expect(renamedSource('email', 'Gmail')).toBeNull();
});
