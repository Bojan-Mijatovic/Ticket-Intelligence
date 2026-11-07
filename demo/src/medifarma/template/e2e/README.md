# Browser tests (Playwright)

Tests for the Angular frontend. The backend API is **mocked** (`support/mock-api.ts`, data from the Flyway seed in `support/api-data.json`), so only the Angular dev server is needed; Playwright starts it on port 4320. MediAgenda and MediLab are not needed either: the patient search is mocked, and the kidney function of each patient (what the backend computes from the MediLab creatinine) is in `api-data.json` under `kidney`.

```
cd e2e
npm install
npx playwright install chromium
npx playwright test                         # all tests
npx playwright test tests/FAR-7.spec.ts     # one test
```

| Helper | Use |
|---|---|
| `mockApi(page, { slowDispense? })` | mocks every backend endpoint (patients, drugs, stock, safety check, prescriptions, dispensing) with per-test data; returns a log of what the frontend sent: `prescriptionListRequests`, `safetyChecks`, `prescriptionWrites`, `dispenseRequests`, `cancellations`, `expiringRequests`. `slowDispense` (ms) delays the dispensing answer |
| `pickPatient(page, query, name)` | types in the patient field of Nuova prescrizione and picks a suggestion |
| `addDrug(page, query, name)` | adds a drug to the prescription being written |
| `itemRow(page, name)` | the row of a drug in the prescription being written |
| `evidence(page, name, data?)` | full-page screenshot (+ JSON) into `EVIDENCE_DIR` |

Seed data worth knowing: Marino Paolo (id 9) has eGFR 28 (creatinine 2,50 mg/dL), Rossi Mario (id 1) eGFR 94, the others no creatinine. `RX-2026-00031`, `RX-2026-00033` and `RX-2026-00036` are EMESSA; metformin lot `L-MF2601` has expired.

Regression tests for tickets are named after the ticket: `tests/<KEY>.spec.ts`.
