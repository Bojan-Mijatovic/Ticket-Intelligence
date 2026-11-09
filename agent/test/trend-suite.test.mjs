import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { historyTrend, parseGitLog, recordSnapshot, snapshotDelta, snapshotOf } from '../lib/insights.mjs';
import { sharedGroups, suiteInsights } from '../lib/suite.mjs';

test('history trend: commits, tickets and bugs per month, and the code at the end of each month', () => {
  const repo = mkdtempSync(join(tmpdir(), 'trend-'));
  const git = (args, date) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  git(['init', '-q']);
  git(['config', 'user.email', 't@example.com']);
  git(['config', 'user.name', 'T']);
  const put = (path, lines) => {
    mkdirSync(join(repo, path, '..'), { recursive: true });
    writeFileSync(join(repo, path), Array.from({ length: lines }, (_, i) => `line ${i}`).join('\n') + '\n');
  };
  put('backend/src/main/java/com/x/order/OrderService.java', 10);
  git(['add', '.']);
  git(['commit', '-q', '-m', 'X-1: orders'], '2026-03-10T10:00:00+01:00');
  put('backend/src/test/java/com/x/order/OrderServiceTest.java', 5);
  put('backend/src/main/java/com/x/order/OrderController.java', 20);
  git(['add', '.']);
  git(['commit', '-q', '-m', 'X-2: fix and test'], '2026-04-20T10:00:00+02:00');
  const log = git(['log', '--no-merges', '--numstat', '--format=%x1e%H%x1f%aI%x1f%an%x1f%s%x1f']);
  const insights = { months: ['2026-02', '2026-03', '2026-04'], stats: { byMonth: { '2026-02': { tickets: 0, bugs: 0 }, '2026-03': { tickets: 1, bugs: 0 }, '2026-04': { tickets: 1, bugs: 1 } } } };
  const t = historyTrend({ repoDir: repo, stateDir: join(repo, '.state'), commits: parseGitLog(log), insights });
  assert.deepEqual(t.map((m) => [m.month, m.commits, m.tickets, m.bugs]), [['2026-02', 0, 0, 0], ['2026-03', 1, 1, 0], ['2026-04', 1, 1, 1]]);
  assert.equal(t[0].code, null); // nothing committed yet
  assert.deepEqual([t[1].code.lines, t[1].code.unitTested, t[1].code.unitTotal, t[1].unitTestShare], [10, 0, 1, 0]);
  assert.deepEqual([t[2].code.lines, t[2].code.files, t[2].code.unitTested, t[2].code.unitTotal, t[2].unitTestShare], [30, 2, 1, 2, 50]);
});

const INS = (over = {}) => ({
  totals: { bugs: 5, openBugs: 2, priorityBugs: 3, openPriorityBugs: 1, tickets: 9, commits: 20 },
  recurring: [{ key: 'A-3', of: 'A-1', crossProject: false }],
  shared: { toCheck: 1 },
  components: [{ name: 'X', busFactor: 1, tickets: 3 }, { name: 'Y', busFactor: 2, tickets: 3 }],
  origins: { medianDaysInCode: 12 },
  testCoverage: { backend: { tested: 2, total: 6 }, screens: { tested: 3, total: 4 } },
  ...over,
});

test('snapshots: one per day (the last of the day wins), and the change since the first', () => {
  const dir = mkdtempSync(join(tmpdir(), 'snap-'));
  const s1 = snapshotOf(INS(), { evaluation: { scores: [{ score: 3 }, { score: 4 }] } }, new Date('2026-11-01T10:00:00Z'));
  assert.deepEqual([s1.date, s1.openBugs, s1.busFactorOne, s1.reviewScore, s1.unitTested], ['2026-11-01', 2, 1, 3.5, 2]);
  recordSnapshot(dir, s1);
  recordSnapshot(dir, snapshotOf(INS({ totals: { ...INS().totals, openBugs: 9 } }), null, new Date('2026-11-01T18:00:00Z')));
  assert.equal(snapshotDelta(recordSnapshot(dir, snapshotOf(INS(), null, new Date('2026-11-01T20:00:00Z')))), null); // one day: no change yet
  const later = INS({ totals: { ...INS().totals, openBugs: 1 }, testCoverage: { backend: { tested: 4, total: 6 }, screens: { tested: 4, total: 4 } } });
  const all = recordSnapshot(dir, snapshotOf(later, null, new Date('2026-11-08T10:00:00Z')));
  assert.equal(all.length, 2);
  const d = snapshotDelta(all);
  assert.deepEqual([d.from, d.to, d.openBugs, d.unitTested, d.screensTested], ['2026-11-01', '2026-11-08', -1, 2, 1]);
});

const PAIR = (path, peer, peerPath, o = {}) => ({ path, peer, peerPath, identical: false, similarity: 80, bugsHere: [], bugsThere: [], checkHere: [], checkThere: [], ...o });

test('shared groups: copies of one file across apps, joined through any pair; bugs and checks per copy', () => {
  const g = sharedGroups([
    { key: 'LAB', shared: { pairs: [PAIR('l/Handler.java', 'DEM', 'd/Handler.java', { bugsHere: ['LAB-13'], checkThere: ['LAB-13'] }), PAIR('l/Handler.java', 'FAR', 'f/Handler.java', { identical: true, bugsHere: ['LAB-13'] })] } },
    { key: 'DEM', shared: { pairs: [PAIR('d/Handler.java', 'LAB', 'l/Handler.java', { checkHere: ['LAB-13'], bugsThere: ['LAB-13'] })] } },
    { key: 'BIL', shared: { pairs: [PAIR('b/picker.ts', 'FAR', 'f/picker.ts', { identical: true })] } },
  ]);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0].copies.map((c) => c.project), ['DEM', 'FAR', 'LAB']);
  assert.deepEqual(g[0].checks, [{ project: 'DEM', key: 'LAB-13' }]); // once, although both apps see it
  assert.deepEqual(g[0].bugs, ['LAB-13']);
  assert.equal(g[0].allIdentical, false);
  assert.equal(g[1].allIdentical, true);
});

test('suite: a link between two apps once, integrations with the bugs across them, each missing fix counted once', () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'suite-'));
  const P = (key, linked = [], relations = {}) => ({ key, name: `App ${key}`, linked, stateDir, cfg: { relations } });
  const D = (over) => ({
    ...INS(), months: ['2026-10', '2026-11'], hotspots: ['X'], trend: [{ month: '2026-10', bugs: 1 }, { month: '2026-11', bugs: 2 }], snapshotDelta: null,
    tickets: [], shared: { toCheck: 0, pairs: [] }, ...over,
  });
  const s = suiteInsights([
    { project: P('LAB', ['DEM']), data: D({ recurring: [{ key: 'LAB-19', of: 'BIL-17', crossProject: true, priority: 'High', component: 'Shared' }], tickets: [{ key: 'LAB-19', summary: 'picker forgets the patient' }], shared: { toCheck: 1, pairs: [PAIR('l/H.java', 'DEM', 'd/H.java', { checkThere: ['LAB-13'] })] } }), review: null },
    { project: P('BIL', ['LAB'], { LAB: 'reported requests' }), data: D({ recurring: [{ key: 'BIL-17', of: 'LAB-19', crossProject: true, priority: 'High', component: 'Shared' }] }), review: { at: '2026-11-09', evaluation: { scores: [{ score: 3 }] } } },
    { project: P('DEM'), data: D({ shared: { toCheck: 1, pairs: [PAIR('d/H.java', 'LAB', 'l/H.java', { checkHere: ['LAB-13'] })] } }), review: null },
  ]);
  assert.equal(s.crossLinks.length, 1);
  assert.equal(s.crossLinks[0].summary, 'picker forgets the patient');
  assert.deepEqual(s.integrations.map((i) => [i.from, i.to, i.uses, i.linkedBugs]), [['LAB', 'DEM', '', 0], ['BIL', 'LAB', 'reported requests', 1]]);
  assert.equal(s.totals.toCheck, 1);
  assert.deepEqual(s.bugsPerMonth, [{ month: '2026-10', bugs: 3 }, { month: '2026-11', bugs: 6 }]);
  assert.equal(s.apps.find((a) => a.key === 'BIL').review.score, 3);
  assert.deepEqual(s.apps[0].busFactorOne, ['X']);
});
