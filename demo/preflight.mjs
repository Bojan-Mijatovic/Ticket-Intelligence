#!/usr/bin/env node
// Go / no-go check before a live demo. Read-only: nothing is posted, pushed or created.
//   node demo/preflight.mjs                   the MediAgenda scenario (docs/DEMO_SCENARIO.md, sections 3-4)
//   node demo/preflight.mjs --teams           the live variant (section 9): a real Teams channel and a reserved case of
//                                             the MediVax pilot, pushed that morning. --project <KEY> for another pilot

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SKILL = join(homedir(), '.claude', 'skills', 'analyze-ticket');
const args = process.argv.slice(2);
const TEAMS = args.includes('--teams');
const projectAt = args.indexOf('--project');
const LIVE = (projectAt >= 0 && args[projectAt + 1] ? args[projectAt + 1] : 'VAX').toUpperCase();
const { loadProjects } = await import('../agent/lib/projects.mjs');
const suite = loadProjects(join(ROOT, 'agent'));
const agentCfg = suite.global;
const APPS = suite.projects.filter((p) => existsSync(p.repoDir) && (!TEAMS || p.key === LIVE));
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

console.log(TEAMS ? `Preflight: the live Teams variant on ${LIVE} (docs/DEMO_SCENARIO.md section 9)\n` : 'Preflight\n');
if (TEAMS && !APPS.length) {
  console.log(`  ✗ no project ${LIVE} with a clone on this machine`);
  process.exit(1);
}
await check('Jira connection', () => {
  const r = JSON.parse(sh('node', [join(SKILL, 'scripts', 'ticket.mjs'), 'check'], ROOT));
  if (r.source !== 'jira') throw new Error('JIRA_MOCK is on');
  return `${r.user} @ ${r.config.baseUrl}`;
});
if (!TEAMS) await check('No leftover demo tickets', () => {
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
    if (sh('git', ['rev-parse', 'HEAD'], APP) !== sh('git', ['rev-parse', 'origin/main'], APP)) throw new Error(`not equal to origin/main (a push from elsewhere, e.g. the pilot): git -C ${relative(ROOT, APP).replace(/\\/g, '/')} pull --ff-only`);
    return sh('git', ['log', '--oneline', '-1'], APP);
  });
  // The pilot leaves its own agent branches and PRs open for a person to merge: in the live variant they are only noted.
  await check(`${app.name}: no agent branches or open agent pull requests`, () => {
    const remote = sh('git', ['branch', '-r', '--format=%(refname:short)'], APP).split('\n').map((b) => b.replace(/^origin\//, '')).filter((b) => AGENT_BRANCH.test(b));
    const local = sh('git', ['branch', '--format=%(refname:short)'], APP).split('\n').filter((b) => AGENT_BRANCH.test(b));
    const slug = slugOf(APP);
    const prs = slug ? JSON.parse(sh('gh', ['pr', 'list', '--repo', slug, '--state', 'open', '--json', 'headRefName'], APP)).filter((p) => AGENT_BRANCH.test(p.headRefName)) : [];
    const left = [...remote.map((b) => `origin/${b}`), ...local, ...prs.map((p) => `PR ${p.headRefName}`)];
    if (left.length) throw new Error(TEAMS ? `open from earlier pilot cases: ${prs.map((p) => p.headRefName).join(', ') || left.join(', ')}; a new ticket gets its own branch, so they do not stop the demo` : `${left.join(', ')} (node demo/reset-demo.mjs --yes)`);
    return 'none';
  }, { optional: TEAMS });
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
const BACKEND_PROBE = { DEM: '/api/structures?q=svil', LAB: '/api/exams', FAR: '/api/drugs', BIL: '/api/tariffs', VAX: '/api/vaccines' };
for (const app of APPS) {
  await check(`${app.name} frontend on :${app.app.frontend}`, () => httpOk(`${app.app.url}${app.app.home}`), { optional: true });
  await check(`${app.name} backend on :${app.app.backend}`, () => httpOk(`http://localhost:${app.app.backend}${BACKEND_PROBE[app.key] ?? '/'}`), { optional: true });
}

if (TEAMS) await teamsChecks();

/** Section 9: the Teams channel from this network, the owner's account, the pilot's state, and a calm machine. */
async function teamsChecks() {
  const { loadConfig } = await import('../.claude/skills/analyze-ticket/scripts/lib/config.mjs');
  const { mentionFor } = await import('../agent/lib/notify.mjs');
  loadConfig(); // the .env files, as the watcher reads them
  const app = APPS[0];
  const base = `http://localhost:${agentCfg.dashboardPort}`;
  const status = await fetch(`${base}/api/status`).then((r) => r.json()).catch(() => null);
  const reserve = app.cfg.pilot?.reserve ?? [];
  const stateFile = join(app.stateDir, 'pilot', 'state.json');
  const runs = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')).runs ?? [] : [];
  const demo = runs.filter((r) => r.status === 'planted' && reserve.includes(r.case)).at(-1) ?? null;
  const src = join(HERE, 'src', basename(app.repoDir)); // demo/medivax → demo/src/medivax, as demo/pilot.mjs reads it
  const { CASES } = existsSync(join(src, 'pilot-cases.mjs')) ? await import(pathToFileURL(join(src, 'pilot-cases.mjs')).href) : { CASES: [] };
  const { PEOPLE } = existsSync(join(src, 'history.mjs')) ? await import(pathToFileURL(join(src, 'history.mjs')).href) : { PEOPLE: {} };
  const ownerOf = (id) => PEOPLE[CASES.find((c) => c.id === id)?.author]?.[0] ?? null;

  await check('Teams: the watcher posts to a real channel and @mentions the owner', () => {
    if (!status?.teams) throw new Error('the watcher does not answer, or is older than this check: node agent/watcher.mjs --replace');
    if (!status.teams.live) throw new Error('no TEAMS_WEBHOOK_URL: messages would be simulated (agent/README.md, Notifications)');
    if (!status.teams.mentions) throw new Error('no TEAMS_MENTION_DOMAIN or TEAMS_MENTIONS: the message would come, but no phone rings');
    return status.teams.channelUrl ? 'live, @mentions, Open in Teams' : 'live, @mentions (no TEAMS_CHANNEL_URL: no Open in Teams)';
  });
  // A GET is refused by the workflow's trigger without running it: proof of the address and the network, nothing posted.
  await check('Teams: the webhook answers from this network (nothing posted)', async () => {
    const hook = String(process.env.TEAMS_WEBHOOK_URL ?? '').trim();
    if (!hook) throw new Error('TEAMS_WEBHOOK_URL is not in the .env of this folder or of the skill');
    let res;
    try {
      res = await fetch(hook, { method: 'GET', signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      throw new Error(`no answer (${e.name === 'TimeoutError' ? '15 s' : e.message}): proxy, firewall or no network`);
    }
    const body = await res.text().catch(() => '');
    if (res.status === 404) throw new Error('404: the workflow was deleted or turned off, or the URL is wrong');
    if (/TriggerRequestMethodNotValid/.test(body)) return `the workflow is there (HTTP ${res.status} to a GET, as expected)`;
    throw new Error(`unexpected HTTP ${res.status}: check with node agent/teams-test.mjs`);
  });
  const owner = demo ? ownerOf(demo.case) : ownerOf(reserve[0]);
  await check(`Teams: ${owner ?? 'the demo owner'} has an account to mention`, () => {
    if (!owner) throw new Error(reserve.length ? `the author of ${demo?.case ?? reserve[0]} is not in ${relative(ROOT, src).replace(/\\/g, '/')} (pilot-cases.mjs, history.mjs)` : `no reserved case in agent.config.json → ${app.key}.pilot.reserve`);
    const upn = mentionFor(owner);
    if (!upn) throw new Error(`no TEAMS_MENTIONS entry or TEAMS_MENTION_DOMAIN for "${owner}"`);
    return `${upn}; the day before, from the room's network: node agent/teams-test.mjs --mention "${owner}"`;
  });

  await check('Pilot: a reserved case is pushed and waits for its report on stage', () => {
    if (!reserve.length) throw new Error(`no reserved cases: agent.config.json → ${app.key}.pilot.reserve`);
    if (!demo) throw new Error(`none pushed: node demo/pilot.mjs plant --case ${reserve[0]} (at least an hour before; the day before, check it with node demo/pilot.mjs check --case ${reserve[0]})`);
    return `${demo.case}: ${demo.story} on main as ${demo.short} by ${demo.author}, ${new Date(demo.plantedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}; on stage: node demo/pilot.mjs report --case ${demo.case}`;
  });
  await check('Pilot: no other case in flight (no unplanned ticket during the demo)', () => {
    const other = runs.filter((r) => r.status === 'planted' && !reserve.includes(r.case));
    if (other.length) throw new Error(`${other.map((r) => `${r.case} (${r.story})`).join(', ')} waits to be reported, so its ticket could come during the demo: node demo/pilot.mjs report --case ${other[0].case} now`);
    return 'none';
  });
  if (demo) {
    await check('Pilot: the regression guard checked the demo commit', () => {
      const ev = readFileSync(join(ROOT, 'agent', 'state', 'events.jsonl'), 'utf8').split('\n').filter((l) => l.includes(`"commit":"${demo.sha}`)).map((l) => JSON.parse(l)).find((e) => e.type === 'guard');
      if (!ev) throw new Error('not yet (it runs within 2 minutes of a push while the watcher runs)');
      return `${ev.verdict} (shown on the Graph tab)`;
    }, { optional: true });
  }

  // A job already running (a merge check runs every browser test: minutes) would hold up the ticket of the scene.
  await check('Watcher idle: nothing running that would hold up the demo ticket', async () => {
    const b = await fetch(`${base}/api/busy`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!b) return 'not known (an older watcher)';
    if (b.busy) throw new Error(`busy with ${b.what.join(', ')}: wait until it is done (GET /api/busy), then run this again`);
    return 'idle';
  }, { optional: true });
  await check('Watcher answers within a second', async () => {
    const t0 = Date.now();
    await fetch(`${base}/api/status`);
    const ms = Date.now() - t0;
    if (ms > 1000) throw new Error(`${ms} ms: something heavy runs on this machine; the dashboard would stall during the demo`);
    return `${ms} ms`;
  });
  await check('No System 1 training running', () => {
    if (process.platform !== 'win32') return 'not checked off Windows';
    const lines = sh('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='node.exe' OR Name='python.exe'\" | ForEach-Object { $_.CommandLine }"]);
    if (/system1-train\.mjs|laya-train/.test(lines)) throw new Error('a training runs: it slows the machine for hours (agent/system1-train.mjs); let it finish the day before, or stop it');
    return 'none';
  }, { optional: true });
  await check('System 1 ready', () => {
    if (!status?.system1 || status.system1.mode === 'off') return 'off in policy.json';
    if (!status.system1.ready) throw new Error(`${status.system1.reason ?? 'still loading'}; it only compares, in shadow, so the demo does not need it`);
    return `${status.system1.model}, ${status.system1.mode}`;
  }, { optional: true });
}

const blocking = results.filter((r) => !r.ok && !r.optional);
if (TEAMS) console.log('\nNot checked here: the owner signed in on a phone with the channel\'s notifications on, the private laptop on the channel (125 %, Do not disturb), the recording.');
console.log(blocking.length ? `\nNO-GO: ${blocking.length} blocking problem(s).` : '\nGO: ready for the demo.');
process.exitCode = blocking.length ? 1 : 0;
