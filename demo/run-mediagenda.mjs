#!/usr/bin/env node
// Starts the MediAgenda demo: Spring Boot backend on :8080 and Angular dev server on :4200.
// Uses the portable JDK/Maven in tools/ when java/mvn are not on PATH.  Ctrl+C stops both.
//   node demo/run-mediagenda.mjs [--svn]

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
    console.error('Java 21 and Maven are needed (not on PATH and not found in tools/).');
    process.exit(1);
  }
  env.JAVA_HOME = join(TOOLS, jdk);
  env.PATH = `${join(TOOLS, jdk, 'bin')}${win ? ';' : ':'}${env.PATH}`;
  mvn = join(TOOLS, maven, 'bin', win ? 'mvn.cmd' : 'mvn');
}

function start(name, cmd, args, cwd) {
  const child = spawn(cmd, args, { cwd, env, shell: win });
  const prefix = (chunk) => chunk.toString().split(/\r?\n/).filter(Boolean).forEach((l) => console.log(`[${name}] ${l}`));
  child.stdout.on('data', prefix);
  child.stderr.on('data', prefix);
  child.on('exit', (code) => console.log(`[${name}] exited (${code})`));
  return child;
}

const children = [
  start('backend ', mvn, ['-q', 'spring-boot:run'], join(REPO, 'backend')),
  start('frontend', 'npx', ['ng', 'serve', '--port', '4200'], join(REPO, 'frontend')),
];

console.log('Starting… backend http://localhost:8080 · frontend http://localhost:4200 (Ctrl+C to stop)');
const stop = () => {
  for (const c of children) {
    if (win) {
      try {
        execSync(`taskkill /pid ${c.pid} /T /F`, { stdio: 'ignore' });
      } catch {
        /* already gone */
      }
    } else c.kill('SIGINT');
  }
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
