#!/usr/bin/env node
// Opens a demo ticket in the real Jira project, as a reporter would. Used for rehearsals, the live demo and
// scoring the agent (docs/AGENT_TRAINING.md).
//
//   node demo/new-ticket.mjs [--project DEM] [--screenshot path.png]   the demo target (CUP_DEMO-2629 scenario)
//   node demo/new-ticket.mjs --scenario birth-date                     a scenario from demo/scenarios.json
//   node demo/new-ticket.mjs --delete DEM-7        removes a rehearsal ticket

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = existsSync(join(homedir(), '.claude', 'skills', 'analyze-ticket')) ? join(homedir(), '.claude', 'skills', 'analyze-ticket') : join(HERE, '..', '.claude', 'skills', 'analyze-ticket');
const { loadConfig } = await import(new URL(`file:///${join(SKILL, 'scripts', 'lib', 'config.mjs').replace(/\\/g, '/')}`));
const cfg = loadConfig();
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const PROJECT = opt('--project') ?? 'DEM';
// Tickets created by this script, so reset-demo.mjs deletes only those (never the seeded history or other tickets).
const TRACK = join(HERE, '.demo-tickets.json');
const tracked = () => (existsSync(TRACK) ? JSON.parse(readFileSync(TRACK, 'utf8')) : []);
const track = (keys) => writeFileSync(TRACK, `${JSON.stringify([...new Set(keys)], null, 2)}\n`);
const auth = `Basic ${Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64')}`;

async function api(method, path, body, headers = {}) {
  const res = await fetch(cfg.baseUrl + path, {
    method,
    headers: { Authorization: auth, Accept: 'application/json', ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

if (opt('--delete')) {
  const key = opt('--delete');
  try {
    await api('DELETE', `/rest/api/2/issue/${key}`);
    console.log(`deleted ${key}`);
  } catch (e) {
    // Deleted by hand in Jira already: nothing left to do but forget it.
    if (!/-> 404:/.test(e.message)) throw e;
    console.log(`${key} no longer exists in Jira`);
  }
  track(tracked().filter((k) => k !== key));
  process.exit(0);
}

const keys = existsSync(join(HERE, 'jira-keys.json')) ? JSON.parse(readFileSync(join(HERE, 'jira-keys.json'), 'utf8')) : {};
const mapKeys = (s) => String(s ?? '').replace(/CUP_DEMO-\d+/g, (k) => keys[k] ?? k);
// The ticket: a scenario from scenarios.json (--scenario <name>), by default the demo target CUP_DEMO-2629.
const { scenarios } = JSON.parse(readFileSync(join(HERE, 'scenarios.json'), 'utf8'));
const name = opt('--scenario') ?? 'struttura';
const scenario = scenarios[name];
if (!scenario) {
  console.error(`unknown scenario "${name}"; available: ${Object.keys(scenarios).join(', ')}`);
  process.exit(1);
}
const fixture = scenario.fixture ? JSON.parse(readFileSync(join(SKILL, 'fixtures', 'mock-jira.json'), 'utf8')).issues.find((i) => i.key === scenario.fixture) : null;
const target = fixture
  ? { summary: fixture.summary, description: fixture.description, issueType: 'Bug', priority: 'High', labels: fixture.environments ?? [] }
  : scenario;

const fields = {
  project: { key: PROJECT },
  summary: target.summary,
  description: mapKeys(target.description),
  issuetype: { name: target.issueType ?? 'Bug' },
  labels: target.labels ?? [],
};
let res;
try {
  res = await api('POST', '/rest/api/2/issue', { fields: { ...fields, priority: { name: target.priority ?? 'High' } } });
} catch (e) {
  if (!/priority/i.test(e.message)) throw e;
  res = await api('POST', '/rest/api/2/issue', { fields });
}

const shot = opt('--screenshot');
if (shot) {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(shot)], { type: 'image/png' }), basename(shot));
  await api('POST', `/rest/api/2/issue/${res.key}/attachments`, form, { 'X-Atlassian-Token': 'no-check' });
}

track([...tracked(), res.key]);
// Which scenario each ticket is, for demo/score-run.mjs.
const RUNS = join(HERE, '.scenario-runs.json');
const runs = existsSync(RUNS) ? JSON.parse(readFileSync(RUNS, 'utf8')) : {};
writeFileSync(RUNS, `${JSON.stringify({ ...runs, [res.key]: name }, null, 2)}\n`);
console.log(`${res.key}  ${cfg.baseUrl}/browse/${res.key}`);
console.log(`Title: ${target.summary}  (scenario ${name})`);
