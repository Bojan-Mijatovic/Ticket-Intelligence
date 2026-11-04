// Isolated workspace for one ticket: a git worktree of the application repository on a new branch named after the
// ticket, created from the remote main. The user's clone, its branch and any running app are never touched.
// node_modules are linked (directory junctions on Windows) instead of reinstalled.

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

const LINKED_DEPS = ['frontend/node_modules', 'e2e/node_modules'];

function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    throw new Error(`git ${args.slice(0, 2).join(' ')} failed: ${String(e.stderr || e.message).trim().slice(0, 300)}`);
  }
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

export function createWorkspace({ repoDir, key, stateDir }) {
  const branch = key;
  const path = join(stateDir, 'work', key, 'repo');
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
    remove() {
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
