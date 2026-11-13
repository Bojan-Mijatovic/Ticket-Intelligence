import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coverageByComponent, knowledgeGaps } from '../lib/gaps.mjs';
import { suggestTickets } from '../lib/suggestions.mjs';

const asks = [
  { at: '2026-11-06T08:34:18Z', question: 'How do we export the monthly bookings to SAP?', found: false },
  { at: '2026-11-07T10:00:00Z', question: 'Is the SAP export of bookings scheduled every night?', found: false },
  { at: '2026-11-08T10:00:00Z', question: 'Who knows the time slot code best?', found: true },
  { at: '2026-11-09T10:00:00Z', question: 'Why are cancelled visits charged?', found: true },
  { at: '2026-11-12T16:06:12Z', question: 'show me last bug ?', found: false, warnings: ['Jira search (latest tickets) failed: 401'] },
];

test('gaps: not found and marked wrong, grouped by shared words; a failed Jira search or a 👍 is no gap', () => {
  const gaps = knowledgeGaps({ asks, feedback: [{ answerAt: '2026-11-09T10:00:00Z', vote: 'down', note: 'the cause is in MediAgenda' }, { answerAt: '2026-11-07T10:00:00Z', vote: 'up' }] });
  // Same count: the most recent question first.
  assert.deepEqual(gaps.map((g) => [g.count, g.questions.map((q) => q.why)]), [[1, ['marked as wrong']], [1, ['not found']]]);
  assert.equal(gaps.find((g) => g.questions[0].why === 'marked as wrong').questions[0].note, 'the cause is in MediAgenda');
  const two = knowledgeGaps({ asks });
  assert.equal(two[0].count, 2);
  assert.ok(two[0].terms.includes('export') || two[0].terms.includes('bookings'), two[0].terms.join(','));
});

test('a gap asked twice becomes a suggested ticket; once is not enough', () => {
  const insights = { tickets: [], components: [], riskFiles: [], shared: { pairs: [] } };
  const gaps = knowledgeGaps({ asks });
  const s = suggestTickets({ insights, project: 'DEM', gaps }).filter((x) => x.source === 'knowledge-gap');
  assert.equal(s.length, 1);
  assert.match(s[0].summary, /^Document: .*\(questions without an answer\)$/);
  assert.match(s[0].description, /these 2 questions/);
  assert.match(s[0].description, /How do we export the monthly bookings to SAP\?/);
});

test('coverage per component: resolved bugs and which have an entry', () => {
  const components = [{ name: 'Prenotazioni', bugKeys: ['DEM-24', 'DEM-27', 'DEM-30'] }, { name: 'Report', bugKeys: [] }];
  const tickets = [{ key: 'DEM-24', type: 'Bug', status: 'Done' }, { key: 'DEM-27', type: 'Bug', status: 'Done' }, { key: 'DEM-30', type: 'Bug', status: 'To Do' }];
  assert.deepEqual(coverageByComponent(components, tickets, ['DEM-24']), [{ component: 'Prenotazioni', resolved: 2, documented: 1, missing: ['DEM-27'] }]);
});
