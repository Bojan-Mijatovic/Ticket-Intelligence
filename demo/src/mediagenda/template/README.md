# MediAgenda

Scheduling system for outpatient facilities: operators search a structure ("Struttura"), see its providers ("Risorse") and time slots ("fasce orarie"), book appointments, manage the patient registry and create new time slots. Fictional demo project.

```
frontend/                         Angular 18 (standalone components, signals, reactive forms)
  src/app/
    core/                         layout (header, sidenav), i18n labels, API base path and error messages
    shared/
      components/
        structure-autocomplete/   the "Struttura" field (autocomplete + badge)
        footer-actions/           PREFERENZE · PULISCI · RICERCA footer
      models/, services/          shared DTOs, structure search API
      validators/                 fiscal code, NRE, date and range validators
      utils/                      dates in the operators' format (dd/MM/yyyy)
    features/
      agenda/                     search mask, store (state), API service, results (resources, time slots)
      booking/                    bookings list (status filter, cancel dialog), "Nuova prenotazione" form
      patients/                   patient search with paging, "Anagrafica paziente" form (new / edit)
      timeslots/                  "Nuova fascia oraria" form
      reports/                    monthly bookings report
backend/                          Spring Boot 3, Java 21, H2 + Flyway
  src/main/java/com/mediagenda/
    structure/                    GET  /api/structures?q=          (autocomplete)
    resource/                     GET  /api/resources?structureIds= (providers / "erogatori")
    timeslot/                     POST /api/agenda/structure-timeslots  ("StructuretimeSlot" service)
                                  GET  /api/agenda/availability?resourceCode=&date=  (free 20-minute appointments)
                                  POST /api/timeslots              (new recurring slots, one per weekday)
    booking/                      GET  /api/bookings?status=  ·  POST /api/bookings  ·  POST /api/bookings/{id}/cancel
    patient/                      GET  /api/patients?q=&page=&size=  ·  GET/PUT /api/patients/{id}  ·  POST /api/patients
    report/                       GET  /api/reports/monthly-bookings
    common/                       errors (400 / 404 / 409 as ApiError), paging
  src/main/resources/db/migration Flyway migrations V1..V8
e2e/                              Playwright browser tests with a mocked backend (see e2e/README.md)
```

## Pages

| Page | Route | What it does |
|---|---|---|
| Agenda | `/agenda` | search mask: structure → providers and time slots |
| Prenotazioni | `/prenotazioni` | bookings with patient and agenda; filter by status; cancel with a reason |
| Nuova prenotazione | `/prenotazioni/nuova` | patient → structure → provider → day → free time → priority class and NRE |
| Pazienti | `/pazienti` | patient search with paging; new patient; edit |
| Anagrafica paziente | `/pazienti/nuovo`, `/pazienti/:id` | fiscal code, names, sex, birth date (dd/MM/yyyy), contacts |
| Fasce orarie | `/fasce-orarie` | new recurring time slot for a provider on one or more weekdays |
| Report | `/report` | bookings per month and structure |

## Run

Backend (port 8080):

```
cd backend
mvn spring-boot:run
```

Frontend (port 4200, proxies `/api` to 8080):

```
cd frontend
npm install
npm start
```

Open http://localhost:4200.

## Test

```
cd backend && mvn test
cd e2e && npx playwright test
```

## Demo data

Structures `SVIL_MS_VISITE` (Milano), `TEST_GEN_25` (Bergamo), `UP18491` (Lodi), `CA_PRESIDIO` (Casale); 12 fictional patients; bookings in September–November 2026 (one cancelled). The database is in memory: every backend restart starts from the seed.
