#!/usr/bin/env node
// Ticket Intelligence agent: watches a Jira project, analyzes every new ticket headless, acts per policy.json,
// and serves a live dashboard.
//
//   node agent/watcher.mjs              → dashboard on http://localhost:7070
//   node agent/watcher.mjs --replace    stops a watcher that is already running (e.g. with older code), then starts
//
// A ticket is picked when it is in the project, not Done, created within lookbackHours, and has none of the
// agent's labels (ai-analyzing, ai-analyzed, ai-failed) nor the opt-out label (no-ai).

import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEventLog } from './lib/events.mjs';
import { createJira } from './lib/jira-actions.mjs';
import { documentResolved } from './lib/document.mjs';
import { processTicket } from './lib/pipeline.mjs';
import { currentBranch, previewBranch } from './lib/preview.mjs';
import { reviewPullRequest } from './lib/review.mjs';
import { buildInsights, readRecommendations, writeRecommendations } from './lib/insights.mjs';
import { askQuestion } from './lib/ask.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(HERE, 'agent.config.json'), 'utf8'));
const policy = JSON.parse(readFileSync(join(HERE, 'policy.json'), 'utf8'));
const stateDir = join(HERE, 'state');
const repoDir = resolve(HERE, cfg.repo);
const PID_FILE = join(stateDir, 'watcher.pid');

// ---------------------------------------------------------------- single instance

const readPid = () => {
  try {
    return JSON.parse(readFileSync(PID_FILE, 'utf8'));
  } catch {
    return null;
  }
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
/** A watcher started without a pid file (older code): the process listening on the dashboard port, if it is one. */
function watcherOnPort(port) {
  try {
    if (process.platform === 'win32') {
      const ps = `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)"; "$($p.ProcessId)|$($p.CreationDate.ToString('o'))|$($p.CommandLine)" }`;
      const [pid, startedAt, cmd] = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('|');
      return pid && /watcher\.mjs/.test(cmd ?? '') ? { pid: Number(pid), startedAt } : null;
    }
    const pid = Number(execFileSync('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[0]);
    const cmd = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
    return pid && /watcher\.mjs/.test(cmd) ? { pid, startedAt: null } : null;
  } catch {
    return null;
  }
}

const fromFile = readPid();
const previous = fromFile?.pid && fromFile.pid !== process.pid && alive(fromFile.pid) ? fromFile : watcherOnPort(cfg.dashboardPort);
if (previous?.pid && previous.pid !== process.pid && alive(previous.pid)) {
  if (!process.argv.includes('--replace')) {
    console.error(`A watcher is already running (PID ${previous.pid}${previous.startedAt ? `, started ${new Date(previous.startedAt).toLocaleString('en-GB')}` : ''}).`);
    console.error('To restart it with the current code: node agent/watcher.mjs --replace');
    process.exit(1);
  }
  process.kill(previous.pid);
  for (let i = 0; i < 50 && alive(previous.pid); i++) await new Promise((r) => setTimeout(r, 100));
  console.log(`Stopped the previous watcher (PID ${previous.pid}).`);
}

const events = createEventLog(join(stateDir, 'events.jsonl'));
const jira = createJira();

const agentLabels = Object.values(cfg.labels);
const JQL = `project = ${cfg.project} AND created >= -${cfg.lookbackHours}h AND statusCategory != Done AND (labels is EMPTY OR labels not in (${agentLabels.join(', ')})) ORDER BY created ASC`;
// Resolved tickets the agent analyzed and has not documented yet.
const L = cfg.labels;
const DONE_JQL = `project = ${cfg.project} AND statusCategory = Done AND labels = ${L.done} AND labels not in (${[L.documenting, L.documented, L.docFailed, L.skip].join(', ')}) AND updated >= -${cfg.lookbackHours}h ORDER BY updated ASC`;

/** The GitHub repository of the application and whether it is private (a private repo answers 404 when signed out). */
function githubInfo() {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const slug = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/)?.slice(1, 3).join('/');
    if (!slug) return null;
    const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000 }).trim();
    return { repo: slug, private: gh(['repo', 'view', slug, '--json', 'visibility', '--jq', '.visibility']) === 'PRIVATE', login: gh(['api', 'user', '--jq', '.login']) };
  } catch {
    return null;
  }
}

const status = { project: cfg.project, repo: repoDir, jiraUrl: jira.baseUrl, policy: policy.actions, lastPoll: null, nextPoll: null, queue: [], processing: null, startedAt: new Date().toISOString(), pid: process.pid, appBranch: currentBranch(repoDir), github: githubInfo() };
const clients = new Set();
const broadcast = (event) => {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(line);
};
events.subscribe(broadcast);
const pushStatus = () => {
  status.appBranch = currentBranch(repoDir);
  broadcast({ type: 'status', status });
};

// ---------------------------------------------------------------- watching

async function recoverStuckTickets() {
  const stuck = await jira.search(`project = ${cfg.project} AND labels in (${cfg.labels.inProgress}, ${cfg.labels.documenting})`, 50);
  for (const t of stuck) {
    await jira.labels(t.key, { remove: [cfg.labels.inProgress, cfg.labels.documenting] });
    events.emit('recovered', { key: t.key, text: 'removed a stale in-progress label from an interrupted run' });
  }
}

const isBusyWith = (key) => status.processing?.key === key || status.queue.some((q) => q.key === key);

let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try {
    const found = (await jira.search(JQL, 20)).map((i) => ({ ...i, kind: 'analyze' }));
    const resolved = policy.actions.documentOnDone === 'auto' ? (await jira.search(DONE_JQL, 20)).map((i) => ({ ...i, kind: 'document' })) : [];
    status.lastPoll = new Date().toISOString();
    for (const issue of [...found, ...resolved]) {
      if (isBusyWith(issue.key)) continue;
      status.queue.push(issue);
      events.emit(issue.kind === 'document' ? 'resolved' : 'queued', { key: issue.key, text: issue.kind === 'document' ? 'ticket moved to Done: documentation queued' : issue.summary, url: jira.browseUrl(issue.key), priority: issue.priority, reporter: issue.reporter });
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

/**
 * Run the full pipeline again for a ticket (after its title or description was edited, or after a failure):
 * the agent's result labels are removed and the ticket is queued now. `no-ai` is respected.
 */
async function rerun(key) {
  if (!new RegExp(`^${cfg.project}-\\d+$`).test(key)) throw Object.assign(new Error(`${key} is not a ${cfg.project} ticket key`), { status: 400 });
  if (isBusyWith(key)) throw Object.assign(new Error(`${key} is already queued or running`), { status: 409 });
  const [issue] = await jira.search(`key = ${key}`, 1);
  if (!issue) throw Object.assign(new Error(`${key} not found`), { status: 404 });
  if (issue.labels.includes(L.skip)) throw Object.assign(new Error(`${key} has the ${L.skip} label`), { status: 409 });
  await jira.labels(key, { remove: [L.done, L.failed, L.fixProposed] });
  status.queue.push({ ...issue, kind: 'analyze' });
  events.emit('queued', { key, text: issue.summary, url: jira.browseUrl(key), priority: issue.priority, reporter: issue.reporter, rerun: true });
  pushStatus();
  drain();
}

async function documentTicket(issue) {
  const key = issue.key;
  try {
    await jira.labels(key, { add: [L.documenting] });
    await documentResolved({ issue, repoDir, stateDir, cfg, jira, events });
    await jira.labels(key, { add: [L.documented], remove: [L.documenting] });
  } catch (e) {
    events.emit('doc-failed', { key, text: e.message });
    await jira.labels(key, { add: [L.docFailed], remove: [L.documenting] }).catch(() => {});
  }
}

async function drain() {
  if (status.processing || !status.queue.length) return;
  const issue = status.queue.shift();
  status.processing = { key: issue.key, kind: issue.kind, since: new Date().toISOString() };
  pushStatus();
  if (issue.kind === 'document') await documentTicket(issue);
  else if (issue.kind === 'review') await reviewPullRequest({ key: issue.key, repoDir, stateDir, cfg, events, jira });
  else await processTicket({ issue, cfg, policy, jira, events, repoDir, stateDir, followUp: (job) => status.queue.push(job) });
  status.processing = null;
  pushStatus();
  drain();
}

// ---------------------------------------------------------------- insights

let insightsCache = null;
let recommending = false;
let asking = false;
async function insightsCached(refresh = false) {
  if (!refresh && insightsCache && Date.now() - insightsCache.at < 120_000) return insightsCache.data;
  const data = await buildInsights({ repoDir, stateDir, cfg, jira });
  insightsCache = { at: Date.now(), data };
  return data;
}

// ---------------------------------------------------------------- dashboard

const page = () => readFileSync(join(HERE, 'dashboard', 'index.html'));
const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((ok) => {
    let data = '';
    req.on('data', (c) => (data += c.length < 10_000 ? c : ''));
    req.on('end', () => {
      try {
        ok(JSON.parse(data || '{}'));
      } catch {
        ok({});
      }
    });
  });

// The dashboard and its API (run, preview, ask) are for this machine only: they start agent runs that cost money
// and read the code. Requests from other machines are refused unless dashboardAllowRemote is set.
const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;
const server = createServer(async (req, res) => {
  if (!cfg.dashboardAllowRemote && !LOOPBACK.test(req.socket.remoteAddress ?? '')) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('The agent dashboard only answers on this machine (dashboardAllowRemote is off).');
  }
  const path = req.url.split('?')[0];
  if (path === '/' || path === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(page());
  }
  if (path === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ type: 'history', events: events.history() })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'status', status })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (path === '/api/status') {
    status.appBranch = currentBranch(repoDir);
    return json(res, 200, status);
  }
  // Evidence screenshots: /evidence/<KEY>/before.png|after.png (only these names, only from state/work).
  // The dashboard adds ?<timestamp> to bust the cache, so the path is matched without the query string.
  const ev = path.match(/^\/evidence\/([A-Z][A-Z0-9_]+-\d+)\/(before|after)\.png$/);
  if (ev) {
    const file = join(stateDir, 'work', ev[1], 'evidence', `${ev[2]}.png`);
    if (!existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
    return res.end(readFileSync(file));
  }
  if (req.method === 'POST' && path === '/api/poll') {
    poll();
    return json(res, 202, { ok: true });
  }
  if (req.method === 'POST' && path === '/api/run') {
    const { key } = await readBody(req);
    try {
      await rerun(String(key ?? '').trim().toUpperCase());
      return json(res, 202, { ok: true });
    } catch (e) {
      return json(res, e.status ?? 500, { ok: false, error: e.message });
    }
  }
  // Hotspot map (FR-64): computed on request (git + Jira + saved analyses), cached for two minutes.
  if (req.method === 'GET' && path === '/api/insights') {
    try {
      const data = await insightsCached(req.url.includes('refresh=1'));
      return json(res, 200, { ...data, recommendations: readRecommendations(stateDir, data) });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }
  if (req.method === 'POST' && path === '/api/insights/recommend') {
    if (recommending) return json(res, 409, { ok: false, error: 'recommendations are being written already' });
    recommending = true;
    try {
      const data = await insightsCached(true);
      const rec = await writeRecommendations({ insights: data, stateDir, cfg });
      events.emit('insights', { text: `hotspot recommendations written for ${rec.recommendations.length} component(s)`, meta: rec.meta });
      return json(res, 200, { ok: true, recommendations: { ...rec, stale: false } });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    } finally {
      recommending = false;
    }
  }
  // Ask the knowledge base (FR-65): one question at a time; progress goes to the dashboard stream (not the event log).
  if (req.method === 'POST' && path === '/api/ask') {
    if (asking) return json(res, 409, { ok: false, error: 'another question is being answered; try again in a minute' });
    const { question, id } = await readBody(req);
    asking = true;
    try {
      const answer = await askQuestion({ question, repoDir, stateDir, cfg, jira, onProgress: (step) => broadcast({ type: 'ask-progress', id, step }) });
      return json(res, 200, { ok: true, ...answer });
    } catch (e) {
      return json(res, e.status ?? 500, { ok: false, error: e.message });
    } finally {
      asking = false;
    }
  }
  if (req.method === 'POST' && path === '/api/preview') {
    const { branch } = await readBody(req);
    try {
      const r = await previewBranch({ repoDir, branch: String(branch ?? '') });
      events.emit('preview', { key: r.branch === 'main' ? undefined : r.branch, text: `the app on :4200 now shows ${r.branch}` });
      pushStatus();
      return json(res, 200, { ok: true, ...r });
    } catch (e) {
      return json(res, 409, { ok: false, error: e.message });
    }
  }
  res.writeHead(404);
  res.end();
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${cfg.dashboardPort} is in use by another program (not a watcher this script started).`);
    console.error(`Find it: Get-NetTCPConnection -LocalPort ${cfg.dashboardPort} -State Listen | Select OwningProcess`);
  } else console.error(e.message);
  process.exit(1);
});
server.listen(cfg.dashboardPort, () => {
  writeFileSync(PID_FILE, JSON.stringify({ pid: process.pid, startedAt: status.startedAt }));
  console.log(`Dashboard: http://localhost:${cfg.dashboardPort}`);
  console.log(`Watching ${cfg.project} every ${cfg.pollSeconds}s · repo ${repoDir} · app shows ${status.appBranch}`);
});
const cleanup = () => {
  if (readPid()?.pid === process.pid) rmSync(PID_FILE, { force: true });
};
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));

setInterval(() => broadcast({ type: 'ping', at: new Date().toISOString() }), 15_000);
events.emit('started', { text: `watching ${cfg.project} every ${cfg.pollSeconds}s` });
await recoverStuckTickets().catch((e) => events.emit('error', { text: `recovery failed: ${e.message}` }));
await poll();
setInterval(poll, cfg.pollSeconds * 1000);
