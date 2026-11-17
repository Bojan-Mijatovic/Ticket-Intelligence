import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askStats, kindOf } from '../lib/ask-stats.mjs';

const NOW = new Date('2026-11-18T12:00:00Z'); // a Wednesday: this week starts on Monday 2026-11-16
const ASKS = [
  // last week: before Ask 3/7 (no "via"): one System 1 answer, one Claude answer
  { at: '2026-11-12T10:00:00Z', question: 'Who knows Prenotazioni?', found: true, fast: true, costUsd: 0, durationMs: 400 },
  { at: '2026-11-12T11:00:00Z', question: 'Why are cancelled visits charged?', found: true, costUsd: 0.4, durationMs: 30000 },
  // this week
  { at: '2026-11-17T09:00:00Z', question: 'VAX-21', found: true, fast: true, via: 'records', intent: 'ticket', costUsd: 0, durationMs: 1700 },
  { at: '2026-11-17T09:10:00Z', question: 'Which bugs did Scadenze have?', found: true, fast: true, via: 'rule', costUsd: 0, durationMs: 300 },
  { at: '2026-11-17T09:20:00Z', question: 'Until which day can a lot be used?', found: true, via: 'claude', costUsd: 0.2, durationMs: 22000 },
  { at: '2026-11-17T09:30:00Z', question: 'until which day can a LOT be used', found: true, via: 'claude', cachedFrom: '2026-11-17T09:20:00Z', costUsd: 0, durationMs: 0 },
  { at: '2026-11-17T09:40:00Z', question: 'How is the invoice exported?', found: false, via: 'claude', costUsd: 0.3, durationMs: 40000 },
];
const FEEDBACK = [
  { answerAt: '2026-11-12T11:00:00Z', vote: 'down', note: 'it is MediBill, not MediAgenda' },
  { answerAt: '2026-11-12T11:00:00Z', vote: 'up' }, // changed its mind: the last vote counts
  { answerAt: '2026-11-17T09:20:00Z', vote: 'up' },
  { answerAt: '2026-11-17T09:40:00Z', vote: 'down', note: 'the export is in the Report page' },
];

test('how an answer was made: before and after Ask 3/7, and an answer given again', () => {
  assert.deepEqual(ASKS.map(kindOf), ['fast', 'claude', 'fast', 'fast', 'claude', 'reused', 'claude']);
});

test('the Ask numbers: this week and last, without an AI run, found, rated right (the last vote counting), cost', () => {
  const s = askStats([{ project: 'VAX', name: 'MediVax', asks: ASKS, feedback: FEEDBACK }, { project: 'LAB', name: 'MediLab', asks: [], feedback: [] }], { weeks: 2, now: NOW });
  assert.deepEqual(s.weeks.map((w) => [w.week, w.asked, w.fast, w.claude, w.reused]), [['2026-11-09', 2, 1, 1, 0], ['2026-11-16', 5, 2, 2, 1]]);
  const t = s.total;
  assert.deepEqual([t.asked, t.fast, t.reused, t.claude, t.found, t.up, t.down], [7, 3, 1, 3, 6, 2, 1]);
  assert.deepEqual(t.withoutAi, { n: 4, of: 7, rate: 4 / 7 });
  assert.deepEqual(t.upRate, { n: 2, of: 3, rate: 2 / 3 }, 'of the rated answers');
  assert.deepEqual([t.costUsd, t.costPerClaude, t.secondsFast, t.secondsClaude], [0.9, 0.3, 0.8, 31], 'a given-again answer is not timed with either');
  assert.deepEqual(s.perProject.map((p) => p.project), ['VAX'], 'an app with no question is left out');
  assert.deepEqual(s.wrong, [{ project: 'VAX', at: '2026-11-17T09:40:00Z', question: 'How is the invoice exported?', note: 'the export is in the Report page' }], 'a vote changed to 👍 is not wrong any more');
  const none = askStats([], { weeks: 1, now: NOW });
  assert.deepEqual([none.total.asked, none.total.withoutAi, none.total.upRate, none.total.costPerClaude], [0, null, null, null]);
});
