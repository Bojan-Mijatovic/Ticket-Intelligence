import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { mentionFor, notifyOwner, teamsInfo } from '../lib/notify.mjs';

const MSG = { key: 'DEM-40', url: 'https://jira.example/browse/DEM-40', title: 'Red background', handoff: { to: 'Marta Ricci', message: 'Please take a look' }, confidence: 'high', escalate: { yes: false } };
const realFetch = globalThis.fetch;
const env = { ...process.env };
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...env };
});

test('teamsInfo: whether the channel is live and its link, never the webhook address', () => {
  assert.deepEqual(teamsInfo({}), { live: false, channelUrl: null });
  const info = teamsInfo({ TEAMS_WEBHOOK_URL: 'https://secret.example/hook?sig=abc', TEAMS_CHANNEL_URL: 'https://teams.microsoft.com/l/channel/19%3Aabc/support-triage' });
  assert.deepEqual(info, { live: true, channelUrl: 'https://teams.microsoft.com/l/channel/19%3Aabc/support-triage' });
  assert.ok(!JSON.stringify(info).includes('secret'));
  assert.equal(teamsInfo({ TEAMS_WEBHOOK_URL: '  ', TEAMS_CHANNEL_URL: 'javascript:alert(1)' }).live, false);
  assert.equal(teamsInfo({ TEAMS_CHANNEL_URL: 'javascript:alert(1)' }).channelUrl, null, 'only an https link is shown');
});

test('without a webhook the message is only shown on the dashboard', async () => {
  delete process.env.TEAMS_WEBHOOK_URL;
  globalThis.fetch = () => assert.fail('nothing is posted');
  const n = await notifyOwner(MSG);
  assert.equal(n.channel, 'dashboard');
  assert.deepEqual([n.card.to, n.card.title, n.card.escalate], ['Marta Ricci', 'DEM-40: Red background', null]);
});

test('with a webhook an Adaptive Card is posted to the channel', async () => {
  process.env.TEAMS_WEBHOOK_URL = 'https://hook.example/workflows/1';
  let sent = null;
  globalThis.fetch = async (url, opts) => {
    sent = { url, body: JSON.parse(opts.body) };
    return new Response('', { status: 202 });
  };
  const n = await notifyOwner(MSG);
  assert.deepEqual([n.channel, n.status], ['teams', 202]);
  assert.equal(sent.url, 'https://hook.example/workflows/1');
  const card = sent.body.attachments[0];
  assert.equal(card.contentType, 'application/vnd.microsoft.card.adaptive');
  assert.equal(card.content.body[1].text, 'DEM-40: Red background');
  assert.deepEqual(card.content.actions, [{ type: 'Action.OpenUrl', title: 'Open in Jira', url: MSG.url }]);
});

test('mentionFor: a named person first, then first.last@domain for a person name, nobody without a setting', () => {
  assert.equal(mentionFor('Marta Ricci', {}), null, 'no setting, no mention');
  const env = { TEAMS_MENTION_DOMAIN: 'MediAgendaTest.onmicrosoft.com', TEAMS_MENTIONS: 'Luca  Bianchi = l.bianchi@corp.example ; Bad Entry=not-an-email' };
  assert.equal(mentionFor('Marta Ricci', env), 'marta.ricci@mediagendatest.onmicrosoft.com');
  assert.equal(mentionFor('luca bianchi', env), 'l.bianchi@corp.example', 'a named person wins, whatever the case and spacing');
  assert.equal(mentionFor('Bad Entry', env), 'bad.entry@mediagendatest.onmicrosoft.com', 'an entry without a valid address falls back to the domain');
  assert.equal(mentionFor('Niccolò D’Angelo', env), 'niccolo.dangelo@mediagendatest.onmicrosoft.com', 'accents and apostrophes dropped');
  for (const role of ['the team', 'IT support / network administrator', 'Marta', 'Reporter (to be named)', '', null]) assert.equal(mentionFor(role, env), null, `${role} is not a person`);
  assert.equal(mentionFor('Marta Ricci', { TEAMS_MENTION_DOMAIN: 'not a domain' }), null);
  assert.equal(mentionFor('Marta Ricci', { TEAMS_MENTION_DOMAIN: '@contoso.com' }), 'marta.ricci@contoso.com');
});

test('a mention: the <at> text in the card and the entity with the UPN match, and the dashboard only learns that there was one', async () => {
  process.env.TEAMS_WEBHOOK_URL = 'https://hook.example/workflows/1';
  process.env.TEAMS_MENTION_DOMAIN = 'contoso.onmicrosoft.com';
  let sent = null;
  globalThis.fetch = async (url, opts) => {
    sent = JSON.parse(opts.body);
    return new Response('', { status: 202 });
  };
  const n = await notifyOwner(MSG);
  const content = sent.attachments[0].content;
  assert.equal(content.body[0].text, 'For <at>Marta Ricci</at>');
  assert.deepEqual(content.msteams.entities, [{ type: 'mention', text: '<at>Marta Ricci</at>', mentioned: { id: 'marta.ricci@contoso.onmicrosoft.com', name: 'Marta Ricci' } }]);
  assert.equal(n.card.mentioned, true);
  assert.ok(!JSON.stringify(n.card).includes('contoso'), 'the UPN is not in the event');

  const team = await notifyOwner({ ...MSG, handoff: { to: 'the team', message: 'x' } });
  assert.equal(sent.attachments[0].content.body[0].text, 'For the team');
  assert.equal(sent.attachments[0].content.msteams, undefined);
  assert.equal(team.card.mentioned, undefined);

  delete process.env.TEAMS_WEBHOOK_URL;
  assert.equal((await notifyOwner(MSG)).card.mentioned, undefined, 'nothing posted, nobody mentioned');
});

test('a channel that refuses or does not answer does not stop the ticket: the message stays on the dashboard, with why', async () => {
  process.env.TEAMS_WEBHOOK_URL = 'https://hook.example/workflows/1';
  globalThis.fetch = async () => new Response('{"error":{"code":"DirectApiAuthorizationRequired"}}', { status: 401 });
  const refused = await notifyOwner(MSG);
  assert.deepEqual([refused.channel, refused.status], ['failed', 401]);
  assert.match(refused.error, /^Teams webhook -> 401 .*DirectApiAuthorizationRequired/);
  assert.equal(refused.card.to, 'Marta Ricci');
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };
  const down = await notifyOwner(MSG);
  assert.deepEqual([down.channel, down.error], ['failed', 'Teams webhook: fetch failed']);
});
