import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { describeMergeCheck, mergeCheck, mergeCheckComment } from '../lib/merge-check.mjs';

/** A repository with main and a fix branch; main then moves. The checks are stubs that record what they saw. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'ti-merge-'));
  const r = join(dir, 'app');
  const git = (args) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args], { cwd: r, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (f, text) => {
    mkdirSync(join(r, f, '..'), { recursive: true });
    writeFileSync(join(r, f), text);
  };
  mkdirSync(r);
  git(['init', '-q', '-b', 'main']);
  write('backend/Due.java', 'line 1\nincluded = isBefore(to)\nline 3\n');
  write('frontend/dates.ts', 'export const weekOf = (d) => d.getDay() - 1;\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'start']);
  return { dir, r, git, write };
}
const stubs = (log, { backendOk = true } = {}) => ({
  runBackendTests: async (ws) => (log.push(['backend', readFileSync(join(ws.path, 'backend/Due.java'), 'utf8')]), { ok: backendOk, passed: backendOk ? 27 : 26, failed: backendOk ? 0 : 1 }),
  runFrontendBuild: async (ws) => (log.push(['build', readFileSync(join(ws.path, 'frontend/dates.ts'), 'utf8')]), { ok: true }),
  runE2E: async () => (log.push(['e2e']), { ok: true, passed: 10, failed: 0 }),
});

test('A4: the fix merged into the main of now, the checks of its side run there, nothing is left behind', async () => {
  const { dir, r, git, write } = repo();
  try {
    git(['checkout', '-q', '-b', 'VAX-17']);
    write('backend/Due.java', 'line 1\nincluded = !isAfter(to)\nline 3\n');
    git(['commit', '-q', '-am', 'VAX-17: fix']);
    git(['checkout', '-q', 'main']);
    write('frontend/dates.ts', 'export const weekOf = (d) => (d.getDay() + 6) % 7;\n'); // main moved: another fix
    git(['commit', '-q', '-am', 'VAX-19: fix']);
    const log = [];
    const res = await mergeCheck({ repoDir: r, head: 'VAX-17', base: 'main', workDir: join(dir, 'state'), fetch: false, run: stubs(log) });
    assert.deepEqual([res.ok, res.conflict, res.sides], [true, null, ['backend']]);
    assert.equal(log.length, 1, 'only the backend: the branch changed nothing else');
    assert.match(log[0][1], /!isAfter\(to\)/, 'the tests ran on the merge of both');
    assert.match(describeMergeCheck(res), /^merge check on main [0-9a-f]{7}: still green \(backend 27 passed\)$/);
    assert.match(mergeCheckComment(res), /everything still passes[\s\S]*\| Backend tests \| 27 passed \|/);
    assert.equal(git(['worktree', 'list']).split('\n').length, 1, 'the throwaway worktree is gone');
    assert.equal(git(['status', '--porcelain']), '', 'the clone is untouched');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('A4: a conflict with the main of now is reported, and nothing runs', async () => {
  const { dir, r, git, write } = repo();
  try {
    git(['checkout', '-q', '-b', 'VAX-17']);
    write('backend/Due.java', 'line 1\nincluded = !isAfter(to)\nline 3\n');
    git(['commit', '-q', '-am', 'fix']);
    git(['checkout', '-q', 'main']);
    write('backend/Due.java', 'line 1\nincluded = to.isAfter(dueOn) || to.isEqual(dueOn)\nline 3\n');
    git(['commit', '-q', '-am', 'another fix of the same line']);
    const log = [];
    const res = await mergeCheck({ repoDir: r, head: 'VAX-17', base: 'main', workDir: join(dir, 'state'), fetch: false, run: stubs(log) });
    assert.deepEqual([res.ok, res.conflict, log.length], [false, ['backend/Due.java'], 0]);
    assert.match(describeMergeCheck(res), /conflicts with main in backend\/Due\.java/);
    assert.match(mergeCheckComment(res), /\*\*conflicts\*\* with main in `backend\/Due\.java`/);
    assert.equal(git(['worktree', 'list']).split('\n').length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('A4: a frontend fix gets the build and every browser test; a failing check says FAILS', async () => {
  const { dir, r, git, write } = repo();
  try {
    git(['checkout', '-q', '-b', 'VAX-19']);
    write('frontend/dates.ts', 'export const weekOf = (d) => (d.getDay() + 6) % 7;\n');
    write('backend/Due.java', 'line 1\nincluded = isBefore(to) // VAX-19 note\nline 3\n');
    git(['commit', '-q', '-am', 'VAX-19: fix']);
    const log = [];
    const res = await mergeCheck({ repoDir: r, head: 'VAX-19', base: 'main', workDir: join(dir, 'state'), fetch: false, run: stubs(log, { backendOk: false }) });
    assert.deepEqual(res.sides, ['backend', 'frontend']);
    assert.deepEqual(log.map((l) => l[0]), ['backend', 'build', 'e2e']);
    assert.equal(res.ok, false);
    assert.match(describeMergeCheck(res), /FAILS \(backend 26 passed, 1 FAILED, build ok, browser 10 passed\)/);
    assert.match(mergeCheckComment(res), /\*\*something fails\*\*[\s\S]*no longer holds/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
