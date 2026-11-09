import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { nearer, openRepo } from '../../.claude/skills/analyze-ticket/scripts/lib/vcs/index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('repository of a directory: the nearest one wins (an SVN working copy inside a git repository is SVN)', () => {
  const git = { kind: 'git', root: 'C:/work' };
  const svn = { kind: 'svn', root: 'C:\\work\\demo\\app-svn' };
  assert.equal(nearer(git, svn).kind, 'svn');
  assert.equal(nearer({ kind: 'git', root: '/work/demo/app' }, { kind: 'svn', root: '/work' }).kind, 'git');
  assert.equal(nearer(null, svn).kind, 'svn');
  assert.equal(nearer(git, null).kind, 'git');
  assert.equal(nearer(null, null), null);
});

const SVN_WC = join(ROOT, 'demo', 'mediagenda-svn');
const SVN_BIN = join(ROOT, 'tools', 'svn', 'bin', process.platform === 'win32' ? 'svn.exe' : 'svn');
test('the demo SVN working copy (inside this git repository) is read as SVN', { skip: !(existsSync(SVN_WC) && existsSync(SVN_BIN)) && 'no demo SVN working copy or portable svn here' }, () => {
  process.env.SVN_BIN ??= SVN_BIN;
  const repo = openRepo(SVN_WC);
  assert.equal(repo.kind, 'svn');
  assert.ok(repo.logByMessage(['DEM-5'], { all: true, limit: 10 }).some((c) => c.short === 'r12'));
});
