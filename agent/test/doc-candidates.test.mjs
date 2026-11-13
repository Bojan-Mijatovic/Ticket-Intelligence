import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coverage, keyCommitsOf, pickCandidates } from '../lib/doc-candidates.mjs';
import { fixSource } from '../lib/document.mjs';

const rec = (hash, date, subject, body = '') => `${hash}\x1f${date}\x1f${subject}\x1f${body}\x1e`;

test('fix commits per key: from subject and body, exact keys only (DEM-1 is not DEM-10), newest first', () => {
  const m = keyCommitsOf(rec('aaa1111', '2026-10-20', 'DEM-18: birth date typed as dd/MM/yyyy') + rec('bbb2222', '2026-06-09', 'DEM-3: paging', 'see also DEM-10') + rec('ccc3333', '2026-05-01', 'DEM-3: first try'));
  assert.deepEqual([...m.keys()].sort(), ['DEM-10', 'DEM-18', 'DEM-3']);
  assert.deepEqual(m.get('DEM-3').map((c) => c.hash), ['bbb2222', 'ccc3333']);
  assert.equal(m.has('DEM-1'), false);
});

const known = {
  keyCommits: new Map([['DEM-3', [{ hash: 'b', date: '2026-06-09' }]], ['DEM-5', [{ hash: 'a', date: '2026-05-02' }]], ['DEM-22', [{ hash: 'c', date: '2025-12-01' }]], ['DEM-27', [{ hash: 'd', date: '2026-09-16' }]], ['DEM-29', [{ hash: 'e', date: '2026-11-02' }]]]),
  documented: new Set(['DEM-29']),
  pending: new Set(['DEM-27']),
  fixBranches: new Set(),
};
const tickets = [
  { key: 'DEM-3', issueType: 'Bug', labels: [], summary: 'paging' },
  { key: 'DEM-5', issueType: 'Bug', labels: ['no-ai'], summary: 'PULISCI' },
  { key: 'DEM-14', issueType: 'Story', labels: [], summary: 'form' },
  { key: 'DEM-21', issueType: 'Bug', labels: [], summary: 'no commit' },
  { key: 'DEM-22', issueType: 'Bug', labels: [], summary: 'old fix' },
  { key: 'DEM-27', issueType: 'Bug', labels: [], summary: 'waiting' },
  { key: 'DEM-29', issueType: 'Bug', labels: [], summary: 'documented' },
];

test('candidates: resolved bugs with a fix on main, not documented, not waiting; every other ticket with its reason', () => {
  const { take, skipped } = pickCandidates(tickets, known, { since: '2026-01-01', skipLabels: ['no-ai'] });
  assert.deepEqual(take.map((t) => t.key), ['DEM-3']);
  assert.deepEqual(Object.fromEntries(skipped.map((s) => [s.key, s.reason])), {
    'DEM-5': 'label no-ai',
    'DEM-14': 'type Story',
    'DEM-21': 'no fix commit on main',
    'DEM-22': 'fix before 2026-01-01',
    'DEM-27': 'documentation waiting on its docs/ branch',
    'DEM-29': 'documented on main',
  });
  assert.deepEqual(pickCandidates(tickets, known, { types: ['Bug', 'Story'] }).take.map((t) => t.key), ['DEM-3', 'DEM-5', 'DEM-22']);
});

test('coverage: documented and waiting, of the resolved bugs with a fix on main', () => {
  assert.deepEqual(coverage(tickets, known), { fixed: 5, documented: 1, waiting: 1 });
});

test('the documentation prompt points at the fix: the ticket branch, or the commits on main', () => {
  assert.match(fixSource('DEM-7', { fixBranch: true, fixPr: 'https://x/pull/3' }), /branch origin\/DEM-7 \(pull request https:\/\/x\/pull\/3\).*origin\/main\.\.origin\/DEM-7/s);
  assert.match(fixSource('DEM-7'), /The fix is on main: .*--grep="DEM-7".*DEM-70 is another ticket/s);
});
