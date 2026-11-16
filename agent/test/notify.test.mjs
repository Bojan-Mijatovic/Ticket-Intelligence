import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { notifyOwner, teamsInfo } from '../lib/notify.mjs';

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
