#!/usr/bin/env node
// Knowledge lint (K5 of docs/KNOWLEDGE_PLAN.md) on what is already written: the entries in docs/knowledge on main,
// or on another branch. The same rules block a documentation run before it is pushed (agent/lib/document.mjs).
// Read-only. Exit code 1 when there are findings.
//
//   node agent/knowledge-lint.mjs --project DEM                         main
//   node agent/knowledge-lint.mjs --project LAB --ref origin/docs/LAB-23  a documentation branch

import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintKnowledge, parseKnowledgeFile } from './lib/knowledge.mjs';
import { cliProject, loadProjects, teamOf } from './lib/projects.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const ref = args.includes('--ref') ? args[args.indexOf('--ref') + 1] : 'origin/main';
const all = loadProjects(HERE);
const p = cliProject(all);
const git = (a) => execFileSync('git', a, { cwd: p.repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 }).trim();

git(['fetch', '-q', '--prune', 'origin']);
let names = [];
try {
  names = git(['ls-tree', '-r', '--name-only', ref, '--', 'docs/knowledge']).split('\n').filter((f) => f.endsWith('.md'));
} catch (e) {
  console.error(`${ref}: ${e.stderr?.toString().trim() || e.message}`);
  process.exit(1);
}
console.log(`${p.name} (${p.key}) · docs/knowledge on ${ref}: ${names.length} file(s)`);
if (!names.length) process.exit(0);

const files = names.map((file) => ({ file, text: git(['show', `${ref}:${file}`]) }));
const commitExists = (h) => {
  try {
    git(['cat-file', '-e', `${h}^{commit}`]);
    return true;
  } catch {
    return false;
  }
};
const entries = files.flatMap((f) => (f.file.endsWith('README.md') ? [] : parseKnowledgeFile(f.text, f.file).entries));
const full = entries.filter((e) => !e.reference);
console.log(`${new Set(full.map((e) => e.key)).size} documented ticket(s), ${full.length} full entr${full.length === 1 ? 'y' : 'ies'}, ${entries.length - full.length} reference(s)`);

// A cited regression test (KB1) must exist where the entry is read: on the same ref.
const testFileExists = (f) => {
  try {
    git(['cat-file', '-e', `${ref}:${f}`]);
    return true;
  } catch {
    return false;
  }
};
const findings = lintKnowledge(files, { commitExists, testFileExists, projects: all.projects.map((x) => x.key), team: teamOf(all.projects) });
if (!findings.length) {
  console.log('No findings.');
  process.exit(0);
}
const byFile = Map.groupBy ? Map.groupBy(findings, (f) => f.file) : findings.reduce((m, f) => m.set(f.file, [...(m.get(f.file) ?? []), f]), new Map());
for (const [file, list] of byFile) {
  console.log(`\n${file}`);
  for (const f of list) console.log(`  ${f.key ? `${f.key.padEnd(8)} ` : ''}[${f.rule}] ${f.message}`);
}
console.log(`\n${findings.length} finding(s).`);
process.exit(1);
