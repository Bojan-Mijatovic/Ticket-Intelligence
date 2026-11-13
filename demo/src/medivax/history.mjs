// MediVax history: who built what, when, and the bugs fixed along the way (each fix is the commit of its ticket).
// Tickets CUP_VAX-5xx are seeded in Jira by demo/seed-jira.mjs --app medivax (demo/src/medivax/tickets.json).
//
// MediVax is the pilot application: after this history, demo/pilot.mjs keeps adding changes and tickets on it every
// working day (docs/PILOT.md). Two bugs of the history are fixed here, and the pilot can bring either back as a
// regression: CUP_VAX-510 (the patient search was case-sensitive) and CUP_VAX-511 (the age went up on 1 January).

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { B, T, cutter } from '../../lib/history.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const cut = cutter(join(HERE, 'template'));

export const TITLE = 'MediVax';
export const NEXT = `  node demo/run-mediagenda.mjs --project VAX     # backend :8084 + frontend :4204
  node demo/pilot.mjs status                       # the pilot: cases planted, tickets reported, scores`;

export const PEOPLE = {
  bojan: ['Bojan Mijatović', '256592520+Bojan-Mijatovic@users.noreply.github.com'],
  irene: ['Irene Fabbri', 'irene.fabbri@example.com'],
  federica: ['Federica Gallo', 'federica.gallo@example.com'],
  tommaso: ['Tommaso Bruno', 'tommaso.bruno@example.com'],
};

const BE = 'backend/src/main/java/com/medivax';
const TEST = 'backend/src/test/java/com/medivax';
const MIG = 'backend/src/main/resources/db/migration';
const FE = 'frontend/src/app';

const ROUTES = `${FE}/app.routes.ts`;
const route = (path) => [cut(ROUTES, `  {\n    path: '${path}',`, '  },\n') + '  },\n', ''];
const R_PAZ = route('pazienti');
const R_CARD = route('pazienti/:id');
const R_VAX = route('vaccini');
const R_DUE = route('scadenze');
const NAV = `${FE}/core/layout/sidenav.component.ts`;
const link = (path, label) => [`      <a routerLink="/${path}" routerLinkActive="active">${label}</a>\n`, ''];
const L_PAZ = link('pazienti', 'Pazienti');
const L_DUE = link('scadenze', 'Scadenze');
const L_VAX = link('vaccini', 'Vaccini');

const REPO = `${BE}/patient/PatientRepository.java`;
const PATIENTS = `${BE}/patient/PatientService.java`;
const PATIENT_TEST = `${TEST}/patient/PatientServiceTest.java`;
const AGES = `${BE}/common/Ages.java`;
const AGES_TEST = `${TEST}/common/AgesTest.java`;
const SEARCH_SPEC = 'e2e/tests/patients.smoke.spec.ts';

const lastTest = (file, name) => [cut(file, `\n\n    @Test\n    void ${name}`, '\n}\n'), ''];
const testBetween = (file, name, next) => [cut(file, `    @Test\n    void ${name}`, `    @Test\n    void ${next}`), ''];

const BUG = {
  // CUP_VAX-510: "rossi" did not find "Rossi": the search was case-sensitive
  caseRepo: ['findTop50ByLastNameStartingWithIgnoreCaseOrFiscalCodeStartingWithIgnoreCaseOrderByLastNameAscFirstNameAsc', 'findTop50ByLastNameStartingWithOrFiscalCodeStartingWithOrderByLastNameAscFirstNameAsc'],
  caseDoc: ['/** Patients whose surname or fiscal code starts with `query`, in any case ("rossi" finds "Rossi"). */', '/** Patients whose surname or fiscal code starts with `query`. */'],
  caseTest: lastTest(PATIENT_TEST, 'theSearchIgnoresCase'),
  // CUP_VAX-511: the age went up on 1 January: a teenager was refused HPV a few months before the limit
  years: ['return Period.between(birthDate, on).getYears();', 'return on.getYear() - birthDate.getYear();'],
  yearsDoc: ['/** Whole years from the birth date to `on`: the age goes up on the birthday, not on 1 January. */', '/** Whole years from the birth date to `on`. */'],
  yearsTest: testBetween(AGES_TEST, 'theAgeGoesUpOnTheBirthday', 'datesAreWrittenTheItalianWay'),
};

const openCardTest = [cut(SEARCH_SPEC, "\n\ntest('pazienti: the name opens the vaccination card'", '\n});\n') + '\n});', ''];

export const STEPS = [
  {
    who: 'bojan', date: '2026-07-06T09:30:00+02:00',
    message: 'CUP_VAX-501: MediVax skeleton: Spring Boot backend, Angular frontend, Playwright tests',
    files: {
      '.gitignore': T, 'README.md': T,
      'backend/pom.xml': T, [`${BE}/MediVaxApplication.java`]: T, 'backend/src/main/resources/application.yml': T,
      [`${BE}/common/ApiError.java`]: T, [`${BE}/common/BadRequestException.java`]: T, [`${BE}/common/ConflictException.java`]: T,
      [`${BE}/common/NotFoundException.java`]: T, [`${BE}/common/GlobalExceptionHandler.java`]: T,
      'frontend/angular.json': T, 'frontend/package.json': T, 'frontend/proxy.conf.json': T, 'frontend/tsconfig.json': T, 'frontend/tsconfig.app.json': T,
      'frontend/src/index.html': T, 'frontend/src/main.ts': T, 'frontend/src/styles.scss': T,
      [`${FE}/app.component.ts`]: T, [`${FE}/app.config.ts`]: T, [`${FE}/core/http/api.ts`]: T, [`${FE}/core/http/api-errors.ts`]: T,
      [`${FE}/core/layout/header.component.ts`]: T,
      [ROUTES]: B(T, R_PAZ, R_CARD, R_VAX, R_DUE),
      [NAV]: B(T, L_PAZ, L_DUE, L_VAX),
      'e2e/package.json': T, 'e2e/playwright.config.ts': T, 'e2e/support/evidence.ts': T,
    },
  },
  {
    who: 'irene', date: '2026-07-13T10:15:00+02:00',
    message: 'CUP_VAX-502: Patient registry: search by surname or fiscal code',
    files: {
      [`${BE}/patient/Patient.java`]: T, [`${BE}/patient/PatientController.java`]: T, [`${MIG}/V1__patients.sql`]: T,
      [REPO]: B(T, BUG.caseRepo),
      [PATIENTS]: B(T, BUG.caseRepo, BUG.caseDoc),
      [PATIENT_TEST]: B(T, BUG.caseTest),
    },
  },
  {
    who: 'tommaso', date: '2026-07-20T14:40:00+02:00',
    message: 'CUP_VAX-503: Pazienti: search and patient list',
    files: {
      [`${FE}/shared/models/vax.models.ts`]: T, [`${FE}/shared/utils/dates.ts`]: T, [`${FE}/shared/utils/labels.ts`]: T,
      [`${FE}/features/patients/patient-api.service.ts`]: T, [`${FE}/features/patients/patient-search.component.ts`]: T,
      [ROUTES]: B(T, R_CARD, R_VAX, R_DUE),
      [NAV]: B(T, L_DUE, L_VAX),
      'e2e/README.md': T, 'e2e/support/mock-api.ts': T, 'e2e/support/api-data.json': T, 'e2e/support/vax.ts': T,
      [SEARCH_SPEC]: B(T, openCardTest),
    },
  },
  {
    who: 'irene', date: '2026-07-27T11:05:00+02:00',
    message: 'CUP_VAX-504: Vaccine catalog and lots',
    files: {
      [`${BE}/vaccine/Vaccine.java`]: T, [`${BE}/vaccine/VaccineRepository.java`]: T, [`${BE}/vaccine/VaccineController.java`]: T,
      [`${BE}/lot/Lot.java`]: T, [`${BE}/lot/LotRepository.java`]: T, [`${BE}/lot/LotController.java`]: T,
      [`${MIG}/V2__vaccines.sql`]: T, [`${MIG}/V3__lots.sql`]: T,
    },
  },
  {
    who: 'federica', date: '2026-08-03T09:45:00+02:00',
    message: 'CUP_VAX-505: Record a dose: lot, age and interval checks; the next dose due',
    files: {
      [AGES]: B(T, BUG.years, BUG.yearsDoc), [AGES_TEST]: B(T, BUG.yearsTest),
      [`${BE}/dose/Dose.java`]: T, [`${BE}/dose/DoseRepository.java`]: T, [`${BE}/dose/DoseRequest.java`]: T, [`${BE}/dose/DoseView.java`]: T,
      [`${BE}/dose/PatientCard.java`]: T, [`${BE}/dose/DoseService.java`]: T, [`${BE}/dose/DoseController.java`]: T,
      [`${BE}/schedule/Schedule.java`]: T, [`${MIG}/V4__doses.sql`]: T,
      [`${TEST}/dose/DoseServiceTest.java`]: T, [`${TEST}/schedule/ScheduleTest.java`]: T,
    },
  },
  {
    who: 'tommaso', date: '2026-08-10T15:20:00+02:00',
    message: 'CUP_VAX-506: Scheda paziente: doses given, next doses, record a dose',
    files: {
      [`${FE}/features/patients/patient-card.component.ts`]: T,
      [ROUTES]: B(T, R_VAX, R_DUE),
      [SEARCH_SPEC]: T, 'e2e/tests/card.smoke.spec.ts': T,
    },
  },
  {
    who: 'tommaso', date: '2026-08-24T10:10:00+02:00',
    message: 'CUP_VAX-507: Vaccini: the catalog page',
    files: {
      [`${FE}/features/vaccines/vaccines.component.ts`]: T,
      [ROUTES]: B(T, R_DUE), [NAV]: B(T, L_DUE),
      'e2e/tests/vaccines.smoke.spec.ts': T,
    },
  },
  {
    who: 'federica', date: '2026-09-07T09:30:00+02:00',
    message: 'CUP_VAX-508: Due doses of a period, for the weekly call list',
    files: { [`${BE}/schedule/DueService.java`]: T, [`${BE}/schedule/DueController.java`]: T },
  },
  {
    who: 'tommaso', date: '2026-09-14T14:00:00+02:00',
    message: 'CUP_VAX-509: Scadenze: the doses due in the week, Monday to Sunday',
    files: { [`${FE}/features/due/due.component.ts`]: T, [ROUTES]: T, [NAV]: T, 'e2e/tests/due.smoke.spec.ts': T },
  },
  {
    who: 'irene', date: '2026-10-05T11:40:00+02:00',
    message: 'CUP_VAX-510: the patient search ignores case ("rossi" finds "Rossi")',
    files: { [REPO]: T, [PATIENTS]: T, [PATIENT_TEST]: T },
  },
  {
    who: 'federica', date: '2026-10-19T16:25:00+02:00',
    message: 'CUP_VAX-511: the age goes up on the birthday, not on 1 January',
    files: { [AGES]: T, [AGES_TEST]: T },
  },
];
