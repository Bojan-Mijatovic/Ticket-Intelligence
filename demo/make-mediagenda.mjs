#!/usr/bin/env node
// Builds demo/mediagenda: Angular 18 frontend + Spring Boot (Java 21) backend + H2/Flyway database, with a git
// history that matches the mock Jira tickets CUP_DEMO-2398 … CUP_DEMO-2629.
//
//   node demo/make-mediagenda.mjs [--svn] [--force] [--no-install] [--out <dir>]
//   --out builds into another folder (e.g. to check a new history before publishing it).
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
// B(source, [fixed, buggy], …): the file of `source` (T or H(dir)) with a bug put back: each `fixed` text is replaced by
// `buggy`. A feature commit gets the buggy version; a later commit of the bug ticket sets the file to T (the fix).
// This gives the history realistic bug-fix commits (for the hotspot map, FR-64) without keeping more file copies.
const B = (base, ...pairs) => ({ base, pairs });
const BUG = {
  // CUP_DEMO-2402: the Risorse table shows the code twice instead of the description
  descr: ['<td>{{ r.code }}</td><td>{{ r.description }}</td>', '<td>{{ r.code }}</td><td>{{ r.code }}</td>'],
  // CUP_DEMO-2419: Struttura search by name is case-sensitive
  structSearch: ['findTop10ByIdContainingIgnoreCaseOrNameContainingIgnoreCaseOrderByIdAsc', 'findTop10ByIdContainingIgnoreCaseOrNameContainingOrderByIdAsc'],
  // CUP_DEMO-2455: saving a patient without changing the fiscal code fails with 409 (the patient conflicts with itself)
  patientUpdate: ['                .filter(other -> !other.getId().equals(id))\n', ''],
  patientUpdateTest: [`
    @Test
    void updatesContactsAndKeepsTheId() {
        Patient p = service.create(request("NRIANB91H54F205U", "Neri"));
        Patient updated = service.update(p.getId(), new PatientRequest("NRIANB91H54F205U", "Anna", "Neri Bassi",
                LocalDate.of(1991, 6, 14), "F", "Lodi", "", "anna.neri@example.com"));
        assertThat(updated.getId()).isEqualTo(p.getId());
        assertThat(updated.getLastName()).isEqualTo("Neri Bassi");
        assertThat(updated.getCity()).isEqualTo("Lodi");
    }
`, ''],
  // CUP_DEMO-2580: a new search keeps the page of the previous one
  page: ['(ngSubmit)="search(0)"', '(ngSubmit)="search(result()?.page ?? 0)"'],
  // CUP_DEMO-2483: the time just booked is still offered as free
  bookedTime: ['          this.times.update((list) => list.filter((t) => t !== v.time));\n', ''],
  // CUP_DEMO-2489: changing the Struttura keeps the Erogatore of the previous one
  oldProvider: ["  onStructure(structure: Structure): void {\n    this.form.controls.resourceCode.setValue('');\n", '  onStructure(structure: Structure): void {\n'],
  // CUP_DEMO-2603: a time slot valid for a single day (start date = end date) cannot be saved
  singleDay: ["orderedRange('startDate', 'endDate', true)", "orderedRange('startDate', 'endDate')"],
  // CUP_DEMO-2541: a cancelled booking can be cancelled again (the reason is overwritten)
  cancelTwice: ['        if (!CONFIRMED.equals(status)) {\n            throw new ConflictException("status: only a " + CONFIRMED + " booking can be cancelled (" + id + " is " + status + ")");\n        }\n', ''],
  cancelTwiceTest: ['        assertThatThrownBy(() -> service.cancel(b.id(), new CancelRequest("again")))\n                .isInstanceOf(ConflictException.class);\n', ''],
  // CUP_DEMO-2549: "Altro" can be confirmed without a note
  altroNote: ["return !!reason && (reason !== 'Altro' || note.trim().length > 0);", 'return !!reason;'],
  // CUP_DEMO-2627: the monthly report counts cancelled bookings
  reportCancelled: ["                WHERE b.status <> 'ANNULLATA'\n", ''],
};
const BE = 'backend/src/main/java/com/mediagenda';
const FE = 'frontend/src/app';
const MIG = 'backend/src/main/resources/db/migration';
const TEST = 'backend/src/test/java/com/mediagenda';

const STEPS = [
  {
    who: 'davide', date: '2026-02-02T10:00:00+01:00',
    message: 'Backend skeleton: Spring Boot app, structures, resources, time slots (Flyway V1, V2)',
    files: {
      '.gitignore': T, 'README.md': H('01-backend'),
      'backend/pom.xml': T, 'backend/src/main/resources/application.yml': T,
      [`${BE}/MediAgendaApplication.java`]: T,
      [`${BE}/common/ApiError.java`]: T, [`${BE}/common/GlobalExceptionHandler.java`]: H('01-backend'), [`${BE}/common/NotFoundException.java`]: T,
      [`${BE}/structure/Structure.java`]: T, [`${BE}/structure/StructureRepository.java`]: B(T, BUG.structSearch), [`${BE}/structure/StructureController.java`]: B(T, BUG.structSearch),
      [`${BE}/resource/AgendaResource.java`]: T, [`${BE}/resource/AgendaResourceRepository.java`]: T,
      [`${BE}/resource/AgendaResourceService.java`]: H('01-backend'), [`${BE}/resource/AgendaResourceController.java`]: T,
      [`${BE}/timeslot/TimeSlot.java`]: H('01-backend'), [`${BE}/timeslot/TimeSlotController.java`]: T,
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
      'frontend/proxy.conf.json': T, 'frontend/src/index.html': T, 'frontend/src/main.ts': T, 'frontend/src/styles.scss': H('02-frontend'),
      [`${FE}/app.config.ts`]: T, [`${FE}/app.routes.ts`]: H('02-frontend'), [`${FE}/app.component.ts`]: T,
      [`${FE}/core/layout/header.component.ts`]: T, [`${FE}/core/layout/sidenav.component.ts`]: H('02-frontend'),
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
      [`${FE}/features/agenda/results/resources-list.component.ts`]: B(T, BUG.descr),
      [`${FE}/features/agenda/results/timeslot-table.component.ts`]: H('03-agenda'), [`${FE}/app.routes.ts`]: H('03-agenda'),
    },
  },
  {
    who: 'sara', date: '2026-03-02T10:05:00+01:00',
    message: 'CUP_DEMO-2402: Risorse list shows the provider description again\n\nThe second column repeated the code; the operators could not tell the providers apart.',
    files: { [`${FE}/features/agenda/results/resources-list.component.ts`]: T },
  },
  {
    who: 'luca', date: '2026-03-04T09:40:00+01:00',
    message: 'Booking module: bookings table (Flyway V3) and API',
    files: {
      [`${BE}/booking/Booking.java`]: H('04-booking'), [`${BE}/booking/BookingRepository.java`]: H('04-booking'), [`${BE}/booking/BookingController.java`]: H('04-booking'),
      [`${MIG}/V3__bookings.sql`]: T,
    },
  },
  {
    who: 'marta', date: '2026-03-11T14:00:00+01:00',
    message: 'Prenotazioni page: bookings list',
    files: { [`${FE}/features/booking/booking-api.service.ts`]: H('05-booking-fe'), [`${FE}/features/booking/booking-list.component.ts`]: H('05-booking-fe'), [`${FE}/app.routes.ts`]: H('05-booking-fe') },
  },
  {
    who: 'davide', date: '2026-03-16T11:20:00+01:00',
    message: 'CUP_DEMO-2419: Struttura search by name ignores upper and lower case\n\nThe name matched case-sensitively, so "sviluppo" did not find "SVILUPPO ..." (the code already ignored case).',
    files: { [`${BE}/structure/StructureRepository.java`]: T, [`${BE}/structure/StructureController.java`]: T },
  },
  {
    who: 'davide', date: '2026-03-25T10:30:00+01:00',
    message: 'Patient module: patient search API with paging (Flyway V4)',
    files: {
      [`${BE}/patient/Patient.java`]: H('06-patient'), [`${BE}/patient/PatientRepository.java`]: H('06-patient'), [`${BE}/patient/PatientController.java`]: H('06-patient'),
      [`${BE}/common/PageResponse.java`]: T, [`${MIG}/V4__patients.sql`]: T,
    },
  },
  {
    who: 'sara', date: '2026-04-02T16:20:00+02:00',
    message: 'Pazienti page: patient search with paging',
    files: { [`${FE}/features/patients/patient-api.service.ts`]: H('07-patient-fe'), [`${FE}/features/patients/patient-search.component.ts`]: H('07-patient-fe'), [`${FE}/app.routes.ts`]: H('07-patient-fe') },
  },
  {
    who: 'davide', date: '2026-04-20T10:15:00+02:00',
    message: "CUP_DEMO-2441: patient registry API (create, update, get) with validation (Flyway V5)\n\nPOST /api/patients and PUT /api/patients/{id} validate the fiscal code format, names, birth date (past), sex and contacts.\nA fiscal code that is already registered is rejected with 409 CONFLICT.",
    files: {
      [`${BE}/patient/Patient.java`]: T, [`${BE}/patient/PatientRequest.java`]: T, [`${BE}/patient/PatientRepository.java`]: T,
      [`${BE}/patient/PatientService.java`]: B(T, BUG.patientUpdate), [`${BE}/patient/PatientController.java`]: T,
      [`${BE}/common/ConflictException.java`]: T, [`${BE}/common/BadRequestException.java`]: T, [`${BE}/common/GlobalExceptionHandler.java`]: T,
      [`${MIG}/V5__patient_registry.sql`]: T, [`${TEST}/patient/PatientServiceTest.java`]: B(T, BUG.patientUpdateTest),
    },
  },
  {
    who: 'sara', date: '2026-04-28T15:40:00+02:00',
    message: "CUP_DEMO-2441: Anagrafica paziente form (new and edit) and shared form styles",
    files: {
      'frontend/src/styles.scss': T, [`${FE}/core/http/api-errors.ts`]: T, [`${FE}/shared/validators/form-validators.ts`]: T,
      [`${FE}/features/patients/patient-api.service.ts`]: T, [`${FE}/features/patients/patient-search.component.ts`]: B(T, BUG.page),
      [`${FE}/features/patients/patient-form.component.ts`]: H('10-patient-form'), [`${FE}/app.routes.ts`]: H('10-patient-form'),
    },
  },
  {
    who: 'davide', date: '2026-05-05T09:50:00+02:00',
    message: 'CUP_DEMO-2455: saving a patient without changing the fiscal code no longer fails with 409\n\nThe duplicate check found the patient being edited and reported a conflict with itself; it now ignores the same id.\nTest added for an update that keeps the fiscal code.',
    files: { [`${BE}/patient/PatientService.java`]: T, [`${TEST}/patient/PatientServiceTest.java`]: T },
  },
  {
    who: 'luca', date: '2026-05-14T12:10:00+02:00',
    message: 'CUP_DEMO-2398: time slot search accepts a list of structureIds\n\nPOST /api/agenda/structure-timeslots now takes { structureIds: [...] } and merges the slots of all structures.',
    files: {
      [`${BE}/timeslot/TimeSlotSearchRequest.java`]: T, [`${BE}/timeslot/TimeSlotService.java`]: T,
      [`${BE}/timeslot/TimeSlotRepository.java`]: H('08-sup2398-be'), 'backend/src/test/java/com/mediagenda/timeslot/TimeSlotServiceTest.java': T,
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
    who: 'sara', date: '2026-06-09T10:40:00+02:00',
    message: 'CUP_DEMO-2580: patient search always starts from the first page\n\nRICERCA reused the page of the previous search, so after moving to page 2 a new search showed\n"Pagina 2" of a result with one page.',
    files: { [`${FE}/features/patients/patient-search.component.ts`]: T },
  },
  {
    who: 'luca', date: '2026-06-10T09:30:00+02:00',
    message: "CUP_DEMO-2470: create bookings and free appointment times (Flyway V6)\n\nGET /api/agenda/availability splits the slots of a provider on a day into 20-minute appointments and leaves out booked times.\nPOST /api/bookings checks validity, weekday and hours of the slot, and rejects a time that is already booked (409).",
    files: {
      [`${BE}/booking/Booking.java`]: H('12-booking-form'), [`${BE}/booking/BookingRequest.java`]: T, [`${BE}/booking/BookingView.java`]: H('12-booking-form'),
      [`${BE}/booking/BookingRepository.java`]: H('12-booking-form'), [`${BE}/booking/BookingService.java`]: H('12-booking-form'),
      [`${BE}/booking/BookingController.java`]: H('12-booking-form'),
      [`${BE}/timeslot/Weekdays.java`]: T, [`${BE}/timeslot/AvailableTime.java`]: T, [`${BE}/timeslot/AvailabilityService.java`]: H('12-booking-form'),
      [`${BE}/timeslot/AvailabilityController.java`]: T, [`${BE}/timeslot/TimeSlotRepository.java`]: T,
      [`${MIG}/V6__booking_details.sql`]: T,
      [`${TEST}/booking/BookingServiceTest.java`]: H('12-booking-form'), [`${TEST}/timeslot/AvailabilityServiceTest.java`]: T,
    },
  },
  {
    who: 'marta', date: '2026-06-18T14:20:00+02:00',
    message: "CUP_DEMO-2470: Nuova prenotazione form; bookings list shows patient and agenda",
    files: {
      [`${FE}/features/booking/booking-api.service.ts`]: H('12-booking-form'), [`${FE}/features/booking/booking-list.component.ts`]: H('12-booking-form'),
      [`${FE}/features/booking/booking-form.component.ts`]: B(T, BUG.bookedTime, BUG.oldProvider), [`${FE}/app.routes.ts`]: H('12-booking-form'),
    },
  },
  {
    who: 'marta', date: '2026-06-24T11:15:00+02:00',
    message: 'CUP_DEMO-2483: Nuova prenotazione: the time just booked disappears from the free times\n\nAfter CONFERMA the booked time stayed in the list; choosing it again ended in "already booked" (409).',
    files: { [`${FE}/features/booking/booking-form.component.ts`]: B(T, BUG.oldProvider) },
  },
  {
    who: 'marta', date: '2026-07-01T15:30:00+02:00',
    message: 'CUP_DEMO-2489: changing the Struttura clears the chosen Erogatore\n\nThe provider of the previous structure stayed selected (hidden in the list), so the free times and the\nbooking were for the wrong provider.',
    files: { [`${FE}/features/booking/booking-form.component.ts`]: T },
  },
  {
    who: 'davide', date: '2026-07-08T11:00:00+02:00',
    message: 'CUP_DEMO-2602: resources endpoint returns only active erogatori',
    files: { [`${BE}/resource/AgendaResourceService.java`]: T },
  },
  {
    who: 'davide', date: '2026-07-20T10:00:00+02:00',
    message: "CUP_DEMO-2590: POST /api/timeslots creates recurring time slots (Flyway V7)\n\nOne slot per selected weekday; the resource must be active, the end time after the start time, the end date not before the start date.",
    files: {
      [`${BE}/timeslot/TimeSlot.java`]: T, [`${BE}/timeslot/TimeSlotCreateRequest.java`]: T,
      [`${BE}/timeslot/TimeSlotAdminService.java`]: T, [`${BE}/timeslot/TimeSlotAdminController.java`]: T,
      [`${MIG}/V7__time_slot_sequence.sql`]: T, [`${TEST}/timeslot/TimeSlotAdminServiceTest.java`]: T,
    },
  },
  {
    who: 'sara', date: '2026-07-28T16:10:00+02:00',
    message: "CUP_DEMO-2590: Fasce orarie page: Nuova fascia oraria form",
    files: {
      [`${FE}/features/timeslots/timeslot-api.service.ts`]: T, [`${FE}/features/timeslots/timeslot-form.component.ts`]: B(T, BUG.singleDay),
      [`${FE}/app.routes.ts`]: H('13-timeslot-fe'), [`${FE}/core/layout/sidenav.component.ts`]: T,
    },
  },
  {
    who: 'sara', date: '2026-08-06T09:35:00+02:00',
    message: 'CUP_DEMO-2603: a time slot valid for a single day can be saved\n\n"Valida dal" equal to "Valida al" was rejected as an invalid range; a one-day slot (e.g. an extra Saturday) is allowed.',
    files: { [`${FE}/features/timeslots/timeslot-form.component.ts`]: T },
  },
  {
    who: 'luca', date: '2026-09-08T11:30:00+02:00',
    message: "CUP_DEMO-2533: cancel a booking with a reason (Flyway V8)\n\nPOST /api/bookings/{id}/cancel: CONFERMATA → ANNULLATA. A cancelled time is free again: availability and the\ndouble-booking check ignore ANNULLATA bookings. GET /api/bookings takes an optional status filter.",
    files: {
      [`${BE}/booking/Booking.java`]: B(T, BUG.cancelTwice), [`${BE}/booking/CancelRequest.java`]: T, [`${BE}/booking/BookingView.java`]: T,
      [`${BE}/booking/BookingRepository.java`]: H('15-booking-cancel'), [`${BE}/booking/BookingService.java`]: T,
      [`${BE}/booking/BookingController.java`]: T, [`${BE}/timeslot/AvailabilityService.java`]: H('15-booking-cancel'),
      [`${MIG}/V8__booking_cancellation.sql`]: T, [`${TEST}/booking/BookingServiceTest.java`]: B(T, BUG.cancelTwiceTest), 'README.md': T,
    },
  },
  {
    who: 'marta', date: '2026-09-10T15:00:00+02:00',
    message: "CUP_DEMO-2533: Prenotazioni: status filter and Annulla prenotazione dialog",
    files: {
      [`${FE}/features/booking/booking-api.service.ts`]: T, [`${FE}/features/booking/booking-list.component.ts`]: T,
      [`${FE}/features/booking/booking-cancel-dialog.component.ts`]: B(T, BUG.altroNote),
    },
  },
  {
    who: 'luca', date: '2026-09-16T14:45:00+02:00',
    message: 'CUP_DEMO-2541: a booking that is already cancelled cannot be cancelled again\n\nA second cancel overwrote the reason and the time of the first one. Only a CONFERMATA booking can be cancelled\nnow (409 otherwise); test extended.',
    files: { [`${BE}/booking/Booking.java`]: T, [`${TEST}/booking/BookingServiceTest.java`]: T },
  },
  {
    who: 'marta', date: '2026-09-18T10:10:00+02:00',
    message: 'CUP_DEMO-2549: Annulla prenotazione: "Altro" needs a note\n\nThe dialog could be confirmed with "Altro" and an empty "Specificare"; the reason was saved as "Altro: ".',
    files: { [`${FE}/features/booking/booking-cancel-dialog.component.ts`]: T },
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
    who: 'sara', date: '2026-10-20T11:25:00+02:00',
    message: "CUP_DEMO-2612: patient form: birth date typed as dd/MM/yyyy\n\nThe operators type dates as on the documents; the browser date picker showed mm/dd/yyyy on some PCs.\nNew shared/utils/dates.ts converts between dd/MM/yyyy and the ISO format of the API.",
    files: {
      [`${FE}/shared/utils/dates.ts`]: T, [`${FE}/features/patients/patient-form.component.ts`]: T,
    },
  },
  {
    who: 'luca', date: '2026-10-22T17:05:00+02:00',
    message: "CUP_DEMO-2620: availability loads the booked times of the day with one query\n\nThe Nuova prenotazione form waited up to 2 s per provider: one exists-query per candidate time.\nNow one query returns all booked times of the day for the provider's slots.",
    files: {
      [`${BE}/booking/BookingRepository.java`]: T, [`${BE}/timeslot/AvailabilityService.java`]: T,
    },
  },
  {
    who: 'luca', date: '2026-10-27T09:10:00+01:00',
    message: 'Reports: monthly bookings per structure API',
    files: { [`${BE}/report/ReportController.java`]: B(T, BUG.reportCancelled) },
  },
  {
    who: 'marta', date: '2026-10-29T16:40:00+01:00',
    message: 'Report page: monthly bookings table',
    files: { [`${FE}/features/reports/reports.component.ts`]: T, [`${FE}/app.routes.ts`]: T },
  },
  {
    who: 'luca', date: '2026-11-02T12:00:00+01:00',
    message: 'CUP_DEMO-2627: monthly report no longer counts cancelled bookings\n\nThe report counted ANNULLATA bookings as well, like availability did before CUP_DEMO-2533.',
    files: { [`${BE}/report/ReportController.java`]: T },
  },
  {
    who: 'bojan', date: '2026-11-04T19:00:00+01:00',
    message: 'Browser tests: Playwright with a mocked backend API (agenda, patients, bookings, time slots)',
    files: {
      'e2e/package.json': T, 'e2e/playwright.config.ts': T, 'e2e/README.md': T,
      'e2e/support/agenda.ts': T, 'e2e/support/api-data.json': T, 'e2e/support/evidence.ts': T, 'e2e/support/mock-api.ts': T,
      'e2e/support/forms.ts': T, 'e2e/tests/agenda.smoke.spec.ts': T,
      'e2e/tests/patients.smoke.spec.ts': T, 'e2e/tests/bookings.smoke.spec.ts': T, 'e2e/tests/timeslots.smoke.spec.ts': T,
    },
  },
];

// ---------------------------------------------------------------- build

const args = process.argv.slice(2);
const SVN_MODE = args.includes('--svn');
const outArg = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
const OUT = outArg ? join(process.cwd(), outArg) : SVN_MODE ? join(HERE, 'mediagenda-svn') : REPO;
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
const sourceFile = (path, source) => (source === T ? join(TEMPLATE, path) : join(HISTORY, source.history, path));
/** The content of `path` for a step: a template or history file, or (B) one with bugs put back. */
function sourceText(path, source) {
  const base = source.pairs ? source.base : source;
  const from = sourceFile(path, base);
  if (!existsSync(from)) throw new Error(`Missing source for ${path}: ${from}`);
  let text = readFileSync(from, 'utf8');
  for (const [fixed, buggy] of source.pairs ?? []) {
    const eol = text.includes('\r\n') ? (s) => s.replace(/\r?\n/g, '\r\n') : (s) => s;
    const [f, b] = [eol(fixed), eol(buggy)];
    const count = text.split(f).length - 1;
    if (count !== 1) throw new Error(`${path}: the fixed text of a bug must occur exactly once (found ${count}): ${fixed.slice(0, 60)}`);
    text = text.replace(f, () => b);
  }
  return text;
}
function applyStep(step, dir) {
  for (const [path, source] of Object.entries(step.files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), mapKeys(sourceText(path, source)));
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
// The last commit must be the template: a B() version committed after the file's T commit would leave a bug in.
const differs = listFiles(TEMPLATE).filter((f) => committed.has(f) && readFileSync(join(OUT, f), 'utf8') !== mapKeys(readFileSync(join(TEMPLATE, f), 'utf8')));
if (differs.length) {
  console.error(`ERROR: the final history differs from the template in: ${differs.join(', ')}`);
  process.exit(1);
}

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
