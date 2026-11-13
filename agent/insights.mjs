#!/usr/bin/env node
// Hotspot map (FR-64) in the terminal: the same numbers as the dashboard's Insights tab. Read-only.
//
//   node agent/insights.mjs              table per component and the top hotspots (first project)
//   node agent/insights.mjs --project LAB   another project
//   node agent/insights.mjs --json       the full data
//   node agent/insights.mjs --recommend  also write the AI recommendations (one headless run, cached)
//   node agent/insights.mjs --review     also run the AI review of the app (reads the code; a few minutes, cached)

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJira } from './lib/jira-actions.mjs';
import { createJiraHealth } from './lib/jira-health.mjs';
import { buildInsights, readRecommendations, writeRecommendations } from './lib/insights.mjs';
import { cliProject, loadProjects } from './lib/projects.mjs';
import { readReview, writeReview } from './lib/app-review.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const all = loadProjects(HERE);
const { cfg, stateDir, repoDir, name, key } = cliProject(all); // --project <KEY>, default the first
const peers = all.projects.filter((x) => x.key !== key).map((x) => ({ key: x.key, name: x.name, repoDir: x.repoDir }));
const jira = createJira();
// Without valid credentials Jira answers with no tickets instead of an error: every count would be 0.
const health = await createJiraHealth({ jira, projects: [key] }).check();
if (health.ok === false) {
  console.error(`Jira unavailable: ${health.error}`);
  process.exit(1);
}
const data = await buildInsights({ repoDir, stateDir, cfg, jira, peers });
if (!process.argv.includes('--json')) console.log(`${name} (${key})`);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`${data.totals.tickets} tickets · ${data.totals.bugs} bugs (${data.totals.openBugs} open) · ${data.totals.commits} commits\n`);
console.log(`${pad('component', 32)}${data.months.map((m) => pad(m.slice(2), 7)).join('')}bugs  open  churn(${data.churnDays}d)`);
for (const c of data.components.filter((x) => x.tickets)) {
  const row = data.months.map((m) => pad(data.cells[c.name]?.[m]?.bugs || '·', 7)).join('');
  console.log(`${pad(c.name, 32)}${row}${pad(c.bugs, 6)}${pad(c.openBugs, 6)}${c.churnLines}`);
}
console.log('\nTop hotspots');
for (const name of data.hotspots) {
  const c = data.components.find((x) => x.name === name);
  console.log(`- ${name}: ${c.bugs} bugs (${c.bugKeys.join(', ')})`);
  for (const f of c.repeatFiles) console.log(`    fixed more than once: ${f.path} (${f.keys.join(', ')})`);
}
if (data.recurring.length) console.log(`\nRecurring: ${data.recurring.map((r) => `${r.key} → ${r.of}`).join(', ')}`);
if (data.totals.unplaced.length) console.log(`Not placed (no commit, no analysis): ${data.totals.unplaced.join(', ')}`);

const o = data.origins;
if (o.bugs.length) {
  console.log(`\nWhere bugs come from (${o.bugs.length} traced, median ${o.medianDaysInCode} days in the code${o.fromFixes.length ? `, from another bug's fix: ${o.fromFixes.join(', ')}` : ''})`);
  for (const g of o.byChange.filter((x) => x.bugs.length > 1)) console.log(`- ${g.ticket ?? g.hash} (${g.type ?? 'no ticket'}) brought in ${g.bugs.join(', ')}`);
}
const toCheck = data.shared.pairs.filter((p) => p.checkHere.length || p.checkThere.length);
if (data.shared.pairs.length) console.log(`\nShared with ${data.shared.peers.join(', ')}: ${data.shared.files} files, ${data.shared.identical} identical copies`);
for (const p of toCheck) {
  for (const k of p.checkHere) console.log(`- check ${p.path}: ${k} fixed the copy in ${p.peer}, its lines are not here`);
  for (const k of p.checkThere) console.log(`- check ${p.peer} ${p.peerPath}: ${k} fixed it here, its lines are not there`);
}

const project = all.byKey(key);
const review = process.argv.includes('--review') ? await writeReview({ insights: data, project, onProgress: (s) => console.error(`  … ${s}`) }) : readReview(project, data);
if (review) {
  console.log(`\nApp review (${review.at}${review.stale ? ', data changed since' : ''}${review.dropped ? `, ${review.dropped} item(s) without a citation dropped` : ''})`);
  console.log(`  ${review.evaluation.summary}`);
  for (const s of review.evaluation.scores) console.log(`  ${s.area}: ${s.score}/5`);
  for (const f of review.findings) console.log(`- [${f.priority}] ${f.file}: ${f.problem}`);
  for (const r of review.refactors) console.log(`- refactor (${r.effort}): ${r.title}`);
  for (const g of review.growth) console.log(`- grow: ${g.title}`);
  if (review.meta) console.log(`  ~$${review.meta.costUsd.toFixed(2)} · ${Math.round(review.meta.durationMs / 1000)} s`);
}

const rec = process.argv.includes('--recommend') ? await writeRecommendations({ insights: data, stateDir, cfg }) : readRecommendations(stateDir, data);
if (rec?.recommendations?.length) {
  console.log(`\nRecommendations (${rec.at}${rec.stale ? ', data changed since' : ''})`);
  for (const r of rec.recommendations) console.log(`- ${r.component}: ${r.text}`);
  if (rec.meta) console.log(`  ~$${rec.meta.costUsd.toFixed(2)} · ${Math.round(rec.meta.durationMs / 1000)} s`);
}
