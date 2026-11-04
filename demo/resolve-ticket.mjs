#!/usr/bin/env node
// Moves a ticket to Done, as the presenter would in Jira (used for rehearsals; in the live demo it is done in Jira).
//   node demo/resolve-ticket.mjs DEM-9

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = existsSync(join(homedir(), '.claude', 'skills', 'analyze-ticket')) ? join(homedir(), '.claude', 'skills', 'analyze-ticket') : join(HERE, '..', '.claude', 'skills', 'analyze-ticket');
const { loadConfig } = await import(new URL(`file:///${join(SKILL, 'scripts', 'lib', 'config.mjs').replace(/\\/g, '/')}`));
const cfg = loadConfig();
const key = process.argv[2];
if (!key) {
  console.error('usage: node demo/resolve-ticket.mjs <KEY>');
  process.exit(1);
}
const auth = `Basic ${Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64')}`;
const api = async (method, path, body) => {
  const res = await fetch(cfg.baseUrl + path, { method, headers: { Authorization: auth, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
};
const { transitions } = await api('GET', `/rest/api/2/issue/${key}/transitions`);
const done = transitions.find((t) => /^done$/i.test(t.to?.name ?? t.name)) ?? transitions.find((t) => t.to?.statusCategory?.key === 'done');
if (!done) throw new Error(`no transition to Done from the current status (${transitions.map((t) => t.name).join(', ')})`);
await api('POST', `/rest/api/2/issue/${key}/transitions`, { transition: { id: done.id } });
console.log(`${key} → ${done.to?.name ?? done.name}`);
