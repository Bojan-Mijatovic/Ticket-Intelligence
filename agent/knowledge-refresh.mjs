#!/usr/bin/env node
// Keeps the knowledge entries of a project true (K7 of docs/KNOWLEDGE_PLAN.md), without AI. Dry run by default.
//   - an entry citing commits that are not on main (a fix branch squash-merged and deleted) gets "Merged into main as
//     <commit>" on its Fix line, the commit on main that names the ticket;
//   - an entry gets its **Test** line (KB1): the regression tests its fix added or changed on main, or "none";
//   - an entry citing files that no longer exist on main is listed as stale, for a person to check.
//
//   node agent/knowledge-refresh.mjs --project DEM          what would change, and the stale entries
//   node agent/knowledge-refresh.mjs --project DEM --yes    branch docs/refresh-<time>, one commit, draft PR

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keyCommitsOf } from './lib/doc-candidates.mjs';
import { planRefresh } from './lib/knowledge-refresh.mjs';
import { testLine, testsOfTicket } from './lib/knowledge-tests.mjs';
import { cliProject, loadProjects } from './lib/projects.mjs';
import { createWorkspace } from './lib/workspace.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--yes');
const p = cliProject(loadProjects(HERE));
const git = (args, opts = {}) => execFileSync('git', args, { cwd: p.repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...opts }).trim();

git(['fetch', '-q', '--prune', 'origin']);
let names = [];
try {
  names = git(['ls-tree', '-r', '--name-only', 'origin/main', '--', 'docs/knowledge']).split('\n').filter((f) => f.endsWith('.md'));
} catch {
  /* none */
}
if (!names.length) {
  console.log(`${p.name} (${p.key}): no knowledge base on main.`);
  process.exit(0);
}
const onMainFiles = new Set(git(['ls-tree', '-r', '--name-only', 'origin/main']).split('\n'));
// The commits on main per ticket, newest first, without the documentation commits ("KEY: document …").
const keyCommits = keyCommitsOf(git(['log', 'origin/main', '--no-merges', '--date=short', '--format=%h%x1f%ad%x1f%s%x1f%b%x1e']));
const onMain = (h) => {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', h, 'origin/main'], { cwd: p.repoDir, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const plan = planRefresh(names.map((file) => ({ file, text: git(['show', `origin/main:${file}`]) })), {
  onMain,
  // The ticket's own commit: its subject starts with the key (a squash merge "DEM-32: … (#15)"); a commit that only
  // mentions it in the body (DEM-40 citing DEM-32) is another ticket's. Documentation commits are not fixes.
  mainCommitFor: (key) => (keyCommits.get(key) ?? []).find((c) => c.subject.startsWith(`${key}:`) && !c.subject.startsWith(`${key}: document `))?.hash ?? null,
  // An entry may cite a path shortened from the front (shared/utils/numbers.ts).
  fileExists: (path) => onMainFiles.has(path) || [...onMainFiles].some((f) => f.endsWith(`/${path}`)),
  // The regression tests of the ticket's own commits on main (KB1).
  testLineFor: (key) => testLine(testsOfTicket((args) => git(args), key)),
});

console.log(`${p.name} (${p.key}) · ${APPLY ? 'REFRESH' : 'dry run'} · ${names.length} knowledge file(s) on main`);
console.log(plan.merged.length ? '\nMerged into main (the cited commits are not on main):' : '\nEvery cited fix commit is on main, or its ticket has no commit there.');
for (const m of plan.merged) console.log(`  ${m.key.padEnd(8)} ${m.file.replace('docs/knowledge/', '')}: cites ${m.away.join(', ')} → merged as ${m.mergedAs}`);
const named = plan.tests.filter((t) => !/^none\b/i.test(t.value));
console.log(plan.tests.length ? `\nRegression tests (KB1): ${plan.tests.length} entr${plan.tests.length === 1 ? 'y gets' : 'ies get'} a Test line, ${named.length} with tests, ${plan.tests.length - named.length} "none":` : '\nEvery entry has its Test line.');
for (const t of plan.tests) console.log(`  ${t.key.padEnd(8)} ${t.file.replace('docs/knowledge/', '')}: ${t.value.replace(/backend\/src\/test\/java\/(\w+\/)+/g, '…/')}${t.was ? ` (was: ${t.was})` : ''}`);
console.log(plan.stale.length ? '\nStale (cited files no longer on main; check and update by hand):' : '\nNo stale entries: every cited file exists on main.');
for (const s of plan.stale) console.log(`  ${s.key.padEnd(8)} ${s.file.replace('docs/knowledge/', '')}#${s.anchor}: ${s.missing.join(', ')}`);

if (!plan.edits.size || !APPLY) {
  if (plan.edits.size) console.log('\nNothing changed. Run with --yes to put these changes on a branch with one draft pull request.');
  process.exit(0);
}
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const name = `refresh-${stamp}`;
const ws = createWorkspace({ repoDir: p.repoDir, key: name, stateDir: p.stateDir, branch: `docs/${name}`, name: 'docs-repo' });
try {
  for (const [file, text] of plan.edits) writeFileSync(join(ws.path, file), text.endsWith('\n') ? text : `${text}\n`);
  ws.git(['add', '--', ...plan.edits.keys()]);
  const title = [plan.merged.length ? 'fix commits as merged into main' : null, plan.tests.length ? 'regression tests of the known issues' : null].filter(Boolean).join(', ');
  const summary = [
    ...plan.merged.map((m) => `${m.key}: ${m.away.join(', ')} → ${m.mergedAs}`),
    ...plan.tests.map((t) => `${t.key}: Test ${/^none\b/i.test(t.value) ? 'none' : t.value.replace(/`/g, '')}`),
  ].join('\n');
  ws.git(['-c', 'user.name=Ticket Intelligence Agent', '-c', 'user.email=ticket-intelligence-agent@users.noreply.github.com', 'commit', '-q', '-m', `Knowledge base: ${title}\n\n${summary}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`]);
  ws.git(['push', '-q', '-u', 'origin', `docs/${name}`]);
  const slug = git(['remote', 'get-url', 'origin']).match(/github\.com[/:]([^/]+)\/([^/.\s]+)/)?.slice(1, 3).join('/');
  const body = join(p.stateDir, 'work', name, 'pr-body.md');
  mkdirSync(dirname(body), { recursive: true });
  writeFileSync(body, `## Knowledge base: ${title}\n\n${plan.merged.length ? `These entries cite commits of fix branches that were squash-merged and deleted; the commit on main is added to their Fix line.\n\n${plan.merged.map((m) => `- ${m.key} (\`${m.file.replace('docs/knowledge/', '')}\`): ${m.away.join(', ')} → ${m.mergedAs}`).join('\n')}\n\n` : ''}${plan.tests.length ? `Each entry gets a **Test** line: the regression tests its fix added or changed on main (by name when the diff shows them), or \`none\` when the fix added no test. \`node agent/knowledge-tests.mjs\` runs them on main: a failing one means the known issue may be back.\n\n${plan.tests.map((t) => `- ${t.key} (\`${t.file.replace('docs/knowledge/', '')}\`): ${t.value}`).join('\n')}\n` : ''}${plan.stale.length ? `\nStale entries (files no longer on main), not changed here:\n${plan.stale.map((s) => `- ${s.key}: ${s.missing.join(', ')}`).join('\n')}\n` : ''}\n---\n_Opened by agent/knowledge-refresh.mjs (K7, KB1). A human reviews and merges._\n`);
  const url = slug ? execFileSync('gh', ['pr', 'create', '--repo', slug, '--draft', '--base', 'main', '--head', `docs/${name}`, '--title', `Knowledge base: ${title}`, '--body-file', body], { encoding: 'utf8' }).trim().split('\n').pop() : null;
  console.log(`\nBranch docs/${name} pushed${url ? `, pull request ${url}` : ''}.`);
} finally {
  ws.remove();
}
