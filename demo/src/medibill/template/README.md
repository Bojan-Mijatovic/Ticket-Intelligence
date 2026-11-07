# MediBill

Billing application of the MediSuite demo (the "ufficio ticket"): every day it imports the services to charge from **MediAgenda** (visits) and **MediLab** (reported tests), applies the patients' co-pay exemptions, and issues receipts with the co-pay ("ticket", at most 36,15 € a receipt).

| Part | What |
|---|---|
| Frontend | Angular 18 (standalone components, signals): `features/charges` (Addebiti: import and open charges), `features/receipts` (Ricevute), `features/exemptions` (Esenzioni), `features/tariffs` (Tariffario), `features/reports` (Report incassi) |
| Backend | Spring Boot 3, Java 21, port **8083**: `tariff`, `exemption`, `charge` (ChargeImportService), `receipt` (co-pay), `report`, `integration` (MediAgenda and MediLab clients), `common` |
| Database | H2 in memory + Flyway migrations V1–V5 in `backend/src/main/resources/db/migration` |
| Browser tests | Playwright with a mocked backend in `e2e/` (see `e2e/README.md`) |

## The suite

```
MediAgenda :8080 ──visits──▶ MediBill :8083 ◀──reported tests── MediLab :8081
```

| MediBill calls | For |
|---|---|
| MediAgenda `GET /api/bookings` | the visits of a day: one charge per booking, at the tariff of its provider (`tariffs.mediagenda_resource` = `resourceCode`) — `medisuite.mediagenda.url` |
| MediAgenda `GET /api/patients?q=` / `/{id}` | the patient of an exemption |
| MediLab `GET /api/orders?status=REFERTATA&from=&to=` | the tests reported on a day: one charge per test, by its `tariffCode` — `medisuite.medilab.url` |

## Co-pay

A charge is free when an exemption of the patient, valid on the **day of the service**, covers its tariff (total exemptions cover everything, disease exemptions only their tariff codes). The co-pay of a receipt is the rest, at most 36,15 €. An unpaid receipt can be cancelled (STORNATA): its charges are open again.

## Run

```
cd backend && mvn spring-boot:run          # http://localhost:8083 (MediAgenda :8080 and MediLab :8081 for the import)
cd frontend && npm install && npx ng serve --port 4203
```
