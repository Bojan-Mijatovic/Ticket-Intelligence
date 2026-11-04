// Preview an agent branch in the running MediAgenda app: switch the application clone (the one `ng serve` on :4200
// serves) to a ticket branch, wait until the dev server serves the new build, and report what changed.
// Used by the dashboard ("Preview in app") and by demo/preview.mjs. `main` switches back.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const TICKET_BRANCH = /^[A-Z][A-Z0-9_]+-\d+$/;
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (cwd, args) => {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
};

/** The branch the application clone is on (what :4200 shows). */
export function currentBranch(repoDir) {
  return tryGit(repoDir, ['rev-parse', '--abbrev-ref', 'HEAD']) ?? 'unknown';
}

/** Hash of what the dev server serves now (main bundle + global styles), or null when it is not running. */
async function fingerprint(appUrl) {
  try {
    const parts = await Promise.all(['/main.js', '/styles.css'].map((p) => fetch(appUrl + p).then((r) => (r.ok ? r.text() : ''))));
    return createHash('sha1').update(parts.join('\0')).digest('hex');
  } catch {
    return null;
  }
}

/**
 * @param {object} p
 * @param {string} p.repoDir   application clone served on :4200
 * @param {string} p.branch    a ticket branch (e.g. DEM-12) or "main"
 * @returns {Promise<{branch: string, from: string, changed: string[], waitedMs: number, served: boolean}>}
 */
export async function previewBranch({ repoDir, branch, appUrl = 'http://localhost:4200', timeoutMs = 90_000 }) {
  if (branch !== 'main' && !TICKET_BRANCH.test(branch)) throw new Error(`not a ticket branch: ${branch}`);
  if (git(repoDir, ['status', '--porcelain', '--untracked-files=no'])) throw new Error('the application clone has uncommitted changes; commit or discard them first');

  const from = currentBranch(repoDir);
  const oldHead = git(repoDir, ['rev-parse', 'HEAD']);
  tryGit(repoDir, ['fetch', '-q', 'origin']);
  const local = tryGit(repoDir, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`]);
  const remote = tryGit(repoDir, ['rev-parse', '--verify', '-q', `refs/remotes/origin/${branch}`]);
  if (!local && !remote) throw new Error(`branch ${branch} does not exist (closed by a demo reset?)`);

  const before = await fingerprint(appUrl);
  try {
    if (local) git(repoDir, ['checkout', '-q', branch]);
    else git(repoDir, ['checkout', '-q', '-b', branch, '--track', `origin/${branch}`]);
  } catch (e) {
    throw new Error(/worktree/i.test(e.stderr ?? e.message) ? `branch ${branch} is in use by the agent right now; try again when the ticket is done` : String(e.stderr ?? e.message).trim());
  }
  if (remote) tryGit(repoDir, ['merge', '-q', '--ff-only', `origin/${branch}`]);

  const changed = (tryGit(repoDir, ['diff', '--name-only', oldHead, 'HEAD', '--', 'frontend']) ?? '').split('\n').filter(Boolean);
  const started = Date.now();
  let served = before === null ? false : changed.length === 0;
  // Wait until ng serve has rebuilt: the served bundle or styles differ from before the switch.
  while (before !== null && changed.length && Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 1000));
    const now = await fingerprint(appUrl);
    if (now && now !== before) {
      served = true;
      break;
    }
  }
  return { branch, from, changed, waitedMs: Date.now() - started, served };
}
