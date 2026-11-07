#!/usr/bin/env node
// Runs the AI reviewer (FR-63) on one pull request, outside the watcher.
//
//   node agent/review-one.mjs DEM-21              the agent's PR for DEM-21 (state/work/DEM-21/fix.json)
//   node agent/review-one.mjs --pr 14 [--project LAB]   any pull request of the project's application repository
//   ... --dry-run                                 review and print, but do not post it on GitHub
//
// Nothing else is changed: no Jira writes, no labels.

import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewPullRequest } from './lib/review.mjs';
import { cliProject, loadProjects } from './lib/projects.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

let key = args.find((a) => /^[A-Z][A-Z0-9_]+-\d+$/.test(a)) ?? null;
// The project: from the ticket key, or --project <KEY> with --pr (default: the first project).
const { cfg, repoDir, stateDir } = cliProject(loadProjects(HERE), { key });
let pr = null;
if (opt('--pr')) {
  const slug = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: repoDir, encoding: 'utf8' }).match(/github\.com[/:]([^/]+)\/([^/.\s]+)/)?.slice(1, 3).join('/');
  const p = JSON.parse(execFileSync('gh', ['pr', 'view', opt('--pr'), '--repo', slug, '--json', 'number,url,headRefName,title'], { encoding: 'utf8' }));
  pr = { number: p.number, url: p.url, branch: p.headRefName, title: p.title };
  key ??= (p.headRefName.match(/[A-Z][A-Z0-9_]+-\d+/) ?? p.title.match(/[A-Z][A-Z0-9_]+-\d+/))?.[0] ?? `PR-${p.number}`;
}
if (!key) {
  console.error('usage: node agent/review-one.mjs <KEY> | --pr <number>  [--dry-run]');
  process.exit(1);
}

const started = Date.now();
const events = {
  emit(type, data = {}) {
    console.log(`  [${Math.round((Date.now() - started) / 1000)}s] ${type.padEnd(14)} ${data.text ?? data.step ?? ''}`);
    return data;
  },
};
let jira = null;
try {
  jira = (await import('./lib/jira-actions.mjs')).createJira();
} catch {
  /* the review works without the ticket description */
}

const review = await reviewPullRequest({ key, repoDir, stateDir, cfg, events, jira, pr, post: !args.includes('--dry-run') });
if (!review) process.exit(1);
console.log(`\nrisk ${review.risk} · ${review.verdict} · tests cover the bug: ${review.testsCoverTheBug.yes ? 'yes' : 'no'} (${review.testsCoverTheBug.why})`);
console.log(review.summary);
for (const f of review.findings) console.log(`  - [${f.severity}] ${f.file ?? ''}${f.line ? `:${f.line}` : ''}  ${f.comment}`);
console.log(`\n${review.posted ? `posted: ${review.url}` : 'not posted (--dry-run)'} · ${Math.round(review.meta.durationMs / 1000)} s · ~$${review.meta.costUsd.toFixed(2)}`);
