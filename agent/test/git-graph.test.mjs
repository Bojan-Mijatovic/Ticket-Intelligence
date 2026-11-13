import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGraph, bulkClosed, graphEdges, isAgentCommit, keysIn, leadKey, prOfCommit, prOutcome, RESET_MARK } from '../lib/git-graph.mjs';

const AGENT = 'Ticket Intelligence Agent';
const commit = (hash, subject, { author = 'Sara Colombo', body = '', files = ['frontend/src/app/x.ts'], date = '2026-11-01T10:00:00Z' } = {}) => ({ hash, short: hash.slice(0, 7), author, body, subject, files, date, parents: [] });
const pr = (number, branch, { state = 'MERGED', mergedAt = null, closedAt = null, authors = [[AGENT, 'Claude Opus 5.5']], comments = [], headlines = null } = {}) => ({
  number, branch, title: branch, state, mergedAt, closedAt, createdAt: '2026-11-01T09:00:00Z', url: `https://github.com/o/r/pull/${number}`,
  commits: authors.map((a, i) => ({ oid: `c${number}${i}`, headline: headlines?.[i] ?? `${branch}: change`, authors: a })), comments,
});

test('ticket keys: the one a subject starts with, the ones it mentions, the PR of a squash or merge commit', () => {
  assert.equal(leadKey('DEM-5: Clear the Struttura field', ['DEM']), 'DEM-5');
  assert.equal(leadKey('[dem-5] fix', ['DEM']), 'DEM-5');
  assert.equal(leadKey('Knowledge base: document DEM-5', ['DEM']), null);
  assert.deepEqual(keysIn('DEM-40: like DEM-32, not LAB-3', ['DEM']), ['DEM-40', 'DEM-32']);
  assert.equal(prOfCommit('DEM-40: Give the page a background (#24)'), 24);
  assert.equal(prOfCommit('Merge pull request #7 from o/DEM-12'), 7);
  assert.equal(prOfCommit('DEM-40: no PR'), null);
});

test("the agent's commit: its own, or a squash merge with the agent as co-author; a person with Claude is a person", () => {
  assert.ok(isAgentCommit({ author: AGENT, body: '' }));
  assert.ok(isAgentCommit({ author: 'Bojan-Mijatovic', body: `Co-authored-by: ${AGENT} <x@users.noreply.github.com>` }));
  assert.ok(!isAgentCommit({ author: 'Bojan Mijatovic', body: 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>' }));
});

test('PR outcomes: merged unchanged or with a person\'s commit, withdrawn by the reset (marked, or closed together), rejected', () => {
  assert.equal(prOutcome(pr(1, 'DEM-1', { mergedAt: '2026-11-02T10:00:00Z' })), 'merged-unchanged');
  assert.equal(prOutcome(pr(2, 'DEM-2', { mergedAt: '2026-11-02T10:00:00Z', authors: [[AGENT], ['Bojan Mijatovic', 'Claude Opus 5.5']] })), 'merged-changed');
  assert.equal(prOutcome(pr(3, 'DEM-3', { state: 'OPEN' })), 'open');
  assert.equal(prOutcome(pr(4, 'DEM-4', { state: 'CLOSED', closedAt: '2026-11-02T10:00:00Z', comments: [`${RESET_MARK} (not a review decision).`] })), 'withdrawn');
  assert.equal(prOutcome(pr(5, 'DEM-5', { state: 'CLOSED', closedAt: '2026-11-02T10:00:00Z', comments: ['wrong place'] })), 'rejected');
});

test('a bulk close is a reset: two in one repository within two minutes, or one here and one in another app', () => {
  const closed = (n, at) => pr(n, `DEM-${n}`, { state: 'CLOSED', closedAt: at });
  const prs = [closed(1, '2026-11-05T08:16:53Z'), closed(2, '2026-11-05T08:17:12Z'), closed(3, '2026-11-06T13:16:50Z'), closed(4, '2026-11-09T11:27:18Z')];
  assert.deepEqual([...bulkClosed(prs)].sort(), [1, 2]);
  assert.deepEqual([...bulkClosed(prs, 120_000, [Date.parse('2026-11-09T11:27:27Z')])].sort(), [1, 2, 4], 'LAB #1, FAR #1 and BIL #1 were closed 9 s apart');
});

test('the graph joins commits, pull requests, events and Jira per ticket, oldest step first', () => {
  const commits = [
    commit('d703a75aaaa', 'Knowledge base: document 2 tickets (#9)', { author: 'Bojan-Mijatovic', body: `Co-authored-by: ${AGENT} <a@b>`, files: ['docs/knowledge/pazienti.md'], date: '2026-11-04T12:00:00Z' }),
    commit('f898df2aaaa', 'DEM-40: Give the page a red background (#24)', { author: 'Bojan-Mijatovic', body: `Co-authored-by: ${AGENT} <a@b>`, files: ['frontend/src/styles.scss', 'e2e/tests/DEM-40.spec.ts'], date: '2026-11-03T12:00:00Z' }),
    commit('74acd34aaaa', 'DEM-3: Reset the paging on a new search (like DEM-2)', { files: ['frontend/src/app/features/patients/patient-search.component.ts'], date: '2026-10-01T12:00:00Z' }),
  ];
  const events = [
    { at: '2026-11-03T09:00:00Z', type: 'picked', key: 'DEM-40', text: 'FE - red background' },
    { at: '2026-11-03T09:01:00Z', type: 'analyzed', key: 'DEM-40', text: 'high', result: { confidence: 'high', files: ['frontend/src/styles.scss:12'], owner: { name: 'Marta Ricci' } }, meta: { costUsd: 0.2, durationMs: 40_000, model: 'claude-sonnet-5-5' } },
    { at: '2026-11-03T09:10:00Z', type: 'pr', key: 'DEM-40', text: 'draft PR', url: 'https://github.com/o/r/pull/24' },
    { at: '2026-11-03T09:10:01Z', type: 'fix-proposed', key: 'DEM-40', text: 'draft PR ready', url: 'https://github.com/o/r/pull/24', meta: { costUsd: 1.1 } },
    { at: '2026-11-03T09:12:00Z', type: 'reviewed', key: 'DEM-40', url: 'https://github.com/o/r/pull/24#pullrequestreview-1', review: { risk: 'low', verdict: 'looks-good', findings: [] }, meta: { costUsd: 0.2 } },
    { at: '2026-11-03T09:00:00Z', type: 'analyzed', key: 'LAB-1', result: { confidence: 'low' } },
  ];
  const prs = [
    pr(24, 'DEM-40', { mergedAt: '2026-11-03T12:00:00Z' }),
    pr(9, 'docs/backfill-1', { mergedAt: '2026-11-04T12:00:00Z', authors: [[AGENT], [AGENT]], headlines: ['DEM-3: document paging', 'DEM-40: document background'] }),
  ];
  const tickets = [{ key: 'DEM-3', summary: 'Paging', issueType: 'Bug', status: 'Done', resolution: 'Done', assignee: 'Sara Colombo', resolved: '2026-10-01T13:00:00Z', links: [] }];
  const g = buildGraph({ project: 'DEM', vcsKind: 'git', commits, events, prs, tickets });

  assert.deepEqual(g.tickets.map((t) => t.key), ['DEM-2', 'DEM-3', 'DEM-40'], 'LAB-1 belongs to another project');
  const dem40 = g.tickets.find((t) => t.key === 'DEM-40');
  assert.deepEqual(dem40.changes, ['f898df2aaaa']);
  assert.equal(dem40.exists, false, 'Jira was read and has no DEM-40: deleted');
  assert.deepEqual(dem40.prs, [24, 9]);
  assert.equal(dem40.analyses[0].model, 'claude-sonnet-5-5');
  assert.equal(dem40.fixAttempts[0].costUsd, 1.1);
  assert.deepEqual(dem40.reviews.map((r) => [r.pr, r.verdict]), [[24, 'looks-good']]);
  assert.deepEqual(dem40.steps.map((s) => s.type), ['picked', 'analyzed', 'pr', 'fix-proposed', 'reviewed', 'commit', 'pr-merged', 'pr-merged']);

  const dem3 = g.tickets.find((t) => t.key === 'DEM-3');
  assert.equal(dem3.assignee, 'Sara Colombo');
  assert.equal(g.commits.find((c) => c.short === '74acd34').agent, false);
  assert.deepEqual(g.tickets.find((t) => t.key === 'DEM-2').mentions, ['74acd34aaaa']);

  const fixPr = g.prs.find((p) => p.number === 24);
  assert.deepEqual([fixPr.kind, fixPr.run, fixPr.outcome, fixPr.mergedAs], ['fix', true, 'merged-unchanged', 'f898df2']);
  const docsPr = g.prs.find((p) => p.number === 9);
  assert.deepEqual([docsPr.kind, docsPr.keys, docsPr.mergedAs], ['docs', ['DEM-3', 'DEM-40'], 'd703a75']);

  const edges = graphEdges(g);
  assert.ok(edges.some((e) => e.from === 'pr:24' && e.to === 'commit:f898df2' && e.kind === 'merged-as'));
  assert.ok(edges.some((e) => e.from === 'ticket:DEM-3' && e.to === 'pr:9' && e.kind === 'documented-in'));
});

test('a PR with the agent\'s commits but no run of its own (planted by hand) is not one of its fixes', () => {
  const g = buildGraph({ project: 'DEM', vcsKind: 'git', commits: [], events: [], prs: [pr(12, 'DEM-90', { state: 'CLOSED', closedAt: '2026-11-06T08:04:11Z', comments: ['Reviewer test done'] })] });
  assert.deepEqual([g.prs[0].run, g.prs[0].outcome, g.prs[0].reason], [false, 'rejected', 'Reviewer test done']);
});

test('SVN: revisions without parents or pull requests, tickets from the commit messages', () => {
  const g = buildGraph({ project: 'DEM', vcsKind: 'svn', commits: [commit('r12', 'DEM-5: PULISCI clears the Struttura field', { author: 'sara.colombo' })], events: [] });
  assert.equal(g.vcs, 'svn');
  assert.deepEqual(g.tickets[0].changes, ['r12']);
  assert.equal(g.tickets[0].exists, null, 'Jira not read: unknown, not deleted');
});
