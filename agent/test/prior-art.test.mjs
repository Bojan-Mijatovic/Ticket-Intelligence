import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alike, codeVerdict, priorArtCandidates, wordsOf } from '../lib/prior-art.mjs';
import { priorArtSection } from '../lib/suggestions.mjs';

const ITEM = { summary: '[FE] - Risultati e referti: values typed with a decimal comma are saved without decimals', text: 'toNumber() uses parseFloat', files: ['frontend/src/app/features/results/result-entry.component.ts'], component: 'Risultati e referti', since: '2026-11-09T13:00:00Z' };
const commitInfo = new Map([
  ['a427822', { date: '2026-11-10T09:00:00+01:00', files: ['frontend/src/app/features/results/result-entry.component.ts', 'frontend/src/app/shared/utils/numbers.ts'] }],
  ['6b79cd7', { date: '2026-09-15T10:00:00+02:00', files: ['frontend/src/app/features/results/result-entry.component.ts'] }],
  ['1111111', { date: '2026-06-01T10:00:00+02:00', files: ['backend/src/main/java/x/OrderService.java'] }],
]);
const T = (key, status, summary, commits = [], components = []) => ({ key, status, summary, commits, components, type: 'Bug' });

test('words: stems and stop words; alike is the share of common words', () => {
  assert.deepEqual([...wordsOf('Values typed with the decimal commas')], ['valu', 'typ', 'decimal', 'comma']);
  assert.equal(alike('decimal comma saved', 'decimal comma saved'), 1);
  assert.equal(alike('decimal comma', 'doctor name'), 0);
});

test('fixed-by: resolved after the suggestion was written, in its files, about the same thing', () => {
  const c = priorArtCandidates(ITEM, { tickets: [T('LAB-23', 'Done', 'Risultati e referti: values typed with a decimal comma are saved without decimals', ['a427822'])], commitInfo });
  assert.equal(c[0].kind, 'fixed-by');
  assert.match(c[0].reasons[0], /fixed after the suggestion was written: a427822 \(2026-11-10\)/);
  assert.deepEqual(codeVerdict(c), { verdict: 'fixed-by', key: 'LAB-23' });
});

test('a shared file alone is not prior art; a fix of another problem in the same file is not "fixed-by"', () => {
  const other = { ...ITEM, summary: 'the report is pre-signed with a fixed doctor name', text: '' };
  const c = priorArtCandidates(other, { tickets: [T('LAB-23', 'Done', 'values typed with a decimal comma are saved without decimals', ['a427822'], ['Risultati e referti'])], commitInfo });
  assert.deepEqual(c, []);
  assert.deepEqual(codeVerdict(c), { verdict: 'new', key: null });
});

test('an open ticket saying the same is a possible duplicate; a resolved one before the suggestion is only related', () => {
  const open = priorArtCandidates(ITEM, { tickets: [T('LAB-30', 'To Do', 'Risultati e referti: decimal comma values saved without the decimals', [], ['Risultati e referti'])], commitInfo });
  assert.equal(open[0].kind, 'open');
  assert.deepEqual(codeVerdict(open), { verdict: 'duplicate-of', key: 'LAB-30' });
  const before = priorArtCandidates(ITEM, { tickets: [T('LAB-17', 'Done', 'Referto: values printed with a dot and without the decimals', ['6b79cd7'])], commitInfo });
  assert.equal(before[0].kind, 'solved');
  assert.equal(codeVerdict(before).verdict, 'new');
});

test('a suggestion created as a ticket takes that ticket\'s state', () => {
  const c = priorArtCandidates(ITEM, { tickets: [T('LAB-23', 'Done', 'Risultati e referti: values typed with a decimal comma are saved without decimals', ['a427822'])], commitInfo });
  assert.deepEqual(codeVerdict(c, { own: { key: 'LAB-23' } }), { verdict: 'fixed-by', key: 'LAB-23' });
  assert.deepEqual(codeVerdict([], { own: { key: 'LAB-24' } }), { verdict: 'ticket-exists', key: 'LAB-24' });
});

test('knowledge entries and open pull requests are candidates too', () => {
  const entries = [{ key: 'LAB-23', title: 'Values typed with a decimal comma saved without decimals', file: 'docs/knowledge/risultati-e-referti.md', anchor: 'lab-23-x', fields: { Symptom: 'saved as 0', 'Search terms': 'decimal comma, virgola' }, text: 'parseDecimal in frontend/src/app/shared/utils/numbers.ts' }];
  const openPrs = [{ number: 7, title: 'LAB-31: decimal comma in Referto', url: 'u', key: 'LAB-31', files: ['frontend/src/app/features/results/result-entry.component.ts'] }];
  const c = priorArtCandidates(ITEM, { entries, openPrs, commitInfo });
  assert.deepEqual(c.map((x) => [x.kind, x.key]).sort(), [['documented', 'LAB-23'], ['in-progress', 'LAB-31']]);
});

test('the description says what was checked and why it was created anyway', () => {
  const text = priorArtSection({ verdict: 'duplicate-of', key: 'LAB-30', candidates: [{ kind: 'open', key: 'LAB-30', title: 'decimal comma', reasons: ['80% of the words alike'] }] }, 'LAB-30 is about the Referto only');
  assert.match(text, /h3\. Checked before creating\nCreated although the check said \*duplicate-of LAB-30\*\. Reason: LAB-30 is about the Referto only\nRelated:\n\* LAB-30 \(open ticket\): decimal comma — 80% of the words alike/);
  assert.equal(priorArtSection({ verdict: 'new', candidates: [] }), '');
});
