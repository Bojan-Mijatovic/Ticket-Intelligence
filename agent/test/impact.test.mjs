import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGraph } from '../lib/git-graph.mjs';
import { impactOf, weekOf } from '../lib/impact.mjs';

const AGENT = 'Ticket Intelligence Agent';

test('weeks start on Monday (UTC)', () => {
  assert.equal(weekOf('2026-11-13T09:00:00Z'), '2026-11-09'); // a Friday
  assert.equal(weekOf('2026-11-09T00:00:00Z'), '2026-11-09'); // the Monday itself
  assert.equal(weekOf('2026-11-08T23:59:00Z'), '2026-11-02'); // the Sunday before
});

test('the management week: first analyses, merged fixes and merged documentation save time; open PRs wait', () => {
  const pr = (number, branch, extra) => ({ number, branch, title: branch, state: 'MERGED', createdAt: '2026-11-10T09:00:00Z', mergedAt: null, closedAt: null, url: `https://github.com/o/r/pull/${number}`, commits: [{ oid: 'a', headline: `${branch}: x`, authors: [AGENT] }], comments: [], ...extra });
  const events = [
    { at: '2026-11-10T09:00:00Z', type: 'analyzed', key: 'DEM-40', result: { confidence: 'high', priorArt: { kind: 'none' } }, meta: { costUsd: 0.3, durationMs: 60_000 } },
    { at: '2026-11-10T11:00:00Z', type: 'analyzed', key: 'DEM-40', result: { confidence: 'high' }, meta: { costUsd: 0.3, durationMs: 60_000 } }, // a re-run: no time saved again
    { at: '2026-11-10T09:10:00Z', type: 'pr', key: 'DEM-40', url: 'https://github.com/o/r/pull/24' },
    { at: '2026-11-10T09:10:00Z', type: 'fix-proposed', key: 'DEM-40', url: 'https://github.com/o/r/pull/24', meta: { costUsd: 1.2 } },
    { at: '2026-11-11T09:00:00Z', type: 'analyzed', key: 'DEM-41', result: { confidence: 'high', duplicateOf: { key: 'DEM-40' } }, meta: { costUsd: 0.2, durationMs: 30_000 } },
    { at: '2026-11-11T09:05:00Z', type: 'pr', key: 'DEM-42', url: 'https://github.com/o/r/pull/26' },
    { at: '2026-11-11T09:05:00Z', type: 'fix-proposed', key: 'DEM-42', url: 'https://github.com/o/r/pull/26' },
    { at: '2026-11-03T09:00:00Z', type: 'analyzed', key: 'DEM-30', result: { confidence: 'low' }, meta: { costUsd: 0.5, durationMs: 120_000 } },
  ];
  const prs = [
    pr(24, 'DEM-40', { mergedAt: '2026-11-10T12:00:00Z' }),
    pr(25, 'docs/backfill-1', { mergedAt: '2026-11-12T12:00:00Z', commits: [{ oid: 'b', headline: 'DEM-3: document x', authors: [AGENT] }, { oid: 'c', headline: 'DEM-4: document y', authors: [AGENT] }] }),
    pr(26, 'DEM-42', { state: 'OPEN' }),
  ];
  const graph = buildGraph({ project: 'DEM', vcsKind: 'git', commits: [], events, prs });
  const im = impactOf([{ project: 'DEM', name: 'MediAgenda', graph }], { weeks: 2, now: new Date('2026-11-13T10:00:00Z'), baseline: { analysisMinutes: 45, reproduceMinutes: 60, fixMinutes: 180, docsMinutes: 30 } });

  assert.deepEqual(im.weeks.map((w) => w.week), ['2026-11-02', '2026-11-09']);
  const [prev, w] = im.weeks;
  assert.deepEqual([prev.analysed, prev.hoursSaved], [1, 0.7], 'DEM-30: 45 − 2 min');
  assert.deepEqual([w.analysed, w.runs, w.known], [2, 3, 1], 'DEM-40 counts once; DEM-41 was a duplicate');
  assert.deepEqual([w.fixPrs, w.fixMerged, w.docsMerged], [2, 1, 2]);
  // analysis: (45−1) + (45−0.5) min; fix: 240 − 10 min (analysis 09:00 → PR 09:10); docs: 2 × 30 min
  assert.deepEqual(w.savedHours, { analysis: 1.5, fix: 3.8, docs: 1 });
  assert.equal(w.costUsd, 2);
  assert.equal(w.costPerTicket, 1);
  assert.deepEqual(im.perProject[0].waiting, { fixPrs: 1, docsPrs: 0 });
  assert.equal(im.total.analysed, 3);
  assert.ok(im.notes[0].includes('estimates'));
  assert.ok(im.notes.some((n) => n.includes('1 fix PR(s)')), 'DEM-42 has no recorded cost');
});
