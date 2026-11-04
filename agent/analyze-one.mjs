#!/usr/bin/env node
// Dry run: analyze one ticket headless and print the structured result. Nothing is written to Jira.
//   node agent/analyze-one.mjs DEM-7

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAnalysis } from './lib/analyze.mjs';
import { analysisCheckout } from './lib/workspace.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(HERE, 'agent.config.json'), 'utf8'));
const key = process.argv[2];
if (!key) {
  console.error('usage: node agent/analyze-one.mjs <TICKET-KEY>');
  process.exit(1);
}

const started = Date.now();
const stateDir = join(HERE, 'state');
const { result, meta } = await runAnalysis({
  key,
  repoDir: analysisCheckout({ repoDir: resolve(HERE, cfg.repo), stateDir }), // origin/main, like the watcher
  stateDir,
  cfg,
  onProgress: (step) => console.log(`  [${Math.round((Date.now() - started) / 1000)}s] ${step}`),
});
console.log(JSON.stringify(result, null, 2));
console.log(`\n${meta.turns} turns · ${Math.round(meta.durationMs / 1000)} s · ~$${meta.costUsd.toFixed(2)} (API-equivalent estimate)`);
