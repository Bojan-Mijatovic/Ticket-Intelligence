import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { channelApi, createGraph, graphSettings, missingPermissions, parseTeamsLink, PERMISSIONS, SCOPES } from '../lib/teams-graph.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'teams-graph-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
const CLIENT = '11111111-2222-3333-4444-555555555555';
const TENANT = '00759aaa-82bd-459c-a5c3-a438531075bf';

test('the app registration from the environment, only when both ids look right', () => {
  assert.deepEqual(graphSettings({ TEAMS_CLIENT_ID: CLIENT, TEAMS_TENANT_ID: TENANT }), { clientId: CLIENT, tenantId: TENANT });
  assert.deepEqual(graphSettings({ TEAMS_CLIENT_ID: ` ${CLIENT} `, TEAMS_TENANT_ID: 'contoso.onmicrosoft.com' }), { clientId: CLIENT, tenantId: 'contoso.onmicrosoft.com' });
  assert.equal(graphSettings({ TEAMS_CLIENT_ID: 'x', TEAMS_TENANT_ID: TENANT }), null);
  assert.equal(graphSettings({}), null);
  assert.deepEqual(SCOPES, ['offline_access', 'https://graph.microsoft.com/.default'], 'what the admin granted, and the refresh token');
});

test('the permissions a sign-in did not get, named: from the token\'s scope, full or short names, any case', () => {
  assert.deepEqual(missingPermissions(PERMISSIONS.map((p) => `https://graph.microsoft.com/${p}`).join(' ')), []);
  assert.deepEqual(missingPermissions('User.Read user.readbasic.all Channel.ReadBasic.All ChannelMessage.Send openid profile offline_access'), ['ChannelMessage.Read.All']);
  assert.deepEqual(missingPermissions(''), PERMISSIONS);
  assert.equal(missingPermissions(undefined), null, 'not known: a token from before');
});

test('a Teams link: a channel link names its channel; a team link gives the team and its General thread', () => {
  assert.deepEqual(parseTeamsLink('https://teams.microsoft.com/l/channel/19%3Aabc%40thread.tacv2/support-triage?groupId=g-1&tenantId=t-1'), { kind: 'channel', teamId: 'g-1', threadId: '19:abc@thread.tacv2', name: 'support-triage', tenantId: 't-1' });
  assert.deepEqual(parseTeamsLink('https://teams.cloud.microsoft/l/team/19%3AjOX%40thread.tacv2/conversations?groupId=ccc9&tenantId=0075'), { kind: 'team', teamId: 'ccc9', threadId: '19:jOX@thread.tacv2', name: null, tenantId: '0075' });
  assert.equal(parseTeamsLink('not a link'), null);
  assert.equal(parseTeamsLink('https://example.com/x'), null);
});

/**
 * A fake Microsoft: the device code flow, the token endpoint and Graph, recording every call. `grants` are the
 * permissions the admin has granted the app (a token's scope); `refresh: false` is a sign-in without offline_access.
 */
function fakeMicrosoft({ pending = 1, graph = () => ({ status: 200, body: {} }), granted = PERMISSIONS, refresh = true } = {}) {
  const calls = [];
  const grants = [...granted];
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
      if (body.grant_type === 'authorization_code' && body.code === 'bad') return json(400, { error: 'invalid_grant', error_description: 'AADSTS70000: The provided value for the code parameter is not valid. Trace ID: y Correlation ID: z' });
      issued++;
      const scope = [...grants.map((p) => `https://graph.microsoft.com/${p}`), 'offline_access'].join(' ');
      return json(200, { access_token: `at-${issued}`, ...(refresh ? { refresh_token: `rt-${issued}` } : {}), expires_in: 3600, scope });
    }
    if (url.includes('/me?')) return json(200, { id: 'agent-1', displayName: 'Ticket Intelligence', userPrincipalName: 'ti@contoso.onmicrosoft.com' });
    const r = graph(String(url), opts, calls);
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status, headers: r.headers ?? {} });
  };
  return { fetch, calls, grants };
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
  assert.equal(ms.calls[0].body.scope, 'offline_access https://graph.microsoft.com/.default');
  const kept = JSON.parse(readFileSync(tokenFile, 'utf8'));
  assert.deepEqual([kept.refresh_token, kept.account.name], ['rt-1', 'Ticket Intelligence']);
  assert.ok(g.signedIn());
  assert.deepEqual(g.missingPermissions(), []);
});

test('a sign-in the admin has not granted everything for: it goes through and names what is missing; a consent given later is picked up by a renewal', async () => {
  const tokenFile = join(tmp, 'missing', 'teams-token.json');
  const ms = fakeMicrosoft({ granted: PERMISSIONS.filter((p) => p !== 'ChannelMessage.Read.All') });
  const g = createGraph({ clientId: CLIENT, tenantId: TENANT, tokenFile, fetch: ms.fetch, sleep: async () => {} });
  await g.deviceLogin({ onCode: () => {} });
  assert.deepEqual(g.missingPermissions(), ['ChannelMessage.Read.All']);
  ms.grants.push('ChannelMessage.Read.All'); // the admin: Grant admin consent
  await g.renew();
  assert.deepEqual(g.missingPermissions(), [], 'no new sign-in');
  assert.deepEqual(createGraph({ clientId: CLIENT, tenantId: TENANT, tokenFile, fetch: ms.fetch }).missingPermissions(), [], 'and kept with the tokens');

  const noRefresh = createGraph({ clientId: CLIENT, tenantId: TENANT, tokenFile: join(tmp, 'no-rt', 'teams-token.json'), fetch: fakeMicrosoft({ refresh: false }).fetch, sleep: async () => {} });
  await assert.rejects(noRefresh.deviceLogin({ onCode: () => {} }), /without a refresh token: add offline_access/);
  assert.ok(!noRefresh.signedIn());
});

/** The browser of a browser sign-in: it goes to Microsoft's page (`onUrl`), then comes back to the agent's computer. */
function browserVisits(paths) {
  const pages = [];
  let done = Promise.resolve();
  const onUrl = (u) => {
    const q = new URL(u.url).searchParams;
    done = (async () => {
      for (const p of paths(q.get('state'))) {
        const r = await fetch(`${u.redirectUri}${p}`);
        pages.push([r.status, await r.text()]);
      }
    })();
    onUrl.seen = { ...u, q };
  };
  return { onUrl, pages, done: () => done };
}

test('the browser sign-in: a PKCE code for this computer, only this sign-in\'s answer counts, the account kept, nothing left listening', async () => {
  const tokenFile = join(tmp, 'browser', 'teams-token.json');
  const ms = fakeMicrosoft();
  const g = createGraph({ clientId: CLIENT, tenantId: TENANT, tokenFile, fetch: ms.fetch });
  const b = browserVisits((state) => ['/favicon.ico', '/?code=old&state=from-an-earlier-run', `/?code=c-1&state=${state}`]);
  const me = await g.browserLogin({ onUrl: b.onUrl, loginHint: 'ti@contoso.onmicrosoft.com' });
  await b.done();
  assert.deepEqual(me, { id: 'agent-1', name: 'Ticket Intelligence', upn: 'ti@contoso.onmicrosoft.com' });

  const { url, redirectUri, q } = b.onUrl.seen;
  assert.ok(url.startsWith(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize?`));
  assert.match(redirectUri, /^http:\/\/localhost:\d+$/, 'the registered http://localhost; the port is not matched');
  assert.deepEqual(
    ['client_id', 'response_type', 'redirect_uri', 'code_challenge_method', 'prompt', 'login_hint'].map((k) => q.get(k)),
    [CLIENT, 'code', redirectUri, 'S256', 'select_account', 'ti@contoso.onmicrosoft.com'],
  );
  assert.equal(q.get('scope'), 'offline_access https://graph.microsoft.com/.default');

  const redeem = ms.calls.find((c) => c.url.endsWith('/token'));
  assert.deepEqual([redeem.body.grant_type, redeem.body.code, redeem.body.redirect_uri], ['authorization_code', 'c-1', redirectUri], 'the answer with this sign-in\'s state only');
  assert.equal(createHash('sha256').update(redeem.body.code_verifier).digest('base64url'), q.get('code_challenge'), 'redeemed with the verifier of the challenge');
  assert.equal(redeem.body.client_secret, undefined, 'a public client: no secret on this computer');

  assert.deepEqual(b.pages.map(([s]) => s), [404, 400, 200]);
  assert.match(b.pages[1][1], /earlier sign-in/);
  assert.match(b.pages[2][1], /signed in to Teams as Ticket Intelligence/);
  assert.equal(JSON.parse(readFileSync(tokenFile, 'utf8')).refresh_token, 'rt-1');
  await assert.rejects(fetch(redirectUri), 'the one-time server is gone');
});

test('the browser sign-in that does not finish: Microsoft\'s refusal with its code, a code not taken, no answer in time', async () => {
  const ms = fakeMicrosoft();
  const g = createGraph({ clientId: CLIENT, tenantId: TENANT, tokenFile: join(tmp, 'browser-no', 'teams-token.json'), fetch: ms.fetch });
  const why = encodeURIComponent('AADSTS65004: User declined to consent to access the app.\r\nTrace ID: x');
  const refused = browserVisits((state) => [`/?error=access_denied&error_description=${why}&state=${state}`]);
  await assert.rejects(g.browserLogin({ onUrl: refused.onUrl }), (e) => e.message === 'the sign-in did not finish: AADSTS65004: User declined to consent to access the app.');
  await refused.done();
  assert.deepEqual(refused.pages.map(([s]) => s), [400]);
  assert.match(refused.pages[0][1], /AADSTS65004/, 'the browser says why, too');

  const bad = browserVisits((state) => [`/?code=bad&state=${state}`]);
  await assert.rejects(g.browserLogin({ onUrl: bad.onUrl }), (e) => e.message === 'the sign-in did not finish: AADSTS70000: The provided value for the code parameter is not valid.');
  await bad.done();
  assert.equal(bad.pages[0][0], 400);
  assert.ok(!g.signedIn());

  let seen = null;
  await assert.rejects(g.browserLogin({ onUrl: (u) => { seen = u; }, timeoutMs: 30 }), /did not finish in time: run it again/);
  await assert.rejects(fetch(seen.redirectUri), 'nothing left listening');
  assert.equal(new URL(seen.url).searchParams.get('login_hint'), null, 'no account filled in unless given');
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
