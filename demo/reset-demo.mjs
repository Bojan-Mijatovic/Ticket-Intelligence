#!/usr/bin/env node
// Puts the live demo back to its starting point. Dry run by default; --yes applies the changes.
//
//   node demo/reset-demo.mjs          show what would be done
//   node demo/reset-demo.mjs --yes    do it
//   ... --also DEM-11,DEM-12           also delete tickets made by hand in Jira (the dry run lists candidates)
//   ... --project LAB                  only that app (default: every app of the suite that has a clone)
//   ... --drop-docs                    also close the documentation PRs (docs/<KEY>, docs/backfill-…) and delete
//                                      their branches; by default they are kept: knowledge outlives a rehearsal
//
// What it touches, and only that:
//   - pull requests of the apps whose branch is <KEY> (agent fix branches): closed, branches deleted
//     (documentation PRs, docs/…, only with --drop-docs)
//   - remaining remote/local agent branches; each local clone back on an up-to-date main
//   - Jira tickets created by new-ticket.mjs (demo/.demo-tickets.json) — never the seeded history or other tickets
//   - the agent's state (event log archived, per-ticket work folders removed)
// No app's main is ever rewritten.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const STATE = join(ROOT, 'agent', 'state'); // the watcher's own files (event log); each project has its state folder
const { loadProjects } = await import('../agent/lib/projects.mjs');
const suite = loadProjects(join(ROOT, 'agent'));
// Every app of the suite that has a clone (--project LAB: only that one).
const only = process.argv.includes('--project') ? process.argv[process.argv.indexOf('--project') + 1]?.toUpperCase() : null;
const APPS = suite.projects.filter((p) => existsSync(p.repoDir) && (!only || p.key === only));
const TRACK = join(HERE, '.demo-tickets.json');
const APPLY = process.argv.includes('--yes');
// Documentation branches are kept unless --drop-docs: the knowledge base is meant to grow across rehearsals (F23 of
// docs/KNOWLEDGE_PLAN.md: resets used to close 7 of 9 documentation PRs of MediAgenda).
const DROP_DOCS = process.argv.includes('--drop-docs');
const DOCS_BRANCH = /^docs\/([A-Z][A-Z0-9_]+-\d+|(backfill|migrate|refresh)-[\w.-]+)$/;
const FIX_BRANCH = /^[A-Z][A-Z0-9_]+-\d+$/;
const AGENT_BRANCH = { test: (b) => FIX_BRANCH.test(b) || (DROP_DOCS && DOCS_BRANCH.test(b)) };
// Tickets made by hand in Jira to delete as well: --also DEM-11,DEM-12 (checked before anything is changed).
const also = (process.argv.includes('--also') ? process.argv[process.argv.indexOf('--also') + 1] ?? '' : '').split(',').map((k) => k.trim().toUpperCase()).filter(Boolean);
const badKey = also.find((k) => !/^[A-Z][A-Z0-9_]+-\d+$/.test(k));
if (badKey) {
  console.error(`--also expects ticket keys separated by commas, e.g. --also DEM-11,DEM-12 (got ${badKey})`);
  process.exit(1);
}

const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const step = (text, fn) => {
  console.log(`${APPLY ? '•' : '(dry run)'} ${text}`);
  if (APPLY) fn();
};

for (const app of APPS) {
  const APP = app.repoDir;
  console.log(`\n${app.name} (${app.key})`);
  let remote = '';
  try {
    remote = sh('git', ['remote', 'get-url', 'origin'], APP);
  } catch {
    console.log('  no remote (origin): only local branches and worktrees');
  }
  const slug = remote.match(/github\.com[/:]([^/]+)\/([^/.]+)/)?.slice(1, 3).join('/');

  // 1. Pull requests opened by the agent
  const prs = slug ? JSON.parse(sh('gh', ['pr', 'list', '--repo', slug, '--state', 'open', '--json', 'number,headRefName,title'], APP)) : [];
  for (const pr of prs.filter((p) => AGENT_BRANCH.test(p.headRefName))) {
    step(`close PR #${pr.number} (${pr.headRefName}) and delete its branch: ${pr.title}`, () => sh('gh', ['pr', 'close', String(pr.number), '--repo', slug, '--delete-branch'], APP));
  }
  const keptDocs = prs.filter((p) => !DROP_DOCS && DOCS_BRANCH.test(p.headRefName));
  if (keptDocs.length) console.log(`  kept ${keptDocs.length} documentation PR(s): ${keptDocs.map((p) => `#${p.number} ${p.headRefName}`).join(', ')} (--drop-docs to close them)`);

  // 2. Leftover agent branches (remote and local), local clone back on main
  if (remote) {
    sh('git', ['fetch', '-q', '--prune', 'origin'], APP);
    const remoteBranches = sh('git', ['branch', '-r', '--format=%(refname:short)'], APP).split('\n').map((b) => b.replace(/^origin\//, '')).filter((b) => AGENT_BRANCH.test(b));
    const closedViaPr = new Set(prs.map((p) => p.headRefName));
    for (const b of remoteBranches.filter((b) => !closedViaPr.has(b))) {
      step(`delete remote branch ${b}`, () => sh('git', ['push', '-q', 'origin', '--delete', b], APP));
    }
  }
  step(`local clone: switch to main, prune worktrees${remote ? ', fast-forward to origin/main' : ''}`, () => {
    sh('git', ['worktree', 'prune'], APP);
    sh('git', ['checkout', '-q', 'main'], APP);
    if (remote) sh('git', ['pull', '-q', '--ff-only'], APP);
  });
  const localBranches = sh('git', ['branch', '--format=%(refname:short)'], APP).split('\n').filter((b) => AGENT_BRANCH.test(b));
  for (const b of localBranches) step(`delete local branch ${b}`, () => sh('git', ['branch', '-D', '-q', b], APP));
}
console.log('');

// 3. Jira tickets created for the demo: those from new-ticket.mjs, plus tickets made by hand named with --also
const allTracked = existsSync(TRACK) ? JSON.parse(readFileSync(TRACK, 'utf8')) : [];
// With --project, only that project's tickets; the others stay tracked for a later reset.
const tickets = only ? allTracked.filter((k) => k.split('-')[0] === only) : allTracked;
for (const key of tickets) {
  step(`delete Jira ticket ${key} (created by new-ticket.mjs)`, () => sh('node', [join(HERE, 'new-ticket.mjs'), '--delete', key], ROOT));
}
for (const key of also.filter((k) => !tickets.includes(k))) {
  step(`delete Jira ticket ${key} (named with --also)`, () => sh('node', [join(HERE, 'new-ticket.mjs'), '--delete', key], ROOT));
}
if (APPLY && tickets.length) {
  const left = (existsSync(TRACK) ? JSON.parse(readFileSync(TRACK, 'utf8')) : []).filter((k) => !tickets.includes(k));
  writeFileSync(TRACK, `${JSON.stringify(left, null, 2)}\n`);
}
// Scenario of each deleted ticket (demo/score-run.mjs): forget the deleted ones.
const RUNS = join(HERE, '.scenario-runs.json');
if (APPLY && existsSync(RUNS)) {
  const runs = JSON.parse(readFileSync(RUNS, 'utf8'));
  for (const key of [...tickets, ...also]) delete runs[key];
  writeFileSync(RUNS, `${JSON.stringify(runs, null, 2)}\n`);
}
// Saved analyses (<project state>/results, used by the hotspot map and Ask) of the deleted tickets; the others are kept.
for (const key of [...tickets, ...also]) {
  const file = join(suite.ofTicket(key)?.stateDir ?? STATE, 'results', `${key}.json`);
  if (existsSync(file)) step(`remove the saved analysis of ${key}`, () => rmSync(file, { force: true }));
}

// Tickets made by hand in Jira are never deleted unless named. List the likely ones: processed by the agent,
// numbered after the seeded history (demo/jira-keys.json), and not created by new-ticket.mjs.
try {
  const { createJira } = await import('../agent/lib/jira-actions.mjs');
  const cfg = suite.global;
  const seeded = existsSync(join(HERE, 'jira-keys.json')) ? Object.values(JSON.parse(readFileSync(join(HERE, 'jira-keys.json'), 'utf8'))) : [];
  // Per project: the highest seeded number (LAB-20, FAR-18, …); a higher number was made later.
  const lastSeeded = (k) => Math.max(0, ...seeded.filter((s) => s.split('-')[0] === k.split('-')[0]).map((s) => Number(s.split('-')[1])));
  const handled = (await createJira().search(`project in (${APPS.map((p) => p.key).join(', ')}) AND labels in (${cfg.labels.done}, ${cfg.labels.failed}) ORDER BY key ASC`, 100))
    .map((t) => t.key)
    .filter((k) => Number(k.split('-')[1]) > lastSeeded(k) && !tickets.includes(k) && !also.includes(k));
  if (handled.length) console.log(`  note: tickets made by hand that the agent worked on are kept: ${handled.join(', ')}\n        to delete them as well: node demo/reset-demo.mjs --yes --also ${handled.join(',')}`);
} catch (e) {
  console.log(`  note: could not list hand-made tickets (${e.message.split('\n')[0]})`);
}

// 4. Agent state
if (existsSync(join(STATE, 'events.jsonl'))) {
  step('archive the agent event log (the dashboard starts empty after a watcher restart)', () =>
    renameSync(join(STATE, 'events.jsonl'), join(STATE, `events-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`)));
}
for (const app of APPS) {
  const dir = join(app.stateDir, 'work');
  const work = existsSync(dir) ? readdirSync(dir) : [];
  if (work.length) step(`remove ${app.key} agent work folders: ${work.join(', ')}`, () => work.forEach((d) => rmSync(join(dir, d), { recursive: true, force: true })));
}

console.log(APPLY ? '\nDemo reset. Restart the watcher so the dashboard starts empty, then run node demo/preflight.mjs.' : '\nNothing changed. Run with --yes to apply.');
