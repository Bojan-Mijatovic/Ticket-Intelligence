#!/usr/bin/env node
// One-time move of a project's knowledge base to files named after its components (K6 of docs/KNOWLEDGE_PLAN.md):
// docs/knowledge/frontend-src-app-features-patients.md → docs/knowledge/pazienti.md, using insights.components of
// agent/agent.config.json. Entries are moved as they are (no AI); the README index is rebuilt. Dry run by default:
// it shows where every entry goes and writes a preview; --yes puts it on a branch with one draft pull request.
//
//   node agent/knowledge-migrate.mjs --project DEM          preview in agent/state/knowledge-migrate/DEM/
//   node agent/knowledge-migrate.mjs --project DEM --yes    branch docs/migrate-<time>, one commit, draft PR

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkspace } from './lib/workspace.mjs';
import { planMigration } from './lib/knowledge-migrate.mjs';
import { lintKnowledge } from './lib/knowledge.mjs';
import { cliProject, loadProjects } from './lib/projects.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--yes');
const all = loadProjects(HERE);
const p = cliProject(all);
const rules = p.cfg.insights?.components ?? [];
if (!rules.length) {
  console.error(`${p.key} has no insights.components in agent/agent.config.json: nothing to name the files after.`);
  process.exit(1);
}
const git = (args, cwd = p.repoDir) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 }).trim();

git(['fetch', '-q', '--prune', 'origin']);
let names = [];
try {
  names = git(['ls-tree', '-r', '--name-only', 'origin/main', '--', 'docs/knowledge']).split('\n').filter((f) => f.endsWith('.md'));
} catch {
  /* none */
}
if (!names.length) {
  console.log(`${p.name} (${p.key}): no docs/knowledge on main, nothing to migrate. New entries get component names already.`);
  process.exit(0);
}
const plan = planMigration(names.map((file) => ({ file, text: git(['show', `origin/main:${file}`]) })), rules);

console.log(`${p.name} (${p.key}) · ${APPLY ? 'MIGRATION' : 'dry run'} · ${names.length} file(s) on main → ${plan.files.size - 1} component file(s) + README`);
for (const m of plan.moves.sort((a, b) => a.to.localeCompare(b.to) || Number(a.reference) - Number(b.reference))) console.log(`  ${m.key.padEnd(8)} ${m.reference ? 'reference' : 'entry    '} ${m.from.replace('docs/knowledge/', '')} → ${m.to.replace('docs/knowledge/', '')}`);
console.log(`  removed: ${plan.removed.map((f) => f.replace('docs/knowledge/', '')).join(', ') || 'none'}`);

const commitExists = (h) => {
  try {
    git(['cat-file', '-e', `${h}^{commit}`]);
    return true;
  } catch {
    return false;
  }
};
const findings = lintKnowledge([...plan.files].map(([file, text]) => ({ file, text })), { commitExists, projects: all.projects.map((x) => x.key) });
console.log(findings.length ? `\nKnowledge lint after the move: ${findings.length} finding(s) (the old entries' content; fix them in the same pull request):` : '\nKnowledge lint after the move: no findings.');
for (const f of findings) console.log(`  ${f.file.replace('docs/knowledge/', '')}${f.key ? ` · ${f.key}` : ''}: ${f.message}`);

if (!APPLY) {
  const dir = join(p.stateDir, 'knowledge-migrate');
  rmSync(dir, { recursive: true, force: true });
  for (const [file, text] of plan.files) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  console.log(`\nPreview: ${join(dir, 'docs', 'knowledge')}\nNothing changed. Run with --yes to put it on a branch with one draft pull request.`);
  process.exit(0);
}

const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const name = `migrate-${stamp}`;
const ws = createWorkspace({ repoDir: p.repoDir, key: name, stateDir: p.stateDir, branch: `docs/${name}`, name: 'docs-repo' });
try {
  for (const f of plan.removed) ws.git(['rm', '-q', '--', f]);
  for (const [file, text] of plan.files) {
    mkdirSync(dirname(join(ws.path, file)), { recursive: true });
    writeFileSync(join(ws.path, file), text);
  }
  ws.git(['add', '--', 'docs/knowledge']);
  ws.git(['-c', 'user.name=Ticket Intelligence Agent', '-c', 'user.email=ticket-intelligence-agent@users.noreply.github.com', 'commit', '-q', '-m', `Knowledge base: one file per component\n\nEntries moved from path-named files to the components of the project (${[...plan.files.keys()].filter((f) => !f.endsWith('README.md')).map((f) => f.replace('docs/knowledge/', '')).join(', ')}); README index rebuilt. No entry text changed except links.\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`]);
  ws.git(['push', '-q', '-u', 'origin', `docs/${name}`]);
  const slug = git(['remote', 'get-url', 'origin']).match(/github\.com[/:]([^/]+)\/([^/.\s]+)/)?.slice(1, 3).join('/');
  const body = join(p.stateDir, 'work', name, 'pr-body.md');
  writeFileSync(body, `## Knowledge base: one file per component\n\nThe knowledge base is moved from files named after code paths to the components the team uses (the same names as the Insights tab). Entries are moved as they are; only links and the README index change.\n\n| Ticket | | From | To |\n|---|---|---|---|\n${plan.moves.map((m) => `| ${m.key} | ${m.reference ? 'reference' : 'entry'} | \`${m.from.replace('docs/knowledge/', '')}\` | \`${m.to.replace('docs/knowledge/', '')}\` |`).join('\n')}\n\nRemoved: ${plan.removed.map((f) => `\`${f.replace('docs/knowledge/', '')}\``).join(', ')}\n${findings.length ? `\nThe knowledge lint still finds ${findings.length} issue(s) in older entries; they are fixed in this pull request before it is merged.\n` : ''}\n---\n_Opened by agent/knowledge-migrate.mjs (K6). A human reviews and merges._\n`);
  const url = slug ? execFileSync('gh', ['pr', 'create', '--repo', slug, '--draft', '--base', 'main', '--head', `docs/${name}`, '--title', 'Knowledge base: one file per component', '--body-file', body], { encoding: 'utf8' }).trim().split('\n').pop() : null;
  console.log(`\nBranch docs/${name} pushed${url ? `, pull request ${url}` : ''}.`);
} finally {
  ws.remove();
}
