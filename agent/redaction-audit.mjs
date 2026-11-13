#!/usr/bin/env node
// What the redaction (R-02) masks in a project's tickets, for a person to check before tickets with patient data
// are used: every masked value per ticket (shown here, locally, never sent anywhere), and the capitalised word pairs
// it left, which may be names it missed. Read-only; no AI.
//
//   node agent/redaction-audit.mjs --project LAB              every ticket of the project
//   node agent/redaction-audit.mjs --project LAB --only LAB-7  one ticket

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJira } from './lib/jira-actions.mjs';
import { cliProject, loadProjects, teamOf } from './lib/projects.mjs';
import { createRedactor } from '../.claude/skills/analyze-ticket/scripts/lib/redact.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const all = loadProjects(HERE);
const p = cliProject(all);
const jira = createJira();
const team = teamOf(all.projects);

const keys = only ?? (await jira.searchAll(`project = ${p.key} ORDER BY key ASC`, 1000)).map((t) => t.key);
console.log(`${p.name} (${p.key}) · ${keys.length} ticket(s) · team kept: ${team.length} name(s) (git authors and agent.config.json "staff"), plus each ticket's Jira users`);
const totals = {};
const missedPairs = new Map();
for (const key of keys) {
  const t = await jira.getIssueFull(key, { raw: true, maxComments: 50, maxChars: 100_000 });
  const r = createRedactor({ allow: [...team, t.assignee, t.reporter, ...t.comments.map((c) => c.author)] });
  const parts = [t.summary, t.description, ...t.comments.map((c) => c.body)];
  const changes = [];
  for (const raw of parts) {
    const out = r.text(raw);
    if (out === raw) continue;
    // Pair each placeholder with what it replaced, by walking both texts.
    const re = /\[([A-Z_]+)_(\d+)\]/g;
    let m;
    let iRaw = 0;
    let iOut = 0;
    while ((m = re.exec(out))) {
      iRaw += m.index - iOut;
      const nextOut = out.slice(m.index + m[0].length, m.index + m[0].length + 12);
      const end = nextOut ? raw.indexOf(nextOut, iRaw) : raw.length;
      const original = raw.slice(iRaw, end < 0 ? iRaw + 20 : end);
      changes.push(`${m[0]} ← "${original}"`);
      iRaw += original.length;
      iOut = m.index + m[0].length;
    }
    for (const pair of out.match(/\b\p{Lu}\p{Ll}{2,}[ \t]+\p{Lu}\p{Ll}{2,}\b/gu) ?? []) missedPairs.set(pair, (missedPairs.get(pair) ?? 0) + 1);
  }
  for (const [k, n] of Object.entries(r.stats())) totals[k] = (totals[k] ?? 0) + n;
  if (changes.length) console.log(`\n${key}  ${t.summary.slice(0, 70)}\n  ${[...new Set(changes)].join('\n  ')}`);
}
console.log(`\nMasked in all: ${Object.entries(totals).map(([k, n]) => `${k} ${n}`).join(', ') || 'nothing'}`);
const pairs = [...missedPairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
if (pairs.length) console.log(`\nCapitalised word pairs left as they are (check that none is a person): ${pairs.map(([w, n]) => `${w}${n > 1 ? ` ×${n}` : ''}`).join(' · ')}`);
