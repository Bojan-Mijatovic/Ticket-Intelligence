#!/usr/bin/env node
// Dry run: analyze one ticket headless and print the structured result. Nothing is written to Jira.
//   node agent/analyze-one.mjs DEM-7       the project comes from the key (agent.config.json "projects")

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAnalysis } from './lib/analyze.mjs';
import { cliProject, loadProjects, peerCheckouts } from './lib/projects.mjs';
import { analysisCheckout } from './lib/workspace.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const key = process.argv[2]?.toUpperCase();
if (!key) {
  console.error('usage: node agent/analyze-one.mjs <TICKET-KEY>');
  process.exit(1);
}
const all = loadProjects(HERE);
const p = cliProject(all, { key });

const started = Date.now();
const log = (step) => console.log(`  [${Math.round((Date.now() - started) / 1000)}s] ${step}`);
const peers = peerCheckouts(p, all, log);
if (peers.length) log(`linked projects: ${peers.map((x) => x.key).join(', ')}`);
const { result, meta } = await runAnalysis({
  key,
  repoDir: analysisCheckout({ repoDir: p.repoDir, stateDir: p.stateDir }), // origin/main, like the watcher
  stateDir: p.stateDir,
  cfg: p.cfg,
  project: { key: p.key, name: p.name },
  peers,
  onProgress: log,
});
console.log(JSON.stringify(result, null, 2));
console.log(`\n${meta.turns} turns · ${Math.round(meta.durationMs / 1000)} s · ~$${meta.costUsd.toFixed(2)} (API-equivalent estimate)`);
