import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createSuggested, shortText, sideTag, suggestTickets } from '../lib/suggestions.mjs';

const RULES = [{ name: 'Risultati', paths: ['backend/src/main/java/com/x/result/', 'frontend/src/app/features/results/'] }, { name: 'Shared', paths: ['backend/src/main/java/com/x/common/'] }];
const RESULT_FORM = 'frontend/src/app/features/results/result-entry.component.ts';
const HANDLER = 'backend/src/main/java/com/x/common/GlobalExceptionHandler.java';

const INSIGHTS = {
  components: [
    { name: 'Risultati', tickets: 8, bugs: 4, bugKeys: ['LAB-8', 'LAB-11'], busFactor: 2, team: [{ name: 'Giorgio Esposito', share: 56 }, { name: 'Francesca Lombardi', share: 33 }] },
    { name: 'Shared', tickets: 5, bugs: 2, bugKeys: ['LAB-13'], busFactor: 1, team: [{ name: 'Chiara Marchetti', share: 73 }, { name: 'Roberto Ferri', share: 18 }] },
  ],
  riskFiles: [
    { path: HANDLER, component: 'Shared', why: ['1 bug fix', 'no test'], bugs: ['LAB-13'], test: 'none' },
    { path: RESULT_FORM, component: 'Risultati', why: ['2 bug fixes'], bugs: ['LAB-17'], test: 'e2e' },
  ],
  shared: { pairs: [{ path: HANDLER, peer: 'DEM', peerName: 'MediAgenda', peerPath: 'backend/src/main/java/com/d/common/GlobalExceptionHandler.java', similarity: 85, identical: false, checkHere: ['DEM-50'] }] },
  tickets: [{ key: 'LAB-30', summary: '[BE] - Shared: add a test for GlobalExceptionHandler.java' }],
};
const REVIEW = {
  at: '2026-11-09T12:00:00Z', stale: false,
  findings: [{ component: 'Risultati', file: RESULT_FORM, problem: "Values are parsed with parseFloat. It stops at the comma.", evidence: 'LAB-17 (6b79cd7) added the comma format.', fix: 'Use parseDecimal.', prevent: 'A unit test.', priority: 'high', ticket: 'decimal comma values are saved as whole numbers' }],
  refactors: [{ title: 'One state machine for requests and tubes', files: ['backend/src/main/java/com/x/result/ResultService.java', RESULT_FORM], why: 'LAB-9 and LAB-12.', steps: ['Enums', 'One place'], effort: 'M', payoff: 'Fewer bugs' }],
  growth: [{ title: 'Result history for MediFarma', why: 'MediFarma reads the latest creatinine (LAB-14).', buildsOn: ['LAB-14', 'backend/src/main/java/com/x/result/PatientResultController.java'], prerequisites: 'Store the unit.' }],
};

test('summary helpers: the first sentence cut at a word; the [BE]/[FE] tag from the files', () => {
  assert.equal(shortText('Values are parsed with parseFloat. It stops.'), 'Values are parsed with parseFloat');
  assert.equal(shortText('a'.repeat(10) + ' ' + 'b'.repeat(80), 20), 'aaaaaaaaaa…');
  assert.equal(sideTag([RESULT_FORM]), '[FE]');
  assert.equal(sideTag([RESULT_FORM, HANDLER]), '[BE][FE]');
  assert.equal(sideTag([]), '');
});

test('suggestions from the review and the facts, with the person who knows the component; existing tickets are left out', () => {
  const s = suggestTickets({ insights: INSIGHTS, review: REVIEW, rules: RULES, project: 'LAB' });
  const by = Object.fromEntries(s.map((x) => [x.source, x]));
  assert.equal(by['review-finding'].summary, '[FE] - Risultati: decimal comma values are saved as whole numbers');
  assert.equal(by['review-finding'].type, 'Bug');
  assert.equal(by['review-finding'].priority, 'High');
  assert.deepEqual(by['review-finding'].person, { name: 'Giorgio Esposito', why: 'knows Risultati: 56% of its commits' });
  assert.match(by['review-finding'].description, /h3\. Problem[\s\S]*h3\. Proposed fix[\s\S]*Sources: LAB-17, 6b79cd7/);
  assert.equal(by['review-refactor'].summary, '[BE][FE] - Refactor: One state machine for requests and tubes');
  assert.match(by['review-refactor'].description, /# Enums\n# One place/);
  assert.equal(by['review-growth'].type, 'Story');
  assert.equal(by['shared-check'].summary, '[BE] - Shared: check whether the DEM-50 fix applies to GlobalExceptionHandler.java');
  assert.equal(by['risk-test'], undefined); // "add a test for GlobalExceptionHandler.java" exists as LAB-30
  assert.equal(by['bus-factor'].person.name, 'Roberto Ferri'); // the second person learns it
  assert.equal(s[0].source, 'review-finding'); // High first
});

const fakeJira = (users) => {
  const calls = [];
  return { calls, assignableUsers: async () => users, createIssue: async (f) => { calls.push(f); return { key: 'LAB-31', url: 'https://jira/browse/LAB-31' }; } };
};

test('creating a suggestion: the person is assigned only with a matching Jira account; labels; edits win; created once', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'sugg-'));
  const [s] = suggestTickets({ insights: INSIGHTS, review: REVIEW, rules: RULES, project: 'LAB' });

  const nobody = fakeJira([{ accountId: 'a1', name: 'Bojan Mijatović' }]);
  const c1 = await createSuggested({ jira: nobody, project: 'LAB', stateDir, suggestion: s, edits: { summary: '  Edited  summary ', priority: 'Highest' } });
  assert.equal(c1.key, 'LAB-31');
  assert.equal(c1.assignee, null);
  assert.equal(nobody.calls[0].summary, 'Edited summary');
  assert.equal(nobody.calls[0].priority, 'Highest');
  assert.equal(nobody.calls[0].assigneeId, null);
  assert.deepEqual(nobody.calls[0].labels, ['ai-suggested', 'no-ai']);
  assert.match(nobody.calls[0].description, /Giorgio Esposito has no Jira account in LAB/);
  assert.equal(JSON.parse(readFileSync(join(stateDir, 'insights', 'suggestions-created.json'), 'utf8'))[s.id].key, 'LAB-31');

  const giorgio = fakeJira([{ accountId: 'g1', name: 'Giorgio Esposito' }]);
  const c2 = await createSuggested({ jira: giorgio, project: 'LAB', stateDir, suggestion: s, analyze: true });
  assert.equal(c2.assignee, 'Giorgio Esposito');
  assert.equal(giorgio.calls[0].assigneeId, 'g1');
  assert.deepEqual(giorgio.calls[0].labels, ['ai-suggested']);

  await assert.rejects(createSuggested({ jira: giorgio, project: 'LAB', stateDir, suggestion: s, edits: { type: 'Epic' } }), /type must be one of/);
});
