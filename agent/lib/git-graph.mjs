// One model of a project's history (GG0 of docs/GIT_GRAPH.md): the commits of the shared line (git or SVN, read through
// the analyze-ticket skill's VCS adapters), the tickets they name, the pull requests (GitHub, through gh) and every
// step of the agent from its event log, joined per ticket. Plain code, no AI. Read by the accuracy (AI1,
// lib/accuracy.mjs) and the views of the graph (G1).
//
// buildGraph() is pure (tested with fixtures); loadGraph() collects the inputs. A source that cannot be read is a
// warning in the result, never an empty answer that looks like "nothing happened".

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { openRepo } from '../../.claude/skills/analyze-ticket/scripts/lib/vcs/index.mjs';
import { normalizePriorArt } from './analyze.mjs';

const DAY = 86_400_000;

/**
 * The agent's own identity: its commits, and the squash merges of its pull requests (credited to the person who clicked
 * Merge, with the agent as co-author). Narrower than the analysis' rule (code.mjs), which also leaves out a person's
 * commit written with Claude or Copilot: for the outcome of the agent's work, such a commit is the person's change.
 */
export const AGENT_IDENTITY = /ticket[ -]intelligence[ -]agent/i;

/** Marker comment of the demo reset on the pull requests it closes (demo/reset-demo.mjs). */
export const RESET_MARK = 'Closed by the demo reset';

const coAuthors = (body) => (String(body ?? '').match(/^co-authored-by:.*$/gim) ?? []).join('\n');
export const isAgentCommit = (c) => AGENT_IDENTITY.test(c.author ?? '') || AGENT_IDENTITY.test(coAuthors(c.body));

/** Ticket keys of the given projects in a text, each once, in order. */
export function keysIn(text, prefixes) {
  if (!prefixes.length) return [];
  const re = new RegExp(`\\b(?:${prefixes.join('|')})-\\d+\\b`, 'gi');
  return [...new Set((String(text ?? '').match(re) ?? []).map((k) => k.toUpperCase()))];
}

/** The key a commit subject starts with ("DEM-5: …", "[DEM-5] …"), or null. */
export function leadKey(subject, prefixes) {
  if (!prefixes.length) return null;
  return String(subject ?? '').match(new RegExp(`^\\[?((?:${prefixes.join('|')})-\\d+)\\b`, 'i'))?.[1].toUpperCase() ?? null;
}

/** The pull request a commit on the main line came from: a squash merge "… (#24)" or a merge "Merge pull request #24 …". */
export function prOfCommit(subject) {
  const s = String(subject ?? '');
  const n = s.match(/\(#(\d+)\)\s*$/)?.[1] ?? s.match(/^Merge pull request #(\d+)/i)?.[1];
  return n ? Number(n) : null;
}

const keyOrder = (a, b) => {
  const [pa, na] = a.split('-');
  const [pb, nb] = b.split('-');
  return pa.localeCompare(pb) || Number(na) - Number(nb);
};

/** Every event of the agent's logs (events.jsonl and the rotated events-*.jsonl), oldest first, each once. */
export function readEvents(dir) {
  if (!existsSync(dir)) return [];
  const seen = new Set();
  const out = [];
  for (const f of readdirSync(dir).filter((x) => /^events.*\.jsonl$/.test(x))) {
    for (const line of readFileSync(join(dir, f), 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue; // a line cut by a crash
      }
      const sig = `${e.at}|${e.type}|${e.key ?? ''}|${e.text ?? e.step ?? ''}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push(e);
    }
  }
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

const closedUnmerged = (prs) => prs.filter((p) => p.state === 'CLOSED' && !p.mergedAt && p.closedAt);

/**
 * Pull requests closed unmerged together (two or more within two minutes, in this repository or, through `elsewhere`,
 * in the other repositories of the suite): a bulk close such as the demo reset, not a review decision. The reset
 * closes one PR per repository when only one is open, so the suite counts. From 2026-11-13 on it also marks the PRs it
 * closes (RESET_MARK).
 * @param {number[]} [elsewhere]  closing times (ms) of the agent's unmerged PRs in the other repositories
 */
export function bulkClosed(prs, windowMs = 120_000, elsewhere = []) {
  const closed = closedUnmerged(prs).map((p) => ({ n: p.number, t: Date.parse(p.closedAt) }));
  const near = (a) => closed.some((b) => b.n !== a.n && Math.abs(b.t - a.t) <= windowMs) || elsewhere.some((t) => Math.abs(t - a.t) <= windowMs);
  return new Set(closed.filter(near).map((a) => a.n));
}

const isAgentPr = (p) => p.commits.some((c) => c.authors.some((a) => AGENT_IDENTITY.test(a)));

/** Closing times (ms) of the agent's unmerged PRs, for bulkClosed() of the other repositories. */
export const agentClosures = (prs) => closedUnmerged(prs.filter(isAgentPr)).map((p) => Date.parse(p.closedAt));

/**
 * What became of a pull request: open, merged-unchanged (every commit is the agent's), merged-changed (a person added a
 * commit), rejected (closed unmerged by a person), withdrawn (closed by the demo reset or a bulk close).
 */
export function prOutcome(pr, bulk = new Set()) {
  if (pr.mergedAt || pr.state === 'MERGED') return pr.commits.length && pr.commits.every((c) => c.authors.some((a) => AGENT_IDENTITY.test(a))) ? 'merged-unchanged' : 'merged-changed';
  if (pr.state === 'OPEN') return 'open';
  if (pr.comments.some((b) => b.includes(RESET_MARK)) || bulk.has(pr.number)) return 'withdrawn';
  return 'rejected';
}

// One page of pull requests, newest first, with the commits' authors and the last comments. `gh pr list --json commits`
// asks GitHub for up to 100 × 250 × 100 author nodes and is refused above 500,000; this query stays far below that.
const PR_QUERY = 'query($owner: String!, $name: String!, $after: String) { repository(owner: $owner, name: $name) { pullRequests(first: 50, after: $after, orderBy: {field: CREATED_AT, direction: DESC}) { pageInfo { hasNextPage endCursor } nodes { number title headRefName state createdAt mergedAt closedAt url commits(first: 40) { nodes { commit { oid messageHeadline authors(first: 4) { nodes { name } } } } } comments(last: 5) { nodes { body } } } } } }';

/** owner/name of the GitHub remote "origin", or null. */
export function githubSlug(repoDir) {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
    const m = url.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?\/?$/);
    return m ? { owner: m[1], name: m[2] } : null;
  } catch {
    return null;
  }
}

/**
 * The repository's pull requests through gh, newest first, back to `since` (at most `max`): { prs, warning }.
 * No GitHub remote or no gh: no PRs and a warning.
 */
export function readPullRequests(repoDir, { since = null, max = 500 } = {}) {
  const slug = githubSlug(repoDir);
  if (!slug) return { prs: [], warning: 'no GitHub remote: pull requests are not read, fix and documentation outcomes are not known' };
  const prs = [];
  let after = null;
  try {
    for (;;) {
      const out = execFileSync('gh', ['api', 'graphql', '-f', `query=${PR_QUERY}`, '-F', `owner=${slug.owner}`, '-F', `name=${slug.name}`, ...(after ? ['-F', `after=${after}`] : [])], {
        cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, windowsHide: true,
      });
      const page = JSON.parse(out).data.repository.pullRequests;
      for (const p of page.nodes) {
        prs.push({
          number: p.number,
          title: p.title,
          branch: p.headRefName,
          state: p.state,
          createdAt: p.createdAt ?? null,
          mergedAt: p.mergedAt ?? null,
          closedAt: p.closedAt ?? null,
          url: p.url,
          commits: (p.commits?.nodes ?? []).map(({ commit: c }) => ({ oid: String(c.oid ?? '').slice(0, 8), headline: c.messageHeadline ?? '', authors: (c.authors?.nodes ?? []).map((a) => a.name).filter(Boolean) })),
          comments: (p.comments?.nodes ?? []).map((c) => String(c.body ?? '')),
        });
      }
      const oldest = page.nodes.at(-1)?.createdAt;
      if (!page.pageInfo.hasNextPage || prs.length >= max || (since && oldest && oldest < since)) break;
      after = page.pageInfo.endCursor;
    }
    return { prs: since ? prs.filter((p) => !p.createdAt || p.createdAt >= since) : prs, warning: null };
  } catch (e) {
    return { prs: [], warning: `pull requests could not be read (${String(e.stderr || e.message).trim().split('\n')[0].slice(0, 160)}): fix and documentation outcomes are not known` };
  }
}

// The agent's steps shown on a ticket's lane, in the order they happen.
const LANE = new Set(['picked', 'analyzed', 'commented', 'notified', 'duplicate', 'prior-art', 'fix-skipped', 'reproduced', 'verified', 'pr', 'fix-proposed', 'fix-failed', 'reviewed', 'resolved', 'documented', 'doc-failed', 'docs-merged', 'failed']);

/**
 * @param {object} p
 * @param {string} p.project      Jira key of the project, e.g. "DEM"
 * @param {'git'|'svn'} p.vcsKind
 * @param {object[]} p.commits    the shared line, newest first (VCS adapter history())
 * @param {object[]} p.events     the agent's events (readEvents), all projects
 * @param {object[]} [p.prs]      pull requests (readPullRequests)
 * @param {object[]} [p.tickets]  Jira tickets of the project (jira.searchAll), [] when not read
 * @param {boolean} [p.jiraRead]  whether Jira was read (a ticket missing from it was deleted)
 */
export function buildGraph({ project, vcsKind, commits, events, prs = [], suiteClosures = [], tickets = [], jiraRead = tickets.length > 0, docsPath = 'docs/knowledge', warnings = [], now = new Date() }) {
  const prefixes = [project];
  const docsDir = `${docsPath.replace(/\/$/, '')}/`;
  const mine = (key) => typeof key === 'string' && key.toUpperCase().startsWith(`${project}-`);

  const nodes = commits.map((c) => {
    const lead = leadKey(c.subject, prefixes);
    const docsOnly = c.files.length > 0 && c.files.every((f) => f.startsWith(docsDir));
    return {
      id: c.hash,
      short: c.short ?? String(c.hash).slice(0, 8),
      date: c.date,
      author: c.author,
      agent: isAgentCommit(c),
      subject: c.subject,
      parents: c.parents ?? [],
      files: c.files,
      ticket: lead,
      kind: lead ? (docsOnly ? 'docs' : 'change') : null, // change: the ticket's code change (for a bug, its fix)
      pr: prOfCommit(c.subject),
      mentions: keysIn(`${c.subject}\n${c.body ?? ''}`, prefixes).filter((k) => k !== lead),
    };
  });
  const commitOfPr = new Map(nodes.filter((c) => c.pr).map((c) => [c.pr, c]));

  // Pull requests: the agent's (a commit of its own), and the ones named after a ticket. A fix PR is the agent's run
  // only when its events name it (a PR planted by hand for a test has the agent's commits but no run).
  const bulk = bulkClosed(prs.filter(isAgentPr), 120_000, suiteClosures);
  const openedByRun = new Set(events.filter((e) => (e.type === 'pr' || e.type === 'fix-proposed' || e.type === 'documented') && e.url).map((e) => e.url));
  const prNodes = prs.map((p) => {
    const agent = isAgentPr(p);
    const docs = /^docs\//.test(p.branch);
    const branchKey = leadKey(p.branch.replace(/^docs\//, ''), prefixes);
    const keys = docs ? [...new Set([branchKey, ...p.commits.map((c) => leadKey(c.headline, prefixes))].filter(Boolean))] : branchKey ? [branchKey] : [];
    const outcome = prOutcome(p, bulk);
    return {
      number: p.number, url: p.url, title: p.title, branch: p.branch, kind: docs ? 'docs' : 'fix', agent, run: openedByRun.has(p.url), keys, state: p.state, outcome,
      // Why a person closed it, in their words (the last comment): "rejected" covers replaced, duplicate and wrong.
      reason: outcome === 'rejected' ? (p.comments.at(-1) ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || null : null,
      createdAt: p.createdAt, mergedAt: p.mergedAt, closedAt: p.closedAt, mergedAs: commitOfPr.get(p.number)?.short ?? null,
    };
  });

  const byKey = new Map();
  const ticket = (key) => {
    if (!byKey.has(key)) byKey.set(key, { key, summary: null, type: null, status: null, resolution: null, assignee: null, resolved: null, links: [], exists: jiraRead ? false : null, changes: [], docs: [], mentions: [], prs: [], analyses: [], fixAttempts: [], reviews: [], documented: [], steps: [] });
    return byKey.get(key);
  };
  for (const t of tickets.filter((x) => mine(x.key))) {
    Object.assign(ticket(t.key), { summary: t.summary ?? null, type: t.issueType ?? null, status: t.status ?? null, resolution: t.resolution ?? null, assignee: t.assignee ?? null, resolved: t.resolved ?? null, links: t.links ?? [], exists: true });
  }
  // Oldest first, so a ticket's changes and steps are in the order they happened.
  for (const c of [...nodes].reverse()) {
    if (c.ticket && mine(c.ticket)) {
      const t = ticket(c.ticket);
      (c.kind === 'docs' ? t.docs : t.changes).push(c.id);
      t.steps.push({ at: c.date, type: c.kind === 'docs' ? 'docs-commit' : 'commit', text: c.subject, ref: c.short, agent: c.agent });
    }
    for (const k of c.mentions.filter(mine)) ticket(k).mentions.push(c.id);
  }
  for (const p of prNodes) {
    for (const k of p.keys.filter(mine)) {
      const t = ticket(k);
      t.prs.push(p.number);
      if (p.mergedAt) t.steps.push({ at: p.mergedAt, type: 'pr-merged', text: `${p.kind} PR #${p.number} merged${p.outcome === 'merged-changed' ? ' with a person\'s changes' : ''}`, url: p.url });
      else if (p.closedAt) t.steps.push({ at: p.closedAt, type: 'pr-closed', text: `${p.kind} PR #${p.number} closed${p.outcome === 'withdrawn' ? ' (withdrawn)' : ''}`, url: p.url });
    }
  }

  for (const e of events) {
    if (!mine(e.key)) continue;
    const t = ticket(e.key.toUpperCase());
    if (e.type === 'analyzed' && e.result) {
      const r = e.result;
      t.analyses.push({
        at: e.at,
        confidence: r.confidence ?? null,
        component: r.component ?? null,
        files: Array.isArray(r.files) ? r.files.map(String) : [],
        owner: r.owner?.name ?? null,
        priorArt: normalizePriorArt(r),
        fixInProject: r.fixInProject ?? null,
        costUsd: e.meta?.costUsd ?? null,
        durationMs: e.meta?.durationMs ?? null,
        model: e.meta?.model ?? null,
      });
    } else if (e.type === 'fix-proposed' || e.type === 'fix-failed' || e.type === 'fix-skipped') {
      t.fixAttempts.push({ at: e.at, outcome: { 'fix-proposed': 'pr', 'fix-failed': 'failed', 'fix-skipped': 'skipped' }[e.type], text: e.text ?? '', url: e.url ?? null, costUsd: e.meta?.costUsd ?? null });
    } else if (e.type === 'reviewed' && e.review) {
      t.reviews.push({ at: e.at, risk: e.review.risk ?? null, verdict: e.review.verdict ?? null, findings: (e.review.findings ?? []).length, pr: Number(String(e.url ?? '').match(/\/pull\/(\d+)/)?.[1]) || null, costUsd: e.meta?.costUsd ?? null });
    } else if (e.type === 'documented') {
      t.documented.push({ at: e.at, url: e.url ?? null, costUsd: e.meta?.costUsd ?? null });
    }
    if (LANE.has(e.type)) t.steps.push({ at: e.at, type: e.type, text: String(e.text ?? '').slice(0, 200), url: e.url ?? null });
  }
  for (const t of byKey.values()) t.steps.sort((a, b) => String(a.at).localeCompare(String(b.at)));

  return {
    project,
    vcs: vcsKind,
    builtAt: now.toISOString(),
    head: nodes[0]?.short ?? null,
    commits: nodes,
    prs: prNodes,
    tickets: [...byKey.values()].sort((a, b) => keyOrder(a.key, b.key)),
    warnings,
  };
}

/** The graph as typed edges, for views and queries: commit→ticket, ticket→pr, pr→commit, commit→file. */
export function graphEdges(graph) {
  const edges = [];
  for (const c of graph.commits) {
    if (c.ticket) edges.push({ from: `commit:${c.short}`, to: `ticket:${c.ticket}`, kind: c.kind === 'docs' ? 'documents' : 'changes' });
    for (const k of c.mentions) edges.push({ from: `commit:${c.short}`, to: `ticket:${k}`, kind: 'mentions' });
    for (const f of c.files) edges.push({ from: `commit:${c.short}`, to: `file:${f}`, kind: 'touches' });
  }
  for (const p of graph.prs) {
    for (const k of p.keys) edges.push({ from: `ticket:${k}`, to: `pr:${p.number}`, kind: p.kind === 'docs' ? 'documented-in' : 'fixed-in' });
    if (p.mergedAs) edges.push({ from: `pr:${p.number}`, to: `commit:${p.mergedAs}`, kind: 'merged-as' });
  }
  return edges;
}

/**
 * Collects the inputs and builds the graph of one project (agent/lib/projects.mjs Project).
 * @param {object} p.project     the project (repoDir, key, cfg)
 * @param {string} p.eventsDir   the watcher's state folder (agent/state), where the event logs are
 * @param {object} [p.jira]      createJira(); without it the tickets' Jira state is not known
 */
/**
 * Pull requests of every git project of the suite, read once: Map key → { prs, warning }. A project's graph needs the
 * others' closing times to recognise a reset that closed one PR in each repository.
 */
export function readSuitePullRequests(projects, { sinceDays = 365, now = new Date() } = {}) {
  const since = new Date(now.getTime() - sinceDays * DAY).toISOString();
  const out = new Map();
  for (const p of projects) {
    if (existsSync(join(p.repoDir, '.git'))) out.set(p.key, readPullRequests(p.repoDir, { since }));
  }
  return out;
}

/** Closing times of the agent's unmerged PRs in every project but `key` (readSuitePullRequests). */
export const otherClosures = (suitePrs, key) => [...suitePrs].filter(([k]) => k !== key).flatMap(([, r]) => agentClosures(r.prs));

/**
 * @param {Map} [p.suitePrs]  readSuitePullRequests() of the suite; without it the project's PRs are read here and a
 *   reset is recognised within this repository only
 */
export async function loadGraph({ project, eventsDir, jira = null, sinceDays = 365, suitePrs = null, now = new Date() }) {
  const warnings = [];
  const vcs = openRepo(project.repoDir);
  if (!vcs) throw new Error(`${project.repoDir} is not a git or SVN repository`);
  if (vcs.kind === 'git') {
    try {
      execFileSync('git', ['fetch', '-q', 'origin'], { cwd: vcs.root, stdio: 'ignore', windowsHide: true });
    } catch {
      warnings.push('git fetch failed: the history may be out of date');
    }
  }
  const since = new Date(now.getTime() - sinceDays * DAY).toISOString();
  const commits = vcs.history({ since });
  let prs = [];
  if (vcs.kind === 'git') {
    const r = suitePrs?.get(project.key) ?? readPullRequests(vcs.root, { since });
    prs = r.prs;
    if (r.warning) warnings.push(r.warning);
  }
  const suiteClosures = suitePrs ? otherClosures(suitePrs, project.key) : [];
  let tickets = [];
  let jiraRead = false;
  if (jira) {
    try {
      tickets = await jira.searchAll(`project = ${project.key} ORDER BY key ASC`, 2000);
      jiraRead = true;
    } catch (e) {
      warnings.push(`Jira could not be read (${e.message}): status, assignee and resolution of the tickets are not known`);
    }
  } else {
    warnings.push('Jira was not read: status, assignee and resolution of the tickets are not known');
  }
  return buildGraph({ project: project.key, vcsKind: vcs.kind, commits, events: readEvents(eventsDir), prs, suiteClosures, tickets, jiraRead, docsPath: project.cfg?.docsPath ?? 'docs/knowledge', warnings, now });
}
