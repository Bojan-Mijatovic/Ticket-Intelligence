#!/usr/bin/env node
// Ticket Intelligence agent: watches the Jira projects of agent.config.json "projects", analyzes every new ticket
// headless in its own application repository, acts per policy.json, and serves one live dashboard for all of them.
//
//   node agent/watcher.mjs              → dashboard on http://localhost:7070
//   node agent/watcher.mjs --replace    stops a watcher that is already running (e.g. with older code), then starts
//
// A ticket is picked when it is in one of the projects, not Done, created within lookbackHours, and has none of the
// agent's labels (ai-analyzing, ai-analyzed, ai-failed) nor the opt-out label (no-ai). One queue for all projects.

import { execFile, execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { promisify } from 'node:util';
import { createEventLog } from './lib/events.mjs';
import { createJira } from './lib/jira-actions.mjs';
import { createJiraHealth } from './lib/jira-health.mjs';
import { documentResolved } from './lib/document.mjs';
import { createDocsPrs } from './lib/docs-prs.mjs';
import { repoKnowledge } from './lib/doc-candidates.mjs';
import { loadPriorArtSources } from './lib/prior-art.mjs';
import { knowledgeGaps, readAsks } from './lib/gaps.mjs';
import { digestDue, inWindow, nightOf } from './lib/digest.mjs';
import { gapsToResearch, readResearch, recordResearch, researchedToday, researchOf } from './lib/research.mjs';
import { askStats } from './lib/ask-stats.mjs';
import { processTicket, triageTicket, refixTicket } from './lib/pipeline.mjs';
import { currentBranch, previewBranch } from './lib/preview.mjs';
import { reviewPullRequest } from './lib/review.mjs';
import { readRecommendations, savedAnalyses, writeRecommendations } from './lib/insights.mjs';
import { waitUntilIdle } from './lib/replace.mjs';
import { describeMergeCheck, mergeCheck, mergeCheckComment } from './lib/merge-check.mjs';
import { ticketKeyQuestion, ticketStatus } from './lib/ticket-status.mjs';
import { componentInQuestion, fastMore, ruleIntent } from './lib/ask-fast.mjs';
import { pageAnswer, pageInQuestion, pageOnly, traceAddress } from './lib/page-code.mjs';
import { channelApi, createGraph, graphSettings } from './lib/teams-graph.mjs';
import { answerHtml, mentionOf, newQuestions, noteHtml, projectOf, readInboxState, writeInboxState } from './lib/teams-inbox.mjs';
import { closePullRequest, fold, keyedDecisions, mayDecide, misplacedDecisions, newDecisions, prOfTicket, readyPullRequest, recordRejection, rejectionsOf } from './lib/fix-approval.mjs';
import { mayAnswer, ownerReplies, sameNameUser } from './lib/owner-reply.mjs';
import { actionsOn, askHistory, askRecord, faqRefusal, findAnswer, followUpChain, logAsk, reusableAnswer, maskAnswer, peopleFor, priorArtItem, recordAction, saveFaq, ticketDraft, viaOf, viaText, voteOn } from './lib/ask-actions.mjs';
import { readEvents } from './lib/git-graph.mjs';
import { readReview, writeReview } from './lib/app-review.mjs';
import { createSuggested, readCreated, suggestTickets } from './lib/suggestions.mjs';
import { suiteInsights } from './lib/suite.mjs';
import { askQuestion } from './lib/ask.mjs';
import { presentationFacts, recordedAsks, recordedRuns, system1Privacy, system1Runs } from './lib/tour.mjs';
import { attachMailUpdates } from './lib/mail-updates.mjs';
import { loadProjects, peerCheckouts, teamOf } from './lib/projects.mjs';
import { laneLayout } from './lib/graph-lanes.mjs';
import { shareAnswer, teamsInfo } from './lib/notify.mjs';
import { impactOf } from './lib/impact.mjs';
import { guardCommit } from './lib/regression-guard.mjs';
import { askReporter, askReporterText, createSystem1, currentCheckpoint, describeAnswers, fastAnswer, intentQuestion, knownEntries, knownIssue, knownTestVerdict, languageOf, missingInfo, nextIndex, questionsFor, stillNamesSomeone, system1Report } from './lib/system1.mjs';
import { askComment, lightPathMiss, nextStep, readWaiting, textHash, writeWaiting } from './lib/reporter-wait.mjs';
import { createRedactor } from '../.claude/skills/analyze-ticket/scripts/lib/redact.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const all = loadProjects(HERE);
const cfg = all.global; // settings shared by all projects (labels, poll, dashboard, claude, mail)
const policy = JSON.parse(readFileSync(join(HERE, 'policy.json'), 'utf8'));
/** The System 1 switches that act for real (auto), in words, for the dashboard: 'shadow' alone would say it changes nothing. */
const system1Live = () => [['queueOrder', 'queue order'], ['knownTest', 'known-issue test'], ['askRouter', 'Ask router'], ['lightPath', 'light path'], ['privacy', 'privacy hold'], ['askReporter', 'question to the reporter'], ['warmBySide', 'fix warm-up by side']].filter(([k]) => (policy.system1 ?? {})[k] === 'auto').map(([, w]) => w);
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
  // Its work in progress first (lib/replace.mjs): an analysis, a fix, a documentation run, an app review. --force stops
  // it at once, as before; --wait <minutes> changes how long to wait (15 by default).
  if (!process.argv.includes('--force')) {
    const at = process.argv.indexOf('--wait');
    const minutes = at > 0 && Number(process.argv[at + 1]) >= 0 ? Number(process.argv[at + 1]) : 15;
    const w = await waitUntilIdle({ base: `http://localhost:${cfg.dashboardPort}`, waitMs: minutes * 60_000, log: (t) => console.log(t) });
    if (!w.idle) {
      console.error(`The running watcher (PID ${previous.pid}) is still busy after ${minutes} min: ${w.what.join(', ')}. It was not replaced and goes on working.`);
      console.error('To stop it anyway: node agent/watcher.mjs --replace --force (its work in progress is lost), or wait longer: --wait <minutes>');
      process.exit(1);
    }
    if (w.sawBusy) {
      // The job is done, but its answer may still be on its way to whoever started it (an app review's caller got
      // nothing in the first live test): two seconds before the stop.
      await new Promise((r) => setTimeout(r, 2000));
      console.log(`The running watcher finished its work (${Math.round(w.waitedMs / 1000)} s).`);
    }
  }
  process.kill(previous.pid);
  for (let i = 0; i < 50 && alive(previous.pid); i++) await new Promise((r) => setTimeout(r, 100));
  console.log(`Stopped the previous watcher (PID ${previous.pid}).`);
}

// Set by a new watcher started with --replace (POST /api/drain): no new job starts, the running one finishes.
let draining = false;

const events = createEventLog(join(rootState, 'events.jsonl'));
const jira = createJira();
jira.allowTeam(teamOf(all.projects)); // R-02: the team's names stay readable in the masked ticket text
const mail = attachMailUpdates({ events, policy, cfg, browseUrl: (key) => jira.browseUrl(key) });
// System 1 (docs/SYSTEM1_PLAN.md, J1): the local decision model, in shadow. Started in the background below.
const system1 = createSystem1({ cfg, policy, agentDir: HERE, stateDir: rootState, log: (text) => console.log(text) });

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
const status = { projects: all.projects.map(projectStatus), jiraUrl: jira.baseUrl, teams: teamsInfo(), jira: { ok: null, error: null, warnings: [] }, policy: policy.actions, lastPoll: null, nextPoll: null, queue: [], processing: null, startedAt: new Date().toISOString(), pid: process.pid, system1: { mode: system1.mode, model: system1.model, ready: null, reason: null, live: system1Live() } };
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

// System 1 (docs/SYSTEM1_PLAN.md): the local model is asked when a ticket is queued, while the event loop is free
// (the pipeline's git steps are synchronous), so its answers are on the card at once. key → Promise<answers | null>;
// the answers that are in, by key, for the queue order (J3).
const S1 = policy.system1 ?? {};
const system1Answers = new Map();
const system1Resolved = new Map();
// J4: the known-issue tests this watcher has queued, `KEY|ENTRY`: a second run of the same ticket does not run them again.
const knownTested = new Set();
/**
 * @param {boolean} [o.byPerson] a run a person started (Run again, Analyze now): the question to the reporter is not
 *   drafted again, since the person has seen it and chose to go on (LAB-31 got the same question twice, 2026-11-16)
 */
function askSystem1(issue, { byPerson = false } = {}) {
  if (system1.mode === 'off') return;
  const p = all.ofTicket(issue.key);
  const started = Date.now();
  const threshold = Number(S1.lightPathThreshold ?? 0.5);
  const entries = p ? knownEntries(p.repoDir) : [];
  system1Answers.set(issue.key, system1.intake({ issue, jira, components: (p?.cfg.insights?.components ?? []).map((c) => c.name), entries, threshold, askThreshold: Number(S1.askReporterThreshold ?? 0.6), privacy: (S1.privacy ?? 'shadow') !== 'off' })
    .then((a) => {
      if (!a) return null;
      system1Resolved.set(issue.key, a);
      // Ready after its start timeout (system1.start asks again): the dashboard stops saying "off".
      if (status.system1 && !status.system1.ready) status.system1 = { ...status.system1, ready: true, reason: null };
      const known = knownIssue(a.answers, Number(S1.knownThreshold ?? 0.5));
      const entry = known ? entries.find((e) => e.key === known.key) : null;
      const holdPrivacy = stillNamesSomeone(a.answers, Number(S1.privacyThreshold ?? 0.7));
      // J7: a report about code (or an unclear one) that does not tell what is wrong or where: a question to the reporter.
      const askMode = S1.askReporter ?? 'shadow';
      const ask = askMode !== 'off' ? askReporter(a.answers, Number(S1.askReporterThreshold ?? 0.6)) : null;
      events.emit('system1', {
        key: issue.key, text: describeAnswers(a), answers: a.answers, ms: a.ms, elapsedMs: Date.now() - started, model: a.model, mode: system1.mode,
        lightPath: a.lightPath, lightPathMode: S1.lightPath ?? 'shadow', threshold,
        known: entry ? { key: entry.key, title: entry.title, file: entry.file, anchor: entry.anchor, p: known.p, test: entry.test } : null,
        privacy: holdPrivacy ? { hold: true, mode: S1.privacy ?? 'shadow', p: a.answers.privacy.p } : null,
        missing: missingInfo(a.answers, Number(S1.askReporterThreshold ?? 0.6)),
        askReporter: ask ? { mode: askMode, hold: askMode === 'draft' && S1.askReporterHold === true } : null,
      });
      if (ask && askMode === 'draft' && !byPerson) {
        events.emit('draft', { key: issue.key, kind: 'ask-reporter', text: `Question to the reporter: the report does not tell ${ask.missing.map((f) => MISSING_WORDS[f]).join(', ')}`, why: 'System 1 (J7): drafted from a template; a person sends it as a Jira comment', body: askReporterText({ missing: ask.missing, text: a.text }) });
      }
      // J4: a known issue with a regression test: its test runs on main as the next job (no model, a few minutes).
      if (entry?.test && (S1.knownTest ?? 'auto') === 'auto' && !knownTested.has(`${issue.key}|${entry.key}`)) {
        knownTested.add(`${issue.key}|${entry.key}`);
        status.queue.unshift({ kind: 'known-test', key: issue.key, entry: entry.key, project: p.key });
        events.emit('known-test', { key: issue.key, entry: entry.key, status: 'queued', text: `the regression test of ${entry.key} is queued to run on main` });
        pushStatus();
      }
      return a;
    })
    .catch((e) => {
      events.emit('error', { key: issue.key, text: `System 1: ${e.message}` });
      return null;
    }));
}

/** J4: runs one known issue's regression tests on main (agent/knowledge-tests.mjs --only), without blocking the loop. */
async function runKnownTest(job) {
  const started = Date.now();
  events.emit('known-test', { key: job.key, entry: job.entry, status: 'running', text: `running the regression test of ${job.entry} on main` });
  const out = await new Promise((done) => {
    let text = '';
    const child = spawn(process.execPath, [join(HERE, 'knowledge-tests.mjs'), '--project', job.project, '--only', job.entry], { cwd: join(HERE, '..'), windowsHide: true });
    const stop = setTimeout(() => child.kill(), 15 * 60_000);
    child.stdout.on('data', (d) => (text += d));
    child.stderr.on('data', (d) => (text += d));
    child.on('close', () => (clearTimeout(stop), done(text)));
    child.on('error', (e) => (clearTimeout(stop), done(`${text}\n${e.message}`)));
  });
  const verdict = knownTestVerdict(out, job.entry);
  const words = { pass: `${job.entry}'s regression test passes on main: the known issue is not back in that form`, fail: `${job.entry}'s regression test FAILS on main: the known issue may be back`, 'not-run': `${job.entry}'s regression test did not run (compile error or renamed test)`, none: `no verdict for ${job.entry}` };
  events.emit('known-test', { key: job.key, entry: job.entry, status: verdict, text: `${words[verdict]} (${Math.round((Date.now() - started) / 1000)} s)`, output: out.split('\n').filter((l) => l.includes(job.entry) || /^\s{4,}\S/.test(l)).slice(0, 8).join('\n') });
}

const MISSING_WORDS = { steps: 'what was done', expected: 'what is wrong', screen: 'where in the application', environment: 'where, when or which record' };

/** J2/J6/J7: a ticket kept out of the analysis until a person decides on the dashboard (label held). */
async function holdTicket(issue, kind, answers) {
  const text = kind === 'privacy'
    ? `held: the text may still name a person (${Math.round(100 * answers.privacy.p)} %), so it is not sent to a cloud model until a person releases it`
    : kind === 'incomplete'
      ? `held: the report does not tell ${missingInfo(answers, Number(S1.askReporterThreshold ?? 0.6)).map((f) => MISSING_WORDS[f]).join(', ')}; the question to the reporter is in Drafts, and a person starts the analysis when the answer is in`
      : `held: System 1 recognised it as ${answers.type.choice}, not about code; a person chooses the light path or a full analysis`;
  await jira.labels(issue.key, { add: [L.held], remove: [L.inProgress] }).catch(() => {});
  events.emit('system1-held', { key: issue.key, kind, text, answers });
}

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
      if (issue.kind === 'analyze') askSystem1(issue);
    }
    await checkWaiting(); // J7/J2 auto: the reporter's answers
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
  await jira.labels(key, { remove: [L.done, L.failed, L.fixProposed, L.triaged, L.held] });
  forgetWaiting(key);
  // A person asked for the full flow: System 1 still answers (shown), but its light path and hold are skipped.
  status.queue.push({ ...issue, kind: 'analyze', skipGate: true });
  events.emit('queued', { key, text: issue.summary, url: jira.browseUrl(key), priority: issue.priority, reporter: issue.reporter, rerun: true });
  askSystem1(issue, { byPerson: true });
  pushStatus();
  drain();
}

/** J2/J6: a person's decision on a held ticket: the light path, or the full analysis. */
async function decideHeld(key, action) {
  if (!['light', 'analyze'].includes(action)) throw badRequest('action must be light or analyze');
  if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(key) || !WATCHED.includes(key.split('-')[0])) throw badRequest(`${key} is not a ticket of the watched projects`);
  await health.require();
  if (isBusyWith(key)) throw Object.assign(new Error(`${key} is already queued or running`), { status: 409 });
  const [issue] = await jira.search(`key = ${key}`, 1);
  if (!issue) throw Object.assign(new Error(`${key} not found`), { status: 404 });
  if (action === 'analyze') {
    await jira.labels(key, { remove: [L.held] });
    forgetWaiting(key);
    status.queue.push({ ...issue, kind: 'analyze', skipGate: true });
    events.emit('queued', { key, text: issue.summary, url: jira.browseUrl(key), priority: issue.priority, rerun: true });
    askSystem1(issue, { byPerson: true });
    pushStatus();
    drain();
    return { queued: true };
  }
  if (!system1Resolved.has(key)) {
    askSystem1(issue);
    await system1Answers.get(key);
  }
  const a = system1Resolved.get(key);
  if (!a) throw Object.assign(new Error('System 1 gave no answer for this ticket; analyze it instead'), { status: 409 });
  const p = all.ofTicket(key);
  if (await triageTicket({ issue, answers: a.answers, cfg: p.cfg, policy, jira, events, by: 'person', watch: true })) watchLightPath(key, p);
  return { triaged: true };
}

// ---------------------------------------------------------------- documentation PRs (K2, K22, mergeDocs)

/**
 * One documentation PR merged into main, in a worker (gh and git are synchronous): by a person's Merge on the
 * dashboard, or by mergeDocs: auto (`auto`: its age in hours). A PR in conflict with main is brought up to date entry
 * by entry and linted first (K22). Then the event and a Jira comment on its ticket.
 */
async function mergeDocsPr(p, number, { auto = null } = {}) {
  const { data: m } = await runHeavy('docs-merge', p.key, { number, runId: String(number) });
  knowledgeCache.delete(p.key);
  const how = [auto != null && `automatically, ${auto} h after it was opened`, m.reopened && 'the closed PR was reopened', m.mergedFiles?.length && `brought up to date with main first, ${m.mergedFiles.length} knowledge file(s) merged entry by entry`].filter(Boolean).join('; ');
  const text = `documentation merged into main${how ? ` (${how})` : ''}: PR #${m.number}`;
  // A backfill PR (docs/backfill-…) covers several tickets: one event without a ticket; its tickets were told about it
  // when it was opened.
  events.emit('docs-merged', m.key ? { key: m.key, text, url: m.url } : { text: `${p.key}: ${text} (${m.branch})`, url: m.url });
  // Best effort: the ticket may be gone (a demo reset) or Jira unavailable; the merge stands either way.
  if (m.key) {
    try {
      await jira.comment(m.key, `(robot) *Knowledge base* — the documentation of this ticket is merged into main${auto != null ? ` automatically, ${auto} h after its PR was opened with no hold on it` : ''}: [PR #${m.number}|${m.url}]. The analysis and Ask read it from now on.`);
    } catch (e) {
      events.emit('error', { text: `${m.key}: Jira comment after the documentation merge skipped: ${e.message.split('\n')[0]}` });
    }
  }
  return m;
}

/**
 * mergeDocs: auto. Every 10 minutes, when the agent is idle: an open documentation PR that changes only
 * docs/knowledge/*.md, opened mergeDocsAfterHours ago or more (24), with no review asking for changes and no label
 * hold / no-auto-merge / do-not-merge, is merged (mergeDocsPr). One that fails is left for a person and not tried
 * again by this watcher.
 */
const docsAutoFailed = new Set();
let lastDocsAuto = 0;
const HOLD_LABEL = /^(hold|no-auto-merge|do-not-merge)$/i;
async function autoMergeDocs() {
  if ((policy.actions.mergeDocs ?? 'draft') !== 'auto' || mergingDocs || draining || status.processing || status.queue.length || Date.now() - lastDocsAuto < 10 * 60_000) return;
  lastDocsAuto = Date.now();
  const after = Number(policy.mergeDocsAfterHours ?? 24);
  for (const p of all.projects.filter((x) => existsSync(x.repoDir))) {
    let list;
    try {
      list = (await runHeavy('knowledge', p.key)).data;
    } catch {
      continue;
    }
    const due = (list.prs ?? []).filter((x) => x.state !== 'closed' && x.mergeable && x.ageHours >= after && !x.changesRequested && !(x.labels ?? []).some((l) => HOLD_LABEL.test(l)) && !docsAutoFailed.has(`${p.key}#${x.number}`));
    for (const pr of due.sort((a, b) => a.number - b.number)) {
      if (mergingDocs || draining || status.processing) return;
      mergingDocs = true;
      try {
        await mergeDocsPr(p, pr.number, { auto: pr.ageHours });
      } catch (e) {
        docsAutoFailed.add(`${p.key}#${pr.number}`);
        events.emit('error', { ...(pr.key ? { key: pr.key } : {}), text: `${p.key}: documentation PR #${pr.number} not merged automatically, left for a person: ${String(e.message).split('\n')[0]}`, url: pr.url });
      } finally {
        mergingDocs = false;
      }
    }
  }
}
setInterval(() => autoMergeDocs().catch((e) => events.emit('error', { text: `automatic documentation merge: ${e.message}` })), 60_000).unref();

// ---------------------------------------------------------------- the researcher (KG2)
// A knowledge gap (a question Ask could not answer, or an answer marked wrong) researched in the queue: a deeper,
// read-only Claude run over the code, its history and the tickets (ask.mjs research), and a checked answer saved as a
// FAQ entry through the documentation PR, which a person reviews and mergeDocs merges. researchGaps: auto picks the
// most asked gap when the agent is idle, at most researchPerDay runs a day; draft only on a person's Research button.

/** Queues the research of one gap of a project; { queued } or why not. */
function queueResearch(p, gap, by = 'policy') {
  if (status.queue.some((q) => q.kind === 'research' && q.project === p.key) || (status.processing?.kind === 'research')) return { queued: false, why: 'a research is already queued or running' };
  status.queue.push({ kind: 'research', key: `${p.key} research`, project: p.key, question: gap.question, why: gap.why, note: gap.note ?? null, group: gap.group ?? [gap.question], by });
  events.emit('research', { project: p.key, text: `${p.key}: research queued (${by === 'person' ? 'by a person' : 'automatically'}) for a question Ask ${gap.why === 'marked as wrong' ? 'answered wrong' : 'could not answer'}: ${gap.question.slice(0, 160)}` });
  pushStatus();
  drain();
  return { queued: true };
}

async function runResearch(job) {
  const p = all.byKey(job.project);
  if (!p || !existsSync(p.repoDir)) return;
  const started = Date.now();
  events.emit('research', { project: p.key, text: `${p.key}: researching "${job.question.slice(0, 160)}" in the code, its history and the tickets` });
  try {
    const peers = peerCheckouts(p, all, (text) => events.emit('research', { project: p.key, text: `warning: ${text}` }), { name: 'ask-peer-repo' });
    const a = await askQuestion({ question: job.question, repoDir: p.repoDir, stateDir: p.stateDir, logDir: join(p.stateDir, 'research'), cfg: p.cfg, jira, project: { key: p.key, name: p.name }, peers, research: { why: job.why, note: job.note } });
    const cost = a.meta?.costUsd ?? 0;
    const took = `${Math.round((Date.now() - started) / 1000)} s, $${cost.toFixed(2)}`;
    if (!a.found) {
      recordResearch(p.stateDir, job.group, { outcome: 'not-found', costUsd: cost });
      events.emit('research', { project: p.key, outcome: 'not-found', costUsd: cost, text: `${p.key}: no answer in the code, its history or the tickets either (${took}): a real gap, kept on the Insights tab: ${job.question.slice(0, 140)}` });
      return;
    }
    const record = { ...askRecord(a), via: 'claude' };
    const saved = await saveFaq({ repoDir: p.repoDir, workDir: join(p.stateDir, 'research-work'), record, date: new Date().toISOString().slice(0, 10), team: teamNames(), research: { why: job.why } });
    recordResearch(p.stateDir, job.group, { outcome: 'faq', url: saved.url, costUsd: cost });
    knowledgeCache.delete(p.key);
    events.emit('research', { project: p.key, outcome: 'faq', costUsd: cost, text: `${p.key}: answered and saved as a FAQ entry for a person to check (${took}): ${saved.created ? 'new' : 'added to'} documentation PR #${saved.number}`, url: saved.url });
  } catch (e) {
    const why = String(e.message).split('\n')[0].slice(0, 200);
    // An answer already in the FAQ is not a failure: the gap is closed.
    recordResearch(p.stateDir, job.group, /already in/.test(why) ? { outcome: 'faq', why } : { outcome: 'failed', why });
    events.emit(/already in/.test(why) ? 'research' : 'error', { project: p.key, text: `${p.key}: research of "${job.question.slice(0, 100)}": ${why}` });
  }
}

let lastResearchPick = 0;
function autoResearch() {
  if ((policy.actions.researchGaps ?? 'draft') !== 'auto' || draining || status.processing || status.queue.length || status.jira.ok === false || Date.now() - lastResearchPick < 5 * 60_000) return;
  lastResearchPick = Date.now();
  const projects = all.projects.filter((x) => existsSync(x.repoDir));
  const today = projects.reduce((n, p) => n + researchedToday(readResearch(p.stateDir)), 0);
  if (today >= Number(policy.researchPerDay ?? 3)) return;
  const candidates = projects.flatMap((p) => gapsToResearch(knowledgeGaps(readAsks(p.stateDir)), readResearch(p.stateDir), { max: 1 }).map((g) => ({ p, g, count: g.group.length })));
  const next = candidates.sort((a, b) => b.count - a.count)[0];
  if (next) queueResearch(next.p, next.g);
}
setInterval(autoResearch, 60_000).unref();

// ---------------------------------------------------------------- night shift and morning digest (ROADMAP #3, WF3)
// In agent.config.json nightShift's window (from–to, local time), once a night when the agent is idle: the checks that
// were commands a person ran (every known issue's regression test on main, KB1; the knowledge lint, K5), and the
// backlog (open tickets older than lookbackHours the agent never saw), at most maxTickets and maxCostUsd a night. At
// digestAt on working days, the morning digest (agent/digest.mjs) to Teams. policy nightShift / morningDigest.
const NIGHT_DIR = join(rootState, 'night');
const NS = cfg.nightShift ?? {};
const nightFile = (night) => join(NIGHT_DIR, `${night}.json`);
const readNight = (night) => {
  try {
    return JSON.parse(readFileSync(nightFile(night), 'utf8'));
  } catch {
    return null;
  }
};
function writeNight(night, patch) {
  mkdirSync(NIGHT_DIR, { recursive: true });
  const n = { night, ...(readNight(night) ?? {}), ...patch, at: new Date().toISOString() };
  writeFileSync(nightFile(night), JSON.stringify(n, null, 2));
  writeFileSync(join(NIGHT_DIR, 'last.json'), JSON.stringify({ night }));
  return n;
}
/** What the night's work cost so far: the cost-bearing events since the window opened. */
const nightCost = (since) => readEvents(rootState).filter((e) => e.at >= since && ['analyzed', 'fix-proposed', 'fix-failed', 'reviewed', 'documented', 'research'].includes(e.type)).reduce((s, e) => s + (e.meta?.costUsd ?? e.costUsd ?? 0), 0);
const runNode = (script, args, minutes) => new Promise((done) => {
  let out = '';
  const child = spawn(process.execPath, [join(HERE, script), ...args], { cwd: join(HERE, '..'), windowsHide: true });
  const stop = setTimeout(() => child.kill(), minutes * 60_000);
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  child.on('close', (code) => (clearTimeout(stop), done({ code, out })));
  child.on('error', (e) => (clearTimeout(stop), done({ code: -1, out: `${out}\n${e.message}` })));
});

async function runNightChecks(job) {
  events.emit('night', { text: 'night shift: the regression tests of the known issues (KB1) and the knowledge lint, on every main' });
  const kb = await runNode('knowledge-tests.mjs', [], 60);
  const failed = [];
  let passed = 0;
  for (const p of all.projects.filter((x) => existsSync(x.repoDir))) {
    try {
      const r = JSON.parse(readFileSync(join(p.stateDir, 'knowledge-tests.json'), 'utf8'));
      if (Date.parse(r.at) < Date.parse(job.since)) continue; // not run tonight
      for (const e of r.entries ?? []) {
        if (e.status === 'pass') passed++;
        if (e.status === 'fail') failed.push({ project: p.key, key: e.key });
      }
    } catch {
      /* no results */
    }
  }
  let findings = 0;
  for (const p of all.projects.filter((x) => existsSync(x.repoDir))) {
    const l = await runNode('knowledge-lint.mjs', ['--project', p.key], 5);
    if (l.code === 1) findings += Math.max(1, (l.out.match(/^\s+(?:[A-Z][A-Z0-9_]+-\d+|-)\s/gm) ?? []).length);
  }
  writeNight(job.night, { kbTests: { passed, failed, code: kb.code }, lint: { findings } });
  events.emit('night', { text: `night shift: ${passed} regression tests of known issues pass${failed.length ? `, ${failed.length} FAIL (${failed.map((f) => f.key).join(', ')}): the known issue may be back` : ''}; knowledge lint ${findings ? `${findings} finding(s)` : 'clean'}` });
}

let nightTicking = false;
async function nightTick() {
  if (nightTicking || draining) return;
  nightTicking = true;
  try {
    const now = new Date();
    if (NS.enabled && (policy.actions.nightShift ?? 'off') === 'auto' && inWindow(now, NS.from ?? '20:00', NS.to ?? '07:00')) {
      const night = nightOf(now, NS.from ?? '20:00');
      const n = readNight(night) ?? writeNight(night, { since: now.toISOString() });
      const idle = !status.processing && !status.queue.length && status.jira.ok !== false;
      if (idle && !n.checksQueued) {
        writeNight(night, { checksQueued: true });
        status.queue.push({ kind: 'night-checks', key: 'night checks', night, since: n.since });
        pushStatus();
        drain();
      } else if (idle && n.checksQueued && !n.backlogQueued) {
        const max = Number(NS.maxTickets ?? 10);
        const found = await jira.search(`${IN_PROJECTS} AND created < -${cfg.lookbackHours}h AND statusCategory != Done AND (labels is EMPTY OR labels not in (${agentLabels.join(', ')})) ORDER BY priority DESC, created ASC`, max).catch(() => []);
        writeNight(night, { backlogQueued: true, backlog: { queued: found.length, stopped: null } });
        for (const issue of found) {
          status.queue.push({ ...issue, kind: 'analyze', night });
          events.emit('queued', { key: issue.key, text: `${issue.summary} · night shift: from the backlog`, url: jira.browseUrl(issue.key), priority: issue.priority, reporter: issue.reporter });
          askSystem1(issue);
        }
        if (found.length) events.emit('night', { text: `night shift: ${found.length} backlog ticket(s) queued (at most ${max}, $${NS.maxCostUsd ?? 5} a night)` });
        pushStatus();
        drain();
      }
    }
    // The digest: on working days at digestAt, for the period since the last one.
    const last = (() => {
      try {
        return JSON.parse(readFileSync(join(rootState, 'digests', 'last.json'), 'utf8'));
      } catch {
        return null;
      }
    })();
    if (NS.enabled && (policy.actions.morningDigest ?? 'off') === 'auto' && digestDue(now, NS.digestAt ?? '08:00', last?.date, { weekends: NS.weekends === true }) && !status.digesting) {
      status.digesting = true;
      const r = await runNode('digest.mjs', ['--post'], 5);
      status.digesting = false;
      const line = r.out.split('\n').find((l) => l.startsWith('DIGEST '));
      const d = line ? JSON.parse(line.slice(7)) : null;
      events.emit(d ? 'digest' : 'error', d ? { text: `morning digest ${d.channel === 'teams' ? 'posted to Teams' : d.channel === 'failed' ? `NOT posted (${d.error})` : 'written (no Teams webhook)'}: ${d.summary}`, file: d.file } : { text: `morning digest failed: ${r.out.trim().split('\n').pop()?.slice(0, 200)}` });
    }
  } catch (e) {
    events.emit('error', { text: `night shift: ${String(e.message).split('\n')[0]}` });
  } finally {
    nightTicking = false;
  }
}
setInterval(() => nightTick(), 60_000).unref();

/** A night-shift ticket waits while the night's cost is under maxCostUsd; past it, the rest of the backlog is dropped. */
function nightBudgetLeft(issue) {
  if (!issue.night) return true;
  const n = readNight(issue.night);
  const spent = nightCost(n?.since ?? new Date(Date.now() - 12 * 3_600_000).toISOString());
  if (spent < Number(NS.maxCostUsd ?? 5)) return true;
  const dropped = status.queue.filter((q) => q.night === issue.night).length + 1;
  status.queue = status.queue.filter((q) => q.night !== issue.night);
  writeNight(issue.night, { backlog: { ...(n?.backlog ?? {}), stopped: `the night's cost limit ($${NS.maxCostUsd ?? 5}) was reached at $${spent.toFixed(2)}; ${dropped} ticket(s) left for the next night` } });
  events.emit('night', { text: `night shift stopped: $${spent.toFixed(2)} spent, the limit is $${NS.maxCostUsd ?? 5}; ${dropped} backlog ticket(s) left for the next night` });
  return false;
}

// ---------------------------------------------------------------- waiting for the reporter (J7 and J2 in auto)
// lib/reporter-wait.mjs: a ticket asked about waits for the reporter's answer (or askReporterWaitHours); a ticket on
// the light path is watched for lightPathWatchDays: a reply gets the full analysis, a fix or a commit naming it is a
// miss and puts the light path back in shadow (state/autonomy.json, so a restart keeps it there).
const AUTONOMY_FILE = join(rootState, 'autonomy.json');
const readAutonomy = () => {
  try {
    return JSON.parse(readFileSync(AUTONOMY_FILE, 'utf8'));
  } catch {
    return {};
  }
};
for (const [k, v] of Object.entries(readAutonomy())) if (v?.mode && k in S1) S1[k] = v.mode; // lowered by a miss
/** Changes a project's waiting tickets on the file as it is now (two flows may change it). */
function updateWaiting(p, change) {
  const w = readWaiting(p.stateDir);
  change(w);
  writeWaiting(p.stateDir, w);
}
const forgetWaiting = (key) => {
  const p = all.ofTicket(key);
  if (p && readWaiting(p.stateDir)[key]) updateWaiting(p, (w) => delete w[key]);
};
function watchLightPath(key, p) {
  updateWaiting(p, (w) => (w[key] = { kind: 'light', at: new Date().toISOString(), hash: null }));
}
async function askTheReporter(issue, a, p) {
  const { key } = issue;
  const ask = askReporter(a.answers, Number(S1.askReporterThreshold ?? 0.6));
  const waitHours = Number(S1.askReporterWaitHours ?? 24);
  const at = new Date().toISOString();
  try {
    const before = await jira.getIssueFull(key, { maxComments: 0 });
    const c = await jira.comment(key, askComment(askReporterText({ missing: ask.missing, text: a.text }), { waitHours, language: languageOf(a.text) }));
    await jira.labels(key, { add: [L.held], remove: [L.inProgress] });
    updateWaiting(p, (w) => (w[key] = { kind: 'ask', at, hash: textHash(before), missing: ask.missing, url: c.url }));
    events.emit('system1-held', { key, kind: 'asked', text: `asked the reporter in Jira what the report does not tell (${ask.missing.map((f) => MISSING_WORDS[f]).join(', ')}); the analysis starts on the answer, or in ${waitHours} h`, answers: a.answers, url: c.url });
  } catch (e) {
    // The question could not be asked: analyzed as before rather than left waiting for nothing.
    events.emit('error', { key, text: `question to the reporter not posted (${e.message.split('\n')[0]}): analyzed as it is` });
    status.queue.unshift({ ...issue, kind: 'analyze', skipGate: true });
  }
}
let lastWaitCheck = 0;
async function checkWaiting() {
  if (Date.now() - lastWaitCheck < 60_000) return;
  lastWaitCheck = Date.now();
  let allEvents = null;
  for (const p of all.projects) {
    const waiting = readWaiting(p.stateDir);
    for (const [key, entry] of Object.entries(waiting)) {
      if (isBusyWith(key)) continue;
      let issue;
      try {
        issue = await jira.getIssueFull(key, { maxComments: 10 });
      } catch (e) {
        if (e.jiraStatus === 404) updateWaiting(p, (w) => delete w[key]);
        continue;
      }
      if (entry.kind === 'light') {
        allEvents ??= readEvents(rootState);
        const named = await execFileAsync('git', ['log', 'origin/main', `--since=${entry.at}`, `--grep=${key}`, '--format=%s'], { cwd: p.repoDir, encoding: 'utf8', windowsHide: true }).then((r) => r.stdout.split('\n').filter(Boolean)).catch(() => []);
        const miss = lightPathMiss({ key, at: entry.at, events: allEvents, commitsNaming: named });
        if (miss) {
          updateWaiting(p, (w) => delete w[key]);
          if (S1.lightPath === 'auto') {
            S1.lightPath = 'shadow';
            writeFileSync(AUTONOMY_FILE, JSON.stringify({ ...readAutonomy(), lightPath: { mode: 'shadow', at: new Date().toISOString(), key, why: miss.why } }, null, 2));
          }
          events.emit('system1-demoted', { key, text: `the light path was wrong for ${key} (${miss.why}): light path back to shadow until a person raises it again (agent/state/autonomy.json)` });
          continue;
        }
      }
      const { step, answer } = nextStep(entry, issue, { waitHours: Number(S1.askReporterWaitHours ?? 24), watchDays: Number(S1.lightPathWatchDays ?? 14) });
      if (step === 'wait') continue;
      updateWaiting(p, (w) => delete w[key]);
      if (step === 'expired') continue;
      const [row] = await jira.search(`key = ${key}`, 1).catch(() => []);
      if (!row || row.status === 'Done') continue;
      await jira.labels(key, { remove: [L.held, L.triaged] }).catch(() => {});
      const why = step === 'timeout'
        ? `no answer from the reporter in ${S1.askReporterWaitHours ?? 24} h: analyzed as it is`
        : `${answer.how === 'edited' ? 'the reporter edited the report' : `${answer.by ?? 'the reporter'} answered in Jira`}${entry.kind === 'light' ? ' after the light path: the full analysis' : ': the analysis starts with the answer'}`;
      events.emit('reporter-answered', { key, text: why, kind: entry.kind, step });
      status.queue.push({ ...row, kind: 'analyze', skipGate: true });
      askSystem1(row, { byPerson: true });
      pushStatus();
      drain();
    }
  }
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
  // again calls drain(). A watcher about to be replaced (POST /api/drain) starts nothing new.
  if (draining || status.processing || !status.queue.length || status.jira.ok === false) return;
  // A4: a merge check waits for every other job, so a ticket is never held up by one that has not started.
  const notMergeCheck = status.queue.findIndex((q) => q.kind !== 'merge-check');
  if (notMergeCheck > 0) status.queue.unshift(...status.queue.splice(notMergeCheck, 1));
  // J3: tickets to analyze by System 1's urgency ('auto'), or only say which it would take first ('shadow').
  const order = S1.queueOrder ?? 'shadow';
  const best = order === 'off' ? 0 : nextIndex(status.queue, (k) => system1Resolved.get(k)?.answers);
  // Said on the ticket's card in both modes: in 'auto' it is what happened, so a person sees why a ticket came first.
  if (best > 0) {
    const [first, other] = [status.queue[0], status.queue[best]];
    const urg = (k) => system1Resolved.get(k)?.answers?.urgency?.choice;
    const why = `${other.key} (${urg(other.key)}) before ${first.key} (${urg(first.key) ?? 'no answer'})`;
    events.emit('system1-queue', { key: other.key, text: order === 'auto' ? `queue order: taken first by urgency, ${why}` : `queue order (shadow): would take ${why}`, before: first.key });
  }
  const issue = order === 'auto' && best > 0 ? status.queue.splice(best, 1)[0] : status.queue.shift();
  status.processing = { key: issue.key ?? `${issue.project} ${String(issue.sha).slice(0, 7)}`, kind: issue.kind, since: new Date().toISOString() };
  pushStatus();
  if (issue.kind === 'night-checks') await runNightChecks(issue);
  else if (issue.kind === 'analyze' && issue.night && !nightBudgetLeft(issue)) {
    /* the night's cost limit: dropped, said in an event and the digest */
  } else if (issue.kind === 'research') await runResearch(issue);
  else if (issue.kind === 'guard') await runGuard(issue);
  else if (issue.kind === 'known-test') await runKnownTest(issue);
  else if (issue.kind === 'merge-check') await runMergeCheck(issue);
  else {
    const p = all.ofTicket(issue.key);
    if (issue.kind === 'document') await documentTicket(issue, p);
    // ROADMAP #9 B: a fix rejected in Teams, fixed again with the reason.
    else if (issue.kind === 'refix') await refixTicket({ key: issue.key, reason: issue.reason, by: issue.by, prUrl: issue.prUrl, attempt: issue.attempt, cfg: p.cfg, policy, jira, events, repoDir: p.repoDir, stateDir: p.stateDir, closePr: (url, comment) => closePullRequest(url, comment, { cwd: p.repoDir }) });
    else if (issue.kind === 'review') await reviewPullRequest({ key: issue.key, repoDir: p.repoDir, stateDir: p.stateDir, cfg: p.cfg, events, jira });
    else {
      // System 1's answers before the analysis starts: its synchronous git steps would otherwise hold them back by
      // 20 s (DEM-46, 2026-11-15), and the light path and the hold need them here. At most system1.waitSeconds; when
      // an answer decides the path (a gate in auto, or a hold), at most gateWaitSeconds: two tickets queued together
      // were answered one after the other, 25 s for the second, and BIL-26 went to the analysis without its question.
      const s1 = system1Answers.get(issue.key);
      const gated = !issue.skipGate && (['askReporter', 'lightPath', 'privacy'].some((k) => S1[k] === 'auto') || S1.lightPath === 'draft' || (S1.askReporter === 'draft' && S1.askReporterHold === true));
      const waitSeconds = Number(gated ? cfg.system1?.gateWaitSeconds ?? 60 : cfg.system1?.waitSeconds ?? 10);
      if (s1) await Promise.race([s1, new Promise((r) => setTimeout(r, 1000 * waitSeconds))]);
      const a = system1Resolved.get(issue.key);
      const lightMode = S1.lightPath ?? 'shadow';
      if (!issue.skipGate && a && (S1.privacy ?? 'shadow') === 'auto' && stillNamesSomeone(a.answers, Number(S1.privacyThreshold ?? 0.7))) {
        await holdTicket(issue, 'privacy', a.answers); // J6: nothing goes to a cloud model
      } else if (!issue.skipGate && a && (S1.askReporter ?? 'shadow') === 'auto' && askReporter(a.answers, Number(S1.askReporterThreshold ?? 0.6))) {
        await askTheReporter(issue, a, p); // J7 auto: asked in Jira; the analysis starts on the answer or the timeout
      } else if (!issue.skipGate && a && (S1.askReporter ?? 'shadow') === 'draft' && S1.askReporterHold === true && askReporter(a.answers, Number(S1.askReporterThreshold ?? 0.6))) {
        await holdTicket(issue, 'incomplete', a.answers); // J7: the analysis waits for the reporter's answer
      } else if (!issue.skipGate && a?.lightPath && lightMode === 'auto') {
        // J2: a reply from the reporter still gets the full analysis, and a light path that turns out to be about code
        // puts the light path back in shadow (checkWaiting).
        if (await triageTicket({ issue, answers: a.answers, cfg: p.cfg, policy, jira, events, watch: true })) watchLightPath(issue.key, p);
      } else if (!issue.skipGate && a?.lightPath && lightMode === 'draft') {
        await holdTicket(issue, 'light', a.answers); // J2: a person chooses
      } else {
        await processTicket({
          issue, cfg: p.cfg, policy, jira, events, repoDir: p.repoDir, stateDir: p.stateDir, project: { key: p.key, name: p.name },
          peers: (warn) => peerCheckouts(p, all, warn), followUp: (job) => status.queue.push(job), system1Answer: system1Answers.get(issue.key) ?? null,
          system1Ready: a ?? null, // J10: the fix warm-up by System 1's side, from the answers already in (no new wait)
        });
      }
      system1Answers.delete(issue.key);
      system1Resolved.delete(issue.key);
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

const execFileAsync = promisify(execFile);
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
  if (checkingMains || (policy.actions.regressionGuard !== 'auto' && policy.actions.mergeCheck !== 'auto')) return;
  checkingMains = true;
  try {
    for (const p of all.projects.filter((x) => WATCHED.includes(x.key))) {
      // Not execFileSync: five fetches from GitHub every two minutes held the watcher up for 5-7 s each time.
      const git = async (args) => (await execFileAsync('git', args, { cwd: p.repoDir, encoding: 'utf8', timeout: 60_000, windowsHide: true })).stdout.trim();
      let head;
      try {
        await git(['fetch', '-q', 'origin', 'main']);
        head = await git(['rev-parse', 'origin/main']);
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
      const shas = (await git(['rev-list', '--first-parent', '--reverse', `${seen}..${head}`])).split('\n').filter(Boolean).slice(-20);
      if (policy.actions.regressionGuard === 'auto') for (const sha of shas) status.queue.push({ kind: 'guard', project: p.key, sha, key: null });
      if (policy.actions.mergeCheck === 'auto') await queueMergeChecks(p, head);
    }
  } catch (e) {
    events.emit('error', { text: `regression guard: ${e.message.split('\n')[0]}` });
  } finally {
    checkingMains = false;
    pushStatus();
    drain();
  }
}

// ---------------------------------------------------------------- merge check (A4)
// When a watched main moves, every open fix PR of the agent is checked again on the main of now (lib/merge-check.mjs)
// and the result is posted on the PR. Once per PR and main; it waits for every other job (drain).

const mergeChecked = new Set(); // `${project}#${pr}@${main}+${head}`: one check per PR and main
async function queueMergeChecks(p, main) {
  let prs;
  try {
    prs = JSON.parse((await execFileAsync('gh', ['pr', 'list', '--state', 'open', '--json', 'number,headRefName,headRefOid,url'], { cwd: p.repoDir, encoding: 'utf8', timeout: 60_000, windowsHide: true })).stdout);
  } catch {
    return; // no GitHub remote, or gh not signed in: nothing to check
  }
  for (const pr of prs.filter((x) => /^[A-Z][A-Z0-9_]+-\d+$/.test(x.headRefName))) {
    const id = `${p.key}#${pr.number}@${main}+${pr.headRefOid}`;
    if (mergeChecked.has(id)) continue;
    mergeChecked.add(id);
    status.queue.push({ kind: 'merge-check', id, project: p.key, key: pr.headRefName, number: pr.number, branch: pr.headRefName, url: pr.url });
  }
}

async function runMergeCheck({ project, key, number, branch, url }) {
  const p = all.byKey(project);
  const tools = p.cfg.toolsDir ?? cfg.toolsDir;
  try {
    const r = await mergeCheck({ repoDir: p.repoDir, head: `origin/${branch}`, workDir: join(p.stateDir, 'merge-check'), toolsDir: tools ? resolve(AGENT_DIR, tools) : null });
    events.emit('merge-check', { key, ok: r.ok, conflict: Boolean(r.conflict), text: describeMergeCheck(r), url, result: r });
    try {
      await execFileAsync('gh', ['pr', 'comment', String(number), '--body', mergeCheckComment(r)], { cwd: p.repoDir, timeout: 60_000, windowsHide: true });
    } catch (e) {
      events.emit('error', { key, text: `merge check: the comment on PR #${number} was not posted (${String(e.message).split('\n')[0]})` });
    }
  } catch (e) {
    events.emit('error', { key, text: `merge check of PR #${number}: ${String(e.message).split('\n')[0]}` });
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
/**
 * A heavy read in a worker thread (lib/heavy-worker.mjs), so that the watcher keeps answering meanwhile. The same
 * job for the same project runs once: a second caller gets the first one's answer.
 */
const heavyRuns = new Map();
function runHeavy(job, key, extra = {}) {
  const id = `${job}:${key}${extra.runId ? `:${extra.runId}` : ''}`; // runId: one prior-art check per draft
  if (heavyRuns.has(id)) return heavyRuns.get(id);
  const run = new Promise((resolveRun, rejectRun) => {
    const w = new Worker(new URL('./lib/heavy-worker.mjs', import.meta.url), { workerData: { job, key, agentDir: HERE, eventsDir: rootState, ...extra } });
    let answered = false;
    w.once('message', (m) => {
      answered = true;
      if (m.ok) resolveRun(m);
      else rejectRun(Object.assign(new Error(m.error), m.status ? { status: m.status } : {}));
    });
    w.once('error', (e) => {
      answered = true;
      rejectRun(e);
    });
    w.once('exit', (code) => {
      if (!answered) rejectRun(new Error(`the ${job} worker for ${key} stopped (exit ${code}) without an answer`));
    });
  }).finally(() => heavyRuns.delete(id));
  heavyRuns.set(id, run);
  return run;
}

async function insightsCached(p, refresh = false) {
  const hit = insightsCache.get(p.key);
  if (!refresh && hit && Date.now() - hit.at < 120_000) return hit.data;
  const { data } = await runHeavy('insights', p.key);
  insightsCache.set(p.key, { at: Date.now(), data });
  return data;
}
// Ask 3/7: actions on an answer (lib/ask-actions.mjs).
let savingFaq = false;
let teamCache = null;
/** The team (git authors, staff): who may be @mentioned, and whose names stay readable when an answer is masked. */
function teamNames() {
  if (!teamCache || Date.now() - teamCache.at > 600_000) teamCache = { at: Date.now(), names: teamOf(all.projects) };
  return teamCache.names;
}
/** The recorded answer a request names (project and answerAt): the page sends which answer, never its text. */
function answerOf(body) {
  const p = readyProject(body);
  const record = findAnswer(p.stateDir, String(body.answerAt ?? ''));
  if (!record) throw Object.assign(new Error('this answer is not in the records (it was given before answers were kept): ask the question again'), { status: 404 });
  return { p, record };
}
/** K19 for a draft that is not an Insights suggestion, in a worker: Jira (the Insights tickets), the knowledge base, open PRs. */
async function priorArtOf(p, item, insights) {
  const { data } = await runHeavy('prior-art', p.key, { item, tickets: insights?.tickets ?? [], runId: item.summary });
  return data;
}
const askTime = (iso) => new Date(iso).toLocaleString('sv-SE', { hour12: false }).slice(0, 16);

/** The insights for a fast Ask answer: the cached ones at any age (refreshed in the background when older than 2 min). */
async function insightsForAsk(p) {
  const hit = insightsCache.get(p.key);
  if (!hit) return insightsCached(p);
  if (Date.now() - hit.at > 120_000) insightsCached(p, true).catch(() => {});
  return hit.data;
}

/**
 * J5 (System 1): the intent and the component of an Ask question. With policy system1.askRouter 'auto', a "who" or
 * "latest" question at 0.6 or more (a component at 0.4 or more for "who") gets a fast answer from the Insights data,
 * logged like any answer; otherwise null and Claude answers, with the routing attached ('shadow' and 'auto' alike).
 */
/**
 * Ask about a ticket's status (lib/ticket-status.mjs): the agent's events, the ticket in Jira, and the state of its
 * PRs on GitHub. No model. The ticket's own project answers, whatever project the Ask tab shows.
 */
async function ticketStatusAnswer(key, question, followUp = null, origin = null) {
  const p = all.ofTicket(key);
  const started = Date.now();
  const events = readEvents(rootState);
  let issue = null;
  try {
    issue = await jira.getIssue(key);
  } catch (e) {
    if (!/\b404\b/.test(e.message)) throw e; // Jira down is not "no such ticket"
  }
  const urls = [...new Set(events.filter((e) => e.key === key && ['pr', 'fix-proposed', 'documented'].includes(e.type) && e.url).map((e) => e.url))];
  const prs = {};
  for (const url of urls) {
    try {
      const j = JSON.parse((await execFileAsync('gh', ['pr', 'view', url, '--json', 'state,isDraft,mergedAt,mergeCommit'], { cwd: p.repoDir, encoding: 'utf8', timeout: 20_000, windowsHide: true })).stdout);
      prs[url] = { ...j, mergeCommit: j.mergeCommit?.oid ?? null };
    } catch {
      /* its state stays unknown: the answer says what the records say */
    }
  }
  const s = ticketStatus({ key, issue, events, prs, now: { processing: status.processing, queued: status.queue.map((q) => q.key) }, ticketUrl: (k) => jira.browseUrl(k) });
  const answer = { question, project: p.key, found: s.found, fast: true, via: 'records', intent: 'ticket', answer: s.answer, sources: s.sources, warnings: [], dropped: 0, closest: [], meta: { durationMs: Date.now() - started, costUsd: 0, model: "the agent's records" }, at: new Date().toISOString(), ...(followUp ? { followUp } : {}), ...(origin ? { origin } : {}) };
  logAsk(p.stateDir, answer);
  return answer;
}

/** The repository's files on origin/main, for "where is …" (cached per main commit). */
const repoFilesCache = new Map();
async function repoFiles(p) {
  try {
    const head = (await execFileAsync('git', ['rev-parse', 'origin/main'], { cwd: p.repoDir, encoding: 'utf8', windowsHide: true })).stdout.trim();
    const hit = repoFilesCache.get(p.key);
    if (hit?.head === head) return hit.files;
    const files = (await execFileAsync('git', ['ls-tree', '-r', '--name-only', head], { cwd: p.repoDir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true })).stdout.split('\n').filter(Boolean);
    repoFilesCache.set(p.key, { head, files });
    return files;
  } catch {
    return []; // SVN or no clone: "where" goes the full way
  }
}

// Ask 5/7: a page or an API path of an app, traced through its code on main (lib/page-code.mjs).
const fileTextCache = new Map(); // `${project}@${main}:${path}` → the file's text on that main
async function traceIn(p, where) {
  const files = await repoFiles(p);
  const head = repoFilesCache.get(p.key)?.head;
  if (!files.length || !head) return null;
  const read = async (f) => {
    const k = `${p.key}@${head}:${f}`;
    if (!fileTextCache.has(k)) {
      if (fileTextCache.size > 3000) fileTextCache.clear();
      fileTextCache.set(k, (await execFileAsync('git', ['show', `${head}:${f}`], { cwd: p.repoDir, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true })).stdout);
    }
    return fileTextCache.get(k);
  };
  return traceAddress({ where, files, read });
}
/**
 * The trace as an Ask answer, in the project whose app the address is on (its port), else the selected one.
 * @returns {Promise<{ p: object, answer: object }|null>}
 */
async function pageTraceAnswer(where, question, selected, followUp = null) {
  const byPort = where.port ? all.projects.find((x) => (x.app?.frontend === where.port || x.app?.backend === where.port) && existsSync(x.repoDir)) : null;
  const p = byPort ?? selected;
  const started = Date.now();
  const trace = await traceIn(p, where);
  if (!trace) return null;
  const insights = await insightsForAsk(p).catch(() => null);
  const repo = status.projects.find((x) => x.key === p.key)?.github?.repo;
  const a = pageAnswer({ question, trace, rules: p.cfg.insights?.components ?? [], insights, ticketUrl: (k) => jira.browseUrl(k), fileUrl: (f) => (repo ? `https://github.com/${repo}/blob/main/${f}` : null) });
  return {
    p,
    answer: { ...a, project: p.key, routed: { intent: 'page', intentP: 1, via: 'rule', model: 'a rule' }, warnings: [], dropped: 0, closest: [], meta: { durationMs: Date.now() - started, costUsd: 0, model: 'plain code: routes, components, services, controllers' }, at: new Date().toISOString(), ...(followUp ? { followUp } : {}) },
  };
}

/**
 * The fast ways to answer (J5 and Ask 2/7): a clear wording decides the intent (lib/ask-fast.mjs), else System 1
 * does; the component is the one the question names, never a model's guess for "latest", "history" or "where". Plain
 * code then answers from the Insights data and the file list, or the question goes to Claude.
 */
async function askRouted(p, question, full, previous = [], origin = null) {
  const mode = S1.askRouter ?? 'auto';
  if (mode === 'off' || !question.trim()) return null;
  const started = Date.now();
  const rules = p.cfg.insights?.components ?? [];
  // System 1 is still asked when it runs: a rule gives the intent, but for "who" its component counts too ("Ko zna kod
  // za pacijente?" names Pazienti in Serbian, which no rule reads).
  const byRule = ruleIntent(question);
  let model = null;
  if (system1.mode !== 'off') {
    try {
      const comps = rules.map((c) => c.name);
      const r = await system1.decide(question, { ...intentQuestion(), ...(comps.length ? { component: questionsFor(comps).component } : {}) });
      if (r) model = { intent: r.answers.intent?.choice, intentP: r.answers.intent?.p, component: r.answers.component?.choice, componentP: r.answers.component?.p, ms: r.ms };
    } catch {
      /* no model answer: a rule may still decide */
    }
  }
  if (!byRule && !model) return null; // the question goes to Claude
  const routed = byRule
    ? { intent: byRule, intentP: 1, component: model?.component ?? null, componentP: model?.componentP ?? 0, ms: model?.ms ?? 0, via: 'rule', model: 'a rule' }
    : { ...model, via: 'System 1', model: system1.model };
  if (mode !== 'auto' || full || routed.intentP < Number(S1.askIntentThreshold ?? 0.6) || !['who', 'latest', 'history', 'where'].includes(routed.intent)) return { routed };
  // The component the question names. For "who" only, System 1's own at 0.7 too: on 48 "who" questions
  // (demo/system1/ask-components.json) ft-2 named the wrong component 8 times at 0.4, none at 0.7. For "latest" it
  // always names one, asked or not ("What are the latest tickets?": "Report", 78 %), so not there.
  // A follow-up (Ask 4/7) that names no component is about the one the answer it follows was about: "Which bugs did
  // Scadenze have?" then "Who knows it best?".
  const before = previous.at(-1)?.component;
  const named = componentInQuestion(question, rules) ?? (before && rules.some((r) => r.name === before) ? before : null);
  const component = named ?? (routed.intent === 'who' && routed.componentP >= Number(S1.askComponentThreshold ?? 0.7) ? routed.component : null);
  if (routed.intent === 'who' && !component) return { routed };
  const insights = await insightsForAsk(p);
  const repo = status.projects.find((x) => x.key === p.key)?.github?.repo; // read once at start: no gh call here
  const fast = fastAnswer({ question, intent: routed.intent, component, insights, ticketUrl: (k) => jira.browseUrl(k) })
    ?? fastMore({ question, intent: routed.intent, component, insights, rules, files: routed.intent === 'where' ? await repoFiles(p) : [], ticketUrl: (k) => jira.browseUrl(k), fileUrl: (f) => (repo ? `https://github.com/${repo}/blob/main/${f}` : null) });
  if (!fast) return { routed };
  const answer = { ...fast, warnings: [], dropped: 0, closest: [], routed, meta: { durationMs: Date.now() - started, costUsd: 0, model: routed.via === 'rule' ? 'a rule and plain code' : `System 1 (${system1.model})` }, at: new Date().toISOString(), ...(previous.length ? { followUp: { at: previous.at(-1).at, question: previous.at(-1).question } } : {}), ...(origin ? { origin } : {}) };
  logAsk(p.stateDir, answer);
  return answer;
}

// Accuracy (AI1) from the project's graph (GG0): pull requests of the whole suite read once per refresh (a demo reset
// is recognised across the repositories), each project's result cached for two minutes like the insights.
const graphCache = new Map();
let suitePrsCache = null;
/** The project's graph (GG0) and its accuracy (AI1), with the daily snapshots: { graph, accuracy }. */
async function graphCached(p, refresh = false) {
  const hit = graphCache.get(p.key);
  if (!refresh && hit && Date.now() - hit.at < 120_000) return hit.data;
  // The suite's PRs are read once for all projects (in the first worker) and kept for two minutes.
  const prsFresh = !refresh && suitePrsCache && Date.now() - suitePrsCache.at < 120_000;
  const r = await runHeavy('graph', p.key, { suitePrs: prsFresh ? suitePrsCache.prs : null });
  if (r.suitePrs) suitePrsCache = { at: Date.now(), prs: r.suitePrs };
  graphCache.set(p.key, { at: Date.now(), data: r.data });
  return r.data;
}
const queryOf = (req) => new URL(req.url, 'http://localhost').searchParams;
const readyProject = (sel) => {
  const p = projectFor(sel);
  if (!existsSync(p.repoDir)) throw badRequest(`${p.name} (${p.key}) has no application clone yet: ${p.repoDir}`, 409);
  return p;
};

/**
 * One Ask question, the whole way (FR-65 and Ask 1/7–6/7): a follow-up's conversation, a ticket's status, a page's
 * code, plain-code answers, an earlier answer given again, then Claude. The dashboard and Teams (ROADMAP #9) both ask
 * through here; `origin` says where the question came from, in the record. The caller holds `asking`.
 */
async function answerAsk(body, { origin = null, onProgress = () => {} } = {}) {
  let p = readyProject(body);
  await health.require(); // otherwise "not in the knowledge base" when Jira only could not be searched
  // Ask 4/7: a follow-up names the answer it follows (in this project); the conversation, up to three answers back.
  const previous = body.followUp ? followUpChain(p.stateDir, String(body.followUp)) : [];
  if (body.followUp && !previous.length) throw badRequest('the answer this question follows is not in the records: ask it on its own', 404);
  const followUp = previous.length ? { at: previous.at(-1).at, question: previous.at(-1).question } : null;
  // A ticket key alone ("VAX-21", "status of VAX-21") is answered from the agent's records, in about a second.
  const statusKey = body.full === true ? null : ticketKeyQuestion(String(body.question ?? ''));
  if (statusKey && all.ofTicket(statusKey)) return { ok: true, ...(await ticketStatusAnswer(statusKey, String(body.question), followUp, origin)) };
  // Ask 5/7: the address of a page ("http://localhost:4204/pazienti/12", "/scadenze") or an API path ("/api/due"):
  // its code, traced by plain code, in the project whose app the address is on. A question about why it misbehaves
  // goes to Claude, with the trace as a hint.
  const where = pageInQuestion(String(body.question ?? ''));
  let hint = null;
  if (where) {
    const traced = await pageTraceAnswer(where, String(body.question), p, followUp).catch(() => null);
    if (traced && origin) traced.answer.origin = origin;
    if (traced && body.full !== true && pageOnly(String(body.question))) {
      logAsk(traced.p.stateDir, traced.answer);
      return { ok: true, ...traced.answer };
    }
    if (traced && (traced.p.key === p.key || !previous.length)) {
      p = traced.p;
      hint = traced.answer.answer;
    }
  }
  // J5 (System 1): "who knows X" and "the latest tickets" are answered from the Insights data, no Claude call.
  const routedAnswer = await askRouted(p, String(body.question ?? ''), body.full === true, previous, origin);
  if (routedAnswer?.fast) return { ok: true, project: p.key, ...routedAnswer };
  // The tour asks with fastOnly: never a paid Claude run.
  if (body.fastOnly === true) return { ok: false, notRouted: true, routed: routedAnswer?.routed ?? null };
  // Ask 6/7: the same question, answered by Claude on the same main within a day, is given again with no new run
  // ("Ask again" on the page asks for a fresh one). Not for a follow-up or a question with a page: their meaning
  // depends on more than the words.
  const reuseHours = Number(p.cfg.askReuseHours ?? 24);
  if (body.fresh !== true && !previous.length && !hint && reuseHours > 0) {
    const head = await execFileAsync('git', ['rev-parse', 'origin/main'], { cwd: p.repoDir, encoding: 'utf8', windowsHide: true }).then((r) => r.stdout.trim()).catch(() => null);
    const r = reusableAnswer(p.stateDir, String(body.question ?? ''), { head, maxHours: reuseHours });
    if (r) {
      const answer = { question: String(body.question).trim(), found: true, answer: r.answer, sources: r.cited, warnings: [], dropped: 0, closest: [], meta: { durationMs: 0, costUsd: 0, model: `the answer of ${askTime(r.at)}` }, at: new Date().toISOString(), cachedFrom: { at: r.at, question: r.question }, main: head, ...(origin ? { origin } : {}) };
      logAsk(p.stateDir, answer);
      return { ok: true, project: p.key, ...answer, routed: routedAnswer?.routed ?? null };
    }
  }
  // The linked apps too (K11): read-only checkouts of their main, apart from the analysis' (ask-peer-repo).
  const peers = peerCheckouts(p, all, (text) => onProgress(`warning: ${text}`), { name: 'ask-peer-repo' });
  const answer = await askQuestion({ question: body.question, repoDir: p.repoDir, stateDir: p.stateDir, cfg: p.cfg, jira, project: { key: p.key, name: p.name }, peers, previous, hint, origin, onProgress });
  return { ok: true, project: p.key, ...answer, routed: routedAnswer?.routed ?? null };
}

// ---------------------------------------------------------------- Teams inbox (ROADMAP #9, T7 and T8)
// The agent reads the team's channel through Microsoft Graph as one signed-in account (agent/teams-login.mjs) and
// answers the questions asked there ("ti: …", or an @mention of it) in their thread, through the same Ask as the
// dashboard. Outbound only. One question at a time, and the dashboard's too: a question waits for the other.
const TEAMS_INBOX_FILE = join(rootState, 'teams-inbox.json');
const teamsSettings = graphSettings();
const teamsGraph = teamsSettings ? createGraph({ ...teamsSettings, tokenFile: join(rootState, 'teams-token.json') }) : null;
const teamsInbox = { live: false, reason: null, account: null, channel: null, lastRead: null, answered: 0, error: null };
let teamsReading = false;
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
/** Why the inbox does not read, in words for the dashboard, or null when it can. */
function teamsInboxReason() {
  if ((policy.actions.askFromTeams ?? 'auto') === 'off') return 'askFromTeams is "off" in policy.json';
  if (!teamsGraph) return 'not set up: TEAMS_CLIENT_ID and TEAMS_TENANT_ID (docs/ROADMAP.md #9)';
  if (!teamsGraph.signedIn()) return 'not signed in: node agent/teams-login.mjs';
  if (!readInboxState(TEAMS_INBOX_FILE)?.channelId) return 'no channel yet: node agent/teams-login.mjs';
  return null;
}
async function readTeams() {
  if (teamsReading || draining) return;
  teamsReading = true;
  const was = `${teamsInbox.live}|${teamsInbox.error}`;
  try {
    teamsInbox.reason = teamsInboxReason();
    if (teamsInbox.reason) {
      teamsInbox.live = false;
      return;
    }
    const st = readInboxState(TEAMS_INBOX_FILE);
    const api = channelApi(teamsGraph, st);
    const me = teamsGraph.account();
    const roots = await api.recent(30);
    Object.assign(teamsInbox, { live: true, error: null, account: me?.name ?? null, channel: st.channelName, lastRead: new Date().toISOString() });
    // B (T9): "approve" / "reject: why" under a "fix ready" card, or naming its ticket ("ti: odbij VAX-25: why")
    // anywhere the agent is addressed, first; then the questions ("ti: …").
    const decisions = [...newDecisions(roots, { me, since: st.since, handled: st.handled }), ...keyedDecisions(roots, { me, since: st.since, handled: st.handled })].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    for (const d of decisions) {
      if (draining) break;
      await decideInTeams(d, st, api);
    }
    const taken = new Set(decisions.map((d) => d.id));
    // C (T10): "preuzimam" / "nije moje: who" under a handoff card, or naming its ticket where the agent is addressed.
    const owners = ownerReplies(roots, { me, since: st.since, handled: [...(st.handled ?? []), ...taken] });
    for (const r of owners.replies) {
      if (draining) break;
      taken.add(r.id);
      await ownerInTeams(r, st, api);
    }
    for (const m of owners.misplaced) {
      if (draining) break;
      taken.add(m.id);
      st.handled = [...(st.handled ?? []), m.id];
      writeInboxState(TEAMS_INBOX_FILE, st);
      const how = m.verdict === 'take' ? 'preuzimam <ticket>' : 'nije moje <ticket>: <who>';
      await api.reply(m.rootId, `<at id="0">${escHtml(m.from.name)}</at> ${escHtml(`Which ticket? Name it ("${how}"), or reply under its card. Nothing changed.`)}`, mentionOf(m.from)).catch(() => {});
    }
    // A decision under an Ask answer instead of its card: said where it goes, not carried out, not taken as a question.
    const { misplaced, newest } = misplacedDecisions(roots, { me, since: st.since, handled: st.handled });
    for (const m of misplaced) {
      if (draining) break;
      taken.add(m.id);
      st.handled = [...(st.handled ?? []), m.id];
      writeInboxState(TEAMS_INBOX_FILE, st);
      const what = m.verdict === 'approve' ? 'approve' : 'reject';
      await api
        .reply(m.rootId, `<at id="0">${escHtml(m.from.name)}</at> ${escHtml(`Which fix? Name its ticket ("${what} ${newest ?? '<ticket>'}${what === 'reject' ? ': why' : ''}"), or reply under its "fix ready for review" card${newest ? ` (the newest is ${newest}'s)` : ''}. Nothing changed.`)}`, mentionOf(m.from))
        .catch(() => {});
    }
    for (const q of newQuestions(roots, { me, since: st.since, handled: st.handled }).filter((x) => !taken.has(x.id))) {
      if (draining) break;
      await answerInTeams(q, st, api);
    }
  } catch (e) {
    Object.assign(teamsInbox, { live: false, error: String(e.message).split('\n')[0].slice(0, 240) });
  } finally {
    teamsReading = false;
    if (`${teamsInbox.live}|${teamsInbox.error}` !== was) {
      if (teamsInbox.error) events.emit('error', { text: `Teams inbox: ${teamsInbox.error}` });
      pushStatus();
    }
  }
}
/**
 * B (T9, ROADMAP #1): a decision under a "fix ready" card. Only the person the card was for (or teams.approvers) may
 * decide. Approve: the draft PR is marked ready for review, Jira says who approved it. Reject with a reason: the fix
 * runs again with it (a 'refix' job), at most maxFixAttempts in all; after the last one the PR is closed and the
 * ticket waits for a person. Merging stays a person's, in GitHub.
 */
async function decideInTeams(d, st, api) {
  st.handled = [...(st.handled ?? []), d.id];
  writeInboxState(TEAMS_INBOX_FILE, st);
  const say = (text, mention = true) => api.reply(d.rootId, `${mention ? '<at id="0">' + escHtml(d.from.name) + '</at> ' : ''}${escHtml(text)}`, mention ? mentionOf(d.from) : []).catch(() => {});
  const key = d.card.key;
  const p = all.ofTicket(key);
  if ((policy.actions.approveFix ?? 'draft') === 'off') return say('Approving or rejecting a fix from Teams is off (policy.json approveFix).');
  if (!p || !existsSync(p.repoDir)) return say(`${key} is not a ticket of the apps this agent watches.`);
  const sender = await teamsGraph.get(`/users/${encodeURIComponent(d.from.id)}?$select=displayName,userPrincipalName`).catch(() => ({ displayName: d.from.name }));
  const approvers = cfg.teams?.approvers ?? [];
  if (!mayDecide({ sender, card: d.card, approvers })) {
    return say(`Only ${d.card.to ?? 'the owner'}${approvers.length ? ` or ${approvers.join(', ')}` : ''} can approve or reject this fix; nothing changed.`);
  }
  const prUrl = prOfTicket(key, readEvents(rootState), d.card.prUrl);
  if (!prUrl) return say(`No pull request of ${key} found; nothing changed.`);
  const team = teamNames();
  try {
    if (d.verdict === 'approve') {
      const r = await readyPullRequest(prUrl, { cwd: p.repoDir });
      if (r.state !== 'OPEN') return say(`PR #${r.number} is ${r.state.toLowerCase()} already; nothing changed.`);
      if (!r.readied) return say(`PR #${r.number} was already ready for review; nothing changed.`);
      const note = d.note ? maskAnswer(d.note, team).text : '';
      events.emit('approved', { key, text: `approved in Teams by ${d.from.name}: PR #${r.number} is ready for review${note ? ` (${note.slice(0, 160)})` : ''}`, url: r.url });
      if (policy.actions.postInternalComment === 'auto') {
        await jira.comment(key, `(robot) *Fix approved in Teams* by ${d.from.name}: [PR #${r.number}|${r.url}] is ready for review (no longer a draft).${note ? ` Note: ${note}` : ''}\n_Merging stays a person's, in GitHub._`).catch((e) => events.emit('error', { key, text: `approval comment skipped: ${e.message.split('\n')[0]}` }));
      }
      await jira.labels(key, { add: ['ai-fix-approved'] }).catch(() => {});
      return say(`Approved: PR #${r.number} is ready for review now (no longer a draft). Merging stays in GitHub.`);
    }
    // reject
    if (!d.reason || d.reason.length < 3) return say('Say why, so that the next attempt can do better: "reject: <what is wrong>".');
    const reason = maskAnswer(d.reason, team).text;
    const before = rejectionsOf(p.stateDir, key);
    const attempt = before.length + 1; // the attempt that was rejected
    const max = Number(p.cfg.maxFixAttempts ?? 2);
    recordRejection(p.stateDir, key, { by: d.from.name, reason, prUrl, attempt });
    await jira.labels(key, { add: ['ai-fix-rejected'] }).catch(() => {});
    if (attempt >= max) {
      const closed = await closePullRequest(prUrl, `Rejected in Teams by ${d.from.name}: ${reason}\n\nThat was attempt ${attempt} of ${max}: the agent stops here, and the ticket waits for a person. The branch stays.`, { cwd: p.repoDir });
      events.emit('rejected', { key, text: `rejected in Teams by ${d.from.name} (attempt ${attempt} of ${max}, the last): ${reason.slice(0, 200)}; PR #${closed.number} closed, the ticket waits for a person`, url: prUrl });
      if (policy.actions.postInternalComment === 'auto') await jira.comment(key, `(robot) *Fix rejected in Teams* by ${d.from.name}: ${reason}\nAttempt ${attempt} of ${max}: the agent stops; the ticket waits for a person. [The closed PR|${prUrl}] keeps its branch.`).catch(() => {});
      return say(`Rejected. That was attempt ${attempt} of ${max}, so the agent stops here: PR #${closed.number} is closed (its branch stays) and the ticket waits for a person.`);
    }
    events.emit('rejected', { key, text: `rejected in Teams by ${d.from.name} (attempt ${attempt} of ${max}): ${reason.slice(0, 200)}; the fix runs again with this reason`, url: prUrl });
    if (policy.actions.postInternalComment === 'auto') await jira.comment(key, `(robot) *Fix rejected in Teams* by ${d.from.name}: ${reason}\nThe agent fixes the ticket again with this reason (attempt ${attempt + 1} of ${max}); the rejected change is kept on branch {{${key}-rejected-${attempt}}}.`).catch(() => {});
    status.queue.push({ kind: 'refix', key, project: p.key, reason, by: d.from.name, prUrl, attempt });
    pushStatus();
    drain();
    return say(`Rejected: the agent fixes ${key} again with your reason (attempt ${attempt + 1} of ${max}). The rejected change is kept on branch ${key}-rejected-${attempt}; the new draft PR comes here when it is ready, in about five minutes.`);
  } catch (e) {
    const why = String(e.stderr || e.message).split('\n')[0].slice(0, 200);
    events.emit('error', { key, text: `Teams decision on ${key} not carried out: ${why}` });
    return say(`Not done: ${why}`);
  }
}
const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * C (T10): the owner's answer to a handoff. Only the person the card was for, a person it was handed on to since, or
 * teams.approvers. "Take": assigned in Jira to the Jira user of the same name (when there is one), a Jira comment, the
 * label ai-owner-taken. "Not mine: who": a Jira comment, and the agent hands the ticket to that person in the thread
 * (@mentioned, found in Teams by name); that person may then take it or hand it on.
 */
async function ownerInTeams(r, st, api) {
  st.handled = [...(st.handled ?? []), r.id];
  writeInboxState(TEAMS_INBOX_FILE, st);
  const say = (text) => api.reply(r.rootId, `<at id="0">${escHtml(r.from.name)}</at> ${escHtml(text)}`, mentionOf(r.from)).catch(() => {});
  const { key } = r;
  const p = all.ofTicket(key);
  if ((policy.actions.ownerReply ?? 'draft') === 'off') return say('Taking or handing on a ticket from Teams is off (policy.json ownerReply).');
  if (!p) return say(`${key} is not a ticket of the apps this agent watches.`);
  const sender = await teamsGraph.get(`/users/${encodeURIComponent(r.from.id)}?$select=displayName,userPrincipalName`).catch(() => ({ displayName: r.from.name }));
  const approvers = cfg.teams?.approvers ?? [];
  const handedTo = st.handedTo?.[key] ?? [];
  if (!mayAnswer({ sender, card: r.card, approvers, handedTo })) {
    const who = [r.card.to, ...handedTo, ...approvers].filter(Boolean);
    return say(`Only ${who.length ? who.join(', ') : 'the owner or an approver'} can take or hand on ${key}; nothing changed.`);
  }
  try {
    const [issue] = await jira.search(`key = ${key}`, 1);
    if (!issue) return say(`${key} was not found in Jira; nothing changed.`);
    const name = sender.displayName ?? r.from.name;
    const comment = (text) => (policy.actions.postInternalComment === 'auto' ? jira.comment(key, text).catch((e) => events.emit('error', { key, text: `owner comment skipped: ${e.message.split('\n')[0]}` })) : null);
    if (r.verdict === 'take') {
      const user = sameNameUser(await jira.assignableUsers(p.key, fold(name).split(' ')[0]).catch(() => []), name);
      if (user) await jira.assign(key, user.accountId);
      const note = r.note ? maskAnswer(r.note, teamNames()).text : '';
      await comment(`(robot) *Taken in Teams* by ${name}${user ? ': assigned to them' : ` (no Jira account of that name, so the assignee is unchanged)`}.${note ? ` Note: ${note}` : ''}`);
      await jira.labels(key, { add: ['ai-owner-taken'] }).catch(() => {});
      events.emit('taken', { key, text: `taken in Teams by ${name}${user ? ', assigned in Jira' : ' (no Jira account of that name: assignee unchanged)'}`, url: jira.browseUrl(key) });
      return say(user ? `${key} is yours: assigned to you in Jira.` : `Noted in Jira that you took ${key}. No Jira account has your name, so the assignee is unchanged.`);
    }
    if (!r.who) return say(`To whom? "nije moje: <name>" (or @mention them), and the agent hands ${key} on.`);
    let target = r.whoId ? { id: r.whoId, name: r.who } : null;
    if (!target) {
      const first = r.who.split(/\s+/)[0].replace(/'/g, "''");
      const found = await teamsGraph.get(`/users?$filter=startswith(displayName,'${encodeURIComponent(first)}')&$select=id,displayName&$top=20`).catch(() => ({ value: [] }));
      const hits = (found.value ?? []).filter((u) => fold(u.displayName) === fold(r.who) || fold(u.displayName).startsWith(`${fold(r.who)} `));
      if (hits.length === 1) target = { id: hits[0].id, name: hits[0].displayName };
    }
    if (!target) return say(`No one in Teams is called "${r.who}" (or more than one is); nothing changed. Write the name as in Teams, or @mention them.`);
    if (fold(target.name) === fold(name)) return say(`That is you: "preuzimam" takes ${key}.`);
    st.handedTo = { ...(st.handedTo ?? {}), [key]: [...handedTo, target.name] };
    writeInboxState(TEAMS_INBOX_FILE, st);
    await comment(`(robot) *Handed on in Teams* by ${name}: not theirs; handed to ${target.name}.`);
    events.emit('handed-on', { key, text: `handed on in Teams by ${name} to ${target.name}`, url: jira.browseUrl(key) });
    const summary = maskAnswer(issue.summary ?? '', teamNames()).text;
    await api.reply(r.rootId, `<at id="0">${escHtml(target.name)}</at> ${escHtml(`${name} hands ${key} to you: ${summary}. Reply "preuzimam" (or "I take it") here to take it, or "nije moje: <name>" to hand it on.`)}`, mentionOf(target));
  } catch (e) {
    const why = String(e.stderr || e.message).split('\n')[0].slice(0, 200);
    events.emit('error', { key, text: `Teams answer on ${key} not carried out: ${why}` });
    return say(`Not done: ${why}`);
  }
}

/** One question from the channel: answered in its thread, the asker @mentioned; a follow-up in the thread of an answer. */
async function answerInTeams(q, st, api) {
  // Handled before it is answered: after a crash a question is lost rather than answered twice.
  st.handled = [...(st.handled ?? []), q.id];
  writeInboxState(TEAMS_INBOX_FILE, st);
  const thread = q.inThread ? st.threads?.[q.rootId] : null;
  const fallback = cfg.teams?.project ?? all.projects.find((x) => x.cfg?.pilot && existsSync(x.repoDir))?.key ?? all.projects.find((x) => existsSync(x.repoDir))?.key;
  const asked = projectOf(q.question, all.projects, thread?.project ?? fallback);
  const followUp = thread && thread.project === asked.project ? thread.lastAnswerAt : null;
  events.emit('teams-asked', { project: asked.project, text: `${asked.project}: ${q.from.name} asked in Teams: ${asked.question.slice(0, 140)}` });
  for (let i = 0; asking && i < 180; i++) await sleepMs(1000); // the dashboard's question first
  if (asking) {
    await api.reply(q.rootId, noteHtml('Busy with another question for three minutes: ask again in a moment.')).catch(() => {});
    return;
  }
  asking = true;
  // A Claude answer takes about a minute: say so after a few seconds, so that nobody asks twice.
  const working = setTimeout(() => api.reply(q.rootId, noteHtml('Looking it up in the tickets, the code and the knowledge base: about a minute.')).catch(() => {}), 6000);
  try {
    const a = await answerAsk({ project: asked.project, question: asked.question, followUp }, { origin: 'teams' });
    clearTimeout(working);
    const p = all.byKey(a.project) ?? all.byKey(asked.project);
    const html = answerHtml({ answer: maskAnswer(a.answer, teamNames()).text, sources: a.sources ?? [], found: a.found !== false }, { asker: q.from, projectName: p?.name ?? a.project, how: viaText(viaOf(a)), givenAgain: Boolean(a.cachedFrom), followUp: Boolean(followUp) });
    await api.reply(q.rootId, html, mentionOf(q.from));
    st.threads = { ...(st.threads ?? {}), [q.rootId]: { project: a.project, lastAnswerAt: a.at, at: new Date().toISOString() } };
    writeInboxState(TEAMS_INBOX_FILE, st);
    teamsInbox.answered++;
    events.emit('teams-answered', { project: a.project, text: `${a.project}: answered in Teams ${viaText(viaOf(a))}${a.cachedFrom ? ', given again' : ''}: ${asked.question.slice(0, 120)}` });
  } catch (e) {
    clearTimeout(working);
    const why = String(e.message).split('\n')[0].slice(0, 200);
    await api.reply(q.rootId, noteHtml(`Not answered: ${why}`)).catch(() => {});
    events.emit('error', { text: `Teams question not answered: ${why}` });
  } finally {
    asking = false;
  }
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
  // System 1's chapter of the tour (J9): its recorded runs, the privacy moment, and the "who knows" question it asks
  // live (answered without Claude, at no cost). agent.config.json system1.tour (read-only).
  if (path === '/api/tour/system1') {
    const t = cfg.system1?.tour ?? {};
    return json(res, 200, { runs: system1Runs(rootState, t.runs ?? []), privacy: t.privacy ? system1Privacy(rootState, t.privacy) : null, ask: t.ask ?? null, model: system1.model });
  }
  // What the presentation shows as numbers and quotes (docs/PRESENTATION_PLAN.md), from the agent's own records:
  // agent.config.json presentation.case, .system1, .catches (read-only, plain code).
  if (path === '/api/tour/facts') {
    return json(res, 200, presentationFacts({
      stateDir: rootState,
      pres: cfg.presentation ?? {},
      stateDirOf: (k) => all.ofTicket(k)?.stateDir ?? null,
      repoDirOf: (k) => all.ofTicket(k)?.repoDir ?? null,
      nightShift: cfg.nightShift ?? null,
      // System 1's switches as they act now: a miss may have put one back in shadow (state/autonomy.json).
      policy: { actions: policy.actions, system1: S1 },
    }));
  }
  // Recorded Ask answers of a project, for the tour to replay instead of asking (and paying) again (read-only).
  if (path === '/api/tour/asks') {
    try {
      const p = readyProject({ project: queryOf(req).get('project') });
      // The presentation names its question (agent.config.json presentation.ask); the tour takes the project's examples.
      const question = queryOf(req).get('question');
      return json(res, 200, { project: p.key, answers: recordedAsks(p.stateDir, [question, ...(p.askExamples ?? [])].filter(Boolean)) });
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
  // For a new watcher started with --replace (lib/replace.mjs): what this one is in the middle of, and a stop to new
  // jobs while it finishes. Queued jobs stay queued: the new watcher finds the tickets again in Jira.
  if (req.method === 'GET' && path === '/api/busy') {
    const what = [
      status.processing && `${status.processing.kind ?? 'job'} ${status.processing.key ?? ''}`.trim(),
      reviewing && `AI review of ${reviewing}`,
      recommending && 'hotspot recommendations',
      mergingDocs && 'a documentation merge',
      asking && 'an Ask question',
      savingFaq && 'saving an Ask answer as an FAQ',
    ].filter(Boolean);
    return json(res, 200, { busy: what.length > 0, what, draining });
  }
  if (req.method === 'POST' && path === '/api/drain') {
    const body = await readBody(req);
    draining = body.on !== false;
    events.emit('replacing', { text: draining ? 'a new watcher is waiting to replace this one: no new job starts until it does' : 'the replacement gave up: back to work' });
    if (!draining) drain();
    return json(res, 200, { ok: true, draining });
  }
  if (draining && req.method === 'POST' && ['/api/insights/review', '/api/insights/recommend', '/api/knowledge/merge', '/api/run', '/api/ask', '/api/ask/faq'].includes(path)) {
    return json(res, 503, { ok: false, error: 'this watcher is about to be replaced by a newer one: try again in a minute' });
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
  // System 1 (J8b): what it did (from the events) and how good the current checkpoint is (its evaluation).
  if (req.method === 'GET' && path === '/api/system1') {
    try {
      const lines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : []);
      const cp = currentCheckpoint({ agentDir: HERE, stateDir: rootState, cfg });
      const evalFile = join(rootState, 'system1', `eval-${cp.name}.json`);
      const evaluation = existsSync(evalFile) ? JSON.parse(readFileSync(evalFile, 'utf8')) : null;
      const report = system1Report({ events: lines(join(rootState, 'events.jsonl')), asks: all.projects.flatMap((p) => lines(join(p.stateDir, 'asks.jsonl'))), evaluation, checkpoint: { name: cp.name, from: cp.from, ready: status.system1?.ready ?? null }, policy });
      return json(res, 200, { ok: true, ...report });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }
  // System 1 (J2/J6): a person's decision on a held ticket: { key, action: 'light' | 'analyze' }.
  if (req.method === 'POST' && path === '/api/system1/decide') {
    const { key, action } = await readBody(req);
    try {
      return json(res, 200, { ok: true, ...(await decideHeld(String(key ?? '').trim().toUpperCase(), String(action ?? ''))) });
    } catch (e) {
      return json(res, e.status ?? 500, { ok: false, error: e.message });
    }
  }
  // J8b: serve the checkpoint system1-train.mjs has just accepted (current.json), without restarting the watcher.
  if (req.method === 'POST' && path === '/api/system1/reload') {
    if (system1.mode === 'off') return json(res, 409, { ok: false, error: 'System 1 is off in policy.json' });
    const ok = await system1.reload();
    status.system1 = { mode: system1.mode, model: system1.model, ready: ok, reason: ok ? null : system1.reason, live: system1Live() };
    pushStatus();
    return json(res, ok ? 200 : 503, { ok, model: system1.model, reason: ok ? null : system1.reason });
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
      const researched = readResearch(p.stateDir);
      const gaps = knowledgeGaps(readAsks(p.stateDir)).map((g) => ({ ...g, research: researchOf(g, researched) ?? (status.queue.some((q) => q.kind === 'research' && q.project === p.key && g.questions.some((x) => x.question === q.question)) ? { outcome: 'queued' } : null) }));
      return json(res, 200, { ...data, gaps, project: p.key, recommendations: readRecommendations(p.stateDir, data), review, reviewing: reviewing === p.key, suggestions, createTicket: policy.actions.createTicket ?? 'draft', researchGaps: policy.actions.researchGaps ?? 'draft' });
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
      const data = hit && Date.now() - hit.at < 60_000 && queryOf(req).get('refresh') !== '1' ? hit.data : (await runHeavy('knowledge', p.key)).data; // gh, in a worker
      knowledgeCache.set(p.key, { at: Date.now(), data });
      // KB1: the last run of the known issues' regression tests (agent/knowledge-tests.mjs), when there is one.
      let tests = null;
      try {
        const t = JSON.parse(readFileSync(join(p.stateDir, 'knowledge-tests.json'), 'utf8'));
        tests = { at: t.at, head: t.head, totals: t.totals, entries: t.entries.map(({ key, title, file, anchor, status, source, tests: ts }) => ({ key, title, file, anchor, status, source, tests: ts.filter((x) => x.status !== 'pass').map((x) => ({ file: x.file, status: x.status, failed: x.failed ?? null, missing: x.missing ?? null })) })) };
      } catch {
        /* not run yet */
      }
      return json(res, 200, { project: p.key, ...data, tests, mergeDocs: policy.actions.mergeDocs ?? 'draft', mergeDocsAfterHours: Number(policy.mergeDocsAfterHours ?? 24) });
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
      const m = await mergeDocsPr(p, number);
      return json(res, 200, { ok: true, project: p.key, ...m });
    } catch (e) {
      return json(res, e.status ?? 500, { ok: false, error: e.message });
    } finally {
      mergingDocs = false;
    }
  }
  // KG2: a person asks the researcher to look into one knowledge gap: { project, question } (a question of the gaps).
  if (req.method === 'POST' && path === '/api/knowledge/research') {
    try {
      if ((policy.actions.researchGaps ?? 'draft') === 'off') return json(res, 403, { ok: false, error: 'researchGaps is "off" in policy.json' });
      if (draining) return json(res, 503, { ok: false, error: 'the agent is about to restart: try again in a minute' });
      const body = await readBody(req);
      const p = readyProject(body);
      const gap = knowledgeGaps(readAsks(p.stateDir)).find((g) => g.questions.some((q) => q.question === body.question));
      if (!gap) throw badRequest('not a question of the knowledge gaps');
      const q = gap.questions.find((x) => x.question === body.question);
      const r = queueResearch(p, { question: q.question, why: q.why, note: q.note, group: gap.questions.map((x) => x.question) }, 'person');
      return json(res, r.queued ? 200 : 409, r.queued ? { ok: true } : { ok: false, error: r.why });
    } catch (e) {
      return json(res, e.status ?? 500, { ok: false, error: e.message });
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
  // Ask 7/7: how Ask does across the suite, week by week, for the Impact tab (lib/ask-stats.mjs): plain file reads.
  if (req.method === 'GET' && path === '/api/ask/stats') {
    try {
      const weeks = Math.min(26, Math.max(1, Number(queryOf(req).get('weeks')) || 8));
      return json(res, 200, askStats(all.projects.map((x) => ({ project: x.key, name: x.name, ...readAsks(x.stateDir) })), { weeks }));
    } catch (e) {
      return json(res, e.status ?? 500, { ok: false, error: e.message });
    }
  }
  // Ask 6/7: the earlier answers of a project, newest first, with their votes and what was done with them.
  if (req.method === 'GET' && path === '/api/ask/history') {
    try {
      const q = queryOf(req);
      const p = readyProject({ project: q.get('project') });
      const limit = Math.min(200, Math.max(1, Number(q.get('limit')) || 50));
      return json(res, 200, { project: p.key, answers: askHistory(p.stateDir, { limit }).map((a) => ({ ...a, project: p.key })) });
    } catch (e) {
      return json(res, e.status ?? 500, { ok: false, error: e.message });
    }
  }
  // Ask 3/7: what was done with an answer, and whom it can go to in Teams.
  if (req.method === 'GET' && path === '/api/ask/actions') {
    try {
      const q = queryOf(req);
      const { p, record } = answerOf({ project: q.get('project'), answerAt: q.get('answerAt') });
      const insights = record.component ? await insightsForAsk(p).catch(() => null) : null;
      const done = actionsOn(p.stateDir, record.at);
      return json(res, 200, {
        people: peopleFor(record, { team: teamNames(), insights }),
        teams: teamsInfo(),
        done,
        faq: { why: faqRefusal(record, voteOn(p.stateDir, record.at)) },
      });
    } catch (e) {
      return json(res, e.status ?? 500, { ok: false, error: e.message });
    }
  }
  // Ask 3/7: an answer to the Teams channel, as recorded and masked, for a person of the team when one is picked.
  if (req.method === 'POST' && path === '/api/ask/share') {
    try {
      if ((policy.actions.shareAnswer ?? 'draft') === 'off') return json(res, 403, { ok: false, error: 'shareAnswer is "off" in policy.json' });
      const body = await readBody(req);
      const { p, record } = answerOf(body);
      const team = teamNames();
      const insights = record.component ? await insightsForAsk(p).catch(() => null) : null;
      const to = body.to ? peopleFor(record, { team, insights }).find((x) => x.name === body.to)?.name ?? null : null;
      if (body.to && !to) throw badRequest(`${body.to} is not one of the people of this answer`);
      const before = actionsOn(p.stateDir, record.at).filter((a) => a.action === 'teams' && a.channel !== 'failed');
      if (before.length && body.again !== true) return json(res, 409, { ok: false, already: true, error: `already shared on ${askTime(before.at(-1).at)}${before.at(-1).to ? ` for ${before.at(-1).to}` : ''}` });
      const answer = maskAnswer(record.answer, team);
      const n = await shareAnswer({ project: p.key, projectName: p.name, question: maskAnswer(record.question, team).text, answer: answer.text, sources: record.cited, how: viaText(record.via), to, note: maskAnswer(String(body.note ?? '').slice(0, 500), team).text });
      recordAction(p.stateDir, { answerAt: record.at, action: 'teams', to, channel: n.channel, error: n.error ?? null, masked: answer.masked });
      const where = n.channel === 'teams' ? 'posted to Teams' : n.channel === 'failed' ? 'NOT posted to Teams' : 'shared (simulated: no Teams webhook)';
      events.emit('ask-shared', { project: p.key, text: `${p.key}: an Ask answer ${where}${to ? ` for ${to}` : ''}: ${record.question.slice(0, 120)}`, channel: n.channel, error: n.error ?? null, card: n.card });
      if (n.channel === 'failed') return json(res, 502, { ok: false, error: n.error });
      return json(res, 200, { ok: true, channel: n.channel, to, mentioned: n.card.mentioned === true, masked: answer.masked });
    } catch (e) {
      return json(res, e.status ?? 500, { ok: false, error: e.message });
    }
  }
  // Ask 3/7: a Jira draft from an answer, checked against what the project already has (K19); a person edits it.
  if (req.method === 'GET' && path === '/api/ask/ticket') {
    try {
      const q = queryOf(req);
      const { p, record } = answerOf({ project: q.get('project'), answerAt: q.get('answerAt') });
      const created = readCreated(p.stateDir)[`ask-${record.at}`] ?? null;
      if (created) return json(res, 200, { created });
      await health.require(); // the check compares with the tickets in Jira
      const insights = await insightsForAsk(p);
      const person = peopleFor(record, { team: teamNames(), insights })[0] ?? null;
      const draft = ticketDraft(record, { person, time: askTime });
      return json(res, 200, { draft: { ...draft, project: p.key, priorArt: await priorArtOf(p, priorArtItem(record, draft.summary), insights) }, created: null });
    } catch (e) {
      return json(res, e.status ?? 500, { ok: false, error: e.message });
    }
  }
  // Ask 3/7: create that draft in Jira, after a person checked and confirmed it (policy createTicket, as for Insights).
  if (req.method === 'POST' && path === '/api/ask/ticket') {
    try {
      if ((policy.actions.createTicket ?? 'draft') === 'off') return json(res, 403, { ok: false, error: 'createTicket is "off" in policy.json' });
      const body = await readBody(req);
      const { p, record } = answerOf(body);
      await health.require();
      const id = `ask-${record.at}`;
      const already = readCreated(p.stateDir)[id];
      if (already) return json(res, 409, { ok: false, error: `already created as ${already.key}` });
      // Checked again live, on the summary the person wrote: Jira and the open PRs may have changed meanwhile.
      const insights = await insightsCached(p, true);
      const person = peopleFor(record, { team: teamNames(), insights })[0] ?? null;
      const draft = ticketDraft(record, { person, time: askTime });
      const summary = String(body.edits?.summary ?? draft.summary);
      const priorArt = await priorArtOf(p, priorArtItem(record, summary), insights);
      const reason = String(body.reason ?? '').trim();
      if (priorArt.verdict !== 'new' && !reason) {
        const what = { 'duplicate-of': `${priorArt.key} is open and says the same`, 'fixed-by': `${priorArt.key} fixed it`, 'in-progress': `pull request #${priorArt.pr} is changing the same files` }[priorArt.verdict] ?? priorArt.verdict;
        return json(res, 409, { ok: false, error: `${what}; to create it anyway, give the reason`, priorArt });
      }
      insightsCache.delete(p.key);
      const created = await createSuggested({ jira, project: p.key, stateDir: p.stateDir, suggestion: { ...draft, priorArt }, edits: body.edits ?? {}, assign: body.assign !== false, assigneeId: body.assigneeId, analyze: body.analyze === true, reason, labels: ['from-ask'] });
      recordAction(p.stateDir, { answerAt: record.at, action: 'ticket', key: created.key, url: created.url });
      events.emit('insights', { project: p.key, text: `${created.key} created from an Ask answer: ${created.summary}${created.assignee ? ` (assigned to ${created.assignee})` : ''}` });
      return json(res, 200, { ok: true, ...created });
    } catch (e) {
      return json(res, e.status ?? 500, { ok: false, error: e.message });
    }
  }
  // Ask 3/7 (K15): an answer rated right goes into docs/knowledge/faq.md through a documentation PR; merging stays a
  // person's (policy promoteFaq: draft; mergeDocs for the merge).
  if (req.method === 'POST' && path === '/api/ask/faq') {
    if ((policy.actions.promoteFaq ?? 'draft') === 'off') return json(res, 403, { ok: false, error: 'promoteFaq is "off" in policy.json' });
    if (savingFaq) return json(res, 409, { ok: false, error: 'another answer is being saved; try again in a moment' });
    savingFaq = true;
    try {
      const body = await readBody(req);
      const { p, record } = answerOf(body);
      const why = faqRefusal(record, voteOn(p.stateDir, record.at));
      if (why) return json(res, 409, { ok: false, error: `not saved as an FAQ: ${why}` });
      const before = actionsOn(p.stateDir, record.at).find((a) => a.action === 'faq');
      if (before) return json(res, 409, { ok: false, error: `already saved: PR #${before.number} (${before.url})` });
      const r = await saveFaq({ repoDir: p.repoDir, workDir: join(p.stateDir, 'faq-work'), record, date: askTime(record.at), team: teamNames() });
      recordAction(p.stateDir, { answerAt: record.at, action: 'faq', number: r.number, url: r.url, branch: r.branch, masked: r.masked });
      knowledgeCache.delete(p.key);
      events.emit('insights', { project: p.key, text: `${p.key}: an Ask answer saved as an FAQ ${r.created ? 'in a new documentation PR' : 'in the open FAQ PR'} #${r.number}: ${record.question.slice(0, 120)}`, url: r.url });
      return json(res, 200, { ok: true, ...r });
    } catch (e) {
      return json(res, e.status ?? 500, { ok: false, error: String(e.stderr || e.message).trim().split('\n')[0] });
    } finally {
      savingFaq = false;
    }
  }
  // Ask the knowledge base of one project (FR-65): one question at a time; progress goes to the dashboard stream.
  if (req.method === 'POST' && path === '/api/ask') {
    if (asking) return json(res, 409, { ok: false, error: 'another question is being answered; try again in a minute' });
    const body = await readBody(req);
    asking = true;
    try {
      return json(res, 200, await answerAsk(body, { onProgress: (step) => broadcast({ type: 'ask-progress', id: body.id, step }) }));
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
  system1.stop();
};
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));

setInterval(() => broadcast({ type: 'ping', at: new Date().toISOString() }), 15_000);
events.emit('started', { text: `watching ${WATCHED.join(', ')} every ${cfg.pollSeconds}s` });
if (system1.mode !== 'off') {
  system1.start().then((ok) => {
    status.system1 = { mode: system1.mode, model: system1.model, ready: ok, reason: ok ? null : system1.reason, live: system1Live() };
    if (!ok) {
      console.log(`System 1 off: ${system1.reason}`);
      events.emit('error', { text: `System 1 off: ${system1.reason}` });
    }
    pushStatus();
  });
} else console.log('System 1 off: policy.json system1.intake is off');
const first = await health.check();
console.log(first.ok ? `Jira: connected as ${first.user}` : `Jira UNAVAILABLE: ${first.error}`);
for (const w of first.warnings) console.log(`Jira warning: ${w}`);
// Stale labels are removed once Jira answers (when it is unavailable now, the jira-up change above does it).
if (first.ok) await recoverStuckTickets().catch((e) => events.emit('error', { text: `recovery failed: ${e.message}` }));
await poll();
setInterval(poll, cfg.pollSeconds * 1000);
await checkMains();
setInterval(checkMains, GUARD_SECONDS * 1000);
// Ask's fast answers read the Insights data (insightsForAsk keeps it at any age). Built once in the background after a
// start, one project at a time in a worker, so the first question after a restart does not wait for it: 52 s on
// 2026-11-17, for "Which bugs did Scadenze have?".
(async () => {
  for (const p of all.projects.filter((x) => existsSync(x.repoDir))) {
    if (draining) return;
    if (!insightsCache.has(p.key)) await insightsCached(p).catch(() => {});
  }
})();
// ROADMAP #9: the Teams inbox, every teams.pollSeconds (15 by default; 5 for a demo).
status.teamsInbox = teamsInbox;
teamsInbox.reason = teamsInboxReason();
if (!teamsInbox.reason) console.log(`Teams inbox: reading ${readInboxState(TEAMS_INBOX_FILE).channelName} as ${teamsGraph.account()?.name ?? 'the signed-in account'} every ${Number(cfg.teams?.pollSeconds ?? 15)}s ("ti: …")`);
else console.log(`Teams inbox off: ${teamsInbox.reason}`);
setInterval(() => readTeams().catch(() => {}), Math.max(3, Number(cfg.teams?.pollSeconds ?? 15)) * 1000);
readTeams().catch(() => {});
