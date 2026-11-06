#!/usr/bin/env node
// Hotspot map (FR-64) in the terminal: the same numbers as the dashboard's Insights tab. Read-only.
//
//   node agent/insights.mjs              table per component and the top hotspots
//   node agent/insights.mjs --json       the full data
//   node agent/insights.mjs --recommend  also write the AI recommendations (one headless run, cached)

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJira } from './lib/jira-actions.mjs';
import { buildInsights, readRecommendations, writeRecommendations } from './lib/insights.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(HERE, 'agent.config.json'), 'utf8'));
const stateDir = join(HERE, 'state');
const data = await buildInsights({ repoDir: resolve(HERE, cfg.repo), stateDir, cfg, jira: createJira() });

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

const rec = process.argv.includes('--recommend') ? await writeRecommendations({ insights: data, stateDir, cfg }) : readRecommendations(stateDir, data);
if (rec?.recommendations?.length) {
  console.log(`\nRecommendations (${rec.at}${rec.stale ? ', data changed since' : ''})`);
  for (const r of rec.recommendations) console.log(`- ${r.component}: ${r.text}`);
  if (rec.meta) console.log(`  ~$${rec.meta.costUsd.toFixed(2)} · ${Math.round(rec.meta.durationMs / 1000)} s`);
}
