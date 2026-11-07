#!/usr/bin/env node
// Runs the full pipeline for one ticket, with real actions (Jira comment, labels, notification, update emails) per policy.json.
//   node agent/process-one.mjs DEM-7                   analyze + act (the project comes from the key)
//   node agent/process-one.mjs DEM-7 --reuse-result    act on the last saved analysis (<project state>/work/DEM-7/result.json)

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEventLog } from './lib/events.mjs';
import { createJira } from './lib/jira-actions.mjs';
import { processTicket } from './lib/pipeline.mjs';
import { attachMailUpdates } from './lib/mail-updates.mjs';
import { cliProject, loadProjects, peerCheckouts } from './lib/projects.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(readFileSync(join(HERE, 'policy.json'), 'utf8'));
const key = process.argv[2]?.toUpperCase();
if (!key) {
  console.error('usage: node agent/process-one.mjs <TICKET-KEY> [--reuse-result]');
  process.exit(1);
}
const all = loadProjects(HERE);
const p = cliProject(all, { key });
const saved = join(p.stateDir, 'work', key, 'result.json');
const result = process.argv.includes('--reuse-result') && existsSync(saved) ? JSON.parse(readFileSync(saved, 'utf8')) : undefined;

const jira = createJira();
const events = createEventLog(join(HERE, 'state', 'events.jsonl'));
const mail = attachMailUpdates({ events, policy, cfg: all.global, browseUrl: (k) => jira.browseUrl(k) });
if (!mail.enabled) console.log(`Email updates off: ${mail.reason}`);
const [issue] = await jira.search(`key = ${key}`, 1);
if (!issue) throw new Error(`${key} not found`);
await processTicket({ issue, cfg: p.cfg, policy, jira, events, repoDir: p.repoDir, stateDir: p.stateDir, project: { key: p.key, name: p.name }, peers: (warn) => peerCheckouts(p, all, warn), result });
await mail.flush();
