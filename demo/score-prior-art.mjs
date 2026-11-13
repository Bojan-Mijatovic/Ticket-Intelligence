#!/usr/bin/env node
// Prior-art eval (K21 of docs/KNOWLEDGE_PLAN.md), part (a): does the Insights tab know that a suggested ticket is
// already open, fixed or new? Read-only: builds the Insights and the suggestions as the dashboard does (no AI run).
//
//   node demo/score-prior-art.mjs
//
// Parts (b)–(e), reported tickets, are scenarios in demo/scenarios.json (expected.priorArt): node demo/score-run.mjs.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { priorArtOk, suggestionVerdict } from './lib/eval.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT = join(HERE, '..', 'agent');
const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback);
const { suggestions: CASES } = readJson(join(HERE, 'prior-art-cases.json'), { suggestions: [] });
const keyMap = readJson(join(HERE, 'jira-keys.json'), {});
const map = (k) => keyMap[k] ?? k;

const { loadProjects } = await import('../agent/lib/projects.mjs');
const { createJira } = await import('../agent/lib/jira-actions.mjs');
const { createJiraHealth } = await import('../agent/lib/jira-health.mjs');
const { buildInsights, savedAnalyses } = await import('../agent/lib/insights.mjs');
const { readReview } = await import('../agent/lib/app-review.mjs');
const { readCreated, suggestTickets } = await import('../agent/lib/suggestions.mjs');
const { loadPriorArtSources } = await import('../agent/lib/prior-art.mjs');

const all = loadProjects(AGENT);
const jira = createJira();
const projects = [...new Set(CASES.map((c) => c.project))];
const health = await createJiraHealth({ jira, projects }).check();
if (health.ok === false) {
  console.error(`Jira unavailable: ${health.error}`);
  process.exit(1);
}

const suggestionsOf = new Map();
for (const key of projects) {
  const p = all.byKey(key);
  const peers = all.projects.filter((x) => x.key !== key).map((x) => ({ key: x.key, name: x.name, repoDir: x.repoDir }));
  const data = await buildInsights({ repoDir: p.repoDir, stateDir: p.stateDir, cfg: p.cfg, jira, peers });
  const priorArtSources = loadPriorArtSources({ repoDir: p.repoDir, analyses: savedAnalyses(p.stateDir) });
  suggestionsOf.set(key, suggestTickets({ insights: data, review: readReview(p, data), rules: p.cfg.insights?.components ?? [], created: readCreated(p.stateDir), project: key, priorArtSources }));
}

let pass = 0;
console.log('Prior art of suggested tickets');
for (const c of CASES) {
  const s = suggestionsOf.get(c.project).find((x) => x.summary.toLowerCase().includes(c.match.toLowerCase()));
  if (!s) {
    console.log(`  ? ${c.id.padEnd(22)} no suggestion matches "${c.match}" (refresh the AI review?)`);
    continue;
  }
  const got = suggestionVerdict(s);
  const ok = priorArtOk(c, got, map);
  if (ok) pass++;
  console.log(`  ${ok ? '✓' : '✗'} ${c.id.padEnd(22)} expected ${c.verdicts.join('|')}${c.key ? ` ${c.key}` : ''} · agent says ${got.verdict}${got.key ? ` ${got.key}` : ''}`);
  if (!ok) console.log(`      ${c.why}`);
}
console.log(`  → ${pass}/${CASES.length} correct`);
