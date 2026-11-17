import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notifyOwner } from '../lib/notify.mjs';
import { mayAnswer, messageWords, ownerReplies, ownerReplyOf, sameNameUser } from '../lib/owner-reply.mjs';

/** The handoff card as the webhook posts it (notify.mjs) and Graph returns it: the Adaptive Card as a JSON string. */
async function handoffCard(key = 'VAX-21', to = 'Irene Fabbri') {
  const env = { ...process.env };
  const realFetch = globalThis.fetch;
  process.env.TEAMS_WEBHOOK_URL = 'https://hook.example/1';
  process.env.TEAMS_MENTION_DOMAIN = 'contoso.onmicrosoft.com';
  let sent = null;
  globalThis.fetch = async (url, opts) => ((sent = JSON.parse(opts.body)), new Response('', { status: 202 }));
  try {
    await notifyOwner({ key, url: `https://jira.example/browse/${key}`, title: 'x', handoff: { to, message: 'please' }, confidence: 'high', escalate: { yes: false } });
  } finally {
    globalThis.fetch = realFetch;
    process.env = env;
  }
  const a = sent.attachments[0];
  return { id: `card-${key}`, createdDateTime: '2026-11-17T12:00:00Z', from: { application: { displayName: 'Workflows' } }, attachments: [{ contentType: a.contentType, content: JSON.stringify(a.content) }], replies: [] };
}
const ME = { id: 'agent', name: 'Ticket Intelligence' };
const SINCE = '2026-11-17T11:00:00Z';
const person = (id, name) => ({ user: { id, displayName: name } });
const reply = (id, html, at = '2026-11-17T12:05:00Z', from = person('irene', 'Irene Fabbri'), mentions = []) => ({ id, createdDateTime: at, from, body: { contentType: 'html', content: html }, mentions });

test('the owner\'s answer: take it, or not mine and to whom, in Serbian, English, Italian; with its ticket or without', () => {
  assert.deepEqual(ownerReplyOf('preuzimam'), { verdict: 'take', note: null });
  assert.deepEqual(ownerReplyOf('Preuzimam, gledam danas'), { verdict: 'take', note: 'gledam danas' });
  assert.deepEqual(ownerReplyOf("I'll take it"), { verdict: 'take', note: null });
  assert.deepEqual(ownerReplyOf('ti: preuzimam VAX-21'), { verdict: 'take', key: 'VAX-21', note: null });
  assert.deepEqual(ownerReplyOf('prendo io vax-21: oggi'), { verdict: 'take', key: 'VAX-21', note: 'oggi' });
  assert.deepEqual(ownerReplyOf('nije moje: Irene Fabbri'), { verdict: 'not-mine', who: 'Irene Fabbri' });
  assert.deepEqual(ownerReplyOf('nije moje, pitaj Tommaso Bruno.'), { verdict: 'not-mine', who: 'Tommaso Bruno' });
  assert.deepEqual(ownerReplyOf('not mine: try Irene'), { verdict: 'not-mine', who: 'Irene' });
  assert.deepEqual(ownerReplyOf('non è mio, chiedi a Irene Fabbri'), { verdict: 'not-mine', who: 'Irene Fabbri' });
  assert.deepEqual(ownerReplyOf('nije moje VAX-21: Irene Fabbri'), { verdict: 'not-mine', key: 'VAX-21', who: 'Irene Fabbri' });
  assert.deepEqual(ownerReplyOf('not mine'), { verdict: 'not-mine', who: null }, 'the agent asks to whom');
  for (const t of ['I will take a look', 'mine is broken too', 'ti: status VAX-21', 'nijedan', 'approve', '']) assert.equal(ownerReplyOf(t), null, t);
});

test('a message\'s words: the agent\'s @mention out, other people\'s kept as names and listed', () => {
  const m = reply('r', '<at id="0">Ticket Intelligence</at> nije moje: <at id="1">Tommaso Bruno</at>', undefined, undefined, [
    { id: 0, mentioned: { user: { id: 'agent', displayName: 'Ticket Intelligence' } } },
    { id: 1, mentioned: { user: { id: 'tommaso', displayName: 'Tommaso Bruno' } } },
  ]);
  assert.deepEqual(messageWords(m, ME), { text: 'nije moje: Tommaso Bruno', people: [{ id: 'tommaso', name: 'Tommaso Bruno' }] });
});

test('answers under the handoff card, named with their ticket elsewhere, and the misplaced ones', async () => {
  const card = await handoffCard();
  card.replies = [
    reply('r1', '<p>preuzimam</p>'),
    reply('r2', '<p>nije moje: <at id="0">Tommaso Bruno</at></p>', '2026-11-17T12:06:00Z', undefined, [{ id: 0, mentioned: { user: { id: 'tommaso', displayName: 'Tommaso Bruno' } } }]),
    reply('r3', '<p>thanks</p>'),
    reply('old', '<p>preuzimam</p>', '2026-11-17T10:00:00Z'),
    reply('mine', '<p>preuzimam</p>', '2026-11-17T12:07:00Z', person('agent', 'Ticket Intelligence')),
  ];
  const keyedPost = { id: 'p1', createdDateTime: '2026-11-17T12:08:00Z', from: person('bojan', 'Bojan Mijatović'), body: { contentType: 'html', content: '<p>ti: preuzimam VAX-30</p>' }, replies: [] };
  const askThread = { id: 'ask', createdDateTime: '2026-11-17T12:00:00Z', from: person('bojan', 'Bojan Mijatović'), body: { contentType: 'html', content: '<p>ti: status VAX-21</p>' }, replies: [
    reply('a1', '<p>answer</p>', '2026-11-17T12:01:00Z', person('agent', 'Ticket Intelligence')),
    reply('a2', '<p>preuzimam</p>', '2026-11-17T12:09:00Z', person('bojan', 'Bojan Mijatović')),
    reply('a3', '<p>nije moje VAX-21: Irene</p>', '2026-11-17T12:10:00Z', person('bojan', 'Bojan Mijatović')),
  ] };
  const people = { id: 'chat', createdDateTime: '2026-11-17T12:00:00Z', from: person('x', 'X'), body: { contentType: 'html', content: '<p>lunch?</p>' }, replies: [reply('c1', '<p>preuzimam</p>', '2026-11-17T12:11:00Z')] };
  const { replies, misplaced } = ownerReplies([card, keyedPost, askThread, people], { me: ME, since: SINCE, handled: ['r3'] });
  assert.deepEqual(replies.map((r) => [r.id, r.key, r.verdict, r.who ?? null, r.whoId ?? null, r.card.to]), [
    ['r1', 'VAX-21', 'take', null, null, 'Irene Fabbri'],
    ['r2', 'VAX-21', 'not-mine', 'Tommaso Bruno', 'tommaso', 'Irene Fabbri'],
    ['p1', 'VAX-30', 'take', null, null, null],
    ['a3', 'VAX-21', 'not-mine', 'Irene', null, 'Irene Fabbri'],
  ]);
  assert.deepEqual(misplaced.map((m) => [m.id, m.verdict]), [['a2', 'take']], 'people talking in their own thread are left alone');
});

test('who may answer: the card\'s person, a person it was handed on to, an approver; a Jira user by the same name', () => {
  const card = { kind: 'handoff', key: 'VAX-21', to: 'Irene Fabbri', toUpn: 'irene@x' };
  assert.equal(mayAnswer({ sender: { displayName: 'Someone', userPrincipalName: 'IRENE@x' }, card }), true);
  assert.equal(mayAnswer({ sender: { displayName: 'irene fabbri' }, card }), true);
  assert.equal(mayAnswer({ sender: { displayName: 'Tommaso Bruno' }, card }), false);
  assert.equal(mayAnswer({ sender: { displayName: 'Tommaso Bruno' }, card, handedTo: ['Tommaso Bruno'] }), true);
  assert.equal(mayAnswer({ sender: { displayName: 'Bojan Mijatović' }, card: { kind: 'handoff', key: 'VAX-30', to: null }, approvers: ['Bojan Mijatovic'] }), true);
  assert.equal(mayAnswer({ sender: { displayName: 'Bojan Mijatović' }, card: { kind: 'handoff', key: 'VAX-30', to: null } }), false);
  const users = [{ accountId: 'a1', name: 'Bojan MIjatovic' }, { accountId: 'a2', name: 'Irene Fabbri' }];
  assert.deepEqual(sameNameUser(users, 'Bojan Mijatović'), users[0]);
  assert.equal(sameNameUser(users, 'Tommaso Bruno'), null);
  assert.equal(sameNameUser([...users, { accountId: 'a3', name: 'Irene  Fabbri' }], 'Irene Fabbri'), null, 'two of that name: nobody');
});
