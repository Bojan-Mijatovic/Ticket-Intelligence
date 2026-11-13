import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { applyEdits, nextActions, redactionScore, reportDelayMinutes, scoreRun, summarize, ticketHelpers } from '../../demo/lib/pilot.mjs';
import { checkLetter, passesCheck, syntheticFiscalCode, syntheticPatients } from '../../demo/lib/synthetic-patients.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', '..', 'demo', 'src', 'medivax');
const { CASES } = await import(pathToFileURL(join(SRC, 'pilot-cases.mjs')).href);
const patients = JSON.parse(readFileSync(join(SRC, 'template', 'e2e', 'support', 'api-data.json'), 'utf8')).patients;
const { createRedactor } = await import(pathToFileURL(join(HERE, '..', '..', '.claude', 'skills', 'analyze-ticket', 'scripts', 'lib', 'redact.mjs')).href);

test('synthetic fiscal codes have the official shape and fail the official check', () => {
  assert.equal(checkLetter('RSSMRA80A01H501'), 'U', 'the official algorithm (a known valid code)');
  assert.ok(passesCheck('RSSMRA80A01H501U'));
  const code = syntheticFiscalCode({ lastName: 'Rossi', firstName: 'Mario', birthDate: '1980-01-01', sex: 'M', town: 'H501' });
  assert.equal(code, 'RSSMRA80A01H501V');
  assert.equal(passesCheck(code), false);
  const list = syntheticPatients(30);
  assert.equal(list.length, 30);
  assert.equal(list.filter((p) => passesCheck(p.fiscalCode)).length, 0);
  assert.deepEqual(syntheticPatients(30), list, 'the same seed gives the same patients');
  assert.ok(list.some((p) => p.rareName), 'some names the redaction list does not know');
});

test('the seed of MediVax is synthetic: no fiscal code passes the check', () => {
  assert.equal(patients.filter((p) => passesCheck(p.fiscalCode)).length, 0);
});

test('a case applies when each text to change occurs once on main', () => {
  const files = { 'a.java': 'int x = 2;\nint y = 2;\n' };
  const ok = applyEdits((f) => files[f], [{ file: 'a.java', from: 'int x = 2;', to: 'int x = 3;' }]);
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.files.get('a.java'), 'int x = 3;\nint y = 2;\n');
  const twice = applyEdits((f) => files[f], [{ file: 'a.java', from: ' = 2;', to: ' = 3;' }]);
  assert.match(twice.problems[0], /occurs 2 times/);
});

test('the schedule: working days, from the configured hours, one case in flight, reports after the delay', () => {
  const cases = [{ id: 'a' }, { id: 'b' }];
  const cfg = { perDay: 2, hours: [10, 15], reportAfterMinutes: [60, 60] };
  const at = (s) => new Date(s);
  assert.equal(nextActions({ runs: [], cases, now: at('2026-11-14T11:00:00'), cfg }).why, 'not a working day');
  assert.match(nextActions({ runs: [], cases, now: at('2026-11-16T09:00:00'), cfg }).why, /from 10:00/);
  assert.equal(nextActions({ runs: [], cases, now: at('2026-11-16T10:05:00'), cfg }).plant.id, 'a');
  const planted = [{ id: 'a#1', case: 'a', status: 'planted', plantedAt: at('2026-11-16T10:05:00').toISOString() }];
  const soon = nextActions({ runs: planted, cases, now: at('2026-11-16T10:30:00'), cfg });
  assert.deepEqual([soon.plant, soon.report.length], [null, 0]);
  assert.equal(nextActions({ runs: planted, cases, now: at('2026-11-16T11:10:00'), cfg }).report.length, 1);
  const reported = [{ ...planted[0], status: 'reported' }];
  assert.match(nextActions({ runs: reported, cases, now: at('2026-11-16T12:00:00'), cfg }).why, /from 15:00/);
  assert.equal(nextActions({ runs: reported, cases, now: at('2026-11-16T15:01:00'), cfg }).plant.id, 'b');
  assert.match(nextActions({ runs: [...reported, { id: 'b#1', case: 'b', status: 'reported', plantedAt: at('2026-11-17T10:00:00').toISOString() }], cases, now: at('2026-11-17T15:00:00'), cfg }).why, /every case/);
  const d = reportDelayMinutes('x#1', [60, 180]);
  assert.ok(d >= 60 && d <= 180);
  assert.equal(reportDelayMinutes('x#1', [60, 180]), d, 'fixed per run');
});

test('every case writes a ticket that quotes synthetic patients, and the masking is measured on it', () => {
  const team = ['Irene Fabbri', 'Federica Gallo', 'Tommaso Bruno', 'Anna Lombardi'];
  let quoted = 0;
  let masked = 0;
  for (const c of CASES) {
    const { h, identifiers } = ticketHelpers({ patients, day: '2026-11-16', seed: 7 });
    const t = c.ticket(h);
    assert.match(t.summary, new RegExp(`^\\[${c.side}\\] - `), c.id);
    assert.ok(identifiers.some((i) => i.kind === 'FISCAL_CODE'), `${c.id} quotes a patient`);
    for (const i of identifiers.filter((x) => x.kind === 'FISCAL_CODE')) assert.equal(passesCheck(i.value), false);
    const r = redactionScore(createRedactor({ allow: team }).text(t.description), identifiers);
    quoted += r.quoted;
    masked += r.masked;
    assert.ok(!t.description.includes('undefined'), c.id);
    assert.ok(c.answer.files.length && c.answer.owners.length, c.id);
  }
  assert.ok(masked < quoted, 'the rare names are missed: the pilot measures misses, not only hits');
  assert.ok(masked / quoted > 0.6);
});

test('a case is scored against its answer key from the agent\'s events', () => {
  const run = { ticket: 'VAX-20', case: 'due-last-day', sha: 'a'.repeat(40), short: 'aaaaaaa', story: 'VAX-19', reportedAt: '2026-11-16T11:00:00Z' };
  const answer = { files: ['backend/src/main/java/com/medivax/schedule/DueService.java'], owners: ['Federica Gallo'] };
  const events = [
    { at: '2026-11-16T11:03:00Z', type: 'analyzed', key: 'VAX-20', result: { files: ['backend/src/main/java/com/medivax/schedule/DueService.java:44'], owner: { name: 'Federica Gallò' }, likelyCause: 'aaaaaaa changed isAfter to isBefore', confidence: 'high', priorArt: { kind: 'none' } }, meta: { costUsd: 0.4 } },
    { at: '2026-11-16T11:06:00Z', type: 'bisected', key: 'VAX-20', bisect: { status: 'found', culprit: { sha: 'a'.repeat(40), short: 'aaaaaaa' }, durationMs: 90_000 } },
    { at: '2026-11-16T11:12:00Z', type: 'fix-proposed', key: 'VAX-20', url: 'https://github.com/o/r/pull/1', files: answer.files, meta: { costUsd: 1.1 } },
  ];
  const s = scoreRun(run, answer, events);
  assert.deepEqual([s.analysed, s.files.hit, s.culpritNamed, s.owner.hit, s.minutesToAnalysis], [true, true, true, true, 3]);
  assert.deepEqual([s.fix.outcome, s.fix.filesHit, s.bisect.exact, s.costUsd], ['pr', true, true, 1.5]);
  const sum = summarize([s, scoreRun({ ...run, ticket: 'VAX-22' }, answer, [])]);
  assert.deepEqual([sum.cases, sum.analysed, sum.files], [2, 1, { n: 1, of: 1 }]);
});
