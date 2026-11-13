import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { codeFiles, compareFiles, normalizeFile, priorArtOutcome, recordAccuracy, reviewAgreement, scoreAccuracy } from '../lib/accuracy.mjs';
import { buildGraph } from '../lib/git-graph.mjs';

const AGENT = 'Ticket Intelligence Agent';
const RULES = [
  { name: 'Pazienti', paths: ['frontend/src/app/features/patients/'] },
  { name: 'Shared', paths: ['frontend/src/app/shared/', 'frontend/src/styles.scss'] },
];

test('files as the analysis names them: line numbers, backslashes and linked apps; tests and docs left out', () => {
  assert.equal(normalizeFile('frontend\\src\\a.ts:42'), 'frontend/src/a.ts');
  assert.equal(normalizeFile('frontend/src/a.ts:42-48'), 'frontend/src/a.ts');
  assert.equal(normalizeFile('DEM:backend/src/x.java'), null);
  assert.deepEqual(codeFiles(['e2e/tests/DEM-5.spec.ts', 'backend/src/test/java/XTest.java', 'docs/knowledge/a.md', 'src/a.ts', 'src/a.ts:3']), ['src/a.ts']);
});

test('compare files: a shortened path is the same file; precision and recall', () => {
  const r = compareFiles(['services/structure.service.ts', 'frontend/src/app/x.ts'], ['frontend/src/app/shared/services/structure.service.ts']);
  assert.deepEqual([r.hit, r.precision, r.recall], [true, 0.5, 1]);
  assert.equal(compareFiles(['a.ts'], ['b.ts']).hit, false);
});

test('"already known?": no own change needed is right when the ticket closes without one, wrong when it gets one', () => {
  assert.equal(priorArtOutcome('duplicate', { ownChange: false, resolved: '2026-11-02', resolution: 'Duplicate' }), 'right');
  assert.equal(priorArtOutcome('fixed-on-main', { ownChange: true, resolved: '2026-11-02' }), 'wrong');
  assert.equal(priorArtOutcome('duplicate', { ownChange: false, resolved: null }), 'pending');
  assert.equal(priorArtOutcome('none', { ownChange: true }), 'right');
  assert.equal(priorArtOutcome('none', { ownChange: false, resolved: '2026-11-02', links: [{ type: 'Duplicate' }] }), 'wrong');
});

test('a review agrees: looks good and merged unchanged, needs changes and changed or rejected; open is pending', () => {
  assert.equal(reviewAgreement('looks-good', 'merged-unchanged'), 'agree');
  assert.equal(reviewAgreement('needs-changes', 'rejected'), 'agree');
  assert.equal(reviewAgreement('looks-good', 'merged-changed'), 'disagree');
  assert.equal(reviewAgreement('looks-good', 'withdrawn'), 'pending');
});

// DEM-3: analysed, then fixed by a person (an independent case). DEM-40: analysed, fixed by the agent (shown apart).
// DEM-7: analysed only after its fix (not a prediction). DEM-8: said duplicate, closed as one without a change.
function suite() {
  const c = (hash, subject, author, files, date, body = '') => ({ hash, short: hash.slice(0, 7), subject, author, files, date, body, parents: [] });
  const commits = [
    c('f898df2aaaa', 'DEM-40: red background (#24)', 'Bojan-Mijatovic', ['frontend/src/styles.scss', 'e2e/tests/DEM-40.spec.ts'], '2026-11-03T12:00:00Z', `Co-authored-by: ${AGENT} <a@b>`),
    c('74acd34aaaa', 'DEM-3: reset the paging', 'Sara Colombo', ['frontend/src/app/features/patients/patient-search.component.ts', 'frontend/src/app/features/patients/patient-search.component.html'], '2026-11-02T12:00:00Z'),
    c('1111111aaaa', 'DEM-7: fix', 'Luca Bianchi', ['frontend/src/app/shared/date.ts'], '2026-10-01T12:00:00Z'),
  ];
  const an = (key, at, files, owner, extra = {}) => ({ at, type: 'analyzed', key, result: { confidence: 'high', files, owner: { name: owner }, ...extra }, meta: { costUsd: 0.25, durationMs: 50_000 } });
  const events = [
    an('DEM-3', '2026-11-01T09:00:00Z', ['frontend/src/app/features/patients/patient-search.component.ts:88', 'frontend/src/app/shared/pager.ts'], 'Sara Colombó'),
    an('DEM-40', '2026-11-03T09:00:00Z', ['frontend/src/styles.scss:2'], 'Marta Ricci'),
    an('DEM-7', '2026-11-05T09:00:00Z', ['frontend/src/app/shared/date.ts'], 'Luca Bianchi'),
    an('DEM-8', '2026-11-05T09:00:00Z', ['frontend/src/app/x.ts'], 'Unassigned (team lead / triage)', { priorArt: { kind: 'duplicate', key: 'DEM-3' } }),
    { at: '2026-11-03T09:10:00Z', type: 'pr', key: 'DEM-40', url: 'https://github.com/o/r/pull/24' },
    { at: '2026-11-03T09:10:01Z', type: 'fix-proposed', key: 'DEM-40', url: 'https://github.com/o/r/pull/24' },
    { at: '2026-11-03T09:12:00Z', type: 'reviewed', key: 'DEM-40', url: 'https://github.com/o/r/pull/24#r', review: { risk: 'low', verdict: 'looks-good', findings: [] }, meta: { costUsd: 0.2 } },
    { at: '2026-11-04T09:10:00Z', type: 'pr', key: 'DEM-9', url: 'https://github.com/o/r/pull/25' },
  ];
  const prs = [
    { number: 24, branch: 'DEM-40', title: 't', state: 'MERGED', mergedAt: '2026-11-03T12:00:00Z', closedAt: '2026-11-03T12:00:00Z', url: 'https://github.com/o/r/pull/24', commits: [{ oid: 'a', headline: 'DEM-40: x', authors: [AGENT] }], comments: [] },
    { number: 25, branch: 'DEM-9', title: 't', state: 'CLOSED', mergedAt: null, closedAt: '2026-11-04T12:00:00Z', url: 'https://github.com/o/r/pull/25', commits: [{ oid: 'b', headline: 'DEM-9: x', authors: [AGENT] }], comments: ['replaced by DEM-10'] },
  ];
  const tickets = [
    { key: 'DEM-3', issueType: 'Bug', status: 'Done', resolution: 'Done', assignee: 'Sara Colombo', resolved: '2026-11-02T13:00:00Z', links: [] },
    { key: 'DEM-8', issueType: 'Bug', status: 'Done', resolution: 'Duplicate', assignee: null, resolved: '2026-11-06T10:00:00Z', links: [] },
  ];
  return buildGraph({ project: 'DEM', vcsKind: 'git', commits, events, prs, tickets });
}

test('accuracy of a project: a person\'s fix apart from the agent\'s own, owner by person, prior art, PRs, reviews', () => {
  const acc = scoreAccuracy(suite(), { rules: RULES, now: new Date('2026-11-13T10:00:00Z') });
  const row = (k) => acc.rows.find((r) => r.key === k);

  assert.equal(row('DEM-7').skipped, 'analysed only after its change was on main (not a prediction)');
  assert.deepEqual([row('DEM-3').fixer, row('DEM-3').files.hit, row('DEM-3').files.precision, row('DEM-3').files.recall], ['person', true, 0.5, 0.5]);
  assert.equal(row('DEM-3').ownerHit, true, 'the same person with and without an accent');
  assert.equal(row('DEM-3').componentHit, true);
  assert.equal(row('DEM-40').fixer, 'agent');
  assert.equal(row('DEM-40').files.actual.length, 1, 'the regression test is not where the problem was');
  assert.equal(row('DEM-8').priorArtOutcome, 'right');

  assert.deepEqual(acc.analysis.filesVsPerson.hit, { n: 1, of: 1, rate: 1 });
  assert.deepEqual(acc.analysis.filesVsAgent.hit, { n: 1, of: 1, rate: 1 });
  assert.deepEqual(acc.analysis.owner, { n: 1, of: 1, rate: 1 });
  assert.equal(acc.analysis.runs, 4);
  assert.equal(acc.analysis.costUsd, 1);
  assert.equal(acc.fix['merged-unchanged'], 1);
  assert.equal(acc.fix.rejected, 1);
  assert.deepEqual(acc.fix.closed.map((c) => [c.number, c.reason]), [[25, 'replaced by DEM-10']]);
  assert.deepEqual(acc.fix.acceptedUnchanged, { n: 1, of: 2, rate: 0.5 });
  assert.deepEqual(acc.review.agreement, { n: 1, of: 1, rate: 1 });
});

test('one snapshot a day: today\'s is replaced, the trend keeps the days in order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acc-'));
  try {
    const acc = scoreAccuracy(suite(), { rules: RULES, now: new Date('2026-11-13T10:00:00Z') });
    recordAccuracy(dir, { ...acc, at: '2026-11-12T10:00:00Z' });
    recordAccuracy(dir, acc);
    const list = recordAccuracy(dir, acc);
    assert.deepEqual(list.map((s) => s.day), ['2026-11-12', '2026-11-13']);
    assert.deepEqual(list[1].filesVsPerson, { n: 1, of: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
