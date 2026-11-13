// Regression guard on every commit to main (A1 of docs/GIT_GRAPH.md, FR-76). Plain code, no AI.
//
// For a new commit on main:
//   1. the lines it changes or deletes (for a pure addition, the lines around it) are blamed in its parent; a line
//      written by the commit of a fixed bug counts for that bug (Insights' "where bugs come from" uses the same blame);
//   2. the regression tests of those bugs (their knowledge entry's Test line, or the tests their commits added: KB1)
//      run on the commit, in a worktree of its own;
//   3. a regression test whose own lines the commit changes or deletes runs in its version from BEFORE the commit: a
//      developer who "adjusts" a failing test is how a regression gets past CI. Adding a test to the same class does
//      not count (test classes are shared by many tickets; counting it gave 17 false alerts on 135 commits).
// Verdict: alert (a fix's regression test fails on the commit), note (it touches a fix or its test, the tests pass),
// clear (it touches no fix). The watcher reports an alert on the commit (GitHub) and in Jira.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { leadKey } from './git-graph.mjs';
import { parseBlame, parseHunks, tallyBlame } from './insights.mjs';
import { parseKnowledgeFile } from './knowledge.mjs';
import { judgeEntries, parseTestLine, selectionOf, TEST_FILE, testsOfTicket } from './knowledge-tests.mjs';
import { runBackendSelection, runE2E } from './verify.mjs';
import { linkDeps, removeWorktree } from './workspace.mjs';

const gitIn = (cwd) => (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();
const DOCS_COMMIT = /^\[?[A-Z][A-Z0-9_]+-\d+\]?:? document /;

/** The known issues on a ref (docs/knowledge): key → { key, file, anchor, title, tests: [{ file, names }] | null }. */
export function knownIssues(git, ref, docsPath = 'docs/knowledge') {
  let files = [];
  try {
    files = git(['ls-tree', '-r', '--name-only', ref, '--', docsPath]).split('\n').filter((f) => f.endsWith('.md') && !f.endsWith('/README.md'));
  } catch {
    return new Map();
  }
  const out = new Map();
  for (const f of files) {
    for (const e of parseKnowledgeFile(git(['show', `${ref}:${f}`]), f).entries.filter((x) => !x.reference)) {
      out.set(e.key, { key: e.key, file: f, anchor: e.anchor, title: e.title, tests: e.fields.Test != null ? parseTestLine(e.fields.Test) : null });
    }
  }
  return out;
}

/**
 * The earlier bug fixes a commit touches: the lines it changes or deletes (and the lines around a pure addition),
 * blamed in its parent. Test files and documentation do not count; the commit's own ticket does not either.
 * @param {Set<string>} fixKeys  tickets whose commits are bug fixes (documented bugs, resolved Jira bugs)
 * @returns {{ key, lines, files: string[], commits: string[] }[]}  the most touched first
 */
export function touchedFixes({ git, sha, prefixes, fixKeys, own = null }) {
  const hunks = parseHunks(git(['show', '-U0', '--format=', '--no-color', '--no-renames', sha]));
  const subjects = new Map();
  const subjectOf = (hash) => {
    if (!subjects.has(hash)) subjects.set(hash, git(['show', '-s', '--format=%s', hash]));
    return subjects.get(hash);
  };
  const byKey = new Map();
  for (const [path, hs] of hunks) {
    if (TEST_FILE.test(path) || path.startsWith('docs/')) continue;
    let blame;
    try {
      blame = parseBlame(git(['blame', '-l', '-s', '-w', '--root', `${sha}^`, '--', path]));
    } catch {
      continue; // a new file: nothing was there before
    }
    const tally = tallyBlame(hs, blame, new Set());
    for (const [hash, n] of [...Object.entries(tally.changed), ...Object.entries(tally.neighbour)]) {
      const subject = subjectOf(hash);
      const key = leadKey(subject, prefixes);
      if (!key || key === own || !fixKeys.has(key) || DOCS_COMMIT.test(subject)) continue;
      const f = byKey.get(key) ?? { key, lines: 0, files: new Set(), commits: new Set() };
      f.lines += n;
      f.files.add(path);
      f.commits.add(hash.slice(0, 7));
      byKey.set(key, f);
    }
  }
  return [...byKey.values()].map((f) => ({ ...f, files: [...f.files], commits: [...f.commits] })).sort((a, b) => b.lines - a.lines);
}

/** The test files a commit changes or deletes (a new test is not a threat to an old fix). */
export function touchedTests(git, sha) {
  return git(['show', '--format=', '--name-status', '--no-renames', sha]).split('\n').filter(Boolean)
    .map((l) => l.split('\t')).filter(([st, f]) => /^[MD]/.test(st) && TEST_FILE.test(f)).map(([, f]) => f);
}

/**
 * The line span of each named test in a test file: a JUnit method (from its annotations to the next test) or a
 * Playwright test(…) block. 1-based, inclusive.
 */
export function testSpans(text, names) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const isAnno = (l) => /^\s*@\w+/.test(l);
  const isDecl = (l) => /^\s*((public|protected|private)\s+)?(static\s+)?void\s+\w+\s*\(|^\s*(test|it)(\.only)?\(/.test(l);
  // The first line of each member: its first annotation, or the declaration when it has none.
  const heads = lines.map((l, i) => ((isAnno(l) || isDecl(l)) && !(i > 0 && isAnno(lines[i - 1])) ? i : -1)).filter((i) => i >= 0);
  const spans = [];
  for (const name of names) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const at = lines.findIndex((l) => new RegExp(`\\bvoid\\s+${esc}\\s*\\(|\\b(?:test|it)(?:\\.only)?\\(\\s*(['"\`])${esc}\\1`).test(l));
    if (at < 0) continue;
    let from = at;
    while (from > 0 && isAnno(lines[from - 1])) from--; // its own annotations
    const next = heads.find((h) => h > at);
    spans.push([from + 1, (next !== undefined ? next : lines.length)]); // up to the line before the next member
  }
  return spans;
}

/**
 * Whether a commit changes or deletes the lines of the given tests (all of the file when no test is named). Adding a
 * new test to the same class does not count: test classes are shared by many tickets.
 */
function changesTests(git, sha, hunks, file, names) {
  const hs = (hunks.get(file) ?? []).filter((h) => h.count > 0);
  if (!hs.length) return false;
  if (!names.length) return true;
  let text;
  try {
    text = git(['show', `${sha}^:${file}`]);
  } catch {
    return false;
  }
  const spans = testSpans(text, names);
  return hs.some((h) => spans.some(([a, b]) => h.start <= b && h.start + h.count - 1 >= a));
}

/**
 * Runs the regression tests of `items` on commit `sha`, in a worktree of its own; the files in `restore` are put back
 * as they were in the commit's parent first. Returns judgeEntries().
 */
export async function runEntryTests({ repoDir, workDir, sha, items, restore = [], toolsDir = null }) {
  const path = join(workDir, 'guard');
  const repo = gitIn(repoDir);
  if (existsSync(path)) removeWorktree(repoDir, path);
  repo(['worktree', 'prune']);
  mkdirSync(dirname(path), { recursive: true });
  repo(['worktree', 'add', '-q', '--detach', path, sha]);
  try {
    linkDeps(repoDir, path);
    for (const f of restore) {
      mkdirSync(dirname(join(path, f)), { recursive: true });
      writeFileSync(join(path, f), repo(['show', `${sha}^:${f}`]));
    }
    const ws = { path };
    const sel = selectionOf(items);
    const backend = sel.backend ? await runBackendSelection(ws, toolsDir, sel.backend) : { cases: [] };
    const e2e = sel.e2e ? await runE2E(ws, sel.e2e, { evidenceDir: join(workDir, 'guard-evidence') }) : { cases: [] };
    return judgeEntries(items, { backend, e2e: { cases: e2e.cases, error: e2e.cases.length ? null : e2e.output ?? null } });
  } finally {
    removeWorktree(repoDir, path);
  }
}

/** One line for people: what the commit touches, and what its tests said. */
export function guardText(g) {
  const head = `${g.short} "${g.subject}"`;
  if (g.verdict === 'clear') return `${head}: touches no earlier bug fix`;
  const parts = g.fixes.map((f) => {
    const own = f.lines ? `changes ${f.lines} line(s) the fix of ${f.key} wrote (${f.files.map((x) => basename(x)).join(', ')})` : `does not touch the code of ${f.key}'s fix`;
    return `${own}${f.testsChanged.length ? `, and changes its regression test ${f.testsChanged.map((x) => basename(x)).join(', ')}` : ''}`;
  });
  const failed = (g.tests?.entries ?? []).filter((e) => e.status === 'fail');
  const tail = failed.length
    ? ` ${failed.map((e) => `${e.key}'s regression test${e.restored ? ', as it was before this commit,' : ''} FAILS on it: ${String(e.tests.find((t) => t.status === 'fail')?.failed?.[0]?.error ?? '').split('\n')[0].slice(0, 160)}`).join('; ')}`
    : g.tests ? ` The regression tests ${g.restored.length ? '(the changed ones as they were before) ' : ''}pass.` : ' No regression test is known for it.';
  return `${head} ${parts.join('; ')}.${tail}`;
}

/**
 * The guard of one commit on main.
 * @param {object} p
 * @param {string} p.repoDir     the app's clone (the commit must be fetched)
 * @param {string} p.workDir     where the worktree goes (e.g. <state>/guard)
 * @param {string[]} p.prefixes  Jira project keys of the repository's tickets
 * @param {Set<string>} [p.fixKeys]  resolved bugs (from Jira); documented bugs are added from docs/knowledge
 * @param {Function} [p.runTests]  runEntryTests (tests replace it)
 * @returns {Promise<{ sha, short, subject, author, key, verdict: 'clear'|'note'|'alert', fixes, tests, restored, text }>}
 */
export async function guardCommit({ repoDir, workDir, sha, prefixes, fixKeys = new Set(), toolsDir = null, runTests = runEntryTests }) {
  const git = gitIn(repoDir);
  const [full, short, subject, author] = git(['show', '-s', '--format=%H%x1f%h%x1f%s%x1f%an', sha]).split('\x1f');
  const own = leadKey(subject, prefixes);
  const known = knownIssues(git, `${full}^`);
  const fixes = touchedFixes({ git, sha: full, prefixes, fixKeys: new Set([...fixKeys, ...known.keys()]), own });
  const changed = touchedTests(git, full);
  const hunks = changed.length ? parseHunks(git(['show', '-U0', '--format=', '--no-color', '--no-renames', full, '--', ...changed])) : new Map();
  const testsOf = (key) => known.get(key)?.tests ?? testsOfTicket(git, key, { ref: `${full}^` });
  const changesOf = (tests) => tests.filter((t) => changed.includes(t.file) && changesTests(git, full, hunks, t.file, t.names)).map((t) => t.file);
  // A fix whose regression test this commit changes counts too, even if its code lines are untouched: the test is the
  // fix's when its knowledge entry cites it, or when the fix's own commits wrote it (git log of the test file).
  const allFixes = new Set([...fixKeys, ...known.keys()]);
  const addFix = (key) => {
    if (key && key !== own && allFixes.has(key) && !fixes.some((f) => f.key === key)) fixes.push({ key, lines: 0, files: [], commits: [] });
  };
  for (const [key] of known) if (changesOf(testsOf(key)).length) addFix(key);
  for (const file of changed) {
    for (const s of git(['log', `${full}^`, '--format=%s', '--', file]).split('\n').filter(Boolean)) {
      const key = leadKey(s, prefixes);
      if (key && allFixes.has(key) && !DOCS_COMMIT.test(s) && changesOf(testsOf(key).filter((t) => t.file === file)).length) addFix(key);
    }
  }
  for (const f of fixes) {
    f.tests = testsOf(f.key);
    f.testsChanged = changesOf(f.tests);
    f.entry = known.get(f.key) ? `${known.get(f.key).file}#${known.get(f.key).anchor}` : null;
  }
  const items = fixes.filter((f) => f.tests.length).map((f) => ({ key: f.key, tests: f.tests }));
  const restored = [...new Set(fixes.flatMap((f) => f.testsChanged))];
  let tests = null;
  if (items.length) {
    tests = await runTests({ repoDir, workDir, sha: full, items, restore: restored, toolsDir });
    for (const e of tests.entries) e.restored = e.tests.some((t) => restored.includes(t.file));
  }
  // An alert needs a failing test: the fix's regression test (a changed one in its version from before) fails on the
  // commit. Touching a fix whose tests still pass is a note: the history shows many such commits that are fine.
  const failed = (tests?.entries ?? []).some((e) => e.status === 'fail');
  const verdict = failed ? 'alert' : fixes.length ? 'note' : 'clear';
  const g = { sha: full, short, subject, author, key: own, verdict, fixes, tests, restored };
  return { ...g, text: guardText(g) };
}
