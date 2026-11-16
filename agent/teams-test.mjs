#!/usr/bin/env node
// Sends one test message to the Teams channel of TEAMS_WEBHOOK_URL, to check the webhook before the agent uses it
// (T2 of docs/GIT_GRAPH.md). Reads the same .env as the agent: ~/.claude/skills/analyze-ticket/.env.
//
//   node agent/teams-test.mjs
//   node agent/teams-test.mjs --mention "Marta Ricci"   the message @mentions that person (T4): checks TEAMS_MENTIONS
//                                                       or TEAMS_MENTION_DOMAIN for them
//   node agent/teams-test.mjs --mention "Marta Ricci" --fix   the second message instead, "fix ready for review" (T6)
//   --ticket DEM-46   Open in Jira opens that ticket (and --fix links its pull request when the agent opened one).
//                     Without it a test has no ticket: its buttons open Jira's and GitHub's home pages, and it says so.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../.claude/skills/analyze-ticket/scripts/lib/config.mjs';
import { mentionFor, notifyFixReady, notifyOwner, teamsInfo } from './lib/notify.mjs';
import { loadProjects } from './lib/projects.mjs';

const all = loadProjects(dirname(fileURLToPath(import.meta.url))); // a ticket's fix record: <stateDir>/work/<KEY>/fix.json
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

const ti = process.argv.indexOf('--ticket');
const ticket = ti > 0 ? String(process.argv[ti + 1] ?? '').trim().toUpperCase() : '';
if (ti > 0 && !/^[A-Z][A-Z0-9_]+-\d+$/.test(ticket)) {
  console.log('Usage: node agent/teams-test.mjs --ticket DEM-46');
  process.exit(1);
}
const base = String(cfg.baseUrl || '').replace(/\/+$/, '');
const jiraUrl = ticket && base ? `${base}/browse/${ticket}` : base || 'https://www.atlassian.com/software/jira';
const prOf = (key) => {
  try {
    return JSON.parse(readFileSync(join(all.ofTicket(key).stateDir, 'work', key, 'fix.json'), 'utf8')).prUrl ?? null;
  } catch {
    return null;
  }
};
const prUrl = (ticket && prOf(ticket)) || 'https://github.com/';
const where = ticket ? `the buttons open ${ticket}${prUrl === 'https://github.com/' ? ' (no pull request of the agent for it: the PR button opens GitHub)' : ' and its pull request'}` : "no ticket: the buttons open Jira's and GitHub's home pages (add --ticket DEM-46 for a real one)";
const n = process.argv.includes('--fix')
  ? await notifyFixReady({
    key: ticket || 'TEST',
    url: jiraUrl,
    prUrl,
    title: `A test: when the agent has a verified fix, this message says so, with the pull request to review. Here ${where}.`,
    to: person || 'the team',
    checks: { e2e: { ok: true, skipped: false, passed: 9, failed: 0 }, build: { ok: true, skipped: false } },
    bisect: { status: 'found', bad: { short: 'ad0251f', author: 'Tommaso Bruno', ticket: 'VAX-18' } },
  })
  : await notifyOwner({
    key: ticket || 'TEST',
    url: jiraUrl,
    title: 'Test message from Ticket Intelligence',
    handoff: person
      ? { to: person, message: `If ${person} got a notification, the agent can @mention owners in this channel. Nothing to do. A test: ${where}.` }
      : { to: 'the team', message: `If you can read this, the agent can post owner messages to this channel. Nothing to do. A test: ${where}.` },
    confidence: 'high',
    escalate: null,
    // What a real card adds (T5), so the test looks like one.
    ...(person ? { why: 'A test: here the agent says why it chose you, e.g. "Authored ad0251f (VAX-18), the suspect change in dates.ts".', where: 'frontend/src/app/shared/utils/dates.ts:35' } : {}),
  });
if (n.channel === 'teams') {
  console.log(`Posted (HTTP ${n.status}). It appears in the channel within a few seconds, sent "via Workflows" by the account that created the workflow.`);
  if (upn) {
    console.log(`It @mentions ${person} as ${upn}: their name is highlighted and they get a notification. If the name is plain text,`);
    console.log('Teams does not know that sign-in name (the message still arrives). The webhook accepts a message before the workflow');
    console.log("runs, so if nothing appears within a minute, the workflow's run history says why (Teams: Workflows › the workflow › Run history).");
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
