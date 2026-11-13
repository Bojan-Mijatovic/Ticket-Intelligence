# Browser tests (Playwright)

Tests for the Angular frontend. The backend API is **mocked** (`support/mock-api.ts`, data from the Flyway seed in `support/api-data.json`), so only the Angular dev server is needed; Playwright starts it on port 4340.

```
cd e2e
npm install
npx playwright install chromium
npx playwright test                         # all tests
npx playwright test tests/VAX-7.spec.ts     # one test
```

| Helper | Use |
|---|---|
| `mockApi(page)` | mocks every backend endpoint (patients and their card, vaccines, lots, doses, due doses) with per-test data; returns a log of what the frontend sent: `searches`, `doseRequests`, `dueRequests` |
| `searchPatient(page, query)` | types a search on Pazienti and waits for the list |
| `patientRow(page, id)` | the row of a patient in the search results |
| `openCard(page, id)` | opens a patient's vaccination card |
| `recordDose(page, vaccine, lot, 'yyyy-MM-dd')` | fills "Registra una dose" and presses REGISTRA |
| `dueWeekOf(page, 'yyyy-MM-dd')` | shows the Scadenze week of a day |
| `ageToday(birthDate)` | the age today, for checks that do not go stale |
| `evidence(page, name, data?)` | full-page screenshot (+ JSON) into `EVIDENCE_DIR` |

The patients are **synthetic** (`demo/lib/synthetic-patients.mjs`): no real person. Seed data worth knowing: De Luca Laura (id 8) had two doses of ESA, the third is due on 20/11/2026; Moretti Giorgio (id 14) had the first MPRV dose on 07/10/2026, the second is due on 04/11/2026; lot ESA-25A expires on 30/11/2026, ESA-24A is empty, HPV-24X expired on 30/09/2026.

Regression tests for tickets are named after the ticket: `tests/<KEY>.spec.ts`.
