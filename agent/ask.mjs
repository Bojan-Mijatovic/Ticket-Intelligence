#!/usr/bin/env node
// Ask the knowledge base of one project (FR-65) from the terminal; the same as the dashboard's Ask tab. Read-only.
//
//   node agent/ask.mjs "Has the Struttura field bug happened before?"          the first project (MediAgenda)
//   node agent/ask.mjs --project LAB "Which bugs did the Referti screen have?"

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJira } from './lib/jira-actions.mjs';
import { createJiraHealth } from './lib/jira-health.mjs';
import { askQuestion } from './lib/ask.mjs';
import { cliProject, loadProjects } from './lib/projects.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const question = args.filter((a, i) => a !== '--project' && args[i - 1] !== '--project').join(' ').trim();
if (!question) {
  console.error('usage: node agent/ask.mjs [--project <KEY>] "your question"');
  process.exit(1);
}
const p = cliProject(loadProjects(HERE));
const jira = createJira();
// Without valid credentials Jira answers with no tickets instead of an error: the answer would be a wrong "not found".
const health = await createJiraHealth({ jira, projects: [p.key] }).check();
if (health.ok === false) {
  console.error(`Jira unavailable: ${health.error}`);
  process.exit(1);
}

const started = Date.now();
console.log(`${p.name} (${p.key})`);
const a = await askQuestion({
  question,
  repoDir: p.repoDir,
  stateDir: p.stateDir,
  cfg: p.cfg,
  jira,
  project: { key: p.key, name: p.name },
  onProgress: (step) => console.log(`  [${Math.round((Date.now() - started) / 1000)}s] ${step}`),
});
console.log(`\n${a.found ? 'Answer' : 'Not found'}: ${a.answer}\n`);
for (const s of a.sources) console.log(`  ${s.type.padEnd(7)} ${s.ref}  ${s.why}${s.url ? `\n          ${s.url}` : ''}`);
if (a.closest.length) console.log(`  closest tickets: ${a.closest.map((c) => c.key).join(', ')}`);
if (a.dropped) console.log(`  (${a.dropped} cited source(s) dropped: not found in the data)`);
console.log(`\n${Math.round(a.meta.durationMs / 1000)} s · ${a.meta.turns} turns · ~$${a.meta.costUsd.toFixed(2)}`);
