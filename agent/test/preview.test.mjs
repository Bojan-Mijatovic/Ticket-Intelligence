import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { currentBranch } from '../lib/preview.mjs';

test('currentBranch: read from the HEAD file, as git says it, for a clone, a detached HEAD and a worktree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ti-branch-'));
  const repo = join(dir, 'repo');
  const git = (args, cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const asGit = (cwd) => git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  try {
    git(['init', '-q', '-b', 'main', repo], dir);
    git(['-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'first']);
    assert.equal(currentBranch(repo), 'main');
    git(['checkout', '-q', '-b', 'feature/DEM-42']);
    assert.equal(currentBranch(repo), 'feature/DEM-42', 'a branch name with a slash');
    git(['checkout', '-q', '--detach']);
    assert.deepEqual([currentBranch(repo), asGit(repo)], ['HEAD', 'HEAD'], 'detached, as git says it');
    const wt = join(dir, 'wt');
    git(['worktree', 'add', '-q', '-b', 'DEM-43', wt]);
    assert.deepEqual([currentBranch(wt), asGit(wt)], ['DEM-43', 'DEM-43'], 'a worktree: .git is a file');
    assert.equal(currentBranch(join(dir, 'missing')), 'unknown');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
