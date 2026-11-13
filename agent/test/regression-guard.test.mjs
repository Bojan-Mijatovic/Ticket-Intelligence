import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { guardCommit, guardText, testSpans, touchedFixes, touchedTests } from '../lib/regression-guard.mjs';

const SRC = 'backend/src/main/java/com/x/Limits.java';
const TEST = 'backend/src/test/java/com/x/LimitsTest.java';
const code = (limit, extra = '') => `package com.x;\n\nclass Limits {\n    static int max() {\n        return ${limit};\n    }\n${extra}}\n`;
const testFile = (expected) => `package com.x;\n\nclass LimitsTest {\n    @Test\n    void theLimitIsTwenty() {\n        assertEquals(${expected}, Limits.max());\n    }\n}\n`;

// LAB-1 writes the limit (10), LAB-2 fixes it (20) with a regression test; then the commits the guard looks at.
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'guard-'));
  const git = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-q', '-b', 'main']);
  const commit = (message, files) => {
    for (const [f, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, f)), { recursive: true });
      writeFileSync(join(dir, f), text);
    }
    git(['add', '-A']);
    git(['-c', 'user.name=Dev', '-c', 'user.email=d@x', 'commit', '-q', '-m', message]);
    return git(['rev-parse', 'HEAD']);
  };
  const s = {};
  s.feature = commit('LAB-1: the limits', { [SRC]: code(10) });
  s.fix = commit('LAB-2: the limit is 20', { [SRC]: code(20), [TEST]: testFile(20) });
  s.other = commit('LAB-3: a helper', { [SRC]: code(20, '    static int min() {\n        return 1;\n    }\n') });
  s.back = commit('LAB-4: tidy the limits', { [SRC]: code(10, '    static int min() {\n        return 1;\n    }\n') });
  s.adjusted = commit('LAB-5: limits as the new contract says', { [SRC]: code(15, '    static int min() {\n        return 1;\n    }\n'), [TEST]: testFile(15) });
  // A new test in the same class: test classes are shared, this is no change to LAB-2's test.
  s.addTest = commit('LAB-6: a test for the minimum', { [TEST]: testFile(15).replace(/\n}\n$/, '\n\n    @Test\n    void theMinimumIsOne() {\n        assertEquals(1, Limits.min());\n    }\n}\n') });
  return { dir, git, s };
}

test('the guard finds the lines of an earlier fix a commit changes, and the tests a commit changes', () => {
  const { dir, git, s } = repo();
  try {
    const fixKeys = new Set(['LAB-2']);
    assert.deepEqual(touchedFixes({ git, sha: s.back, prefixes: ['LAB'], fixKeys }).map((f) => [f.key, f.lines, f.files[0]]), [['LAB-2', 1, SRC]]);
    assert.deepEqual(touchedFixes({ git, sha: s.other, prefixes: ['LAB'], fixKeys }), [], 'an addition next to unrelated lines');
    assert.deepEqual(touchedFixes({ git, sha: s.fix, prefixes: ['LAB'], fixKeys, own: 'LAB-2' }), [], 'the fix itself');
    assert.deepEqual(touchedFixes({ git, sha: s.back, prefixes: ['LAB'], fixKeys: new Set() }), [], 'LAB-1 is a feature, not a fix');
    assert.deepEqual(touchedTests(git, s.adjusted), [TEST]);
    assert.deepEqual(touchedTests(git, s.fix), [], 'a new test is no threat');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verdicts: alert when the old regression test fails or was changed, note when it passes, clear otherwise', async () => {
  const { dir, s } = repo();
  const work = mkdtempSync(join(tmpdir(), 'guard-work-'));
  try {
    const calls = [];
    // The fake test run fails LAB-2's test when it is the restored (old) version or the code returns 10.
    const runTests = async ({ items, restore, sha }) => {
      calls.push({ sha, restore, items: items.map((i) => i.key) });
      const fails = restore.length > 0 || sha === s.back;
      const entries = items.map((i) => ({ key: i.key, status: fails ? 'fail' : 'pass', tests: i.tests.map((t) => ({ ...t, status: fails ? 'fail' : 'pass', failed: fails ? [{ name: 'theLimitIsTwenty', error: 'expected: <20> but was: <15>' }] : undefined })) }));
      return { entries, totals: { pass: fails ? 0 : entries.length, fail: fails ? entries.length : 0, notRun: 0, none: 0 } };
    };
    const base = { repoDir: dir, workDir: work, prefixes: ['LAB'], fixKeys: new Set(['LAB-2']), runTests };

    const back = await guardCommit({ ...base, sha: s.back });
    assert.equal(back.verdict, 'alert');
    assert.equal(back.key, 'LAB-4');
    assert.deepEqual(back.fixes.map((f) => [f.key, f.tests.map((t) => t.file)]), [['LAB-2', [TEST]]], 'LAB-2 tests from git (KB1), no knowledge entry needed');
    assert.match(back.text, /changes 1 line\(s\) the fix of LAB-2 wrote \(Limits\.java\)\. LAB-2's regression test FAILS on it: expected: <20>/);

    const adjusted = await guardCommit({ ...base, sha: s.adjusted });
    assert.equal(adjusted.verdict, 'alert');
    assert.deepEqual(adjusted.restored, [TEST]);
    assert.deepEqual(calls.at(-1).restore, [TEST], 'the test runs as it was before the commit');
    assert.match(adjusted.text, /and changes its regression test LimitsTest\.java\. LAB-2's regression test, as it was before this commit, FAILS/);

    const other = await guardCommit({ ...base, sha: s.other });
    assert.equal(other.verdict, 'clear');
    assert.equal(calls.length, 2, 'no test run for a commit that touches no fix');
    assert.match(other.text, /touches no earlier bug fix/);

    const note = await guardCommit({ ...base, sha: s.back, runTests: async ({ items }) => ({ entries: items.map((i) => ({ key: i.key, status: 'pass', tests: i.tests })), totals: { pass: 1, fail: 0 } }) });
    assert.equal(note.verdict, 'note');
    assert.match(guardText(note), /The regression tests pass\./);

    const added = await guardCommit({ ...base, sha: s.addTest });
    assert.equal(added.verdict, 'clear', 'adding a test to a shared class is not a change to LAB-2\'s test');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
});

test('the span of a test: from its annotations to the next member', () => {
  const text = 'class T {\n    @Test\n    @DisplayName("x")\n    void first() {\n        a();\n    }\n\n    @Test\n    void second() {\n        b();\n    }\n}\n';
  assert.deepEqual(testSpans(text, ['first']), [[2, 7]]);
  assert.deepEqual(testSpans(text, ['second']), [[8, 13]]);
  assert.deepEqual(testSpans("test('a b', async () => {\n  x();\n});\n\ntest('c', () => {});\n", ['a b']), [[1, 4]]);
});
