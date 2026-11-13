// Impact (WF5 of docs/AUTONOMY_AND_NEXT.md, ROADMAP #2): the management week. For the whole suite, week by week, it
// shows what the agent did, what it cost, how much time it saved against the team's own estimates, and what waits
// for a person. It reads the projects' graphs (lib/git-graph.mjs) and is plain code.
//
// Time saved is an estimate and the page says so. For each step, agent.config.json "baseline" (minutes the team
// needs without the agent) minus the measured time, never below 0, counted only for work a person can use:
//   - the first analysis of a ticket in the week          baseline.analysisMinutes
//   - a fix PR of the agent merged that week               baseline.reproduceMinutes + baseline.fixMinutes
//   - each ticket in a documentation PR merged that week   baseline.docsMinutes
// A fix or documentation PR that was closed or is still open saves nothing (yet).

const DAY = 86_400_000;
export const DEFAULT_BASELINE = { analysisMinutes: 45, reproduceMinutes: 60, fixMinutes: 180, docsMinutes: 30 };

/** Monday (UTC) of the week of a date, as YYYY-MM-DD. */
export function weekOf(iso) {
  const d = new Date(iso);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back)).toISOString().slice(0, 10);
}

const lastWeeks = (now, n) => Array.from({ length: n }, (_, i) => weekOf(new Date(now.getTime() - (n - 1 - i) * 7 * DAY).toISOString()));
const minutes = (ms) => ms / 60_000;
const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
const empty = (week) => ({ week, analysed: 0, runs: 0, known: 0, fixPrs: 0, fixMerged: 0, fixStopped: 0, reviews: 0, docsMerged: 0, costUsd: 0, saved: { analysis: 0, fix: 0, docs: 0 }, analysisMin: [], toPrMin: [] });

/**
 * @param {{ project: string, name?: string, graph: object, accuracy?: object }[]} apps   one per project
 * @param {{ baseline?: object, weeks?: number, now?: Date }} [o]
 */
export function impactOf(apps, { baseline = DEFAULT_BASELINE, weeks = 8, now = new Date() } = {}) {
  const b = { ...DEFAULT_BASELINE, ...baseline };
  const order = lastWeeks(now, weeks);
  const byWeek = new Map(order.map((w) => [w, empty(w)]));
  const perProject = [];
  let costNotRecorded = 0;

  for (const app of apps) {
    const p = { project: app.project, name: app.name ?? app.project, ...empty(null), waitingFix: 0, waitingDocs: 0 };
    const add = (at, fn) => {
      const w = byWeek.get(weekOf(at));
      if (!w) return; // outside the window
      fn(w);
      fn(p);
    };
    for (const t of app.graph.tickets) {
      // First analysis of the ticket in each week (re-runs of the same ticket do not save the team time again).
      const firstInWeek = new Map();
      for (const a of t.analyses) if (!firstInWeek.has(weekOf(a.at))) firstInWeek.set(weekOf(a.at), a);
      for (const a of t.analyses) {
        add(a.at, (x) => { x.runs += 1; x.costUsd += a.costUsd ?? 0; });
      }
      for (const a of firstInWeek.values()) {
        add(a.at, (x) => {
          x.analysed += 1;
          if (a.priorArt?.kind && a.priorArt.kind !== 'none') x.known += 1;
          if (a.durationMs != null) x.analysisMin.push(minutes(a.durationMs));
          x.saved.analysis += Math.max(0, b.analysisMinutes - minutes(a.durationMs ?? 0));
        });
      }
      for (const f of t.fixAttempts) {
        if (f.outcome === 'pr') add(f.at, (x) => { x.fixPrs += 1; x.costUsd += f.costUsd ?? 0; });
        if (f.outcome === 'pr' && f.costUsd == null) costNotRecorded += 1;
        if (f.outcome === 'failed') add(f.at, (x) => { x.fixStopped += 1; x.costUsd += f.costUsd ?? 0; });
      }
      for (const r of t.reviews) add(r.at, (x) => { x.reviews += 1; x.costUsd += r.costUsd ?? 0; });
      for (const d of t.documented) add(d.at, (x) => { x.costUsd += d.costUsd ?? 0; });
      // Time from the analysis to the draft PR: the agent's reproduce + fix + verify.
      const steps = t.steps;
      for (const s of steps.filter((x) => x.type === 'pr')) {
        const analysed = steps.filter((x) => x.type === 'analyzed' && Date.parse(x.at) <= Date.parse(s.at)).at(-1);
        if (analysed) add(s.at, (x) => x.toPrMin.push(minutes(Date.parse(s.at) - Date.parse(analysed.at))));
      }
    }
    for (const pr of app.graph.prs.filter((x) => x.agent)) {
      if (pr.outcome === 'open') {
        if (pr.kind === 'fix' && pr.run) p.waitingFix += 1;
        if (pr.kind === 'docs') p.waitingDocs += 1;
      }
      if (!pr.mergedAt) continue;
      if (pr.kind === 'fix' && pr.run) {
        // The fix's own time: from its analysis to the PR (the steps above), else nothing to subtract.
        const t = app.graph.tickets.find((x) => x.prs.includes(pr.number));
        const prStep = t?.steps.find((s) => s.type === 'pr' && String(s.url ?? '').endsWith(`/pull/${pr.number}`));
        const analysed = prStep ? t.steps.filter((s) => s.type === 'analyzed' && Date.parse(s.at) <= Date.parse(prStep.at)).at(-1) : null;
        const took = prStep && analysed ? minutes(Date.parse(prStep.at) - Date.parse(analysed.at)) : 0;
        add(pr.mergedAt, (x) => { x.fixMerged += 1; x.saved.fix += Math.max(0, b.reproduceMinutes + b.fixMinutes - took); });
      }
      if (pr.kind === 'docs') add(pr.mergedAt, (x) => { x.docsMerged += pr.keys.length; x.saved.docs += b.docsMinutes * pr.keys.length; });
    }
    perProject.push(p);
  }

  const finish = (x) => {
    const savedMin = x.saved.analysis + x.saved.fix + x.saved.docs;
    const { analysisMin, toPrMin, ...rest } = x;
    return {
      ...rest,
      costUsd: round(x.costUsd, 2),
      hoursSaved: round(savedMin / 60),
      savedHours: { analysis: round(x.saved.analysis / 60), fix: round(x.saved.fix / 60), docs: round(x.saved.docs / 60) },
      costPerTicket: x.analysed ? round(x.costUsd / x.analysed, 2) : null,
      avgAnalysisMin: analysisMin.length ? round(analysisMin.reduce((s, v) => s + v, 0) / analysisMin.length) : null,
      avgToPrMin: toPrMin.length ? round(toPrMin.reduce((s, v) => s + v, 0) / toPrMin.length) : null,
    };
  };
  const raw = order.map((w) => byWeek.get(w));
  const total = finish(raw.reduce((acc, w) => {
    for (const k of ['analysed', 'runs', 'known', 'fixPrs', 'fixMerged', 'fixStopped', 'reviews', 'docsMerged', 'costUsd']) acc[k] += w[k];
    for (const k of ['analysis', 'fix', 'docs']) acc.saved[k] += w.saved[k];
    acc.analysisMin.push(...w.analysisMin);
    acc.toPrMin.push(...w.toPrMin);
    return acc;
  }, empty(null)));
  const weekRows = raw.map(finish);

  const notes = [
    `Hours saved are estimates: the team's minutes per step without the agent (analysis ${b.analysisMinutes}, reproduce ${b.reproduceMinutes}, fix ${b.fixMinutes}, documentation ${b.docsMinutes}; agent.config.json "baseline") minus the measured time. They count a ticket's first analysis in a week, fixes merged and documentation merged. They leave out the time people spent reviewing.`,
  ];
  if (costNotRecorded) notes.push(`${costNotRecorded} fix PR(s) from before 2026-11-13 have no recorded cost (only analyses and reviews did then): the cost of those weeks is too low.`);
  return {
    weeks: weekRows,
    total,
    perProject: perProject.map((p) => {
      const { week: _w, waitingFix, waitingDocs, ...rest } = finish(p);
      return { ...rest, waiting: { fixPrs: waitingFix, docsPrs: waitingDocs } };
    }),
    accuracy: apps.map((a) => ({ project: a.project, name: a.name ?? a.project, fixAcceptedUnchanged: a.accuracy?.fix?.acceptedUnchanged ?? null, reviewAgreement: a.accuracy?.review?.agreement ?? null, replayFiles: a.accuracy?.replay?.files ?? null, replayOwner: a.accuracy?.replay?.owner ?? null })),
    baseline: b,
    notes,
  };
}
