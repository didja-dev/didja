import { expect, test } from 'bun:test';
import { pollOnce } from '../src/engine.ts';
import { isSigningDone, longIds, opensLink } from '../src/esign.ts';
import { Store } from '../src/store.ts';

const LINK = 'https://na3.docusign.net/signing/emails/v1-0f1b416ce2db44d38221e972fd72821333a471c97c2881c182c9788c35c6c64c00a1';

test("the signing pages carry the link's own id through DocuSign's redirects", () => {
  expect(longIds('https://x.com/a/0F1B416C-E2DB-44D3-8221-E972FD728213?y=1')).toEqual(['0f1b416ce2db44d38221e972fd728213']);
  // The request's own id (here a=…) counts; the recipient's (er=…, you, on every request) does not.
  expect(opensLink('https://na3.docusign.net/Signing/EmailStart.aspx?a=33a471c9-7c28-81c1-82c9-788c35c6c64c&acct=1&er=0f1b416c-e2db-44d3-8221-e972fd728213', LINK)).toBe(true);
  expect(opensLink('https://na4.docusign.net/Signing/EmailStart.aspx?a=99999999-1111-2222-3333-444444444444&er=0f1b416c-e2db-44d3-8221-e972fd728213',
    'https://na4.docusign.net/Signing/EmailStart.aspx?a=55555555-6666-7777-8888-999999999999&er=0f1b416c-e2db-44d3-8221-e972fd728213')).toBe(false);
  expect(opensLink('https://urldefense.com/v3/__https://na3.docusign.net/signing/emails/v1-0f1b416ce2db44d38221e972fd72821333a471c97288__;!!x$', LINK)).toBe(true);
  expect(opensLink('https://apps.docusign.com/sign/app?ti=54a73b3c55274208b7195903e5dda2e5', LINK)).toBe(false); // another id
});

test('the finished state as signing services word it', () => {
  expect(isSigningDone('Log in to Docusign\nA copy of this document has been sent to your Docusign account.')).toBe(true);
  expect(isSigningDone('A copy of this document has been saved to your Docusign account.')).toBe(true); // as seen
  expect(isSigningDone("You're done signing")).toBe(true);
  expect(isSigningDone('Review and complete\nPlease review and complete the required fields')).toBe(false);
});

function email(store: Store) {
  return store.upsertTask({ distinct: 'mail1', title: 'Sign the document with Docusign', sourceKind: 'email', sourceRef: 'Microsoft Outlook', confidence: 1,
    position: null, ts: '2026-11-11T19:00:00.000Z', observationId: null, markers: [], criteria: { service: null, hosts: [], links: [LINK] } }).id;
}
const page = (store: Store, ts: string, url: string, text: string) =>
  store.insertObservation({ ts, bundleId: 'com.microsoft.edgemac', app: 'Microsoft Edge', windowTitle: 'Docusign', url, source: 'ax', text });
const NOW = new Date('2026-11-11T19:10:00Z');

test("signed through the email's link: ticked, without the model", () => {
  const store = new Store(':memory:');
  const id = email(store);
  page(store, '2026-11-11T19:02:27.000Z', 'https://na3.docusign.net/Signing/EmailStart.aspx?a=33a471c9-7c28-81c1-82c9-788c35c6c64c&er=0f1b416c-e2db-44d3-8221-e972fd728213', 'x');
  page(store, '2026-11-11T19:02:31.000Z', 'https://apps.docusign.com/sign/app?ti=54a73b3c55274208b7195903e5dda2e5', 'Review and complete');
  page(store, '2026-11-11T19:03:46.000Z', 'https://apps.docusign.com/sign/app?ti=54a73b3c55274208b7195903e5dda2e5', 'Log in to Docusign\nA copy of this document has been sent to your Docusign account.');
  expect(pollOnce(store, NOW, { looker: () => 'notDone' }).completed).toBe(1);
  expect(store.getTask(id)!.status).toBe('done');
  store.close();
});

test('a DocuSign page for another document, or the finished message long after, does not tick it', () => {
  let store = new Store(':memory:');
  let id = email(store);
  page(store, '2026-11-11T19:03:46.000Z', 'https://apps.docusign.com/sign/app?ti=aaaabbbbccccddddeeeeffff00001111', 'A copy of this document has been sent to your Docusign account.');
  pollOnce(store, NOW);
  expect(store.getTask(id)!.status).toBe('open');
  store.close();

  store = new Store(':memory:');
  id = email(store);
  page(store, '2026-11-11T19:02:27.000Z', 'https://na3.docusign.net/Signing/EmailStart.aspx?a=33a471c9-7c28-81c1-82c9-788c35c6c64c&er=0f1b416c-e2db-44d3-8221-e972fd728213', 'x');
  page(store, '2026-11-11T19:40:00.000Z', 'https://apps.docusign.com/sign/app?ti=1', "You're done signing");
  pollOnce(store, new Date('2026-11-11T19:41:00Z'));
  expect(store.getTask(id)!.status).toBe('open');
  store.close();
});
