import { expect, test } from 'bun:test';
import { formatWhy } from '../src/cli.ts';
import { accountOf, isMine, followsLink, mailLinks, unwrapLink, forwardOf, mailKey, signedName, mailOrigin, mailSnippet, baseSubject, isAutomatic, isRecent, isReply, mailSource, mailTaskTitle, parseEmails, sameMatter } from '../src/email.ts';
import type { MailReader, MailVerdict } from '../src/email.ts';
import { pollOnce } from '../src/engine.ts';
import { Store } from '../src/store.ts';

const NOW = new Date('2026-11-10T10:05:00Z');
const mail = (subject: string, from: string, body: string, date = 'Today at 11:58') =>
  `Inbox\nSent Items\n⟦Email⟧\nSubject: ${subject}\nFrom: ${from}\nDate: ${date}\nTo: me@example.com\n${body}`;
const ASK = mail('Q3 budget numbers', 'Dana Levi, dana@acme.com', 'Hi Mike,\nCan you send me the updated Q3 numbers by Thursday?\nThanks, Dana');

function outlook(store: Store, text: string, ts = '2026-11-10T10:00:00.000Z'): number {
  return store.insertObservation({
    ts, bundleId: 'com.microsoft.Outlook', app: 'Microsoft Outlook', windowTitle: 'Inbox • me@example.com', url: null, source: 'ax', text,
  });
}
const REPLY: MailVerdict = { need: 'reply', task: 'Send Dana the updated Q3 numbers' };
const NONE: MailVerdict = { need: 'none', task: 'none' };
function reader(answer: MailVerdict | null) {
  const asked: Parameters<MailReader>[0][] = [];
  const mailReader: MailReader = (email) => { asked.push(email); return answer; };
  return { mailReader, asked };
}

test('an open email is read from its section', () => {
  const [email] = parseEmails(ASK);
  expect(email).toEqual({
    subject: 'Q3 budget numbers', from: 'Dana Levi, dana@acme.com', fromName: 'Dana Levi', fromAddress: 'dana@acme.com',
    to: 'me@example.com', date: 'Today at 11:58',
    body: ['Hi Mike,', 'Can you send me the updated Q3 numbers by Thursday?', 'Thanks, Dana'],
  });
  expect(parseEmails('Inbox\nSubject: not in an email section\nFrom: x')).toEqual([]);
});

test('body lines that arrive later join the email they belong to; another subject starts another email', () => {
  const text = `${mail('First', 'A B, a@x.com', 'Line one')}\n⟦Email⟧\nLine two\n⟦Email⟧\nSubject: Second\nFrom: C D, c@x.com\nBody`;
  expect(parseEmails(text).map((e) => [e.subject, e.body])).toEqual([['First', ['Line one', 'Line two']], ['Second', ['Body']]]);
});

test('a quoted header further down the thread does not replace the real sender', () => {
  const text = mail('Re: Budget', 'Mike, me@example.com', 'Attached.\nFrom: dana@acme.com <dana@acme.com>Sent: Monday\nTo: me@example.com\nCan you send the numbers?');
  const [email] = parseEmails(text);
  expect(email!.fromAddress).toBe('me@example.com');
  expect(email!.to).toBe('me@example.com');
  expect(email!.body).toEqual(['Attached.', 'From: dana@acme.com <dana@acme.com>Sent: Monday', 'To: me@example.com', 'Can you send the numbers?']);
});

test('subjects, replies, automatic mail and dates', () => {
  expect(baseSubject('RE: Fwd: Q3 budget  numbers')).toBe('q3 budget numbers');
  expect(isReply('Re: Q3')).toBe(true);
  expect(isReply('Fwd: Q3')).toBe(false);
  expect(isReply('Regarding Q3')).toBe(false);
  const of = (subject: string, from: string, body = 'x') => parseEmails(mail(subject, from, body))[0]!;
  expect(isAutomatic(of('Your receipt from Vercel Inc.', 'Stripe, receipts@stripe.com'))).toBe(true);
  expect(isAutomatic(of('Invitation: Sprint review', 'Ron Avital, ron@acme.com'))).toBe(true);
  expect(isAutomatic(of('Weekly digest', 'Acme, hi@acme.com', 'Lots of news\nUnsubscribe'))).toBe(true);
  expect(isAutomatic(of('[acme/shop] PR merged', 'GitHub, noreply@github.com'))).toBe(true);
  expect(isAutomatic(of('Q3 budget numbers', 'Dana Levi, dana@acme.com'))).toBe(false);
  expect(isRecent('Today at 11:58', NOW)).toBe(true);
  expect(isRecent('Yesterday at 09:10', NOW)).toBe(true);
  expect(isRecent('3 October 2026 at 10:00', NOW)).toBe(false);
  expect(isRecent(null, NOW)).toBe(false);
});

test('an email whose sender is waiting becomes a task that says what to send', () => {
  const store = new Store(':memory:');
  const { mailReader, asked } = reader(REPLY);
  outlook(store, ASK);
  expect(pollOnce(store, NOW, { mailReader }).emails).toBe(1);
  const [task] = store.listTasks();
  expect(task).toMatchObject({ title: 'Send Dana the updated Q3 numbers', sourceKind: 'email', sourceRef: 'Microsoft Outlook', auto: false });
  expect(asked).toEqual([{ from: 'Dana Levi', subject: 'Q3 budget numbers', body: 'Hi Mike,\nCan you send me the updated Q3 numbers by Thursday?\nThanks, Dana' }]);
  const why = formatWhy(task!, store.listEvidence(task!.id));
  expect(why).toContain('you are asked to confirm');
  expect(why).toContain('From an email: Dana Levi — “Q3 budget numbers”');
  // Looking at the same email again asks nothing and adds nothing.
  outlook(store, 'Focused\nOther', '2026-11-10T10:01:00.000Z');
  expect(pollOnce(store, NOW, { mailReader }).emails).toBe(0);
  expect(asked.length).toBe(1);
  store.close();
});

test('the model is not asked about automatic mail, old mail, or mail with nothing to read', () => {
  const store = new Store(':memory:');
  const { mailReader, asked } = reader(REPLY);
  outlook(store, mail('Your receipt from Vercel Inc.', 'Stripe, receipts@stripe.com', 'Amount paid $20.00'));
  outlook(store, mail('Old question', 'Dana Levi, dana@acme.com', 'Can you check this?', '3 October 2026 at 10:00'), '2026-11-10T10:00:10.000Z');
  outlook(store, '⟦Email⟧\nSubject: Still loading\nFrom: Dana Levi, dana@acme.com\nDate: Today at 12:00', '2026-11-10T10:00:20.000Z');
  expect(pollOnce(store, NOW, { mailReader }).emails).toBe(0);
  expect(asked).toEqual([]);
  store.close();
});

test('an email that only informs makes no task', () => {
  const store = new Store(':memory:');
  outlook(store, mail('FYI: pricing page is live', 'Yossi Cohen, yossi@acme.com', 'Just letting you know it went live.'));
  expect(pollOnce(store, NOW, { mailReader: reader(NONE).mailReader }).emails).toBe(0);
  expect(store.listTasks()).toEqual([]);
  store.close();
});

test('your reply in that conversation asks you to confirm; a further mail from the sender does not', () => {
  const store = new Store(':memory:');
  const { mailReader } = reader(REPLY);
  outlook(store, ASK);
  pollOnce(store, NOW, { mailReader });

  outlook(store, mail('Re: Q3 budget numbers', 'Dana Levi, dana@acme.com', 'Any news on this?'), '2026-11-10T10:01:00.000Z');
  expect(pollOnce(store, NOW, { mailReader: reader(NONE).mailReader }).suggested).toBe(0);

  outlook(store, mail('RE: Q3 budget numbers', 'Mike, me@example.com', 'Attached, sorry for the delay.'), '2026-11-10T10:02:00.000Z');
  expect(pollOnce(store, NOW, { mailReader: reader(NONE).mailReader }).suggested).toBe(1);
  const task = store.getTask(1)!;
  expect(task.status).toBe('open'); // asked, never ticked
  expect(task.suggestion).toBe('Microsoft Outlook — a reply in “RE: Q3 budget numbers”');
  store.setStatus(1, 'done');
  expect(store.getTask(1)).toMatchObject({ status: 'done', suggestion: null });
  store.close();
});

test('mail on screen never ticks or suggests ordinary tasks, and without a model no email becomes a task', () => {
  const store = new Store(':memory:');
  store.insertObservation({ ts: '2026-11-10T09:59:00.000Z', bundleId: 'com.anthropic.claudefordesktop', app: 'Claude', windowTitle: 'W', url: null, source: 'ax',
    text: 'Claude responded: x\nOn your side:\n1. Run `supabase db push`\n2. Send the updated budget numbers to Dana' });
  pollOnce(store, NOW);
  let looked = 0;
  outlook(store, mail('Budget', 'Dana Levi, dana@acme.com', 'me % supabase db push\nSend the updated budget numbers to Dana, done'));
  const stats = pollOnce(store, NOW, { looker: () => { looked++; return 'done'; } });
  expect(stats).toMatchObject({ completed: 0, suggested: 0, emails: 0 });
  expect(looked).toBe(0);
  store.close();
});

test('an email that asks for something done elsewhere becomes that task, not "Reply to…"', () => {
  const store = new Store(':memory:');
  const verdict: MailVerdict = { need: 'action', task: 'Update card details on PayPal.' };
  outlook(store, mail('Update your card information for PayPal', 'service@paypal.com', 'Your card is about to expire.\nUpdate it to keep paying with PayPal.'));
  expect(pollOnce(store, NOW, { mailReader: reader(verdict).mailReader }).emails).toBe(1);
  const [task] = store.listTasks();
  expect(task).toMatchObject({ title: 'Update card details on PayPal', sourceKind: 'email', criteria: null });
  // Nobody is waiting for an answer, so mail in that conversation suggests nothing.
  expect(store.repliesAwaited()).toEqual([]);
  outlook(store, mail('Re: Update your card information for PayPal', 'Mike, me@example.com', 'Done.'), '2026-11-10T10:01:00.000Z');
  expect(pollOnce(store, NOW, { mailReader: reader(NONE).mailReader }).suggested).toBe(0);
  // It is watched like any task with nothing exact to match.
  expect(store.tasksToWatch().map((t) => t.id)).toEqual([task!.id]);
  store.close();
});

test('the model\'s wording is used when it says what to do, and the sender and subject otherwise', () => {
  const [email] = parseEmails(ASK);
  const title = (task: string) => mailTaskTitle(email!, { need: 'reply', task });
  expect(title('"Pick an interview time for Noa."')).toBe('Pick an interview time for Noa');
  expect(title('Send the numbers\nBecause Dana asked')).toBe('Send the numbers');
  for (const useless of ['', 'none', 'Reply', 'Reply to the email', 'x'.repeat(120)]) {
    expect(title(useless)).toBe('Reply to Dana Levi: Q3 budget numbers');
  }
});

test('a section that names its email starts that email; the rest of the page is not its body', () => {
  const text = 'Inbox\n⟦Email: Q3 budget numbers⟧\nFrom: Dana Levi, dana@acme.com\nDate: Today at 11:58\nCan you send the numbers?\n⟦Page⟧\nCompose\nStarred';
  expect(parseEmails(text).map((e) => [e.subject, e.fromName, e.body])).toEqual([['Q3 budget numbers', 'Dana Levi', ['Can you send the numbers?']]]);
});

const GMAIL = { bundleId: 'com.microsoft.edgemac', app: 'Microsoft Edge', windowTitle: 'Q3 budget numbers - Gmail', url: 'https://mail.google.com/mail/u/0/#inbox/abc', source: 'ax' as const };
const message = (n: number, from: string, to: string, body: string, date = '15:05 (12 minutes ago)') =>
  `⟦Email ${n}: Q3 budget numbers⟧\nFrom: ${from}\nDate: ${date}\nTo: ${to}\n${body}\n⟦Page⟧\nReply\nForward`;

test('mail is recognised by app or by site', () => {
  expect(mailSource(GMAIL)).toBe('Gmail');
  expect(mailSource({ bundleId: 'com.microsoft.Outlook', app: 'Microsoft Outlook', url: null })).toBe('Microsoft Outlook');
  expect(mailSource({ ...GMAIL, url: 'https://example.com/?next=https://mail.google.com/' })).toBeNull();
  expect(isRecent('Mon 9 Nov, 15:05 (2 hours ago)', NOW)).toBe(true);
  expect(isRecent('9 Nov 2026, 10:00 (1 day ago)', NOW)).toBe(true);
  expect(isRecent('2 Nov 2026, 10:00 (8 days ago)', NOW)).toBe(false);
});

test('Gmail: each message of a thread is read by itself, and your answer below asks to confirm', () => {
  const store = new Store(':memory:');
  const { mailReader, asked } = reader(REPLY);
  store.insertObservation({ ...GMAIL, ts: '2026-11-10T10:00:00.000Z', text: message(1, 'Dana Levi', 'to me', 'Can you send me the updated Q3 numbers?') });
  expect(pollOnce(store, NOW, { mailReader }).emails).toBe(1);
  expect(store.listTasks()[0]).toMatchObject({ title: 'Send Dana the updated Q3 numbers', sourceRef: 'Gmail' });
  expect(asked[0]!.body).toBe('Can you send me the updated Q3 numbers?');

  // Dana again: nothing. Then your own message in the thread.
  store.insertObservation({ ...GMAIL, ts: '2026-11-10T10:01:00.000Z', text: message(2, 'Dana Levi', 'to me', 'Any news?') });
  expect(pollOnce(store, NOW, { mailReader: reader(NONE).mailReader }).suggested).toBe(0);
  const mine = reader(REPLY);
  store.insertObservation({ ...GMAIL, ts: '2026-11-10T10:02:00.000Z', text: message(3, 'Mike Rosen', 'to Dana', 'Attached. Can you confirm you got it?') });
  const stats = pollOnce(store, NOW, { mailReader: mine.mailReader });
  expect(stats).toMatchObject({ suggested: 1, emails: 0 });
  expect(mine.asked).toEqual([]); // your own message is not a request to you
  expect(store.getTask(1)).toMatchObject({ status: 'open', suggestion: 'Gmail — a reply in “Q3 budget numbers”' });
  store.close();
});

test('Gmail on screen never ticks ordinary tasks', () => {
  const store = new Store(':memory:');
  store.insertObservation({ ts: '2026-11-10T09:59:00.000Z', bundleId: 'com.anthropic.claudefordesktop', app: 'Claude', windowTitle: 'W', url: null, source: 'ax',
    text: 'Claude responded: x\nOn your side:\n1. Run `supabase db push`' });
  pollOnce(store, NOW);
  store.insertObservation({ ...GMAIL, ts: '2026-11-10T10:00:00.000Z', text: message(1, 'Dana Levi', 'to me', 'me % supabase db push') });
  expect(pollOnce(store, NOW).completed).toBe(0);
  store.close();
});

test('the presence Outlook reads out after a name is not part of the name', () => {
  const of = (from: string) => parseEmails(mail('S', from, 'x'))[0]!.fromName;
  expect(of('Shweta Jain Available, shweta@acme.com')).toBe('Shweta Jain');
  expect(of('Ron Avital Do not disturb, ron@acme.com')).toBe('Ron Avital');
  expect(of('Dana Away, dana@acme.com')).toBe('Dana');
  expect(of('Away Team, crew@acme.com')).toBe('Away Team');
});

test('an email task titled the old way is reworded when the email is read again, not doubled', () => {
  const store = new Store(':memory:');
  outlook(store, ASK);
  // As it was made before: the model gave no wording, so the title is the fallback.
  pollOnce(store, NOW, { mailReader: reader({ need: 'reply', task: '' }).mailReader });
  expect(store.listTasks().map((t) => t.title)).toEqual(['Reply to Dana Levi: Q3 budget numbers']);

  // The question changed: the email is asked about again when it is next on screen.
  store.setMeta('email_checks_version', '1');
  outlook(store, ASK, '2026-11-10T10:03:00.000Z');
  pollOnce(store, NOW, { mailReader: reader(REPLY).mailReader });
  const tasks = store.listTasks();
  expect(tasks.map((t) => t.title)).toEqual(['Send Dana the updated Q3 numbers']);
  expect(tasks[0]!.criteria?.reply?.subject).toBe('q3 budget numbers'); // still waits for the same reply
  expect(formatWhy(tasks[0]!, store.listEvidence(tasks[0]!.id))).toContain('From an email: Dana Levi');
  store.close();
});

test('an email task titled the old way that you already finished or dismissed is not made again when the email is read again', () => {
  // Seen on real mail: "Reply to service@paypal.com: Update your card information
  // for PayPal" was ticked, and when the email was asked about again it came back
  // as a second task, "Update card details on PayPal".
  for (const status of ['done', 'dismissed'] as const) {
    const store = new Store(':memory:');
    // Made before emails were linked to their tasks: nothing ties it to the email but its title.
    const id = store.upsertTask({ title: 'Reply to Dana Levi: Q3 budget numbers', sourceKind: 'email', sourceRef: 'Microsoft Outlook', confidence: 1,
      position: null, ts: '2026-11-10T09:00:00.000Z', observationId: null, markers: [], criteria: null }).id;
    store.setStatus(id, status);

    outlook(store, ASK, '2026-11-10T10:03:00.000Z');
    expect(pollOnce(store, NOW, { mailReader: reader(REPLY).mailReader }).emails).toBe(0);
    expect(store.listTasks({ all: true }).map((t) => [t.title, t.status])).toEqual([['Reply to Dana Levi: Q3 budget numbers', status]]);

    // Another email with another subject still becomes a task.
    outlook(store, mail('Q4 plan', 'Dana Levi, dana@acme.com', 'Can you send me the Q4 plan?'), '2026-11-10T10:04:00.000Z');
    expect(pollOnce(store, NOW, { mailReader: reader({ need: 'reply', task: 'Send Dana the Q4 plan' }).mailReader }).emails).toBe(1);
    store.close();
  }
});

test('a forwarded email names who wrote the request, not who passed it on', () => {
  const gmail = parseEmails('⟦Email 1: Fwd: New contract⟧\nFrom: Shira Bar\nDate: 15:05 (12 minutes ago)\nTo: to me\n' + (
    '---------- Forwarded message ---------\nFrom: School Office <office@school.org>\nDate: Mon, 9 Nov 2026\nSubject: New contract\nHello,\nPlease send the new contract and the insurance.\nThanks,\nTamar'))[0]!;
  expect(forwardOf(gmail)).toEqual({ forwarded: true, writtenBy: 'School Office' });
  expect(gmail.body.at(-1)).toBe('Tamar'); // the quoted Subject: line does not cut the message short
  expect(mailSnippet(gmail)).toMatchObject({ from: 'Shira Bar', forwarded: true, writtenBy: 'School Office' });
  // The signature is the model's to read; its answer wins over the quoted header.
  expect(mailOrigin(gmail, 'Tamar')).toBe('From an email: forwarded by Shira Bar, written by Tamar — “Fwd: New contract”');
  expect(mailOrigin(gmail)).toBe('From an email: forwarded by Shira Bar, written by School Office — “Fwd: New contract”');

  // The model named the forwarder in the task: the title is put right.
  expect(mailTaskTitle(gmail, { need: 'reply', task: 'Send Shira the new school contract', asker: 'Tamar' })).toBe('Send Tamar the new school contract');
  expect(mailTaskTitle(gmail, { need: 'reply', task: 'Send Shira Bar the contract', asker: 'Tamar' })).toBe('Send Tamar the contract');
  expect(mailTaskTitle(gmail, { need: 'reply', task: 'Send Shirah the contract', asker: 'Tamar' })).toBe('Send Shirah the contract');
  expect(mailTaskTitle(gmail, { need: 'reply', task: 'Send Shira the contract' })).toBe('Send Shira the contract');
  expect(mailTaskTitle(parseEmails(ASK)[0]!, { need: 'reply', task: 'Send Dana the numbers', asker: 'Tamar' })).toBe('Send Dana the numbers');

  const outlookStyle = parseEmails(mail('FW: Invoice', 'Ron Avital, ron@acme.com', 'See below.\nFrom: Dana Levi <dana@acme.com>Sent: Monday, 9 November\nTo: Ron\nCan you approve this invoice?'))[0]!;
  expect(forwardOf(outlookStyle)).toEqual({ forwarded: true, writtenBy: 'Dana Levi' });

  const plain = parseEmails(ASK)[0]!;
  expect(forwardOf(plain)).toEqual({ forwarded: false, writtenBy: null });
  expect(mailSnippet(plain)).toEqual({ from: 'Dana Levi', subject: 'Q3 budget numbers', body: 'Hi Mike,\nCan you send me the updated Q3 numbers by Thursday?\nThanks, Dana' });
  expect(mailOrigin(plain, 'Dana')).toBe('From an email: Dana Levi — “Q3 budget numbers”');
});

test('a service address is never waited on for a reply', () => {
  const store = new Store(':memory:');
  outlook(store, mail('Update your card information for PayPal', 'service@paypal.com', 'Please log in and update your card details.'));
  pollOnce(store, NOW, { mailReader: reader({ need: 'reply', task: 'Update card details on PayPal' }).mailReader });
  expect(store.listTasks()[0]).toMatchObject({ title: 'Update card details on PayPal', criteria: null });
  store.close();
});

test('an email is known by sender, subject and time, however the date is worded', () => {
  const at = (date: string) => mailKey(parseEmails(mail('Q3', 'Dana Levi, dana@acme.com', 'x', date))[0]!);
  expect(at('15:05 (12 minutes ago)')).toBe(at('15:05 (3 hours ago)'));
  expect(at('Today at 15:05')).toBe(at('Yesterday at 15:05'));
  expect(at('15:05 (12 minutes ago)')).not.toBe(at('16:05 (12 minutes ago)'));
  expect(mailKey(parseEmails(mail('Q3', 'Ron, ron@acme.com', 'x'))[0]!)).not.toBe(mailKey(parseEmails(mail('Q3', 'Dana, dana@acme.com', 'x'))[0]!));
});

test('a signature the model cut short is completed from the message', () => {
  const email = parseEmails(mail('S', 'Shira, n@x.com', 'אבקש לשלוח חוזה\nתודה רבה\nתמר -מנה"ח\nבברכה'))[0]!;
  expect(signedName(email, 'תמר- מנה')).toBe('תמר -מנה"ח');
  expect(signedName(email, 'Dana')).toBe('Dana');
  expect(signedName(email, undefined)).toBeUndefined();
});

test('a signature the model joined to the full name is completed from the message', () => {
  const email = parseEmails(mail('S', 'Noa Katz, r@x.com', 'נא לחתום על טופס 101\nתודה,\nנועה - מש"א'))[0]!;
  expect(signedName(email, 'נועה כץ - מש')).toBe('נועה - מש"א');
  // A different first name, or a role that does not start the same way, is left as the model gave it.
  expect(signedName(email, 'מיכל כץ - מש')).toBe('מיכל כץ - מש');
  expect(signedName(email, 'נועה כץ - כספים')).toBe('נועה כץ - כספים');
  expect(signedName(email, 'נועה - מש"א')).toBe('נועה - מש"א');
});

test('reading an email again as it loads rewords its one task, and a task you finished stays finished', () => {
  const store = new Store(':memory:');
  const short = mail('Contract', 'Dana Levi, dana@acme.com', 'Hi,');
  const full = `${short}\n⟦Email⟧\nPlease send the signed contract by Friday.`;
  outlook(store, short);
  pollOnce(store, NOW, { mailReader: reader({ need: 'reply', task: 'Answer Dana about the contract', asker: 'Dana' }).mailReader });
  outlook(store, full, '2026-11-10T10:01:00.000Z');
  expect(pollOnce(store, NOW, { mailReader: reader({ need: 'reply', task: 'Send Dana the signed contract', asker: 'Dana' }).mailReader }).emails).toBe(0);
  expect(store.listTasks().map((t) => t.title)).toEqual(['Send Dana the signed contract']);
  expect(store.listEvidence(1).filter((e) => e.kind === 'origin').length).toBe(1);

  store.setStatus(1, 'done');
  outlook(store, `${full}\n⟦Email⟧\nThanks!`, '2026-11-10T10:02:00.000Z');
  pollOnce(store, NOW, { mailReader: reader({ need: 'reply', task: 'Mail the contract to Dana', asker: 'Dana' }).mailReader });
  expect(store.getTask(1)).toMatchObject({ title: 'Send Dana the signed contract', status: 'done' });
  expect(store.getTask(2)).toBeNull();
  store.close();
});

test('a task made before emails were linked is found by the subject in its note', () => {
  const store = new Store(':memory:');
  const id = store.upsertTask({ title: 'Send Shira the contract', sourceKind: 'email', sourceRef: 'Microsoft Outlook', confidence: 1, position: null,
    ts: '2026-11-10T09:00:00.000Z', observationId: null, markers: [], criteria: null }).id;
  store.addNote(id, 'origin', '2026-11-10T09:00:00.000Z', 'From an email: Dana Levi — “Q3 budget numbers”');
  outlook(store, ASK);
  pollOnce(store, NOW, { mailReader: reader(REPLY).mailReader });
  expect(store.listTasks().map((t) => t.title)).toEqual(['Send Dana the updated Q3 numbers']);
  store.close();
});

test('Outlook on the web is mail, with its own way of writing dates', () => {
  const OWA = { bundleId: 'com.microsoft.edgemac', app: 'Microsoft Edge', windowTitle: 'Mail - Outlook', url: 'https://outlook.cloud.microsoft/mail/inbox/id/AAA', source: 'ax' as const };
  expect(mailSource(OWA)).toBe('Outlook on the web');
  expect(mailSource({ ...OWA, url: 'https://outlook.office.com/mail/' })).toBe('Outlook on the web');
  expect(mailSource({ ...OWA, url: 'https://outlook.office.com.evil.test/mail/' })).toBeNull();
  expect(isRecent('Mon 11/9/2026 9:15 AM', NOW)).toBe(true);
  expect(isRecent('Mon 9/11/2026 09:15', NOW)).toBe(true); // day first
  expect(isRecent('Fri 10/2/2026 9:15 AM', NOW)).toBe(false);
  expect(isRecent('Thu 3/9/2026 9:15 AM', NOW)).toBe(false);

  const store = new Store(':memory:');
  store.insertObservation({ ...OWA, ts: '2026-11-10T10:00:00.000Z',
    text: 'Inbox\n⟦Email 1: Q3 budget numbers⟧\nFrom: Dana Levi\nTo: Mike\nDate: Mon 11/9/2026 9:15 AM\nCan you send me the updated Q3 numbers?\n⟦Page⟧\nReply\nForward' });
  const { mailReader, asked } = reader(REPLY);
  expect(pollOnce(store, NOW, { mailReader }).emails).toBe(1);
  expect(asked[0]).toEqual({ from: 'Dana Levi', subject: 'Q3 budget numbers', body: 'Can you send me the updated Q3 numbers?' });
  expect(store.listTasks()[0]).toMatchObject({ title: 'Send Dana the updated Q3 numbers', sourceRef: 'Outlook on the web' });
  store.close();
});

test('the account a mail window belongs to is read from its title, and only from its exact shape', () => {
  const MAC = { bundleId: 'com.microsoft.Outlook', windowTitle: 'Inbox • me@example.com' };
  expect(accountOf(MAC, 'Microsoft Outlook')).toEqual({ addresses: ['me@example.com'], names: [] });
  // A message open in its own window is titled with its subject: an address there is not yours.
  expect(accountOf({ ...MAC, windowTitle: 'Question from dana@acme.com' }, 'Microsoft Outlook')).toEqual({ addresses: [], names: [] });
  const WEB = { bundleId: 'com.microsoft.edgemac', windowTitle: 'Mail - Mike Rosen - Outlook' };
  expect(accountOf(WEB, 'Outlook on the web')).toEqual({ addresses: [], names: ['Mike Rosen'] });
  expect(accountOf({ ...WEB, windowTitle: 'Inbox - Mike Rosen - Outlook - Microsoft Edge' }, 'Outlook on the web').names).toEqual(['Mike Rosen']);
  expect(accountOf({ ...WEB, windowTitle: 'Mail - me@example.com - Outlook' }, 'Outlook on the web').addresses).toEqual(['me@example.com']);
  expect(accountOf({ ...WEB, windowTitle: 'Mail - Outlook' }, 'Outlook on the web')).toEqual({ addresses: [], names: [] });
  // The same title in a window that is not Outlook on the web says nothing.
  expect(accountOf(WEB, 'Gmail')).toEqual({ addresses: [], names: [] });

  const [byAddress] = parseEmails(mail('Q3', 'Mike, me@example.com', 'x'));
  const [byName] = parseEmails('⟦Email 1: Q3⟧\nFrom: Mike Rosen\nx');
  const me = { addresses: ['me@example.com'], names: ['Mike Rosen'] };
  expect(isMine(byAddress!, me)).toBe(true);
  expect(isMine(byName!, me)).toBe(true);
  // Where an address is shown, the address decides, not the name.
  expect(isMine(parseEmails(mail('Q3', 'Mike Rosen, mike@example.org', 'x'))[0]!, me)).toBe(false);
  expect(isMine(parseEmails(mail('Q3', 'Dana Levi, dana@acme.com', 'x'))[0]!, me)).toBe(false);
});

test('Outlook for Mac: a message you sent makes no task, and is still your reply', () => {
  const store = new Store(':memory:');
  const { mailReader, asked } = reader(REPLY);
  // You wrote to Dana asking for something: it reads like a request, but it is yours.
  outlook(store, mail('Logo files', 'Mike Rosen, me@example.com', 'Hi Dana,\nCan you send me the logo files by Friday?\nMike'));
  expect(pollOnce(store, NOW, { mailReader }).emails).toBe(0);
  expect(asked).toEqual([]);
  expect(store.listTasks()).toEqual([]);

  // Dana's request is a task; your answer to it asks you to confirm, and makes no task of its own.
  outlook(store, ASK, '2026-11-10T10:01:00.000Z');
  expect(pollOnce(store, NOW, { mailReader }).emails).toBe(1);
  outlook(store, mail('RE: Q3 budget numbers', 'Mike Rosen, me@example.com', 'Can you check the attached numbers?'), '2026-11-10T10:02:00.000Z');
  const stats = pollOnce(store, NOW, { mailReader });
  expect(stats).toMatchObject({ emails: 0, suggested: 1, completed: 0 });
  expect(store.listTasks().map((t) => [t.title, t.status, t.suggestion])).toEqual([
    ['Send Dana the updated Q3 numbers', 'open', 'Microsoft Outlook — a reply in “RE: Q3 budget numbers”'],
  ]);
  expect(asked.length).toBe(1);
  store.close();
});

test('Outlook for Mac: the account learned from the main window holds in a message window titled by its subject', () => {
  const store = new Store(':memory:');
  outlook(store, 'Inbox\nSent Items'); // the main window: "Inbox • me@example.com"
  pollOnce(store, NOW);
  const { mailReader, asked } = reader(REPLY);
  store.insertObservation({ ts: '2026-11-10T10:01:00.000Z', bundleId: 'com.microsoft.Outlook', app: 'Microsoft Outlook', windowTitle: 'Logo files', url: null, source: 'ax',
    text: mail('Logo files', 'Mike Rosen, me@example.com', 'Can you send me the logo files?') });
  expect(pollOnce(store, NOW, { mailReader }).emails).toBe(0);
  expect(asked).toEqual([]);
  store.close();
});

test('Outlook on the web: a message you sent makes no task, and is still your reply', () => {
  const OWA = { bundleId: 'com.microsoft.edgemac', app: 'Microsoft Edge', windowTitle: 'Mail - Mike Rosen - Outlook', url: 'https://outlook.cloud.microsoft/mail/inbox/id/AAA', source: 'ax' as const };
  const store = new Store(':memory:');
  const { mailReader, asked } = reader(REPLY);
  store.insertObservation({ ...OWA, ts: '2026-11-10T10:00:00.000Z',
    text: 'Inbox\n⟦Email 1: Logo files⟧\nFrom: Mike Rosen\nTo: Dana Levi\nDate: Mon 11/9/2026 9:15 AM\nCan you send me the logo files by Friday?' });
  expect(pollOnce(store, NOW, { mailReader }).emails).toBe(0);
  expect(asked).toEqual([]);

  store.insertObservation({ ...OWA, url: 'https://outlook.cloud.microsoft/mail/inbox/id/BBB', ts: '2026-11-10T10:01:00.000Z',
    text: 'Inbox\n⟦Email 1: Q3 budget numbers⟧\nFrom: Dana Levi\nTo: Mike Rosen\nDate: Mon 11/9/2026 9:15 AM\nCan you send me the updated Q3 numbers?' });
  expect(pollOnce(store, NOW, { mailReader }).emails).toBe(1);

  store.insertObservation({ ...OWA, url: 'https://outlook.cloud.microsoft/mail/inbox/id/BBB', ts: '2026-11-10T10:02:00.000Z',
    // Capture records only the lines that are new in the window.
    text: '⟦Email 2: RE: Q3 budget numbers⟧\nFrom: Mike Rosen\nTo: Dana Levi\nDate: Tue 11/10/2026 11:30 AM\nAttached. Can you confirm they look right?' });
  const stats = pollOnce(store, NOW, { mailReader });
  expect(stats).toMatchObject({ emails: 0, suggested: 1, completed: 0 });
  expect(store.listTasks().map((t) => [t.status, t.suggestion])).toEqual([['open', 'Outlook on the web — a reply in “RE: Q3 budget numbers”']]);
  expect(asked.length).toBe(1);
  store.close();
});

test('mail from someone else is still read once your account is known', () => {
  const store = new Store(':memory:');
  outlook(store, mail('Logo files', 'Mike Rosen, me@example.com', 'Can you send me the logo files?'));
  pollOnce(store, NOW, { mailReader: reader(REPLY).mailReader });
  // A colleague with your first name, at another address, is not you.
  outlook(store, mail('Budget', 'Mike Cohen, mike@acme.com', 'Can you send the budget?'), '2026-11-10T10:01:00.000Z');
  expect(pollOnce(store, NOW, { mailReader: reader(REPLY).mailReader }).emails).toBe(1);
  store.close();
});

const RECORD = 'https://pmo.crm.example.com/main.aspx?appid=0aeb7e36-f0a5-f011-bbd3-000000000001&pagetype=entityrecord&id=7e11c297-5de1-4965-a965-8c7c91ede6e0';
const APPROVAL = mail('Request REQ-1056 needs your approval', 'Omar Haddad, omar@acme.com',
  `Hi,\nPlease approve the project request here:\nhttps://urldefense.com/v3/__${RECORD}__;!!Abc123$\nThanks, Omar`);
const EDGE = { bundleId: 'com.microsoft.edgemac', app: 'Microsoft Edge', windowTitle: 'Project Request', source: 'ax' as const };

test('links are kept as the pages they point to, unwrapped, and only when they name one page', () => {
  expect(unwrapLink(`https://urldefense.com/v3/__${RECORD}__;!!Abc$`)).toBe(RECORD);
  expect(unwrapLink('https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Facme.com%2Forders%2F17&data=x')).toBe('https://acme.com/orders/17');
  const [email] = parseEmails(mail('S', 'Dana, dana@acme.com',
    `See ${RECORD}.\nOr https://paypal.com/ and https://acme.com/unsubscribe?u=1 and https://acme.com/orders/17, thanks`));
  expect(mailLinks(email!)).toEqual([RECORD, 'https://acme.com/orders/17']);

  expect(followsLink(`${RECORD}&forceUCI=1`, RECORD)).toBe(true);
  expect(followsLink(RECORD.replace('7e11c297', '11111111'), RECORD)).toBe(false); // another record
  expect(followsLink('https://pmo.crm.example.com/other.aspx?id=7e11c297-5de1-4965-a965-8c7c91ede6e0', RECORD)).toBe(false);
  expect(followsLink(RECORD.replace('pmo.crm.example.com', 'evil.test'), RECORD)).toBe(false);
  expect(followsLink('https://paypal.com/', 'https://paypal.com/')).toBe(false); // a front page proves nothing
  expect(followsLink(null, RECORD)).toBe(false);
});

function approvalTask(store: Store) {
  outlook(store, APPROVAL);
  pollOnce(store, NOW, { mailReader: reader({ need: 'reply', task: 'Approve project request REQ-1056', asker: 'Omar' }).mailReader });
  const task = store.listTasks()[0]!;
  expect(task.criteria?.links).toEqual([RECORD]);
  return task;
}
const page = (store: Store, ts: string, text: string, url = RECORD) => store.insertObservation({ ...EDGE, ts, url, text });

test('opening the email\'s link and then seeing it done there ticks the task', () => {
  const store = new Store(':memory:');
  const task = approvalTask(store);
  const seen: string[] = [];
  const looker = (input: { text: string }) => { seen.push(input.text); return input.text.includes('Approved') ? 'done' as const : 'notDone' as const; };

  // Arriving: the request, with its buttons. Nothing is ticked.
  page(store, '2026-11-10T10:01:00.000Z', 'Project Request REQ-1056\nStatus: Pending\nApprove\nReject');
  expect(pollOnce(store, NOW, { looker })).toMatchObject({ completed: 0, suggested: 0 });
  // Half a minute later the page says it is approved.
  page(store, '2026-11-10T10:01:30.000Z', 'Request REQ-1056\nStatus: Approved\nYour approval was recorded');
  expect(pollOnce(store, NOW, { looker })).toMatchObject({ completed: 1, suggested: 0 });
  expect(store.getTask(task.id)!.status).toBe('done');
  expect(formatWhy(store.getTask(task.id)!, store.listEvidence(task.id))).toContain('you opened the link from the email, and the page then showed it done (Microsoft Edge — pmo.crm.example.com/main.aspx)');
  expect(seen.length).toBe(2);
  store.close();
});

test('it does not tick on arrival, on another record, on a page that only looks the same, or when the model is unsure', () => {
  const done = () => 'done' as const;

  // Done-looking the moment you arrive: you may only be reading it. Asks instead.
  let store = new Store(':memory:');
  let task = approvalTask(store);
  page(store, '2026-11-10T10:01:00.000Z', 'Request REQ-1056\nStatus: Approved');
  expect(pollOnce(store, NOW, { looker: done })).toMatchObject({ completed: 0, suggested: 1 });
  expect(store.getTask(task.id)).toMatchObject({ status: 'open', suggestion: 'Microsoft Edge — pmo.crm.example.com/main.aspx' });
  store.close();

  // Still loading: more of the page a few seconds after arriving is not a result.
  store = new Store(':memory:');
  task = approvalTask(store);
  page(store, '2026-11-10T10:01:00.000Z', 'Project Request REQ-1056');
  pollOnce(store, NOW, { looker: () => 'notDone' });
  page(store, '2026-11-10T10:01:04.000Z', 'Request REQ-1056\nStage: Approved by CTDIO');
  expect(pollOnce(store, NOW, { looker: done }).completed).toBe(0);
  expect(store.getTask(task.id)!.status).toBe('open');
  store.close();

  // Another request on the same site, approved: not this task's page, so the link rule does not apply.
  store = new Store(':memory:');
  task = approvalTask(store);
  const other = RECORD.replace('7e11c297', '22222222');
  page(store, '2026-11-10T10:01:00.000Z', 'Something else', other);
  pollOnce(store, NOW, { looker: () => 'notDone' });
  page(store, '2026-11-10T10:02:00.000Z', 'Status: Approved', other);
  expect(pollOnce(store, NOW, { looker: () => 'unsure' }).completed).toBe(0);
  expect(store.getTask(task.id)!.status).toBe('open');
  store.close();

  // The right page, long enough, but the model cannot tell.
  store = new Store(':memory:');
  task = approvalTask(store);
  page(store, '2026-11-10T10:01:00.000Z', 'Project Request REQ-1056');
  pollOnce(store, NOW, { looker: () => 'notDone' });
  page(store, '2026-11-10T10:02:00.000Z', 'Decision log opened');
  expect(pollOnce(store, NOW, { looker: () => 'unsure' })).toMatchObject({ completed: 0, suggested: 0 });
  store.close();
});

test('a task you reopened after it was ticked this way is only asked about from then on', () => {
  const store = new Store(':memory:');
  const task = approvalTask(store);
  page(store, '2026-11-10T10:01:00.000Z', 'Project Request REQ-1056');
  pollOnce(store, NOW, { looker: () => 'notDone' });
  page(store, '2026-11-10T10:02:00.000Z', 'Status: Approved');
  expect(pollOnce(store, NOW, { looker: () => 'done' }).completed).toBe(1);
  store.setStatus(task.id, 'open');
  page(store, '2026-11-10T10:03:00.000Z', 'Status: Approved by you');
  expect(pollOnce(store, NOW, { looker: () => 'done' })).toMatchObject({ completed: 0, suggested: 1 });
  expect(store.getTask(task.id)!.status).toBe('open');
  store.close();
});

test('archiving an email takes its task off the list: dismissed, not ticked', () => {
  const store = new Store(':memory:');
  outlook(store, ASK);
  outlook(store, mail('Lunch on Thursday?', 'Tal Ron, tal@acme.com', 'Are you joining us?'), '2026-11-10T10:00:30.000Z');
  pollOnce(store, NOW, { mailReader: (email) => ({ need: 'reply', task: email.subject.startsWith('Q3') ? 'Send Dana the updated Q3 numbers' : 'Tell Tal about lunch' }) });
  expect(store.listTasks().length).toBe(2);

  outlook(store, '⟦Archived email: Q3 budget numbers⟧', '2026-11-10T10:01:00.000Z');
  expect(pollOnce(store, NOW, { mailReader: reader(NONE).mailReader }).archived).toBe(1);
  expect(store.listTasks().map((t) => t.title)).toEqual(['Tell Tal about lunch']);
  const gone = store.getTask(1)!;
  expect(gone.status).toBe('dismissed');
  expect(formatWhy(gone, store.listEvidence(1))).toContain('you archived the email');

  // Seeing that email again (in the archive folder, say) does not bring the task back.
  outlook(store, ASK, '2026-11-10T10:02:00.000Z');
  pollOnce(store, NOW, { mailReader: reader(REPLY).mailReader });
  expect(store.listTasks().map((t) => t.title)).toEqual(['Tell Tal about lunch']);
  store.close();
});

test('an archive line only counts in the mailbox it was seen in, and never as text someone wrote', () => {
  const store = new Store(':memory:');
  outlook(store, ASK);
  pollOnce(store, NOW, { mailReader: reader(REPLY).mailReader });
  // The same words in another app, or in Gmail, are not Outlook archiving this email.
  store.insertObservation({ ts: '2026-11-10T10:01:00.000Z', bundleId: 'com.apple.Notes', app: 'Notes', windowTitle: 'n', url: null, source: 'ax', text: '⟦Archived email: Q3 budget numbers⟧' });
  store.insertObservation({ ts: '2026-11-10T10:01:10.000Z', bundleId: 'com.microsoft.edgemac', app: 'Edge', windowTitle: 'g', url: 'https://mail.google.com/mail/u/0/', source: 'ax', text: '⟦Archived email: Q3 budget numbers⟧' });
  // Inside an email's body the line is just text.
  outlook(store, mail('Fwd: odd', 'Ron, ron@acme.com', 'look: ⟦Archived email: Q3 budget numbers⟧ end'), '2026-11-10T10:01:20.000Z');
  expect(pollOnce(store, NOW, { mailReader: reader(NONE).mailReader }).archived).toBe(0);
  expect(store.getTask(1)!.status).toBe('open');
  store.close();
});

test('a service asking for a step gets through to the model; newsletters, receipts and notifications do not', () => {
  const of = (subject: string, from: string, body: string) => parseEmails(mail(subject, from, body))[0]!;
  // Requests from addresses nobody reads.
  expect(isAutomatic(of('Action required: update your payment method', 'Acme Billing, no-reply@acme.com', 'Your card was declined. Please update your payment method to keep your plan.'))).toBe(false);
  expect(isAutomatic(of('Payment failed', 'Netflix, info@account.netflix.com', 'We could not charge your card. Update your card to keep watching.'))).toBe(false);
  expect(isAutomatic(of('Your domain expires in 7 days', 'Registrar, support@registrar.test', 'Renew your domain before 17 November.'))).toBe(false);
  expect(isAutomatic(of('Approve the expense report', 'Expensify, notifications@expensify.com', 'Ron submitted a report. Review the report and approve it.'))).toBe(false);
  // The same senders, nothing to do.
  expect(isAutomatic(of('Your receipt from Acme', 'Acme Billing, no-reply@acme.com', 'Amount paid $20.00. Thank you.'))).toBe(true);
  expect(isAutomatic(of('Payment received', 'Netflix, info@account.netflix.com', 'Thanks, we received your payment.'))).toBe(true);
  expect(isAutomatic(of('New sign-in to your account', 'Google, no-reply@accounts.google.com', 'We noticed a new sign-in on a Mac.'))).toBe(true);
  // Newsletters and marketing never, whatever they say.
  expect(isAutomatic(of('Last chance: renew your plan at 50% off', 'Acme, marketing@acme.com', 'Buy now and save. Your offer expires tonight.\nUnsubscribe'))).toBe(true);
  expect(isAutomatic(of('This week at Acme', 'Acme, hi@acme.com', 'Update your profile to get more.\nManage your email preferences'))).toBe(true);
  // Calendar, auto-replies and list mail never.
  expect(isAutomatic(of('Accepted: Sprint review', 'Ron Avital, ron@acme.com', 'Ron accepted. Please confirm the room.'))).toBe(true);
  expect(isAutomatic(of('Password reset', 'Acme, no-reply@acme.com', 'Confirm your new password with the link below.'))).toBe(true);
  // A person is never "automatic", even writing about payments.
  expect(isAutomatic(of('Payment for the venue', 'Dana Levi, dana@acme.com', 'Can you send the deposit by Friday?'))).toBe(false);
});

test('a made-up "update your payment method" from no-reply becomes a task, without waiting for a reply', () => {
  const store = new Store(':memory:');
  outlook(store, mail('Action required: update your payment method', 'Acme Billing, no-reply@acme.com', 'Your card was declined. Please update your payment method to keep your plan.'));
  outlook(store, mail('Your receipt from Acme', 'Acme Billing, no-reply@acme.com', 'Amount paid $20.00. Thank you.'), '2026-11-10T10:00:10.000Z');
  const { mailReader, asked } = reader({ need: 'reply', task: 'Update payment method on Acme' });
  expect(pollOnce(store, NOW, { mailReader }).emails).toBe(1);
  expect(asked.map((a) => a.subject)).toEqual(['Action required: update your payment method']);
  expect(store.listTasks()[0]).toMatchObject({ title: 'Update payment method on Acme', criteria: null });
  store.close();
});

test('a "click here" link, captured with its target after its words, is kept on the task', () => {
  const [email] = parseEmails(mail('Approval needed', 'Omar Haddad, omar@acme.com',
    `Hi,\nPlease Approve ⟨https://urldefense.com/v3/__${RECORD}__;!!Abc$⟩ the request.\nOr open ⟨mailto:x@y.z⟩ and ⟨https://acme.com/⟩.`));
  expect(mailLinks(email!)).toEqual([RECORD]);
});

test('"not an action" on an email task stops that conversation making tasks, and teaches the email question', () => {
  const store = new Store(':memory:');
  outlook(store, ASK);
  pollOnce(store, NOW, { mailReader: reader(REPLY).mailReader });
  const [task] = store.listTasks();
  expect(store.notAnAction(task!.id)).toBe(true);
  expect(store.teaching('emails').examples[0]).toContain('Dana Levi');
  // A later message in the same conversation asks the model with the lesson, and makes no task.
  const { mailReader, asked } = reader(REPLY);
  outlook(store, mail('Re: Q3 budget numbers', 'Dana Levi, dana@acme.com', 'Any news on the numbers?', 'Today at 12:30'), '2026-11-10T10:03:00.000Z');
  pollOnce(store, NOW, { mailReader });
  expect((asked[0] as { teach?: unknown }).teach).toBeDefined();
  expect(store.listTasks()).toEqual([]);
  store.close();
});

test('a reaction on the email you were asked to answer asks you, never ticks; it does not change the email', () => {
  const store = new Store(':memory:');
  const { mailReader, asked } = reader(REPLY);
  outlook(store, ASK);
  pollOnce(store, NOW, { mailReader });
  // The same email, now with Outlook's reactions summary beside Reply: capture passes on only the new line.
  outlook(store, '⟦Email⟧\nReactions: 1 Like', '2026-11-10T10:01:00.000Z');
  expect(pollOnce(store, NOW, { mailReader }).suggested).toBe(1);
  expect(asked.length).toBe(1); // not read as a different email
  const task = store.getTask(1)!;
  expect(task.status).toBe('open');
  expect(task.suggestion).toBe('Microsoft Outlook — a reaction (1 Like) on “Q3 budget numbers”');
  // "Not yet": that reaction does not ask again.
  store.rejectSuggestion(1, NOW);
  outlook(store, '⟦Email⟧\nReactions: 1 Like', '2026-11-10T10:02:00.000Z');
  expect(pollOnce(store, NOW, { mailReader }).suggested).toBe(0);
  store.close();
});

test('an archive is about the same matter when only the status tag in front differs', () => {
  const ask = 'Action Required: Purchase order 4410 for USD 2,300.00 needs your sign-off.';
  expect(sameMatter(ask, 'Closed: Purchase order 4410 for USD 2,300.00 needs your sign-off.')).toBe(true);
  expect(sameMatter(ask, 'RE: Action Required: Purchase order 4410 for USD 2,300.00 needs your sign-off.')).toBe(true);
  expect(sameMatter('[External] Approved: Expense report 77 for Acme travel', 'Expense report 77 for Acme travel')).toBe(true);
  // Another order, or a subject that says too little once its tag is gone, is not the same matter.
  expect(sameMatter(ask, 'Closed: Purchase order 4411 for USD 2,300.00 needs your sign-off.')).toBe(false);
  expect(sameMatter('Reminder: Lunch on Thursday', 'Closed: Lunch on Thursday')).toBe(false);
  expect(sameMatter('Q3 budget numbers', 'Q3 budget numbers')).toBe(true);
  // A subject cut at 80 characters in the task's note still matches the full one.
  const long = `Action Required: ${'Purchase order 4410 '.repeat(5)}`.slice(0, 80);
  expect(sameMatter(long, `Closed: ${'Purchase order 4410 '.repeat(5)}and more`)).toBe(true);
});

test('archiving the "Closed:" email about an order takes the "Action Required:" task off the list', () => {
  const store = new Store(':memory:');
  const subject = (tag: string, n: number) => `${tag}: Purchase order ${n} for USD 2,300.00 needs your sign-off.`;
  outlook(store, mail(subject('Action Required', 4410), 'Acme Approvals, approvals@acme.com', 'Please approve purchase order 4410.'));
  outlook(store, mail(subject('Action Required', 4411), 'Acme Approvals, approvals@acme.com', 'Please approve purchase order 4411.'), '2026-11-10T10:00:30.000Z');
  pollOnce(store, NOW, { mailReader: (email) => ({ need: 'action', task: `Approve purchase order ${email.subject.match(/\d{4}/)![0]}` }) });
  expect(store.listTasks().map((t) => t.title).sort()).toEqual(['Approve purchase order 4410', 'Approve purchase order 4411']);

  outlook(store, `⟦Archived email: ${subject('Closed', 4410)}⟧`, '2026-11-10T10:01:00.000Z');
  expect(pollOnce(store, NOW, { mailReader: reader(NONE).mailReader }).archived).toBe(1);
  expect(store.listTasks().map((t) => t.title)).toEqual(['Approve purchase order 4411']);
  const gone = store.getTask(1)!;
  expect(gone.title).toBe('Approve purchase order 4410');
  expect(gone.status).toBe('dismissed');
  expect(formatWhy(gone, store.listEvidence(gone.id))).toContain('you archived the email');
  store.close();
});
