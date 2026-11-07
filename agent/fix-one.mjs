#!/usr/bin/env node
// Reproduce → fix → verify → draft PR for one ticket, using its saved analysis (state/work/<KEY>/result.json).
// Useful to test or re-run the fix stage without analyzing again.
//   node agent/fix-one.mjs DEM-7            full run: pushes a branch, opens a draft PR, comments in Jira
//   node agent/fix-one.mjs DEM-7 --local    stops before publishing (no push, no PR, no Jira); keeps the branch locally

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEventLog } from './lib/events.mjs';
import { reproduceAndFix } from './lib/fix.mjs';
import { createJira } from './lib/jira-actions.mjs';
import { fixBlocker, fixSide } from './lib/pipeline.mjs';
import { publishFix } from './lib/publish.mjs';
import { cliProject, loadProjects } from './lib/projects.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(readFileSync(join(HERE, 'policy.json'), 'utf8'));
const key = process.argv[2]?.toUpperCase();
const local = process.argv.includes('--local');
const project = key ? cliProject(loadProjects(HERE), { key }) : null;
const { cfg, stateDir, repoDir } = project ?? {};
const saved = join(stateDir ?? HERE, 'work', key ?? '', 'result.json');
if (!key || !existsSync(saved)) {
  console.error('usage: node agent/fix-one.mjs <KEY> [--local]   (needs a saved analysis: run agent/analyze-one.mjs <KEY> first)');
  process.exit(1);
}

const analysis = JSON.parse(readFileSync(saved, 'utf8'));
const jira = createJira();
const events = createEventLog(join(HERE, 'state', 'events.jsonl'));
const issue = await jira.getIssue(key);
const blocker = fixBlocker({ issue, result: analysis, policy });
if (blocker) console.warn(`note: the watcher would skip this ticket (${blocker}); running anyway because it was asked for explicitly`);

const started = Date.now();
const side = fixSide({ issue, result: analysis, policy });
console.log(`side: ${side}`);
const fix = await reproduceAndFix({ issue, analysis, repoDir, stateDir, cfg, events, toolsDir: resolve(HERE, cfg.toolsDir), allowSupersededTests: policy.proposeFixWhen?.allowSupersededTestUpdates === true, side });
console.log(`\nbranch ${fix.branch}: test ${fix.test.commit}, fix ${fix.fix.commit} · ${fix.fix.files.join(', ')}`);
console.log(`checks: ${JSON.stringify(fix.checks)}`);
console.log(`evidence: ${JSON.stringify(fix.evidence)}`);
if (local) {
  fix.ws.remove();
  console.log(`--local: not published. The branch ${fix.branch} stays in the local clone.`);
} else {
  const pub = await publishFix({ key, analysis, result: fix, jira, events, stateDir });
  console.log(`PR: ${pub.prUrl}`);
}
console.log(`total ${Math.round((Date.now() - started) / 1000)} s`);
