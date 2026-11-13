#!/usr/bin/env node
// Ask eval (K1 of docs/KNOWLEDGE_PLAN.md): asks the questions of demo/ask-scenarios.json and scores the answers
// against their answer key. It runs the real Ask (one headless run per question, ~$0.1–0.4 each), but logs into
// <project state>/ask-eval/, so the eval does not show up as real questions (the tour replays those).
//
//   node demo/score-ask.mjs --list                    the questions; nothing is asked
//   node demo/score-ask.mjs --project DEM             one project
//   node demo/score-ask.mjs --all                     every project
//   node demo/score-ask.mjs --project LAB --only lab-open,lab-sr-rifiuta
//   node demo/score-ask.mjs --rescore <results.json>  score saved answers again (after changing the answer key)

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreAnswer, summarize } from './lib/eval.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT = join(HERE, '..', 'agent');
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback);

const { projects: SETS } = readJson(join(HERE, 'ask-scenarios.json'), { projects: {} });
const keyMap = readJson(join(HERE, 'jira-keys.json'), {});
const map = (k) => keyMap[k] ?? k;

if (args.includes('--list')) {
  for (const [p, qs] of Object.entries(SETS)) {
    console.log(`\n${p}`);
    for (const q of qs) console.log(`  ${q.id.padEnd(24)} ${q.kind.padEnd(10)} ${q.question}`);
  }
  process.exit(0);
}

/** Short hash → ticket keys in the commit subject, from the project's main and its linked apps' (K11). */
function commitKeys(repoDir, peerDirs = []) {
  const out = new Map();
  for (const dir of [repoDir, ...peerDirs]) {
    const log = execFileSync('git', ['log', 'origin/main', '--format=%h %s'], { cwd: dir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    for (const line of log.split('\n').filter(Boolean)) if (!out.has(line.slice(0, 7))) out.set(line.slice(0, 7), line.slice(8).match(/\b[A-Z][A-Z0-9_]+-\d+\b/g) ?? []);
  }
  return out;
}
const peerDirsOf = (p) => p.linked.map((k) => all.byKey(k)?.repoDir).filter(Boolean);

function print(project, rows) {
  console.log(`\n${project}`);
  for (const r of rows) {
    console.log(`  ${r.score.pass ? '✓' : '✗'} ${r.q.id.padEnd(24)} ${r.q.kind.padEnd(10)} ${r.error ? `ERROR ${r.error}` : `${Math.round((r.answer.meta?.durationMs ?? 0) / 1000)} s · $${(r.answer.meta?.costUsd ?? 0).toFixed(2)}`}`);
    for (const [label, ok, detail] of r.score.checks) if (!ok) console.log(`      ✗ ${label}: ${detail}`);
    if (r.score.dropped) console.log(`      ! ${r.score.dropped} invented source(s) dropped`);
  }
  const s = summarize(rows);
  console.log(`  → ${s.pass}/${s.questions} pass · found correct ${s.foundCorrect}/${s.questions} · invented ${s.invented} · avg ${s.avgSeconds} s · avg $${s.avgCost} · total $${s.totalCost}`);
  return s;
}

const { loadProjects, peerCheckouts } = await import('../agent/lib/projects.mjs');
const all = loadProjects(AGENT);

if (opt('--rescore')) {
  const saved = readJson(opt('--rescore'), null);
  if (!saved) throw new Error(`no such file: ${opt('--rescore')}`);
  for (const [p, rows] of Object.entries(saved.projects)) {
    const commits = commitKeys(all.byKey(p).repoDir, peerDirsOf(all.byKey(p)));
    const qs = new Map((SETS[p] ?? []).map((q) => [q.id, q]));
    print(p, rows.filter((r) => qs.has(r.q.id)).map((r) => ({ ...r, q: qs.get(r.q.id), score: scoreAnswer(qs.get(r.q.id), r.answer, { commits, map }) })));
  }
  process.exit(0);
}

const chosen = args.includes('--all') ? Object.keys(SETS) : [opt('--project')].filter(Boolean).map((k) => k.toUpperCase());
if (!chosen.length) {
  console.error('usage: node demo/score-ask.mjs --list | --project <KEY> [--only id,id] | --all | --rescore <file>');
  process.exit(1);
}
const only = opt('--only')?.split(',');
const { createJira } = await import('../agent/lib/jira-actions.mjs');
const { createJiraHealth } = await import('../agent/lib/jira-health.mjs');
const { askQuestion } = await import('../agent/lib/ask.mjs');
const jira = createJira();
const { teamOf } = await import('../agent/lib/projects.mjs');
jira.allowTeam(teamOf(all.projects));
const health = await createJiraHealth({ jira, projects: chosen }).check();
if (health.ok === false) {
  console.error(`Jira unavailable: ${health.error}`);
  process.exit(1);
}

const at = new Date().toISOString();
const results = { at, projects: {}, summary: {} };
for (const key of chosen) {
  const p = all.byKey(key);
  if (!p || !SETS[key]) {
    console.error(`no project or no questions for ${key}`);
    continue;
  }
  const commits = commitKeys(p.repoDir, peerDirsOf(p));
  const logDir = join(p.stateDir, 'ask-eval');
  mkdirSync(logDir, { recursive: true });
  const rows = [];
  for (const q of SETS[key].filter((x) => !only || only.includes(x.id))) {
    process.stdout.write(`  ${key} ${q.id} … `);
    let answer;
    let error = null;
    try {
      answer = await askQuestion({ question: q.question, repoDir: p.repoDir, stateDir: p.stateDir, logDir, cfg: p.cfg, jira, project: { key: p.key, name: p.name }, peers: peerCheckouts(p, all, () => {}, { name: 'ask-peer-repo' }) });
    } catch (e) {
      error = e.message.slice(0, 200);
      answer = { found: null, answer: '', sources: [], dropped: 0, meta: {} };
    }
    const score = scoreAnswer(q, answer, { commits, map });
    console.log(error ? `error: ${error}` : score.pass ? 'pass' : 'fail');
    rows.push({ q, answer, score, error });
  }
  results.projects[key] = rows;
  results.summary[key] = print(key, rows);
}
const dir = join(AGENT, 'state', 'ask-eval');
mkdirSync(dir, { recursive: true });
const file = join(dir, `${at.replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify(results, null, 2));
console.log(`\nSaved: ${file}`);
console.log('\nFor docs/AGENT_TRAINING.md:');
console.log('| Date | Project | Pass | Found correct | Invented sources | Avg time | Avg cost | Change |');
for (const [k, s] of Object.entries(results.summary)) console.log(`| ${at.slice(0, 10)} | ${k} | ${s.pass}/${s.questions} | ${s.foundCorrect}/${s.questions} | ${s.invented} | ${s.avgSeconds} s | $${s.avgCost} | |`);
