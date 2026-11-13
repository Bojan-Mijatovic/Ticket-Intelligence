import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { scoreBisects } from '../lib/accuracy.mjs';
import { bisectForPrompt, bisectJira, bisectLinear, bisectSummary, failureKind, namedCommits, planGoodPoints, runBisect } from '../lib/bisect.mjs';
import { buildGraph } from '../lib/git-graph.mjs';
import { suggestOwnerFromBisect } from '../lib/pipeline.mjs';

const judgeFrom = (firstBad, skip = new Set()) => async (i) => (skip.has(i) ? 'skip' : i >= firstBad ? 'bad' : 'good');

test('bisect over 45 commits finds the first bad one in at most 6 test runs', async () => {
  for (const firstBad of [0, 1, 17, 30, 44]) {
    const r = await bisectLinear(45, judgeFrom(firstBad));
    assert.equal(r.status, 'found');
    assert.equal(r.hi, firstBad);
    assert.ok(r.steps.length <= 6, `${r.steps.length} steps for ${firstBad}`);
  }
});

test('a commit the test cannot run on is skipped for its neighbour; all of them skipped gives a range', async () => {
  const r = await bisectLinear(20, judgeFrom(9, new Set([4])));
  assert.equal(r.status, 'found');
  assert.equal(r.hi, 9);
  assert.ok(r.steps.some((s) => s.index === 3), 'the neighbour of the skipped middle is judged');
  // 8 good, 9 and 10 skipped, 11 bad: the first bad one is 9, 10 or 11, as `git bisect skip` says.
  const range = await bisectLinear(12, judgeFrom(9, new Set([9, 10])));
  assert.deepEqual([range.status, range.lo, range.hi], ['range', 8, 11]);
  const all = await bisectLinear(6, judgeFrom(3, new Set([0, 1, 2, 3, 4])));
  assert.deepEqual([all.status, all.lo, all.hi], ['range', -1, 5]);
});

test('the time limit stops the search with the range found so far', async () => {
  let t = 0;
  const r = await bisectLinear(45, async (i) => {
    t += 1000;
    return i >= 30 ? 'bad' : 'good';
  }, { deadline: 2500, now: () => t });
  assert.equal(r.status, 'timeout');
  assert.ok(r.hi - r.lo > 1 && r.hi - r.lo < 45);
});

test('how a browser test fails: an assertion, or something else (the page is not there yet)', () => {
  assert.equal(failureKind('Error: expect(received).toBe(expected)\nExpected: "H"'), 'assertion');
  assert.equal(failureKind('Error: expect(locator).toHaveCSS(expected) failed\nTimeout: 5000ms'), 'assertion');
  assert.equal(failureKind('locator.click: Timeout 30000ms exceeded.'), 'other');
  assert.equal(failureKind(''), null);
});

test('commits the analysis names: hashes with a letter and a digit, not dates or plain numbers', () => {
  const a = { likelyCause: 'commit 6185f5f (2026-11-02) replaced the check; 20261102 is a date', jiraComment: 'see a1b2c3d4e5 and deadbeef', priorArt: { commit: '9f3e2a1' } };
  assert.deepEqual(namedCommits(a), ['6185f5f', 'a1b2c3d4e5'], 'the earlier fix (priorArt) is a good point of its own');
});

// A repository with ten commits a day apart; commit 6 breaks value.txt, commit 3 cannot be tested (skip.txt).
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'bisect-'));
  const git = (args, env = {}) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } }).trim();
  git(['init', '-q', '-b', 'main']);
  const shas = [];
  for (let i = 0; i < 10; i++) {
    writeFileSync(join(dir, 'value.txt'), i >= 6 ? 'broken\n' : 'ok\n');
    writeFileSync(join(dir, 'n.txt'), `${i}\n`);
    if (i === 3) writeFileSync(join(dir, 'skip.txt'), 'x\n');
    if (i === 4) rmSync(join(dir, 'skip.txt'));
    git(['add', '-A']);
    const date = `2026-10-${String(10 + i).padStart(2, '0')}T10:00:00Z`;
    git(['-c', 'user.name=Sara Colombo', '-c', 'user.email=s@x', 'commit', '-q', '-m', i === 6 ? 'LAB-7: tidy the value' : `LAB-${i + 1}: change ${i}`], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
    shas.push(git(['rev-parse', 'HEAD']));
  }
  return { dir, git: (a) => git(a), shas };
}

// The fake judge: reads the checkout, and checks that the test file was written into it.
const fakeTest = async ({ path, testRel }) => {
  assert.ok(existsSync(join(path, testRel)), 'the test is written into each checkout');
  if (existsSync(join(path, 'skip.txt'))) return { verdict: 'skip', why: 'cannot run here' };
  return readFileSync(join(path, 'value.txt'), 'utf8').trim() === 'ok' ? { verdict: 'good', why: 'passes' } : { verdict: 'bad', why: 'broken', kind: 'assertion' };
};

test('good points: the earlier fix of a regression, the commit before a named one, the last before the window; newest first', () => {
  const { dir, git, shas } = repo();
  try {
    const bad = shas[9];
    const c = planGoodPoints({ analysis: { priorArt: { kind: 'regression', key: 'LAB-2', commit: shas[1].slice(0, 7) }, likelyCause: `probably ${shas[7].slice(0, 7)}`, jiraComment: `regression of LAB-2, fixed by ${shas[1].slice(0, 7)}` }, created: '2026-10-25T00:00:00Z', windowDays: 14, git, bad });
    assert.deepEqual(c.map((x) => x.sha), [shas[6], shas[1], shas[0]]);
    assert.match(c[0].why, /before .* which the analysis names/);
    assert.match(c[1].why, /earlier fix of LAB-2/);
    assert.match(planGoodPoints({ analysis: {}, created: '2026-10-25T00:00:00Z', windowDays: 14, git, bad })[0].why, /14-day suspect window/);
    assert.deepEqual(planGoodPoints({ analysis: {}, created: null, git, bad }), [], 'nothing to go on');
    // VAX-13: the analysis gave the commit that broke it as priorArt.commit; its parent is still the good point.
    const breaker = planGoodPoints({ analysis: { priorArt: { kind: 'regression', key: 'LAB-2', commit: shas[6].slice(0, 7) } }, created: null, git, bad });
    assert.deepEqual(breaker.map((x) => x.sha), [shas[6], shas[5]]);
    assert.match(breaker[1].why, /the commit before .{7}, which the analysis names/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bisect on a real repository: the commit that broke it, with its ticket; a skipped commit on the way', async () => {
  const { dir, git, shas } = repo();
  const work = mkdtempSync(join(tmpdir(), 'bisect-work-'));
  try {
    const candidates = [{ sha: shas[0], why: 'the commit given', date: '' }];
    const b = await runBisect({ repoDir: dir, workDir: work, side: 'backend', testRel: 'src/test/X.java', testText: 'class X {}', bad: shas[9], candidates, checkBad: true, runTest: fakeTest });
    assert.equal(b.status, 'found');
    assert.equal(b.culprit.sha, shas[6]);
    assert.equal(b.culprit.ticket, 'LAB-7');
    assert.equal(b.culprit.author, 'Sara Colombo');
    assert.ok(b.steps.length <= 6);
    assert.ok(!existsSync(join(work, 'bisect')), 'the worktree is removed');
    assert.equal(git(['worktree', 'list']).split('\n').length, 1);
    assert.match(bisectSummary(b), /^broken by .{7} "LAB-7: tidy the value"/);
    assert.match(bisectJira(b), /fails from \*\{\{.{7}\}\} LAB-7: tidy the value\*/);
    assert.match(bisectForPrompt(b), /git show/);
    assert.doesNotMatch(bisectForPrompt(b, { role: 'review' }), /git show/);

    // A newer good point that already fails is a known bad one; the older one is the good point.
    const two = await runBisect({ repoDir: dir, workDir: work, side: 'backend', testRel: 'src/test/X.java', testText: '', bad: shas[9], candidates: [{ sha: shas[8], why: 'a' }, { sha: shas[2], why: 'b' }], runTest: fakeTest });
    assert.equal(two.culprit.sha, shas[6]);

    // The test fails on every candidate: the bug is older than the oldest.
    const older = await runBisect({ repoDir: dir, workDir: work, side: 'backend', testRel: 'src/test/X.java', testText: '', bad: shas[9], candidates: [{ sha: shas[7], why: 'the commit before x' }], runTest: fakeTest });
    assert.equal(older.status, 'older');
    assert.equal(older.since.sha, shas[7]);

    // The test passes on main: nothing to look for.
    const passing = await runBisect({ repoDir: dir, workDir: work, side: 'backend', testRel: 'src/test/X.java', testText: '', bad: shas[5], candidates, checkBad: true, runTest: fakeTest });
    assert.equal(passing.status, 'not-failing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
});

test('the author of the breaking change becomes a draft assignee, unless it is the agent or already the owner', () => {
  const sent = [];
  const events = { emit: (type, e) => sent.push({ type, ...e }) };
  const policy = { actions: { assignOwner: 'draft' } };
  const bisect = { status: 'found', culprit: { short: 'abc1234', subject: 'LAB-7: tidy', ticket: 'LAB-7', author: 'Sara Colombo', agent: false } };
  assert.equal(suggestOwnerFromBisect({ key: 'LAB-30', result: { owner: { name: 'Luca Bianchi' } }, bisect, policy, events }), true);
  assert.match(sent[0].why, /abc1234 "LAB-7: tidy" \(LAB-7\)/);
  assert.equal(suggestOwnerFromBisect({ key: 'LAB-30', result: { owner: { name: 'sara colombo' } }, bisect, policy, events }), false);
  assert.equal(suggestOwnerFromBisect({ key: 'LAB-30', result: {}, bisect: { ...bisect, culprit: { ...bisect.culprit, agent: true } }, policy, events }), false);
  assert.equal(suggestOwnerFromBisect({ key: 'LAB-30', result: {}, bisect: { status: 'range' }, policy, events }), false);
});

test('bisect runs in the accuracy: found, time, and agreement with the blame origin after the fix', () => {
  const ev = (key, at, bisect) => ({ at, type: 'bisected', key, text: `bisect: ${bisect.status}`, bisect });
  const found = (short) => ({ status: 'found', culprit: { short, ticket: 'LAB-7' }, steps: [1, 2, 3, 4], durationMs: 120_000 });
  const graph = buildGraph({ project: 'LAB', vcsKind: 'git', commits: [], events: [ev('LAB-30', '2026-11-10T10:00:00Z', found('abc1234')), ev('LAB-31', '2026-11-11T10:00:00Z', found('def5678')), ev('LAB-32', '2026-11-12T10:00:00Z', { status: 'older', since: { short: 'x' }, steps: [1], durationMs: 30_000 })] });
  const b = scoreBisects(graph, new Map([['LAB-30', 'abc1234'.padEnd(40, '0')], ['LAB-31', '9999999'.padEnd(40, '0')]]));
  assert.deepEqual([b.runs, b.found, b.older], [3, 2, 1]);
  assert.deepEqual(b.agreeWithBlame, { n: 1, of: 2, rate: 0.5 });
  assert.equal(graph.tickets.find((t) => t.key === 'LAB-30').steps.some((s) => s.type === 'bisected'), true, 'a step of the ticket lane');
});
