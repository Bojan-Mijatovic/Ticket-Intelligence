# MediFarma

Hospital pharmacy application of the MediSuite demo: prescriptions with safety checks (renal dose rules, drug interactions), dispensing from stock by lot, and the stock itself. Patients come from **MediAgenda**; the creatinine for the renal check comes from **MediLab**.

| Part | What |
|---|---|
| Frontend | Angular 18 (standalone components, signals): `features/prescriptions` (Prescrizioni, Nuova prescrizione, `warnings/` panel), `features/dispensing` (Erogazione), `features/stock` (Magazzino), `features/drugs` (Farmaci) |
| Backend | Spring Boot 3, Java 21, port **8082**: `drug`, `stock`, `prescription`, `dispensing`, `safety` (RenalCheckService, RenalFunction, interactions), `integration` (MediAgenda and MediLab clients), `common` |
| Database | H2 in memory + Flyway migrations V1–V5 in `backend/src/main/resources/db/migration` |
| Browser tests | Playwright with a mocked backend in `e2e/` (see `e2e/README.md`) |

## The suite

```
MediAgenda :8080 ──patients──▶ MediFarma :8082 ◀──creatinine── MediLab :8081
```

| MediFarma calls | For |
|---|---|
| MediAgenda `GET /api/patients?q=` and `GET /api/patients/{id}` | the patient of a prescription: name, sex and birth date (age for the eGFR) — `medisuite.mediagenda.url` |
| MediLab `GET /api/patients/{fiscalCode}/results?exam=CREA` | the latest **validated** creatinine, with its `unit`, for the renal dose check — `medisuite.medilab.url` |

## Safety checks

- **Renal**: eGFR with CKD-EPI 2021 (`safety/RenalFunction`) from the MediLab creatinine, the patient's age and sex. A drug with `renalAvoidBelow` gives an ALTA warning below that eGFR, one with `renalReduceBelow` a MEDIA warning (reduce the dose). No creatinine in MediLab: an INFO warning, the check is skipped.
- **Interactions**: pairs of active ingredients (`interaction_rules`), in either order.
- ALTA warnings must be acknowledged by the prescriber (`acknowledgeWarnings`), otherwise the prescription is refused with 409.

## Dispensing

FEFO (first expired, first out) over the lots of each drug; expired lots are never used; all or nothing (too few packs → 409, no lot touched).

## Run

```
cd backend && mvn spring-boot:run          # http://localhost:8082 (MediAgenda :8080 and MediLab :8081 for patients and creatinine)
cd frontend && npm install && npx ng serve --port 4202
```
