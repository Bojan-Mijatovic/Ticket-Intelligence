import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planRefresh } from '../lib/knowledge-refresh.mjs';

const FILE = `# Pazienti

## Known issues

### DEM-50: Background colour of a page
- **Type**: change request
- **Fix** (commit d9aebf4):
  - \`frontend/src/styles.scss\`: new token
- **How to verify**: e2e/tests/DEM-50.spec.ts

### DEM-3: Paging wrong after a new search
- **Type**: bug
- **Fix**: commit 74acd34, \`frontend/src/app/features/patients/patient-search.component.ts\`: search(0).
`;

const repo = (over = {}) => ({
  onMain: (h) => h === '74acd34',
  mainCommitFor: (key) => ({ 'DEM-50': '155c5c1', 'DEM-3': '74acd34' })[key] ?? null,
  fileExists: () => true,
  ...over,
});

test('a fix branch squash-merged: the entry gets the commit on main on its Fix line', () => {
  const { edits, merged, stale } = planRefresh([{ file: 'docs/knowledge/pazienti.md', text: FILE }], repo());
  assert.deepEqual(merged, [{ key: 'DEM-50', file: 'docs/knowledge/pazienti.md', away: ['d9aebf4'], mergedAs: '155c5c1' }]);
  assert.match(edits.get('docs/knowledge/pazienti.md'), /^- \*\*Fix\*\* \(commit d9aebf4\): Merged into main as 155c5c1\.$/m);
  assert.match(edits.get('docs/knowledge/pazienti.md'), /- \*\*Fix\*\*: commit 74acd34, .*search\(0\)\.$/m, 'an entry whose commits are on main is left as it is');
  assert.deepEqual(stale, []);
});

test('nothing to add when the entry already names the commit on main, or the ticket has none', () => {
  const named = FILE.replace('(commit d9aebf4)', '(commit d9aebf4, merged as 155c5c1)');
  assert.equal(planRefresh([{ file: 'f.md', text: named }], repo()).edits.size, 0);
  assert.equal(planRefresh([{ file: 'f.md', text: FILE }], repo({ mainCommitFor: () => null })).edits.size, 0);
});

test('a cited file that is gone from main makes the entry stale; tests and docs are not checked', () => {
  const { stale } = planRefresh([{ file: 'f.md', text: FILE }], repo({ fileExists: (p) => !p.endsWith('patient-search.component.ts') }));
  assert.deepEqual(stale.map((s) => [s.key, s.missing]), [['DEM-3', ['frontend/src/app/features/patients/patient-search.component.ts']]]);
});
