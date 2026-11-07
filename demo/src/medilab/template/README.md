# MediLab

Laboratory application of the MediSuite demo: test requests, tube acceptance, results with reference ranges, and reports. Patients come from **MediAgenda** (the CUP booking application); MediLab keeps no patient registry of its own.

| Part | What |
|---|---|
| Frontend | Angular 18 (standalone components, signals): `features/orders` (Richieste, Nuova richiesta), `features/samples` (Accettazione campioni), `features/results` (Inserimento risultati), `features/reports` (Referto), `features/catalog` (Catalogo esami); `shared/components/patient-picker` searches the MediAgenda registry |
| Backend | Spring Boot 3, Java 21, port **8081**: `catalog`, `order`, `sample`, `result`, `integration` (MediAgenda client), `common` |
| Database | H2 in memory + Flyway migrations V1–V6 in `backend/src/main/resources/db/migration` |
| Browser tests | Playwright with a mocked backend in `e2e/` (see `e2e/README.md`) |

## The suite

```
MediAgenda :8080 ──patients──▶ MediLab :8081 ──results (creatinine)──▶ MediFarma :8082
      │                            │
      └──visits──▶ MediBill :8083 ◀┘ reported requests
```

| MediLab calls | For |
|---|---|
| MediAgenda `GET /api/patients?q=` and `GET /api/patients/{id}` | the patient of a new request (`medisuite.mediagenda.url`) |

| Other apps call MediLab | For |
|---|---|
| MediFarma `GET /api/patients/{fiscalCode}/results?exam=CREA` | the latest validated creatinine, for its renal dose check. Values come **with their unit** |
| MediBill `GET /api/orders?status=REFERTATA&from=&to=` | the tests to charge, by tariff code (`exams[].tariffCode`) |

## Run

```
cd backend && mvn spring-boot:run          # http://localhost:8081 (MediAgenda on :8080 for the patient search)
cd frontend && npm install && npx ng serve --port 4201
```

## Main flows

1. **Nuova richiesta**: pick a MediAgenda patient, the prescriber, the tests (or a profile); one tube per sample type gets a barcode (`LB` + 8 digits).
2. **Accettazione campioni**: scan the tube; ACCETTA, or RIFIUTA with a reason (a new tube replaces it). When no tube is waiting, the request is IN_LAVORAZIONE.
3. **Inserimento risultati**: one value per test, flagged L / N / H with the range for the patient's sex; VALIDA E REFERTA signs the report.
4. **Referto**: printable report; values in the Italian format with the decimals of the test.
