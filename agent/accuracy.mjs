#!/usr/bin/env node
// How often the agent was right (AI1, FR-69): what it said or did compared with what happened, per project, from the
// project's graph (git or SVN history, pull requests, the agent's events, Jira). No AI and no answer key. Read-only;
// it keeps one snapshot a day in <project state>/accuracy/snapshots.json for the trend.
//
//   node agent/accuracy.mjs                  every project with a clone
//   node agent/accuracy.mjs --project DEM    one project
//   node agent/accuracy.mjs --rows           also every analysed ticket, compared
//   node agent/accuracy.mjs --json           the whole result

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJira } from './lib/jira-actions.mjs';
import { createJiraHealth } from './lib/jira-health.mjs';
import { loadGraph, readSuitePullRequests } from './lib/git-graph.mjs';
import { readBlameOrigins, recordAccuracy, scoreAccuracy } from './lib/accuracy.mjs';
import { readReplays } from './lib/replay.mjs';
import { cliProject, loadProjects } from './lib/projects.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const all = loadProjects(HERE);
const args = process.argv.slice(2);
const projects = args.includes('--project') ? [cliProject(all)] : all.projects.filter((p) => existsSync(p.repoDir));
const jira = createJira();
// Without valid credentials Jira answers with no tickets instead of an error: say so, and measure without it.
const health = await createJiraHealth({ jira, projects: projects.map((p) => p.key) }).check();
const jiraOk = health.ok !== false;
if (!jiraOk) console.error(`Jira unavailable (${health.error}): measuring from git and the events only.\n`);

const pct = (r) => (r?.of ? `${Math.round((r.rate ?? 0) * 100)}% (${r.n}/${r.of})` : '–');
const num = (x, d = 2) => (x == null ? '–' : Number(x).toFixed(d));
const out = [];
// The pull requests of the whole suite: a demo reset closes one PR per repository, recognised only across them.
const suitePrs = readSuitePullRequests(all.projects.filter((p) => existsSync(p.repoDir)));

for (const p of projects) {
  const graph = await loadGraph({ project: p, eventsDir: join(HERE, 'state'), jira: jiraOk ? jira : null, suitePrs });
  const acc = scoreAccuracy(graph, { rules: p.cfg.insights?.components ?? [], replays: readReplays(p.stateDir), origins: readBlameOrigins(p.stateDir) });
  recordAccuracy(p.stateDir, acc);
  out.push(acc);
  if (args.includes('--json')) continue;

  const a = acc.analysis;
  console.log(`${p.name} (${p.key}) · ${graph.vcs} · ${graph.commits.length} commits · ${graph.prs.length} PRs · ${graph.tickets.length} tickets`);
  console.log(`  Analysis      ${a.runs} runs on ${a.tickets} tickets · avg $${num(a.avgCostUsd)} · ${num(a.avgSeconds, 0)} s · total $${num(a.costUsd)}`);
  console.log(`                files vs a person's change   ${pct(a.filesVsPerson.hit)}${a.filesVsPerson.hit.of ? ` · precision ${num(a.filesVsPerson.precision)} · recall ${num(a.filesVsPerson.recall)}` : ''}`);
  console.log(`                files vs the agent's own fix ${pct(a.filesVsAgent.hit)}`);
  console.log(`                component ${pct(a.component)} · owner ${pct(a.owner)} · already known? ${pct(a.priorArt)}`);
  console.log(`                by confidence: ${Object.entries(a.byConfidence).map(([c, r]) => `${c} ${pct(r)}`).join(' · ')}`);
  if (acc.replay) {
    const r = acc.replay;
    console.log(`  Replay        ${r.tickets} resolved bugs analysed again as they came in (AI1b): files ${pct(r.files)} · precision ${num(r.precision)} · recall ${num(r.recall)}`);
    console.log(`                component ${pct(r.component)} · owner ${pct(r.owner)} · already known right ${pct(r.priorArt)} · by confidence: ${Object.entries(r.byConfidence).map(([c, x]) => `${c} ${pct(x)}`).join(' · ')} · $${num(r.costUsd)}`);
  }
  console.log(`  Fix           ${acc.fix.tried} tried: ${acc.fix.pr} draft PR, ${acc.fix.failed} stopped (${acc.fix.skipped} tickets not eligible) · PRs: ${acc.fix['merged-unchanged']} merged unchanged, ${acc.fix['merged-changed']} merged with changes, ${acc.fix.rejected} rejected, ${acc.fix.withdrawn} withdrawn, ${acc.fix.open} open`);
  console.log(`                accepted unchanged ${pct(acc.fix.acceptedUnchanged)} · accepted ${pct(acc.fix.accepted)}`);
  if (acc.bisect.runs) {
    const b = acc.bisect;
    console.log(`  Bisect        ${b.runs} runs: ${b.found} found one commit, ${b.range} a range, ${b.older} older than the window, ${b.noGoodPoint} no good point${b.errors ? `, ${b.errors} errors` : ''} · ${num(b.avgSteps, 1)} test runs, ${num(b.avgSeconds, 0)} s on average · agrees with the blame origin after the fix ${pct(b.agreeWithBlame)}`);
  }
  console.log(`  AI review     ${acc.review.reviews} reviews · agrees with the outcome ${pct(acc.review.agreement)}`);
  console.log(`  Documentation ${acc.docs.prs} PRs · accepted unchanged ${pct(acc.docs.acceptedUnchanged)} · ${acc.docs.rejected} rejected, ${acc.docs.withdrawn} withdrawn, ${acc.docs.open} open`);
  for (const c of [...acc.fix.closed, ...acc.docs.closed]) console.log(`  closed by a person: #${c.number} ${c.keys.join(', ')}${c.reason ? ` · "${c.reason}"` : ' · no reason given'}`);
  for (const n of acc.notes) console.log(`  note: ${n}`);
  if (args.includes('--rows')) {
    for (const r of acc.rows) {
      if (r.skipped) {
        console.log(`    ${r.key.padEnd(8)} skipped: ${r.skipped}`);
        continue;
      }
      const files = r.files ? `files ${r.files.hit ? 'hit' : 'miss'} (${r.files.common.length}/${r.files.predicted.length} named, ${r.files.actual.length} changed)` : r.ownChange ? `files not measured: ${r.unmeasured}` : 'no change on main yet';
      const owner = r.fixer === 'person' ? ` · owner ${r.ownerHit == null ? r.ownerNote : r.ownerHit ? 'hit' : `miss (${r.owner} vs ${r.actualOwners.join(', ')})`}` : '';
      console.log(`    ${r.key.padEnd(8)} ${String(r.confidence).padEnd(6)} ${files}${r.fixer ? ` · fixed by ${r.fixer}` : ''}${owner} · already known: ${r.priorArt} → ${r.priorArtOutcome}`);
    }
  }
  console.log('');
}
if (args.includes('--json')) console.log(JSON.stringify(out.length === 1 ? out[0] : out, null, 2));
