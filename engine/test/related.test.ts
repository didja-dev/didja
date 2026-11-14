import { expect, test } from 'bun:test';
import { actions, objects, plainName, samePerson, suggestionReason, suggestMerges } from '../src/related.ts';
import { Store } from '../src/store.ts';

const NOW = new Date('2026-11-11T19:10:00Z');

test('the same person, the same kind of action', () => {
  expect(plainName('Sam Carter via Docusign')).toBe('sam carter');
  expect(samePerson('Sam Carter', 'Sam Carter via Docusign')).toBe(true);
  expect(samePerson('Sam', 'Sam Carter')).toBe(true);
  expect(samePerson('Sam Brooks', 'Sam Carter')).toBe(false);
  expect(samePerson('Al', 'Al Green')).toBe(false); // too short to tell
  expect(actions('Sign the document with Docusign')).toEqual(['sign']);
  expect(actions('חתום על הסכם ההלוואה')).toEqual(['sign']);
  expect(actions('Send Dana the deck')).toEqual(['send']);
});

function teams(store: Store, from: string, title: string, ts = '2026-11-11T19:01:00.000Z') {
  return store.upsertTask({ distinct: `t-${title}`, title, sourceKind: 'chat', sourceRef: `Teams — ${from}`, confidence: 1, position: null,
    ts, observationId: null, criteria: { service: null, hosts: [], chat: { app: 'Teams', chat: from, from, at: '2026-11-11T12:01:00.000Z', key: `k-${title}` } } }).id;
}
function email(store: Store, from: string, title: string, subject: string) {
  const id = store.upsertTask({ distinct: `m-${title}`, title, sourceKind: 'email', sourceRef: 'Microsoft Outlook', confidence: 1, position: null,
    ts: '2026-11-11T19:02:00.000Z', observationId: null, criteria: null }).id;
  store.setOrigin(id, '2026-11-11T19:02:00.000Z', `From an email: ${from} — “${subject}”`);
  return id;
}

test('a Teams ask and the DocuSign email from the same person are suggested as one; merged, signing ticks both', () => {
  const store = new Store(':memory:');
  const chat = teams(store, 'Sam Carter', 'Sign the loan agreement Sam is sending');
  const mail = email(store, 'Sam Carter via Docusign', 'Sign the document with Docusign', 'Complete with Docusign: הסכם הלוואה');
  email(store, 'Tamar Levi via Docusign', 'Sign the document with Docusign ', 'Complete with Docusign: 101');
  expect(suggestMerges(store, NOW)).toBe(1);
  expect(store.mergeSuggestions()).toEqual([{ taskId: chat, otherId: mail }]);
  expect(suggestMerges(store, NOW)).toBe(0); // once

  expect(store.merge(mail, chat, NOW)).toBe(true);
  expect(store.mergeSuggestions()).toEqual([]);
  store.setStatus(mail, 'done', NOW);
  expect(store.getTask(chat)!.status).toBe('done');
  store.setStatus(chat, 'open', NOW); // reopening either reopens both
  expect(store.getTask(mail)!.status).toBe('open');
  store.close();
});

test('merging when one is already done finishes the other; "not the same" is never suggested again', () => {
  let store = new Store(':memory:');
  let chat = teams(store, 'Sam Carter', 'Sign the loan agreement');
  let mail = email(store, 'Sam Carter via Docusign', 'Sign the document with Docusign', 'x');
  store.setStatus(mail, 'done', NOW);
  store.merge(mail, chat, NOW);
  expect(store.getTask(chat)!.status).toBe('done');
  store.close();

  store = new Store(':memory:');
  chat = teams(store, 'Sam Carter', 'Sign the loan agreement');
  mail = email(store, 'Sam Carter via Docusign', 'Sign the document with Docusign', 'x');
  store.notSame(chat, mail, NOW);
  expect(suggestMerges(store, NOW)).toBe(0);
  expect(store.mergeSuggestions()).toEqual([]);
  store.close();
});

test('different actions, or two messages in the same place, are not suggested', () => {
  const store = new Store(':memory:');
  teams(store, 'Sam Carter', 'Send Sam the budget');
  email(store, 'Sam Carter', 'Sign the NDA', 'NDA');
  teams(store, 'Dana Levi', 'Sign the lease');
  teams(store, 'Dana Levi', 'Sign the lease addendum');
  expect(suggestMerges(store, NOW)).toBe(0);
  store.close();
});

// --- SCR-106: the same object from the same person, in two apps ---------------------------------

test('concrete objects are read the same way in every app: ids, files, amounts, links', () => {
  expect(objects('Pay invoice INV-2041 for $1,200')).toEqual(['id INV-2041', 'amount 1200']);
  expect(objects('Approve INV2041, 1200 USD')).toEqual(['id INV-2041', 'amount 1200']);
  expect(objects('Review budget-Q4.pdf and order #5531')).toEqual(['file budget-q4.pdf', 'number 5531']);
  expect(objects('Check https://www.example.com/invoices/5531/?x=1')).toEqual(['link example.com/invoices/5531']);
  expect(objects('Send Dana the deck')).toEqual([]);
  expect(objects('Call me at 9:30 on 2026-11-14')).toEqual([]); // times and dates are not objects
});

test('the same invoice from the same person in Teams and email is suggested, even worded as different actions; why says so', () => {
  const store = new Store(':memory:');
  const chat = teams(store, 'Sam Carter', 'Check invoice INV-2041');
  const mail = email(store, 'Sam Carter', 'Reply to Sam Carter', 'Payment for INV-2041');
  expect(suggestMerges(store, NOW)).toBe(1);
  expect(store.mergeSuggestions()).toEqual([{ taskId: chat, otherId: mail }]);
  expect(suggestionReason(store, store.getTask(chat)!, store.getTask(mail)!)).toBe('both from Sam Carter, both name INV-2041');
  // Suggested only: neither task moved.
  expect(store.getTask(mail)!.status).toBe('open');
  expect(store.mergedWith(chat)).toEqual([]);
  store.close();
});

test('the same person with a different object, or different people with the same object, is never suggested (SCR-106)', () => {
  let store = new Store(':memory:');
  teams(store, 'Sam Carter', 'Pay invoice INV-2041');
  email(store, 'Sam Carter', 'Pay invoice INV-2042', 'Invoice INV-2042'); // same action, another invoice
  expect(suggestMerges(store, NOW)).toBe(0);
  store.close();

  store = new Store(':memory:');
  teams(store, 'Sam Carter', 'Review budget-q4.pdf');
  email(store, 'Dana Levi', 'Review budget-q4.pdf', 'budget-q4.pdf'); // same file, someone else
  expect(suggestMerges(store, NOW)).toBe(0);
  store.close();

  // The same object, but more than two days apart.
  store = new Store(':memory:');
  teams(store, 'Sam Carter', 'Pay invoice INV-2041', '2026-11-09T09:00:00.000Z');
  email(store, 'Sam Carter', 'Pay invoice INV-2041', 'Invoice INV-2041');
  expect(suggestMerges(store, NOW)).toBe(0);
  store.close();
});

test('when only one of the two names an object, the same kind of action still suggests them, as before', () => {
  const store = new Store(':memory:');
  const chat = teams(store, 'Sam Carter', 'Sign the loan agreement');
  const mail = email(store, 'Sam Carter via Docusign', 'Sign the document with Docusign', 'Complete with Docusign: loan-agreement.pdf');
  expect(suggestMerges(store, NOW)).toBe(1);
  expect(suggestionReason(store, store.getTask(chat)!, store.getTask(mail)!)).toBe('both from Sam Carter, both to sign');
  store.close();
});
