// node --test agent/test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commentableLines, normalizeReview, placeFindings } from '../lib/review.mjs';

const DIFF = `diff --git a/frontend/src/app/shared/utils/dates.ts b/frontend/src/app/shared/utils/dates.ts
index 1111111..2222222 100644
--- a/frontend/src/app/shared/utils/dates.ts
+++ b/frontend/src/app/shared/utils/dates.ts
@@ -10,4 +10,5 @@ export function parseItalianDate(text: string): Date | null {
 export function toIsoDate(date: Date): string {
-  return date.toISOString().slice(0, 10);
+  const pad = (n: number) => String(n).padStart(2, '0');
+  return \`\${date.getFullYear()}-\${pad(date.getMonth() + 1)}-\${pad(date.getDate())}\`;
 }
diff --git a/e2e/tests/DEM-21.spec.ts b/e2e/tests/DEM-21.spec.ts
new file mode 100644
--- /dev/null
+++ b/e2e/tests/DEM-21.spec.ts
@@ -0,0 +1,2 @@
+import { test } from '@playwright/test';
+test('x', async () => {});
`;

test('commentable lines: added and context lines of the new version, not removed ones', () => {
  const lines = commentableLines(DIFF);
  assert.deepEqual([...lines.get('frontend/src/app/shared/utils/dates.ts')], [10, 11, 12, 13]);
  assert.deepEqual([...lines.get('e2e/tests/DEM-21.spec.ts')], [1, 2]);
});

test('findings on diff lines go inline, the others into the review body', () => {
  const { inline, general } = placeFindings(
    [
      { file: 'frontend\\src\\app\\shared\\utils\\dates.ts', line: 12, severity: 'minor', comment: 'ok' },
      { file: 'C:/work/repo/frontend/src/app/shared/utils/dates.ts', line: 11, severity: 'info', comment: 'absolute path' },
      { file: 'frontend/src/app/shared/utils/dates.ts', line: 40, severity: 'major', comment: 'outside the hunk' },
      { file: 'frontend/src/app/other.ts', line: 3, severity: 'major', comment: 'file not in the diff' },
      { file: null, line: null, severity: 'info', comment: 'general remark' },
    ],
    commentableLines(DIFF),
  );
  assert.deepEqual(inline.map((f) => [f.file, f.line]), [['frontend/src/app/shared/utils/dates.ts', 12], ['frontend/src/app/shared/utils/dates.ts', 11]]);
  assert.deepEqual(general.map((f) => f.comment), ['outside the hunk', 'file not in the diff', 'general remark']);
});

test('unknown values become the cautious choice; empty findings are dropped', () => {
  const r = normalizeReview({ risk: 'tiny', verdict: 'ship it', findings: [{ comment: '' }, { comment: 'x', severity: 'blocker' }], testsCoverTheBug: { yes: 'yes' } });
  assert.equal(r.risk, 'medium');
  assert.equal(r.verdict, 'needs-changes');
  assert.deepEqual(r.findings, [{ file: null, line: null, severity: 'minor', comment: 'x' }]);
  assert.equal(r.testsCoverTheBug.yes, false);
});
