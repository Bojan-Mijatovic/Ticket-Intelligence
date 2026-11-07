#!/usr/bin/env node
// Copies the historical MediAgenda demo tickets (CUP_DEMO-2398 … 2615) into a real Jira project and records the new
// keys in demo/jira-keys.json, so make-mediagenda.mjs can use the real keys in commit messages and code comments.
// The target ticket (CUP_DEMO-2629) is not seeded: it is created live with new-ticket.mjs.
//
//   node demo/seed-jira.mjs [--project DEM]
//   node demo/seed-jira.mjs --app medilab     another application of the suite: demo/src/<app>/tickets.json
//                                             (its project, order and links; placeholders CUP_LAB-1xx → real keys)
//
// Jira credentials come from the analyze-ticket .env (JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN).
// All comments are written by the token's user, so each one starts with the name of the (fictional) person.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = existsSync(join(homedir(), '.claude', 'skills', 'analyze-ticket')) ? join(homedir(), '.claude', 'skills', 'analyze-ticket') : join(HERE, '..', '.claude', 'skills', 'analyze-ticket');
const { loadConfig } = await import(new URL(`file:///${join(SKILL, 'scripts', 'lib', 'config.mjs').replace(/\\/g, '/')}`));
const cfg = loadConfig();
const args = process.argv.slice(2);
const APP = args.includes('--app') ? args[args.indexOf('--app') + 1] : null;
const appTickets = APP ? JSON.parse(readFileSync(join(HERE, 'src', APP, 'tickets.json'), 'utf8')) : null;
const PROJECT = args.includes('--project') ? args[args.indexOf('--project') + 1] : appTickets?.project ?? 'DEM';
const KEYS_FILE = join(HERE, 'jira-keys.json');
// Oldest first, so the Jira keys follow the story; tickets already in jira-keys.json are skipped.
const SEED_ORDER = appTickets ? appTickets.issues.map((i) => i.key) : ['CUP_DEMO-2398', 'CUP_DEMO-2580', 'CUP_DEMO-2602', 'CUP_DEMO-2511', 'CUP_DEMO-2615', 'CUP_DEMO-2441', 'CUP_DEMO-2470', 'CUP_DEMO-2590', 'CUP_DEMO-2533', 'CUP_DEMO-2612', 'CUP_DEMO-2620',
  // Bugs fixed in the history, so the hotspot map (FR-64) has data: oldest first.
  'CUP_DEMO-2402', 'CUP_DEMO-2419', 'CUP_DEMO-2455', 'CUP_DEMO-2483', 'CUP_DEMO-2489', 'CUP_DEMO-2603', 'CUP_DEMO-2541', 'CUP_DEMO-2549', 'CUP_DEMO-2627'];

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
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

const OPT_OUT = 'no-ai'; // agent/agent.config.json → labels.skip
const fixtures = appTickets ? appTickets.issues : JSON.parse(readFileSync(join(SKILL, 'fixtures', 'mock-jira.json'), 'utf8')).issues;
const byKey = new Map(fixtures.map((i) => [i.key, i]));
const keys = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
// Placeholders of every app of the suite (CUP_DEMO-2533, CUP_LAB-118, …): a ticket may name another app's ticket.
const mapKeys = (s) => String(s ?? '').replace(/CUP_[A-Z]+-\d+/g, (k) => keys[k] ?? k);

async function createIssue(issue) {
  const fields = {
    project: { key: PROJECT },
    summary: mapKeys(issue.summary),
    description: mapKeys(issue.description),
    issuetype: { name: issue.issueType === 'Story' ? 'Story' : issue.issueType === 'Bug' ? 'Bug' : 'Task' },
    // A running watcher must not pick a history ticket in the seconds before it is moved to Done: it is created
    // with the opt-out label, which is removed once the ticket is Done (the watcher never picks Done tickets).
    labels: [...(issue.environments ?? []), OPT_OUT],
  };
  try {
    return await api('POST', '/rest/api/2/issue', { fields: { ...fields, priority: { name: issue.priority } } });
  } catch (e) {
    if (e.status === 400 && /priority/i.test(e.body)) return api('POST', '/rest/api/2/issue', { fields });
    throw e;
  }
}

async function moveToDone(key) {
  const { transitions } = await api('GET', `/rest/api/2/issue/${key}/transitions`);
  const done = transitions.find((t) => /^done$/i.test(t.to?.name ?? t.name)) ?? transitions.find((t) => t.to?.statusCategory?.key === 'done');
  if (done) await api('POST', `/rest/api/2/issue/${key}/transitions`, { transition: { id: done.id } });
  return done?.to?.name ?? null;
}

const created = [];
for (const oldKey of SEED_ORDER) {
  if (keys[oldKey]) {
    console.log(`${oldKey} already seeded as ${keys[oldKey]}, skipping`);
    continue;
  }
  const issue = byKey.get(oldKey);
  const res = await createIssue(issue);
  keys[oldKey] = res.key;
  writeFileSync(KEYS_FILE, `${JSON.stringify(keys, null, 2)}\n`);
  for (const c of issue.comments ?? []) {
    await api('POST', `/rest/api/2/issue/${res.key}/comment`, { body: `*${c.author.name}:* ${mapKeys(c.body)}` });
  }
  for (const w of issue.worklogs ?? []) {
    try {
      await api('POST', `/rest/api/2/issue/${res.key}/worklog`, { timeSpentSeconds: w.seconds, comment: `Logged for ${w.author.name}` });
    } catch {
      /* time tracking may be disabled in team-managed projects */
    }
  }
  const status = issue.resolution ? await moveToDone(res.key) : null;
  if (status) await api('PUT', `/rest/api/2/issue/${res.key}`, { update: { labels: [{ remove: OPT_OUT }] } });
  created.push(`${oldKey} -> ${res.key}${status ? ` (${status})` : ''}  ${issue.summary}`);
}

// Link related tickets, like a real team would (only links that involve a ticket created in this run).
const LINKS = appTickets ? appTickets.links ?? [] : [
  ['CUP_DEMO-2511', 'CUP_DEMO-2398'],
  ['CUP_DEMO-2533', 'CUP_DEMO-2470'],
  ['CUP_DEMO-2620', 'CUP_DEMO-2470'],
  ['CUP_DEMO-2612', 'CUP_DEMO-2441'],
  ['CUP_DEMO-2455', 'CUP_DEMO-2441'],
  ['CUP_DEMO-2580', 'CUP_DEMO-2441'],
  ['CUP_DEMO-2483', 'CUP_DEMO-2470'],
  ['CUP_DEMO-2489', 'CUP_DEMO-2470'],
  ['CUP_DEMO-2603', 'CUP_DEMO-2590'],
  ['CUP_DEMO-2541', 'CUP_DEMO-2533'],
  ['CUP_DEMO-2549', 'CUP_DEMO-2533'],
  ['CUP_DEMO-2627', 'CUP_DEMO-2533'],
];
const createdNow = new Set(created.map((line) => line.split(' ')[0]));
for (const [a, b] of LINKS.filter(([a, b]) => createdNow.has(a) || createdNow.has(b))) {
  try {
    await api('POST', '/rest/api/2/issueLink', { type: { name: 'Relates' }, inwardIssue: { key: keys[a] }, outwardIssue: { key: keys[b] } });
  } catch (e) {
    console.warn(`link ${a} → ${b} skipped: ${e.message}`);
  }
}

console.log(created.length ? `Created:\n  ${created.join('\n  ')}` : 'Nothing new to create.');
console.log(`Key map: ${KEYS_FILE}`);
