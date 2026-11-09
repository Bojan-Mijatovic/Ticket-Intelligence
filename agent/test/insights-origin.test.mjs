import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changeIn, matchSharedFiles, originSummary, parseBlame, parseHunks, pickOrigin, significantLines, similarity, tallyBlame } from '../lib/insights.mjs';

const DIFF = `diff --git a/backend/src/main/java/com/x/ChargeImportService.java b/backend/src/main/java/com/x/ChargeImportService.java
index f84254a..1fc8864 100644
--- a/backend/src/main/java/com/x/ChargeImportService.java
+++ b/backend/src/main/java/com/x/ChargeImportService.java
@@ -70,2 +70,6 @@ public class ChargeImportService {
-                Tariff tariff = tariffs.findById(code).orElseThrow();
--- a removed SQL-like comment line, not a file header
+                Optional<Tariff> tariff = tariffs.findById(code);
@@ -90,0 +95,3 @@ public class ChargeImportService {
+        if (x == null) return;
diff --git a/frontend/src/app/new-file.ts b/frontend/src/app/new-file.ts
new file mode 100644
--- /dev/null
+++ b/frontend/src/app/new-file.ts
@@ -0,0 +1,3 @@
+export const x = 1;
`;

test('hunks: the old lines a fix changed, per file; a pure addition has count 0; a new file has none', () => {
  const h = parseHunks(DIFF);
  assert.deepEqual([...h.keys()], ['backend/src/main/java/com/x/ChargeImportService.java']);
  assert.deepEqual(h.get('backend/src/main/java/com/x/ChargeImportService.java'), [{ start: 70, count: 2 }, { start: 90, count: 0 }]);
});

const H = (c) => c.repeat(40);
const BLAME = [
  `${H('a')} 70) Tariff tariff = tariffs.findById(code).orElseThrow();`,
  `${H('a')} 71)     charges.save(Charge.of(tariff));`,
  `${H('b')} 90)         }`,
  `^${H('c')} 91)         return total;`,
  `${H('f')} backend/Old.java 92) moved line`,
].join('\n');

test('blame: line → commit and text (boundary marks and file names are tolerated)', () => {
  const b = parseBlame(BLAME);
  assert.equal(b.get(70).hash, H('a'));
  assert.equal(b.get(91).hash, H('c'));
  assert.equal(b.get(92).text, 'moved line');
});

test('origin: the commit that wrote the changed lines; neighbours only for a pure addition; the fix itself and braces do not count', () => {
  const blame = parseBlame(BLAME);
  const tally = tallyBlame([{ start: 70, count: 2 }, { start: 90, count: 0 }], blame, new Set());
  assert.deepEqual(tally, { changed: { [H('a')]: 2 }, neighbour: { [H('c')]: 1 } }); // line 90 is a lone brace
  assert.deepEqual(pickOrigin(tally), { hash: H('a'), lines: 2, method: 'changed' });
  const onlyAdded = tallyBlame([{ start: 90, count: 0 }], blame, new Set());
  assert.deepEqual(pickOrigin(onlyAdded), { hash: H('c'), lines: 1, method: 'neighbour' });
  assert.equal(pickOrigin(tallyBlame([{ start: 70, count: 2 }], blame, new Set([H('a')]))), null);
});

test('origin summary: changes that brought in the most bugs, bugs from another bug\'s fix, median days in the code', () => {
  const O = (key, ticket, type, days, agent = false) => ({ key, daysInCode: days, origin: { ticket, type, hash: `h${key}`, subject: 's', summary: `story ${ticket}`, agent } });
  const s = originSummary([O('X-5', 'X-2', 'Story', 10), O('X-6', 'X-2', 'Story', 30), O('X-7', 'X-5', 'Bug', 4), O('X-8', null, null, 100, true)]);
  assert.equal(s.medianDaysInCode, 20);
  assert.deepEqual(s.fromFixes, ['X-7']);
  assert.deepEqual(s.fromAgent, ['X-8']);
  assert.deepEqual(s.byChange.map((g) => [g.ticket, g.bugs]), [['X-2', ['X-5', 'X-6']], ['X-5', ['X-7']], [null, ['X-8']]]);
});

const picker = (extra = '') => `package com.app${extra};
import x.Y;
// a comment
export class PatientPicker {
  query = signal('');
${Array.from({ length: 14 }, (_, i) => `  line${i} = compute(${i});`).join('\n')}
  ${extra}
}`;

test('shared code: significant lines leave out imports, packages, comments and braces; copies match by similarity', () => {
  const lines = significantLines(picker());
  assert.ok(!lines.some((l) => /^(package|import|\/\/)/.test(l) || l === '}'));
  assert.equal(similarity(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'e']), 0.6);
  const mine = new Map([['frontend/src/app/shared/patient-picker.component.ts', significantLines(picker())], ['frontend/src/app/tiny.ts', ['a', 'b']]]);
  const theirs = new Map([
    ['frontend/src/app/x/patient-picker.component.ts', significantLines(picker('.lab'))], // only the package differs (and one line)
    ['frontend/src/app/x/patient-picker.component.html', significantLines(picker())], // another kind of file
  ]);
  const m = matchSharedFiles(mine, theirs);
  assert.equal(m.length, 1);
  assert.equal(m[0].peerPath, 'frontend/src/app/x/patient-picker.component.ts');
  assert.equal(m[0].identical, false);
  assert.ok(m[0].similarity >= 90);
});

test('a fix is in the other copy when most of the lines it added are there; nothing to compare for a pure deletion', () => {
  assert.equal(changeIn(['catch (ResourceAccessException e) {', 'throw new PeerUnavailableException("MediAgenda", e);'], ['catch (ResourceAccessException e) {', 'throw new PeerUnavailableException("MediAgenda", e);', 'other']), true);
  assert.equal(changeIn(['if (picked && text !== picked.name) picked = null;'], ['query = signal(\'\');']), false);
  assert.equal(changeIn([], ['a']), null);
});
