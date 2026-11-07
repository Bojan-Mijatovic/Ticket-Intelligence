#!/usr/bin/env node
// Creates the Jira projects of the demo suite (team-managed, like DEM) and makes sure each has the issue types the
// seeded history uses (Bug, Story, Task). Needs a Jira administrator token. Projects that exist are left as they are.
//
//   node demo/jira-project.mjs                     every project of agent/agent.config.json that is missing in Jira
//   node demo/jira-project.mjs LAB "MediLab"       one project
//   node demo/jira-project.mjs --list              the projects in Jira and their issue types

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { loadProjects } from '../agent/lib/projects.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = existsSync(join(homedir(), '.claude', 'skills', 'analyze-ticket')) ? join(homedir(), '.claude', 'skills', 'analyze-ticket') : join(HERE, '..', '.claude', 'skills', 'analyze-ticket');
const { loadConfig } = await import(new URL(`file:///${join(SKILL, 'scripts', 'lib', 'config.mjs').replace(/\\/g, '/')}`));
const cfg = loadConfig();
if (cfg.mock || !cfg.baseUrl) {
  console.error('Jira is not configured (JIRA_MOCK=1 or no JIRA_BASE_URL in .env).');
  process.exit(1);
}
const auth = `Basic ${Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64')}`;

async function api(method, path, body) {
  const res = await fetch(cfg.baseUrl + path, {
    method,
    headers: { Authorization: auth, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`), { status: res.status });
  return text ? JSON.parse(text) : null;
}

const NEEDED = ['Bug', 'Story', 'Task'];
const TEMPLATE = 'com.pyxis.greenhopper.jira:gh-simplified-agility-kanban'; // team-managed Kanban (To Do, In Progress, Done)

const existing = async (key) => api('GET', `/rest/api/3/project/${key}`).catch((e) => (e.status === 404 ? null : Promise.reject(e)));
const typesOf = (p) => (p.issueTypes ?? []).map((t) => t.name);

async function ensureTypes(p) {
  const missing = NEEDED.filter((n) => !typesOf(p).includes(n));
  for (const name of missing) {
    // Team-managed projects have their own issue types: created with a PROJECT scope.
    await api('POST', '/rest/api/3/issuetype', { name, description: `${name} (demo suite)`, hierarchyLevel: 0, type: 'standard', scope: { type: 'PROJECT', project: { id: p.id } } })
      .then(() => console.log(`  ${p.key}: issue type ${name} added`))
      .catch((e) => console.warn(`  ${p.key}: issue type ${name} not added (${e.message}); add it in Project settings > Issue types`));
  }
}

async function create(key, name, description) {
  const found = await existing(key);
  if (found) {
    console.log(`${key} exists (${found.name}, ${found.style}): ${typesOf(found).join(', ')}`);
    await ensureTypes(found);
    return;
  }
  const me = await api('GET', '/rest/api/3/myself');
  const p = await api('POST', '/rest/api/3/project', {
    key, name, description: description ?? '', projectTypeKey: 'software', projectTemplateKey: TEMPLATE, leadAccountId: me.accountId, assigneeType: 'UNASSIGNED',
  });
  const full = await existing(p.key);
  console.log(`${key} created (${name}): ${cfg.baseUrl}/browse/${key} · issue types ${typesOf(full).join(', ')}`);
  await ensureTypes(full);
}

const args = process.argv.slice(2);
if (args.includes('--list')) {
  const { values } = await api('GET', '/rest/api/3/project/search?maxResults=50&expand=issueTypes');
  for (const v of values) console.log(`${v.key.padEnd(5)} ${v.name.padEnd(14)} ${v.style ?? ''}  ${typesOf(v).join(', ')}`);
} else if (args[0]) {
  await create(args[0].toUpperCase(), args[1] ?? args[0]);
} else {
  for (const p of loadProjects(join(HERE, '..', 'agent')).projects) await create(p.key, p.name, p.cfg.description);
}
