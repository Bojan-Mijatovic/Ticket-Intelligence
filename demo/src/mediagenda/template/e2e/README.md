# Browser tests (Playwright)

Tests for the Angular frontend. The backend API is **mocked** (`support/mock-api.ts`, data from the Flyway seed), so only the Angular dev server is needed; Playwright starts it on port 4300.

```
cd e2e
npm install
npx playwright install chromium
npx playwright test                         # all tests
npx playwright test tests/DEM-7.spec.ts     # one test
```

| Helper | Use |
|---|---|
| `mockApi(page)` | mocks every backend endpoint (structures, resources, time slot search, availability, bookings, patients, new time slots) with per-test data; returns a log of what the frontend sent: `timeSlotRequests`, `resourceRequests`, `structureSearches`, `patientWrites`, `bookingListRequests`, `bookingWrites`, `cancellations`, `availabilityRequests`, `timeSlotWrites` |
| `nextWeekday(day)` | `yyyy-MM-dd` of the next weekday after today (0 = Sunday … 6 = Saturday), for date fields |
| `pickStructure(page, query, id)` | types in the Struttura field and picks a suggestion |
| `clearStructureWithKeyboard(page)` | select all + Backspace in the Struttura field |
| `resourceCodes(page)` | codes in the Risorse list |
| `evidence(page, name, data?)` | full-page screenshot (+ JSON) into `EVIDENCE_DIR` |

Regression tests for tickets are named after the ticket: `tests/<KEY>.spec.ts`.
