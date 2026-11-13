// Which resolved tickets the knowledge base still lacks (K4 of docs/KNOWLEDGE_PLAN.md): a Done ticket with a fix
// commit on main (a commit whose message names the key) and no entry ("### KEY: …") in docs/knowledge on main, nor a
// documentation branch waiting (docs/<KEY>). Used by the backfill (agent/document-backfill.mjs) and by the watcher
// for tickets the agent did not analyze (policy.json documentScope: withFix).

import { execFileSync } from 'node:child_process';
import { entryKeys } from './docs-prs.mjs';

const KEY_RE = /\b[A-Z][A-Z0-9_]+-\d+\b/g;

/** key → [{ hash, date, subject }] of the commits on main whose message names the key (newest first). */
export function keyCommitsOf(log) {
  const out = new Map();
  for (const block of String(log).split('\x1e').map((b) => b.trim()).filter(Boolean)) {
    const [hash, date, subject, ...body] = block.split('\x1f');
    for (const key of new Set(`${subject}\n${body.join('\n')}`.match(KEY_RE) ?? [])) {
      if (!out.has(key)) out.set(key, []);
      out.get(key).push({ hash, date, subject });
    }
  }
  return out;
}

/** What the repository knows: fix commits per key, documented keys on main, keys with a docs/ branch waiting. */
export function repoKnowledge(repoDir, { fetch = true } = {}) {
  const git = (args) => execFileSync('git', args, { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();
  if (fetch) git(['fetch', '-q', '--prune', 'origin']);
  const keyCommits = keyCommitsOf(git(['log', 'origin/main', '--no-merges', '--date=short', '--format=%h%x1f%ad%x1f%s%x1f%b%x1e']));
  let documented = [];
  try {
    documented = entryKeys(git(['grep', '-h', '^### ', 'origin/main', '--', 'docs/knowledge']));
  } catch {
    /* nothing documented on main yet (git grep exits 1) */
  }
  const pending = git(['branch', '-r', '--format=%(refname:short)']).split('\n').map((b) => b.replace(/^origin\//, '')).filter((b) => /^docs\/[A-Z][A-Z0-9_]+-\d+$/.test(b)).map((b) => b.slice(5));
  const fixBranches = new Set(git(['branch', '-r', '--format=%(refname:short)']).split('\n').map((b) => b.replace(/^origin\//, '')).filter((b) => /^[A-Z][A-Z0-9_]+-\d+$/.test(b)));
  return { keyCommits, documented: new Set(documented), pending: new Set(pending), fixBranches };
}

/**
 * Splits Done tickets into the ones to document and the ones left out, each with the reason.
 * @param {object[]} tickets  Jira tickets ({ key, issueType, labels, summary })
 * @param {ReturnType<typeof repoKnowledge>} known
 * @param {object} o
 * @param {string} [o.since]     only tickets whose newest fix commit is on or after this date (YYYY-MM-DD)
 * @param {string[]} [o.types]   issue types to document (default Bug)
 * @param {string[]} [o.skipLabels]  e.g. no-ai, ai-documenting
 * @param {boolean} [o.includeWaiting]  also tickets with a docs/<KEY> branch (an old one, e.g. closed unmerged)
 */
export function pickCandidates(tickets, known, { since = null, types = ['Bug'], skipLabels = [], includeWaiting = false } = {}) {
  const take = [];
  const skipped = [];
  for (const t of tickets) {
    const commits = known.keyCommits.get(t.key) ?? [];
    const reason = !types.includes(t.issueType) ? `type ${t.issueType}`
      : (t.labels ?? []).some((l) => skipLabels.includes(l)) ? `label ${(t.labels ?? []).find((l) => skipLabels.includes(l))}`
      : known.documented.has(t.key) ? 'documented on main'
      : known.pending.has(t.key) && !includeWaiting ? 'documentation waiting on its docs/ branch'
      : !commits.length ? 'no fix commit on main'
      : since && commits[0].date < since ? `fix before ${since}`
      : null;
    if (reason) skipped.push({ key: t.key, reason });
    else take.push({ key: t.key, summary: t.summary, issueType: t.issueType, commits });
  }
  return { take, skipped };
}

/** Share of the Done tickets of `types` with a fix commit that are documented on main (and waiting in docs/ PRs). */
export function coverage(tickets, known, { types = ['Bug'] } = {}) {
  const fixed = tickets.filter((t) => types.includes(t.issueType) && known.keyCommits.has(t.key));
  return {
    fixed: fixed.length,
    documented: fixed.filter((t) => known.documented.has(t.key)).length,
    waiting: fixed.filter((t) => !known.documented.has(t.key) && known.pending.has(t.key)).length,
  };
}
