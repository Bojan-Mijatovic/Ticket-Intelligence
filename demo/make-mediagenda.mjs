#!/usr/bin/env node
// Builds demo/mediagenda: Angular 18 frontend + Spring Boot (Java 21) backend + H2/Flyway database, with a git
// history that matches the mock Jira tickets CUP_DEMO-2398 … CUP_DEMO-2629.
//
//   node demo/make-mediagenda.mjs [--svn] [--force] [--no-install]
//   --svn builds demo/mediagenda-svn (working copy) + demo/mediagenda-svn-repo (SVN repository) instead of the git repo.
//
// demo/src/mediagenda/template/  = the project as it is today (HEAD)
// demo/src/mediagenda/history/   = older versions of files that changed over time
//
// The story: CUP_DEMO-2398 made the time slot search accept several structures, and the FE store started to
// *append* every selected structure. CUP_DEMO-2511 fixed the PULISCI button (reset the store + clear the field),
// but clearing the Struttura field by hand still leaves the old structure in the store → CUP_DEMO-2629.

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'src', 'mediagenda');
const TEMPLATE = join(SRC, 'template');
const HISTORY = join(SRC, 'history');
const REPO = join(HERE, 'mediagenda');

const PEOPLE = {
  davide: ['Davide Greco', 'davide.greco@example.com'],
  luca: ['Luca Bianchi', 'luca.bianchi@example.com'],
  marta: ['Marta Ricci', 'marta.ricci@example.com'],
  sara: ['Sara Colombo', 'sara.colombo@example.com'],
  bojan: ['Bojan Mijatović', '256592520+Bojan-Mijatovic@users.noreply.github.com', 'bojan.mijatovic'],
};

const T = 'template';
const H = (dir) => ({ history: dir });
const BE = 'backend/src/main/java/com/mediagenda';
const FE = 'frontend/src/app';
const MIG = 'backend/src/main/resources/db/migration';

const STEPS = [
  {
    who: 'davide', date: '2026-02-02T10:00:00+01:00',
    message: 'Backend skeleton: Spring Boot app, structures, resources, time slots (Flyway V1, V2)',
    files: {
      '.gitignore': T, 'README.md': T,
      'backend/pom.xml': T, 'backend/src/main/resources/application.yml': T,
      [`${BE}/MediAgendaApplication.java`]: T,
      [`${BE}/common/ApiError.java`]: T, [`${BE}/common/GlobalExceptionHandler.java`]: T, [`${BE}/common/NotFoundException.java`]: T,
      [`${BE}/structure/Structure.java`]: T, [`${BE}/structure/StructureRepository.java`]: T, [`${BE}/structure/StructureController.java`]: T,
      [`${BE}/resource/AgendaResource.java`]: T, [`${BE}/resource/AgendaResourceRepository.java`]: T,
      [`${BE}/resource/AgendaResourceService.java`]: H('01-backend'), [`${BE}/resource/AgendaResourceController.java`]: T,
      [`${BE}/timeslot/TimeSlot.java`]: T, [`${BE}/timeslot/TimeSlotController.java`]: T,
      [`${BE}/timeslot/TimeSlotRepository.java`]: H('01-backend'), [`${BE}/timeslot/TimeSlotSearchRequest.java`]: H('01-backend'),
      [`${BE}/timeslot/TimeSlotService.java`]: H('01-backend'),
      [`${MIG}/V1__structures_resources_timeslots.sql`]: T, [`${MIG}/V2__seed_agenda.sql`]: T,
    },
  },
  {
    who: 'marta', date: '2026-02-09T15:30:00+01:00',
    message: 'Frontend skeleton: Angular 18 app shell, layout, routing, shared models',
    files: {
      'frontend/package.json': T, 'frontend/angular.json': T, 'frontend/tsconfig.json': T, 'frontend/tsconfig.app.json': T,
      'frontend/proxy.conf.json': T, 'frontend/src/index.html': T, 'frontend/src/main.ts': T, 'frontend/src/styles.scss': T,
      [`${FE}/app.config.ts`]: T, [`${FE}/app.routes.ts`]: T, [`${FE}/app.component.ts`]: T,
      [`${FE}/core/layout/header.component.ts`]: T, [`${FE}/core/layout/sidenav.component.ts`]: T,
      [`${FE}/core/i18n/labels.ts`]: T, [`${FE}/core/http/api.ts`]: T, [`${FE}/shared/models/agenda.models.ts`]: T,
    },
  },
  {
    who: 'sara', date: '2026-02-19T11:15:00+01:00',
    message: 'Agenda search mask: Struttura autocomplete, footer actions, resources and time slot tables',
    files: {
      [`${FE}/shared/services/structure-api.service.ts`]: T,
      [`${FE}/shared/components/footer-actions/footer-actions.component.ts`]: T,
      [`${FE}/shared/components/structure-autocomplete/structure-autocomplete.component.ts`]: H('03-agenda'),
      [`${FE}/shared/components/structure-autocomplete/structure-autocomplete.component.html`]: T,
      [`${FE}/shared/components/structure-autocomplete/structure-autocomplete.component.scss`]: T,
      [`${FE}/features/agenda/services/agenda-api.service.ts`]: H('03-agenda'),
      [`${FE}/features/agenda/state/agenda-search.store.ts`]: H('03-agenda'),
      [`${FE}/features/agenda/search-mask/search-mask.component.ts`]: H('03-agenda'),
      [`${FE}/features/agenda/search-mask/search-mask.component.html`]: T,
      [`${FE}/features/agenda/results/resources-list.component.ts`]: T,
      [`${FE}/features/agenda/results/timeslot-table.component.ts`]: H('03-agenda'),
    },
  },
  {
    who: 'luca', date: '2026-03-04T09:40:00+01:00',
    message: 'Booking module: bookings table (Flyway V3) and API',
    files: {
      [`${BE}/booking/Booking.java`]: T, [`${BE}/booking/BookingRepository.java`]: T, [`${BE}/booking/BookingController.java`]: T,
      [`${MIG}/V3__bookings.sql`]: T,
    },
  },
  {
    who: 'marta', date: '2026-03-11T14:00:00+01:00',
    message: 'Prenotazioni page: bookings list',
    files: { [`${FE}/features/booking/booking-api.service.ts`]: T, [`${FE}/features/booking/booking-list.component.ts`]: T },
  },
  {
    who: 'davide', date: '2026-03-25T10:30:00+01:00',
    message: 'Patient module: patient search API with paging (Flyway V4)',
    files: {
      [`${BE}/patient/Patient.java`]: T, [`${BE}/patient/PatientRepository.java`]: T, [`${BE}/patient/PatientController.java`]: T,
      [`${BE}/common/PageResponse.java`]: T, [`${MIG}/V4__patients.sql`]: T,
    },
  },
  {
    who: 'sara', date: '2026-04-02T16:20:00+02:00',
    message: 'Pazienti page: patient search with paging',
    files: { [`${FE}/features/patients/patient-api.service.ts`]: T, [`${FE}/features/patients/patient-search.component.ts`]: T },
  },
  {
    who: 'luca', date: '2026-05-14T12:10:00+02:00',
    message: 'CUP_DEMO-2398: time slot search accepts a list of structureIds\n\nPOST /api/agenda/structure-timeslots now takes { structureIds: [...] } and merges the slots of all structures.',
    files: {
      [`${BE}/timeslot/TimeSlotSearchRequest.java`]: T, [`${BE}/timeslot/TimeSlotService.java`]: T,
      [`${BE}/timeslot/TimeSlotRepository.java`]: T, 'backend/src/test/java/com/mediagenda/timeslot/TimeSlotServiceTest.java': T,
    },
  },
  {
    who: 'sara', date: '2026-05-15T17:45:00+02:00',
    message: 'CUP_DEMO-2398: Agenda search keeps a list of selected structures and sends structureIds',
    files: {
      [`${FE}/features/agenda/state/agenda-search.store.ts`]: H('09-sup2398-fe'),
      [`${FE}/features/agenda/services/agenda-api.service.ts`]: T,
    },
  },
  {
    who: 'davide', date: '2026-07-08T11:00:00+02:00',
    message: 'CUP_DEMO-2602: resources endpoint returns only active erogatori',
    files: { [`${BE}/resource/AgendaResourceService.java`]: T },
  },
  {
    who: 'sara', date: '2026-09-22T15:05:00+02:00',
    message: 'CUP_DEMO-2511: PULISCI clears the Struttura field and the structure selection\n\nAgendaSearchStore.reset() now also clears selectedStructureIds, and the footer PULISCI\ncalls StructureAutocompleteComponent.clear(), so the next search no longer sends the old structureId.',
    files: {
      [`${FE}/features/agenda/state/agenda-search.store.ts`]: T,
      [`${FE}/features/agenda/search-mask/search-mask.component.ts`]: T,
      [`${FE}/shared/components/structure-autocomplete/structure-autocomplete.component.ts`]: T,
    },
  },
  {
    who: 'marta', date: '2026-10-14T10:20:00+02:00',
    message: 'CUP_DEMO-2615: time slot table sorted by weekday and start time',
    files: { [`${FE}/features/agenda/results/timeslot-table.component.ts`]: T },
  },
  {
    who: 'luca', date: '2026-10-27T09:10:00+01:00',
    message: 'Reports: monthly bookings per structure API',
    files: { [`${BE}/report/ReportController.java`]: T },
  },
  {
    who: 'marta', date: '2026-10-29T16:40:00+01:00',
    message: 'Report page: monthly bookings table',
    files: { [`${FE}/features/reports/reports.component.ts`]: T },
  },
  {
    who: 'bojan', date: '2026-11-04T19:00:00+01:00',
    message: 'Browser tests: Playwright with a mocked backend API',
    files: {
      'e2e/package.json': T, 'e2e/playwright.config.ts': T, 'e2e/README.md': T,
      'e2e/support/agenda.ts': T, 'e2e/support/api-data.json': T, 'e2e/support/evidence.ts': T, 'e2e/support/mock-api.ts': T,
      'e2e/tests/agenda.smoke.spec.ts': T,
    },
  },
];

// ---------------------------------------------------------------- build

const args = process.argv.slice(2);
const SVN_MODE = args.includes('--svn');
const OUT = SVN_MODE ? join(HERE, 'mediagenda-svn') : REPO;
const SVN_REPO = join(HERE, 'mediagenda-svn-repo');

// Empty instead of delete: on Windows the folder itself is often locked by a terminal or editor.
function prepare(dir) {
  if (existsSync(dir)) {
    if (!args.includes('--force')) {
      console.error(`${dir} already exists. Rerun with --force to recreate it.`);
      process.exit(1);
    }
    // A repository that is published (has a remote) is never rebuilt: new commit hashes would need a force push.
    // Reset a published demo by deleting the agent's branches instead (see docs/DEMO_SCENARIO.md).
    // Only the folder's own repository counts: without this check, git would walk up to a parent repository.
    let remote = '';
    if (existsSync(join(dir, '.git'))) {
      try {
        remote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch {
        /* no remote */
      }
    }
    if (remote && !args.includes('--i-know-it-has-a-remote')) {
      console.error(`${dir} is published to ${remote}. Rebuilding it would rewrite its history.\nReset it by deleting the agent's branches instead (docs/DEMO_SCENARIO.md, "Reset").`);
      process.exit(1);
    }
    for (const entry of readdirSync(dir)) rmSync(join(dir, entry), { recursive: true, force: true });
  }
  mkdirSync(dir, { recursive: true });
}

// Real Jira keys (written by seed-jira.mjs): CUP_DEMO-2511 → DEM-5 in commit messages and code comments.
const KEYS_FILE = join(HERE, 'jira-keys.json');
const keyMap = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
const mapKeys = (s) => s.replace(/CUP_DEMO-\d+/g, (k) => keyMap[k] ?? k);
if (Object.keys(keyMap).length) console.log(`Using Jira keys from ${KEYS_FILE}`);
for (const step of STEPS) step.message = mapKeys(step.message);

const committed = new Set();
function applyStep(step, dir) {
  for (const [path, source] of Object.entries(step.files)) {
    const from = source === T ? join(TEMPLATE, path) : join(HISTORY, source.history, path);
    if (!existsSync(from)) throw new Error(`Missing source for ${path}: ${from}`);
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), mapKeys(readFileSync(from, 'utf8')));
    if (source === T) committed.add(path);
  }
}

let summary;
if (!SVN_MODE) {
  prepare(OUT);
  const git = (gitArgs, env = {}) =>
    execFileSync('git', gitArgs, { cwd: OUT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'core.autocrlf', 'false']);
  for (const step of STEPS) {
    applyStep(step, OUT);
    const [name, email] = PEOPLE[step.who];
    git(['add', '-A']);
    git(['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', step.message], {
      GIT_AUTHOR_DATE: step.date,
      GIT_COMMITTER_DATE: step.date,
    });
  }
  summary = git(['log', '--format=%ad  %<(14,trunc)%an %s', '--date=short']);
} else {
  // SVN: a local repository (file://) with trunk/branches/tags, and a working copy of trunk.
  // Authors are SVN logins (e.g. sara.colombo); commit dates are set through the svn:date revision property.
  const tool = (name) => {
    const local = join(HERE, '..', 'tools', 'svn', 'bin', `${name}.exe`);
    return (name === 'svn' && process.env.SVN_BIN) || (existsSync(local) ? local : name);
  };
  const run = (bin, a, cwd = HERE) => execFileSync(tool(bin), a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  prepare(SVN_REPO);
  prepare(OUT);
  run('svnadmin', ['create', SVN_REPO]);
  // Allow changing svn:date / svn:author after the fact (needed to replay the history with its real dates).
  writeFileSync(join(SVN_REPO, 'hooks', 'pre-revprop-change.bat'), '@exit 0\r\n');
  writeFileSync(join(SVN_REPO, 'hooks', 'pre-revprop-change'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const repoUrl = pathToFileURL(SVN_REPO).href;
  const login = (who) => PEOPLE[who][2] ?? PEOPLE[who][1].split('@')[0]; // optional explicit SVN login
  const stamp = (rev, date, who) => {
    run('svn', ['propset', '--revprop', '-r', String(rev), 'svn:date', new Date(date).toISOString().replace('Z', '000Z'), repoUrl]);
    run('svn', ['propset', '--revprop', '-r', String(rev), 'svn:author', login(who), repoUrl]);
  };
  run('svn', ['mkdir', '-m', 'Standard repository layout', `${repoUrl}/trunk`, `${repoUrl}/branches`, `${repoUrl}/tags`]);
  stamp(1, '2026-02-01T09:00:00+01:00', 'davide');
  run('svn', ['checkout', '-q', `${repoUrl}/trunk`, OUT]);
  run('svn', ['propset', '-q', 'svn:global-ignores', 'node_modules\ndist\n.angular\ntarget', '.'], OUT);
  for (const step of STEPS) {
    applyStep(step, OUT);
    run('svn', ['add', '-q', '--force', '.'], OUT);
    const out = run('svn', ['commit', '-m', step.message, '--username', login(step.who)], OUT);
    const rev = Number(out.match(/Committed revision (\d+)/)?.[1]);
    stamp(rev, step.date, step.who);
  }
  run('svn', ['update', '-q'], OUT);
  summary = run('svn', ['log', '-q', '-l', '20'], OUT);
}

const listFiles = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => relative(dir, join(d.parentPath ?? d.path, d.name)).replace(/\\/g, '/'));
const missing = listFiles(TEMPLATE).filter((f) => !committed.has(f));
if (missing.length) console.warn(`WARNING: template files never committed in their final version: ${missing.join(', ')}`);

console.log(`Demo project created (${SVN_MODE ? 'SVN' : 'git'}): ${OUT}
`);
console.log(summary);

if (!args.includes('--no-install')) {
  console.log('Installing frontend dependencies (npm install, ~1 min)…');
  execSync('npm install --no-audit --no-fund --loglevel=error', { cwd: join(OUT, 'frontend'), stdio: 'inherit' });
}

console.log(`
Next:
  node demo/run-mediagenda.mjs${SVN_MODE ? ' --svn' : ''}   # starts backend (8080) and frontend (4200)
  cd demo/${SVN_MODE ? 'mediagenda-svn' : 'mediagenda'} && claude  →  /analyze-ticket CUP_DEMO-2629 "[FE] - Agenda: Search mask: Struttura field: …"`);
