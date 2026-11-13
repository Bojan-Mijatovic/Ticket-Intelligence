// Automatic bisect with the reproduction test (A2 of docs/GIT_GRAPH.md, FR-74). The Fixer's test fails on main; code
// finds a commit where it passes (the good point) and searches the commits in between for the first one where it
// fails: the change that broke it. Proof instead of a guess from the suspect window, without a model: only test runs,
// about log2(n) of them (6 for 45 commits), within a time limit.
//
// Plain code, in a worktree of its own (state/work/<KEY>/bisect, detached), so the fix's worktree and its dev server
// are never touched. The test file is written into each checkout; nothing is committed. A step whose test cannot run
// on that commit (does not compile, the screen is not there yet, fails another way than on main) is a "skip", as in
// `git bisect skip`. The search follows the first-parent line of main, so on a repository with merge commits the
// result is the merge that brought the change in.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { runBackendTest, runE2E } from './verify.mjs';
import { linkDeps, removeWorktree } from './workspace.mjs';

const AGENT_RE = /ticket[ -]intelligence[ -]agent/i;
const KEY_RE = /\b([A-Z][A-Z0-9_]+-\d+)\b/;

/**
 * Binary search for the first bad commit among `n` commits, oldest first: the good point comes before index 0, and
 * index n-1 is known bad (never judged). `judge(i)` → 'good' | 'bad' | 'skip'. A skipped commit is passed over for the
 * nearest one to the middle that can still be judged.
 * @returns {{ status: 'found'|'range'|'timeout', lo: number, hi: number, steps: { index: number, verdict: string }[] }}
 *   found: index hi is the first bad commit; range/timeout: it is one of lo+1 … hi.
 */
export async function bisectLinear(n, judge, { deadline = Infinity, now = Date.now } = {}) {
  let lo = -1;
  let hi = n - 1;
  const skipped = new Set();
  const steps = [];
  while (hi - lo > 1) {
    if (now() > deadline) return { status: 'timeout', lo, hi, steps };
    const mid = Math.floor((lo + hi) / 2);
    let pick = null;
    for (let d = 0; pick === null && d < hi - lo; d++) {
      for (const c of d ? [mid - d, mid + d] : [mid]) {
        if (pick === null && c > lo && c < hi && !skipped.has(c)) pick = c;
      }
    }
    if (pick === null) return { status: 'range', lo, hi, steps };
    const verdict = await judge(pick);
    steps.push({ index: pick, verdict });
    if (verdict === 'good') lo = pick;
    else if (verdict === 'bad') hi = pick;
    else skipped.add(pick);
  }
  return { status: 'found', lo, hi, steps };
}

/** A Playwright failure: an assertion (`expect(…)`) or something else (a timeout on an action, a missing page). */
export function failureKind(message) {
  const m = String(message ?? '');
  if (!m.trim()) return null;
  return /\bexpect\(|AssertionError|toHave|toBe|toEqual|toContain|toMatch/i.test(m) ? 'assertion' : 'other';
}

/** Commit hashes the analysis names in its text (7–40 hex characters with a letter and a digit). */
export function namedCommits(analysis) {
  const text = [analysis?.likelyCause, analysis?.proposedFix, analysis?.jiraComment].filter(Boolean).join('\n');
  return [...new Set([...text.matchAll(/\b[0-9a-f]{7,40}\b/g)].map((m) => m[0]).filter((h) => /[a-f]/.test(h) && /\d/.test(h)))];
}

const tryGit = (git, args) => {
  try {
    return git(args);
  } catch {
    return null;
  }
};

/**
 * Where the test should still pass, newest first, at most `max`: the earlier fix of a regression (priorArt), the
 * commit before each commit the analysis names, and the last commit before the suspect window. Plain code; each one
 * is checked by running the test, and the newest that passes is the good point.
 * @param {(args: string[]) => string} git  runs git in the repository, returns trimmed stdout (throws on failure)
 * @param {string} bad  the full hash of the commit the test fails on (main)
 * @param {string|null} created  when the ticket was created (ISO), for the suspect window
 */
export function planGoodPoints({ analysis, created = null, windowDays = 14, git, bad, max = 3 }) {
  const out = new Map();
  const add = (ref, why) => {
    const sha = tryGit(git, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    if (!sha || sha === bad || out.has(sha)) return;
    if (tryGit(git, ['merge-base', '--is-ancestor', sha, bad]) === null) return; // not on main's history
    out.set(sha, { sha, why, date: git(['show', '-s', '--format=%cI', sha]) });
  };
  const prior = analysis?.priorArt;
  const earlierFix = prior?.kind === 'regression' && prior.commit ? tryGit(git, ['rev-parse', '--verify', '--quiet', `${prior.commit}^{commit}`]) : null;
  if (earlierFix) add(earlierFix, `the earlier fix of ${prior.key ?? 'the same problem'} (${earlierFix.slice(0, 7)})`);
  for (const h of namedCommits(analysis)) {
    const sha = tryGit(git, ['rev-parse', '--verify', '--quiet', `${h}^{commit}`]);
    // Before the earlier fix the bug was there anyway: that commit is a good point itself, not its parent.
    if (sha && sha !== earlierFix) add(`${sha}^`, `the commit before ${h.slice(0, 7)}, which the analysis names`);
  }
  if (created && !Number.isNaN(Date.parse(created))) {
    const before = new Date(Date.parse(created) - windowDays * 864e5).toISOString();
    const w = tryGit(git, ['rev-list', '-1', '--first-parent', `--before=${before}`, bad]);
    if (w) add(w, `the last commit before the ${windowDays}-day suspect window (${before.slice(0, 10)})`);
  }
  return [...out.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, max);
}

/** One commit, for the result: hash, date, author, subject and the ticket its subject starts with. */
export function commitInfo(git, sha) {
  const [full, short, date, author, subject] = git(['show', '-s', '--format=%H%x1f%h%x1f%aI%x1f%an%x1f%s', sha]).split('\x1f');
  return { sha: full, short, date, author, subject, ticket: subject.match(KEY_RE)?.[1] ?? null, agent: AGENT_RE.test(author) };
}

/**
 * The judge for one checkout: writes the test into it and runs only that test.
 * @returns {Promise<{ verdict: 'good'|'bad'|'skip', why: string }>}
 */
async function runTestAt({ path, side, testRel, testClass, toolsDir, evidenceDir, mainKind }) {
  if (side === 'backend') {
    rmSync(join(path, 'backend', 'target'), { recursive: true, force: true }); // classes of another commit must not linger
    const r = await runBackendTest({ path }, toolsDir, testClass);
    if (!r.compiled || !r.tests) return { verdict: 'skip', why: 'the test does not compile or run on this commit' };
    if (!r.failed) return { verdict: 'good', why: 'passes' };
    if (mainKind && r.firstKind && r.firstKind !== mainKind) return { verdict: 'skip', why: `fails another way (${r.firstKind}) than on main (${mainKind})` };
    return { verdict: 'bad', why: String(r.firstError ?? '').split('\n')[0].slice(0, 160), kind: r.firstKind ?? null };
  }
  const spec = testRel.replace(/^e2e\//, '');
  const r = await runE2E({ path }, [spec], { evidenceDir });
  const mine = r.cases.filter((c) => basename(c.file ?? '') === basename(spec));
  if (!mine.length) return { verdict: 'skip', why: 'the test does not load or run on this commit' };
  const failed = mine.filter((c) => !c.ok);
  if (!failed.length) return { verdict: 'good', why: 'passes' };
  const kind = failureKind(failed[0].error);
  if (mainKind && kind && kind !== mainKind) return { verdict: 'skip', why: `fails another way (${kind}) than on main (${mainKind})` };
  return { verdict: 'bad', why: String(failed[0].error ?? '').split('\n')[0].slice(0, 160), kind };
}

/**
 * Runs the bisect. `runTest` replaces the real test run (unit tests).
 * @param {object} p
 * @param {string} p.repoDir      the repository (a clone; the worktree is made from it)
 * @param {string} [p.depsDir]    where node_modules come from (default repoDir)
 * @param {string} p.workDir      folder for the worktree and the evidence (e.g. state/work/<KEY>)
 * @param {'frontend'|'backend'} p.side
 * @param {string} p.testRel      the test's path in the repository
 * @param {string} p.testText     the test's content
 * @param {string} [p.testClass]  the JUnit class (backend)
 * @param {string} p.bad          the commit the test fails on (main)
 * @param {object[]} p.candidates planGoodPoints()
 * @param {string|null} [p.mainKind]  how the test fails on main (failureKind / surefire's failure|error)
 * @param {number} [p.minutes=12] time limit
 * @param {boolean} [p.checkBad]  run the test on `bad` first (the fix run already did; agent/bisect-one.mjs has not)
 * @param {(step: object) => void} [p.onStep]
 */
export async function runBisect({ repoDir, depsDir = repoDir, workDir, side, testRel, testText, testClass = null, toolsDir = null, bad, candidates, mainKind = null, minutes = 12, checkBad = false, onStep = () => {}, runTest = runTestAt, now = Date.now }) {
  const started = now();
  const deadline = started + minutes * 60_000;
  const path = join(workDir, 'bisect');
  const evidenceDir = join(workDir, 'bisect-evidence');
  mkdirSync(evidenceDir, { recursive: true });
  const g = (cwd) => (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();
  const repo = g(repoDir);
  if (existsSync(path)) removeWorktree(repoDir, path);
  repo(['worktree', 'prune']);
  repo(['worktree', 'add', '-q', '--detach', path, bad]);
  linkDeps(depsDir, path);
  const wt = g(path);
  const steps = [];
  const judged = new Map();
  const judge = async (sha) => {
    if (judged.has(sha)) return judged.get(sha);
    const t0 = now();
    wt(['checkout', '-q', '--detach', '--force', sha]);
    wt(['clean', '-q', '-fd']);
    const file = join(path, testRel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, testText);
    const r = await runTest({ path, side, testRel, testClass, toolsDir, evidenceDir, mainKind, sha });
    const step = { sha, short: sha.slice(0, 7), verdict: r.verdict, why: r.why, seconds: Math.round((now() - t0) / 1000) };
    steps.push(step);
    judged.set(sha, r.verdict);
    onStep(step);
    if (sha === bad && r.verdict === 'bad' && !mainKind) mainKind = r.kind ?? null; // how it fails on main
    return r.verdict;
  };
  const done = (status, extra = {}) => ({ status, bad: commitInfo(wt, bad), steps, durationMs: now() - started, ...extra });

  try {
    if (checkBad && (await judge(bad)) !== 'bad') return done('not-failing');
    // The good point: the newest candidate where the test passes.
    let good = null;
    const failing = [];
    for (const c of candidates) {
      if (now() > deadline) break;
      const v = await judge(c.sha);
      if (v === 'good') {
        good = c;
        break;
      }
      if (v === 'bad') failing.push(c);
    }
    if (!good) {
      const oldest = failing.at(-1);
      return oldest
        ? done('older', { since: { ...commitInfo(wt, oldest.sha), why: oldest.why } })
        : done('no-good-point', { tried: candidates.map((c) => ({ short: c.sha.slice(0, 7), why: c.why })) });
    }
    // The commits after the good point, oldest first; a newer candidate that failed is already known bad.
    let list = wt(['rev-list', '--first-parent', '--reverse', `${good.sha}..${bad}`]).split('\n').filter(Boolean);
    const knownBad = list.findIndex((sha) => judged.get(sha) === 'bad');
    if (knownBad >= 0) list = list.slice(0, knownBad + 1);
    const goodInfo = { ...commitInfo(wt, good.sha), why: good.why };
    if (!list.length) return done('no-good-point', { tried: [{ short: good.sha.slice(0, 7), why: 'nothing between it and main' }] });
    const r = await bisectLinear(list.length, (i) => judge(list[i]), { deadline, now });
    const between = list.slice(r.lo + 1, r.hi + 1).map((sha) => commitInfo(wt, sha));
    if (r.status === 'found') return done('found', { good: goodInfo, culprit: commitInfo(wt, list[r.hi]), commits: list.length });
    return done(r.status, { good: goodInfo, candidates: between, commits: list.length });
  } finally {
    removeWorktree(repoDir, path);
  }
}

/** suspectWindowDays of the repository's .ticket-intel.json (the analysis skill's setting), default 14. */
export function windowDaysOf(dir) {
  try {
    return Number(JSON.parse(readFileSync(join(dir, '.ticket-intel.json'), 'utf8')).suspectWindowDays) || 14;
  } catch {
    return 14;
  }
}

const day = (iso) => String(iso ?? '').slice(0, 10);
const describe = (c, { author = true } = {}) => `${c.short} "${c.subject}" (${day(c.date)}${author && c.author ? `, ${c.author}` : ''})`;

/** One line: what the bisect found. */
export function bisectSummary(b) {
  if (!b) return 'no bisect';
  const runs = `${b.steps?.length ?? 0} test run(s), ${Math.round((b.durationMs ?? 0) / 1000)} s`;
  switch (b.status) {
    case 'found':
      return `broken by ${describe(b.culprit)}: the test passes on ${b.good.short} and fails from that commit on (${runs})`;
    case 'range':
    case 'timeout':
      return `broken by one of ${b.candidates.length} commit(s) ${b.candidates.map((c) => c.short).join(', ')}${b.status === 'timeout' ? ' (time limit reached)' : ' (the others could not be tested)'} (${runs})`;
    case 'older':
      return `the test already fails on ${describe(b.since, { author: false })}, ${b.since.why}: the bug is older than that (${runs})`;
    case 'no-good-point':
      return `no commit found where the test passes${b.tried?.length ? ` (tried ${b.tried.map((t) => t.short).join(', ')})` : ': no earlier fix, no commit named by the analysis, no commit before the suspect window'}`;
    case 'not-failing':
      return `the test does not fail on ${b.bad?.short ?? 'main'}, so there is nothing to look for`;
    case 'skipped':
      return `not run: ${b.reason}`;
    default:
      return `bisect failed: ${b.error ?? b.status}`;
  }
}

/**
 * For the fix prompt (role fix: what to do with it) and the review prompt (role review: what to check).
 */
export function bisectForPrompt(b, { role = 'fix' } = {}) {
  if (!b || !['found', 'range', 'timeout', 'older'].includes(b.status)) return '';
  const fix = role === 'fix';
  if (b.status === 'found') {
    const evidence = `Bisect (plain code, the regression test as the judge): the test passes on ${b.good.short} (${b.good.why}) and fails from commit ${b.culprit.short} "${b.culprit.subject}" (${day(b.culprit.date)}) on. That commit brought the bug in.`;
    return fix
      ? `${evidence} Read its diff first (git show ${b.culprit.short}), and correct what it broke while keeping what it was meant to do.`
      : `${evidence} Check that the fix corrects what that change broke without undoing what it was meant to do.`;
  }
  if (b.status === 'older') return `Bisect (plain code): the regression test already fails on ${b.since.short} (${b.since.why}), so no recent change brought the bug in${fix ? '; do not look for one' : ''}.`;
  return `Bisect (plain code, the regression test as the judge): the bug came in with one of these commits: ${b.candidates.map((c) => `${c.short} "${c.subject}"`).join('; ')}.${fix ? ' Read their diffs first.' : ''}`;
}

/** The Jira section (wiki markup). */
export function bisectJira(b) {
  if (!b || ['skipped', 'error'].includes(b.status)) return '';
  const steps = (b.steps ?? []).map((s) => `${s.short} ${s.verdict}`).join(' · ');
  const head = 'h3. Which change broke it (bisect)';
  const how = `_Plain code, no AI: the regression test was run on ${b.steps?.length ?? 0} commit(s) in ${Math.round((b.durationMs ?? 0) / 1000)} s (${steps})._`;
  if (b.status === 'found') {
    return `${head}\nThe test passes on {{${b.good.short}}} (${b.good.why}) and fails from *{{${b.culprit.short}}} ${b.culprit.subject}* (${day(b.culprit.date)}, ${b.culprit.author}) on.${b.culprit.ticket ? ` That change was made for ${b.culprit.ticket}.` : ''}\n${how}`;
  }
  return `${head}\n${bisectSummary(b)}.\n${how}`;
}

/** The PR body row (Markdown). */
export function bisectMd(b) {
  if (!b || ['skipped', 'error'].includes(b.status)) return '';
  if (b.status === 'found') return `\n**Broken by** \`${b.culprit.short}\` ${b.culprit.subject} (${day(b.culprit.date)})${b.culprit.ticket ? `, made for ${b.culprit.ticket}` : ''}: found by bisect with the regression test (passes on \`${b.good.short}\`, ${b.steps.length} test runs, no AI).\n`;
  return `\n**Bisect:** ${bisectSummary(b)}.\n`;
}

/**
 * The bisect of a fix run (fix.mjs, after the reproduction test is committed). Never throws: a failure is a result.
 * @param {object} p.ws          the fix's workspace (createWorkspace), HEAD = the test commit on main
 * @param {string|null} p.created  the ticket's creation date
 */
export async function bisectForFix({ ws, repoDir, workDir, key, side, testRel, testClass, analysis, created, toolsDir, minutes, mainKind, events }) {
  try {
    const git = (args) => ws.git(args);
    const bad = git(['rev-parse', 'HEAD~1']);
    const candidates = planGoodPoints({ analysis, created, windowDays: windowDaysOf(ws.path), git, bad });
    if (!candidates.length) {
      const b = { status: 'no-good-point', steps: [], durationMs: 0, tried: [] };
      events.emit('bisected', { key, text: `bisect: ${bisectSummary(b)}`, bisect: b });
      return b;
    }
    events.emit('bisecting', { key, text: `bisect: looking for the change that broke it; first check: ${candidates[0].why}` });
    const b = await runBisect({
      repoDir, workDir, side, testRel, testClass, toolsDir, bad, candidates, mainKind, minutes,
      testText: readFileSync(join(ws.path, testRel), 'utf8'),
      onStep: (s) => events.emit('progress', { key, step: `bisect: ${s.short} ${s.verdict}${s.verdict === 'skip' ? ` (${s.why})` : ''} · ${s.seconds} s` }),
    });
    events.emit('bisected', { key, text: `bisect: ${bisectSummary(b)}`, bisect: b });
    return b;
  } catch (e) {
    const b = { status: 'error', error: String(e.message).split('\n')[0].slice(0, 300), steps: [], durationMs: 0 };
    events.emit('bisected', { key, text: `bisect: ${bisectSummary(b)}`, bisect: b });
    return b;
  }
}
