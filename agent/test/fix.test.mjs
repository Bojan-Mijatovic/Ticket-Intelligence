import assert from 'node:assert/strict';
import { test } from 'node:test';
import { supersededTests } from '../lib/fix.mjs';

test('superseded tests: only existing tests of the replaced tickets, never the ticket itself, no duplicates', () => {
  const exists = (f) => ['e2e/tests/DEM-32.spec.ts', 'e2e/tests/DEM-33.spec.ts'].includes(f);
  const analysis = {
    supersedes: [
      { key: 'dem-32', why: 'dark blue Pazienti background' },
      { key: 'DEM-32', why: 'duplicate entry' },
      { key: 'DEM-33', why: 'the ticket itself' },
      { key: 'DEM-12', why: 'no test file' },
      { key: '../evil', why: 'not a key' },
    ],
  };
  assert.deepEqual(supersededTests(analysis, 'DEM-33', exists), [{ key: 'DEM-32', file: 'e2e/tests/DEM-32.spec.ts', why: 'dark blue Pazienti background' }]);
  assert.deepEqual(supersededTests({}, 'DEM-33', exists), []);
});
