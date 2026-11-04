#!/usr/bin/env node
// Opens the demo target ticket (the CUP_DEMO-2629 scenario) in the real Jira project, as a reporter would.
// Used for rehearsals and for the live demo.
//
//   node demo/new-ticket.mjs [--project DEM] [--screenshot path.png]
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
  await api('DELETE', `/rest/api/2/issue/${opt('--delete')}`);
  track(tracked().filter((k) => k !== opt('--delete')));
  console.log(`deleted ${opt('--delete')}`);
  process.exit(0);
}

const keys = existsSync(join(HERE, 'jira-keys.json')) ? JSON.parse(readFileSync(join(HERE, 'jira-keys.json'), 'utf8')) : {};
const mapKeys = (s) => String(s ?? '').replace(/CUP_DEMO-\d+/g, (k) => keys[k] ?? k);
const target = JSON.parse(readFileSync(join(SKILL, 'fixtures', 'mock-jira.json'), 'utf8')).issues.find((i) => i.key === 'CUP_DEMO-2629');

const fields = {
  project: { key: PROJECT },
  summary: target.summary,
  description: mapKeys(target.description),
  issuetype: { name: 'Bug' },
  labels: target.environments ?? [],
};
let res;
try {
  res = await api('POST', '/rest/api/2/issue', { fields: { ...fields, priority: { name: 'High' } } });
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
console.log(`${res.key}  ${cfg.baseUrl}/browse/${res.key}`);
console.log(`Title: ${target.summary}`);
