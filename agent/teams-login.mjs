#!/usr/bin/env node
// ROADMAP #9, T7: signs the agent in to Teams once, as the account that reads the team's channel and answers in it
// (a "Ticket Intelligence" user), finds the channel, and starts the inbox. Questions asked before the first sign-in are
// never answered. Reads the same .env as the agent: ~/.claude/skills/analyze-ticket/.env.
//
//   node agent/teams-login.mjs           sign in with a device code, find the channel, start reading
//   node agent/teams-login.mjs --check   who is signed in, which channel, one read; no sign-in
//
// Needs TEAMS_CLIENT_ID and TEAMS_TENANT_ID: an app registration in Microsoft Entra that allows public client flows,
// with the delegated permissions of lib/teams-graph.mjs (SCOPES) and the admin's consent (docs/ROADMAP.md #9).
// TEAMS_CHANNEL_URL says the team; TEAMS_CHANNEL_NAME picks the channel when the link is the team's and it has several.

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
  console.log('(single tenant, no redirect URI); Authentication › Allow public client flows: Yes; API permissions › Microsoft Graph ›');
  console.log('Delegated: ChannelMessage.Read.All, ChannelMessage.Send, Channel.ReadBasic.All, User.ReadBasic.All, offline_access;');
  console.log('Grant admin consent. Then put its Application (client) ID and Directory (tenant) ID in the .env that has TEAMS_WEBHOOK_URL:');
  console.log('  TEAMS_CLIENT_ID=…\n  TEAMS_TENANT_ID=…');
  process.exit(1);
}
const graph = createGraph({ ...settings, tokenFile: join(STATE, 'teams-token.json') });
const check = process.argv.includes('--check');

try {
  if (check) {
    if (!graph.signedIn()) throw new Error('not signed in yet: run node agent/teams-login.mjs');
    const me = await graph.get('/me?$select=displayName,userPrincipalName'); // also renews the token
    console.log(`Signed in as ${me.displayName} (${me.userPrincipalName}).`);
  } else {
    console.log('Sign in as the agent\'s account (Ticket Intelligence), not as yourself: a private browser window is best.');
    const me = await graph.deviceLogin({ onCode: ({ code, url }) => console.log(`\n  Open ${url}\n  and enter the code ${code}\n\nWaiting for the sign-in…`) });
    console.log(`Signed in as ${me.name} (${me.upn}).`);
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
  if (!check) writeInboxState(join(STATE, 'teams-inbox.json'), st);
  console.log(`Channel: ${channel.displayName} (read: ${roots.length} recent posts).`);
  console.log(check
    ? `The inbox reads it from ${st.since}${same ? '' : ' (not started yet: run without --check)'}.`
    : `The agent answers the questions asked there from ${st.since} on ("ti: status VAX-21"). Restart the watcher: node agent/watcher.mjs --replace`);
} catch (e) {
  console.error(`Not done: ${e.message}`);
  process.exit(1);
}
