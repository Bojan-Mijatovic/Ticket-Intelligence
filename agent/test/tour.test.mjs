import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestRun, runsOf, scoreRun } from '../lib/tour.mjs';

const ev = (key, type, at) => ({ key, type, at: `2026-11-09T12:${String(at).padStart(2, '0')}:00.000Z` });

test('a ticket picked again starts a new run; the review after done stays in its run', () => {
  const runs = runsOf([
    ev('DEM-1', 'queued', 1), ev('DEM-1', 'picked', 1), ev('DEM-1', 'analyzed', 2), ev('DEM-1', 'done', 3), ev('DEM-1', 'reviewed', 4),
    ev('DEM-1', 'picked', 10), ev('DEM-1', 'analyzed', 11),
    { type: 'status' },
  ]);
  assert.equal(runs.length, 2);
  assert.deepEqual(runs[0].events.map((e) => e.type), ['queued', 'picked', 'analyzed', 'done', 'reviewed']);
  assert.deepEqual(runs[1].events.map((e) => e.type), ['picked', 'analyzed']);
});

test('a run without an analysis is never chosen', () => {
  assert.equal(scoreRun({ events: [ev('DEM-1', 'picked', 1), ev('DEM-1', 'failed', 2)] }), -Infinity);
  assert.equal(bestRun([ev('DEM-1', 'picked', 1), ev('DEM-1', 'failed', 2)]), null);
});

test('the fullest run wins, a failed fix counts against it, the newest wins a tie', () => {
  const full = ['picked', 'analyzed', 'reproduced', 'verified', 'fix-proposed', 'reviewed'];
  const events = [
    ...full.map((t, i) => ev('DEM-2', t, 10 + i)),
    ...[...full, 'fix-failed'].map((t, i) => ev('DEM-3', t, 20 + i)),
    ...['picked', 'analyzed'].map((t, i) => ev('DEM-4', t, 30 + i)),
    ...full.map((t, i) => ev('DEM-5', t, 40 + i)),
  ];
  const best = bestRun(events);
  assert.equal(best.key, 'DEM-5');
  assert.equal(best.recordedAt, ev('DEM-5', 'picked', 40).at);
  assert.equal(bestRun(events, 'DEM-4').key, 'DEM-4', 'the configured ticket wins when it was recorded');
  assert.equal(bestRun(events, 'DEM-99').key, 'DEM-5', 'a configured ticket that was never recorded falls back to the best');
});
