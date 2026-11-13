// Documentation pull requests (K2 of docs/KNOWLEDGE_PLAN.md): the knowledge the agent wrote on Done (docs/<KEY>
// branches, document.mjs) reaches the analysis and Ask only once it is merged into main, so the dashboard lists the
// ones waiting and merges one after a person confirms (policy.json mergeDocs: draft). A pull request that changes
// anything outside docs/knowledge/*.md is never merged from here.
//
// A documentation PR that was closed without merging while its branch still exists (e.g. by a demo reset, or by
// hand) is listed too: the knowledge is still there, and it can be reopened and merged.

import { execFileSync } from 'node:child_process';

export const DOCS_DIR = 'docs/knowledge/';
const FIELDS = 'number,title,url,state,isDraft,createdAt,closedAt,mergedAt,headRefName,files';

/** docs/DEM-5 → DEM-5; docs/backfill-… (several tickets, K4) → null. */
export const ticketOfBranch = (branch) => (/^docs\/[A-Z][A-Z0-9_]+-\d+$/.test(branch) ? branch.slice(5) : null);

/** Only knowledge files: every changed path is docs/knowledge/*.md. */
export const onlyKnowledge = (files) => files.length > 0 && files.every((f) => f.startsWith(DOCS_DIR) && f.endsWith('.md'));

/**
 * The documentation PRs worth showing, newest first: open ones, and closed-unmerged ones whose branch still exists.
 * @param {object[]} prs        `gh pr list --json` rows
 * @param {Set<string>} branches  remote branch names (docs/…)
 * @param {number} now
 */
export function classifyDocsPrs(prs, branches, now = Date.now()) {
  return prs
    .filter((p) => p.headRefName?.startsWith('docs/'))
    .filter((p) => p.state === 'OPEN' || (p.state === 'CLOSED' && branches.has(p.headRefName)))
    .map((p) => {
      const files = (p.files ?? []).map((f) => f.path);
      const safe = onlyKnowledge(files);
      return {
        number: p.number,
        key: ticketOfBranch(p.headRefName), // null for a backfill branch (several tickets)
        title: p.title,
        url: p.url,
        state: p.state === 'OPEN' ? (p.isDraft ? 'draft' : 'open') : 'closed',
        ageDays: Math.floor((now - Date.parse(p.createdAt)) / 864e5),
        closedAt: p.closedAt ?? null,
        files,
        mergeable: safe,
        why: safe ? null : `changes files outside ${DOCS_DIR}*.md: ${files.filter((f) => !(f.startsWith(DOCS_DIR) && f.endsWith('.md'))).join(', ') || '(no files)'}`,
      };
    })
    .sort((a, b) => b.number - a.number);
}

/** Distinct ticket keys with an entry ("### KEY: …") in a knowledge text. */
export function entryKeys(text) {
  return [...new Set([...String(text).matchAll(/^### ([A-Z][A-Z0-9_]+-\d+):/gm)].map((m) => m[1]))];
}

/**
 * @param {object} p
 * @param {string} p.repoDir  the app's clone
 * @param {(cmd: string, args: string[], opts?: object) => string} [p.sh]
 */
export function createDocsPrs({ repoDir, sh = (cmd, args) => execFileSync(cmd, args, { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 }).trim() }) {
  const slug = () => sh('git', ['remote', 'get-url', 'origin']).match(/github\.com[/:]([^/]+)\/([^/.\s]+)/)?.slice(1, 3).join('/') ?? null;
  const remoteDocsBranches = () => new Set(sh('git', ['ls-remote', '--heads', 'origin', 'docs/*']).split('\n').filter(Boolean).map((l) => l.split('refs/heads/')[1]));

  /** What is on main (entries, files) and the documentation PRs waiting. */
  async function list() {
    const repo = slug();
    if (!repo) return { repo: null, prs: [], onMain: null, error: 'the repository has no GitHub remote: documentation PRs cannot be listed' };
    sh('git', ['fetch', '-q', '--prune', 'origin']);
    let files = [];
    let keys = [];
    try {
      files = sh('git', ['ls-tree', '-r', '--name-only', 'origin/main', '--', DOCS_DIR]).split('\n').filter((f) => f.endsWith('.md') && !f.endsWith('/README.md'));
      keys = files.length ? entryKeys(sh('git', ['grep', '-h', '^### ', 'origin/main', '--', DOCS_DIR])) : [];
    } catch {
      /* no docs/knowledge on main yet */
    }
    // A closed PR of a ticket documented on main since (e.g. again by the backfill) has nothing left to merge.
    const prs = classifyDocsPrs(JSON.parse(sh('gh', ['pr', 'list', '--repo', repo, '--state', 'all', '--limit', '100', '--json', FIELDS])), remoteDocsBranches())
      .filter((x) => !(x.state === 'closed' && x.key && keys.includes(x.key)));
    return { repo, prs, onMain: { files: files.length, entries: keys.length, keys, names: files.map((f) => f.slice(DOCS_DIR.length)) } };
  }

  /**
   * Merges one documentation PR into main (squash), after a person confirmed it. A closed one is reopened first, a
   * draft is marked ready. Refuses anything that is not a docs/ branch changing only docs/knowledge/*.md.
   * @returns {Promise<{ number, key, url, reopened: boolean }>}
   */
  async function merge(number) {
    const repo = slug();
    if (!repo) throw Object.assign(new Error('the repository has no GitHub remote'), { status: 409 });
    const pr = JSON.parse(sh('gh', ['pr', 'view', String(number), '--repo', repo, '--json', FIELDS]));
    const refuse = (message) => Object.assign(new Error(message), { status: 409 });
    if (!pr.headRefName?.startsWith('docs/')) throw refuse(`PR #${number} is not a documentation PR (branch ${pr.headRefName})`);
    if (pr.state === 'MERGED') throw refuse(`PR #${number} is already merged`);
    const files = (pr.files ?? []).map((f) => f.path);
    if (!onlyKnowledge(files)) throw refuse(`PR #${number} is not merged from the dashboard: it ${classifyDocsPrs([{ ...pr, state: 'OPEN' }], new Set())[0].why}`);
    let reopened = false;
    if (pr.state === 'CLOSED') {
      if (!remoteDocsBranches().has(pr.headRefName)) throw refuse(`PR #${number} was closed and its branch ${pr.headRefName} is gone`);
      sh('gh', ['pr', 'reopen', String(number), '--repo', repo]);
      reopened = true;
    }
    if (pr.isDraft) sh('gh', ['pr', 'ready', String(number), '--repo', repo]);
    try {
      sh('gh', ['pr', 'merge', String(number), '--repo', repo, '--squash', '--delete-branch']);
    } catch (e) {
      // Usually a conflict in the README index with another documentation PR merged meanwhile.
      throw Object.assign(new Error(`GitHub did not merge PR #${number}: ${String(e.stderr || e.message).trim().split('\n')[0]}`), { status: 409 });
    }
    sh('git', ['fetch', '-q', '--prune', 'origin']);
    try {
      sh('git', ['worktree', 'prune']);
      sh('git', ['branch', '-D', pr.headRefName]); // the local copy of the branch, if the agent left one
    } catch {
      /* none */
    }
    return { number, key: ticketOfBranch(pr.headRefName), branch: pr.headRefName, url: pr.url, reopened };
  }

  return { list, merge };
}
