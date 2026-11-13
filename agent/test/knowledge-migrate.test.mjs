import assert from 'node:assert/strict';
import { test } from 'node:test';
import { namedComponentOf, namedComponentOfFiles, slugOf } from '../../.claude/skills/analyze-ticket/scripts/lib/components.mjs';
import { peopleSegments, planMigration } from '../lib/knowledge-migrate.mjs';
import { parseKnowledgeFile } from '../lib/knowledge.mjs';

const RULES = [
  { name: 'Pazienti', paths: ['frontend/src/app/features/patients/', 'backend/src/main/java/com/x/patient/'] },
  { name: 'Shared (forms, dates, layout)', paths: ['frontend/src/app/shared/', 'frontend/src/styles.scss'] },
];

test('components: names, slugs, tests with their code, shared loses a tie', () => {
  assert.equal(namedComponentOf('backend/src/test/java/com/x/patient/PatientTest.java', RULES), 'Pazienti');
  assert.equal(namedComponentOf('e2e/tests/DEM-3.spec.ts', RULES), null);
  assert.equal(slugOf('Shared (forms, dates, layout)'), 'shared-forms-dates-layout');
  assert.equal(slugOf('Integrazione MediAgenda'), 'integrazione-mediagenda');
  assert.equal(namedComponentOfFiles(['frontend/src/styles.scss', 'frontend/src/app/features/patients/a.ts'], RULES), 'Pazienti');
});

test('people: segments without the agent', () => {
  assert.deepEqual(peopleSegments('Sara Colombo (DEM-3, 74acd34), Ticket Intelligence Agent (DEM-32 fix), Marta Ricci (review)'), ['Sara Colombo (DEM-3, 74acd34)', 'Marta Ricci (review)']);
});

const PATIENTS = `# frontend/src/app/features/patients

The Pazienti pages.

**Key files**:
- \`frontend/src/app/features/patients/patient-search.component.ts\`: the page

**People who know it**: Sara Colombo (DEM-3), Ticket Intelligence Agent (DEM-32)

## Known issues

### DEM-33: Background dark red
- The full entry is in [frontend/src](frontend-src.md#dem-33-background-dark-red).

### DEM-3: Paging wrong
- **Type**: bug
- **Fix**: \`frontend/src/app/features/patients/patient-search.component.ts\`. See also [e2e](e2e.md).
`;
const ROOT = `# frontend/src

The root: styles.

**People who know it**: Marta Ricci (4f35e97)

## Known issues

### DEM-33: Background dark red
- **Type**: change request
- **Fix**: token in \`frontend/src/styles.scss\`; test \`e2e/tests/DEM-33.spec.ts\`. See [frontend/src/app/features/patients](frontend-src-app-features-patients.md).
`;
const E2E = `# e2e

Browser tests.

**People who know it**: Ticket Intelligence Agent (tests)

## Known issues

### DEM-33: Background dark red
- The full entry is in [frontend/src](frontend-src.md#dem-33-background-dark-red).
`;

test('migration: entries to their components, references where they help, links rewritten, index rebuilt', () => {
  const plan = planMigration(
    [
      { file: 'docs/knowledge/frontend-src-app-features-patients.md', text: PATIENTS },
      { file: 'docs/knowledge/frontend-src.md', text: ROOT },
      { file: 'docs/knowledge/e2e.md', text: E2E },
      { file: 'docs/knowledge/README.md', text: '# old index' },
    ],
    RULES,
  );
  assert.deepEqual([...plan.files.keys()].sort(), ['docs/knowledge/README.md', 'docs/knowledge/pazienti.md', 'docs/knowledge/shared-forms-dates-layout.md']);
  assert.deepEqual(plan.removed.sort(), ['docs/knowledge/e2e.md', 'docs/knowledge/frontend-src-app-features-patients.md', 'docs/knowledge/frontend-src.md']);

  const paz = parseKnowledgeFile(plan.files.get('docs/knowledge/pazienti.md'), 'pazienti.md');
  assert.deepEqual(paz.entries.map((e) => [e.key, e.reference]), [['DEM-33', true], ['DEM-3', false]]);
  assert.match(paz.entries[0].text, /\[Shared \(forms, dates, layout\)\]\(shared-forms-dates-layout\.md#dem-33-background-dark-red\)/);
  assert.equal(paz.people, '**People who know it**: Sara Colombo (DEM-3)');
  assert.match(paz.entries[1].fields.Fix, /See also e2e\.$/, 'a link to a file without a component becomes plain text');

  const shared = parseKnowledgeFile(plan.files.get('docs/knowledge/shared-forms-dates-layout.md'), 'shared.md');
  assert.deepEqual(shared.entries.map((e) => [e.key, e.reference]), [['DEM-33', false]], 'the full entry of a file without a component goes where its code is; its reference in e2e is dropped');
  assert.match(shared.entries[0].fields.Fix, /See \[Pazienti\]\(pazienti\.md\)\./);
  assert.match(plan.files.get('docs/knowledge/shared-forms-dates-layout.md'), /^# Shared \(forms, dates, layout\)\n\n\*\*Code\*\*: `frontend\/src\/app\/shared\/`, `frontend\/src\/styles\.scss`\n\nThe root: styles\./);

  const index = plan.files.get('docs/knowledge/README.md');
  assert.match(index, /\| DEM-33 \| Background dark red \| \[Shared \(forms, dates, layout\)\]\(shared-forms-dates-layout\.md#dem-33-background-dark-red\) \|/);
  assert.match(index, /\| DEM-3 \| Paging wrong \| \[Pazienti\]\(pazienti\.md#dem-3-paging-wrong\) \|/);
  assert.deepEqual(plan.moves.filter((m) => m.reference).map((m) => `${m.key} ${m.to}`), ['DEM-33 docs/knowledge/pazienti.md']);
});
