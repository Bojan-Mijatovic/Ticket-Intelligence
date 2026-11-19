import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { commitChange, knowledgeEntry, presentationFacts, unmask } from '../lib/tour.mjs';

// A small world on disk: the watcher's state, a project's state (work, pilot, asks), a repository's knowledge base.
function world() {
  const root = mkdtempSync(join(tmpdir(), 'ti-facts-'));
  const state = join(root, 'state');
  const proj = join(state, 'projects', 'VAX');
  const repo = join(root, 'repo');
  const put = (file, data) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); };
  const ev = (at, type, key, extra = {}) => ({ at: `2026-11-16T16:${at}Z`, type, key, ...extra });
  const events = [
    { at: '2026-11-16T14:09:53Z', type: 'guard', key: 'VAX-20', short: '6e8e6e1', text: 'regression guard: 6e8e6e1 "VAX-20: take the last dose": touches no earlier bug fix' },
    ev('05:08', 'queued', 'VAX-21', { text: '[BE] - the third dose is due too early' }),
    ev('05:12', 'system1', 'VAX-21', { ms: 3200, answers: { type: { choice: 'bug in code', p: 0.84 } } }),
    ev('05:12', 'picked', 'VAX-21', { text: '[BE] - the third dose is due too early' }),
    ev('06:02', 'analyzed', 'VAX-21', { meta: { costUsd: 0.25, durationMs: 50000 }, result: { confidence: 'high', likelyCause: 'Hypothesis, high confidence. Commit 6e8e6e1 took the first dose. More.', owner: { name: 'Irene Fabbri', why: 'She authored VAX-20.' }, files: ['Schedule.java:28'], priorArt: { kind: 'regression', key: 'VAX-5' } } }),
    ev('06:03', 'notified', 'VAX-21', { card: { to: 'Irene Fabbri', why: 'She authored VAX-20.' } }),
    ev('07:38', 'reproduced', 'VAX-21', { text: 'bug reproduced: due 2026-09-05 instead of 2026-11-20' }),
    ev('08:01', 'bisected', 'VAX-21', { text: 'bisect: broken by 6e8e6e1 (1 test run(s), 22 s)' }),
    ev('09:20', 'fix-proposed', 'VAX-21', { url: 'https://x/pull/7', meta: { costUsd: 0.7 } }),
    ev('09:24', 'fix-notified', 'VAX-21', { card: { kind: 'fix', to: 'Irene Fabbri' } }),
    ev('10:08', 'reviewed', 'VAX-21', { review: { risk: 'low', verdict: 'looks-good', findings: [{ comment: 'One finding.' }] }, meta: { costUsd: 0.21 } }),
    { at: '2026-11-16T16:54:47Z', type: 'guard', short: '08b2cca', text: 'regression guard: 08b2cca "VAX-21: Compute the next dose (#7)": touches no earlier bug fix' },
    { at: '2026-11-17T15:53:08Z', type: 'teams-asked', text: 'VAX: someone asked in Teams: VAX-21' },
    { at: '2026-11-17T15:53:10Z', type: 'teams-answered', text: 'VAX: answered in Teams from the agent\'s records (no AI): VAX-21' },
    { at: '2026-11-17T19:45:05Z', type: 'queued', key: 'BIL-28', text: 'Problema in cassa' },
    { at: '2026-11-17T19:45:08Z', type: 'system1', key: 'BIL-28', missing: ['expected', 'environment'], answers: { type: { choice: 'unclear', p: 0.67, top: [] } } },
    { at: '2026-11-17T19:45:09Z', type: 'system1-held', key: 'BIL-28' },
    { at: '2026-11-17T19:46:37Z', type: 'reporter-answered', key: 'BIL-28' },
    { at: '2026-11-17T19:48:49Z', type: 'duplicate', key: 'BIL-28', of: 'BIL-23' },
    { at: '2026-11-13T14:59:50Z', type: 'guard', key: 'VAX-15', short: '5bf4f30', verdict: 'alert', fixes: [{ key: 'VAX-13', testsChanged: ['Vax13RegressionTest.java'] }], text: 'regression guard: 5bf4f30 "VAX-15: …" changes 2 line(s) the fix of VAX-13 wrote. More.' },
  ];
  put(join(state, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n'));
  put(join(state, 'digests', '2026-11-18.json'), { at: '2026-11-18T08:57:09Z', summary: 'Since Tue: 5 tickets analysed.', sections: [{ title: 'Done', lines: ['x'] }], counts: { analyzed: 5 } });
  put(join(state, 'system1', 'models', 'current.json'), { name: 'ft-5', replaced: 'ft-2', why: ['light path (x): no ticket about code skipped', 'expected: 96 % (current 54 %)', 'screen: 92 % (current 33 %)'] });
  put(join(state, 'system1', 'models', 'ft-5', 'questions.json'), { type: [], side: [], expected: [] });
  put(join(proj, 'work', 'VAX-21', 'ticket-VAX-21.json'), { target: { summary: '[BE] - the third dose is due too early', priority: 'High', description: 'The card of [PERSON_1] Laura (CF [FISCAL_CODE_1], [BIRTH_DATE_1]) says it is late.\n\nReported by a nurse.' } });
  put(join(proj, 'pilot', 'state.json'), { runs: [
    { case: 'interval-from-first', story: 'VAX-20', short: '6e8e6e1', author: 'Irene Fabbri', checks: 'backend tests pass (22)', ticket: 'VAX-21', reportedAt: '2026-11-16T16:04:05Z', identifiers: [{ kind: 'NAME', value: 'De Luca Laura' }, { kind: 'FISCAL_CODE', value: 'DLCLRA26D68F205F' }, { kind: 'BIRTH_DATE', value: '28/04/2026' }], redaction: { quoted: 3, masked: 3 } },
    { case: 'due-last-day-again', story: 'VAX-15', plantedAt: '2026-11-13T14:56:24Z', ticket: 'VAX-17', reportedAt: '2026-11-14T08:29:29Z' },
  ] });
  put(join(proj, 'pilot', 'score.json'), { summary: { cases: 7, analysed: 7, files: { n: 7, of: 7 }, costUsd: 14.79 } });
  put(join(proj, 'asks.jsonl'), [{ question: 'VAX-21', origin: 'teams', answer: 'VAX-21 · status', at: '2026-11-17T15:53:10Z', meta: { costUsd: 0 } }, { question: 'who knows', origin: 'teams', answer: 'x' }].map((x) => JSON.stringify(x)).join('\n'));
  put(join(state, 'projects', 'BIL', 'work', 'BIL-28', 'ticket-BIL-28.json'), { target: { description: 'Oggi non va, controllate per favore.' } });
  put(join(repo, 'docs', 'knowledge', 'scheda.md'), [
    '# Scheda', '', '## Known issues', '',
    '### VAX-21: Next dose due too early', '- **Type**: bug', '- **Root cause**: commit `6e8e6e1` took the first dose (**confirmed**). The order is **assumed**.', '- **Fix**: max().', '- **Test**: `backend/src/test/java/Vax21RegressionTest.java`', '',
  ].join('\n'));
  const stateDirOf = (k) => join(state, 'projects', k.split('-')[0]);
  const repoDirOf = () => repo;
  return { root, state, stateDirOf, repoDirOf };
}

test('unmask: each placeholder gets its identifier; a name takes the first name the masking left', () => {
  const ids = [{ kind: 'NAME', value: 'De Luca Laura' }, { kind: 'FISCAL_CODE', value: 'DLCLRA26D68F205F' }, { kind: 'BIRTH_DATE', value: '28/04/2026' }];
  assert.equal(unmask('The card of [PERSON_1] Laura (CF [FISCAL_CODE_1], [BIRTH_DATE_1]).', ids), 'The card of De Luca Laura (CF DLCLRA26D68F205F, 28/04/2026).');
  assert.equal(unmask('[PERSON_1] came.', [{ kind: 'NAME', value: 'Rossi Mario' }]), 'Rossi Mario came.');
  assert.equal(unmask('no identifiers', []), null);
});

test('the case whole: times from the report, the masked report and its original, the breaking change, the entry and its test', () => {
  const w = world();
  try {
    const f = presentationFacts({ stateDir: w.state, pres: { case: 'VAX-21', live: 'VAX-23', system1: ['BIL-28'], catches: { guard: 'VAX-15', copies: 'LAB-13' } }, stateDirOf: w.stateDirOf, repoDirOf: w.repoDirOf, nightShift: { maxCostUsd: 5, digestAt: '08:00' }, policy: { actions: { a: 'auto', b: 'off' }, system1: { lightPath: 'auto', privacy: 'shadow', lightPathThreshold: 0.5 } } });
    const k = f.case;
    assert.equal(k.key, 'VAX-21');
    assert.deepEqual([k.t.picked, k.t.analyzed, k.t.notified, k.t.reproduced, k.t.bisected, k.t.fixNotified, k.t.merged, k.t.analysis], [67, 117, 118, 213, 236, 319, 3042, 50]);
    assert.equal(k.report.original, 'The card of De Luca Laura (CF DLCLRA26D68F205F, 28/04/2026) says it is late.');
    assert.match(k.report.masked, /\[PERSON_1\] Laura/);
    assert.equal(k.report.maskedCount, 3);
    assert.equal(k.breaking.author, 'Irene Fabbri');
    assert.match(k.breaking.guard, /touches no earlier bug fix/, 'the guard of the breaking commit, found by its hash');
    assert.equal(k.analysis.cause, 'Commit 6e8e6e1 took the first dose.', 'the hedge before the cause is dropped');
    assert.equal(k.priorArt.key, 'VAX-5');
    assert.equal(k.review.findings, 1);
    assert.equal(k.costUsd, 1.16);
    assert.equal(k.docs.entry.title, 'Next dose due too early');
    assert.match(k.docs.entry.test, /Vax21RegressionTest/);
    assert.equal(k.docs.entry.confirmed, true);
    assert.equal(f.teams.answer.question, 'ti: VAX-21');
    assert.equal(f.teams.answer.secs, 2);
    assert.deepEqual(f.teams.decisions, []);
    assert.equal(f.live, 'VAX-23');
    // System 1 asked the reporter: the question as posted, in the report's language.
    const s = f.system1[0];
    assert.equal(s.asked.secs, 4);
    assert.match(s.asked.text, /^Buongiorno/);
    assert.equal(s.replied.duplicateOf, 'BIL-23');
    assert.deepEqual(f.model.changes.map((x) => [x.question, x.before, x.now]), [['expected', 54, 96], ['screen', 33, 92]]);
    assert.equal(f.model.questions, 3);
    assert.equal(f.catches.guard.minutes, 3.4);
    assert.equal(f.catches.guard.hoursBefore, 17);
    assert.equal(f.catches.copies.key, 'LAB-13');
    assert.equal(f.digest.summary, 'Since Tue: 5 tickets analysed.');
    assert.equal(f.pilot.files.n, 7);
    assert.deepEqual(f.analyses, { n: 1, avgCostUsd: 0.25, avgSecs: 50 });
    assert.equal(f.policy.actions, 2);
    assert.deepEqual(f.policy.system1, [{ key: 'lightPath', mode: 'auto' }, { key: 'privacy', mode: 'shadow' }]);
  } finally {
    rmSync(w.root, { recursive: true, force: true });
  }
});

test('a fact that is not in the records is null, and nothing throws', () => {
  const w = world();
  try {
    const f = presentationFacts({ stateDir: w.state, pres: { case: 'DEM-99', system1: ['BIL-99'], catches: { cross: 'FAR-99', guard: 'VAX-99', review: 'VAX-98' } }, stateDirOf: w.stateDirOf, repoDirOf: () => null });
    assert.equal(f.case, null);
    assert.deepEqual(f.system1, []);
    assert.deepEqual(f.catches, {});
    assert.equal(f.policy, null);
    assert.equal(knowledgeEntry(null, 'VAX-21'), null);
    assert.equal(knowledgeEntry(w.repoDirOf(), 'VAX-99'), null);
  } finally {
    rmSync(w.root, { recursive: true, force: true });
  }
});

test("a developer's change as git shows it: the message, the date, the line and what it changed (read-only)", () => {
  const dir = mkdtempSync(join(tmpdir(), 'ti-change-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
    git('init', '-q');
    git('config', 'user.email', 'dev@example.org');
    git('config', 'user.name', 'A Developer');
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'Schedule.java'), 'class Schedule {\n  int a;\n  Dose last = given.stream().max(order).orElseThrow();\n  int b;\n}\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    writeFileSync(join(dir, 'src', 'Schedule.java'), 'class Schedule {\n  int a;\n  Dose last = given.get(0); // already ordered\n  int b;\n}\n');
    writeFileSync(join(dir, 'other.txt'), 'not this file\n');
    git('add', '.');
    git('commit', '-q', '-m', 'VAX-20: take the last dose without sorting again');
    const sha = git('rev-parse', '--short', 'HEAD');
    const ch = commitChange(dir, sha, 'src/Schedule.java');
    assert.equal(ch.message, 'VAX-20: take the last dose without sorting again');
    assert.equal(ch.line, 3);
    assert.deepEqual(ch.lines, [{ kind: 'del', text: 'Dose last = given.stream().max(order).orElseThrow();' }, { kind: 'add', text: 'Dose last = given.get(0); // already ordered' }]);
    assert.ok(ch.date);
    assert.equal(commitChange(dir, 'nope123', 'src/Schedule.java'), null, 'an unknown commit: nothing');
    assert.equal(commitChange(join(dir, 'missing'), sha), null, 'no repository: nothing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
