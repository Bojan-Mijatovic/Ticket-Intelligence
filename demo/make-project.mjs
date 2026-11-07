#!/usr/bin/env node
// Builds one application of the demo suite: an Angular 18 frontend + Spring Boot (Java 21) backend + H2/Flyway
// database, with a git history (authors, dates, bug fixes) that matches its Jira tickets.
//
//   node demo/make-project.mjs medilab|medifarma|medibill [--force] [--no-install] [--out <dir>]
//
// demo/src/<name>/template/   the project as it is today (HEAD)
// demo/src/<name>/history.mjs the commits: who, when, message, files (see demo/lib/history.mjs)
// demo/src/<name>/tickets.json the Jira history (seeded with demo/seed-jira.mjs --app <name>)
// MediAgenda is built by demo/make-mediagenda.mjs (it also has an SVN variant).

import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildGitHistory, keyMapper, prepare } from './lib/history.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--out');
const apps = readdirSync(join(HERE, 'src')).filter((d) => d !== 'mediagenda' && existsSync(join(HERE, 'src', d, 'history.mjs')));
if (!name || !apps.includes(name)) {
  console.error(`usage: node demo/make-project.mjs <${apps.join('|')}> [--force] [--no-install] [--out <dir>]${name === 'mediagenda' ? '\nMediAgenda: node demo/make-mediagenda.mjs' : ''}`);
  process.exit(1);
}

const srcDir = join(HERE, 'src', name);
const outArg = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
const outDir = outArg ? resolve(process.cwd(), outArg) : join(HERE, name);
const { PEOPLE, STEPS, TITLE, NEXT } = await import(pathToFileURL(join(srcDir, 'history.mjs')).href);
const { map, mapKeys } = keyMapper(join(HERE, 'jira-keys.json'));
const unmapped = [...new Set(STEPS.flatMap((s) => s.message.match(/CUP_[A-Z]+-\d+/g) ?? []))].filter((k) => !map[k]);
if (unmapped.length) console.warn(`Not seeded in Jira yet (kept as placeholders): ${unmapped.join(', ')}\n  seed first: node demo/seed-jira.mjs --app ${name}`);

try {
  prepare(outDir, { force: args.includes('--force'), allowRemote: args.includes('--i-know-it-has-a-remote') });
  const summary = buildGitHistory({ srcDir, outDir, people: PEOPLE, steps: STEPS, mapKeys });
  console.log(`${TITLE ?? name} created: ${outDir}\n`);
  console.log(summary);
} catch (e) {
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
}

if (!args.includes('--no-install')) {
  for (const dir of ['frontend', 'e2e']) {
    console.log(`Installing ${dir} dependencies (npm install)…`);
    execSync('npm install --no-audit --no-fund --loglevel=error', { cwd: join(outDir, dir), stdio: 'inherit' });
  }
}
if (NEXT) console.log(`\nNext:\n${NEXT}`);
