import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { faqEntry } from '../lib/ask-actions.mjs';
import { gapsToResearch, questionKey, readResearch, recordResearch, researchedToday, researchOf } from '../lib/research.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'research-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const NOW = Date.parse('2026-11-17T12:00:00Z');
const q = (question, at, why = 'not found', note) => ({ question, at, why, ...(note ? { note } : {}) });
const GAPS = [
  { terms: ['ricevuta'], count: 2, questions: [q('Come si annulla una ricevuta?', '2026-11-17T09:00:00Z'), q('Come si annulla una ricevuta già emessa?', '2026-11-17T10:00:00Z', 'marked as wrong', 'it is the wrong menu')] },
  { terms: ['export'], count: 1, questions: [q('How do I export the report?', '2026-11-17T11:50:00Z')] },
  { terms: ['lotto'], count: 1, questions: [q('Where is the lot number checked?', '2026-11-16T08:00:00Z')] },
];

test('which gap next: most asked first, its newest question, not one asked minutes ago, not one researched', () => {
  assert.deepEqual(gapsToResearch(GAPS, {}, { now: NOW, max: 3 }), [
    { question: 'Come si annulla una ricevuta già emessa?', why: 'marked as wrong', note: 'it is the wrong menu', group: ['Come si annulla una ricevuta?', 'Come si annulla una ricevuta già emessa?'] },
    { question: 'Where is the lot number checked?', why: 'not found', note: null, group: ['Where is the lot number checked?'] },
  ], 'the export question was asked 10 minutes ago: the asker may still rephrase it');
  const done = { [questionKey('Come si annulla una ricevuta?')]: { outcome: 'faq', at: '2026-11-17T11:00:00Z' } };
  assert.deepEqual(gapsToResearch(GAPS, done, { now: NOW }).map((g) => g.question), ['Where is the lot number checked?'], 'one question of the group researched: the group is done');
  const failed = { [questionKey('Where is the lot number checked?')]: { outcome: 'failed', at: '2026-11-16T09:00:00Z' } };
  assert.equal(gapsToResearch([GAPS[2]], failed, { now: NOW }).length, 1, 'a failed run is tried again after a day');
  assert.equal(gapsToResearch([GAPS[2]], failed, { now: Date.parse('2026-11-16T20:00:00Z') }).length, 0);
});

test('what became of each gap is kept, one run counts once in the daily budget', () => {
  recordResearch(tmp, ['Come si annulla una ricevuta?', 'Come si annulla una ricevuta già emessa?'], { outcome: 'faq', url: 'https://github.com/o/r/pull/14' });
  recordResearch(tmp, 'Where is the lot number checked?', { outcome: 'not-found' });
  const r = readResearch(tmp);
  assert.equal(researchOf(GAPS[0], r).url, 'https://github.com/o/r/pull/14');
  assert.equal(researchOf(GAPS[2], r).outcome, 'not-found');
  assert.equal(researchOf(GAPS[1], r), null);
  assert.equal(researchedToday(r), 2);
  assert.equal(questionKey('  Où est le LOT?? '), 'ou est le lot');
});

test('a researched FAQ entry says so, instead of "rated right by a person"', () => {
  const record = { question: 'Where is the lot number checked?', via: 'claude', cited: [{ ref: 'backend/x.java', url: null }] };
  assert.match(faqEntry(record, { date: '2026-11-17', answer: 'In DoseService.' }), /rated right by a person/);
  assert.match(faqEntry(record, { date: '2026-11-17', answer: 'In DoseService.', checked: 'researched by the agent because Ask found no answer; check it in the documentation PR' }), /- \*\*Asked\*\*: 2026-11-17; answered .*; researched by the agent because Ask found no answer/);
});

test('only real gaps are researched: Claude found nothing, not a follow-up, a question of five words or more', async () => {
  const { researchable } = await import('../lib/research.mjs');
  assert.equal(researchable({ question: 'How do we export the monthly bookings to SAP?', via: 'claude' }), true);
  assert.equal(researchable({ question: 'How do we export the monthly bookings to SAP?' }), true, 'an old record without via');
  assert.equal(researchable({ question: 'DEM-42', via: 'records' }), false);
  assert.equal(researchable({ question: 'Who knows it best?', via: 'claude', followUp: true }), false);
  assert.equal(researchable({ question: 'show me last bug ?', via: 'claude' }), false);
  assert.equal(researchable({ question: 'Nuova richiesta http://localhost:4201/richieste/nuova', via: 'claude' }), false);
  assert.equal(researchable({ question: 'Who worked on the lot check last?', via: 'insights' }), false, 'a fast answer');
});
