#!/usr/bin/env node
// The pilot (docs/PILOT.md): a steady flow of realistic bugs on MediVax, with an answer key, so the agent's accuracy
// grows from cases it has never seen. Each case: a developer's change with a hidden bug is pushed to main (after the
// existing tests pass, as CI would require), and later a user reports the symptom in Jira. The agent does the rest on
// its own; this script only scores what it did against the answer key.
//
//   node demo/pilot.mjs status                 the cases so far, their scores, and what comes next
//   node demo/pilot.mjs check [--case id]      dry run of the catalog: does each change apply, do the tests miss it
//   node demo/pilot.mjs plant [--case id]      push the next case's change now (Jira story + commit on main)
//   node demo/pilot.mjs report [--case id]     report the bug of a pushed case now (Jira ticket)
//   node demo/pilot.mjs tick                   what the schedule runs every 30 minutes: report, push, score
//   node demo/pilot.mjs schedule --install     run tick every 30 minutes (Windows Task Scheduler, hidden); --remove
//
// State: <project state>/pilot/state.json (the cases run), score.json, tick.log. The patients are synthetic.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readEvents } from '../agent/lib/git-graph.mjs';
import { loadProjects } from '../agent/lib/projects.mjs';
import { runBackendTests, runE2E, runFrontendBuild } from '../agent/lib/verify.mjs';
import { linkDeps } from '../agent/lib/workspace.mjs';
import { applyEdits, hashOf, localDay, nextActions, redactionScore, reportDelayMinutes, scoreRun, summarize, ticketHelpers } from './lib/pilot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const AGENT = join(ROOT, 'agent');
const all = loadProjects(AGENT);
const project = all.projects.find((x) => x.cfg.pilot);
if (!project) {
  console.error('No project has "pilot" settings in agent/agent.config.json.');
  process.exit(1);
}
const PILOT = { perDay: 2, hours: [10, 15], reportAfterMinutes: [60, 180], ...project.cfg.pilot };
const SRC = join(HERE, 'src', 'medivax');
const { CASES } = await import(pathToFileURL(join(SRC, 'pilot-cases.mjs')).href);
const { PEOPLE } = await import(pathToFileURL(join(SRC, 'history.mjs')).href);
const DIR = join(project.stateDir, 'pilot');
const STATE = join(DIR, 'state.json');
const PLANTER = join(DIR, 'planter');
const toolsDir = all.global.toolsDir ? resolve(AGENT, all.global.toolsDir) : null;
mkdirSync(DIR, { recursive: true });

const args = process.argv.slice(2);
const cmd = args[0] ?? 'status';
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const log = (line) => {
  const text = `${new Date().toISOString()} ${line}`;
  console.log(line);
  appendFileSync(join(DIR, 'tick.log'), `${text}\n`);
};

const load = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { runs: [] });
const save = (s) => writeFileSync(STATE, `${JSON.stringify(s, null, 2)}\n`);
const caseOf = (id) => CASES.find((c) => c.id === id) ?? (() => { throw new Error(`unknown case ${id}; cases: ${CASES.map((c) => c.id).join(', ')}`); })();

// ------------------------------------------------------------------ Jira (the analyze-ticket skill's credentials)
const SKILL = existsSync(join(homedir(), '.claude', 'skills', 'analyze-ticket')) ? join(homedir(), '.claude', 'skills', 'analyze-ticket') : join(ROOT, '.claude', 'skills', 'analyze-ticket');
const skillLib = (f) => import(pathToFileURL(join(SKILL, 'scripts', 'lib', f)).href);
async function jira() {
  const { loadConfig } = await skillLib('config.mjs');
  const cfg = loadConfig();
  if (cfg.mock || !cfg.baseUrl) throw new Error('Jira is not configured (JIRA_MOCK=1 or no JIRA_BASE_URL in .env).');
  const auth = `Basic ${Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64')}`;
  const api = async (method, path, body) => {
    const res = await fetch(cfg.baseUrl + path, { method, headers: { Authorization: auth, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };
  return {
    url: (key) => `${cfg.baseUrl}/browse/${key}`,
    async create({ type, summary, description, labels = [], priority = 'Medium' }) {
      const fields = { project: { key: project.key }, summary, description, issuetype: { name: type }, labels };
      try {
        return (await api('POST', '/rest/api/2/issue', { fields: { ...fields, priority: { name: priority } } })).key;
      } catch {
        return (await api('POST', '/rest/api/2/issue', { fields })).key;
      }
    },
    comment: (key, body) => api('POST', `/rest/api/2/issue/${key}/comment`, { body }),
    async done(key) {
      const { transitions } = await api('GET', `/rest/api/2/issue/${key}/transitions`);
      const t = transitions.find((x) => /^done$/i.test(x.to?.name ?? x.name)) ?? transitions.find((x) => x.to?.statusCategory?.key === 'done');
      if (t) await api('POST', `/rest/api/2/issue/${key}/transitions`, { transition: { id: t.id } });
    },
    unlabel: (key, label) => api('PUT', `/rest/api/2/issue/${key}`, { update: { labels: [{ remove: label }] } }),
  };
}

// ------------------------------------------------------------------ git: a clone of its own, never the user's
const git = (args2, cwd = PLANTER) => execFileSync('git', args2, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function freshPlanter() {
  if (!existsSync(join(PLANTER, '.git'))) {
    const url = git(['remote', 'get-url', 'origin'], project.repoDir);
    execFileSync('git', ['clone', '-q', url, PLANTER], { stdio: 'ignore' });
  }
  git(['fetch', '-q', 'origin']);
  git(['checkout', '-q', '-B', 'main', 'origin/main']);
  git(['reset', '-q', '--hard', 'origin/main']);
  git(['clean', '-q', '-fd']);
  linkDeps(project.repoDir, PLANTER);
}

/** Applies a case on a fresh copy of main and runs the existing tests of its side, as CI would. */
async function tryCase(c) {
  freshPlanter();
  const { files, problems } = applyEdits((f) => readFileSync(join(PLANTER, f), 'utf8'), c.edits);
  if (problems.length) return { ok: false, why: `no longer applies to main: ${problems.join('; ')}` };
  for (const [f, text] of files) writeFileSync(join(PLANTER, f), text);
  const ws = { path: PLANTER };
  if (c.side === 'BE') {
    const r = await runBackendTests(ws, toolsDir);
    if (!r.ok) return { ok: false, why: `the existing backend tests catch it (${r.failed} failed): CI would stop it`, files };
    return { ok: true, why: `backend tests pass (${r.passed})`, files };
  }
  const build = await runFrontendBuild(ws);
  if (!build.ok) return { ok: false, why: 'the frontend does not build', files };
  const e2e = await runE2E(ws, [], { evidenceDir: join(DIR, 'evidence') });
  if (!e2e.ok) return { ok: false, why: `the existing browser tests catch it (${e2e.failed} failed): CI would stop it`, files };
  return { ok: true, why: `build and browser tests pass (${e2e.passed})`, files };
}

async function plant(c) {
  const state = load();
  const id = `${c.id}#${state.runs.filter((r) => r.case === c.id).length + 1}`;
  log(`plant ${id}: applying the change and running the existing tests`);
  const t = await tryCase(c);
  if (!t.ok) {
    state.runs.push({ id, case: c.id, status: 'failed', at: new Date().toISOString(), why: t.why });
    save(state);
    log(`plant ${id}: skipped, ${t.why}`);
    return null;
  }
  const j = await jira();
  const [name, email] = PEOPLE[c.author];
  const story = await j.create({ type: 'Story', summary: c.story.summary, description: c.story.description, labels: ['no-ai'] });
  await j.done(story);
  await j.unlabel(story, 'no-ai');
  git(['add', '-A', '--', ...t.files.keys()]);
  git(['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', `${story}: ${c.subject}`]);
  try {
    git(['push', '-q', 'origin', 'HEAD:main']);
  } catch {
    git(['pull', '-q', '--rebase', 'origin', 'main']); // main moved (a merge): put the change on top once
    git(['push', '-q', 'origin', 'HEAD:main']);
  }
  const sha = git(['rev-parse', 'HEAD']);
  await j.comment(story, `*${name}:* done, on main as ${sha.slice(0, 7)}.`);
  const run = { id, case: c.id, status: 'planted', plantedAt: new Date().toISOString(), story, sha, short: sha.slice(0, 7), author: name, checks: t.why, reportAfterMinutes: reportDelayMinutes(id, PILOT.reportAfterMinutes) };
  state.runs.push(run);
  save(state);
  log(`plant ${id}: ${story} pushed as ${run.short} by ${name}; the bug is reported in ${run.reportAfterMinutes} min`);
  return run;
}

async function report(run) {
  const c = caseOf(run.case);
  const patients = JSON.parse(readFileSync(join(project.repoDir, 'e2e', 'support', 'api-data.json'), 'utf8')).patients;
  const { h, identifiers } = ticketHelpers({ patients, day: localDay(new Date()), seed: hashOf(run.id) });
  const t = c.ticket(h);
  const j = await jira();
  const key = await j.create({ type: 'Bug', summary: t.summary, description: t.description, labels: ['PRODUZIONE'], priority: c.priority ?? 'High' });
  // The masking the analysis applies, measured on this ticket (the team stays readable, patients must not).
  const { createRedactor } = await skillLib('redact.mjs');
  const team = [...Object.values(PEOPLE).map(([n]) => n), ...(all.global.staff ?? [])];
  const masked = createRedactor({ allow: team }).text(`${t.summary}\n${t.description}`);
  const state = load();
  const r = state.runs.find((x) => x.id === run.id);
  Object.assign(r, { status: 'reported', ticket: key, reportedAt: new Date().toISOString(), identifiers, redaction: redactionScore(masked, identifiers) });
  save(state);
  log(`report ${run.id}: ${key} "${t.summary}" · ${r.redaction.masked}/${r.redaction.quoted} identifiers masked${r.redaction.missed.length ? ` (missed: ${r.redaction.missed.map((m) => m.kind).join(', ')})` : ''}`);
  return key;
}

function score() {
  const state = load();
  const events = readEvents(join(AGENT, 'state'));
  const scores = state.runs.filter((r) => r.ticket).map((r) => {
    const file = join(project.stateDir, 'work', r.ticket, 'result.json');
    const result = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    return { ...scoreRun(r, caseOf(r.case).answer, events, result), redaction: r.redaction ? { masked: r.redaction.masked, quoted: r.redaction.quoted } : null };
  });
  const redaction = state.runs.filter((r) => r.redaction).reduce((s, r) => ({ masked: s.masked + r.redaction.masked, quoted: s.quoted + r.redaction.quoted }), { masked: 0, quoted: 0 });
  const out = { at: new Date().toISOString(), project: project.key, summary: { ...summarize(scores), redaction }, scores };
  writeFileSync(join(DIR, 'score.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

async function ensureWatcher() {
  try {
    const res = await fetch(`http://localhost:${all.global.dashboardPort ?? 7070}/api/status`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) return true;
  } catch {
    /* not running */
  }
  const out = openSync(join(DIR, 'watcher.log'), 'a');
  spawn(process.execPath, [join(AGENT, 'watcher.mjs')], { cwd: ROOT, detached: true, stdio: ['ignore', out, out], windowsHide: true }).unref();
  log('watcher was not running: started it (log in pilot/watcher.log)');
  return false;
}

const pct = (x) => (x?.of ? `${Math.round((100 * x.n) / x.of)}% (${x.n}/${x.of})` : '–');

// ------------------------------------------------------------------ commands
if (cmd === 'check') {
  const list = opt('--case') ? [caseOf(opt('--case'))] : CASES;
  for (const c of list) {
    const t = await tryCase(c);
    console.log(`${t.ok ? '✓' : '✗'} ${c.id.padEnd(20)} ${c.side}  ${t.why}`);
  }
  freshPlanter();
} else if (cmd === 'plant') {
  const state = load();
  const used = new Set(state.runs.map((r) => r.case));
  const c = opt('--case') ? caseOf(opt('--case')) : CASES.find((x) => !used.has(x.id));
  if (!c) console.log('No case left to push.');
  else await plant(c);
} else if (cmd === 'report') {
  const state = load();
  const run = opt('--case') ? state.runs.filter((r) => r.case === opt('--case') && r.status === 'planted').at(-1) : state.runs.find((r) => r.status === 'planted');
  if (!run) console.log('No pushed case waits to be reported.');
  else await report(run);
} else if (cmd === 'tick') {
  const lock = join(DIR, 'tick.lock');
  if (existsSync(lock) && Date.now() - Number(readFileSync(lock, 'utf8')) < 45 * 60_000) process.exit(0);
  writeFileSync(lock, String(Date.now()));
  try {
    await ensureWatcher();
    const state = load();
    const a = nextActions({ runs: state.runs, cases: CASES, now: new Date(), cfg: PILOT });
    for (const run of a.report) await report(run);
    if (a.plant) await plant(a.plant);
    score();
  } catch (e) {
    log(`tick failed: ${e.message.split('\n')[0]}`);
  } finally {
    rmSync(lock, { force: true });
  }
} else if (cmd === 'schedule') {
  const task = 'TicketIntelligencePilot';
  if (args.includes('--remove')) {
    execFileSync('schtasks', ['/Delete', '/F', '/TN', task], { stdio: 'inherit' });
  } else {
    // A hidden launcher: a task that starts node directly opens a console window every 30 minutes.
    const vbs = join(DIR, 'tick.vbs');
    writeFileSync(vbs, `CreateObject("WScript.Shell").Run """${realpathSync(process.execPath)}"" ""${join(HERE, 'pilot.mjs')}"" tick", 0, False\r\n`);
    execFileSync('schtasks', ['/Create', '/F', '/SC', 'MINUTE', '/MO', '30', '/TN', task, '/TR', `wscript.exe //B "${vbs}"`], { stdio: 'inherit' });
    console.log(`Every 30 minutes: node demo/pilot.mjs tick (hidden). Remove with: node demo/pilot.mjs schedule --remove`);
  }
} else {
  const out = score();
  const state = load();
  const s = out.summary;
  console.log(`Pilot on ${project.name} (${project.key}) · ${PILOT.perDay} case(s) a working day from ${PILOT.hours.join(':00, ')}:00 · catalog ${CASES.length} cases`);
  for (const r of state.runs) {
    const sc = out.scores.find((x) => x.ticket === r.ticket);
    const parts = [r.status.padEnd(8), r.story ?? '', r.short ?? '', r.ticket ?? ''];
    if (r.status === 'failed') parts.push(r.why);
    if (sc) {
      parts.push(sc.analysed ? `files ${sc.files?.hit ? 'hit' : 'miss'} · culprit ${sc.culpritNamed ? 'named' : 'not named'} · owner ${sc.owner?.hit ? 'hit' : `miss (${sc.owner?.proposed})`}` : 'not analysed yet');
      if (sc.fix) parts.push(`fix ${sc.fix.outcome}${sc.fix.why ? ` (${sc.fix.why})` : ''}`);
      if (sc.bisect) parts.push(`bisect ${sc.bisect.exact ? 'exact' : sc.bisect.status}`);
      if (sc.redaction) parts.push(`masked ${sc.redaction.masked}/${sc.redaction.quoted}`);
    }
    console.log(`  ${r.case.padEnd(20)} ${parts.filter(Boolean).join(' · ')}`);
  }
  console.log(`\nAnalysed ${s.analysed}/${s.cases} · files ${pct(s.files)} · culprit named ${pct(s.culpritNamed)} · owner ${pct(s.owner)} · fix PR ${pct(s.fixPr)} · bisect exact ${pct(s.bisectExact)} · identifiers masked ${s.redaction.quoted ? `${Math.round((100 * s.redaction.masked) / s.redaction.quoted)}% (${s.redaction.masked}/${s.redaction.quoted})` : '–'} · $${s.costUsd}`);
  console.log(`Next: ${nextActions({ runs: state.runs, cases: CASES, now: new Date(), cfg: PILOT }).why}`);
}
