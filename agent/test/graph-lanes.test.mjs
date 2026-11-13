import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGraph } from '../lib/git-graph.mjs';
import { laneLayout } from '../lib/graph-lanes.mjs';

const AGENT = 'Ticket Intelligence Agent';
const at = (h) => `2026-11-06T${String(h).padStart(2, '0')}:00:00Z`;
const ev = (h, type, key, extra = {}) => ({ at: at(h), type, key, text: extra.text ?? type, ...extra });

// DEM-40: analysed 09, PR 10, merged on main at 12 (squash #24). DEM-41: analysed 10, fix stopped 11 (overlaps 40).
// DEM-42: analysed 13, after both ended: it reuses column 1. A person's commit at 08 without a ticket.
function graph() {
  const commits = [
    { hash: 'f898df2aaaa', short: 'f898df2', subject: 'DEM-40: red background (#24)', author: 'Bojan-Mijatovic', body: `Co-authored-by: ${AGENT} <a@b>`, files: ['frontend/src/styles.scss'], date: at(12), parents: [] },
    { hash: '1111111aaaa', short: '1111111', subject: 'Bump Angular', author: 'Sara Colombo', body: '', files: ['package.json'], date: at(8), parents: [] },
  ];
  const events = [
    ev(9, 'picked', 'DEM-40'),
    ev(9, 'analyzed', 'DEM-40', { text: 'high confidence · owner Marta Ricci', result: { confidence: 'high' } }),
    ev(10, 'pr', 'DEM-40', { url: 'https://github.com/o/r/pull/24' }),
    ev(10, 'analyzed', 'DEM-41', { text: 'high confidence', result: { confidence: 'high' } }),
    ev(11, 'fix-failed', 'DEM-41', { text: 'reproduce: the test passes on the current code' }),
    ev(13, 'analyzed', 'DEM-42', { text: 'medium confidence', result: { confidence: 'medium' } }),
    ev(14, 'reviewed', 'DEM-42', { text: 'risk high · needs-changes · 2 finding(s)', url: 'https://github.com/o/r/pull/25#r', review: { risk: 'high', verdict: 'needs-changes', findings: [] } }),
  ];
  const prs = [{ number: 24, branch: 'DEM-40', title: 't', state: 'MERGED', createdAt: at(10), mergedAt: at(12), closedAt: at(12), url: 'https://github.com/o/r/pull/24', commits: [{ oid: 'a', headline: 'x', authors: [AGENT] }], comments: [] }];
  return buildGraph({ project: 'DEM', vcsKind: 'git', commits, events, prs });
}

test('lanes: newest row first, the main line in column 0, a lane joins main at its merge commit', () => {
  const L = laneLayout(graph());
  assert.deepEqual(L.rows.map((r) => `${r.ticket ?? '-'}:${r.kind === 'commit' ? 'commit' : r.type}`), [
    'DEM-42:reviewed', 'DEM-42:analyzed', 'DEM-40:commit', 'DEM-41:fix-failed', 'DEM-41:analyzed', 'DEM-40:pr', 'DEM-40:analyzed', '-:commit',
  ], 'picked is left out; the PR merge is the commit on main, not a step of its own');
  const lane = (k) => L.lanes.find((l) => l.ticket === k);
  assert.deepEqual([lane('DEM-40').col, lane('DEM-40').top, lane('DEM-40').bottom, lane('DEM-40').merges, lane('DEM-40').end], [1, 2, 6, [2], 'merged']);
  assert.deepEqual([lane('DEM-41').col, lane('DEM-41').end], [2, 'stopped'], 'it overlaps DEM-40, so it takes the next column');
  assert.equal(lane('DEM-42').col, 1, 'the column is free again once DEM-40 has merged');
  assert.equal(L.cols, 3);
  assert.equal(L.rows.find((r) => r.type === 'reviewed').tone, 'bad');
  assert.equal(L.rows.find((r) => r.ref === '1111111').by, 'Sara Colombo');
});

test('filters: one ticket, the agent\'s work only, a time window, and a row limit that cuts the oldest', () => {
  assert.deepEqual(laneLayout(graph(), { ticket: 'DEM-40' }).rows.map((r) => r.kind), ['commit', 'step', 'step']);
  assert.ok(!laneLayout(graph(), { agentOnly: true }).rows.some((r) => r.ref === '1111111'));
  assert.deepEqual(laneLayout(graph(), { since: at(13) }).rows.map((r) => r.ticket), ['DEM-42', 'DEM-42']);
  const cut = laneLayout(graph(), { limit: 3 });
  assert.equal(cut.rows.length, 3);
  assert.equal(cut.cut, 5);
});
