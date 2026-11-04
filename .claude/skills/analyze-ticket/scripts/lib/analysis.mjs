// Deterministic, explainable analysis: ticket signals, related-ticket relevance, and people/expertise scoring.
// The LLM does the reasoning on top of this; every score here comes with the evidence that produced it.

import { stem, stemSet } from './text.mjs';

const DAY = 864e5;
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const lower = (s) => String(s ?? '').toLowerCase();
const sameUser = (a, b) => !!a && !!b && a.id === b.id;

function daysAgo(date, now) {
  return date ? round((now - Date.parse(date)) / DAY) : null;
}

function fieldChanges(issue, field) {
  return issue.changelog.flatMap((h) =>
    h.items.filter((i) => i.field === field).map((i) => ({ at: h.created, by: h.author?.name ?? null, from: i.from, to: i.to })),
  );
}

// ---------- ticket signals ----------

export function computeSignals(issue, cfg, now = Date.now()) {
  const done = new Set(cfg.doneStatuses.map(lower));
  const statusHistory = fieldChanges(issue, 'status');
  const lastStatus = statusHistory.at(-1);
  const fromReporter = (c) => sameUser(c.author, issue.reporter);
  const lastTeam = issue.comments.filter((c) => !fromReporter(c)).at(-1);
  const lastCustomer = issue.comments.filter(fromReporter).at(-1);
  const info = (c) => (c ? { by: c.author?.name, at: c.created, daysAgo: daysAgo(c.created, now) } : null);

  return {
    ageDays: daysAgo(issue.created, now),
    daysSinceUpdate: daysAgo(issue.updated, now),
    daysInCurrentStatus: daysAgo(lastStatus?.at ?? issue.created, now),
    commentCount: issue.comments.length,
    lastTeamResponse: info(lastTeam),
    lastCustomerMessage: info(lastCustomer),
    waitingOnTeam: !!lastCustomer && (!lastTeam || Date.parse(lastCustomer.created) > Date.parse(lastTeam.created)),
    reopenedCount: statusHistory.filter((s) => done.has(lower(s.from)) && !done.has(lower(s.to))).length,
    loggedHours: round(issue.worklogs.reduce((s, w) => s + w.seconds, 0) / 3600),
    statusHistory,
    priorityHistory: fieldChanges(issue, 'priority'),
    assigneeHistory: fieldChanges(issue, 'assignee'),
  };
}

// ---------- related tickets ----------

export function rankRelated(target, candidates, ctx) {
  const targetEnvs = new Set(ctx.envs.map(lower));
  const override = ctx.envOverride ? lower(ctx.envOverride) : null;
  const linked = new Set(target.links.map((l) => l.key));
  const kw = ctx.keywords.map((k) => ({ word: k, stem: stem(k) }));
  const seen = new Set();
  const out = [];

  for (const c of candidates) {
    if (c.key === target.key || seen.has(c.key)) continue;
    seen.add(c.key);
    const hay = stemSet(`${c.summary} ${c.description}`);
    const inSummary = stemSet(c.summary);
    const matched = kw.filter((k) => hay.has(k.stem));
    const summaryHits = kw.filter((k) => inSummary.has(k.stem)).length;
    const sameEnvironment =
      c.environments.some((e) => targetEnvs.has(lower(e))) ||
      (!!override && lower(`${c.summary} ${c.description} ${c.environments.join(' ')}`).includes(override));
    const textScore = kw.length ? (matched.length + summaryHits) / (2 * kw.length) : 0;
    // Specific terms (button / service / field names) are strong evidence even when few of them match.
    const hayText = lower(`${c.summary} ${c.description}`);
    const clues = ctx.clues ?? [];
    const clueHits = clues.filter((cl) => hayText.includes(lower(cl)));
    const clueScore = clues.length ? Math.min(1, clueHits.length / Math.min(3, clues.length)) : 0;
    const isLinked = linked.has(c.key);
    const relevance = round(Math.min(1, 0.4 * sameEnvironment + 0.5 * Math.max(textScore, clueScore) + 0.3 * isLinked + (c.resolution ? 0.1 : 0)), 2);
    if (relevance < 0.15) continue;
    out.push({ issue: c, relevance, sameEnvironment, matchedKeywords: [...matched.map((k) => k.word), ...clueHits], linked: isLinked });
  }
  return out.sort((a, b) => b.relevance - a.relevance);
}

// ---------- people / expertise ----------

// Points per activity, before weighting by ticket relevance and recency decay.
const POINTS = {
  resolved: 5, // moved the ticket to a done status / set a resolution
  assigneeAtResolution: 3, // owned it when it got resolved, but someone else clicked "resolve"
  currentAssignee: 2, // owns an open ticket
  technicalComment: 2, // comment longer than 200 chars
  comment: 1,
  commentAsReporter: 0.25, // comments on a ticket the person reported — usually the requester, not an expert
  worklogPerHour: 0.75, // capped at 8h per ticket
  statusChange: 0.5,
  otherEdit: 0.25, // capped at 1.5 per ticket per person
};

export function scorePeople(target, related, cfg, now = Date.now()) {
  const done = new Set(cfg.doneStatuses.map(lower));
  const excluded = new Set(cfg.excludeUsers.map(lower));
  const isExcluded = (u) => !u || excluded.has(lower(u.id)) || excluded.has(lower(u.name)) || sameUser(u, target.reporter);
  const decay = (d) => (d ? 0.5 ** (Math.max(0, (now - Date.parse(d)) / DAY) / cfg.halfLifeDays) : 0.5);
  const people = new Map();

  const credit = (u, entry, role, points, when, amount = 1) => {
    if (isExcluded(u) || points <= 0) return;
    if (!people.has(u.id)) people.set(u.id, { id: u.id, name: u.name, score: 0, perIssue: new Map(), lastActivity: null });
    const p = people.get(u.id);
    const pts = points * entry.weight * decay(when);
    p.score += pts;
    const { issue } = entry;
    let ev = p.perIssue.get(issue.key);
    if (!ev) {
      ev = { key: issue.key, summary: issue.summary, status: issue.status, sameEnvironment: entry.sameEnvironment, isCurrentTicket: !!entry.isTarget, roles: {}, points: 0 };
      p.perIssue.set(issue.key, ev);
    }
    ev.roles[role] = round((ev.roles[role] ?? 0) + amount);
    ev.points += pts;
    if (when && (!p.lastActivity || Date.parse(when) > Date.parse(p.lastActivity))) p.lastActivity = when;
  };

  const entries = [
    { issue: target, weight: 0.5, sameEnvironment: true, isTarget: true },
    // Squared so that work on a near-identical ticket clearly outweighs work on a loosely related one.
    ...related.map((r) => ({ issue: r.issue, weight: r.relevance ** 2, sameEnvironment: r.sameEnvironment })),
  ];

  for (const entry of entries) {
    const { issue } = entry;

    // Ownership & resolution
    let resolver = null;
    if (issue.resolution || done.has(lower(issue.status))) {
      const h = [...issue.changelog].reverse().find((h) =>
        h.items.some((i) => (i.field === 'status' && done.has(lower(i.to))) || (i.field === 'resolution' && i.to)),
      );
      resolver = h?.author ?? null;
      if (resolver) credit(resolver, entry, 'resolved', POINTS.resolved, h.created);
      if (issue.assignee && !sameUser(issue.assignee, resolver)) {
        credit(issue.assignee, entry, 'assigneeAtResolution', POINTS.assigneeAtResolution, issue.resolutionDate ?? issue.updated);
      }
    } else if (issue.assignee) {
      credit(issue.assignee, entry, 'currentAssignee', POINTS.currentAssignee, issue.updated);
    }

    // Comments
    for (const c of issue.comments) {
      if (sameUser(c.author, issue.reporter)) credit(c.author, entry, 'commentsAsReporter', POINTS.commentAsReporter, c.created);
      else if (c.body.length > 200) credit(c.author, entry, 'technicalComments', POINTS.technicalComment, c.created);
      else credit(c.author, entry, 'comments', POINTS.comment, c.created);
    }

    // Worklog (hours, capped per person per ticket)
    const hours = new Map();
    for (const w of issue.worklogs) {
      if (!w.author) continue;
      const h = hours.get(w.author.id) ?? { user: w.author, hours: 0, last: w.started };
      h.hours += w.seconds / 3600;
      if (Date.parse(w.started) > Date.parse(h.last)) h.last = w.started;
      hours.set(w.author.id, h);
    }
    for (const h of hours.values()) credit(h.user, entry, 'worklogHours', Math.min(h.hours, 8) * POINTS.worklogPerHour, h.last, h.hours);

    // Changelog (status transitions other than the resolving one; other edits capped)
    const edits = new Map();
    for (const h of issue.changelog) {
      if (!h.author) continue;
      for (const i of h.items) {
        if (i.field === 'status') {
          if (!(sameUser(h.author, resolver) && done.has(lower(i.to)))) credit(h.author, entry, 'statusChanges', POINTS.statusChange, h.created);
        } else if (i.field !== 'resolution') {
          const e = edits.get(h.author.id) ?? { user: h.author, n: 0, last: h.created };
          e.n += 1;
          e.last = h.created;
          edits.set(h.author.id, e);
        }
      }
    }
    for (const e of edits.values()) credit(e.user, entry, 'otherEdits', Math.min(e.n * POINTS.otherEdit, 1.5), e.last, e.n);
  }

  const ranked = [...people.values()].filter((p) => p.score > 0.05).sort((a, b) => b.score - a.score);
  const top = ranked[0]?.score || 1;
  return ranked.slice(0, 8).map((p) => {
    const evidence = [...p.perIssue.values()].sort((a, b) => b.points - a.points);
    return {
      name: p.name,
      id: p.id,
      score: round(p.score, 2),
      relativeScore: Math.round((100 * p.score) / top),
      isCurrentAssignee: sameUser(target.assignee, p),
      lastActivity: p.lastActivity,
      ticketsTouched: evidence.length,
      sameEnvironmentTickets: evidence.filter((e) => e.sameEnvironment).length,
      resolvedRelatedTickets: evidence.filter((e) => !e.isCurrentTicket && e.roles.resolved).map((e) => e.key),
      evidence: evidence.slice(0, 6).map((e) => ({ ...e, points: round(e.points, 2) })),
    };
  });
}
