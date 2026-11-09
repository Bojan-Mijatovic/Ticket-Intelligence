import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bestRun, bestRuns, recordedAsks, runsOf, scoreRun } from '../lib/tour.mjs';

const ev = (key, type, at) => ({ key, type, at: `2026-11-09T12:${String(at).padStart(2, '0')}:00.000Z` });

test('a ticket picked again starts a new run; the review after done stays in its run', () => {
  const runs = runsOf([
    ev('DEM-1', 'queued', 1), ev('DEM-1', 'picked', 1), ev('DEM-1', 'analyzed', 2), ev('DEM-1', 'done', 3), ev('DEM-1', 'reviewed', 4),
    ev('DEM-1', 'picked', 10), ev('DEM-1', 'analyzed', 11),
    { type: 'status' },
  ]);
  assert.equal(runs.length, 2);
  assert.deepEqual(runs[0].events.map((e) => e.type), ['queued', 'picked', 'analyzed', 'done', 'reviewed']);
  assert.deepEqual(runs[1].events.map((e) => e.type), ['picked', 'analyzed']);
});

test('a run without an analysis is never chosen', () => {
  assert.equal(scoreRun({ events: [ev('DEM-1', 'picked', 1), ev('DEM-1', 'failed', 2)] }), -Infinity);
  assert.equal(bestRun([ev('DEM-1', 'picked', 1), ev('DEM-1', 'failed', 2)]), null);
});

const full = ['picked', 'analyzed', 'reproduced', 'verified', 'fix-proposed', 'reviewed'];
const events = [
  ...full.map((t, i) => ev('DEM-2', t, 10 + i)),
  ...[...full, 'fix-failed'].map((t, i) => ev('DEM-3', t, 20 + i)),
  ...['picked', 'analyzed'].map((t, i) => ev('DEM-4', t, 30 + i)),
  ...full.map((t, i) => ev('DEM-5', t, 40 + i)),
];

test('the fullest run wins, a failed fix counts against it, the newest wins a tie', () => {
  const best = bestRun(events);
  assert.equal(best.key, 'DEM-5');
  assert.equal(best.recordedAt, ev('DEM-5', 'picked', 40).at);
  assert.equal(bestRun(events, 'DEM-4').key, 'DEM-4', 'the configured ticket wins when it was recorded');
  assert.equal(bestRun(events, 'DEM-99').key, 'DEM-5', 'a configured ticket that was never recorded falls back to the best');
});

test('several configured tickets are replayed in their order; unrecorded ones are left out', () => {
  assert.deepEqual(bestRuns(events, ['DEM-4', 'DEM-99', 'DEM-2']).map((r) => r.key), ['DEM-4', 'DEM-2']);
  assert.deepEqual(bestRuns(events, ['DEM-99']).map((r) => r.key), ['DEM-5']);
});

test('recorded Ask answers: the example question that was asked, and the newest "not found"', () => {
  const root = mkdtempSync(join(tmpdir(), 'tour-ask-'));
  try {
    const save = (id, answer, tools = []) => {
      const dir = join(root, 'ask', id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'answer.json'), JSON.stringify(answer));
      writeFileSync(join(dir, 'tickets.json'), JSON.stringify([{}, {}, {}]));
      writeFileSync(join(dir, 'analyses.json'), JSON.stringify([{}]));
      writeFileSync(join(dir, 'transcript.jsonl'), tools.map((t) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', ...t }] } })).join('\n'));
    };
    save('2026-11-06T08-00', { question: 'Has the Struttura field bug happened before?', found: true, answer: 'Yes.', sources: [{ ref: 'DEM-5' }] }, [{ name: 'Grep', input: { pattern: 'struttura' } }]);
    save('2026-11-06T09-00', { question: 'Who changed it last?', found: true, answer: 'Sara.', sources: [{}, {}, {}] });
    save('2026-11-06T10-00', { question: 'Export to SAP?', found: false, answer: 'Not in the knowledge base.', sources: [] });
    const [found, notFound] = recordedAsks(root, ['Has the Struttura field bug happened before?']);
    assert.equal(found.question, 'Has the Struttura field bug happened before?');
    assert.deepEqual(found.steps, ['collecting tickets, analyses and history', '3 tickets, 1 analyses, git history · search: struttura, happened, field', 'search "struttura"']);
    assert.equal(notFound.found, false);
    assert.equal(recordedAsks(root, [])[0].question, 'Who changed it last?', 'without a matching example: the newest answer with three sources');
    assert.deepEqual(recordedAsks(join(root, 'none')), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
