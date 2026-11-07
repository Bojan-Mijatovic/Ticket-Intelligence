#!/usr/bin/env node
// Go / no-go check before a live demo. Read-only.
//   node demo/preflight.mjs

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SKILL = join(homedir(), '.claude', 'skills', 'analyze-ticket');
const { loadProjects } = await import('../agent/lib/projects.mjs');
const suite = loadProjects(join(ROOT, 'agent'));
const agentCfg = suite.global;
const APPS = suite.projects.filter((p) => existsSync(p.repoDir));
const AGENT_BRANCH = /^(docs\/)?[A-Z][A-Z0-9_]+-\d+$/;

const sh = (cmd, args, cwd = ROOT, timeout = 60_000) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout, shell: process.platform === 'win32' && cmd === 'claude' }).trim();
const results = [];
async function check(name, fn, { optional = false } = {}) {
  try {
    const detail = await fn();
    results.push({ ok: true, name, detail });
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (e) {
    results.push({ ok: false, optional, name, detail: e.message });
    console.log(`  ${optional ? '!' : '✗'} ${name} — ${String(e.message).split('\n')[0]}`);
  }
}
const httpOk = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return url;
};

console.log('Preflight\n');
await check('Jira connection', () => {
  const r = JSON.parse(sh('node', [join(SKILL, 'scripts', 'ticket.mjs'), 'check'], ROOT));
  if (r.source !== 'jira') throw new Error('JIRA_MOCK is on');
  return `${r.user} @ ${r.config.baseUrl}`;
});
await check('No leftover demo tickets', () => {
  const t = existsSync(join(HERE, '.demo-tickets.json')) ? JSON.parse(readFileSync(join(HERE, '.demo-tickets.json'), 'utf8')) : [];
  if (t.length) throw new Error(`still open: ${t.join(', ')} (node demo/reset-demo.mjs --yes)`);
  return 'none';
});
await check('Claude CLI answers headless', () => {
  const out = JSON.parse(execFileSync('claude', ['-p', '--output-format', 'json', '--max-turns', '1'], { input: 'Reply with exactly: OK', encoding: 'utf8', timeout: 90_000, shell: process.platform === 'win32' }));
  if (out.is_error || !/OK/.test(out.result)) throw new Error(`unexpected answer: ${String(out.result).slice(0, 80)}`);
  return 'OK';
});
await check('GitHub CLI logged in', () => sh('gh', ['api', 'user', '--jq', '.login']));
const slugOf = (APP) => {
  try {
    return sh('git', ['remote', 'get-url', 'origin'], APP).match(/github\.com[/:]([^/]+)\/([^/.]+)/)?.slice(1, 3).join('/') ?? null;
  } catch {
    return null; // no remote yet
  }
};
for (const app of APPS) {
  const APP = app.repoDir;
  await check(`${app.name} clone on main, clean, up to date`, () => {
    sh('git', ['fetch', '-q', '--prune', 'origin'], APP);
    const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD'], APP);
    if (branch !== 'main') throw new Error(`on branch ${branch} (a preview?): node demo/preview.mjs main --project ${app.key}`);
    if (sh('git', ['status', '--porcelain'], APP)) throw new Error('uncommitted changes');
    if (sh('git', ['rev-parse', 'HEAD'], APP) !== sh('git', ['rev-parse', 'origin/main'], APP)) throw new Error('not equal to origin/main');
    return sh('git', ['log', '--oneline', '-1'], APP);
  });
  await check(`${app.name}: no agent branches or open agent pull requests`, () => {
    const remote = sh('git', ['branch', '-r', '--format=%(refname:short)'], APP).split('\n').map((b) => b.replace(/^origin\//, '')).filter((b) => AGENT_BRANCH.test(b));
    const local = sh('git', ['branch', '--format=%(refname:short)'], APP).split('\n').filter((b) => AGENT_BRANCH.test(b));
    const slug = slugOf(APP);
    const prs = slug ? JSON.parse(sh('gh', ['pr', 'list', '--repo', slug, '--state', 'open', '--json', 'headRefName'], APP)).filter((p) => AGENT_BRANCH.test(p.headRefName)) : [];
    const left = [...remote.map((b) => `origin/${b}`), ...local, ...prs.map((p) => `PR ${p.headRefName}`)];
    if (left.length) throw new Error(`${left.join(', ')} (node demo/reset-demo.mjs --yes)`);
    return 'none';
  });
  await check(`${app.name}: Playwright and node_modules installed`, () => {
    for (const p of ['frontend/node_modules/@angular/core', 'e2e/node_modules/@playwright/test']) if (!existsSync(join(APP, p))) throw new Error(`missing ${p}`);
    return 'frontend + e2e';
  });
}
await check(`Watcher dashboard on :${agentCfg.dashboardPort}`, () => httpOk(`http://localhost:${agentCfg.dashboardPort}/`));
await check('Watcher runs the current agent code', async () => {
  const res = await fetch(`http://localhost:${agentCfg.dashboardPort}/api/status`);
  if (!res.ok) throw new Error('the running watcher is older than this check (no /api/status); restart: node agent/watcher.mjs --replace');
  const s = await res.json();
  const AGENT = join(ROOT, 'agent');
  const files = ['watcher.mjs', 'policy.json', 'agent.config.json', ...readdirSync(join(AGENT, 'lib')).map((f) => join('lib', f))];
  const newest = files.map((f) => ({ f, t: statSync(join(AGENT, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0];
  if (newest.t > Date.parse(s.startedAt)) throw new Error(`agent/${newest.f.replace(/\\/g, '/')} changed after the watcher started; restart: node agent/watcher.mjs --replace`);
  return `PID ${s.pid}, started ${new Date(s.startedAt).toLocaleTimeString('en-GB')}`;
});
await check('GitHub pull request links open in the demo browser', () => {
  const slugs = APPS.map((a) => slugOf(a.repoDir)).filter(Boolean);
  const priv = slugs.filter((slug) => sh('gh', ['repo', 'view', slug, '--json', 'visibility', '--jq', '.visibility']) === 'PRIVATE');
  return priv.length ? `${priv.join(', ')} private: the browser must be signed in to GitHub as ${sh('gh', ['api', 'user', '--jq', '.login'])} (otherwise 404)` : `${slugs.join(', ')} public`;
});
// The running apps (node demo/run-mediagenda.mjs --all): optional, and each app calls the ones it is linked to.
const BACKEND_PROBE = { DEM: '/api/structures?q=svil', LAB: '/api/exams', FAR: '/api/drugs', BIL: '/api/tariffs' };
for (const app of APPS) {
  await check(`${app.name} frontend on :${app.app.frontend}`, () => httpOk(`${app.app.url}${app.app.home}`), { optional: true });
  await check(`${app.name} backend on :${app.app.backend}`, () => httpOk(`http://localhost:${app.app.backend}${BACKEND_PROBE[app.key] ?? '/'}`), { optional: true });
}

const blocking = results.filter((r) => !r.ok && !r.optional);
console.log(blocking.length ? `\nNO-GO: ${blocking.length} blocking problem(s).` : '\nGO: ready for the demo.');
process.exitCode = blocking.length ? 1 : 0;
