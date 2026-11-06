#!/usr/bin/env node
// Starts the MediAgenda demo: Spring Boot backend on :8080 and Angular dev server on :4200.
// Uses the portable JDK/Maven in tools/ when java/mvn are not on PATH.  Ctrl+C stops both.
// Stays on the current code: pulls a merged main by itself and restarts the backend (or the frontend, for build
// configuration changes) whenever the clone's commit changes, so an old version never keeps running.
//   node demo/run-mediagenda.mjs [--svn] [--no-auto-pull]

import { spawn, execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// --svn runs the SVN working copy (demo/mediagenda-svn) instead of the git repository.
const REPO = join(HERE, process.argv.includes('--svn') ? 'mediagenda-svn' : 'mediagenda');
const TOOLS = join(HERE, '..', 'tools');
const win = process.platform === 'win32';

if (!existsSync(REPO)) {
  console.error(`${REPO} does not exist yet: run "node demo/make-mediagenda.mjs${process.argv.includes('--svn') ? ' --svn' : ''}" first.`);
  process.exit(1);
}

const onPath = (cmd) => {
  try {
    execSync(`${win ? 'where' : 'which'} ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const env = { ...process.env, NG_CLI_ANALYTICS: 'false' };
let mvn = 'mvn';
if (!onPath('mvn') || !onPath('java')) {
  const jdk = existsSync(TOOLS) && readdirSync(TOOLS).find((d) => d.startsWith('jdk-'));
  const maven = existsSync(TOOLS) && readdirSync(TOOLS).find((d) => d.startsWith('apache-maven-'));
  if (!jdk || !maven) {
    console.error('Java 21 and Maven are needed (not on PATH and not found in tools/). Get them with: node demo/get-tools.mjs');
    process.exit(1);
  }
  env.JAVA_HOME = join(TOOLS, jdk);
  // On Windows the variable is usually spelled "Path"; reuse that key so the rest of PATH (node, npx) is kept.
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  env[pathKey] = `${join(TOOLS, jdk, 'bin')}${win ? ';' : ':'}${env[pathKey] ?? ''}`;
  mvn = join(TOOLS, maven, 'bin', win ? 'mvn.cmd' : 'mvn');
}

const SERVICES = {
  backend: { label: 'backend ', cmd: mvn, args: ['-q', 'spring-boot:run'], cwd: join(REPO, 'backend') },
  frontend: { label: 'frontend', cmd: 'npx', args: ['ng', 'serve', '--port', '4200'], cwd: join(REPO, 'frontend') },
};
const children = {};
const restarting = new Set();

function start(name) {
  const s = SERVICES[name];
  const child = spawn(s.cmd, s.args, { cwd: s.cwd, env, shell: win });
  const prefix = (chunk) => chunk.toString().split(/\r?\n/).filter(Boolean).forEach((l) => console.log(`[${s.label}] ${l}`));
  child.stdout.on('data', prefix);
  child.stderr.on('data', prefix);
  child.on('exit', (code) => console.log(`[${s.label}] ${restarting.has(name) ? 'stopped for a restart' : `exited (${code})`}`));
  children[name] = child;
}

function kill(child) {
  if (!child) return;
  if (win) {
    try {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
    } catch {
      /* already gone */
    }
  } else child.kill('SIGINT');
}

async function restart(name, why) {
  console.log(`[runner  ] restarting the ${name}: ${why}`);
  restarting.add(name);
  kill(children[name]);
  await new Promise((r) => setTimeout(r, 1500)); // let the port free up
  restarting.delete(name);
  start(name);
}

start('backend');
start('frontend');

console.log('Starting… backend http://localhost:8080 · frontend http://localhost:4200 (Ctrl+C to stop)');
const stop = () => {
  for (const c of Object.values(children)) kill(c);
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// ---------------------------------------------------------------- stay on the current code (git only)
//
// 1. When the clone's commit changes (a merge pulled in, demo/merge-fix.mjs, Preview of a ticket branch, a manual
//    checkout), restart what does not reload by itself: the backend when backend files changed, the frontend when its
//    build configuration changed. Plain frontend changes are rebuilt and reloaded by ng serve.
// 2. Every 30 s, when the clone is on main and clean and GitHub's main has moved ahead (a pull request was merged),
//    fast-forward to it, so the app never keeps showing an old main. --no-auto-pull turns this off.

const isGit = existsSync(join(REPO, '.git'));
const git = (args) => execSync(`git ${args}`, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const tryGit = (args) => {
  try {
    return git(args);
  } catch {
    return null;
  }
};
const FRONTEND_CONFIG = /^frontend\/(package(-lock)?\.json|angular\.json|proxy\.conf\.json|tsconfig[^/]*\.json)$/;

if (isGit) {
  let head = tryGit('rev-parse HEAD');
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    const now = tryGit('rev-parse HEAD');
    if (!now || now === head) return;
    busy = true;
    try {
      const changed = (tryGit(`diff --name-only ${head} ${now}`) ?? '').split('\n').filter(Boolean);
      const branch = tryGit('rev-parse --abbrev-ref HEAD');
      console.log(`[runner  ] now on ${branch} ${now.slice(0, 7)} (was ${head?.slice(0, 7)}): ${changed.length} file(s) changed`);
      head = now;
      const backend = changed.filter((f) => f.startsWith('backend/'));
      const config = changed.filter((f) => FRONTEND_CONFIG.test(f));
      if (config.some((f) => /package(-lock)?\.json$/.test(f))) {
        console.log('[runner  ] frontend dependencies changed: npm install');
        try {
          execSync('npm install --no-audit --no-fund --loglevel=error', { cwd: join(REPO, 'frontend'), stdio: 'inherit' });
        } catch {
          console.log('[runner  ] npm install failed; run it by hand in demo/mediagenda/frontend');
        }
      }
      if (backend.length) await restart('backend', `${backend.length} backend file(s) changed`);
      if (config.length) await restart('frontend', `build configuration changed (${config.join(', ')})`);
    } finally {
      busy = false;
    }
  }, 3000);

  if (!process.argv.includes('--no-auto-pull')) {
    setInterval(() => {
      if (tryGit('rev-parse --abbrev-ref HEAD') !== 'main' || tryGit('status --porcelain --untracked-files=no')) return;
      if (tryGit('fetch -q origin main') === null) return;
      const local = tryGit('rev-parse HEAD');
      const remote = tryGit('rev-parse origin/main');
      if (!remote || local === remote) return;
      // Only a fast-forward: local commits on main are never thrown away.
      if (tryGit(`merge-base --is-ancestor ${local} ${remote}`) === null) return;
      if (tryGit('merge -q --ff-only origin/main') !== null) console.log(`[runner  ] pulled main: ${tryGit('log -1 --format="%h %s"')}`);
    }, 30_000);
  }
}
