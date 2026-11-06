// Isolated workspace for one ticket: a git worktree of the application repository on a new branch named after the
// ticket, created from the remote main. The user's clone, its branch and any running app are never touched.
// node_modules are linked (directory junctions on Windows) instead of reinstalled.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const LINKED_DEPS = ['frontend/node_modules', 'e2e/node_modules'];

function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    throw new Error(`git ${args.slice(0, 2).join(' ')} failed: ${String(e.stderr || e.message).trim().slice(0, 300)}`);
  }
}

/**
 * Starts `ng serve` for the worktree and waits until it answers. The first compile in a fresh worktree is the slow
 * part of a fix run (~2 min, no cache); doing it while the analysis runs hides that time. The agent's own test runs
 * reuse this server; the watcher's independent checks still start their own.
 */
export async function startDevServer(ws, port, { timeoutMs = 300_000 } = {}) {
  const child = spawn('npx', ['ng', 'serve', '--port', String(port)], {
    cwd: join(ws.path, 'frontend'),
    env: { ...process.env, NG_CLI_ANALYTICS: 'false' },
    shell: process.platform === 'win32',
    windowsHide: true,
    stdio: 'ignore',
  });
  const stop = () => {
    if (child.exitCode !== null) return;
    if (process.platform === 'win32') {
      try {
        execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        /* already gone */
      }
    } else child.kill();
  };
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`ng serve exited with ${child.exitCode}`);
    try {
      const res = await fetch(`http://localhost:${port}/`);
      if (res.ok) {
        ws.server = { port, stop, warmMs: Date.now() - started };
        return ws.server;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  stop();
  throw new Error(`ng serve did not answer on port ${port} within ${Math.round(timeoutMs / 1000)} s`);
}

/**
 * A read-only checkout of origin/main for the analysis (state/analysis-repo, detached HEAD), so the analysis never
 * sees whatever branch the application clone happens to be on (e.g. a fix shown with demo/preview.mjs). Same
 * repository, so history, branches and remotes are all visible. Non-git repositories (SVN) are used as they are.
 * `name` gives a separate checkout (e.g. 'ask-repo') to a run that may overlap with an analysis: each refresh
 * resets its folder.
 */
export function analysisCheckout({ repoDir, stateDir, name = 'analysis-repo' }) {
  try {
    git(repoDir, ['rev-parse', '--is-inside-work-tree']);
  } catch {
    return repoDir;
  }
  const path = resolve(stateDir, name); // absolute: git resolves relative paths against repoDir
  // --prune: a branch deleted on GitHub (closed PR, demo reset) must not stay visible as origin/<KEY>, or the
  // analysis concludes that "the fix is already on branch DEM-36" for a branch that no longer exists.
  git(repoDir, ['fetch', '-q', '--prune', 'origin']);
  if (!existsSync(join(path, '.git'))) {
    git(repoDir, ['worktree', 'prune']);
    mkdirSync(dirname(path), { recursive: true });
    git(repoDir, ['worktree', 'add', '-q', '--detach', path, 'origin/main']);
  } else {
    git(path, ['checkout', '-q', '--detach', '--force', 'origin/main']);
    git(path, ['clean', '-q', '-fd']);
  }
  return path;
}

export function branchExists(repoDir, branch) {
  const local = git(repoDir, ['branch', '--list', branch]);
  let remote = '';
  try {
    remote = git(repoDir, ['ls-remote', '--heads', 'origin', branch]);
  } catch {
    /* no remote */
  }
  return Boolean(local || remote);
}

/**
 * @param {string} [p.branch]  branch to create (default: the ticket key; e.g. "docs/DEM-9" for documentation)
 * @param {string} [p.name]    folder name under state/work/<KEY>/ (default "repo")
 */
export function createWorkspace({ repoDir, key, stateDir, branch = key, name = 'repo' }) {
  const path = join(stateDir, 'work', key, name);
  if (branchExists(repoDir, branch)) {
    const err = new Error(`branch ${branch} already exists (someone may be working on it); not touching it`);
    err.code = 'BRANCH_EXISTS';
    throw err;
  }
  git(repoDir, ['fetch', '-q', 'origin', 'main']);
  if (existsSync(path)) {
    git(repoDir, ['worktree', 'remove', '--force', path]);
  }
  mkdirSync(dirname(path), { recursive: true });
  git(repoDir, ['worktree', 'add', '-q', '-b', branch, path, 'origin/main']);

  for (const dep of LINKED_DEPS) {
    const target = join(repoDir, dep);
    if (existsSync(target)) symlinkSync(target, join(path, dep), 'junction');
  }

  return {
    path,
    branch,
    git: (args) => git(path, args),
    /** Paths changed relative to `base` (a commit) plus uncommitted and untracked files. */
    changedFiles(base = 'origin/main') {
      // diff against base covers committed + staged + unstaged changes to tracked files; ls-files adds new files.
      const tracked = git(path, ['diff', '--name-only', base]).split('\n');
      const untracked = git(path, ['ls-files', '--others', '--exclude-standard']).split('\n');
      return [...new Set([...tracked, ...untracked].map((f) => f.trim()).filter(Boolean))];
    },
    /** Warm Angular dev server for this worktree (see startDevServer); stopped by remove(). */
    server: null,
    remove() {
      // A running dev server keeps files open (Windows): stop it before deleting the worktree.
      this.server?.stop();
      this.server = null;
      // Unlink the junctions first, so removing the worktree can never delete the shared node_modules.
      for (const dep of LINKED_DEPS) {
        const link = join(path, dep);
        try {
          if (lstatSync(link).isSymbolicLink()) unlinkSync(link);
        } catch {
          /* not there */
        }
      }
      try {
        git(repoDir, ['worktree', 'remove', '--force', path]);
      } catch {
        rmSync(path, { recursive: true, force: true });
        git(repoDir, ['worktree', 'prune']);
      }
    },
  };
}
