// ROADMAP #9, T7: Microsoft Graph for the team's channel, as one signed-in account (delegated permissions). The agent
// signs in once with a device code (agent/teams-login.mjs); the refresh token is kept in agent/state/ (not committed)
// and renewed on use, a secret like the webhook: never shown, logged or sent anywhere but Microsoft. Outbound only: the
// agent asks Graph; nothing calls the agent. An application permission would need Microsoft's approval (reading
// channel messages is a protected API), so the delegated one is used.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const GRAPH = 'https://graph.microsoft.com/v1.0';
/** What the account may do: read the channel and its people, post replies. `offline_access` gives the refresh token. */
export const SCOPES = ['offline_access', ...['User.Read', 'User.ReadBasic.All', 'Channel.ReadBasic.All', 'ChannelMessage.Read.All', 'ChannelMessage.Send'].map((s) => `https://graph.microsoft.com/${s}`)];

/** The app registration from the environment (TEAMS_CLIENT_ID, TEAMS_TENANT_ID), or null when it is not set up. */
export function graphSettings(env = process.env) {
  const clientId = String(env.TEAMS_CLIENT_ID ?? '').trim();
  const tenantId = String(env.TEAMS_TENANT_ID ?? '').trim();
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return guid.test(clientId) && (guid.test(tenantId) || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(tenantId)) ? { clientId, tenantId } : null;
}

/**
 * The team and the channel of a Teams link: "Get link to channel" (…/l/channel/19%3A…%40thread.tacv2/<name>?groupId=…)
 * or "Get link to team" (…/l/team/19%3A…/conversations?groupId=…; its thread is the team's General channel).
 */
export function parseTeamsLink(url) {
  try {
    const u = new URL(String(url));
    const m = u.pathname.match(/\/l\/(channel|team)\/([^/]+)(?:\/([^/?]+))?/);
    if (!m) return null;
    return {
      kind: m[1],
      teamId: u.searchParams.get('groupId'),
      threadId: decodeURIComponent(m[2]),
      name: m[1] === 'channel' && m[3] ? decodeURIComponent(m[3]) : null,
      tenantId: u.searchParams.get('tenantId'),
    };
  } catch {
    return null;
  }
}

/**
 * @param {string} p.tokenFile  where the tokens are kept (agent/state/teams-token.json)
 */
export function createGraph({ clientId, tenantId, tokenFile, fetch = globalThis.fetch, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const authority = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0`;
  const form = (o) => new URLSearchParams(o).toString();
  const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const readToken = () => {
    try {
      return JSON.parse(readFileSync(tokenFile, 'utf8'));
    } catch {
      return null;
    }
  };
  const saveToken = (t) => {
    mkdirSync(dirname(tokenFile), { recursive: true });
    writeFileSync(tokenFile, JSON.stringify(t));
  };
  let held = null;
  const current = () => (held ??= readToken());
  const keep = (j, account) => {
    held = { access_token: j.access_token, refresh_token: j.refresh_token ?? held?.refresh_token, expires_at: now() + (Number(j.expires_in) || 3600) * 1000, account, savedAt: new Date(now()).toISOString() };
    saveToken(held);
    return held;
  };
  async function tokenRequest(params) {
    const res = await fetch(`${authority}/token`, { method: 'POST', headers: FORM, body: form({ client_id: clientId, ...params }), signal: AbortSignal.timeout(30_000) });
    return { ok: res.ok, j: await res.json().catch(() => ({})) };
  }
  const why = (j) => String(j.error_description ?? j.error ?? 'no answer').split(/\r?\n/)[0].replace(/^AADSTS\d+:\s*/, '');

  async function accessToken() {
    const t = current();
    if (!t?.refresh_token) throw Object.assign(new Error('Teams is not signed in: run node agent/teams-login.mjs'), { code: 'NO_LOGIN' });
    if (t.access_token && t.expires_at - 120_000 > now()) return t.access_token;
    const { ok, j } = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token, scope: SCOPES.join(' ') });
    if (!ok) throw Object.assign(new Error(`the Teams sign-in is no longer valid (${why(j)}): run node agent/teams-login.mjs again`), { code: 'LOGIN_EXPIRED' });
    return keep(j, t.account).access_token;
  }

  /** A Graph call. Throttling (429) and a busy service (503, 504) are waited out, as Graph asks (Retry-After). */
  async function call(method, path, body) {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(/^https:/.test(path) ? path : `${GRAPH}${path}`, {
        method,
        headers: { Authorization: `Bearer ${await accessToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
      if ([429, 503, 504].includes(res.status) && attempt < 4) {
        await sleep(Math.min(60, Number(res.headers.get('retry-after')) || 2 ** attempt) * 1000);
        continue;
      }
      if (res.status === 401 && attempt === 1 && held) {
        held.expires_at = 0; // a token revoked early: refresh once
        continue;
      }
      const text = await res.text();
      let j = {};
      try {
        j = text ? JSON.parse(text) : {};
      } catch {
        /* not JSON */
      }
      if (!res.ok) throw Object.assign(new Error(`Graph ${method} ${path.split('?')[0]} -> ${res.status}: ${j.error?.message ?? text.slice(0, 160)}`), { status: res.status, code: j.error?.code ?? null });
      return j;
    }
  }
  const get = (path) => call('GET', path);
  const post = (path, body) => call('POST', path, body);

  /**
   * The device code sign-in: `onCode` gets the code and the page to enter it on; resolves to the signed-in account.
   */
  async function deviceLogin({ onCode }) {
    const res = await fetch(`${authority}/devicecode`, { method: 'POST', headers: FORM, body: form({ client_id: clientId, scope: SCOPES.join(' ') }), signal: AbortSignal.timeout(30_000) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`the sign-in could not start: ${why(d)}`);
    onCode({ code: d.user_code, url: d.verification_uri, expiresIn: d.expires_in });
    const until = now() + (Number(d.expires_in) || 900) * 1000;
    let wait = (Number(d.interval) || 5) * 1000;
    while (now() < until) {
      await sleep(wait);
      const { ok, j } = await tokenRequest({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: d.device_code });
      if (ok) {
        keep(j, null);
        const me = await get('/me?$select=id,displayName,userPrincipalName');
        keep(j, { id: me.id, name: me.displayName, upn: me.userPrincipalName });
        return held.account;
      }
      if (j.error === 'authorization_pending') continue;
      if (j.error === 'slow_down') {
        wait += 5000;
        continue;
      }
      throw new Error(`the sign-in did not finish: ${why(j)}`);
    }
    throw new Error('the sign-in code expired: run it again');
  }

  return { deviceLogin, get, post, signedIn: () => Boolean(current()?.refresh_token), account: () => current()?.account ?? null };
}

/** One channel's messages through Graph: the newest roots with their replies, and a reply in a thread. */
export function channelApi(graph, { teamId, channelId }) {
  const base = `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}`;
  return {
    async recent(top = 30) {
      try {
        return (await graph.get(`${base}/messages?$top=${top}&$expand=replies`)).value ?? [];
      } catch (e) {
        if (e.status !== 400) throw e;
        // Without $expand: the replies of each root, one call each.
        const roots = (await graph.get(`${base}/messages?$top=${top}`)).value ?? [];
        for (const r of roots) r.replies = (await graph.get(`${base}/messages/${encodeURIComponent(r.id)}/replies?$top=50`)).value ?? [];
        return roots;
      }
    },
    reply: (rootId, html, mentions = []) => graph.post(`${base}/messages/${encodeURIComponent(rootId)}/replies`, { body: { contentType: 'html', content: html }, ...(mentions.length ? { mentions } : {}) }),
  };
}
