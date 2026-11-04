#!/usr/bin/env node
// Go / no-go check before a live demo. Read-only.
//   node demo/preflight.mjs

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const APP = join(HERE, 'mediagenda');
const SKILL = join(homedir(), '.claude', 'skills', 'analyze-ticket');
const agentCfg = JSON.parse(readFileSync(join(ROOT, 'agent', 'agent.config.json'), 'utf8'));
const AGENT_BRANCH = /^(docs\/)?[A-Z][A-Z0-9_]+-\d+$/;

const sh = (cmd, args, cwd = APP, timeout = 60_000) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout, shell: process.platform === 'win32' && cmd === 'claude' }).trim();
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
await check('MediAgenda clone on main, clean, up to date', () => {
  sh('git', ['fetch', '-q', '--prune', 'origin']);
  const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main') throw new Error(`on branch ${branch}`);
  if (sh('git', ['status', '--porcelain'])) throw new Error('uncommitted changes');
  if (sh('git', ['rev-parse', 'HEAD']) !== sh('git', ['rev-parse', 'origin/main'])) throw new Error('not equal to origin/main');
  return sh('git', ['log', '--oneline', '-1']);
});
await check('No agent branches or open agent pull requests', () => {
  const remote = sh('git', ['branch', '-r', '--format=%(refname:short)']).split('\n').map((b) => b.replace(/^origin\//, '')).filter((b) => AGENT_BRANCH.test(b));
  const local = sh('git', ['branch', '--format=%(refname:short)']).split('\n').filter((b) => AGENT_BRANCH.test(b));
  const slug = sh('git', ['remote', 'get-url', 'origin']).match(/github\.com[/:]([^/]+)\/([^/.]+)/)?.slice(1, 3).join('/');
  const prs = slug ? JSON.parse(sh('gh', ['pr', 'list', '--repo', slug, '--state', 'open', '--json', 'headRefName'])).filter((p) => AGENT_BRANCH.test(p.headRefName)) : [];
  const left = [...remote.map((b) => `origin/${b}`), ...local, ...prs.map((p) => `PR ${p.headRefName}`)];
  if (left.length) throw new Error(`${left.join(', ')} (node demo/reset-demo.mjs --yes)`);
  return 'none';
});
await check('Playwright and node_modules installed', () => {
  for (const p of ['frontend/node_modules/@angular/core', 'e2e/node_modules/@playwright/test']) if (!existsSync(join(APP, p))) throw new Error(`missing ${p}`);
  return 'frontend + e2e';
});
await check(`Watcher dashboard on :${agentCfg.dashboardPort}`, () => httpOk(`http://localhost:${agentCfg.dashboardPort}/`));
await check('MediAgenda frontend on :4200 (for the opening)', () => httpOk('http://localhost:4200/agenda'), { optional: true });
await check('MediAgenda backend on :8080', () => httpOk('http://localhost:8080/api/structures?q=svil'), { optional: true });

const blocking = results.filter((r) => !r.ok && !r.optional);
console.log(blocking.length ? `\nNO-GO: ${blocking.length} blocking problem(s).` : '\nGO: ready for the demo.');
process.exitCode = blocking.length ? 1 : 0;
