#!/usr/bin/env node
// Scores what the agent did on a scenario ticket against the answer key in demo/scenarios.json.
// Read-only: uses agent/state (the saved analysis and the event log) and demo/jira-keys.json.
//
//   node demo/score-run.mjs DEM-21                        scenario taken from demo/.scenario-runs.json (written by new-ticket.mjs)
//   node demo/score-run.mjs DEM-21 --scenario birth-date
//   node demo/score-run.mjs --all                         every scenario ticket created so far

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { priorArtOk } from './lib/eval.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE = join(HERE, '..', 'agent', 'state');
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback);

const { scenarios } = readJson(join(HERE, 'scenarios.json'), { scenarios: {} });
const runs = readJson(join(HERE, '.scenario-runs.json'), {});
const keys = readJson(join(HERE, 'jira-keys.json'), {});
const mapKeys = (s) => String(s ?? '').replace(/CUP_[A-Z]+-\d+/g, (k) => keys[k] ?? k);
// Each project keeps its analyses in its own state folder (agent.config.json "projects"); the event log is shared.
const { loadProjects } = await import('../agent/lib/projects.mjs');
const projects = loadProjects(join(HERE, '..', 'agent'));
const stateOf = (key) => projects.ofTicket(key)?.stateDir ?? STATE;
const events = existsSync(join(STATE, 'events.jsonl'))
  ? readFileSync(join(STATE, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : [];

/** "scenario:<name>" → the newest ticket created for that scenario; anything else → the live key. */
function resolveKey(k) {
  if (!k?.startsWith('scenario:')) return k ? mapKeys(k) : null;
  const found = Object.entries(runs).filter(([, n]) => n === k.slice(9)).map(([key]) => key);
  return found.sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1])).pop() ?? null;
}

/** The knowledge file on the app's main that has an entry for `entryKey` ("### KEY: …"), or null. */
function knowledgeEntryOnMain(ticketKey, entryKey) {
  const repo = projects.ofTicket(ticketKey)?.repoDir;
  if (!repo) return null;
  try {
    return execFileSync('git', ['grep', '-l', `### ${entryKey}:`, 'origin/main', '--', 'docs/knowledge'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n')[0].replace(/^origin\/main:/, '') || null;
  } catch {
    return null; // git grep exits 1 when nothing matches
  }
}

function score(key, name) {
  const expected = scenarios[name]?.expected;
  if (!expected) return console.log(`${key}: unknown scenario "${name}"`);
  const resultFile = join(stateOf(key), 'work', key, 'result.json');
  if (!existsSync(resultFile)) return console.log(`${key} (${name}): no analysis yet (${resultFile})`);
  const r = JSON.parse(readFileSync(resultFile, 'utf8'));
  const text = [r.likelyCause, r.proposedFix, r.jiraComment, r.summary].join('\n');
  const files = (r.files ?? []).map((f) => String(f).replace(/\\/g, '/').replace(/:\d+.*$/, ''));
  const related = new Set([...(r.relatedTickets ?? []).map((t) => t.key), ...(text.match(/[A-Z][A-Z0-9_]+-\d+/g) ?? [])]);
  const introducedKey = mapKeys(expected.introducedBy).match(/[A-Z][A-Z0-9_]+-\d+/)?.[0];
  const mine = events.filter((e) => e.key === key);
  const fixed = mine.some((e) => e.type === 'fix-proposed');

  const checks = [
    ['cause: the right file', expected.files.some((f) => files.some((x) => x.endsWith(f) || f.endsWith(x)))],
    ['cause: the change that introduced it', Boolean(introducedKey && related.has(introducedKey))],
    ['related tickets found', expected.related.map(mapKeys).filter((k) => related.has(k)).length >= Math.min(2, expected.related.length)],
    ['owner', r.owner?.name === expected.owner],
    ['confidence high', r.confidence === 'high'],
    [expected.agentFix ? 'verified fix + draft PR' : 'no automatic fix (policy)', expected.agentFix ? fixed : !fixed],
  ];
  // Cross-project scenarios: the linked project of the cause is named, and the fix is put in the right project.
  if (expected.otherProjects?.length) {
    const named = new Set((r.otherProjects ?? []).map((o) => String(o.key).toUpperCase()));
    checks.push(['cross-project: the linked project of the cause', expected.otherProjects.every((k) => named.has(k))]);
  }
  if (expected.fixInProject) checks.push([`fix belongs in ${expected.fixInProject}`, String(r.fixInProject ?? key.split('-')[0]).toUpperCase() === expected.fixInProject]);
  // K21: is the ticket already known? Until the analysis returns priorArt (K20), only an open duplicate is structured.
  const notes = [];
  if (expected.priorArt) {
    const want = { ...expected.priorArt, key: resolveKey(expected.priorArt.key) };
    const got = { verdict: r.priorArt?.kind ?? (r.duplicateOf?.key ? 'duplicate' : 'none'), key: r.priorArt?.key ?? r.duplicateOf?.key ?? null };
    checks.push([`prior art: ${want.verdicts.join('|')}${want.key ? ` ${want.key}` : ''} (agent: ${got.verdict}${got.key ? ` ${got.key}` : ''})`, priorArtOk(want, got, mapKeys)]);
  }
  // K1: a recurrence of a documented problem must cite its knowledge entry; not scored until the entry is on main.
  if (expected.knowledgeEntry) {
    const entryKey = mapKeys(expected.knowledgeEntry);
    const entry = knowledgeEntryOnMain(key, entryKey);
    if (entry) checks.push([`knowledge entry of ${entryKey} cited (${entry})`, `${text}\n${(r.files ?? []).join('\n')}`.includes('docs/knowledge')]);
    else notes.push(`n/a: knowledge entry of ${entryKey} (not documented on main yet)`);
  }
  const points = checks.filter(([, ok]) => ok).length;
  console.log(`\n${key} · scenario ${name} · ${points}/${checks.length}`);
  for (const [label, ok] of checks) console.log(`  ${ok ? '✓' : '✗'} ${label}`);
  for (const n of notes) console.log(`  · ${n}`);
  if (!checks[0][1]) console.log(`    expected one of: ${expected.files.join(', ')}\n    agent named:     ${files.slice(0, 5).join(', ')}`);
  if (!checks[3][1]) console.log(`    expected owner ${expected.owner}, agent chose ${r.owner?.name}`);
  const done = mine.find((e) => e.type === 'done');
  if (done) console.log(`  time: ${Math.round(done.totalMs / 1000)} s · cost ~$${(done.meta?.costUsd ?? 0).toFixed(2)}`);
  return points;
}

if (args.includes('--all')) {
  const entries = Object.entries(runs);
  if (!entries.length) console.log('No scenario tickets yet: node demo/new-ticket.mjs --scenario <name>');
  for (const [key, name] of entries) score(key, name);
} else {
  const key = args.find((a) => /^[A-Z][A-Z0-9_]+-\d+$/.test(a));
  if (!key) {
    console.error('usage: node demo/score-run.mjs <KEY> [--scenario <name>] | --all');
    process.exit(1);
  }
  score(key, opt('--scenario') ?? runs[key] ?? 'struttura');
}
