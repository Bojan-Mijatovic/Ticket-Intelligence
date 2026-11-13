// Continuous evaluation (AI1 of docs/AUTONOMY_AND_NEXT.md): what the agent said or did, compared with what happened,
// read from the project's graph (lib/git-graph.mjs). No answer key and no AI: every ticket the agent analysed that
// later got its change on the main line, and every pull request it opened, is a test case.
//
//   analysis   the files it named vs the files the ticket's change touched (tests and docs left out); the component;
//              the owner it proposed vs who made the change (only a person's change counts: the agent fixing what it
//              analysed says nothing about the analysis); "already known?" vs whether the ticket needed its own change
//   fix        draft PRs merged unchanged, merged with a person's changes, rejected, withdrawn (demo reset), open
//   review     its verdict vs what became of the PR
//   docs       documentation PRs, the same outcomes
//
// Only a prediction made BEFORE the outcome counts: an analysis run after the ticket's change was on main is skipped.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { componentOf, personKey, pickOrigin } from './insights.mjs';

const TEST_FILE = /(^|\/)(e2e|tests?|__tests__)\/|\/src\/test\/|\.(spec|test)\.[cm]?[jt]sx?$|Tests?\.java$/i;
const PEER_FILE = /^[A-Z][A-Z0-9_]+:/; // a file of a linked project ("DEM:backend/…"): another repository
const NOT_A_PERSON = /unassigned|unknown|triage|team lead|n\/a|^-?$/i;
const KNOWN_KINDS = new Set(['duplicate', 'in-progress', 'fixed-on-main']); // "no own change needed"
const CONFIDENCE = ['high', 'medium', 'low'];

/** A file as the analysis names it ("src/a.ts:42", "src\\a.ts") → "src/a.ts"; null for a linked project's file. */
export function normalizeFile(f) {
  const s = String(f ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!s || PEER_FILE.test(s)) return null;
  return s.replace(/:\d+(?:[-–]\d+)?(?::\d+)?$/, '').replace(/\s+\(.*\)$/, '');
}

/** Same file, also when one side is a shortened path ("services/x.ts" and "frontend/src/app/services/x.ts"). */
export const sameFile = (a, b) => a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);

/** Code files only: tests and the knowledge base say nothing about where the problem was. */
export const codeFiles = (files, docsPath = 'docs/') => [...new Set(files.map(normalizeFile).filter((f) => f && !TEST_FILE.test(f) && !f.startsWith(docsPath)))];

/** Predicted vs actual files: any overlap (hit), precision and recall at file level. */
export function compareFiles(predicted, actual) {
  const common = predicted.filter((p) => actual.some((a) => sameFile(p, a)));
  const found = actual.filter((a) => predicted.some((p) => sameFile(p, a)));
  return { common, hit: common.length > 0, precision: predicted.length ? common.length / predicted.length : null, recall: actual.length ? found.length / actual.length : null };
}

const rate = (n, of) => ({ n, of, rate: of ? n / of : null });
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const sum = (xs) => xs.reduce((s, x) => s + (x ?? 0), 0);

/** What became of the "already known?" verdict: right, wrong, or pending (not decided yet). */
export function priorArtOutcome(kind, { ownChange, resolved, resolution, links = [] }) {
  const asDuplicate = /duplicate/i.test(resolution ?? '') || links.some((l) => /duplicate/i.test(l.type ?? ''));
  if (KNOWN_KINDS.has(kind)) {
    if (ownChange) return 'wrong'; // it said "no own change needed", and the ticket got one
    return asDuplicate || resolved ? 'right' : 'pending';
  }
  if (ownChange) return 'right';
  return asDuplicate && resolved ? 'wrong' : 'pending'; // it said "new", and the ticket was closed as a duplicate
}

/** One row per analysed ticket: the prediction and, when known, what happened. */
export function analysisRows(graph, { rules = [], docsPath = 'docs/knowledge/' } = {}) {
  const commits = new Map(graph.commits.map((c) => [c.id, c]));
  const comps = (files) => new Set(files.map((f) => componentOf(f, rules)).filter(Boolean));
  const rows = [];
  for (const t of graph.tickets.filter((x) => x.analyses.length)) {
    const changes = t.changes.map((id) => commits.get(id)).filter(Boolean).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const firstChange = changes[0]?.date ?? null;
    const before = firstChange ? t.analyses.filter((a) => Date.parse(a.at) < Date.parse(firstChange)) : t.analyses;
    const row = { key: t.key, runs: t.analyses.length, costUsd: sum(t.analyses.map((a) => a.costUsd)), ownChange: changes.length > 0 };
    if (!before.length) {
      rows.push({ ...row, skipped: 'analysed only after its change was on main (not a prediction)' });
      continue;
    }
    const a = before.at(-1);
    Object.assign(row, { at: a.at, confidence: a.confidence, model: a.model ?? null, owner: a.owner, priorArt: a.priorArt?.kind ?? 'none' });
    row.priorArtOutcome = t.exists === false && !changes.length ? 'pending' : priorArtOutcome(row.priorArt, { ownChange: changes.length > 0, resolved: t.resolved, resolution: t.resolution, links: t.links });
    if (changes.length) {
      const predicted = codeFiles(a.files, docsPath);
      const actual = codeFiles(changes.flatMap((c) => c.files), docsPath);
      row.fixer = changes.every((c) => c.agent) ? 'agent' : 'person';
      row.change = changes.map((c) => c.short);
      if (predicted.length && actual.length) {
        row.files = { predicted, actual, ...compareFiles(predicted, actual) };
        const [pc, ac] = [comps(predicted), comps(actual)];
        row.componentHit = pc.size && ac.size ? [...pc].some((c) => ac.has(c)) : null;
        row.component = [...ac][0] ?? null;
      } else {
        row.files = null;
        row.unmeasured = predicted.length ? 'the change touched only tests or documentation' : 'the analysis named no code file';
      }
      if (row.fixer === 'person') {
        const people = [...changes.filter((c) => !c.agent).map((c) => c.author), ...(t.resolved && t.assignee ? [t.assignee] : [])];
        row.actualOwners = [...new Set(people)];
        row.ownerHit = !a.owner || NOT_A_PERSON.test(a.owner) ? null : people.some((p) => personKey(p) === personKey(a.owner));
        if (row.ownerHit === null) row.ownerNote = 'no owner proposed';
      }
    }
    rows.push(row);
  }
  return rows;
}

const OUTCOMES = ['merged-unchanged', 'merged-changed', 'rejected', 'withdrawn', 'open'];
function outcomes(prs) {
  const c = Object.fromEntries(OUTCOMES.map((o) => [o, 0]));
  for (const p of prs) c[p.outcome] = (c[p.outcome] ?? 0) + 1;
  const decided = c['merged-unchanged'] + c['merged-changed'] + c.rejected;
  // Rejected = closed unmerged by a person; the last comment says why (replaced, duplicate, wrong), for a person to read.
  const closed = prs.filter((p) => p.outcome === 'rejected').map((p) => ({ number: p.number, url: p.url, keys: p.keys, reason: p.reason }));
  return { prs: prs.length, ...c, acceptedUnchanged: rate(c['merged-unchanged'], decided), accepted: rate(c['merged-unchanged'] + c['merged-changed'], decided), closed };
}

/** A review agrees with what happened: "looks good" and merged unchanged, or "needs changes" and changed or rejected. */
export function reviewAgreement(verdict, outcome) {
  if (outcome === 'open' || outcome === 'withdrawn' || !outcome) return 'pending';
  const good = /looks-good|approve/i.test(verdict ?? '');
  const clean = outcome === 'merged-unchanged';
  return good === clean ? 'agree' : 'disagree';
}

/**
 * The blame origin of each fixed bug (Insights → where bugs come from, G2): ticket → the full hash of the commit that
 * wrote most of the lines its fix changed. Read from the Insights cache (<state>/insights/origins.json); empty until
 * Insights has run.
 */
export function readBlameOrigins(stateDir) {
  try {
    const cache = JSON.parse(readFileSync(join(stateDir, 'insights', 'origins.json'), 'utf8'));
    return new Map(Object.entries(cache).map(([key, v]) => [key, pickOrigin(v.tally ?? {})?.hash ?? null]).filter(([, h]) => h));
  } catch {
    return new Map();
  }
}

/**
 * Bisect (A2): runs, what they found, time per run, and whether the commit found agrees with the blame origin of the
 * bug once a fix is on main. `origins`: readBlameOrigins().
 */
export function scoreBisects(graph, origins = new Map()) {
  const runs = graph.tickets.flatMap((t) => (t.bisects ?? []).map((b) => ({ key: t.key, ...b })));
  const count = (s) => runs.filter((r) => r.status === s).length;
  // The last run per ticket that named one commit, compared with that ticket's blame origin.
  const last = new Map(runs.filter((r) => r.status === 'found' && r.culprit).map((r) => [r.key, r]));
  const compared = [...last.values()].filter((r) => origins.has(r.key)).map((r) => ({ key: r.key, culprit: r.culprit, origin: origins.get(r.key).slice(0, 7), agree: origins.get(r.key).startsWith(r.culprit) }));
  return {
    runs: runs.length,
    found: count('found'),
    range: count('range') + count('timeout'),
    older: count('older'),
    noGoodPoint: count('no-good-point'),
    errors: count('error'),
    avgSeconds: avg(runs.map((r) => r.durationMs).filter((x) => x != null && x > 0).map((ms) => ms / 1000)),
    avgSteps: avg(runs.filter((r) => r.steps).map((r) => r.steps)),
    agreeWithBlame: rate(compared.filter((c) => c.agree).length, compared.length),
    compared,
  };
}

/**
 * The accuracy of one project. Every number says what it is out of; `notes` say what could not be measured and why.
 * @param {object} graph   buildGraph()/loadGraph()
 * @param {{ rules?: object[] }} [o]  insights.components of the project (for the component check)
 */
export function scoreAccuracy(graph, { rules = [], replays = [], origins = new Map(), now = new Date() } = {}) {
  const rows = analysisRows(graph, { rules });
  const predictions = rows.filter((r) => !r.skipped);
  const withFiles = predictions.filter((r) => r.files);
  const split = (fixer) => {
    const rs = withFiles.filter((r) => r.fixer === fixer);
    return { hit: rate(rs.filter((r) => r.files.hit).length, rs.length), precision: avg(rs.map((r) => r.files.precision).filter((x) => x != null)), recall: avg(rs.map((r) => r.files.recall).filter((x) => x != null)) };
  };
  const owners = predictions.filter((r) => r.fixer === 'person' && r.ownerHit != null);
  const prior = predictions.filter((r) => r.priorArtOutcome !== 'pending');
  const compRows = withFiles.filter((r) => r.componentHit != null);
  const byConfidence = Object.fromEntries(CONFIDENCE.map((c) => {
    const rs = withFiles.filter((r) => r.confidence === c);
    return [c, rate(rs.filter((r) => r.files.hit).length, rs.length)];
  }));
  const byModel = {};
  for (const t of graph.tickets) for (const a of t.analyses) {
    const m = a.model ?? 'not recorded';
    byModel[m] ??= { runs: 0, costUsd: 0 };
    byModel[m].runs += 1;
    byModel[m].costUsd += a.costUsd ?? 0;
  }
  const byComponent = {};
  for (const r of withFiles) {
    const c = r.component ?? '(other)';
    byComponent[c] ??= { measured: 0, hit: 0 };
    byComponent[c].measured += 1;
    byComponent[c].hit += r.files.hit ? 1 : 0;
  }

  const agentPrs = graph.prs.filter((p) => p.agent);
  // Fix PRs of the agent's own runs only: a PR planted by hand to test the reviewer is not a fix it proposed.
  const fixPrs = agentPrs.filter((p) => p.kind === 'fix' && p.run);
  const prByNumber = new Map(graph.prs.map((p) => [p.number, p]));
  const reviews = graph.tickets.flatMap((t) => t.reviews.map((r) => ({ key: t.key, ...r, outcome: prByNumber.get(r.pr)?.outcome ?? null })));
  const reviewRows = reviews.map((r) => ({ ...r, agreement: reviewAgreement(r.verdict, r.outcome) }));
  const decidedReviews = reviewRows.filter((r) => r.agreement !== 'pending');
  const attempts = graph.tickets.flatMap((t) => t.fixAttempts);
  const analyses = graph.tickets.flatMap((t) => t.analyses);

  const notes = [];
  const person = withFiles.filter((r) => r.fixer === 'person').length;
  const agentFixed = withFiles.filter((r) => r.fixer === 'agent').length;
  if (!person) notes.push(`No analysed ticket was changed by a person yet${agentFixed ? ` (${agentFixed} were fixed by the agent itself, shown apart: the agent fixing what it analysed does not test the analysis)` : ''}. ${replays.length ? `The replay on resolved history (AI1b) gives ${replays.length} independent case(s): see "replay".` : 'The replay on resolved history (AI1b, agent/replay.mjs) gives independent cases.'}`);
  const skipped = rows.filter((r) => r.skipped).length;
  if (skipped) notes.push(`${skipped} ticket(s) were analysed only after their change was on main: not counted.`);
  const withdrawn = fixPrs.filter((p) => p.outcome === 'withdrawn').length;
  if (withdrawn) notes.push(`${withdrawn} fix PR(s) were closed by the demo reset (withdrawn): not a review decision, not counted.`);
  if (!analyses.some((a) => a.model)) notes.push('The model of each analysis is recorded from 2026-11-13 on; earlier runs show as "not recorded".');
  for (const w of graph.warnings ?? []) notes.push(w);

  return {
    project: graph.project,
    vcs: graph.vcs,
    at: now.toISOString(),
    analysis: {
      runs: analyses.length,
      tickets: rows.length,
      predictions: predictions.length,
      changed: predictions.filter((r) => r.ownChange).length,
      filesVsPerson: split('person'),
      filesVsAgent: split('agent'),
      component: rate(compRows.filter((r) => r.componentHit).length, compRows.length),
      owner: rate(owners.filter((r) => r.ownerHit).length, owners.length),
      priorArt: rate(prior.filter((r) => r.priorArtOutcome === 'right').length, prior.length),
      byConfidence,
      byComponent,
      byModel,
      costUsd: sum(analyses.map((a) => a.costUsd)),
      avgCostUsd: avg(analyses.map((a) => a.costUsd).filter((x) => x != null)),
      avgSeconds: avg(analyses.map((a) => a.durationMs).filter((x) => x != null).map((ms) => ms / 1000)),
    },
    // tried = a reproduction was attempted (a draft PR or a stop); skipped = the rules said no automatic fix.
    fix: { tried: attempts.filter((a) => a.outcome !== 'skipped').length, pr: attempts.filter((a) => a.outcome === 'pr').length, failed: attempts.filter((a) => a.outcome === 'failed').length, skipped: attempts.filter((a) => a.outcome === 'skipped').length, ...outcomes(fixPrs) },
    review: { reviews: reviewRows.length, agreement: rate(decidedReviews.filter((r) => r.agreement === 'agree').length, decidedReviews.length), costUsd: sum(reviewRows.map((r) => r.costUsd)) },
    docs: outcomes(agentPrs.filter((p) => p.kind === 'docs')),
    bisect: scoreBisects(graph, origins),
    replay: replays.length ? summarizeReplays(replays) : null,
    rows,
    reviews: reviewRows,
    notes,
  };
}

/**
 * The replay on resolved history (AI1b, lib/replay.mjs): each row is an analysis run again on the code before a
 * person's fix, with Jira as it was, compared with that fix. Independent of the agent's own fixes.
 */
export function summarizeReplays(rows) {
  const withFiles = rows.filter((r) => r.files?.predicted?.length && r.files?.actual?.length);
  const owners = rows.filter((r) => r.ownerHit != null);
  const comps = rows.filter((r) => r.componentHit != null);
  const byConfidence = Object.fromEntries(CONFIDENCE.map((c) => {
    const rs = withFiles.filter((r) => r.confidence === c);
    return [c, rate(rs.filter((r) => r.files.hit).length, rs.length)];
  }));
  return {
    tickets: rows.length,
    files: rate(withFiles.filter((r) => r.files.hit).length, withFiles.length),
    precision: avg(withFiles.map((r) => r.files.precision).filter((x) => x != null)),
    recall: avg(withFiles.map((r) => r.files.recall).filter((x) => x != null)),
    component: rate(comps.filter((r) => r.componentHit).length, comps.length),
    owner: rate(owners.filter((r) => r.ownerHit).length, owners.length),
    priorArt: rate(rows.filter((r) => r.priorArtOutcome === 'right').length, rows.length),
    byConfidence,
    costUsd: sum(rows.map((r) => r.meta?.costUsd)),
    avgSeconds: avg(rows.map((r) => r.meta?.durationMs).filter((x) => x != null).map((ms) => ms / 1000)),
  };
}

/** The numbers kept once a day for the trend (snapshot), from scoreAccuracy(). */
export function snapshotOf(acc) {
  const r = (x) => (x?.of ? { n: x.n, of: x.of } : null);
  return {
    day: acc.at.slice(0, 10),
    analyses: acc.analysis.runs,
    filesVsPerson: r(acc.analysis.filesVsPerson.hit),
    filesVsAgent: r(acc.analysis.filesVsAgent.hit),
    component: r(acc.analysis.component),
    owner: r(acc.analysis.owner),
    priorArt: r(acc.analysis.priorArt),
    fixAcceptedUnchanged: r(acc.fix.acceptedUnchanged),
    reviewAgreement: r(acc.review.agreement),
    docsAcceptedUnchanged: r(acc.docs.acceptedUnchanged),
    bisectAgreeWithBlame: r(acc.bisect?.agreeWithBlame),
    replayFiles: r(acc.replay?.files),
    replayOwner: r(acc.replay?.owner),
    costUsd: Math.round((acc.analysis.costUsd + acc.review.costUsd) * 100) / 100,
  };
}

/** Keeps one snapshot a day in <stateDir>/accuracy/snapshots.json (today's is replaced); returns them, oldest first. */
export function recordAccuracy(stateDir, acc, keepDays = 400) {
  const dir = join(stateDir, 'accuracy');
  const file = join(dir, 'snapshots.json');
  let list = [];
  try {
    list = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    /* first snapshot */
  }
  const snap = snapshotOf(acc);
  list = [...list.filter((s) => s.day !== snap.day), snap].sort((a, b) => a.day.localeCompare(b.day)).slice(-keepDays);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(list, null, 2));
  return list;
}
