# MediAgenda

Scheduling system for outpatient facilities: operators search a structure ("Struttura"), see its providers ("Risorse") and time slots ("fasce orarie"), manage bookings and patients. Fictional demo project.

```
frontend/                         Angular 18 (standalone components, signals)
  src/app/
    core/                         layout (header, sidenav), i18n labels, API base path
    shared/
      components/
        structure-autocomplete/   the "Struttura" field (autocomplete + badge)
        footer-actions/           PREFERENZE · PULISCI · RICERCA footer
      models/, services/          shared DTOs, structure search API
    features/
      agenda/                     search mask, store (state), API service, results (resources, time slots)
      booking/                    bookings list
      patients/                   patient search with paging
      reports/                    monthly bookings report
backend/                          Spring Boot 3, Java 21, H2 + Flyway
  src/main/java/com/mediagenda/
    structure/                    GET  /api/structures?q=          (autocomplete)
    resource/                     GET  /api/resources?structureIds= (providers / "erogatori")
    timeslot/                     POST /api/agenda/structure-timeslots  ("StructuretimeSlot" service)
    booking/                      GET  /api/bookings
    patient/                      GET  /api/patients?q=&page=&size=
    report/                       GET  /api/reports/monthly-bookings
    common/                       errors, paging
  src/main/resources/db/migration Flyway migrations V1..V4
```

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
```

## Demo structures

`SVIL_MS_VISITE` (Milano), `TEST_GEN_25` (Bergamo), `UP18491` (Lodi), `CA_PRESIDIO` (Casale).
