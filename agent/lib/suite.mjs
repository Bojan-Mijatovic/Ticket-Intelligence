// The whole suite on one page (Insights, phase F): every app's headline numbers and trend, how the apps call each
// other, bugs linked across apps, causes the agent found in another app, and code that several apps share.
// Plain code over the per-project insights; nothing new is read from git or Jira here.

import { savedAnalyses } from './insights.mjs';

const avg = (xs) => (xs.length ? Math.round((xs.reduce((n, x) => n + x, 0) / xs.length) * 10) / 10 : null);

/** One row per app: the numbers to compare the apps by, and the bugs per month for a sparkline. */
function appRow({ project, data, review }) {
  const scores = review?.evaluation?.scores ?? [];
  return {
    key: project.key,
    name: project.name,
    bugs: data.totals.bugs,
    openBugs: data.totals.openBugs,
    priorityBugs: data.totals.priorityBugs,
    openPriorityBugs: data.totals.openPriorityBugs,
    tickets: data.totals.tickets,
    commits: data.totals.commits,
    recurring: data.recurring.length,
    topHotspot: data.hotspots[0] ?? null,
    unit: data.testCoverage.backend,
    screens: data.testCoverage.screens,
    medianDaysInCode: data.origins?.medianDaysInCode ?? null,
    fromFixes: data.origins?.fromFixes?.length ?? 0,
    busFactorOne: data.components.filter((c) => c.busFactor === 1 && c.tickets).map((c) => c.name),
    toCheck: data.shared?.toCheck ?? 0,
    review: review ? { at: review.at, score: avg(scores.map((s) => s.score)), stale: Boolean(review.stale) } : null,
    suggestions: data.suggestions?.filter((s) => !s.created).length ?? 0,
    bugsPerMonth: (data.trend ?? []).map((m) => ({ month: m.month, bugs: m.bugs })),
    delta: data.snapshotDelta ?? null,
  };
}

/** Groups the shared-file pairs of all apps into sets of copies of one file (connected through any pair). */
export function sharedGroups(perProject) {
  const parent = new Map();
  const find = (x) => {
    while (parent.get(x) !== x) x = parent.get(x);
    return x;
  };
  const node = (k) => (parent.has(k) || parent.set(k, k), k);
  const union = (a, b) => parent.set(find(node(a)), find(node(b)));
  const facts = new Map(); // node → { project, path, bugs: Set, checks: Set }
  const fact = (project, path) => {
    const k = `${project}:${path}`;
    if (!facts.has(k)) facts.set(k, { project, path, bugs: new Set(), checks: new Set() });
    return facts.get(k);
  };
  const identical = new Set();
  for (const { key, shared } of perProject) {
    for (const p of shared?.pairs ?? []) {
      const a = `${key}:${p.path}`;
      const b = `${p.peer}:${p.peerPath}`;
      union(a, b);
      const here = fact(key, p.path);
      const there = fact(p.peer, p.peerPath);
      p.bugsHere.forEach((k) => here.bugs.add(k));
      p.bugsThere.forEach((k) => there.bugs.add(k));
      p.checkHere.forEach((k) => here.checks.add(k));
      if (p.identical) identical.add([a, b].sort().join('|'));
    }
  }
  const groups = new Map();
  for (const k of facts.keys()) {
    const root = find(node(k));
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(k);
  }
  return [...groups.values()]
    .map((members) => {
      const copies = members.map((k) => facts.get(k)).map((f) => ({ project: f.project, path: f.path, bugs: [...f.bugs], checks: [...f.checks] }))
        .sort((a, b) => a.project.localeCompare(b.project));
      const pairs = members.length * (members.length - 1) / 2;
      const same = [...identical].filter((id) => id.split('|').every((x) => members.includes(x))).length;
      return {
        name: copies[0].path.split('/').pop(),
        copies,
        apps: copies.length,
        allIdentical: pairs > 0 && same === pairs,
        bugs: [...new Set(copies.flatMap((c) => c.bugs))],
        checks: copies.flatMap((c) => c.checks.map((k) => ({ project: c.project, key: k }))),
      };
    })
    .sort((a, b) => b.checks.length - a.checks.length || b.bugs.length - a.bugs.length || b.apps - a.apps || a.name.localeCompare(b.name));
}

/**
 * @param {{ project: object, data: object, review: object|null }[]} apps  per project: its Project (projects.mjs), its
 *   insights and its cached app review
 */
export function suiteInsights(apps) {
  const keyOf = (ticket) => String(ticket).split('-')[0];
  const names = Object.fromEntries(apps.map((a) => [a.project.key, a.project.name]));

  // Bugs linked across apps (Jira links), each pair once.
  const seen = new Set();
  const crossLinks = [];
  for (const { project, data } of apps) {
    for (const r of data.recurring.filter((x) => x.crossProject)) {
      const id = [r.key, r.of].sort().join('|');
      if (seen.has(id)) continue;
      seen.add(id);
      const other = data.tickets.find((t) => t.key === r.key);
      crossLinks.push({ key: r.key, project: project.key, component: r.component, priority: r.priority, summary: other?.summary ?? null, of: r.of, ofProject: keyOf(r.of) });
    }
  }

  // Causes the agent's analyses found in another app (otherProjects), and fixes that belong in another app.
  const causes = [];
  for (const { project } of apps) {
    for (const [key, { result, at }] of savedAnalyses(project.stateDir)) {
      for (const o of result.otherProjects ?? []) {
        if (!o?.key || o.key === project.key) continue;
        causes.push({ key, project: project.key, in: String(o.key).toUpperCase(), evidence: o.evidence ?? '', why: o.why ?? '', fixIn: result.fixInProject ?? project.key, at });
      }
    }
  }

  // How the apps call each other (agent.config.json linked + relations), with the bugs and causes across each edge.
  const across = (a, b) => crossLinks.filter((l) => (l.project === a && l.ofProject === b) || (l.project === b && l.ofProject === a)).length;
  const integrations = apps.flatMap(({ project }) => project.linked.map((to) => ({
    from: project.key, to, uses: project.cfg.relations?.[to] ?? '',
    linkedBugs: across(project.key, to),
    causes: causes.filter((c) => c.project === project.key && c.in === to).length,
  })));

  const rows = apps.map(appRow);
  const months = apps[0]?.data.months ?? [];
  const shared = sharedGroups(apps.map((a) => ({ key: a.project.key, shared: a.data.shared })));
  return {
    generatedAt: new Date().toISOString(),
    names,
    apps: rows,
    totals: {
      apps: rows.length,
      bugs: rows.reduce((n, r) => n + r.bugs, 0),
      openBugs: rows.reduce((n, r) => n + r.openBugs, 0),
      priorityBugs: rows.reduce((n, r) => n + r.priorityBugs, 0),
      crossLinks: crossLinks.length,
      causes: causes.length,
      // Each missing fix once (both apps of a pair see it: one as "check here", the other as "check there").
      toCheck: shared.reduce((n, g) => n + g.checks.length, 0),
    },
    // Bugs per month over the whole suite (by the month of their fix, as on each app's page).
    bugsPerMonth: months.map((m) => ({ month: m, bugs: apps.reduce((n, a) => n + ((a.data.trend ?? []).find((x) => x.month === m)?.bugs ?? 0), 0) })),
    integrations,
    crossLinks,
    causes,
    shared,
  };
}
