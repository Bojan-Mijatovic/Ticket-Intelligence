#!/usr/bin/env node
// Merges the agent's pull request of a ticket into MediAgenda main and shows the result in the running app:
// what a person does by hand on GitHub (Ready for review → Squash and merge → delete branch), then the local clone
// back on an up-to-date main, so http://localhost:4200 shows the fix without "Preview". Dry run by default.
//
//   node demo/merge-fix.mjs DEM-32           show what would be done
//   node demo/merge-fix.mjs DEM-32 --yes     do it
//   ... --docs                               also merge the documentation PR (docs/DEM-32) when there is one
//   ... --force                              merge although the AI review says high risk or needs changes
//
// The agent never merges on its own (policy mergeFix: off): this script is a person deciding, from the terminal.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { previewBranch } from '../agent/lib/preview.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, 'mediagenda');
const STATE = join(HERE, '..', 'agent', 'state');
const args = process.argv.slice(2);
const APPLY = args.includes('--yes');
const key = args.find((a) => /^[A-Z][A-Z0-9_]+-\d+$/i.test(a))?.toUpperCase();
if (!key) {
  console.error('usage: node demo/merge-fix.mjs <KEY> [--yes] [--docs] [--force]');
  process.exit(1);
}

const sh = (cmd, a, cwd = APP) => execFileSync(cmd, a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const step = (text) => console.log(`${APPLY ? '•' : '(dry run)'} ${text}`);
const slug = sh('git', ['remote', 'get-url', 'origin']).match(/github\.com[/:]([^/]+)\/([^/.\s]+)/)?.slice(1, 3).join('/');
if (!slug) {
  console.error('demo/mediagenda has no GitHub remote');
  process.exit(1);
}
const openPr = (branch) => JSON.parse(sh('gh', ['pr', 'list', '--repo', slug, '--head', branch, '--state', 'open', '--json', 'number,title,isDraft,url']))[0] ?? null;

const pr = openPr(key);
if (!pr) {
  const merged = JSON.parse(sh('gh', ['pr', 'list', '--repo', slug, '--head', key, '--state', 'merged', '--json', 'number,url']))[0];
  console.error(merged ? `${key}: pull request #${merged.number} is already merged (${merged.url}).` : `${key}: no open pull request with branch ${key}.`);
  process.exit(1);
}
const files = JSON.parse(sh('gh', ['pr', 'view', String(pr.number), '--repo', slug, '--json', 'files'])).files.map((f) => `${f.path} (+${f.additions} -${f.deletions})`);
console.log(`${key}: PR #${pr.number} ${pr.title}${pr.isDraft ? ' (draft)' : ''}\n  ${pr.url}\n  ${files.join('\n  ')}`);

// The AI review (FR-63), when there is one, is a gate: a human can still override it with --force.
const reviewFile = join(STATE, 'work', key, 'review.json');
const review = existsSync(reviewFile) ? JSON.parse(readFileSync(reviewFile, 'utf8')) : null;
if (!review) console.log(`  AI review: none (node agent/review-one.mjs ${key} to get one first)`);
else {
  console.log(`  AI review: risk ${review.risk} · ${review.verdict} · ${review.findings.length} finding(s)`);
  if ((review.risk === 'high' || review.verdict === 'needs-changes') && !args.includes('--force')) {
    console.error(`  Not merged: the review asks for changes. Read it (${review.url}), then rerun with --force to merge anyway.`);
    process.exit(1);
  }
}
const docs = args.includes('--docs') ? openPr(`docs/${key}`) : null;
if (args.includes('--docs')) console.log(docs ? `  docs: PR #${docs.number} ${docs.title}` : `  docs: no open documentation PR (docs/${key}); it is written when the ticket moves to Done`);

const merge = (p) => {
  if (p.isDraft) {
    step(`PR #${p.number}: mark ready for review (a draft cannot be merged)`);
    if (APPLY) sh('gh', ['pr', 'ready', String(p.number), '--repo', slug]);
  }
  step(`PR #${p.number}: squash and merge into main, delete its branch on GitHub`);
  if (APPLY) sh('gh', ['pr', 'merge', String(p.number), '--repo', slug, '--squash', '--delete-branch']);
};
merge(pr);
if (docs) merge(docs);

step('local clone: back on main, fast-forward to origin/main, wait until the app on :4200 serves it');
if (APPLY) {
  const r = await previewBranch({ repoDir: APP, branch: 'main' });
  console.log(`  the app shows main${r.changed.length ? ` (${r.changed.length} frontend file(s) changed${r.served ? ', rebuilt' : ', not rebuilt yet: refresh in a few seconds'})` : ''}`);
}
for (const branch of [key, `docs/${key}`]) {
  if (sh('git', ['branch', '--list', branch])) {
    step(`delete the local branch ${branch}`);
    if (APPLY) {
      sh('git', ['worktree', 'prune']);
      sh('git', ['branch', '-D', branch]);
    }
  }
}
if (APPLY) {
  try {
    const { createJira } = await import('../agent/lib/jira-actions.mjs');
    const head = sh('git', ['rev-parse', '--short', 'HEAD']);
    await createJira().comment(key, `Merged into main: [PR #${pr.number}|${pr.url}] (commit ${head}).${docs ? ` Documentation: [PR #${docs.number}|${docs.url}].` : ''}`);
    console.log(`  Jira: comment on ${key}`);
  } catch (e) {
    console.log(`  Jira comment skipped: ${e.message.split('\n')[0]}`);
  }
}
console.log(APPLY ? `\nDone: http://localhost:4200 shows main with ${key}. Move the ticket to Done in Jira (or node demo/resolve-ticket.mjs ${key}) when it is finished.` : '\nNothing changed. Run with --yes to merge.');
