import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { backendTestFor } from '../lib/fix.mjs';
import { fixSide } from '../lib/pipeline.mjs';
import { surefireResults } from '../lib/verify.mjs';

test('backend regression test name and package come from the ticket key and the test folder', () => {
  assert.deepEqual(backendTestFor('DEM-38'), { className: 'Dem38RegressionTest', pkg: 'com.mediagenda.regression', file: 'backend/src/test/java/com/mediagenda/regression/Dem38RegressionTest.java' });
  assert.equal(backendTestFor('CUP_DEMO-2629', 'backend/src/test/java/org/x/').file, 'backend/src/test/java/org/x/Cupdemo2629RegressionTest.java');
});

test('surefire: a failed assertion is counted; no report means the test did not compile', () => {
  const dir = mkdtempSync(join(tmpdir(), 'surefire-'));
  assert.equal(surefireResults(join(dir, 'missing')).classes.length, 0);
  mkdirSync(join(dir, 'r'));
  writeFileSync(join(dir, 'r', 'TEST-com.mediagenda.regression.Dem38RegressionTest.xml'),
    '<?xml version="1.0"?><testsuite name="x" tests="1" failures="1" errors="0"><testcase name="t"><failure message="expected: &lt;true&gt; but was: &lt;false&gt;" type="org.opentest4j.AssertionFailedError">14:10 is not offered</failure></testcase></testsuite>');
  writeFileSync(join(dir, 'r', 'TEST-com.mediagenda.booking.BookingServiceTest.xml'), '<testsuite name="y" tests="6" failures="0" errors="0"></testsuite>');
  const one = surefireResults(join(dir, 'r'), 'Dem38RegressionTest');
  assert.equal(one.tests, 1);
  assert.equal(one.failed, 1);
  assert.match(one.firstError, /expected: <true> but was: <false>/);
  const all = surefireResults(join(dir, 'r'));
  assert.deepEqual([all.tests, all.failed], [7, 1]);
});

test('side: [FE] (also with [BE]) uses the browser harness, [BE] alone or backend-only files the backend one', () => {
  const policy = { proposeFixWhen: { inferTagFromFiles: { FE: 'frontend/', BE: 'backend/' }, inferIgnoreFiles: ['e2e/'] } };
  const r = (files) => ({ files });
  assert.equal(fixSide({ issue: { summary: '[FE] - x' }, result: r([]), policy }), 'frontend');
  assert.equal(fixSide({ issue: { summary: '[BE][FE] - x' }, result: r([]), policy }), 'frontend');
  assert.equal(fixSide({ issue: { summary: '[BE] - x' }, result: r(['frontend/a.ts']), policy }), 'backend');
  assert.equal(fixSide({ issue: { summary: 'untagged' }, result: r(['backend/src/main/java/A.java:3', 'backend/src/test/java/ATest.java']), policy }), 'backend');
  assert.equal(fixSide({ issue: { summary: 'untagged' }, result: r(['frontend/a.ts', 'backend/B.java']), policy }), 'frontend');
});
