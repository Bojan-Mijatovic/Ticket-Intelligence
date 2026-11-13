#!/usr/bin/env node
// Executable knowledge (KB1, FR-73): runs the regression tests of every known-issue entry on main. A test that fails
// means the known issue may be back, before anyone reports it. No AI; read-only on the repositories (a detached
// checkout of origin/main in the project's state). Results: <project state>/knowledge-tests.json, shown on the
// dashboard (Insights → Knowledge base).
//
//   node agent/knowledge-tests.mjs                    every project with a clone
//   node agent/knowledge-tests.mjs --project LAB      one project
//   node agent/knowledge-tests.mjs --only LAB-9,LAB-12
//
// The tests of an entry are its **Test** line; an entry without one yet (written before KB1) gets the tests of its
// ticket's commits on main, computed the same way (marked "from git").

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseKnowledgeFile } from './lib/knowledge.mjs';
import { judgeEntries, parseTestLine, selectionOf, testsOfTicket } from './lib/knowledge-tests.mjs';
import { cliProject, loadProjects } from './lib/projects.mjs';
import { runBackendSelection, runE2E } from './lib/verify.mjs';
import { analysisCheckout, linkDeps } from './lib/workspace.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const all = loadProjects(HERE);
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',').map((k) => k.trim().toUpperCase()) : null;
const projects = args.includes('--project') ? [cliProject(all)] : all.projects.filter((p) => existsSync(p.repoDir));
const toolsDir = all.global.toolsDir ? resolve(HERE, all.global.toolsDir) : null;

for (const p of projects) {
  const dir = analysisCheckout({ repoDir: p.repoDir, stateDir: p.stateDir, name: 'kb-tests-repo' });
  linkDeps(p.repoDir, dir);
  const git = (a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  const head = git(['rev-parse', '--short', 'HEAD']).trim();
  const docsDir = join(dir, 'docs', 'knowledge');
  const items = [];
  for (const f of existsSync(docsDir) ? readdirSync(docsDir).filter((x) => x.endsWith('.md') && x !== 'README.md') : []) {
    for (const e of parseKnowledgeFile(readFileSync(join(docsDir, f), 'utf8'), `docs/knowledge/${f}`).entries.filter((x) => !x.reference)) {
      if (only && !only.includes(e.key)) continue;
      const fromEntry = e.fields.Test != null;
      items.push({ key: e.key, title: e.title, file: e.file, anchor: e.anchor, source: fromEntry ? 'entry' : 'git', tests: fromEntry ? parseTestLine(e.fields.Test) : testsOfTicket(git, e.key, { ref: 'HEAD' }) });
    }
  }
  const sel = selectionOf(items);
  console.log(`${p.name} (${p.key}) · main ${head} · ${items.length} entries, ${items.filter((i) => i.tests.length).length} with regression tests`);
  const ws = { path: dir };
  const evidenceDir = join(p.stateDir, 'kb-tests-evidence');
  mkdirSync(evidenceDir, { recursive: true });
  const backend = sel.backend ? await runBackendSelection(ws, toolsDir, sel.backend) : { cases: [] };
  if (sel.backend) console.log(`  JUnit: ${backend.cases.length} test(s) ran in ${Math.round(backend.durationMs / 1000)} s${backend.error ? ` · nothing ran:\n${backend.error}` : ''}`);
  const e2e = sel.e2e ? await runE2E(ws, sel.e2e, { evidenceDir }) : { cases: [] };
  if (sel.e2e) console.log(`  Playwright: ${e2e.cases.length} test(s) ran in ${Math.round(e2e.durationMs / 1000)} s${!e2e.cases.length ? ` · nothing ran:\n${e2e.output}` : ''}`);
  const result = judgeEntries(items, { backend, e2e: { cases: e2e.cases, error: e2e.cases.length ? null : e2e.output } });
  for (const e of result.entries.filter((x) => x.status !== 'none')) {
    const mark = { pass: '✓', fail: '✗ KNOWN ISSUE MAY BE BACK', 'not-run': '? did not run' }[e.status];
    console.log(`  ${e.key.padEnd(8)} ${mark}${e.source === 'git' ? ' (tests from git: the entry has no Test line yet)' : ''}`);
    for (const t of e.tests.filter((x) => x.status !== 'pass')) console.log(`      ${t.file}: ${t.status}${t.failed ? ` ${t.failed.map((f) => `${f.name}: ${String(f.error).split('\n')[0]}`).join('; ')}` : ''}${t.missing?.length ? ` (missing: ${t.missing.join(', ')})` : ''}`);
  }
  const t = result.totals;
  console.log(`  → ${t.pass} pass · ${t.fail} fail · ${t.notRun} did not run · ${t.none} without a regression test\n`);
  if (!only) writeFileSync(join(p.stateDir, 'knowledge-tests.json'), JSON.stringify({ at: new Date().toISOString(), head, ...result }, null, 2));
}
