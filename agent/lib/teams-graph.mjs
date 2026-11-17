// ROADMAP #9, T7: Microsoft Graph for the team's channel, as one signed-in account (delegated permissions). The agent
// signs in once (agent/teams-login.mjs): in a browser on this computer, or with a device code where the tenant allows
// it; the refresh token is kept in agent/state/ (not committed) and renewed on use, a secret like the webhook: never
// shown, logged or sent anywhere but Microsoft. Outbound only: the agent asks Graph; nothing calls the agent (the
// browser sign-in's one-time server listens on this computer's loopback only, for one answer). An application
// permission would need Microsoft's approval (reading channel messages is a protected API), so the delegated one is used.

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname } from 'node:path';

const GRAPH = 'https://graph.microsoft.com/v1.0';
/** What the account must be allowed (Microsoft Graph, delegated, the admin's consent): read the channel and its people, post replies. */
export const PERMISSIONS = ['User.Read', 'User.ReadBasic.All', 'Channel.ReadBasic.All', 'ChannelMessage.Read.All', 'ChannelMessage.Send'];
/**
 * What a sign-in asks for: the Graph permissions the admin gave the app registration (".default"), and
 * `offline_access` for the refresh token. Not the list itself: a permission the admin has not granted would stop the
 * sign-in at "Need admin approval", which does not say which one; asked this way the sign-in goes through and the
 * missing one is named (missingPermissions).
 */
export const SCOPES = ['offline_access', 'https://graph.microsoft.com/.default'];

/** The permissions of PERMISSIONS a sign-in did not get, from the token's `scope`; null when it is not known. */
export function missingPermissions(scope) {
  if (typeof scope !== 'string') return null;
  const got = new Set(scope.split(/\s+/).map((s) => s.replace(/^https:\/\/graph\.microsoft\.com\//i, '').toLowerCase()));
  return PERMISSIONS.filter((p) => !got.has(p.toLowerCase()));
}

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

/** The first line of a Microsoft sign-in error, with its AADSTS code: the code is what the docs and an admin look up. */
function signInError(j) {
  return String(j.error_description ?? j.error ?? 'no answer').split(/\r?\n/)[0].replace(/\s*Trace ID:.*$/, '').trim();
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const page = (title, text) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Ticket Intelligence</title>` +
  `<body style="font:16px/1.5 system-ui,sans-serif;margin:3rem auto;max-width:34rem;padding:0 1rem"><h1 style="font-size:1.3rem">${esc(title)}</h1><p>${esc(text)}</p>`;

/**
 * A one-time web server on this computer's loopback, IPv4 and (where there is one) IPv6, on one free port: the browser
 * resolves "localhost" to either. Nothing outside this computer can reach it.
 */
async function loopback(handler) {
  const listen = (port, host) =>
    new Promise((resolve, reject) => {
      const s = createServer(handler);
      s.once('error', reject);
      s.listen(port, host, () => resolve(s));
    });
  const v4 = await listen(0, '127.0.0.1');
  const port = v4.address().port;
  const v6 = await listen(port, '::1').catch(() => null);
  const servers = [v4, v6].filter(Boolean);
  return {
    port,
    close() {
      for (const s of servers) {
        s.close();
        s.closeIdleConnections?.(); // a browser keeps spare connections open: they would keep the process alive
      }
    },
  };
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
    held = { access_token: j.access_token, refresh_token: j.refresh_token ?? held?.refresh_token, expires_at: now() + (Number(j.expires_in) || 3600) * 1000, scope: j.scope ?? held?.scope ?? null, account, savedAt: new Date(now()).toISOString() };
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

  /** The tokens of a finished sign-in kept, with the account they belong to. */
  async function accountOf(j) {
    if (!j.refresh_token) throw new Error('signed in, but without a refresh token: add offline_access to the app\'s API permissions (Microsoft Graph, Delegated), grant admin consent, and run this again');
    keep(j, null);
    const me = await get('/me?$select=id,displayName,userPrincipalName');
    keep(j, { id: me.id, name: me.displayName, upn: me.userPrincipalName });
    return held.account;
  }

  /**
   * The browser sign-in: the authorization code with PKCE (RFC 7636), for a native app (RFC 8252). The way to sign in
   * where the device code is blocked: Security defaults block it (AADSTS530035), and so do many Conditional Access
   * policies. The browser comes back to a one-time server on this computer (the app's redirect URI http://localhost,
   * platform "Mobile and desktop applications"; Microsoft ignores the port of a loopback address). Only an answer with
   * this sign-in's `state` counts, and only this process holds the verifier the code is redeemed with.
   * `onUrl` gets the page to open; resolves to the signed-in account.
   */
  async function browserLogin({ onUrl, loginHint = null, timeoutMs = 10 * 60_000 }) {
    const verifier = randomBytes(32).toString('base64url');
    const state = randomBytes(16).toString('base64url');
    let settle;
    let answered = false;
    const answer = new Promise((resolve, reject) => {
      settle = { resolve, reject };
    });
    answer.catch(() => {}); // a late answer after the time is up is nobody's error
    const server = await loopback((req, res) => {
      // Connection: close, so that the server can be closed as soon as the sign-in is done
      const reply = (status, title, text) => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' }).end(page(title, text));
      };
      const q = new URL(req.url, 'http://localhost').searchParams;
      if (!q.has('code') && !q.has('error')) return reply(404, 'Nothing here', 'This page only takes the Teams sign-in back to the agent.');
      if (q.get('state') !== state) return reply(400, 'Not this sign-in', 'This answer belongs to an earlier sign-in. Use the newest link of node agent/teams-login.mjs.');
      if (answered) return reply(409, 'Already answered', 'This sign-in has its answer. You can close this window.');
      answered = true;
      if (q.has('error')) {
        const why = signInError({ error: q.get('error'), error_description: q.get('error_description') });
        reply(400, 'The sign-in did not finish', why);
        return settle.reject(new Error(`the sign-in did not finish: ${why}`));
      }
      settle.resolve({ code: q.get('code'), reply });
    });
    const redirectUri = `http://localhost:${server.port}`;
    const url = `${authority}/authorize?${form({
      client_id: clientId,
      response_type: 'code',
      response_mode: 'query',
      redirect_uri: redirectUri,
      scope: SCOPES.join(' '),
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      prompt: 'select_account', // the browser may already know someone else: the person running this, most often
      ...(loginHint ? { login_hint: loginHint } : {}),
    })}`;
    let timer;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('the sign-in did not finish in time: run it again')), timeoutMs);
      });
      onUrl({ url, redirectUri });
      const { code, reply } = await Promise.race([answer, timeout]);
      const { ok, j } = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier, scope: SCOPES.join(' ') });
      if (!ok) {
        reply(400, 'The sign-in did not finish', signInError(j));
        throw new Error(`the sign-in did not finish: ${signInError(j)}`);
      }
      const account = await accountOf(j);
      reply(200, 'Signed in', `The agent is signed in to Teams as ${account.name}. You can close this window.`);
      return account;
    } finally {
      clearTimeout(timer);
      server.close();
    }
  }

  /**
   * The device code sign-in: `onCode` gets the code and the page to enter it on; resolves to the signed-in account.
   * For a computer without a browser; tenants with Security defaults block it (AADSTS530035): browserLogin there.
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
      if (ok) return accountOf(j);
      if (j.error === 'authorization_pending') continue;
      if (j.error === 'slow_down') {
        wait += 5000;
        continue;
      }
      throw new Error(`the sign-in did not finish: ${signInError(j)}`);
    }
    throw new Error('the sign-in code expired: run it again');
  }

  return {
    browserLogin,
    deviceLogin,
    get,
    post,
    signedIn: () => Boolean(current()?.refresh_token),
    account: () => current()?.account ?? null,
    /** What the app registration still lacks, as of the last token (a renewal picks up a consent given since). */
    missingPermissions: () => missingPermissions(current()?.scope),
    /** A new access token now, whatever the old one's time: with the permissions as they are granted now. */
    async renew() {
      if (current()) held.expires_at = 0;
      await accessToken();
    },
  };
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
