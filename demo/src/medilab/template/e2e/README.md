# Browser tests (Playwright)

Tests for the Angular frontend. The backend API is **mocked** (`support/mock-api.ts`, data from the Flyway seed in `support/api-data.json`), so only the Angular dev server is needed; Playwright starts it on port 4310. MediAgenda is not needed either: the patient search is mocked too.

```
cd e2e
npm install
npx playwright install chromium
npx playwright test                         # all tests
npx playwright test tests/LAB-7.spec.ts     # one test
```

| Helper | Use |
|---|---|
| `mockApi(page)` | mocks every backend endpoint (exams, MediAgenda patient search, requests, cancellation, tubes, results, validation, report) with per-test data; returns a log of what the frontend sent: `orderListRequests`, `orderWrites`, `cancellations`, `sampleLookups`, `sampleActions`, `resultWrites`, `validations`, `patientSearches` |
| `pickPatient(page, query, name)` | types in the patient field of Nuova richiesta and picks a suggestion |
| `scanBarcode(page, barcode)` | types a barcode at the acceptance desk and presses Enter |
| `typeResult(page, examCode, text)` | types a value in the result field of a test (Inserimento risultati) |
| `evidence(page, name, data?)` | full-page screenshot (+ JSON) into `EVIDENCE_DIR` |

Seed data worth knowing: `RL-2026-00058` (Ferrari Giulia, F) and `RL-2026-00060` (Romano Luca, M, urgent) are IN_LAVORAZIONE (results can be entered); `RL-2026-00061` and `RL-2026-00062` are waiting for their tubes (`LB00000850`, `LB00000855`, `LB00000856`); `RL-2026-00052` (Marino Paolo) is reported, with creatinine 2,50 mg/dL.

Regression tests for tickets are named after the ticket: `tests/<KEY>.spec.ts`.
