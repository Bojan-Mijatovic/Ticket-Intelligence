#!/usr/bin/env node
// A1 (FR-76): the regression guard on one commit, or on every commit of main, by hand. The watcher runs it on its own
// for each new commit on a watched main (policy regressionGuard). No AI, nothing posted.
//
//   node agent/guard-one.mjs --project VAX 5bf4f30          one commit: fixes it touches, their tests run on it
//   node agent/guard-one.mjs --project LAB --all --no-tests  every commit of origin/main, structure only (no test runs)
//
// The fixes are the documented bugs of origin/main (docs/knowledge) plus, with Jira configured, its resolved bugs.

import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cliProject, loadProjects } from './lib/projects.mjs';
import { guardCommit, knownIssues } from './lib/regression-guard.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const all = loadProjects(HERE);
const p = cliProject(all);
const args = process.argv.slice(2);
const git = (a) => execFileSync('git', a, { cwd: p.repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
git(['fetch', '-q', 'origin']);
const target = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--project');
const shas = args.includes('--all') ? git(['rev-list', '--first-parent', '--reverse', 'origin/main']).split('\n').slice(1) : target ? [git(['rev-parse', target])] : [];
if (!shas.length) {
  console.error('Usage: node agent/guard-one.mjs --project KEY <commit> | --all [--no-tests]');
  process.exit(2);
}
const fixKeys = new Set(knownIssues(git, 'origin/main').keys());
try {
  const { createJira } = await import('./lib/jira-actions.mjs');
  for (const i of await createJira().search(`project = ${p.key} AND issuetype = Bug AND statusCategory = Done`, 200)) fixKeys.add(i.key);
} catch {
  /* no Jira: the documented bugs only */
}
const noTests = async ({ items }) => ({ entries: items.map((i) => ({ key: i.key, status: 'pass', tests: i.tests })), totals: {} });
const count = { clear: 0, note: 0, alert: 0 };
for (const sha of shas) {
  const g = await guardCommit({
    repoDir: p.repoDir, workDir: join(p.stateDir, 'guard-cli'), sha, prefixes: [p.key], fixKeys,
    toolsDir: all.global.toolsDir ? resolve(HERE, all.global.toolsDir) : null, ...(args.includes('--no-tests') ? { runTests: noTests } : {}),
  });
  count[g.verdict]++;
  if (shas.length === 1 || g.verdict !== 'clear') console.log(`${g.verdict.toUpperCase().padEnd(5)} ${g.text}`);
}
if (shas.length > 1) console.log(`\n${p.name} (${p.key}): ${shas.length} commits · ${count.clear} clear · ${count.note} note · ${count.alert} alert${args.includes('--no-tests') ? ' (no test runs: an alert needs a failing test)' : ''}`);
