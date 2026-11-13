# MediSuite: four linked demo applications

To see how the agent moves from one project to another, the demo has four applications of one fictional hospital suite. They use the same stack (Angular 18, Spring Boot 3 / Java 21, H2 + Flyway, Playwright tests with a mocked API), each has its own Jira project, git history, team and bugs, and they call each other's REST APIs. One watcher and one dashboard (http://localhost:7070) work on all of them; the dashboard has a project selector, and Insights and Ask work per project.

| App | Jira | What | Backend | Frontend | Calls |
|---|---|---|---|---|---|
| **MediAgenda** | DEM | CUP booking: agendas, time slots, bookings, patient registry | :8080 | :4200 | (none) |
| **MediLab** | LAB | laboratory: test requests, tubes, results with ranges by sex, reports | :8081 | :4201 | MediAgenda patients |
| **MediFarma** | FAR | hospital pharmacy: prescriptions, renal and interaction checks, dispensing by lot | :8082 | :4202 | MediAgenda patients, MediLab creatinine |
| **MediBill** | BIL | co-pay billing: daily import of visits and tests, exemptions, receipts | :8083 | :4203 | MediAgenda bookings and patients, MediLab reported requests |
| **MediVax** (pilot) | VAX | vaccination centre: patients, vaccine catalog and lots, doses, next doses due | :8084 | :4204 | (none: standalone) |

MediVax is the **pilot** ([PILOT.md](PILOT.md)). It is not linked to the others. Its patients are synthetic, and every working day `demo/pilot.mjs` pushes changes with a hidden bug and reports the bug in Jira, so the agent's accuracy is measured on cases with a known answer.

```
                 patients                      creatinine (validated, with unit)
MediAgenda :8080 ─────────▶ MediLab :8081 ─────────────────────────────▶ MediFarma :8082
     │  │                        │                                            ▲
     │  └──────── patients ──────┼────────────────────────────────────────────┘
     │                           │ reported requests (tariff code per test)
     └── bookings (visits) ──▶ MediBill :8083 ◀┘
```

## How the agent uses the links

`agent/agent.config.json` lists the projects. A project's `linked` keys are the apps whose APIs it calls; `relations` says what for.

- **Analysis**: a ticket of a linked project gets a read-only checkout of each linked app's `main` (`agent/state/projects/<KEY>/peer-repo`) added to the run, and the linked Jira projects are searched for related tickets (`TICKET_INTEL_PROJECTS`, read by the skill's `config.mjs`). The result names the other projects involved (`otherProjects`, with evidence) and the project the fix belongs in (`fixInProject`). The dashboard shows both on the ticket card.
- **Fix**: the automatic reproduce-and-fix runs only in the ticket's own repository. When the analysis puts the fix in another project, no fix is made (`the fix belongs in project X`).
- **State**: each project has its own state folder (results, work, insights, Ask): MediAgenda `agent/state`, the others `agent/state/projects/<KEY>`. The event log is shared.

## People

Each app has its own team, and some people work on two apps. That is the test for "who knows this part of the code":

| Person | Apps | Knows |
|---|---|---|
| Luca Bianchi | MediAgenda, MediLab | bookings, cancellation (DEM-17); MediLab's MediAgenda client (LAB-2, LAB-13) |
| Davide Greco | MediAgenda, MediBill | patients and resources; the MediBill visit import (BIL-4, BIL-5) |
| Giorgio Esposito | MediLab, MediFarma | MediLab results and the API for the other apps (LAB-14, LAB-15); MediFarma's MediLab client (FAR-11, FAR-15) |
| Alessandro Moretti | MediLab | tubes; creatinine in mg/dL (LAB-18) |
| Valentina Rinaldi | MediFarma | dispensing and the renal check (FAR-11, FAR-13) |
| Matteo Vitale, Roberto Ferri, Chiara Marchetti | MediBill | receipts, exemptions, frontend |

## Demo tickets

Created live with `node demo/new-ticket.mjs --scenario <name>` (in the scenario's own project). The answer key is in `demo/scenarios.json`; `node demo/score-run.mjs <KEY>` scores the agent's run.

| Scenario | Project | Where the cause is | What the agent should find |
|---|---|---|---|
| `struttura`, `birth-date`, … | DEM | MediAgenda | (see docs/AGENT_TRAINING.md) |
| `lab-decimal` | LAB | MediLab frontend | since LAB-20 the result fields are text fields and `parseFloat("1,35")` is 1; Francesca Lombardi; automatic fix with a browser test |
| `far-renal` | FAR | **MediLab** (LAB-18, creatinine in mg/dL) | MediFarma's RenalCheckService still divides by 88.4 and ignores the unit: eGFR 269 instead of 28, no warning for metformin. Fix in MediFarma (read the unit); Valentina Rinaldi; backend test with FakeMediLabClient sending mg/dL |
| `bil-cancelled` | BIL | **MediAgenda** (DEM-17, cancelled bookings) | the visit import (BIL-4, June) charges every booking of the day; since September there are ANNULLATA bookings. Fix in MediBill (skip them); Davide Greco; backend test with a cancelled booking |

The test doubles are part of the story: MediFarma's `FakeMediLabClient` still returns 221 µmol/L, and MediBill's `FakeMediAgendaClient` has no cancelled booking, so both apps' tests pass while production is wrong.

Cross-project history the agent and Ask can use: FAR-14 was fixed in MediLab (LAB-15); BIL-17 is the same patient-picker bug as LAB-19 (the picker was copied before the fix); MediLab's LAB-8 and MediFarma's FAR-13 are both "the sex comes as F".

## Build and run

```
node demo/jira-project.mjs                     # Jira projects LAB, FAR, BIL (team-managed, like DEM), once
node demo/seed-jira.mjs --app medilab          # Jira history (also medifarma, medibill); writes demo/jira-keys.json
node demo/make-project.mjs medilab             # demo/medilab with its git history and npm install (also medifarma, medibill)
node demo/run-mediagenda.mjs --all             # the four apps (or --project LAB)
node agent/watcher.mjs --replace               # one watcher for every project with a clone
```

The sources are in `demo/src/<app>/`: `template/` (the code today), `history/` (older versions of some files), `history.mjs` (the commits: author, date, message, files; a bug is put back into the older commits with `B(T, [fixed, buggy])`) and `tickets.json` (the Jira history). `demo/lib/history.mjs` builds the repository and checks that its last commit equals the template.
