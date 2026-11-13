// Independent verification: the watcher runs the checks itself instead of trusting what the agent reports.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

let nextPort = 4310;

function run(cmd, args, { cwd, env = {}, timeoutMs = 600_000 }) {
  const started = Date.now();
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, shell: process.platform === 'win32', windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code, out, durationMs: Date.now() - started });
    });
  });
}

const tail = (s, n = 25) => s.split(/\r?\n/).filter((l) => l.trim()).slice(-n).join('\n');

/** Runs Playwright specs (relative to e2e/) and returns pass/fail counts and the first failure. */
export async function runE2E(ws, specs, { evidenceDir }) {
  const port = nextPort++;
  const report = join(evidenceDir, `report-${port}.json`);
  // Reporters come from playwright.config.ts (list + json to E2E_REPORT); a --reporter flag would override them.
  const r = await run('npx', ['playwright', 'test', ...specs], {
    cwd: join(ws.path, 'e2e'),
    // CI=1 disables reuseExistingServer: the tests must run against this workspace's code, never another app.
    env: { CI: '1', E2E_PORT: String(port), E2E_REPORT: report, EVIDENCE_DIR: evidenceDir },
  });
  let stats = { expected: 0, unexpected: 0, skipped: 0 };
  let firstError = null;
  const cases = []; // one per test: { file (relative to e2e/tests), title, ok, error }
  if (existsSync(report)) {
    const json = JSON.parse(readFileSync(report, 'utf8'));
    stats = { ...stats, ...json.stats };
    const walk = (suite) => {
      for (const spec of suite.specs ?? []) {
        let error = null;
        for (const t of spec.tests ?? []) {
          for (const res of t.results ?? []) {
            const msg = res.status !== 'passed' ? (res.error?.message ?? res.status).replace(/\x1b\[[0-9;]*m/g, '') : null;
            if (msg && !error) error = tail(msg, 8);
            if (!firstError && msg) firstError = msg;
          }
        }
        cases.push({ file: spec.file ?? suite.file ?? null, title: spec.title, ok: spec.ok !== false && !error, error });
      }
      (suite.suites ?? []).forEach(walk);
    };
    (json.suites ?? []).forEach(walk);
  }
  return {
    ok: r.code === 0 && stats.unexpected === 0 && stats.expected > 0,
    passed: stats.expected,
    failed: stats.unexpected,
    firstError: firstError ? tail(firstError, 12) : null,
    cases,
    durationMs: r.durationMs,
    output: tail(r.out),
  };
}

export async function runFrontendBuild(ws) {
  const r = await run('npx', ['ng', 'build'], { cwd: join(ws.path, 'frontend'), env: { NG_CLI_ANALYTICS: 'false' } });
  return { ok: r.code === 0, durationMs: r.durationMs, output: tail(r.out, 15) };
}

/** Maven and JAVA_HOME: the portable JDK/Maven from tools/ when java/mvn are not on PATH. */
function maven(toolsDir) {
  const env = {};
  let mvn = 'mvn';
  if (toolsDir && existsSync(toolsDir)) {
    const jdk = readdirSync(toolsDir).find((d) => d.startsWith('jdk-'));
    const mavenDir = readdirSync(toolsDir).find((d) => d.startsWith('apache-maven-'));
    if (jdk && mavenDir) {
      env.JAVA_HOME = resolve(toolsDir, jdk);
      mvn = resolve(toolsDir, mavenDir, 'bin', process.platform === 'win32' ? 'mvn.cmd' : 'mvn');
    }
  }
  return { mvn, env };
}

/**
 * Totals and the first failure from the surefire XML reports (target/surefire-reports). A test class that did not
 * compile has no report at all, so "failed on an assertion" and "did not compile" can be told apart.
 */
export function surefireResults(reportsDir, onlyClass = null) {
  // firstKind: "failure" (an assertion) or "error" (an exception), as surefire records the first failed test.
  const out = { tests: 0, failed: 0, classes: [], firstError: null, firstKind: null };
  if (!existsSync(reportsDir)) return out;
  for (const f of readdirSync(reportsDir).filter((n) => /^TEST-.+\.xml$/.test(n))) {
    const name = f.slice(5, -4);
    if (onlyClass && !name.endsWith(`.${onlyClass}`) && name !== onlyClass) continue;
    const xml = readFileSync(join(reportsDir, f), 'utf8');
    const attr = (a) => Number(xml.match(new RegExp(`<testsuite[^>]*\\s${a}="(\\d+)"`))?.[1] ?? 0);
    const tests = attr('tests');
    const failed = attr('failures') + attr('errors');
    out.tests += tests;
    out.failed += failed;
    out.classes.push({ name, tests, failed });
    if (!out.firstError && failed) {
      const m = xml.match(/<(failure|error)(\s[^>]*)?>([\s\S]*?)<\/\1>/);
      const message = m?.[2]?.match(/\smessage="([^"]*)"/)?.[1];
      const decode = (s) => String(s ?? '').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#10;/g, '\n').replace(/&amp;/g, '&');
      out.firstError = tail(`${decode(message)}\n${decode(m?.[3])}`, 12);
      out.firstKind = m?.[1] ?? null;
    }
  }
  return out;
}

/** Every test case in the surefire reports: { className (simple), method, ok, error }. */
export function surefireCases(reportsDir) {
  const out = [];
  if (!existsSync(reportsDir)) return out;
  const decode = (s) => String(s ?? '').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#10;/g, '\n').replace(/&amp;/g, '&');
  for (const f of readdirSync(reportsDir).filter((n) => /^TEST-.+\.xml$/.test(n))) {
    const xml = readFileSync(join(reportsDir, f), 'utf8');
    for (const m of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
      const attr = (a) => decode(m[1].match(new RegExp(`\\s${a}="([^"]*)"`))?.[1]);
      const bad = m[3]?.match(/<(failure|error)(\s[^>]*)?>([\s\S]*?)<\/\1>|<(failure|error)(\s[^>]*)?\/>/);
      out.push({
        className: attr('classname').split('.').pop(),
        method: attr('name').replace(/\(.*\)$/, ''),
        ok: !bad,
        error: bad ? tail(decode((bad[2] ?? bad[5] ?? '').match(/\smessage="([^"]*)"/)?.[1] ?? bad[3] ?? 'failed'), 8) : null,
      });
    }
  }
  return out;
}

/** A surefire selection (-Dtest=A#m1+m2,B): every case run, or the build output when nothing ran (compile error). */
export async function runBackendSelection(ws, toolsDir, selection) {
  const { mvn, env } = maven(toolsDir);
  const reports = join(ws.path, 'backend', 'target', 'surefire-reports');
  rmSync(reports, { recursive: true, force: true });
  const r = await run(mvn, ['-q', '-B', 'test', `-Dtest=${selection}`, '-Dsurefire.failIfNoSpecifiedTests=false'], { cwd: join(ws.path, 'backend'), env });
  const cases = surefireCases(reports);
  return { cases, error: cases.length ? null : tail(r.out, 15), durationMs: r.durationMs };
}

/** All Maven tests; passed/failed from the surefire reports. */
export async function runBackendTests(ws, toolsDir) {
  const { mvn, env } = maven(toolsDir);
  const reports = join(ws.path, 'backend', 'target', 'surefire-reports');
  rmSync(reports, { recursive: true, force: true });
  const r = await run(mvn, ['-q', '-B', 'test'], { cwd: join(ws.path, 'backend'), env });
  const s = surefireResults(reports);
  return { ok: r.code === 0, passed: s.tests - s.failed, failed: s.failed, firstError: s.firstError, durationMs: r.durationMs, output: tail(r.out, 15) };
}

/**
 * One test class (the regression test of a backend ticket). `compiled` is false when Maven produced no report for it
 * (compile error, wrong class name): that is not a reproduction.
 */
export async function runBackendTest(ws, toolsDir, testClass) {
  const { mvn, env } = maven(toolsDir);
  const reports = join(ws.path, 'backend', 'target', 'surefire-reports');
  rmSync(reports, { recursive: true, force: true });
  const r = await run(mvn, ['-q', '-B', 'test', `-Dtest=${testClass}`, '-Dsurefire.failIfNoSpecifiedTests=false'], { cwd: join(ws.path, 'backend'), env });
  const s = surefireResults(reports, testClass);
  return { compiled: s.classes.length > 0, tests: s.tests, failed: s.failed, firstError: s.firstError ?? (s.classes.length ? null : tail(r.out, 12)), firstKind: s.firstKind, durationMs: r.durationMs };
}
