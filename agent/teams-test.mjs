#!/usr/bin/env node
// Sends one test message to the Teams channel of TEAMS_WEBHOOK_URL, to check the webhook before the agent uses it
// (T2 of docs/GIT_GRAPH.md). Reads the same .env as the agent: ~/.claude/skills/analyze-ticket/.env.
//
//   node agent/teams-test.mjs
//   node agent/teams-test.mjs --mention "Marta Ricci"   the message @mentions that person (T4): checks TEAMS_MENTIONS
//                                                       or TEAMS_MENTION_DOMAIN for them

import { loadConfig } from '../.claude/skills/analyze-ticket/scripts/lib/config.mjs';
import { mentionFor, notifyOwner, teamsInfo } from './lib/notify.mjs';

const cfg = loadConfig(); // also loads the .env files into process.env
const info = teamsInfo();
if (!info.live) {
  console.log('TEAMS_WEBHOOK_URL is not set. In the Teams channel: ⋯ › Workflows, search "webhook", pick "Send webhook alerts to a channel"');
  console.log('(or "Post to a channel when a webhook request is received"), copy the URL it gives, and put');
  console.log('  TEAMS_WEBHOOK_URL=<that URL>');
  console.log('in ~/.claude/skills/analyze-ticket/.env. Then run this again.');
  process.exit(1);
}

const at = process.argv.indexOf('--mention');
const person = at > 0 ? String(process.argv[at + 1] ?? '').trim() : '';
if (at > 0 && !person) {
  console.log('Usage: node agent/teams-test.mjs --mention "First Last"');
  process.exit(1);
}
const upn = person ? mentionFor(person) : null;
if (person && !upn) {
  console.log(`No Teams account for "${person}": set TEAMS_MENTION_DOMAIN=<domain> (first.last@domain for everyone) or`);
  console.log(`TEAMS_MENTIONS=${person}=<their sign-in email>; ... in the .env, then run this again.`);
  process.exit(1);
}

const n = await notifyOwner({
  key: 'TEST',
  url: cfg.baseUrl || 'https://www.atlassian.com/software/jira',
  title: 'Test message from Ticket Intelligence',
  handoff: person
    ? { to: person, message: `If ${person} got a notification, the agent can @mention owners in this channel. Nothing to do.` }
    : { to: 'the team', message: 'If you can read this, the agent can post owner messages to this channel. Nothing to do.' },
  confidence: 'high',
  escalate: null,
});
if (n.channel === 'teams') {
  console.log(`Posted (HTTP ${n.status}). It appears in the channel within a few seconds, sent "via Workflows" by the account that created the workflow.`);
  if (upn) {
    console.log(`It @mentions ${person} as ${upn}. The webhook accepts the message before the workflow runs: if nothing appears within`);
    console.log('a minute, the workflow failed afterwards, most often on a sign-in name Teams does not know or a person who is not');
    console.log("a member of the team. The workflow's run history says why (Teams: Workflows › the workflow › Run history).");
  }
  console.log(info.channelUrl ? `The dashboard links to the channel: ${info.channelUrl}` : 'Optional: TEAMS_CHANNEL_URL=<the channel\'s link, ⋯ › Get link to channel> gives the dashboard an "Open in Teams" link.');
  console.log('Restart the watcher (node agent/watcher.mjs --replace) so that it reads the new settings.');
  process.exit(0);
}
console.log(`Not posted: ${n.error}`);
const hint = {
  400: 'the workflow did not accept the card: check that it comes from the "Send webhook alerts to a channel" (or "Post to a channel when a webhook request is received") template, unchanged.',
  401: 'the workflow only accepts signed-in callers: in the workflow\'s trigger, set "Who can trigger the flow?" to "Anyone".',
  403: 'the workflow only accepts signed-in callers: in the workflow\'s trigger, set "Who can trigger the flow?" to "Anyone".',
  404: 'the URL is wrong, or the workflow was deleted or turned off.',
}[n.status];
console.log(hint ? `Likely: ${hint}` : 'Check the URL, that the workflow is on, and that this machine can reach it (proxy, firewall).');
process.exit(1);
