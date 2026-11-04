#!/usr/bin/env node
// Ticket Intelligence agent: watches a Jira project, analyzes every new ticket headless, acts per policy.json,
// and serves a live dashboard.
//
//   node agent/watcher.mjs            → dashboard on http://localhost:7070
//
// A ticket is picked when it is in the project, not Done, created within lookbackHours, and has none of the
// agent's labels (ai-analyzing, ai-analyzed, ai-failed) nor the opt-out label (no-ai).

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEventLog } from './lib/events.mjs';
import { createJira } from './lib/jira-actions.mjs';
import { processTicket } from './lib/pipeline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(HERE, 'agent.config.json'), 'utf8'));
const policy = JSON.parse(readFileSync(join(HERE, 'policy.json'), 'utf8'));
const stateDir = join(HERE, 'state');
const repoDir = resolve(HERE, cfg.repo);
const events = createEventLog(join(stateDir, 'events.jsonl'));
const jira = createJira();

const agentLabels = Object.values(cfg.labels);
const JQL = `project = ${cfg.project} AND created >= -${cfg.lookbackHours}h AND statusCategory != Done AND (labels is EMPTY OR labels not in (${agentLabels.join(', ')})) ORDER BY created ASC`;

const status = { project: cfg.project, repo: repoDir, jiraUrl: jira.baseUrl, policy: policy.actions, lastPoll: null, nextPoll: null, queue: [], processing: null, startedAt: new Date().toISOString() };
const clients = new Set();
const broadcast = (event) => {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(line);
};
events.subscribe(broadcast);
const pushStatus = () => broadcast({ type: 'status', status });

// ---------------------------------------------------------------- watching

async function recoverStuckTickets() {
  const stuck = await jira.search(`project = ${cfg.project} AND labels = ${cfg.labels.inProgress}`, 50);
  for (const t of stuck) {
    await jira.labels(t.key, { remove: [cfg.labels.inProgress] });
    events.emit('recovered', { key: t.key, text: 'removed a stale in-progress label from an interrupted run' });
  }
}

let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try {
    const found = await jira.search(JQL, 20);
    status.lastPoll = new Date().toISOString();
    for (const issue of found) {
      if (status.processing?.key === issue.key || status.queue.some((q) => q.key === issue.key)) continue;
      status.queue.push(issue);
      events.emit('queued', { key: issue.key, text: issue.summary, url: jira.browseUrl(issue.key), priority: issue.priority, reporter: issue.reporter });
    }
  } catch (e) {
    events.emit('error', { text: `poll failed: ${e.message}` });
  } finally {
    polling = false;
    status.nextPoll = new Date(Date.now() + cfg.pollSeconds * 1000).toISOString();
    pushStatus();
    drain();
  }
}

async function drain() {
  if (status.processing || !status.queue.length) return;
  const issue = status.queue.shift();
  status.processing = { key: issue.key, since: new Date().toISOString() };
  pushStatus();
  await processTicket({ issue, cfg, policy, jira, events, repoDir, stateDir });
  status.processing = null;
  pushStatus();
  drain();
}

// ---------------------------------------------------------------- dashboard

const page = () => readFileSync(join(HERE, 'dashboard', 'index.html'));
createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(page());
  }
  if (req.url === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ type: 'history', events: events.history() })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'status', status })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (req.url === '/api/poll' && req.method === 'POST') {
    poll();
    res.writeHead(202, { 'Content-Type': 'application/json' });
    return res.end('{"ok":true}');
  }
  res.writeHead(404);
  res.end();
}).listen(cfg.dashboardPort, () => {
  console.log(`Dashboard: http://localhost:${cfg.dashboardPort}`);
  console.log(`Watching ${cfg.project} every ${cfg.pollSeconds}s · repo ${repoDir}`);
});

setInterval(() => broadcast({ type: 'ping', at: new Date().toISOString() }), 15_000);
events.emit('started', { text: `watching ${cfg.project} every ${cfg.pollSeconds}s` });
await recoverStuckTickets().catch((e) => events.emit('error', { text: `recovery failed: ${e.message}` }));
await poll();
setInterval(poll, cfg.pollSeconds * 1000);
