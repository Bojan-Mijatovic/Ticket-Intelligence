import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addedTestNames, isTestIn, judgeEntries, NONE, parseTestLine, selectionOf, testLine, testsOfTicket, withTestField } from '../lib/knowledge-tests.mjs';
import { planRefresh } from '../lib/knowledge-refresh.mjs';

const JAVA = 'backend/src/test/java/com/medilab/sample/SampleServiceTest.java';
const SPEC = 'e2e/tests/LAB-23.spec.ts';

test('test names added by a diff: JUnit methods and Playwright titles; only real tests count', () => {
  const diff = '@@ -10,0 +11,6 @@\n+    @Test\n+    void aTubeOfACancelledRequestCannotBeAccepted() {\n+    private void helper() {\n-    void removedTest() {';
  assert.deepEqual(addedTestNames(diff, JAVA), ['aTubeOfACancelledRequestCannotBeAccepted', 'helper']);
  assert.deepEqual(addedTestNames("+test('LAB-23: saved with its decimals', async ({ page }) => {\n+  it(\"also after a second SALVA\", () => {", SPEC), ['LAB-23: saved with its decimals', 'also after a second SALVA']);
  const file = 'class T {\n  @Test\n  void aTubeOfACancelledRequestCannotBeAccepted() {}\n  private void helper() {}\n}';
  assert.ok(isTestIn(file, JAVA, 'aTubeOfACancelledRequestCannotBeAccepted'));
  assert.ok(!isTestIn(file, JAVA, 'helper'), 'no @Test above it');
  assert.ok(isTestIn("test('LAB-23: saved with its decimals', async () => {})", SPEC, 'LAB-23: saved with its decimals'));
});

test('the tests of a ticket: its own commits (not documentation), test files still on main, the names they added', () => {
  const git = (args) => {
    const a = args.join(' ');
    if (a.startsWith('log')) return ['h2\x1fLAB-9: a cancelled request cancels its tubes', 'h1\x1fLAB-9: document the cancelled tubes', 'h0\x1fLAB-90: another ticket'].join('\n');
    if (a === 'show --format= --name-status h2') return `M\tbackend/src/main/java/X.java\nM\t${JAVA}\nA\tbackend/src/test/java/com/medilab/order/GoneTest.java`;
    if (a.startsWith('show --format= -U0 h2 --')) return a.endsWith(JAVA) ? '+    @Test\n+    void aTubeOfACancelledRequestCannotBeAccepted() {' : '+ void x() {';
    if (a === `show origin/main:${JAVA}`) return '@Test\nvoid aTubeOfACancelledRequestCannotBeAccepted() {}';
    if (a.startsWith('show origin/main:')) throw new Error('not on main');
    throw new Error(`unexpected git ${a}`);
  };
  const tests = testsOfTicket(git, 'LAB-9');
  assert.deepEqual(tests, [{ file: JAVA, names: ['aTubeOfACancelledRequestCannotBeAccepted'] }]);
  assert.equal(testLine(tests), `\`${JAVA}\` (\`aTubeOfACancelledRequestCannotBeAccepted\`)`);
  assert.deepEqual(parseTestLine(testLine(tests)), tests, 'the line reads back');
  assert.equal(testLine([]), NONE);
  assert.deepEqual(parseTestLine(NONE), []);
});

const FILE = `# Campioni

## Known issues

### LAB-9: Tubes of a cancelled request can be accepted
- **Type**: bug
- **Fix**: commit 3ae6c47
- **How to verify**: cancel a request,
  then try to accept its tube
- **Related**: LAB-3

### LAB-12: A rejected tube is not replaced
- **Type**: bug
- **Fix**: commit 1234abc
`;

test('the Test field goes after How to verify (with its continuation), else after Fix; it replaces an old one', () => {
  const once = withTestField(FILE, 'LAB-9', '`a/BTest.java`');
  assert.match(once, /then try to accept its tube\n- \*\*Test\*\*: `a\/BTest\.java`\n- \*\*Related\*\*/);
  const twice = withTestField(once, 'LAB-9', NONE);
  assert.equal((twice.match(/\*\*Test\*\*/g) ?? []).length, 1);
  assert.match(twice, /- \*\*Test\*\*: none: the fix/);
  assert.match(withTestField(FILE, 'LAB-12', NONE), /- \*\*Fix\*\*: commit 1234abc\n- \*\*Test\*\*: none/);
});

test('refresh: entries get their Test line; a "none" is filled once tests exist; a named list is kept', () => {
  const repo = { onMain: () => true, mainCommitFor: () => null, fileExists: () => true };
  const lines = { 'LAB-9': `\`${JAVA}\``, 'LAB-12': NONE };
  const first = planRefresh([{ file: 'campioni.md', text: FILE }], { ...repo, testLineFor: (k) => lines[k] });
  assert.deepEqual(first.tests.map((t) => [t.key, t.was]), [['LAB-9', null], ['LAB-12', null]]);
  const text = first.edits.get('campioni.md');
  const later = planRefresh([{ file: 'campioni.md', text }], { ...repo, testLineFor: (k) => (k === 'LAB-12' ? '`e2e/tests/LAB-12.spec.ts`' : NONE) });
  assert.deepEqual(later.tests.map((t) => [t.key, t.value]), [['LAB-12', '`e2e/tests/LAB-12.spec.ts`']], 'LAB-9 keeps its tests; LAB-12 gets the new one');
});

test('what to run, and the verdict per entry: pass, fail (the known issue may be back), did not run, none', () => {
  const items = [
    { key: 'LAB-9', tests: [{ file: JAVA, names: ['aTubeOfACancelledRequestCannotBeAccepted'] }] },
    { key: 'LAB-8', tests: [{ file: 'backend/src/test/java/com/medilab/result/ResultServiceTest.java', names: [] }] },
    { key: 'LAB-23', tests: [{ file: SPEC, names: ['LAB-23: saved with its decimals'] }] },
    { key: 'LAB-11', tests: [{ file: JAVA, names: ['renamedSince'] }] },
    { key: 'LAB-4', tests: [] },
  ];
  assert.deepEqual(selectionOf(items), { backend: 'SampleServiceTest#aTubeOfACancelledRequestCannotBeAccepted+renamedSince,ResultServiceTest', e2e: ['tests/LAB-23.spec.ts'] });
  const backend = { cases: [
    { className: 'SampleServiceTest', method: 'aTubeOfACancelledRequestCannotBeAccepted', ok: true },
    { className: 'ResultServiceTest', method: 'flagsWithTheRangeOfThePatientsSex', ok: false, error: 'expected: "H"' },
    { className: 'ResultServiceTest', method: 'other', ok: true },
  ] };
  const e2e = { cases: [{ file: 'LAB-23.spec.ts', title: 'LAB-23: saved with its decimals', ok: true }] };
  const { entries, totals } = judgeEntries(items, { backend, e2e });
  assert.deepEqual(entries.map((e) => [e.key, e.status]), [['LAB-9', 'pass'], ['LAB-8', 'fail'], ['LAB-23', 'pass'], ['LAB-11', 'not-run'], ['LAB-4', 'none']]);
  assert.equal(entries[1].tests[0].failed[0].error, 'expected: "H"');
  assert.deepEqual(entries[3].tests[0].missing, ['renamedSince']);
  assert.deepEqual(totals, { pass: 2, fail: 1, notRun: 1, none: 1 });
});
