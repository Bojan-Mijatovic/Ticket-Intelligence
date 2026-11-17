import assert from 'node:assert/strict';
import { test } from 'node:test';
import { retryableFixError } from '../lib/pipeline.mjs';

const err = (message, extra = {}) => Object.assign(new Error(message), extra);

test('A3: an accident is worth one more try', () => {
  // VAX-17 (2026-11-13): the time limit, on a machine busy with a training.
  assert.match(retryableFixError(err('agent run timed out after 15 min')), /time limit/);
  // The clean-up of that run: a process still holding the worktree.
  assert.match(retryableFixError(err("EBUSY: resource busy or locked, rmdir 'C:\\x\\work\\VAX-17\\repo'", { code: 'EBUSY' })), /held by another process/);
  assert.match(retryableFixError(err('fetch failed')), /network/);
  assert.match(retryableFixError(err("git push failed: fatal: unable to access 'https://github.com/x/y.git/': Could not resolve host: github.com")), /network/);
  assert.match(retryableFixError(err('ng serve did not answer on port 4400 within 120 s')), /dev server/);
});

test('A3: an answer is never retried', () => {
  // Every other fix that stopped so far (DEM-33, LAB-24, DEM-12, DEM-35, DEM-41).
  const stage = (s, m) => err(m, { stage: s });
  assert.equal(retryableFixError(stage('verify', 'independent checks failed after the fix')), null);
  assert.equal(retryableFixError(stage('reproduce', 'the new backend test passes on the current code, so it does not reproduce the bug')), null);
  assert.equal(retryableFixError(stage('fix', 'the fix must not modify tests other than e2e/tests/DEM-33.spec.ts: e2e/tests/DEM-32.spec.ts')), null);
  assert.equal(retryableFixError(err('branch DEM-12 already exists (someone may be working on it); not touching it', { code: 'BRANCH_EXISTS' })), null);
  // A stage wins over words that look like an accident: a test that timed out inside the checks is an answer.
  assert.equal(retryableFixError(stage('verify', 'Test timeout of 30000ms exceeded. fetch failed')), null);
  assert.equal(retryableFixError(err('something nobody planned for')), null);
  assert.equal(retryableFixError(null), null);
});
