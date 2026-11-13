import assert from 'node:assert/strict';
import { test } from 'node:test';
import { priorArtOk, scoreAnswer, suggestionVerdict, summarize } from '../../demo/lib/eval.mjs';

const map = (k) => ({ 'CUP_DEMO-2511': 'DEM-5' })[k] ?? k;

test('ask eval: a found answer passes with its expected tickets; a cited commit counts for the keys in its subject', () => {
  const q = { found: true, expect: ['CUP_DEMO-2511', 'DEM-22'], min: 2 };
  const answer = { found: true, answer: '…', sources: [{ type: 'ticket', ref: 'dem-22' }, { type: 'commit', ref: 'a8939f4' }], dropped: 0 };
  const s = scoreAnswer(q, answer, { map, commits: new Map([['a8939f4', ['DEM-5']]]) });
  assert.equal(s.pass, true);
  assert.deepEqual(s.hits, ['DEM-5', 'DEM-22']);
  assert.equal(scoreAnswer(q, { ...answer, sources: answer.sources.slice(0, 1) }, { map }).pass, false, 'one of two is not enough with min 2');
});

test('ask eval: not found must be not found; files and names are checked', () => {
  assert.equal(scoreAnswer({ found: false }, { found: false, sources: [] }).pass, true);
  assert.equal(scoreAnswer({ found: false }, { found: true, sources: [] }).pass, false);
  const q = { found: true, expect: ['DEM-18'], min: 0, files: ['frontend/src/app/shared/utils/dates.ts'], names: ['Sara Colombo'] };
  const ok = scoreAnswer(q, { found: true, answer: 'Sara Colombo wrote it', sources: [{ type: 'file', ref: 'frontend/src/app/shared/utils/dates.ts' }] });
  assert.equal(ok.pass, true);
  const bad = scoreAnswer(q, { found: true, answer: 'Marta Ricci', sources: [] });
  assert.deepEqual(bad.checks.filter(([, x]) => !x).map(([l]) => l), ['file dates.ts', 'names']);
});

test('ask eval: summary counts passes, correct found, invented sources, time and cost', () => {
  const rows = [
    { score: { pass: true, checks: [['found', true]], dropped: 0 }, answer: { meta: { durationMs: 10_000, costUsd: 0.1 } } },
    { score: { pass: false, checks: [['found', false]], dropped: 2 }, answer: { meta: { durationMs: 30_000, costUsd: 0.3 } } },
  ];
  assert.deepEqual(summarize(rows), { questions: 2, pass: 1, foundCorrect: 1, invented: 2, avgSeconds: 20, avgCost: 0.2, totalCost: 0.4 });
});

test('prior art: what a suggestion says today, and whether it is the expected verdict', () => {
  assert.deepEqual(suggestionVerdict({}), { verdict: 'new', key: null });
  assert.deepEqual(suggestionVerdict({ openAs: 'LAB-24' }), { verdict: 'ticket-exists', key: 'LAB-24' });
  assert.deepEqual(suggestionVerdict({ created: { key: 'LAB-24' } }), { verdict: 'ticket-exists', key: 'LAB-24' });
  assert.deepEqual(suggestionVerdict({ priorArt: { verdict: 'fixed-by', key: 'LAB-23' } }), { verdict: 'fixed-by', key: 'LAB-23' });
  assert.equal(priorArtOk({ verdicts: ['fixed-by'], key: 'LAB-23' }, { verdict: 'new', key: null }), false);
  assert.equal(priorArtOk({ verdicts: ['fixed-by'], key: 'LAB-23' }, { verdict: 'fixed-by', key: 'LAB-23' }), true);
  assert.equal(priorArtOk({ verdicts: ['duplicate'], key: 'CUP_DEMO-2511' }, { verdict: 'duplicate', key: 'DEM-5' }, map), true);
  assert.equal(priorArtOk({ verdicts: ['new'] }, { verdict: 'new', key: null }), true);
});
