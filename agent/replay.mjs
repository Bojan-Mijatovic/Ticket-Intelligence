#!/usr/bin/env node
// Replay on resolved history (AI1b, FR-71): the agent's analysis of bugs a person fixed, run again as if each had
// just come in (the code before the fix, Jira as it was), and compared with the real fix. It costs one analysis per
// ticket, so it is a dry run by default.
//
//   node agent/replay.mjs --project DEM                         the candidates and the estimated cost (dry run)
//   node agent/replay.mjs --project DEM --limit 3 --yes         replay the 3 oldest not replayed yet
//   node agent/replay.mjs --project DEM --only DEM-5,DEM-22 --yes
//   ... --again          also tickets replayed before        ... --max-cost 10   stop before the total passes it
//
// Results: <project state>/replay/<KEY>.json; agent/accuracy.mjs and the Graph tab show them as "replay".

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJira } from './lib/jira-actions.mjs';
import { createJiraHealth } from './lib/jira-health.mjs';
import { loadGraph } from './lib/git-graph.mjs';
import { readReplays, replayCandidates, replayOne } from './lib/replay.mjs';
import { summarizeReplays } from './lib/accuracy.mjs';
import { cliProject, loadProjects } from './lib/projects.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const all = loadProjects(HERE);
const p = cliProject(all);
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const APPLY = args.includes('--yes');
const maxCost = Number(opt('--max-cost') ?? 10);
const limit = Number(opt('--limit') ?? Infinity);
const only = opt('--only')?.split(',').map((k) => k.trim().toUpperCase()).filter(Boolean) ?? null;

const jira = createJira();
const health = await createJiraHealth({ jira, projects: [p.key] }).check();
if (health.ok === false) {
  console.error(`Jira unavailable: ${health.error}`);
  process.exit(1);
}
// PRs are not needed here: the candidates are fixes on the main line.
const graph = await loadGraph({ project: p, eventsDir: join(HERE, 'state'), jira, suitePrs: new Map([[p.key, { prs: [], warning: null }]]) });
if (graph.vcs !== 'git') {
  console.error(`${p.name} is on ${graph.vcs}: the replay needs git (SVN shows later revisions from the server).`);
  process.exit(1);
}
const done = new Set(readReplays(p.stateDir).map((r) => r.key));
let list = replayCandidates(graph);
const total = list.length;
if (only) list = list.filter((c) => only.includes(c.key));
if (!args.includes('--again')) list = list.filter((c) => !done.has(c.key) || only?.includes(c.key));
list = list.slice(0, limit);
const runs = graph.tickets.flatMap((t) => t.analyses).map((a) => a.costUsd).filter((x) => x != null);
const estimate = runs.length ? runs.reduce((s, x) => s + x, 0) / runs.length : 0.4;

console.log(`${p.name} (${p.key}): ${total} resolved bug(s) fixed by a person; ${done.size} replayed before; ${list.length} to replay now, ~$${(estimate * list.length).toFixed(2)} (≈$${estimate.toFixed(2)} each)`);
for (const c of list) console.log(`  ${c.key.padEnd(8)} fix ${c.changes.map((x) => x.short).join(', ')} · ${c.actual.length} code file(s) · ${c.people.join(', ')}`);
if (!APPLY) {
  console.log('\nDry run. Add --yes to replay (one analysis per ticket).');
  process.exit(0);
}

const workRoot = join(p.stateDir, 'replay-work');
let spent = 0;
const rows = [];
for (const c of list) {
  if (spent + estimate > maxCost) {
    console.log(`\nStopped before ${c.key}: $${spent.toFixed(2)} spent, the next would pass --max-cost ${maxCost}.`);
    break;
  }
  try {
    const row = await replayOne({ candidate: c, project: p, cfg: p.cfg, workRoot, stateDir: p.stateDir, onProgress: (s) => console.log(`  · ${s}`) });
    spent += row.meta.costUsd ?? 0;
    rows.push(row);
    console.log(`${c.key}: files ${row.files.hit ? 'HIT' : 'miss'} (${row.files.common.length}/${row.files.predicted.length} named, ${row.files.actual.length} changed) · component ${row.componentHit ?? '–'} · owner ${row.ownerHit == null ? 'none proposed' : row.ownerHit ? 'hit' : `miss (${row.owner} vs ${row.actualOwners.join(', ')})`} · already known: ${row.priorArt} · ${row.confidence} · $${(row.meta.costUsd ?? 0).toFixed(2)} · ${Math.round((row.meta.durationMs ?? 0) / 1000)} s`);
  } catch (e) {
    console.log(`${c.key}: failed: ${e.message}`);
    if (/usage limit|rate limit|hit your limit/i.test(e.message)) {
      console.log('The account\'s usage limit is reached: stopping (the rest is not run).');
      break;
    }
  }
}
const s = summarizeReplays(readReplays(p.stateDir));
const pct = (r) => (r?.of ? `${Math.round(r.rate * 100)}% (${r.n}/${r.of})` : '–');
console.log(`\nThis run: ${rows.length} replayed, $${spent.toFixed(2)}.`);
console.log(`All replays of ${p.key} (${s.tickets}): files ${pct(s.files)} · precision ${s.precision?.toFixed(2) ?? '–'} · recall ${s.recall?.toFixed(2) ?? '–'} · component ${pct(s.component)} · owner ${pct(s.owner)} · already known right ${pct(s.priorArt)} · $${s.costUsd.toFixed(2)}`);
