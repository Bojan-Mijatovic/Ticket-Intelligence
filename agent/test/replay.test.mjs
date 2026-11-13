import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { summarizeReplays } from '../lib/accuracy.mjs';
import { buildGraph } from '../lib/git-graph.mjs';
import { asReported, compareReplay, frozenClone, olderTicket, replayCandidates } from '../lib/replay.mjs';

const AGENT = 'Ticket Intelligence Agent';
const c = (hash, subject, author, files, date, body = '') => ({ hash, short: hash.slice(0, 7), subject, author, files, date, body, parents: [] });

test("candidates: resolved bugs a person fixed; what existed then is decided by git time, not by the ticket's number", () => {
  const graph = buildGraph({
    project: 'DEM', vcsKind: 'git',
    commits: [
      c('5555555aaaa', 'DEM-5: PULISCI clears Struttura', 'Sara Colombo', ['frontend/src/app/x.ts', 'e2e/tests/DEM-5.spec.ts'], '2026-06-10T10:00:00Z'),
      c('2828282aaaa', 'DEM-28: Altro needs a note', 'Marta Ricci', ['frontend/src/app/y.ts'], '2026-06-01T10:00:00Z'),
      c('4040404aaaa', 'DEM-40: background (#24)', 'Bojan-Mijatovic', ['frontend/src/styles.scss'], '2026-11-06T10:00:00Z', `Co-authored-by: ${AGENT} <a@b>`),
      c('3030303aaaa', 'DEM-30: story', 'Luca Bianchi', ['frontend/src/app/z.ts'], '2026-07-01T10:00:00Z'),
    ],
    events: [],
    tickets: [
      { key: 'DEM-5', issueType: 'Bug', assignee: 'Sara Colombo' },
      { key: 'DEM-28', issueType: 'Bug' },
      { key: 'DEM-40', issueType: 'Bug' },
      { key: 'DEM-30', issueType: 'Story' },
      { key: 'DEM-3', issueType: 'Task' },
      { key: 'DEM-9', issueType: 'Task' },
    ],
  });
  const list = replayCandidates(graph);
  assert.deepEqual(list.map((x) => x.key), ['DEM-5', 'DEM-28'], 'the agent fixed DEM-40; DEM-30 is a story');
  const dem5 = list[0];
  assert.deepEqual(dem5.actual, ['frontend/src/app/x.ts'], 'the regression test is left out');
  assert.deepEqual(dem5.known.sort(), ['DEM-28', 'DEM-3'], 'DEM-28 was fixed before DEM-5 although its number is higher; DEM-9 (no change) has a higher number');
  assert.deepEqual(dem5.people, ['Sara Colombo']);
});

test('the ticket as reported keeps what the reporter wrote and nothing that came after', () => {
  const issue = { key: 'DEM-5', summary: 's', description: 'd', status: 'Done', resolution: 'Fixed', assignee: { name: 'Sara' }, comments: [{ body: 'fixed in 3c2ab1d' }], links: [{ key: 'DEM-42' }], attachments: [{ id: 1 }], created: '2026-11-01T00:00:00Z' };
  const r = asReported(issue, '2026-06-10T10:00:00.000Z');
  assert.deepEqual([r.summary, r.description, r.status, r.resolution, r.assignee, r.comments, r.links, r.attachments, r.created], ['s', 'd', 'Open', null, null, [], [], [], '2026-06-10T10:00:00.000Z']);
  const older = olderTicket({ key: 'DEM-3', comments: [{ body: 'see DEM-5' }], links: [{ key: 'DEM-5' }, { key: 'DEM-2' }] }, new Set(['DEM-2']));
  assert.deepEqual([older.comments, older.links], [[], [{ key: 'DEM-2' }]]);
});

test('a replay compared with the real fix, and the summary of all replays', () => {
  const candidate = { key: 'DEM-5', changes: [{ short: '5555555' }], people: ['Sara Colombo'], actual: ['frontend/src/app/features/agenda/a.ts', 'frontend/src/app/shared/b.ts'] };
  const rules = [{ name: 'Agenda', paths: ['frontend/src/app/features/agenda/'] }];
  const hit = compareReplay({ candidate, rules, result: { confidence: 'high', files: ['frontend/src/app/features/agenda/a.ts:12', 'frontend/src/app/c.ts'], owner: { name: 'Sara Colombó' }, priorArt: { kind: 'none' } } });
  assert.deepEqual([hit.files.hit, hit.files.precision, hit.files.recall, hit.componentHit, hit.ownerHit, hit.priorArtOutcome], [true, 0.5, 0.5, true, true, 'right']);
  const miss = compareReplay({ candidate, rules, result: { confidence: 'low', files: ['backend/x.java'], owner: { name: 'Unassigned (team lead)' }, priorArt: { kind: 'duplicate', key: 'DEM-3' } } });
  assert.deepEqual([miss.files.hit, miss.ownerHit, miss.priorArtOutcome], [false, null, 'wrong'], 'it needed its own fix, so "duplicate" was wrong');
  const s = summarizeReplays([{ ...hit, meta: { costUsd: 0.3, durationMs: 30_000 } }, { ...miss, meta: { costUsd: 0.2, durationMs: 20_000 } }]);
  assert.deepEqual([s.tickets, s.files, s.owner, s.priorArt, s.costUsd, s.avgSeconds], [2, { n: 1, of: 2, rate: 0.5 }, { n: 1, of: 1, rate: 1 }, { n: 1, of: 2, rate: 0.5 }, 0.5, 25]);
  assert.deepEqual(s.byConfidence.high, { n: 1, of: 1, rate: 1 });
});

test('the frozen clone has the history up to the commit only: no later commit, tag or remote; a leak is refused', () => {
  const root = mkdtempSync(join(tmpdir(), 'replay-'));
  const g = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    const src = join(root, 'src');
    execFileSync('git', ['init', '-q', '-b', 'main', src]);
    const commit = (msg, file) => {
      writeFileSync(join(src, file), msg);
      g(src, 'add', file);
      g(src, '-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-q', '-m', msg);
      return g(src, 'rev-parse', 'HEAD');
    };
    commit('DEM-1: base', 'a.txt');
    const before = commit('DEM-2: feature', 'b.txt');
    const fix = commit('DEM-5: the fix', 'a.txt');
    commit('DEM-6: later', 'c.txt');
    g(src, 'tag', 'v1');
    g(src, 'branch', 'DEM-7');

    const dir = frozenClone({ repoDir: src, commit: `${fix}^`, dir: join(root, 'frozen'), key: 'DEM-5' });
    assert.equal(g(dir, 'rev-parse', 'HEAD'), before);
    assert.deepEqual(g(dir, 'log', '--all', '--format=%s').split('\n'), ['DEM-2: feature', 'DEM-1: base']);
    assert.equal(g(dir, 'tag'), '');
    assert.equal(g(dir, 'remote'), '');
    assert.equal(g(dir, 'cat-file', '-t', before), 'commit');
    assert.throws(() => g(dir, 'cat-file', '-e', fix), 'the fix object is pruned');
    assert.throws(() => frozenClone({ repoDir: src, commit: fix, dir: join(root, 'leak'), key: 'DEM-5' }), /still has the fix of DEM-5/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
