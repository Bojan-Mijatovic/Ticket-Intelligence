import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anchorOf, hashesIn, lintKnowledge, parseKnowledgeFile } from '../lib/knowledge.mjs';

const GOOD = `# frontend/src/app/features/results

Result entry and validation.

**Key files**: \`result-entry.component.ts\`
**People who know it**: Francesca Lombardi (LAB-20, 6b79cd7)

## Known issues

### LAB-23: Values typed with a decimal comma saved without decimals
- **Type**: bug
- **Resolved**: 2026-11-10 by Bojan Mijatović
- **Symptom**: Creatinina 0,95 saved as 0 after SALVA.
- **Search terms**: 0,95 saved as 0, virgola decimale, decimal comma, Inserimento risultati, /richieste/:id/risultati
- **Root cause**: toNumber() used parseFloat (**confirmed**: commit a427822)
- **Fix**: parseDecimal() in numbers.ts (a427822)
  - the Referto keeps formatDecimal
- **How to verify**: e2e/tests/LAB-23.spec.ts
- **Related**: LAB-17

### LAB-17: Referto values printed with a dot
- The full entry is in [frontend/src/app/features/reports](frontend-src-app-features-reports.md#lab-17-referto-values-printed-with-a-dot).
`;

test('parse: entries with their fields (continued lines included), references, the people line', () => {
  const p = parseKnowledgeFile(GOOD, 'docs/knowledge/results.md');
  assert.match(p.people, /Francesca Lombardi/);
  assert.deepEqual(p.entries.map((e) => [e.key, e.reference]), [['LAB-23', false], ['LAB-17', true]]);
  const e = p.entries[0];
  assert.equal(e.fields.Type, 'bug');
  assert.equal(e.fields.Fix, 'parseDecimal() in numbers.ts (a427822)\n- the Referto keeps formatDecimal');
  assert.equal(e.anchor, 'lab-23-values-typed-with-a-decimal-comma-saved-without-decimals');
  assert.equal(anchorOf('DEM-32: Pazienti page had no dark blue background'), 'dem-32-pazienti-page-had-no-dark-blue-background');
});

test('lint: a good entry and a good reference pass', () => {
  assert.deepEqual(lintKnowledge([{ file: 'docs/knowledge/results.md', text: GOOD }], { projects: ['LAB', 'DEM'] }), []);
});

test('lint: each rule', () => {
  const bad = GOOD
    .replace('- **Type**: bug\n', '')
    .replace('(**confirmed**: commit a427822)', '(see commit a427822)')
    .replace(/- \*\*Search terms\*\*: .*\n/, '- **Search terms**: decimal comma\n')
    .replace('- **Related**: LAB-17', '- **Related**: LAB-17, CUP_LAB-120; the fix is in draft PR #2, not merged yet; UTF-8 and RL-2026-00058 are fine')
    .replace('Francesca Lombardi (LAB-20, 6b79cd7)', 'Francesca Lombardi, Ticket Intelligence Agent')
    .replace('[frontend/src/app/features/reports](frontend-src-app-features-reports.md#lab-17-referto-values-printed-with-a-dot)', 'the reports file');
  const found = lintKnowledge([{ file: 'f.md', text: bad }], { projects: ['LAB', 'DEM'], commitExists: (h) => h !== 'a427822' });
  assert.deepEqual(found.map((f) => `${f.key ?? '-'} ${f.rule}`).sort(), [
    '- people',
    'LAB-17 reference',
    'LAB-23 commit',
    'LAB-23 missing-field',
    'LAB-23 root-cause',
    'LAB-23 search-terms',
    'LAB-23 ticket-key',
    'LAB-23 time-bound',
  ]);
  assert.match(found.find((f) => f.rule === 'ticket-key').message, /CUP_LAB-120/);
});

test('lint: only the given tickets get the entry rules; the file rules apply to all', () => {
  const text = `${GOOD.replace('- **Type**: bug\n', '')}\nMarino Paolo MRNPLA61S03C351V, nato il 03/11/1961, mario.rossi@example.it, tel. 333 1234567\n`;
  const found = lintKnowledge([{ file: 'f.md', text }], { keys: ['LAB-99'] });
  assert.deepEqual(found.map((f) => f.message.split(':')[0]).sort(), ['birth date', 'e-mail address', 'fiscal code', 'phone number']);
});

test('personal data: no false alarm on dates, amounts, codes and lab values', () => {
  const text = `${GOOD}\nPR-2026-00590 on 17/11/2026, co-pay 3,3899999999999997 €, 22,50 €, eGFR 269, creatinine 2,50 mg/dL, booked 2026-11-06 at 14:10, colour #0d2c54.\n`;
  assert.deepEqual(lintKnowledge([{ file: 'f.md', text }], {}), []);
});

test('commit hashes: with a digit and a letter, not a CSS colour, not a plain word', () => {
  assert.deepEqual(hashesIn('fix a427822 and 155c5c1, colour #0d2c54ff, the word deadbeef, 2026111'), ['a427822', '155c5c1']);
});

test('known issues of a piece of code (K13): entries of the given tickets and entries citing the files', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { knowledgeFor } = await import('../lib/knowledge.mjs');
  const { diffFiles } = await import('../lib/review.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'kf-'));
  mkdirSync(join(dir, 'docs', 'knowledge'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'knowledge', 'agenda-search.md'), `# Agenda search

## Known issues

### DEM-5: PULISCI does not clear the Struttura selection
- **Type**: bug
- **Root cause**: reset() kept selectedStructureIds (**confirmed**: 3c2ab1d)
- **Fix**: \`frontend/src/app/features/agenda/state/agenda-search.store.ts\`: reset() clears it
- **Prevent recurrence**: every way of clearing the field must go through the store

### DEM-22: Autocomplete is case sensitive
- **Type**: bug
- **Fix**: \`StructureRepository.java\`: lower()
`);
  const byFile = knowledgeFor({ dir, files: ['frontend/src/app/features/agenda/state/agenda-search.store.ts:17'] });
  assert.match(byFile, /^Known issues of this code/);
  assert.match(byFile, /- DEM-5: PULISCI does not clear the Struttura selection \(docs\/knowledge\/agenda-search\.md#dem-5-/);
  assert.match(byFile, /Prevent recurrence: every way of clearing the field must go through the store/);
  assert.doesNotMatch(byFile, /DEM-22/);
  assert.match(knowledgeFor({ dir, files: [], keys: ['dem-22'] }), /DEM-22: Autocomplete is case sensitive/);
  assert.equal(knowledgeFor({ dir, files: ['other.ts'] }), '');
  assert.equal(knowledgeFor({ dir: join(dir, 'nowhere'), files: ['x.ts'] }), '');
  assert.deepEqual(diffFiles('diff --git a/x b/x\n--- a/frontend/a.ts\n+++ b/frontend/a.ts\n@@\n+++ b/e2e/tests/DEM-42.spec.ts\n'), ['frontend/a.ts', 'e2e/tests/DEM-42.spec.ts']);
});
