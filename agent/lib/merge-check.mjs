// A4: an open fix PR checked against the main of now. The fix was verified on the main it started from; when main
// moves (another fix merged, a pilot push), that verification is out of date. A throwaway worktree of the base, the
// PR's branch merged in (nothing committed or pushed), and the checks of the sides the PR touches: every backend test,
// the frontend build and every browser test, as CI would. The result goes on the PR as a comment; merging stays a
// person's. Done by hand on 2026-11-16 before #7, #5, #8 and #6 of MediVax were merged.

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { runBackendTests, runE2E, runFrontendBuild } from './verify.mjs';
import { linkDeps, removeWorktree } from './workspace.mjs';

const exec = promisify(execFile);
const git = async (cwd, args) => (await exec('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true })).stdout.trim();

/**
 * @param {string} p.repoDir   the project's clone
 * @param {string} p.head      the PR's branch, as a ref (origin/VAX-21)
 * @param {string} [p.base]    the main of now (origin/main)
 * @param {string} p.workDir   a folder of the agent's state for the throwaway worktree
 * @param {object} [p.run]     the checks (verify.mjs); tests pass their own
 * @returns {Promise<{ ok: boolean, base: string, head: string, conflict: string[]|null, sides: string[], backend: object|null, build: object|null, e2e: object|null }>}
 */
export async function mergeCheck({ repoDir, head, base = 'origin/main', workDir, toolsDir = null, fetch = true, run = { runBackendTests, runFrontendBuild, runE2E } }) {
  if (fetch) await git(repoDir, ['fetch', '-q', 'origin']);
  const baseSha = await git(repoDir, ['rev-parse', base]);
  const headSha = await git(repoDir, ['rev-parse', head]);
  // The sides the PR itself changes (from where it left main), not what main did since.
  const own = (await git(repoDir, ['diff', '--name-only', `${baseSha}...${headSha}`])).split('\n').filter(Boolean);
  const sides = [own.some((f) => f.startsWith('backend/')) && 'backend', own.some((f) => /^(frontend|e2e)\//.test(f)) && 'frontend'].filter(Boolean);
  const out = { ok: false, base: baseSha.slice(0, 7), head: headSha.slice(0, 7), conflict: null, sides, backend: null, build: null, e2e: null };

  mkdirSync(workDir, { recursive: true });
  const wt = join(workDir, 'repo');
  if (existsSync(wt)) removeWorktree(repoDir, wt); // a check that was stopped half-way
  await git(repoDir, ['worktree', 'add', '-q', '--detach', wt, baseSha]);
  try {
    try {
      await git(wt, ['-c', 'user.name=merge-check', '-c', 'user.email=merge-check@localhost', 'merge', '-q', '--no-ff', '--no-commit', headSha]);
    } catch {
      out.conflict = (await git(wt, ['diff', '--name-only', '--diff-filter=U'])).split('\n').filter(Boolean);
      return out;
    }
    if (sides.includes('backend')) out.backend = await run.runBackendTests({ path: wt }, toolsDir);
    if (sides.includes('frontend')) {
      linkDeps(repoDir, wt);
      out.build = await run.runFrontendBuild({ path: wt });
      if (out.build.ok) out.e2e = await run.runE2E({ path: wt }, [], { evidenceDir: join(workDir, 'evidence') });
    }
    out.ok = [out.backend, out.build, out.e2e].every((c) => c === null || c.ok) && sides.length > 0;
    return out;
  } finally {
    removeWorktree(repoDir, wt); // unlinks node_modules first, so nothing behind the links is deleted
    rmSync(join(workDir, 'evidence'), { recursive: true, force: true });
  }
}

/** One line for the dashboard and the ticket's lane. */
export function describeMergeCheck(r) {
  if (r.conflict) return `merge check on main ${r.base}: conflicts with main in ${r.conflict.join(', ')}`;
  if (!r.sides.length) return `merge check on main ${r.base}: nothing to check (no backend or frontend change)`;
  const parts = [r.backend && `backend ${r.backend.passed} passed${r.backend.failed ? `, ${r.backend.failed} FAILED` : ''}`, r.build && `build ${r.build.ok ? 'ok' : 'FAILED'}`, r.e2e && `browser ${r.e2e.passed} passed${r.e2e.failed ? `, ${r.e2e.failed} FAILED` : ''}`].filter(Boolean);
  return `merge check on main ${r.base}: ${r.ok ? 'still green' : 'FAILS'} (${parts.join(', ')})`;
}

/** The PR comment: what was checked, on which main, and what to do. */
export function mergeCheckComment(r) {
  const row = (name, c, cell) => (c ? `| ${name} | ${cell(c)} |` : null);
  const lines = r.conflict
    ? [`(robot) **Merge check** on main \`${r.base}\`: this branch (\`${r.head}\`) **conflicts** with main in ${r.conflict.map((f) => `\`${f}\``).join(', ')}.`, '', 'Main moved since this fix was verified. Bring the branch up to date with main before merging.']
    : [
      `(robot) **Merge check** on main \`${r.base}\`: this branch (\`${r.head}\`) merged into the main of now, ${r.ok ? '**everything still passes**' : '**something fails**'}.`,
      '',
      '| Check | Result |',
      '|---|---|',
      row('Backend tests', r.backend, (c) => (c.ok ? `${c.passed} passed` : `${c.failed} failed, ${c.passed} passed`)),
      row('Frontend build', r.build, (c) => (c.ok ? 'passed' : 'FAILED')),
      row('Browser tests', r.e2e, (c) => (c.ok ? `${c.passed} passed` : `${c.failed} failed, ${c.passed} passed`)),
      '',
      r.ok ? 'Main moved since this fix was verified; it still holds. Merging stays a person\'s decision.' : 'Main moved since this fix was verified, and it no longer holds: look before merging.',
    ].filter((l) => l !== null);
  return `${lines.join('\n')}\n\n_Checked by the Ticket Intelligence agent in a throwaway worktree: nothing was pushed or merged._`;
}
