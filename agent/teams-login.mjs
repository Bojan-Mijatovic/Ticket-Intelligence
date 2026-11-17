#!/usr/bin/env node
// ROADMAP #9, T7: signs the agent in to Teams once, as the account that reads the team's channel and answers in it
// (a "Ticket Intelligence" user), finds the channel, and starts the inbox. Questions asked before the first sign-in are
// never answered. Reads the same .env as the agent: ~/.claude/skills/analyze-ticket/.env.
//
//   node agent/teams-login.mjs                 sign in in a browser on this computer, find the channel, start reading
//   node agent/teams-login.mjs --as <account>  the same, with the agent's account already filled in
//   node agent/teams-login.mjs --no-browser    only print the sign-in page: open it in a private window here
//   node agent/teams-login.mjs --device-code   sign in with a code on another device (blocked by Security defaults)
//   node agent/teams-login.mjs --check         who is signed in, what the app still lacks, which channel, one read;
//                                              no sign-in (starts the inbox if a sign-in stopped before it)
//
// Needs TEAMS_CLIENT_ID and TEAMS_TENANT_ID: an app registration in Microsoft Entra with the redirect URI
// http://localhost (platform "Mobile and desktop applications"; for --device-code: Allow public client flows), the
// delegated permissions of lib/teams-graph.mjs (PERMISSIONS) and the admin's consent (docs/ROADMAP.md #9). The browser
// must be on this computer: the sign-in comes back to it. TEAMS_CHANNEL_URL says the team; TEAMS_CHANNEL_NAME picks
// the channel when the link is the team's and it has several.

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../.claude/skills/analyze-ticket/scripts/lib/config.mjs';
import { channelApi, createGraph, graphSettings, parseTeamsLink } from './lib/teams-graph.mjs';
import { readInboxState, startOf, writeInboxState } from './lib/teams-inbox.mjs';

const STATE = join(dirname(fileURLToPath(import.meta.url)), 'state');
loadConfig(); // also loads the .env files into process.env
const settings = graphSettings();
if (!settings) {
  console.log('TEAMS_CLIENT_ID and TEAMS_TENANT_ID are not set. In entra.microsoft.com: App registrations › New registration');
  console.log('(single tenant; redirect URI: Public client/native (mobile & desktop), http://localhost); API permissions › Microsoft Graph ›');
  console.log('Delegated: ChannelMessage.Read.All, ChannelMessage.Send, Channel.ReadBasic.All, User.ReadBasic.All, offline_access;');
  console.log('Grant admin consent. Then put its Application (client) ID and Directory (tenant) ID in the .env that has TEAMS_WEBHOOK_URL:');
  console.log('  TEAMS_CLIENT_ID=…\n  TEAMS_TENANT_ID=…');
  process.exit(1);
}
const graph = createGraph({ ...settings, tokenFile: join(STATE, 'teams-token.json') });
const args = process.argv.slice(2);
const check = args.includes('--check');
const as = args.includes('--as') ? args[args.indexOf('--as') + 1] ?? null : null;

/** The page in this computer's own browser; a failure only means it is opened by hand. */
function openBrowser(url) {
  const [cmd, argv] =
    process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] // no shell: the "&" of the link stays as it is
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  try {
    const p = spawn(cmd, argv, { detached: true, stdio: 'ignore' });
    p.on('error', () => {});
    p.unref();
  } catch {
    /* opened by hand */
  }
}

try {
  if (check) {
    if (!graph.signedIn()) throw new Error('not signed in yet: run node agent/teams-login.mjs');
    await graph.renew(); // with the permissions granted since the sign-in
    const me = await graph.get('/me?$select=displayName,userPrincipalName');
    console.log(`Signed in as ${me.displayName} (${me.userPrincipalName}).`);
  } else if (args.includes('--device-code')) {
    console.log('Sign in as the agent\'s account (Ticket Intelligence), not as yourself: a private browser window is best.');
    const me = await graph.deviceLogin({ onCode: ({ code, url }) => console.log(`\n  Open ${url}\n  and enter the code ${code}\n\nWaiting for the sign-in…`) });
    console.log(`Signed in as ${me.name} (${me.upn}).`);
  } else {
    const me = await graph.browserLogin({
      loginHint: as,
      onUrl: ({ url }) => {
        console.log('Sign in as the agent\'s account (Ticket Intelligence), not as yourself, in a browser on this computer.');
        console.log('If the page offers your own account, choose "Use another account", or open this link in a private window:');
        console.log(`\n  ${url}\n\nWaiting for the sign-in (10 minutes)…`);
        if (!args.includes('--no-browser')) openBrowser(url);
      },
    });
    console.log(`Signed in as ${me.name} (${me.upn}).`);
  }
  const missing = graph.missingPermissions();
  if (missing?.length) {
    throw new Error(
      `the app registration is not allowed ${missing.join(', ')}. In entra.microsoft.com › App registrations › the app › API permissions: ` +
        'Add a permission › Microsoft Graph › Delegated, add them, then "Grant admin consent", and run node agent/teams-login.mjs --check (no new sign-in needed)',
    );
  }

  const link = parseTeamsLink(process.env.TEAMS_CHANNEL_URL);
  if (!link?.teamId) throw new Error('TEAMS_CHANNEL_URL is not a Teams link with its team (groupId): in the channel, ⋯ › Get link to channel, and put it in .env');
  const channels = (await graph.get(`/teams/${encodeURIComponent(link.teamId)}/channels?$select=id,displayName`)).value ?? [];
  const want = String(process.env.TEAMS_CHANNEL_NAME ?? '').trim().toLowerCase();
  const channel = want
    ? channels.find((c) => c.displayName.toLowerCase() === want)
    : link.kind === 'channel'
      ? channels.find((c) => c.id === link.threadId)
      : channels.length === 1
        ? channels[0]
        : null;
  if (!channel) {
    throw new Error(`which channel does the agent read? The team has ${channels.length}: ${channels.map((c) => c.displayName).join(', ')}. Put TEAMS_CHANNEL_NAME=<one of them> in .env (or a "Get link to channel" link in TEAMS_CHANNEL_URL), then run this again`);
  }
  const roots = await channelApi(graph, { teamId: link.teamId, channelId: channel.id }).recent(5); // the permission to read it
  const prev = readInboxState(join(STATE, 'teams-inbox.json'));
  const same = prev?.channelId === channel.id;
  const st = { teamId: link.teamId, channelId: channel.id, channelName: channel.displayName, since: check && same ? prev.since : startOf(prev, channel.id), handled: same ? prev.handled ?? [] : [], threads: same ? prev.threads ?? {} : {} };
  // A check of a running inbox leaves its state alone: the watcher writes it too (what it has answered).
  const start = !check || !same;
  if (start) writeInboxState(join(STATE, 'teams-inbox.json'), st);
  console.log(`Channel: ${channel.displayName} (read: ${roots.length} recent posts).`);
  console.log(start
    ? `The agent answers the questions asked there from ${st.since} on ("ti: status VAX-21"). Restart the watcher: node agent/watcher.mjs --replace`
    : `The inbox reads it from ${st.since}.`);
} catch (e) {
  console.error(`Not done: ${e.message}`);
  process.exit(1);
}
