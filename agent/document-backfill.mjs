#!/usr/bin/env node
// Knowledge base backfill (K4 of docs/KNOWLEDGE_PLAN.md): documents tickets that were resolved before the agent
// documented them (or without the agent): Done tickets with a fix commit on main and no entry in docs/knowledge.
// All of them go on ONE branch (docs/backfill-<time>) with one commit each, and ONE draft pull request for the team
// to review. Dry run by default: it lists the tickets and the estimated cost.
//
//   node agent/document-backfill.mjs --project DEM                     what would be documented, and the cost
//   node agent/document-backfill.mjs --project DEM --yes               do it (at most --limit tickets, --max-cost $)
//   ... --since 2026-01-01     only fixes on or after this date (default 2026-01-01)
//   ... --limit 10             tickets per pull request (default 10)
//   ... --max-cost 5           stop before the next ticket once this many dollars are spent (default 5)
//   ... --types Bug,Story      issue types (default Bug)
//   ... --only DEM-5,DEM-22    just these tickets (still only candidates)
//   ... --include-waiting      also tickets with a docs/<KEY> branch already (an old entry, e.g. a closed PR):
//                              documented again in the current format

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJira } from './lib/jira-actions.mjs';
import { createJiraHealth } from './lib/jira-health.mjs';
import { coverage, pickCandidates, repoKnowledge } from './lib/doc-candidates.mjs';
import { documentBatch } from './lib/document.mjs';
import { cliProject, loadProjects } from './lib/projects.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback = null) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const APPLY = args.includes('--yes');
const since = opt('--since', '2026-01-01');
const limit = Number(opt('--limit', 10));
const maxCost = Number(opt('--max-cost', 5));
const types = opt('--types', 'Bug').split(',').map((s) => s.trim()).filter(Boolean);
const only = opt('--only')?.split(',').map((k) => k.trim().toUpperCase());

const all = loadProjects(HERE);
const p = cliProject(all);
const { cfg } = p;
const L = cfg.labels;

/** Cost of the documentation runs so far (transcripts of every project), for the estimate. */
function pastDocRuns() {
  const costs = [];
  for (const proj of all.projects) {
    const work = join(proj.stateDir, 'work');
    if (!existsSync(work)) continue;
    for (const key of readdirSync(work)) {
      const file = join(work, key, 'transcript-document.jsonl');
      if (!existsSync(file)) continue;
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.includes('"type":"result"')) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.type === 'result' && ev.total_cost_usd) costs.push(ev.total_cost_usd);
        } catch {
          /* not a JSON line */
        }
      }
    }
  }
  return costs;
}

const jira = createJira();
const health = await createJiraHealth({ jira, projects: [p.key] }).check();
if (health.ok === false) {
  console.error(`Jira unavailable: ${health.error}`);
  process.exit(1);
}

console.log(`${p.name} (${p.key}) · ${APPLY ? 'BACKFILL' : 'dry run'} · ${types.join('/')} fixed since ${since} · up to ${limit} per pull request · cost limit $${maxCost}`);
const tickets = await jira.searchAll(`project = ${p.key} AND statusCategory = Done ORDER BY key ASC`, 1000);
const known = repoKnowledge(p.repoDir);
const before = coverage(tickets, known, { types });
console.log(`Coverage now: ${before.documented} of ${before.fixed} resolved ${types.join('/')} tickets with a fix on main are documented on main${before.waiting ? ` (+${before.waiting} waiting in documentation PRs)` : ''}.`);

const { take, skipped } = pickCandidates(tickets, known, { since, types, skipLabels: [L.skip, L.documenting], includeWaiting: args.includes('--include-waiting') });
const chosen = take.filter((t) => !only || only.includes(t.key)).slice(0, limit);
const later = take.length - chosen.length;
const reasons = Object.entries(skipped.reduce((m, s) => ({ ...m, [s.reason]: [...(m[s.reason] ?? []), s.key] }), {}));
console.log(`\nLeft out: ${reasons.map(([r, keys]) => `${r} (${keys.length > 3 ? keys.length : keys.join(', ')})`).join(' · ') || 'none'}`);
if (!chosen.length) {
  console.log('\nNothing to document.');
  process.exit(0);
}
console.log(`\nTo document${later ? ` (the first ${chosen.length}; ${later} more in a next run)` : ''}:`);
for (const t of chosen) console.log(`  ${t.key.padEnd(8)} ${t.summary.slice(0, 80)}\n           fix ${t.commits.slice(0, 3).map((c) => `${c.hash} ${c.date}`).join(', ')}`);

const costs = pastDocRuns();
const avg = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null;
console.log(avg ? `\nEstimate: ~$${(avg * chosen.length).toFixed(2)} (${chosen.length} × $${avg.toFixed(2)}, the average of ${costs.length} documentation run(s) so far)${avg * chosen.length > maxCost ? `; the run stops at $${maxCost}` : ''}.` : '\nEstimate: no documentation run measured yet; run with --limit 3 first to measure.');

if (!APPLY) {
  console.log('\nNothing changed. Run with --yes to document them on one branch with one draft pull request.');
  process.exit(0);
}

const started = Date.now();
const r = await documentBatch({ tickets: chosen, repoDir: p.repoDir, stateDir: p.stateDir, cfg, jira, labels: L, maxCostUsd: maxCost, onProgress: (s) => console.log(`  [${Math.round((Date.now() - started) / 1000)}s] ${s}`) });
console.log(`\nDocumented ${r.done.length}, failed ${r.failed.length}, not run ${r.notRun.length} · $${r.costUsd.toFixed(2)} · ${Math.round((Date.now() - started) / 1000)} s`);
for (const f of r.failed) console.log(`  failed ${f.key}: ${f.error}`);
if (r.prUrl) console.log(`Pull request: ${r.prUrl} (branch ${r.branch}). Merge it on the dashboard (Insights → Knowledge base) or on GitHub after review.`);
else if (r.branch) console.log(`Branch ${r.branch} pushed (no GitHub remote: no pull request).`);
const after = coverage(tickets, repoKnowledge(p.repoDir), { types });
console.log(`Coverage: ${after.documented} of ${after.fixed} documented on main, +${after.waiting} waiting in documentation PRs (the backfill branch counts once its PR is merged).`);
