#!/usr/bin/env node
// The management week (WF5, FR-72) in the terminal: for the whole suite, week by week, what the agent did, what it
// cost, the hours it saved against the team's estimates (agent.config.json "baseline"), and what waits for a person.
// Read-only; no AI.
//
//   node agent/impact.mjs              the last 8 weeks
//   node agent/impact.mjs --weeks 4    another window
//   node agent/impact.mjs --json       the whole result

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJira } from './lib/jira-actions.mjs';
import { createJiraHealth } from './lib/jira-health.mjs';
import { loadGraph, readSuitePullRequests } from './lib/git-graph.mjs';
import { scoreAccuracy } from './lib/accuracy.mjs';
import { readReplays } from './lib/replay.mjs';
import { impactOf } from './lib/impact.mjs';
import { loadProjects } from './lib/projects.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const all = loadProjects(HERE);
const args = process.argv.slice(2);
const weeks = Number(args.includes('--weeks') ? args[args.indexOf('--weeks') + 1] : 8) || 8;
const projects = all.projects.filter((p) => existsSync(p.repoDir));
const jira = createJira();
const health = await createJiraHealth({ jira, projects: projects.map((p) => p.key) }).check();
if (health.ok === false) console.error(`Jira unavailable (${health.error}): measuring from git and the events only.\n`);
const suitePrs = readSuitePullRequests(projects);
const apps = [];
for (const p of projects) {
  const graph = await loadGraph({ project: p, eventsDir: join(HERE, 'state'), jira: health.ok === false ? null : jira, suitePrs });
  apps.push({ project: p.key, name: p.name, graph, accuracy: scoreAccuracy(graph, { rules: p.cfg.insights?.components ?? [], replays: readReplays(p.stateDir) }) });
}
const im = impactOf(apps, { baseline: all.global.baseline, weeks });
if (args.includes('--json')) {
  console.log(JSON.stringify(im, null, 2));
  process.exit(0);
}

const pad = (s, n) => String(s ?? '–').padStart(n);
const label = (w) => new Date(`${w}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
console.log(`The suite, last ${weeks} weeks (weeks start on Monday)\n`);
console.log(`${'week of'.padEnd(10)}${pad('tickets', 8)}${pad('known', 7)}${pad('fix PRs', 9)}${pad('merged', 8)}${pad('stopped', 9)}${pad('reviews', 9)}${pad('docs', 6)}${pad('cost $', 9)}${pad('$/ticket', 10)}${pad('hours saved', 13)}`);
for (const w of [...im.weeks, { ...im.total, week: 'total' }]) {
  console.log(`${(w.week === 'total' ? 'total' : label(w.week)).padEnd(10)}${pad(w.analysed, 8)}${pad(w.known, 7)}${pad(w.fixPrs, 9)}${pad(w.fixMerged, 8)}${pad(w.fixStopped, 9)}${pad(w.reviews, 9)}${pad(w.docsMerged, 6)}${pad(w.costUsd.toFixed(2), 9)}${pad(w.costPerTicket?.toFixed(2), 10)}${pad(w.hoursSaved, 13)}`);
}
const t = im.total;
console.log(`\nHours saved: ${t.hoursSaved} (analysis ${t.savedHours.analysis}, fixes ${t.savedHours.fix}, documentation ${t.savedHours.docs}) · analysis takes ${t.avgAnalysisMin ?? '–'} min · analysis → draft PR ${t.avgToPrMin ?? '–'} min`);
console.log('\nPer app       tickets  merged fixes  docs  cost $  hours saved  waiting for a person');
for (const p of im.perProject) console.log(`  ${p.name.padEnd(11)}${pad(p.analysed, 8)}${pad(p.fixMerged, 14)}${pad(p.docsMerged, 6)}${pad(p.costUsd.toFixed(2), 8)}${pad(p.hoursSaved, 13)}  ${p.waiting.fixPrs} fix PR(s), ${p.waiting.docsPrs} documentation PR(s)`);
const pct = (r) => (r?.of ? `${Math.round(r.rate * 100)}% (${r.n}/${r.of})` : '–');
console.log('\nHow often it was right');
for (const a of im.accuracy) console.log(`  ${a.name.padEnd(11)} fix PRs merged unchanged ${pct(a.fixAcceptedUnchanged)} · review agrees ${pct(a.reviewAgreement)} · replay: files ${pct(a.replayFiles)}, owner ${pct(a.replayOwner)}`);
for (const n of im.notes) console.log(`\nnote: ${n}`);
