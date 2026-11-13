#!/usr/bin/env node
// A2 (FR-74): find the commit that broke a test, by hand. The fix run does this on its own after the reproduction
// test (lib/fix.mjs); this command runs the same bisect for any test file, e.g. to check a suspicion or to prove the
// bisect on a copy of a repository with a planted break. No AI, nothing committed; a worktree of its own in the
// project's state.
//
//   node agent/bisect-one.mjs --project LAB --test <file> --as <path in the repository> --good <ref>
//   node agent/bisect-one.mjs --project LAB --test <file> --as <path> --key LAB-30 [--created 2026-11-10]
//
//   --test     the test file (outside the repository, or a copy); a .java file runs with Maven, a .spec.ts with Playwright
//   --as       where it goes in the repository (e.g. backend/src/test/java/com/medilab/regression/Lab30RegressionTest.java)
//   --good     a commit where the test should pass; or --key: the good points come from that ticket's saved analysis
//              (state/work/<KEY>/result.json: the earlier fix of a regression, the commits it names) and --created
//   --bad      where it fails (default origin/main, or HEAD in a repository without a remote)
//   --repo     another clone, e.g. a scratch copy (default: the project's clone); node_modules still come from the project
//   --minutes  time limit (default agent.config.json bisectMinutes, 12)

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bisectSummary, planGoodPoints, runBisect, windowDaysOf } from './lib/bisect.mjs';
import { cliProject, loadProjects } from './lib/projects.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const all = loadProjects(HERE);
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const p = cliProject(all);
const repoDir = resolve(opt('--repo') ?? p.repoDir);
const testFile = opt('--test');
const testRel = opt('--as')?.replace(/\\/g, '/');
if (!testFile || !testRel || !existsSync(testFile) || !(opt('--good') || opt('--key'))) {
  console.error('Usage: node agent/bisect-one.mjs --project KEY --test <file> --as <path in the repository> (--good <ref> | --key <TICKET>) [--bad <ref>] [--repo <dir>] [--created <ISO>] [--minutes N]');
  process.exit(2);
}
const git = (a) => execFileSync('git', a, { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const hasRemote = (() => {
  try {
    return Boolean(git(['remote', 'get-url', 'origin']));
  } catch {
    return false;
  }
})();
const bad = git(['rev-parse', opt('--bad') ?? (hasRemote ? 'origin/main' : 'HEAD')]);
const side = testRel.endsWith('.java') ? 'backend' : 'frontend';
const testClass = side === 'backend' ? basename(testRel, '.java') : null;

let candidates;
if (opt('--good')) {
  const sha = git(['rev-parse', `${opt('--good')}^{commit}`]);
  candidates = [{ sha, why: `the commit given (${opt('--good')})`, date: git(['show', '-s', '--format=%cI', sha]) }];
} else {
  const key = opt('--key').toUpperCase();
  const file = join(p.stateDir, 'work', key, 'result.json');
  if (!existsSync(file)) {
    console.error(`No saved analysis of ${key} (${file}); give --good instead.`);
    process.exit(2);
  }
  candidates = planGoodPoints({ analysis: JSON.parse(readFileSync(file, 'utf8')), created: opt('--created'), windowDays: windowDaysOf(repoDir), git, bad });
  if (!candidates.length) {
    console.error(`The analysis of ${key} gives no good point (no earlier fix, no commit it names${opt('--created') ? ', no commit before the window' : '; --created adds the suspect window'}); give --good.`);
    process.exit(1);
  }
}

console.log(`${p.name} (${p.key}) · ${repoDir}`);
console.log(`Test ${testRel} (${side}) · fails on ${bad.slice(0, 7)}? · good point candidates: ${candidates.map((c) => `${c.sha.slice(0, 7)} (${c.why})`).join('; ')}`);
const toolsDir = all.global.toolsDir ? resolve(HERE, all.global.toolsDir) : null;
const b = await runBisect({
  repoDir, depsDir: p.repoDir, workDir: join(p.stateDir, 'bisect-cli'), side, testRel, testText: readFileSync(testFile, 'utf8'), testClass, toolsDir, bad, candidates,
  minutes: Number(opt('--minutes') ?? p.cfg.bisectMinutes ?? 12), checkBad: true,
  onStep: (s) => console.log(`  ${s.short}  ${s.verdict.padEnd(4)}  ${String(s.seconds).padStart(4)} s  ${s.verdict === 'good' ? '' : s.why}`),
});
console.log(`\n${bisectSummary(b)}`);
if (b.status === 'found' && b.culprit.ticket) console.log(`That change was made for ${b.culprit.ticket}.`);
process.exit(['found', 'range', 'older'].includes(b.status) ? 0 : 1);
