// Independent verification: the watcher runs the checks itself instead of trusting what the agent reports.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
  if (existsSync(report)) {
    const json = JSON.parse(readFileSync(report, 'utf8'));
    stats = { ...stats, ...json.stats };
    const walk = (suite) => {
      for (const spec of suite.specs ?? []) {
        for (const t of spec.tests ?? []) {
          for (const res of t.results ?? []) {
            if (!firstError && res.status !== 'passed') firstError = (res.error?.message ?? res.status).replace(/\x1b\[[0-9;]*m/g, '');
          }
        }
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
    durationMs: r.durationMs,
    output: tail(r.out),
  };
}

export async function runFrontendBuild(ws) {
  const r = await run('npx', ['ng', 'build'], { cwd: join(ws.path, 'frontend'), env: { NG_CLI_ANALYTICS: 'false' } });
  return { ok: r.code === 0, durationMs: r.durationMs, output: tail(r.out, 15) };
}

/** Maven tests with the portable JDK/Maven from tools/ when java/mvn are not on PATH. */
export async function runBackendTests(ws, toolsDir) {
  const env = {};
  let mvn = 'mvn';
  if (toolsDir && existsSync(toolsDir)) {
    const jdk = readdirSync(toolsDir).find((d) => d.startsWith('jdk-'));
    const maven = readdirSync(toolsDir).find((d) => d.startsWith('apache-maven-'));
    if (jdk && maven) {
      env.JAVA_HOME = resolve(toolsDir, jdk);
      mvn = resolve(toolsDir, maven, 'bin', process.platform === 'win32' ? 'mvn.cmd' : 'mvn');
    }
  }
  const r = await run(mvn, ['-q', '-B', 'test'], { cwd: join(ws.path, 'backend'), env });
  return { ok: r.code === 0, durationMs: r.durationMs, output: tail(r.out, 15) };
}
