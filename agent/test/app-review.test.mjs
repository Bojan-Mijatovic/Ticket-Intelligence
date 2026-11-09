import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkReview, citationsOf, fingerprintOf, reviewFacts } from '../lib/app-review.mjs';

const KNOWN = {
  keys: new Set(['LAB-2', 'LAB-13', 'BIL-17']),
  hashes: new Set(['1923561', 'ce51e69']),
  files: new Set(['backend/src/main/java/com/medilab/order/OrderService.java', 'frontend/src/app/shared/patient-picker/patient-picker.component.ts']),
  components: new Set(['Richieste', 'Campioni']),
};

test('citations: ticket keys, commit hashes with a letter, file paths and names', () => {
  const c = citationsOf('LAB-2 (1923561, ce51e69) broke OrderService.java and frontend/src/app/x/y.component.ts; 2026 and 1234567 are numbers');
  assert.deepEqual(c.keys, ['LAB-2']);
  assert.deepEqual(c.hashes, ['ce51e69']); // 1923561 has no letter: not taken for a hash (it is still known as a ticket's commit by its key)
  assert.deepEqual(c.files, ['OrderService.java', 'frontend/src/app/x/y.component.ts']);
});

test('review check: items without a known citation are dropped, files must exist, bare file names resolve', () => {
  const answer = {
    evaluation: {
      summary: 'Fair.',
      scores: [
        { area: 'Reliability', score: 2, why: 'LAB-2 brought in six bugs.' },
        { area: 'Test safety net', score: 3, why: 'Few tests.' }, // no citation
        { area: 'Made up', score: 4, why: 'LAB-2' }, // unknown area
        { area: 'Maintainability', score: 9, why: 'LAB-2' }, // out of range
        { area: 'Knowledge spread', score: 3, why: 'Bus factor 3 for Richieste, 2 elsewhere.' }, // a component of the facts
      ],
      strengths: ['The patient picker is shared (patient-picker.component.ts).', 'Good overall.'],
      risks: ['LAB-99 is unknown.', 'Timeouts: see ce51e69.'],
    },
    findings: [
      { component: 'Richieste', file: 'OrderService.java', problem: 'Status not checked', evidence: 'LAB-2 and LAB-13', fix: 'x', prevent: 'y', priority: 'high' },
      { component: 'X', file: 'backend/src/main/java/Nope.java', problem: 'p', evidence: 'LAB-2', fix: 'x', prevent: 'y', priority: 'low' },
      { component: 'X', file: 'OrderService.java:42', problem: 'p', evidence: 'I think so', fix: 'x', prevent: 'y', priority: 'low' },
    ],
    refactors: [
      { title: 'Shared picker', files: ['patient-picker.component.ts', 'Gone.ts'], why: 'BIL-17 was fixed in one copy only.', steps: ['a'], effort: 'M', payoff: 'p' },
      { title: 'Nothing real', files: ['Gone.ts'], why: 'LAB-2' },
    ],
    growth: [
      { title: 'Results to MediFarma', why: 'Builds on the results API.', buildsOn: ['LAB-13'] },
      { title: 'AI everywhere', why: 'Trendy.', buildsOn: [] },
    ],
  };
  const r = checkReview(answer, KNOWN);
  assert.deepEqual(r.evaluation.scores.map((s) => s.area), ['Reliability', 'Knowledge spread']);
  assert.deepEqual(r.evaluation.strengths, ['The patient picker is shared (patient-picker.component.ts).']);
  assert.deepEqual(r.evaluation.risks, ['Timeouts: see ce51e69.']);
  assert.deepEqual(r.findings.map((f) => f.file), ['backend/src/main/java/com/medilab/order/OrderService.java']);
  assert.deepEqual(r.refactors.map((x) => x.files), [['frontend/src/app/shared/patient-picker/patient-picker.component.ts']]);
  assert.deepEqual(r.growth.map((g) => g.title), ['Results to MediFarma']);
  assert.equal(r.dropped.length, 1 + 1 + 1 + 2 + 1 + 1); // score, strength, risk, 2 findings, refactor, growth
});

test('review facts carry no people and the fingerprint follows the facts', () => {
  const insights = {
    totals: { bugs: 1 }, testCoverage: {}, hotspots: ['A'], riskFiles: [], recurring: [],
    components: [{ name: 'A', bugs: 1, openBugs: 0, priorityBugs: 1, tickets: 1, commits: 2, churnLines: 3, busFactor: 1, repeatFiles: [], bugKeys: ['X-1'], authors: [{ name: 'Sara' }], team: [{ name: 'Sara', share: 100 }] }],
    origins: { medianDaysInCode: 5, fromFixes: [], byChange: [], bugs: [{ key: 'X-1', priority: 'High', component: 'A', fix: 'aaaaaaa', daysInCode: 5, origin: { ticket: 'X-0', hash: 'bbbbbbb', author: 'Sara' } }] },
    shared: { pairs: [] }, stats: { byTypePriority: {}, openByPriority: {}, byComponent: {} },
    tickets: [{ key: 'X-1', type: 'Bug', status: 'Done', priority: 'High', summary: 's', components: ['A'], commits: ['aaaaaaa'], links: [] }],
    people: [{ name: 'Sara' }],
  };
  const facts = reviewFacts(insights, { key: 'X', name: 'App' });
  assert.ok(!JSON.stringify(facts).includes('Sara'));
  const again = reviewFacts({ ...insights, generatedAt: 'later' }, { key: 'X', name: 'App' });
  assert.equal(fingerprintOf(facts), fingerprintOf(again));
  insights.components[0].churnLines = 1; // the 90-day window moved on: not a change of the data
  assert.equal(fingerprintOf(reviewFacts(insights, { key: 'X', name: 'App' })), fingerprintOf(facts));
  insights.tickets[0].status = 'To Do';
  assert.notEqual(fingerprintOf(reviewFacts(insights, { key: 'X', name: 'App' })), fingerprintOf(facts));
});
