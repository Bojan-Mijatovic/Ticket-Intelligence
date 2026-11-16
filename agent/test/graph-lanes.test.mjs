import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGraph, mentionLines } from '../lib/git-graph.mjs';
import { laneLayout } from '../lib/graph-lanes.mjs';

const AGENT = 'Ticket Intelligence Agent';
const at = (h) => `2026-11-06T${String(h).padStart(2, '0')}:00:00Z`;
const ev = (h, type, key, extra = {}) => ({ at: at(h), type, key, text: extra.text ?? type, ...extra });

// DEM-40: analysed 09, PR 10, merged on main at 12 (squash #24). DEM-41: analysed 10, fix stopped 11 (overlaps 40).
// DEM-42: analysed 13, after both ended: it reuses column 1. A person's commit at 08 without a ticket.
// `more` adds newer commits (newest first) and events.
function graph(more = {}) {
  const commits = [
    ...(more.commits ?? []),
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
    ...(more.events ?? []),
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

// A knowledge refresh (MediAgenda #31): no key in the subject, one line per ticket in the body.
const REFRESH = {
  hash: '18c7464aaaa', short: '18c7464', subject: 'Knowledge base: regression tests of the known issues (#31)', author: 'Bojan-Mijatovic',
  body: `DEM-40: Test e2e/tests/DEM-40.spec.ts (like DEM-41)\nDEM-41: Test none\n\nCo-authored-by: ${AGENT} <a@b>`, files: ['docs/knowledge/a.md'], date: at(15), parents: [],
};

test('a commit without a key carries the tickets its message names, with what it says about each', () => {
  const row = laneLayout(graph({ commits: [REFRESH] })).rows.find((r) => r.ref === '18c7464');
  assert.equal(row.ticket, null);
  assert.equal(row.mentioned, null, 'all tickets: no row is anyone\'s mention');
  assert.deepEqual(row.mentions.map((m) => `${m.key} = ${m.line}`), ['DEM-40 = DEM-40: Test e2e/tests/DEM-40.spec.ts (like DEM-41)', 'DEM-41 = DEM-41: Test none'],
    'the line that starts with the key wins over an earlier line that only names it');
  assert.deepEqual(laneLayout(graph()).rows.find((r) => r.ref === 'f898df2').mentions, []);
  assert.deepEqual(mentionLines('DEM-7: fix\n\nThe same cause as DEM-5, not DEM-50.', ['DEM-5']), { 'DEM-5': 'The same cause as DEM-5, not DEM-50.' });
  assert.deepEqual(mentionLines('Knowledge base: one file per component\n\n* DEM-32 and DEM-33 in the current format', ['DEM-32']), { 'DEM-32': 'DEM-32 and DEM-33 in the current format' }, 'a list marker is left out');
});

test('one ticket shows the commits that mention it, on the main line, without stretching its lane', () => {
  const g = graph({ commits: [REFRESH] });
  const one = laneLayout(g, { ticket: 'DEM-41' });
  assert.deepEqual(one.rows.map((r) => (r.kind === 'commit' ? `commit ${r.ref} mentions ${r.mentioned}` : r.type)), ['commit 18c7464 mentions DEM-41', 'fix-failed', 'analyzed']);
  assert.deepEqual([one.lanes[0].top, one.lanes[0].merges, one.lanes[0].end], [1, [], 'stopped'], 'a mention is not a merge');
  const forty = laneLayout(g, { ticket: 'DEM-40' });
  assert.deepEqual(forty.rows.map((r) => r.ref ?? r.type), ['18c7464', 'f898df2', 'pr', 'analyzed']);
  assert.deepEqual([forty.lanes[0].top, forty.lanes[0].merges, forty.lanes[0].end], [1, [1], 'merged'], 'it still ends at its own merge commit');
  assert.equal(forty.rows.find((r) => r.ref === 'f898df2').mentioned, null);
});

test('the owner\'s Teams message is a row of the lane, with its card', () => {
  const card = { to: 'Marta Ricci', title: 'DEM-40: red background', message: 'Please take a look', url: 'https://jira.example/browse/DEM-40', confidence: 'high', escalate: null };
  const g = graph({ events: [ev(9, 'notified', 'DEM-40', { text: 'Teams (simulated) message to Marta Ricci', card, channel: 'dashboard' })] });
  const rows = laneLayout(g, { ticket: 'DEM-40' }).rows;
  assert.deepEqual(rows.map((r) => r.ref ?? r.type), ['f898df2', 'pr', 'notified', 'analyzed']);
  const row = rows.find((r) => r.type === 'notified');
  assert.deepEqual([row.text, row.tone, row.card.to, row.channel], ['✉ Teams (simulated) message to Marta Ricci', 'teams', 'Marta Ricci', 'dashboard']);
  assert.equal(rows.find((r) => r.type === 'analyzed').card, undefined);
});
