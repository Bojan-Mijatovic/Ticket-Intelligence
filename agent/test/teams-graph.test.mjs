import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { channelApi, createGraph, graphSettings, parseTeamsLink, SCOPES } from '../lib/teams-graph.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'teams-graph-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
const CLIENT = '11111111-2222-3333-4444-555555555555';
const TENANT = '00759aaa-82bd-459c-a5c3-a438531075bf';

test('the app registration from the environment, only when both ids look right', () => {
  assert.deepEqual(graphSettings({ TEAMS_CLIENT_ID: CLIENT, TEAMS_TENANT_ID: TENANT }), { clientId: CLIENT, tenantId: TENANT });
  assert.deepEqual(graphSettings({ TEAMS_CLIENT_ID: ` ${CLIENT} `, TEAMS_TENANT_ID: 'contoso.onmicrosoft.com' }), { clientId: CLIENT, tenantId: 'contoso.onmicrosoft.com' });
  assert.equal(graphSettings({ TEAMS_CLIENT_ID: 'x', TEAMS_TENANT_ID: TENANT }), null);
  assert.equal(graphSettings({}), null);
  assert.ok(SCOPES.includes('offline_access') && SCOPES.includes('https://graph.microsoft.com/ChannelMessage.Send'));
});

test('a Teams link: a channel link names its channel; a team link gives the team and its General thread', () => {
  assert.deepEqual(parseTeamsLink('https://teams.microsoft.com/l/channel/19%3Aabc%40thread.tacv2/support-triage?groupId=g-1&tenantId=t-1'), { kind: 'channel', teamId: 'g-1', threadId: '19:abc@thread.tacv2', name: 'support-triage', tenantId: 't-1' });
  assert.deepEqual(parseTeamsLink('https://teams.cloud.microsoft/l/team/19%3AjOX%40thread.tacv2/conversations?groupId=ccc9&tenantId=0075'), { kind: 'team', teamId: 'ccc9', threadId: '19:jOX@thread.tacv2', name: null, tenantId: '0075' });
  assert.equal(parseTeamsLink('not a link'), null);
  assert.equal(parseTeamsLink('https://example.com/x'), null);
});

/** A fake Microsoft: the device code flow, the token endpoint and Graph, recording every call. */
function fakeMicrosoft({ pending = 1, graph = () => ({ status: 200, body: {} }) } = {}) {
  const calls = [];
  let left = pending;
  let issued = 0;
  const fetch = async (url, opts = {}) => {
    const body = opts.body && typeof opts.body === 'string' && opts.headers?.['Content-Type']?.includes('urlencoded') ? Object.fromEntries(new URLSearchParams(opts.body)) : opts.body;
    calls.push({ url: String(url), method: opts.method, body, auth: opts.headers?.Authorization ?? null });
    const json = (status, b, headers = {}) => new Response(JSON.stringify(b), { status, headers });
    if (url.endsWith('/devicecode')) return json(200, { user_code: 'ABCD-EFGH', device_code: 'dc-1', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 5 });
    if (url.endsWith('/token')) {
      if (body.grant_type.endsWith('device_code') && left-- > 0) return json(400, { error: 'authorization_pending' });
      if (body.grant_type === 'refresh_token' && body.refresh_token === 'revoked') return json(400, { error: 'invalid_grant', error_description: 'AADSTS700082: The refresh token has expired.\r\nTrace ID: x' });
      issued++;
      return json(200, { access_token: `at-${issued}`, refresh_token: `rt-${issued}`, expires_in: 3600 });
    }
    if (url.includes('/me?')) return json(200, { id: 'agent-1', displayName: 'Ticket Intelligence', userPrincipalName: 'ti@contoso.onmicrosoft.com' });
    const r = graph(String(url), opts, calls);
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status, headers: r.headers ?? {} });
  };
  return { fetch, calls };
}

test('the device code sign-in: the code is shown, pending is waited out, the account and the tokens are kept', async () => {
  const tokenFile = join(tmp, 'login', 'teams-token.json');
  const ms = fakeMicrosoft({ pending: 2 });
  let t = 0;
  const g = createGraph({ clientId: CLIENT, tenantId: TENANT, tokenFile, fetch: ms.fetch, now: () => t, sleep: async (ms2) => { t += ms2; } });
  let shown = null;
  const me = await g.deviceLogin({ onCode: (c) => { shown = c; } });
  assert.deepEqual(shown, { code: 'ABCD-EFGH', url: 'https://microsoft.com/devicelogin', expiresIn: 900 });
  assert.deepEqual(me, { id: 'agent-1', name: 'Ticket Intelligence', upn: 'ti@contoso.onmicrosoft.com' });
  assert.equal(ms.calls.filter((c) => c.url.endsWith('/token')).length, 3, 'two pending answers, then the tokens');
  assert.match(ms.calls[0].body.scope, /offline_access .*ChannelMessage\.Read\.All/);
  const kept = JSON.parse(readFileSync(tokenFile, 'utf8'));
  assert.deepEqual([kept.refresh_token, kept.account.name], ['rt-1', 'Ticket Intelligence']);
  assert.ok(g.signedIn());
});

test('Graph calls: the token renewed when it expires, throttling waited out as asked, an expired sign-in said plainly', async () => {
  const tokenFile = join(tmp, 'calls', 'teams-token.json');
  let throttled = 1;
  const ms = fakeMicrosoft({
    graph: (url) => {
      if (url.includes('/messages?') && throttled-- > 0) return { status: 429, body: { error: { message: 'slow down' } }, headers: { 'Retry-After': '7' } };
      if (url.includes('/nope')) return { status: 403, body: { error: { code: 'Forbidden', message: 'Missing scope' } } };
      return { status: 200, body: { value: [{ id: 'm1', replies: [] }] } };
    },
  });
  let t = 0;
  const waits = [];
  const g = createGraph({ clientId: CLIENT, tenantId: TENANT, tokenFile, fetch: ms.fetch, now: () => t, sleep: async (w) => { waits.push(w); t += w; } });
  await assert.rejects(g.get('/x'), (e) => e.code === 'NO_LOGIN' && /run node agent\/teams-login\.mjs/.test(e.message));
  await g.deviceLogin({ onCode: () => {} });
  const api = channelApi(g, { teamId: 'g-1', channelId: '19:abc@thread.tacv2' });
  const roots = await api.recent(30);
  assert.deepEqual(roots.map((r) => r.id), ['m1']);
  assert.equal(waits.at(-1), 7000, 'Retry-After: 7');
  assert.match(ms.calls.at(-1).url, /\/teams\/g-1\/channels\/19%3Aabc%40thread\.tacv2\/messages\?\$top=30&\$expand=replies$/);
  t += 3_600_000; // an hour later the access token has expired: renewed with the refresh token
  await api.reply('m1', '<p>hi</p>');
  const refresh = ms.calls.filter((c) => c.url.endsWith('/token') && c.body.grant_type === 'refresh_token');
  assert.equal(refresh.length, 1);
  assert.equal(ms.calls.at(-1).auth, 'Bearer at-2');
  assert.deepEqual(JSON.parse(ms.calls.at(-1).body), { body: { contentType: 'html', content: '<p>hi</p>' } });
  await assert.rejects(g.get('/nope'), (e) => e.status === 403 && /Graph GET \/nope -> 403: Missing scope/.test(e.message));

  const revoked = join(tmp, 'revoked', 'teams-token.json');
  const g2 = createGraph({ clientId: CLIENT, tenantId: TENANT, tokenFile: revoked, fetch: ms.fetch, now: () => t, sleep: async () => {} });
  await g2.deviceLogin({ onCode: () => {} });
  const k = JSON.parse(readFileSync(revoked, 'utf8'));
  const { writeFileSync } = await import('node:fs');
  writeFileSync(revoked, JSON.stringify({ ...k, refresh_token: 'revoked', expires_at: 0 }));
  const g3 = createGraph({ clientId: CLIENT, tenantId: TENANT, tokenFile: revoked, fetch: ms.fetch, now: () => t, sleep: async () => {} });
  await assert.rejects(g3.get('/x'), (e) => e.code === 'LOGIN_EXPIRED' && /no longer valid \(The refresh token has expired\.\): run node agent\/teams-login\.mjs again/.test(e.message));
});
