// The watcher's heavy reads, off its own thread: a project's insights (buildInsights) and its ticket graph with the
// accuracy (loadGraph, scoreAccuracy). Both run git and gh synchronously, hundreds of times. On the watcher's thread
// they held up every request, the dashboard's live stream and the ticket queue: on 2026-11-16 a status request
// waited 9.4 s behind the Insights of MediLab, 10.5 s behind the Graph of MediVax, and up to 16 s, again and again for
// a minute, behind the Impact tab. One worker per job (watcher.mjs, runHeavy); the watcher caches the results as before.
// The knowledge base's list (entries on main, documentation PRs) asks gh the same way: 3.3 s.

import { existsSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import { readBlameOrigins, recordAccuracy, scoreAccuracy } from './accuracy.mjs';
import { createDocsPrs } from './docs-prs.mjs';
import { loadGraph, readSuitePullRequests } from './git-graph.mjs';
import { buildInsights, savedAnalyses } from './insights.mjs';
import { createJira } from './jira-actions.mjs';
import { codeVerdict, loadPriorArtSources, priorArtCandidates } from './prior-art.mjs';
import { lintKnowledge } from './knowledge.mjs';
import { loadProjects, teamOf } from './projects.mjs';
import { readReplays } from './replay.mjs';

/**
 * @param {'insights'|'graph'|'knowledge'|'docs-merge'|'prior-art'} job
 * @param {string} key          the project
 * @param {Map} [suitePrs]      the suite's pull requests, when the watcher has them fresh; read here otherwise and
 *                              sent back for the next project
 * @param {object} [item]       prior-art: what to check (ask-actions.mjs priorArtItem), against `tickets` (Insights)
 */
export async function heavyJob({ job, agentDir, key, eventsDir, suitePrs = null, item = null, tickets = [], number = null }) {
  const all = loadProjects(agentDir);
  const p = all.byKey(key);
  if (!p) throw new Error(`no project ${key}`);
  if (job === 'knowledge') return { data: await createDocsPrs({ repoDir: p.repoDir }).list() };
  // One documentation PR merged (a person's Merge, or mergeDocs: auto); one in conflict with main is brought up to date
  // entry by entry first (K22) and linted (K5) before it is pushed.
  if (job === 'docs-merge') {
    const lint = (files, o) => lintKnowledge(files, { ...o, projects: all.projects.map((x) => x.key), team: teamOf(all.projects) });
    return { data: await createDocsPrs({ repoDir: p.repoDir, lint }).merge(number) };
  }
  // K19 for a draft that is not an Insights suggestion (an Ask answer, Ask 3/7): git log, the knowledge base on main and
  // gh pr list, a few seconds.
  if (job === 'prior-art') {
    const sources = loadPriorArtSources({ repoDir: p.repoDir, analyses: savedAnalyses(p.stateDir) });
    const candidates = priorArtCandidates(item, { ...sources, tickets });
    return { data: { ...codeVerdict(candidates), candidates, notes: sources.notes ?? [] } };
  }
  const jira = createJira();
  if (job === 'insights') {
    const peers = all.projects.filter((x) => x.key !== p.key).map((x) => ({ key: x.key, name: x.name, repoDir: x.repoDir }));
    return { data: await buildInsights({ repoDir: p.repoDir, stateDir: p.stateDir, cfg: p.cfg, jira, peers }) };
  }
  if (job === 'graph') {
    const prs = suitePrs ?? readSuitePullRequests(all.projects.filter((x) => existsSync(x.repoDir)));
    const graph = await loadGraph({ project: p, eventsDir, jira, suitePrs: prs });
    const acc = scoreAccuracy(graph, { rules: p.cfg.insights?.components ?? [], replays: readReplays(p.stateDir), origins: readBlameOrigins(p.stateDir) });
    return { data: { graph, accuracy: { ...acc, trend: recordAccuracy(p.stateDir, acc) } }, suitePrs: suitePrs ? null : prs };
  }
  throw new Error(`unknown job ${job}`);
}

if (parentPort && workerData?.job) {
  try {
    parentPort.postMessage({ ok: true, ...(await heavyJob(workerData)) });
  } catch (e) {
    parentPort.postMessage({ ok: false, error: e.message, status: e.status ?? null });
  }
}
