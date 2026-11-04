#!/usr/bin/env node
// Puts the live demo back to its starting point. Dry run by default; --yes applies the changes.
//
//   node demo/reset-demo.mjs          show what would be done
//   node demo/reset-demo.mjs --yes    do it
//
// What it touches, and only that:
//   - MediAgenda pull requests whose branch is <KEY> or docs/<KEY> (agent branches): closed, branches deleted
//   - remaining remote/local agent branches; the local clone back on an up-to-date main
//   - Jira tickets created by new-ticket.mjs (demo/.demo-tickets.json) — never the seeded history or other tickets
//   - the agent's state (event log archived, per-ticket work folders removed)
// MediAgenda main is never rewritten.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const APP = join(HERE, 'mediagenda');
const STATE = join(ROOT, 'agent', 'state');
const TRACK = join(HERE, '.demo-tickets.json');
const APPLY = process.argv.includes('--yes');
const AGENT_BRANCH = /^(docs\/)?[A-Z][A-Z0-9_]+-\d+$/;

const sh = (cmd, args, cwd = APP) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const step = (text, fn) => {
  console.log(`${APPLY ? '•' : '(dry run)'} ${text}`);
  if (APPLY) fn();
};

const remote = sh('git', ['remote', 'get-url', 'origin']);
const slug = remote.match(/github\.com[/:]([^/]+)\/([^/.]+)/)?.slice(1, 3).join('/');

// 1. Pull requests opened by the agent
const prs = slug ? JSON.parse(sh('gh', ['pr', 'list', '--repo', slug, '--state', 'open', '--json', 'number,headRefName,title'])) : [];
for (const pr of prs.filter((p) => AGENT_BRANCH.test(p.headRefName))) {
  step(`close PR #${pr.number} (${pr.headRefName}) and delete its branch: ${pr.title}`, () => sh('gh', ['pr', 'close', String(pr.number), '--repo', slug, '--delete-branch']));
}

// 2. Leftover agent branches (remote and local), local clone back on main
sh('git', ['fetch', '-q', '--prune', 'origin']);
const remoteBranches = sh('git', ['branch', '-r', '--format=%(refname:short)']).split('\n').map((b) => b.replace(/^origin\//, '')).filter((b) => AGENT_BRANCH.test(b));
const closedViaPr = new Set(prs.map((p) => p.headRefName));
for (const b of remoteBranches.filter((b) => !closedViaPr.has(b))) {
  step(`delete remote branch ${b}`, () => sh('git', ['push', '-q', 'origin', '--delete', b]));
}
step('local clone: switch to main, prune worktrees, fast-forward to origin/main', () => {
  sh('git', ['worktree', 'prune']);
  sh('git', ['checkout', '-q', 'main']);
  sh('git', ['pull', '-q', '--ff-only']);
});
const localBranches = sh('git', ['branch', '--format=%(refname:short)']).split('\n').filter((b) => AGENT_BRANCH.test(b));
for (const b of localBranches) step(`delete local branch ${b}`, () => sh('git', ['branch', '-D', '-q', b]));

// 3. Jira tickets created for the demo
const tickets = existsSync(TRACK) ? JSON.parse(readFileSync(TRACK, 'utf8')) : [];
for (const key of tickets) {
  step(`delete Jira ticket ${key} (created by new-ticket.mjs)`, () => sh('node', [join(HERE, 'new-ticket.mjs'), '--delete', key], ROOT));
}
if (APPLY && tickets.length) writeFileSync(TRACK, '[]\n');

// 4. Agent state
if (existsSync(join(STATE, 'events.jsonl'))) {
  step('archive the agent event log (the dashboard starts empty after a watcher restart)', () =>
    renameSync(join(STATE, 'events.jsonl'), join(STATE, `events-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`)));
}
const work = existsSync(join(STATE, 'work')) ? readdirSync(join(STATE, 'work')) : [];
if (work.length) step(`remove agent work folders: ${work.join(', ')}`, () => work.forEach((d) => rmSync(join(STATE, 'work', d), { recursive: true, force: true })));

console.log(APPLY ? '\nDemo reset. Restart the watcher so the dashboard starts empty, then run node demo/preflight.mjs.' : '\nNothing changed. Run with --yes to apply.');
