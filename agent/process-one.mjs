#!/usr/bin/env node
// Runs the full pipeline for one ticket, with real actions (Jira comment, labels, notification, update emails) per policy.json.
//   node agent/process-one.mjs DEM-7                   analyze + act
//   node agent/process-one.mjs DEM-7 --reuse-result    act on the last saved analysis (state/work/DEM-7/result.json)

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEventLog } from './lib/events.mjs';
import { createJira } from './lib/jira-actions.mjs';
import { processTicket } from './lib/pipeline.mjs';
import { attachMailUpdates } from './lib/mail-updates.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(HERE, 'agent.config.json'), 'utf8'));
const policy = JSON.parse(readFileSync(join(HERE, 'policy.json'), 'utf8'));
const key = process.argv[2];
if (!key) {
  console.error('usage: node agent/process-one.mjs <TICKET-KEY> [--reuse-result]');
  process.exit(1);
}
const stateDir = join(HERE, 'state');
const saved = join(stateDir, 'work', key, 'result.json');
const result = process.argv.includes('--reuse-result') && existsSync(saved) ? JSON.parse(readFileSync(saved, 'utf8')) : undefined;

const jira = createJira();
const events = createEventLog(join(stateDir, 'events.jsonl'));
const mail = attachMailUpdates({ events, policy, cfg, browseUrl: (k) => jira.browseUrl(k) });
if (!mail.enabled) console.log(`Email updates off: ${mail.reason}`);
const [issue] = await jira.search(`key = ${key}`, 1);
if (!issue) throw new Error(`${key} not found`);
await processTicket({ issue, cfg, policy, jira, events, repoDir: resolve(HERE, cfg.repo), stateDir, result });
await mail.flush();
