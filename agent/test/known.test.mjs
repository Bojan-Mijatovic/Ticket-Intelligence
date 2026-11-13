import assert from 'node:assert/strict';
import { test } from 'node:test';
import { knownProblems } from '../../.claude/skills/analyze-ticket/scripts/lib/known.mjs';
import { normalizePriorArt } from '../lib/analyze.mjs';
import { fixBlocker } from '../lib/pipeline.mjs';

const target = { key: 'LAB-30', created: '2026-11-13T09:00:00Z' };
const related = [
  { key: 'LAB-23', summary: 'decimal comma saved without decimals', status: 'Done', resolution: 'Done', relevance: 0.62 },
  { key: 'LAB-31', summary: 'decimal comma in the Referto', status: 'To Do', resolution: null, relevance: 0.41 },
  { key: 'LAB-7', summary: 'results story', status: 'Done', resolution: 'Done', relevance: 0.2 },
];
const code = {
  ticketCommits: [{ short: 'a427822', date: '2026-11-10T09:47:00+01:00', subject: 'LAB-23: parse decimal comma', keys: ['LAB-23'] }],
  otherFixBranches: [{ branch: 'origin/LAB-31', key: 'LAB-31', files: ['frontend/src/app/features/results/result-entry.component.ts'], lastCommit: '2026-11-12' }],
  knowledgeDocs: { entries: [{ key: 'LAB-23', title: 'Decimal comma', file: 'docs/knowledge/risultati-e-referti.md', anchor: 'lab-23-decimal-comma', why: 'entry of a related ticket (relevance 0.62)', symptom: 's', rootCause: 'r', fix: 'f' }] },
};

test('known problems: open and resolved related tickets above the threshold, other fix branches, knowledge entries', () => {
  const k = knownProblems({ target, related, code });
  assert.deepEqual(k.candidates.map((c) => [c.kind, c.key]), [['resolved', 'LAB-23'], ['open', 'LAB-31'], ['fix-branch', 'LAB-31'], ['documented', 'LAB-23']]);
  const lab23 = k.candidates[0];
  assert.equal(lab23.fixedBeforeThisTicket, true);
  assert.match(lab23.why, /fix a427822 \(2026-11-10\), before this ticket was reported/);
  assert.equal(k.candidates[3].entry, 'docs/knowledge/risultati-e-referti.md#lab-23-decimal-comma');
  assert.match(k.summary, /1 open, 1 resolved, 1 fix branch/);
  assert.match(knownProblems({ target, related: [], code: null }).summary, /^nothing found/);
});

test('the analysis answer is normalized: unknown kinds are none, an old duplicateOf counts', () => {
  assert.deepEqual(normalizePriorArt({ priorArt: { kind: 'Fixed-On-Main', key: 'lab-23', commit: 'a427822', why: 'fixed 11-10' } }), { kind: 'fixed-on-main', key: 'LAB-23', commit: 'a427822', branch: null, entry: null, why: 'fixed 11-10' });
  assert.equal(normalizePriorArt({ priorArt: { kind: 'maybe' } }).kind, 'none');
  assert.deepEqual(normalizePriorArt({ duplicateOf: { key: 'LAB-31', why: 'same' } }), { kind: 'duplicate', key: 'LAB-31', commit: null, branch: null, entry: null, why: 'same' });
  assert.equal(normalizePriorArt({}).kind, 'none');
});

test('no automatic fix when it is already known as a duplicate, in progress or fixed on main; a regression is fixed', () => {
  const policy = { actions: { proposeFix: 'auto' }, proposeFixWhen: { minConfidence: 'high', titleTags: ['FE'] } };
  const issue = { key: 'LAB-30', summary: '[FE] - Risultati: decimal comma' };
  const r = (kind) => ({ confidence: 'high', priorArt: { kind, key: 'LAB-23' } });
  assert.equal(fixBlocker({ issue, result: r('fixed-on-main'), policy }), 'already known: fixed on main by LAB-23');
  assert.equal(fixBlocker({ issue, result: { confidence: 'high', priorArt: { kind: 'in-progress', key: 'LAB-31', branch: 'origin/LAB-31' } }, policy }), 'already known: fix in progress LAB-31 (origin/LAB-31)');
  assert.equal(fixBlocker({ issue, result: r('regression'), policy }), null);
  assert.equal(fixBlocker({ issue, result: r('none'), policy }), null);
  assert.equal(fixBlocker({ issue, result: r('fixed-on-main'), policy: { ...policy, proposeFixWhen: { ...policy.proposeFixWhen, skipKnown: [] } } }), null);
});
