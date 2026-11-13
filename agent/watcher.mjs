#!/usr/bin/env node
// Ticket Intelligence agent: watches the Jira projects of agent.config.json "projects", analyzes every new ticket
// headless in its own application repository, acts per policy.json, and serves one live dashboard for all of them.
//
//   node agent/watcher.mjs              → dashboard on http://localhost:7070
//   node agent/watcher.mjs --replace    stops a watcher that is already running (e.g. with older code), then starts
//
// A ticket is picked when it is in one of the projects, not Done, created within lookbackHours, and has none of the
// agent's labels (ai-analyzing, ai-analyzed, ai-failed) nor the opt-out label (no-ai). One queue for all projects.

import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEventLog } from './lib/events.mjs';
import { createJira } from './lib/jira-actions.mjs';
import { createJiraHealth } from './lib/jira-health.mjs';
import { documentResolved } from './lib/document.mjs';
import { createDocsPrs } from './lib/docs-prs.mjs';
import { repoKnowledge } from './lib/doc-candidates.mjs';
import { loadPriorArtSources } from './lib/prior-art.mjs';
import { knowledgeGaps, readAsks } from './lib/gaps.mjs';
import { processTicket } from './lib/pipeline.mjs';
import { currentBranch, previewBranch } from './lib/preview.mjs';
import { reviewPullRequest } from './lib/review.mjs';
import { buildInsights, readRecommendations, savedAnalyses, writeRecommendations } from './lib/insights.mjs';
import { readReview, writeReview } from './lib/app-review.mjs';
import { createSuggested, readCreated, suggestTickets } from './lib/suggestions.mjs';
import { suiteInsights } from './lib/suite.mjs';
import { askQuestion } from './lib/ask.mjs';
import { recordedAsks, recordedRuns } from './lib/tour.mjs';
import { attachMailUpdates } from './lib/mail-updates.mjs';
import { loadProjects, peerCheckouts, teamOf } from './lib/projects.mjs';
import { loadGraph, readSuitePullRequests } from './lib/git-graph.mjs';
import { readBlameOrigins, recordAccuracy, scoreAccuracy } from './lib/accuracy.mjs';
import { laneLayout } from './lib/graph-lanes.mjs';
import { readReplays } from './lib/replay.mjs';
import { impactOf } from './lib/impact.mjs';
import { guardCommit } from './lib/regression-guard.mjs';
import { createRedactor } from '../.claude/skills/analyze-ticket/scripts/lib/redact.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const all = loadProjects(HERE);
const cfg = all.global; // settings shared by all projects (labels, poll, dashboard, claude, mail)
const policy = JSON.parse(readFileSync(join(HERE, 'policy.json'), 'utf8'));
const rootState = join(HERE, 'state'); // the watcher's own files: pid, event log
const PID_FILE = join(rootState, 'watcher.pid');
const KEYS = all.projects.map((p) => p.key);
const badRequest = (message, code = 400) => Object.assign(new Error(message), { status: code });
/** The project of a request: by its key, or by the ticket key; the only project when there is just one. */
function projectFor({ project, key } = {}) {
  const p = project ? all.byKey(project) : key ? all.ofTicket(key) : all.projects.length === 1 ? all.projects[0] : null;
  if (!p) throw badRequest(project || key ? `${project ?? key} is not one of the projects ${KEYS.join(', ')}` : `which project? one of ${KEYS.join(', ')}`);
  return p;
}

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

const events = createEventLog(join(rootState, 'events.jsonl'));
const jira = createJira();
jira.allowTeam(teamOf(all.projects)); // R-02: the team's names stay readable in the masked ticket text
const mail = attachMailUpdates({ events, policy, cfg, browseUrl: (key) => jira.browseUrl(key) });

const agentLabels = Object.values(cfg.labels);
// Only projects whose application clone exists are watched: a ticket of a project without code cannot be analyzed,
// and JQL rejects the whole query for a project key that does not exist in Jira yet.
const WATCHED = all.projects.filter((p) => existsSync(p.repoDir)).map((p) => p.key);
if (!WATCHED.length) {
  console.error(`None of the application clones exist: ${all.projects.map((p) => p.repoDir).join(', ')}`);
  process.exit(1);
}
const IN_PROJECTS = `project in (${WATCHED.join(', ')})`;
// A ticket is picked only after it has not changed for settleMinutes: reporters often create it with a title and
// add the description right after, and an analysis of the half-written ticket says "no description, low confidence"
// (DEM-31, DEM-32, DEM-35). Run again on the dashboard does not wait.
const SETTLE = Math.max(0, Number(cfg.settleMinutes ?? 1));
const JQL = `${IN_PROJECTS} AND created >= -${cfg.lookbackHours}h AND statusCategory != Done AND (labels is EMPTY OR labels not in (${agentLabels.join(', ')}))${SETTLE ? ` AND updated <= -${SETTLE}m` : ''} ORDER BY created ASC`;
// Resolved tickets not documented yet (K4 of docs/KNOWLEDGE_PLAN.md). policy.json documentScope: 'analyzed' = only
// tickets the agent analyzed; 'withFix' (default) = also bugs it did not analyze, when a commit on main names the
// ticket or a branch named after it holds the fix. The window reaches back to the last check (state/done-poll.json),
// at least lookbackHours, so tickets resolved while the watcher was down are not lost.
const L = cfg.labels;
const DOC_SCOPE = policy.documentScope ?? 'withFix';
const DONE_FILE = join(rootState, 'done-poll.json');
function doneJql() {
  let last = null;
  try {
    last = Date.parse(JSON.parse(readFileSync(DONE_FILE, 'utf8')).since);
  } catch {
    /* first check */
  }
  const from = Math.min(Number.isFinite(last) ? last : Infinity, Date.now() - cfg.lookbackHours * 3600_000);
  const minutes = Math.ceil((Date.now() - from) / 60_000) + 10; // relative: no time zone to get wrong; 10 min margin
  const scope = DOC_SCOPE === 'analyzed' ? `labels = ${L.done} AND ` : '';
  return `${IN_PROJECTS} AND statusCategory = Done AND ${scope}(labels is EMPTY OR labels not in (${[L.documenting, L.documented, L.docFailed, L.skip].join(', ')})) AND updated >= -${minutes}m ORDER BY updated ASC`;
}
/** The resolved tickets to document now: the agent's own, and (withFix) bugs with their fix on main or a branch. */
async function doneCandidates() {
  const checkedAt = new Date().toISOString();
  const list = await jira.search(doneJql(), 50);
  const out = [];
  const knownOf = new Map(); // project → what its repository knows (one fetch per poll, only when needed)
  for (const i of list) {
    if (i.labels.includes(L.done)) {
      out.push(i);
      continue;
    }
    if (DOC_SCOPE !== 'withFix' || !/bug/i.test(i.issueType ?? '')) continue;
    const p = all.ofTicket(i.key);
    if (!p) continue;
    if (!knownOf.has(p.key)) knownOf.set(p.key, repoKnowledge(p.repoDir));
    const k = knownOf.get(p.key);
    if (k.documented.has(i.key) || k.pending.has(i.key)) continue;
    if (k.keyCommits.has(i.key) || k.fixBranches.has(i.key)) out.push(i);
  }
  writeFileSync(DONE_FILE, JSON.stringify({ since: checkedAt }));
  return out;
}

/** The GitHub repository of an application and whether it is private (a private repo answers 404 when signed out). */
function githubInfo(repoDir) {
  if (!existsSync(repoDir)) return null;
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

const projectStatus = (p) => ({
  key: p.key, name: p.name, description: p.cfg.description, repo: p.repoDir, ready: existsSync(p.repoDir), app: p.app, linked: p.linked,
  appBranch: existsSync(p.repoDir) ? currentBranch(p.repoDir) : null, github: githubInfo(p.repoDir), askExamples: p.askExamples,
});
const status = { projects: all.projects.map(projectStatus), jiraUrl: jira.baseUrl, jira: { ok: null, error: null, warnings: [] }, policy: policy.actions, lastPoll: null, nextPoll: null, queue: [], processing: null, startedAt: new Date().toISOString(), pid: process.pid };
const clients = new Set();
const broadcast = (event) => {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(line);
};
events.subscribe(broadcast);
const refreshBranches = () => {
  for (const s of status.projects) s.appBranch = s.ready ? currentBranch(s.repo) : null;
};
const pushStatus = () => {
  refreshBranches();
  broadcast({ type: 'status', status });
};

// Jira health: with rejected credentials Jira answers every search with an empty list instead of an error, so the
// watcher checks the credentials and the projects first. While Jira is unavailable, the poll, the queue and the
// dashboard features that read Jira wait, and the header says why (jira-health.mjs).
const SEEN_FILE = join(rootState, 'jira-health.json');
const readSeen = () => {
  try {
    return JSON.parse(readFileSync(SEEN_FILE, 'utf8')).seen ?? {};
  } catch {
    return {};
  }
};
const health = createJiraHealth({
  jira,
  projects: WATCHED,
  seen: readSeen(),
  onSeen: (seen) => writeFileSync(SEEN_FILE, JSON.stringify({ seen }, null, 2)),
  onChange: (now, before) => {
    status.jira = { ok: now.ok, error: now.error, user: now.user, warnings: now.warnings, checkedAt: now.checkedAt };
    if (now.ok === false && before.ok !== false) events.emit('jira-down', { text: `Jira unavailable: ${now.error}. The agent waits until Jira answers again.` });
    else if (now.ok === false) events.emit('error', { text: `Jira still unavailable: ${now.error}` });
    if (now.ok && before.ok === false) {
      events.emit('jira-up', { text: `Jira answers again (as ${now.user}); the agent continues` });
      recoverStuckTickets().catch((e) => events.emit('error', { text: `recovery failed: ${e.message}` }));
    }
    for (const w of now.warnings.filter((x) => !before.warnings.includes(x))) events.emit('error', { text: w });
    pushStatus();
  },
});

// ---------------------------------------------------------------- watching

async function recoverStuckTickets() {
  const stuck = await jira.search(`${IN_PROJECTS} AND labels in (${cfg.labels.inProgress}, ${cfg.labels.documenting})`, 50);
  for (const t of stuck) {
    if (isBusyWith(t.key)) continue; // running now (recovery also runs when Jira answers again)
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
    if ((await health.check()).ok === false) {
      status.lastPoll = new Date().toISOString();
      return; // an empty search would only look like "no new tickets"
    }
    const found = (await jira.search(JQL, 20)).map((i) => ({ ...i, kind: 'analyze' }));
    const resolved = policy.actions.documentOnDone === 'auto' ? (await doneCandidates()).map((i) => ({ ...i, kind: 'document' })) : [];
    status.lastPoll = new Date().toISOString();
    for (const issue of [...found, ...resolved]) {
      if (isBusyWith(issue.key)) continue;
      status.queue.push(issue);
      const docText = issue.labels?.includes(L.done) ? 'ticket moved to Done: documentation queued' : `${issue.summary} · resolved without the agent: documentation queued`;
      events.emit(issue.kind === 'document' ? 'resolved' : 'queued', { key: issue.key, text: issue.kind === 'document' ? docText : issue.summary, url: jira.browseUrl(issue.key), priority: issue.priority, reporter: issue.reporter });
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
  if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(key) || !WATCHED.includes(key.split('-')[0])) throw badRequest(`${key} is not a ticket of the watched projects ${WATCHED.join(', ')}`);
  await health.require();
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

async function documentTicket(issue, p) {
  const key = issue.key;
  try {
    await jira.labels(key, { add: [L.documenting] });
    await documentResolved({ issue, repoDir: p.repoDir, stateDir: p.stateDir, cfg: p.cfg, jira, events });
    await jira.labels(key, { add: [L.documented], remove: [L.documenting] });
  } catch (e) {
    events.emit('doc-failed', { key, text: e.message });
    await jira.labels(key, { add: [L.docFailed], remove: [L.documenting] }).catch(() => {});
  }
}

async function drain() {
  // While Jira is unavailable the queue waits: every step of a ticket reads or writes Jira. The poll that sees Jira
  // again calls drain().
  if (status.processing || !status.queue.length || status.jira.ok === false) return;
  const issue = status.queue.shift();
  status.processing = { key: issue.key ?? `${issue.project} ${String(issue.sha).slice(0, 7)}`, kind: issue.kind, since: new Date().toISOString() };
  pushStatus();
  if (issue.kind === 'guard') await runGuard(issue);
  else {
    const p = all.ofTicket(issue.key);
    if (issue.kind === 'document') await documentTicket(issue, p);
    else if (issue.kind === 'review') await reviewPullRequest({ key: issue.key, repoDir: p.repoDir, stateDir: p.stateDir, cfg: p.cfg, events, jira });
    else {
      await processTicket({
        issue, cfg: p.cfg, policy, jira, events, repoDir: p.repoDir, stateDir: p.stateDir, project: { key: p.key, name: p.name },
        peers: (warn) => peerCheckouts(p, all, warn), followUp: (job) => status.queue.push(job),
      });
    }
  }
  status.processing = null;
  pushStatus();
  drain();
}

// ---------------------------------------------------------------- regression guard (A1)
// Every new commit on a watched project's main is checked for the earlier bug fixes it touches, and their regression
// tests run on it (lib/regression-guard.mjs, policy regressionGuard). The first look at a project only records where
// its main is. A guard runs in the queue like any job, so its tests never overlap a fix's.

const GUARD_SECONDS = Number(cfg.guardSeconds ?? 120);
const AGENT_DIR = HERE;
const guardFile = (p) => join(p.stateDir, 'guard.json');
const resolvedBugs = new Map(); // project key → { at, keys }: the project's resolved bugs in Jira, 10 minutes
async function fixKeysOf(p) {
  const hit = resolvedBugs.get(p.key);
  if (hit && Date.now() - hit.at < 600_000) return hit.keys;
  let keys = new Set();
  try {
    keys = new Set((await jira.search(`project = ${p.key} AND issuetype = Bug AND statusCategory = Done`, 200)).map((i) => i.key));
  } catch {
    /* Jira unavailable: the documented bugs (docs/knowledge) still count */
  }
  resolvedBugs.set(p.key, { at: Date.now(), keys });
  return keys;
}

let checkingMains = false;
async function checkMains() {
  if (checkingMains || policy.actions.regressionGuard !== 'auto') return;
  checkingMains = true;
  try {
    for (const p of all.projects.filter((x) => WATCHED.includes(x.key))) {
      const git = (args) => execFileSync('git', args, { cwd: p.repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60_000 }).trim();
      let head;
      try {
        git(['fetch', '-q', 'origin', 'main']);
        head = git(['rev-parse', 'origin/main']);
      } catch {
        continue; // no git remote (SVN) or offline
      }
      let seen = null;
      try {
        seen = JSON.parse(readFileSync(guardFile(p), 'utf8')).head;
      } catch {
        /* first look */
      }
      writeFileSync(guardFile(p), JSON.stringify({ head, at: new Date().toISOString() }));
      if (!seen || seen === head) continue;
      const shas = git(['rev-list', '--first-parent', '--reverse', `${seen}..${head}`]).split('\n').filter(Boolean).slice(-20);
      for (const sha of shas) status.queue.push({ kind: 'guard', project: p.key, sha, key: null });
    }
  } catch (e) {
    events.emit('error', { text: `regression guard: ${e.message.split('\n')[0]}` });
  } finally {
    checkingMains = false;
    pushStatus();
    drain();
  }
}

async function runGuard({ project, sha }) {
  const p = all.byKey(project);
  try {
    const g = await guardCommit({
      repoDir: p.repoDir, workDir: join(p.stateDir, 'guard-work'), sha, prefixes: [p.key], fixKeys: await fixKeysOf(p),
      toolsDir: cfg.toolsDir ? join(AGENT_DIR, cfg.toolsDir) : null,
    });
    const slug = githubSlugOf(p.repoDir);
    const url = slug ? `https://github.com/${slug}/commit/${g.sha}` : null;
    const fixes = g.fixes.map(({ key, lines, files, testsChanged, entry }) => ({ key, lines, files, testsChanged, entry }));
    // A clear commit is recorded without a ticket (no card on the dashboard); a note or an alert shows on its ticket.
    events.emit('guard', { ...(g.verdict !== 'clear' && g.key ? { key: g.key } : {}), project: p.key, commit: g.sha, short: g.short, verdict: g.verdict, fixes, tests: g.tests?.totals ?? null, text: `regression guard: ${g.text}`, url });
    if (g.verdict === 'alert') await reportGuard(p, g, slug);
  } catch (e) {
    events.emit('error', { text: `regression guard of ${project} ${String(sha).slice(0, 7)}: ${e.message.split('\n')[0]}` });
  }
}

const githubSlugOf = (repoDir) => {
  try {
    return execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().match(/github\.com[/:]([^/]+)\/([^/.\s]+)/)?.slice(1, 3).join('/') ?? null;
  } catch {
    return null;
  }
};

/**
 * An alert goes where people look: a comment on the commit (GitHub) and on the tickets involved (Jira). A failing
 * test's message can quote data (a patient's name, a fiscal code), so the text is masked first, like model input.
 */
async function reportGuard(p, g, slug) {
  const mask = createRedactor({ allow: teamOf(all.projects) });
  g = { ...g, text: mask.text(g.text) };
  const lines = [`**Regression guard** (plain code, no AI): ${g.text}`, '', ...g.fixes.map((f) => `- ${f.key}${f.entry ? ` (known issue: \`${f.entry}\`)` : ''}: ${f.lines} line(s) of its fix${f.testsChanged.length ? `; its regression test changed: ${f.testsChanged.map((x) => `\`${x}\``).join(', ')}` : ''}`), '', '_A person decides whether the change is intended. The guard does not change the code._'];
  if (slug) {
    try {
      execFileSync('gh', ['api', '-X', 'POST', `repos/${slug}/commits/${g.sha}/comments`, '-f', `body=${lines.join('\n')}`], { stdio: 'ignore', timeout: 30_000 });
    } catch (e) {
      events.emit('error', { text: `regression guard: GitHub comment on ${g.short} skipped: ${e.message.split('\n')[0]}` });
    }
  }
  if (policy.actions.postInternalComment !== 'auto') return;
  const body = `(robot) *Regression guard* — commit {{${g.short}}} may bring back a fixed bug.\n${g.text}\n${slug ? `[The commit|https://github.com/${slug}/commit/${g.sha}]\n` : ''}_Plain code, no AI: the lines it changes were blamed, and the regression tests of those bugs ran on it. A person decides._`;
  for (const key of [...new Set([g.key, ...g.fixes.map((f) => f.key)].filter(Boolean))]) {
    try {
      await jira.comment(key, body);
    } catch (e) {
      events.emit('error', { key, text: `regression guard: Jira comment skipped: ${e.message.split('\n')[0]}` });
    }
  }
}

// ---------------------------------------------------------------- insights

const insightsCache = new Map(); // project key → { at, data }
let recommending = false;
let reviewing = null; // the project whose app review is running
const assignableCache = new Map(); // project key → { at, users }
let asking = false;
const knowledgeCache = new Map(); // project key → { at, data }: the documentation PRs (gh + git, a few seconds)
let mergingDocs = false;
// Prior art of the suggested tickets (K17/K19): commit files, knowledge entries, open PRs, saved analyses of a project.
const priorArtCache = new Map(); // project key → { at, sources }
function priorArtSourcesOf(p, refresh = false) {
  const hit = priorArtCache.get(p.key);
  if (!refresh && hit && Date.now() - hit.at < 120_000) return hit.sources;
  const sources = loadPriorArtSources({ repoDir: p.repoDir, analyses: savedAnalyses(p.stateDir) });
  priorArtCache.set(p.key, { at: Date.now(), sources });
  return sources;
}
const suggestionsOf = (p, data, review, refresh = false) =>
  suggestTickets({ insights: data, review, rules: p.cfg.insights?.components ?? [], created: readCreated(p.stateDir), project: p.key, priorArtSources: priorArtSourcesOf(p, refresh), gaps: knowledgeGaps(readAsks(p.stateDir)) });
async function insightsCached(p, refresh = false) {
  const hit = insightsCache.get(p.key);
  if (!refresh && hit && Date.now() - hit.at < 120_000) return hit.data;
  const peers = all.projects.filter((x) => x.key !== p.key).map((x) => ({ key: x.key, name: x.name, repoDir: x.repoDir }));
  const data = await buildInsights({ repoDir: p.repoDir, stateDir: p.stateDir, cfg: p.cfg, jira, peers });
  insightsCache.set(p.key, { at: Date.now(), data });
  return data;
}
// Accuracy (AI1) from the project's graph (GG0): pull requests of the whole suite read once per refresh (a demo reset
// is recognised across the repositories), each project's result cached for two minutes like the insights.
const graphCache = new Map();
let suitePrsCache = null;
/** The project's graph (GG0) and its accuracy (AI1), with the daily snapshots: { graph, accuracy }. */
async function graphCached(p, refresh = false) {
  const hit = graphCache.get(p.key);
  if (!refresh && hit && Date.now() - hit.at < 120_000) return hit.data;
  if (refresh || !suitePrsCache || Date.now() - suitePrsCache.at >= 120_000) suitePrsCache = { at: Date.now(), prs: readSuitePullRequests(all.projects.filter((x) => existsSync(x.repoDir))) };
  const graph = await loadGraph({ project: p, eventsDir: rootState, jira, suitePrs: suitePrsCache.prs });
  const acc = scoreAccuracy(graph, { rules: p.cfg.insights?.components ?? [], replays: readReplays(p.stateDir), origins: readBlameOrigins(p.stateDir) });
  const data = { graph, accuracy: { ...acc, trend: recordAccuracy(p.stateDir, acc) } };
  graphCache.set(p.key, { at: Date.now(), data });
  return data;
}
const queryOf = (req) => new URL(req.url, 'http://localhost').searchParams;
const readyProject = (sel) => {
  const p = projectFor(sel);
  if (!existsSync(p.repoDir)) throw badRequest(`${p.name} (${p.key}) has no application clone yet: ${p.repoDir}`, 409);
  return p;
};

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
  if (path === '/tour.js' || path === '/slides.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(readFileSync(join(HERE, 'dashboard', path.slice(1))));
  }
  // Who presents (title and last slide of ?present): agent.config.json "presentation".
  if (path === '/api/tour/deck') return json(res, 200, { presentation: cfg.presentation ?? {} });
  // The recorded runs the tour replays when no ticket was analyzed since the last reset (read-only).
  if (path === '/api/tour/replay') {
    const runs = recordedRuns(rootState, cfg.tourReplay ?? []).map((run) => {
      const p = all.ofTicket(run.key);
      const shot = (name) => Boolean(p && existsSync(join(p.stateDir, 'work', run.key, 'evidence', `${name}.png`)));
      const events = run.events.map((e) =>
        e.type === 'reproduced' ? { ...e, evidence: e.evidence && shot('before') } : e.type === 'verified' ? { ...e, evidence: e.evidence && shot('after') } : e,
      );
      return { ...run, events };
    });
    return json(res, 200, { runs });
  }
  // Recorded Ask answers of a project, for the tour to replay instead of asking (and paying) again (read-only).
  if (path === '/api/tour/asks') {
    try {
      const p = readyProject({ project: queryOf(req).get('project') });
      return json(res, 200, { project: p.key, answers: recordedAsks(p.stateDir, p.askExamples ?? []) });
    } catch (e) {
      return json(res, e.status ?? 500, { ok: false, error: e.message });
    }
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
    refreshBranches();
    return json(res, 200, status);
  }
  // Evidence screenshots: /evidence/<KEY>/before.png|after.png (only these names, only from the project's state/work).
  // The dashboard adds ?<timestamp> to bust the cache, so the path is matched without the query string.
  const ev = path.match(/^\/evidence\/([A-Z][A-Z0-9_]+-\d+)\/(before|after)\.png$/);
  if (ev) {
    const p = all.ofTicket(ev[1]);
    const file = p ? join(p.stateDir, 'work', ev[1], 'evidence', `${ev[2]}.png`) : '';
    if (!p || !existsSync(file)) {
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
  // Hotspot map per project: /api/insights?project=LAB
  if (req.method === 'GET' && path === '/api/insights') {
    try {
      const p = readyProject({ project: queryOf(req).get('project') });
      await health.require(); // without Jira every ticket count would be 0 and every suggestion would look new
      const refresh = queryOf(req).get('refresh') === '1';
      const data = await insightsCached(p, refresh);
      const review = readReview(p, data);
      const suggestions = suggestionsOf(p, data, review, refresh);
      // Knowledge gaps (K12): questions without a good answer; the coverage per component is put together on the page.
      const gaps = knowledgeGaps(readAsks(p.stateDir));
      return json(res, 200, { ...data, gaps, project: p.key, recommendations: readRecommendations(p.stateDir, data), review, reviewing: reviewing === p.key, suggestions, createTicket: policy.actions.createTicket ?? 'draft' });
    } catch (e) {
      return json(res, e.status ?? 500, { ok: false, error: e.message });
    }
  }
  // How often the agent was right (AI1): /api/accuracy?project=DEM[&refresh=1]. Jira only adds the tickets' state, so
  // it is required like for the insights (without it, a deleted ticket and an unread one look the same).
  if (req.method === 'GET' && path === '/api/accuracy') {
    try {
      const p = readyProject({ project: queryOf(req).get('project') });
      await health.require();
      return json(res, 200, (await graphCached(p, queryOf(req).get('refresh') === '1')).accuracy);
    } catch (e) {
      return json(res, e.status ?? 500, { ok: false, error: e.message });
    }
  }
  // The management week (WF5): /api/impact?weeks=8[&refresh=1], the whole suite from the projects' cached graphs.
  if (req.method === 'GET' && path === '/api/impact') {
    try {
      const q = queryOf(req);
      await health.require();
      const apps = [];
      for (const p of all.projects.filter((x) => existsSync(x.repoDir))) {
        const { graph, accuracy } = await graphCached(p, q.get('refresh') === '1');
        apps.push({ project: p.key, name: p.name, graph, accuracy });
      }
      const weeks = Math.min(Math.max(Number(q.get('weeks')) || 8, 1), 52);
      return json(res, 200, impactOf(apps, { baseline: cfg.baseline, weeks }));
    } catch (e) {
      return json(res, e.status ?? 500, { ok: false, error: e.message });
    }
  }
  // Ticket lanes (G1): /api/graph?project=DEM[&days=30][&ticket=DEM-42][&agentOnly=1][&refresh=1], laid out by
  // lib/graph-lanes.mjs, with the accuracy summary for the panel above it.
  if (req.method === 'GET' && path === '/api/graph') {
    try {
      const q = queryOf(req);
      const p = readyProject({ project: q.get('project') });
      await health.require();
      const { graph, accuracy } = await graphCached(p, q.get('refresh') === '1');
      const days = Math.min(Math.max(Number(q.get('days')) || 30, 1), 3650);
      const ticket = /^[A-Z][A-Z0-9_]+-\d+$/i.test(q.get('ticket') ?? '') ? q.get('ticket').toUpperCase() : null;
      const layout = laneLayout(graph, { since: ticket ? null : new Date(Date.now() - days * 86_400_000).toISOString(), ticket, agentOnly: q.get('agentOnly') === '1' });
      const { rows: _rows, reviews: _reviews, ...summary } = accuracy;
      return json(res, 200, { project: p.key, vcs: graph.vcs, head: graph.head, builtAt: graph.builtAt, days, ticket, layout, accuracy: summary, warnings: graph.warnings });
    } catch (e) {
      return json(res, e.status ?? 500, { ok: false, error: e.message });
    }
  }
  // The whole suite: every project with a clone, from the same (cached) insights as the per-project pages.
  if (req.method === 'GET' && path === '/api/insights/suite') {
    try {
      const refresh = queryOf(req).get('refresh') === '1';
      await health.require();
      const apps = [];
      for (const p of all.projects.filter((x) => existsSync(x.repoDir))) {
        const data = await insightsCached(p, refresh);
        const review = readReview(p, data);
        const suggestions = suggestionsOf(p, data, review, refresh);
        apps.push({ project: p, data: { ...data, suggestions }, review });
      }
      return json(res, 200, suiteInsights(apps));
    } catch (e) {
      return json(res, e.status ?? 500, { ok: false, error: e.message });
    }
  }
  if (req.method === 'POST' && path === '/api/insights/recommend') {
    if (recommending) return json(res, 409, { ok: false, error: 'recommendations are being written already' });
    recommending = true;
    try {
      const p = readyProject(await readBody(req));
      await health.require();
      const data = await insightsCached(p, true);
      const rec = await writeRecommendations({ insights: data, stateDir: p.stateDir, cfg: p.cfg });
      events.emit('insights', { project: p.key, text: `${p.key}: hotspot recommendations written for ${rec.recommendations.length} component(s)`, meta: rec.meta });
      return json(res, 200, { ok: true, recommendations: { ...rec, stale: false } });
    } catch (e) {
      return json(res, e.status ?? 500, { ok: false, error: e.message });
    } finally {
      recommending = false;
    }
  }
  // AI review of one app (evaluation, findings in the code, refactors, growth): one at a time, a few minutes.
  if (req.method === 'POST' && path === '/api/insights/review') {
    if (reviewing) return json(res, 409, { ok: false, error: `a review of ${reviewing} is running already` });
    let p;
    try {
      p = readyProject(await readBody(req));
      await health.require();
    } catch (e) {
      return json(res, e.status ?? 400, { ok: false, error: e.message });
    }
    reviewing = p.key;
    const progress = (step) => broadcast({ type: 'review-progress', project: p.key, step });
    try {
      progress('collecting the Insights facts');
      const data = await insightsCached(p, true);
      const review = await writeReview({ insights: data, project: p, onProgress: progress });
      const n = review.findings.length + review.refactors.length + review.growth.length;
      events.emit('insights', { project: p.key, text: `${p.key}: app review written (${n} items${review.dropped ? `, ${review.dropped} without a citation dropped` : ''})`, meta: review.meta });
      return json(res, 200, { ok: true, review });
    } catch (e) {
      return json(res, e.status ?? 500, { ok: false, error: e.message });
    } finally {
      reviewing = null;
      broadcast({ type: 'review-progress', project: p.key, step: null });
    }
  }
  // Who can be assigned tickets of a project (the assignee list of Create in Jira…), cached for ten minutes.
  if (req.method === 'GET' && path === '/api/insights/assignable') {
    try {
      const p = readyProject({ project: queryOf(req).get('project') });
      await health.require();
      const hit = assignableCache.get(p.key);
      if (hit && Date.now() - hit.at < 600_000) return json(res, 200, { users: hit.users });
      const users = await jira.assignableUsers(p.key, '');
      assignableCache.set(p.key, { at: Date.now(), users });
      return json(res, 200, { users });
    } catch (e) {
      return json(res, e.status ?? 500, { ok: false, error: e.message });
    }
  }
  // Create one suggested ticket in Jira, after a person checked and confirmed it on the dashboard (policy createTicket).
  if (req.method === 'POST' && path === '/api/insights/tickets') {
    try {
      if ((policy.actions.createTicket ?? 'draft') === 'off') return json(res, 403, { ok: false, error: 'createTicket is "off" in policy.json' });
      const body = await readBody(req);
      const p = readyProject(body);
      await health.require(); // the duplicate check compares with the tickets in Jira
      // Checked again live (K19): Jira, git and the open PRs may have changed since the page was loaded.
      const data = await insightsCached(p, true);
      const s = suggestionsOf(p, data, readReview(p, data), true).find((x) => x.id === body.id);
      if (!s) return json(res, 404, { ok: false, error: 'this suggestion is no longer there; refresh the Insights tab' });
      if (s.created) return json(res, 409, { ok: false, error: `already created as ${s.created.key}` });
      const reason = String(body.reason ?? '').trim();
      const verdict = s.priorArt?.verdict ?? (s.openAs ? 'duplicate-of' : 'new');
      if (verdict !== 'new' && !reason && body.evenIfOpen !== true) {
        const what = { 'duplicate-of': `${s.priorArt?.key ?? s.openAs} is open and says the same`, 'fixed-by': `${s.priorArt.key} fixed it after the suggestion was written`, 'in-progress': `pull request #${s.priorArt.pr} is changing the same files` }[verdict] ?? verdict;
        return json(res, 409, { ok: false, error: `${what}; to create it anyway, give the reason`, priorArt: s.priorArt });
      }
      insightsCache.delete(p.key);
      const created = await createSuggested({ jira, project: p.key, stateDir: p.stateDir, suggestion: s, edits: body.edits ?? {}, assign: body.assign !== false, assigneeId: body.assigneeId, analyze: body.analyze === true, reason });
      events.emit('insights', { project: p.key, text: `${created.key} created from an Insights suggestion: ${created.summary}${created.assignee ? ` (assigned to ${created.assignee})` : ''}` });
      insightsCache.delete(p.key);
      return json(res, 200, { ok: true, ...created });
    } catch (e) {
      return json(res, e.status ?? 500, { ok: false, error: e.message });
    }
  }
  // Knowledge base of one project (K2): the entries on main and the documentation PRs waiting for a person.
  if (req.method === 'GET' && path === '/api/knowledge') {
    try {
      const p = readyProject({ project: queryOf(req).get('project') });
      const hit = knowledgeCache.get(p.key);
      const data = hit && Date.now() - hit.at < 60_000 && queryOf(req).get('refresh') !== '1' ? hit.data : await createDocsPrs({ repoDir: p.repoDir }).list();
      knowledgeCache.set(p.key, { at: Date.now(), data });
      // KB1: the last run of the known issues' regression tests (agent/knowledge-tests.mjs), when there is one.
      let tests = null;
      try {
        const t = JSON.parse(readFileSync(join(p.stateDir, 'knowledge-tests.json'), 'utf8'));
        tests = { at: t.at, head: t.head, totals: t.totals, entries: t.entries.map(({ key, title, file, anchor, status, source, tests: ts }) => ({ key, title, file, anchor, status, source, tests: ts.filter((x) => x.status !== 'pass').map((x) => ({ file: x.file, status: x.status, failed: x.failed ?? null, missing: x.missing ?? null })) })) };
      } catch {
        /* not run yet */
      }
      return json(res, 200, { project: p.key, ...data, tests, mergeDocs: policy.actions.mergeDocs ?? 'draft' });
    } catch (e) {
      return json(res, e.status ?? 500, { ok: false, error: e.message });
    }
  }
  // Merge one documentation PR, after a person confirmed it on the dashboard (policy mergeDocs: draft).
  if (req.method === 'POST' && path === '/api/knowledge/merge') {
    if ((policy.actions.mergeDocs ?? 'draft') === 'off') return json(res, 403, { ok: false, error: 'mergeDocs is "off" in policy.json' });
    if (mergingDocs) return json(res, 409, { ok: false, error: 'another documentation PR is being merged' });
    mergingDocs = true;
    try {
      const body = await readBody(req);
      const p = readyProject(body);
      const number = Number(body.number);
      if (!Number.isInteger(number) || number < 1) throw badRequest('which pull request? (number)');
      const m = await createDocsPrs({ repoDir: p.repoDir }).merge(number);
      knowledgeCache.delete(p.key);
      const text = `documentation merged into main${m.reopened ? ' (the closed PR was reopened)' : ''}: PR #${m.number}`;
      // A backfill PR (docs/backfill-…) covers several tickets: one event without a ticket; its tickets were told
      // about it when it was opened.
      events.emit('docs-merged', m.key ? { key: m.key, text, url: m.url } : { text: `${p.key}: ${text} (${m.branch})`, url: m.url });
      // Best effort: the ticket may be gone (a demo reset) or Jira unavailable; the merge stands either way.
      if (m.key) {
        try {
          await jira.comment(m.key, `(robot) *Knowledge base* — the documentation of this ticket is merged into main: [PR #${m.number}|${m.url}]. The analysis and Ask read it from now on.`);
        } catch (e) {
          events.emit('error', { text: `${m.key}: Jira comment after the documentation merge skipped: ${e.message.split('\n')[0]}` });
        }
      }
      return json(res, 200, { ok: true, project: p.key, ...m });
    } catch (e) {
      return json(res, e.status ?? 500, { ok: false, error: e.message });
    } finally {
      mergingDocs = false;
    }
  }
  // Feedback on an Ask answer (K12): 👍 / 👎 and an optional note, kept locally; it feeds the knowledge gaps.
  if (req.method === 'POST' && path === '/api/ask/feedback') {
    try {
      const body = await readBody(req);
      const p = readyProject(body);
      const vote = body.vote === 'up' || body.vote === 'down' ? body.vote : null;
      if (!vote || !body.answerAt) throw badRequest('vote (up or down) and answerAt are needed');
      const entry = { at: new Date().toISOString(), answerAt: String(body.answerAt), question: String(body.question ?? '').slice(0, 500), vote, note: String(body.note ?? '').trim().slice(0, 500) };
      appendFileSync(join(p.stateDir, 'ask-feedback.jsonl'), `${JSON.stringify(entry)}\n`);
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, e.status ?? 500, { ok: false, error: e.message });
    }
  }
  // Ask the knowledge base of one project (FR-65): one question at a time; progress goes to the dashboard stream.
  if (req.method === 'POST' && path === '/api/ask') {
    if (asking) return json(res, 409, { ok: false, error: 'another question is being answered; try again in a minute' });
    const body = await readBody(req);
    asking = true;
    try {
      const p = readyProject(body);
      await health.require(); // otherwise "not in the knowledge base" when Jira only could not be searched
      // The linked apps too (K11): read-only checkouts of their main, apart from the analysis' (ask-peer-repo).
      const peers = peerCheckouts(p, all, (text) => broadcast({ type: 'ask-progress', id: body.id, step: `warning: ${text}` }), { name: 'ask-peer-repo' });
      const answer = await askQuestion({ question: body.question, repoDir: p.repoDir, stateDir: p.stateDir, cfg: p.cfg, jira, project: { key: p.key, name: p.name }, peers, onProgress: (step) => broadcast({ type: 'ask-progress', id: body.id, step }) });
      return json(res, 200, { ok: true, project: p.key, ...answer });
    } catch (e) {
      return json(res, e.status ?? 500, { ok: false, error: e.message });
    } finally {
      asking = false;
    }
  }
  // Preview a ticket branch in that ticket's app; "main" needs the project.
  if (req.method === 'POST' && path === '/api/preview') {
    const body = await readBody(req);
    try {
      const branch = String(body.branch ?? '');
      const p = readyProject(branch === 'main' ? { project: body.project } : { key: branch });
      const r = await previewBranch({ repoDir: p.repoDir, branch, appUrl: p.app.url });
      events.emit('preview', { project: p.key, key: r.branch === 'main' ? undefined : r.branch, text: `the ${p.name} app on :${p.app.frontend} now shows ${r.branch}` });
      pushStatus();
      return json(res, 200, { ok: true, project: p.key, appUrl: p.app.url + (p.app.home ?? '/'), ...r });
    } catch (e) {
      return json(res, e.status ?? 409, { ok: false, error: e.message });
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
  for (const s of status.projects) {
    console.log(`  ${s.key.padEnd(4)} ${s.name.padEnd(11)} ${s.ready ? `repo ${s.repo} · app :${s.app.frontend} shows ${s.appBranch}${s.linked.length ? ` · linked to ${s.linked.join(', ')}` : ''}` : `not watched: no clone at ${s.repo}`}`);
  }
  console.log(`Watching ${WATCHED.join(', ')} every ${cfg.pollSeconds}s`);
  console.log(mail.enabled ? `Email updates to ${mail.to.join(', ')}` : `Email updates off: ${mail.reason}`);
});
const cleanup = () => {
  if (readPid()?.pid === process.pid) rmSync(PID_FILE, { force: true });
};
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));

setInterval(() => broadcast({ type: 'ping', at: new Date().toISOString() }), 15_000);
events.emit('started', { text: `watching ${WATCHED.join(', ')} every ${cfg.pollSeconds}s` });
const first = await health.check();
console.log(first.ok ? `Jira: connected as ${first.user}` : `Jira UNAVAILABLE: ${first.error}`);
for (const w of first.warnings) console.log(`Jira warning: ${w}`);
// Stale labels are removed once Jira answers (when it is unavailable now, the jira-up change above does it).
if (first.ok) await recoverStuckTickets().catch((e) => events.emit('error', { text: `recovery failed: ${e.message}` }));
await poll();
setInterval(poll, cfg.pollSeconds * 1000);
await checkMains();
setInterval(checkMains, GUARD_SECONDS * 1000);
