# Browser tests (Playwright)

Tests for the Angular frontend. The backend API is **mocked** (`support/mock-api.ts`, data from the Flyway seed in `support/api-data.json`), so only the Angular dev server is needed; Playwright starts it on port 4330. MediAgenda and MediLab are not needed either: what the import reads from them is in `api-data.json` (`bookings`, `labOrders`).

```
cd e2e
npm install
npx playwright install chromium
npx playwright test                         # all tests
npx playwright test tests/BIL-7.spec.ts     # one test
```

| Helper | Use |
|---|---|
| `mockApi(page)` | mocks every backend endpoint (tariffs, patients, charges and their import, receipts, exemptions, monthly report) with per-test data; returns a log of what the frontend sent: `imports`, `receiptRequests`, `receiptActions`, `exemptionWrites`, `reportRequests` |
| `importDay(page, 'yyyy-MM-dd')` | imports a day on the Addebiti page and waits for the summary |
| `patientCharges(page, fiscalCode)` | the open charges of a patient on the Addebiti page |
| `receiptRow(page, id)` | the row of a receipt on the Ricevute page |
| `pickPatient(page, query, name)` | picks a MediAgenda patient in Esenzioni |
| `evidence(page, name, data?)` | full-page screenshot (+ JSON) into `EVIDENCE_DIR` |

Seed data worth knowing: importing 2026-11-05 gives two visits of Fontana Chiara (45,00 €, co-pay 36,15 €) and one without tariff; 2026-11-03 gives the five tests of Marino Paolo (exemption 013: glucose and HbA1c free). Bianchi Laura's exemption E02 expired on 2026-06-30. `RC-2026-00041` is the receipt to pay.

Regression tests for tickets are named after the ticket: `tests/<KEY>.spec.ts`.
