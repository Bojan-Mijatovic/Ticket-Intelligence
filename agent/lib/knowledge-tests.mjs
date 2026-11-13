// Executable knowledge (KB1 of docs/AUTONOMY_AND_NEXT.md): every known-issue entry names the regression tests of its
// fix, and those tests are run on main. A failing test means "this known issue may be back", before anyone reports it.
// Plain code, no AI.
//
// The tests of an entry are the test files its ticket's own commits on main added or changed (the human fixes rarely
// name the ticket in the test), with the tests those commits added, by name, when they can be read from the diff:
//   - Test: `backend/src/test/java/com/medilab/sample/SampleServiceTest.java` (`aTubeOfACancelledRequestCannotBeAccepted`)
//   - Test: none: the fix added or changed no test
// JUnit (backend/src/test/java/**Test.java) and Playwright (e2e/tests/*.spec.ts) are recognised.

export const TEST_FILE = /(^|\/)src\/test\/java\/.+Tests?\.java$|(^|\/)e2e\/tests\/.+\.(spec|test)\.[cm]?[jt]s$/;
export const NONE = 'none: the fix added or changed no test';
const isJava = (f) => f.endsWith('.java');

/** Test names added in a unified diff of one file: JUnit methods ("void name("), Playwright/Jest titles ("test('…'"). */
export function addedTestNames(diff, file) {
  const out = [];
  for (const line of String(diff).split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const m = isJava(file) ? line.match(/\bvoid\s+(\w+)\s*\(/) : line.match(/\b(?:test|it)(?:\.only)?\(\s*(['"`])(.+?)\1/);
    if (m) out.push(isJava(file) ? m[1] : m[2]);
  }
  return [...new Set(out)];
}

/** Whether `name` is a test in the file's text: a JUnit method with @Test just above it, or a test(…) title. */
export function isTestIn(text, file, name) {
  const lines = String(text).split('\n');
  if (isJava(file)) {
    const TEST = /@(Test|ParameterizedTest|RepeatedTest)\b/;
    const i = lines.findIndex((l) => new RegExp(`\\bvoid\\s+${name}\\s*\\(`).test(l));
    if (i < 0) return false;
    if (TEST.test(lines[i])) return true; // "@Test void name()" on one line
    // Its own annotations only: up through annotations, blank lines and comments, stopping at the first line of code.
    for (let j = i - 1; j >= 0; j--) {
      const l = lines[j].trim();
      if (!l || /^(\/\/|\/\*|\*)/.test(l)) continue;
      if (!l.startsWith('@')) return false;
      if (TEST.test(l)) return true;
    }
    return false;
  }
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b(?:test|it)(?:\\.only)?\\(\\s*(['"\`])${esc}\\1`).test(text);
}

/**
 * The regression tests of a ticket on `ref`: [{ file, names }] ([] when its commits changed no test still there).
 * @param {(args: string[]) => string} git   runs git in the repository, returns stdout
 */
export function testsOfTicket(git, key, { ref = 'origin/main' } = {}) {
  const own = new RegExp(`^\\[?${key}\\b`);
  const docs = new RegExp(`^${key}: document `);
  const commits = git(['log', ref, '--no-merges', '-E', `--grep=^\\[?${key}\\b`, '--format=%H%x1f%s'])
    .split('\n').filter(Boolean).map((l) => l.split('\x1f')).filter(([, s]) => own.test(s) && !docs.test(s)).map(([h]) => h);
  const files = new Map();
  for (const h of commits.reverse()) {
    const changed = git(['show', '--format=', '--name-status', h]).split('\n').filter(Boolean)
      .map((l) => l.split('\t')).filter(([st, f]) => /^[AM]/.test(st) && TEST_FILE.test(f)).map(([, f]) => f);
    for (const f of changed) {
      const names = addedTestNames(git(['show', '--format=', '-U0', h, '--', f]), f);
      files.set(f, [...new Set([...(files.get(f) ?? []), ...names])]);
    }
  }
  const out = [];
  for (const [file, names] of files) {
    let text;
    try {
      text = git(['show', `${ref}:${file}`]);
    } catch {
      continue; // gone from main since
    }
    out.push({ file, names: names.filter((n) => isTestIn(text, file, n)) });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** The entry's **Test** value. */
export function testLine(tests) {
  if (!tests.length) return NONE;
  return tests.map((t) => `\`${t.file}\`${t.names.length ? ` (${t.names.map((n) => `\`${n}\``).join(', ')})` : ''}`).join('; ');
}

/**
 * **Test** value → [{ file, names }]; [] for "none". The names in parentheses are read as whole backticked strings, so a
 * Playwright title with its own parentheses ("dark (now dark red, DEM-33) background") does not end the list early.
 */
export function parseTestLine(value) {
  const v = String(value ?? '').trim();
  if (!v || /^none\b/i.test(v)) return [];
  return [...v.matchAll(/`([^`]+)`(?:\s*\(\s*((?:`[^`]*`\s*,?\s*)+)\))?/g)]
    .filter((m) => TEST_FILE.test(m[1]))
    .map((m) => ({ file: m[1], names: [...(m[2] ?? '').matchAll(/`([^`]+)`/g)].map((x) => x[1]) }));
}

const base = (f) => f.split('/').pop();
const javaClass = (f) => base(f).replace(/\.java$/, '');

/**
 * What to run for a set of entries ([{ tests: [{ file, names }] }]): one surefire selection for the JUnit tests
 * ("SampleServiceTest#a+b,OrderServiceTest": a class cited without names runs whole) and the Playwright spec files
 * (relative to e2e/). Null when there is nothing of that kind.
 */
export function selectionOf(items) {
  const classes = new Map();
  const specs = new Set();
  for (const t of items.flatMap((i) => i.tests)) {
    if (t.file.endsWith('.java')) {
      const c = javaClass(t.file);
      if (!t.names.length || classes.get(c) === 'ALL') classes.set(c, 'ALL');
      else classes.set(c, new Set([...(classes.get(c) ?? []), ...t.names]));
    } else specs.add(t.file.replace(/^e2e\//, ''));
  }
  const backend = [...classes].map(([c, m]) => (m === 'ALL' ? c : `${c}#${[...m].join('+')}`)).join(',');
  return { backend: backend || null, e2e: specs.size ? [...specs].sort() : null };
}

/**
 * Each entry's verdict from the cases that ran: pass, fail ("the known issue may be back"), not-run (the test did not
 * run: a compile error, a renamed test), or none (no regression test).
 * @param {{ cases: { className, method, ok, error }[], error?: string }} backend   runBackendSelection()
 * @param {{ cases: { file, title, ok, error }[], error?: string }} e2e              runE2E()
 */
export function judgeEntries(items, { backend = { cases: [] }, e2e = { cases: [] } } = {}) {
  const verdict = (t) => {
    const java = t.file.endsWith('.java');
    const pool = java ? backend.cases.filter((c) => c.className === javaClass(t.file)) : e2e.cases.filter((c) => base(c.file ?? '') === base(t.file));
    const picked = t.names.length ? pool.filter((c) => t.names.includes(java ? c.method : c.title)) : pool;
    const failed = picked.filter((c) => !c.ok);
    const ran = new Set(picked.map((c) => (java ? c.method : c.title)));
    const missing = t.names.filter((n) => !ran.has(n));
    if (failed.length) return { ...t, status: 'fail', failed: failed.map((c) => ({ name: java ? c.method : c.title, error: c.error })) };
    if (!picked.length || missing.length) return { ...t, status: 'not-run', missing, error: (java ? backend.error : e2e.error) ?? null };
    return { ...t, status: 'pass', ran: picked.length };
  };
  const entries = items.map((i) => {
    const tests = i.tests.map(verdict);
    const status = !tests.length ? 'none' : tests.some((t) => t.status === 'fail') ? 'fail' : tests.some((t) => t.status === 'not-run') ? 'not-run' : 'pass';
    return { ...i, tests, status };
  });
  const count = (s) => entries.filter((e) => e.status === s).length;
  return { entries, totals: { pass: count('pass'), fail: count('fail'), notRun: count('not-run'), none: count('none') } };
}

/**
 * Puts "- **Test**: value" into the entry of `key` in a knowledge file: after its **How to verify** field (else after
 * **Fix**, else after its last field), with continuation lines. Replaces an existing Test field. Returns the new text.
 */
export function withTestField(text, key, value) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const head = lines.findIndex((l) => l.startsWith(`### ${key}:`));
  if (head < 0) return text;
  let end = lines.findIndex((l, i) => i > head && /^#{1,3} /.test(l));
  if (end < 0) end = lines.length;
  const fieldAt = (name) => lines.findIndex((l, i) => i > head && i < end && new RegExp(`^- \\*\\*${name}\\*\\*`).test(l));
  const endOf = (i) => {
    let j = i + 1;
    while (j < end && /^\s+\S/.test(lines[j])) j++;
    return j; // first line after the field and its continuation lines
  };
  const line = `- **Test**: ${value}`;
  const existing = fieldAt('Test');
  if (existing > 0) {
    lines.splice(existing, endOf(existing) - existing, line);
    return lines.join('\n');
  }
  let after = fieldAt('How to verify');
  if (after < 0) after = fieldAt('Fix');
  if (after < 0) {
    const fields = lines.map((l, i) => (i > head && i < end && /^- \*\*/.test(l) ? i : -1)).filter((i) => i >= 0);
    if (!fields.length) return text;
    after = fields.at(-1);
  }
  lines.splice(endOf(after), 0, line);
  return lines.join('\n');
}
