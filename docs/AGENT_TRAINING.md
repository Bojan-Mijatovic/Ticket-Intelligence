# Training the agent

Status: **In use** · Date: 2026-11-05 · Owner: Bojan Mijatović

## What "training" means here

We do not train or fine-tune a model. The model is the same for everyone. What we control is **what the agent knows and how it is checked** when it works on a ticket. The agent gets better when:

1. its **instructions** are precise (the skills);
2. the **project explains itself**: conventions, history, past problems;
3. it has **tools to prove** what it claims (tests, a mocked backend, evidence);
4. we **measure** it on tickets with a known answer and fix what it gets wrong.

Training is therefore a loop: run the agent on known tickets → score → improve one of the levers below → run again.

## The levers

| Lever | Where | What to improve | Effect |
|---|---|---|---|
| Skill instructions | `.claude/skills/analyze-ticket/SKILL.md`, `document-ticket/SKILL.md`, the prompts in `agent/lib/*.mjs` | steps, what counts as evidence, output contract | how the agent searches and reasons |
| Project conventions | `CLAUDE.md` (Claude Code) / `.github/copilot-instructions.md` (Copilot) in the application repository | architecture, where things live, naming, how to run and test, known pitfalls (e.g. "dates: never `toISOString()` for a calendar date") | fewer wrong guesses, smaller and safer fixes |
| History quality | commit messages with ticket keys, Jira comments that explain decisions | write "why", not only "what"; link related tickets | the agent finds the change that introduced a bug and the right owner |
| Knowledge base | `docs/knowledge/` (written automatically on Done, FR-40) | review and merge the documentation PRs | recurring problems are recognized at once |
| Test harness | `e2e/support/` (mock API, page helpers), backend tests | helpers for every page, realistic mock data | the agent can reproduce a bug and prove a fix |
| Policy | `agent/policy.json` | what the agent may do alone (`auto` / `draft` / `off`) | trust grows step by step |

## Scenarios with a known answer

`demo/scenarios.json` contains tickets whose root cause is known. The answer key stays outside the MediAgenda repository, so the agent never sees it.

| Scenario | Ticket | Root cause (answer key) | Introduced by | Owner | Agent fixes? |
|---|---|---|---|---|---|
| `struttura` | [FE] Struttura field cleared by hand keeps the old structure | store keeps the structureId (`agenda-search.store.ts`) | CUP_DEMO-2398 / 2511 | Sara Colombo | yes |
| `birth-date` | [FE] birth date saved one day earlier | `toIsoDate()` uses UTC (`shared/utils/dates.ts`) | CUP_DEMO-2612 | Sara Colombo | yes |
| `annullate-filter` | [FE] Annullate filter shows nothing | option value `ANNULLATE` ≠ status `ANNULLATA` (`booking-list.component.ts`) | CUP_DEMO-2533 | Marta Ricci | yes |
| `cancelled-slot` | [BE] cancelled appointment never offered again | `findBookedTimes` ignores the status (`BookingRepository`, `AvailabilityService`) | CUP_DEMO-2620 (regression of 2533) | Luca Bianchi | yes: reproduced with a JUnit test against H2 |

The bugs are realistic on purpose: each was introduced by a later change and has a trace in Jira. In CUP_DEMO-2620, for example, the reviewer asks whether cancelled bookings are still ignored.

The other apps of the suite ([SUITE.md](SUITE.md)) add scenarios in their own projects; `new-ticket.mjs` creates them there. Two of them have their cause in a linked app, and `score-run.mjs` also checks that the agent names that app (`otherProjects`) and puts the fix in the right project (`fixInProject`):

| Scenario | Ticket | Root cause (answer key) | Introduced by | Owner | Agent fixes? |
|---|---|---|---|---|---|
| `lab-decimal` | [FE] MediLab: "1,35" is saved as 1 | `parseFloat()` stops at the comma (`result-entry.component.ts`) | CUP_LAB-120 | Francesca Lombardi | yes: browser test |
| `far-renal` | [BE] MediFarma: no renal warning for metformin (eGFR 269 instead of 28) | `RenalCheckService` divides by 88.4 and ignores the unit | **MediLab** CUP_LAB-118 (creatinine in mg/dL) | Valentina Rinaldi | yes: JUnit test with the MediLab fake sending mg/dL |
| `bil-cancelled` | [BE] MediBill: a cancelled visit is charged | `ChargeImportService` ignores the booking status | **MediAgenda** CUP_DEMO-2533 (cancellation) | Davide Greco | yes: JUnit test with a cancelled booking |

First runs (2026-11-07):

| Ticket | Scenario | Score | Time · cost | Note |
|---|---|---|---|---|
| FAR-19 | far-renal | 8/8 | 288 s · $0.16 | found LAB-18 in MediLab; fix converts by the reported unit; AI review: low risk |
| LAB-21 | lab-decimal | 7/7 | 719 s · $0.16 | `parseDecimal` next to `formatDecimal`; 11 browser tests pass |
| BIL-19 | bil-cancelled | 6/8 | 263 s · $0.21 | right cause, project and owner, but not DEM-17: it read MediAgenda's code, not its history |
| BIL-20 | bil-cancelled | 6/8 | 102 s · $0.15 | after the lever below: DEM-17 found (commits of 2026-09-08/10). Duplicate of BIL-19, so no fix (correct); owner Matteo Vitale (last author of the file), Davide Greco as the alternative |

Lever changed between BIL-19 and BIL-20: the analysis prompt for linked projects (`agent/lib/analyze.mjs`, `peersSection`) asks to search the linked app's history for the value involved (`git log -S`) and cite the ticket and commit that introduced it.

## The loop

```
node demo/new-ticket.mjs --scenario birth-date     # 1. create the ticket (the watcher picks it up)
node demo/score-run.mjs --all                      # 2. after "done": score every scenario ticket
#   3. for each ✗: find why in agent/state/work/<KEY>/transcript*.jsonl and improve one lever
node demo/reset-demo.mjs --yes                     # 4. clean up, then run the same scenario again
```

`score-run.mjs` checks six things per ticket: the right file, the change that introduced the bug, related tickets, owner, confidence, and the fix outcome (a verified draft PR when expected; backend tickets are reproduced with a JUnit test, frontend tickets with a browser test). It also prints time and cost.

Rules:

- **Change one lever at a time** and run the same scenarios again. Otherwise you cannot tell what helped.
- **Keep the scores** (a table in this document or in the team's wiki): date, change, score per scenario. Then the progress is visible.
- **Add a scenario for every real miss.** When the agent gets a real ticket wrong, turn it into a scenario (anonymized, with no patient data), so the same mistake is caught next time.

## Knowledge and prior art

The analysis scenarios above check one ticket at a time. Two more evals check what the agent knows across tickets ([KNOWLEDGE_PLAN.md](KNOWLEDGE_PLAN.md), K1 and K21). Their answer keys also stay outside the app repositories.

| Eval | Answer key | Command | Cost |
|---|---|---|---|
| Ask: questions with a known answer (history, why, where, who, latest, a question in Serbian, a page URL, a cause in another app, and topics that do not exist) | `demo/ask-scenarios.json` | `node demo/score-ask.mjs --project DEM` or `--all` (`--list` shows the questions; `--rescore <file>` scores saved answers again) | ~$0.1–0.4 per question |
| Prior art of suggested tickets: is a suggestion already a ticket, fixed, or new? | `demo/prior-art-cases.json` | `node demo/score-prior-art.mjs` | none (no AI) |
| Prior art of reported tickets: duplicate, fixed on main, genuinely new | `expected.priorArt` in `demo/scenarios.json` (`struttura-again`, `lab-decimal-again`, `annullate-filter`) | `new-ticket.mjs --scenario …`, then `score-run.mjs` | a normal run |
| Recurrence: the analysis cites the knowledge entry of the earlier bug | `expected.knowledgeEntry` (`struttura` → DEM-5) | `score-run.mjs`; shown as n/a until the entry is on main | a normal run |

The Ask eval writes its runs to `<project state>/ask-eval/`, so they are not taken for real questions, and saves the scored answers in `agent/state/ask-eval/<time>.json`.

Results:

| Date | Eval | Result | Note |
|---|---|---|---|
| 2026-11-12 | prior art, suggestions | 3/4 | baseline. The decimal-comma suggestion shows "created LAB-23" but not that LAB-23 fixed it (a427822); the two genuinely new suggestions stay new (no false duplicate) |
| 2026-11-12 | Ask, DEM | 10/10 | baseline; 0 invented sources; avg 15 s, $0.21 |
| 2026-11-12 | Ask, LAB | 8/8 | baseline; 0 invented; avg 16 s, $0.16 |
| 2026-11-12 | Ask, FAR | 3/3 | baseline; avg 16 s, $0.13 |
| 2026-11-12 | Ask, BIL | 2/3 | baseline. Missed: the cross-app question (the cause, DEM-17, is in MediAgenda, which Ask does not read: K11). One invented source was dropped by the source check |

**Limit of the Ask eval on the demo data.** The demo projects have 18–26 tickets, and Ask collects 15–23 of them for every question (the 15 latest plus the keyword hits). So the questions in Serbian, with a page URL or about "the latest" pass whatever the keyword search does: this eval cannot show a retrieval miss. It measures answering, source checking and "not found". A retrieval test needs a project with hundreds of tickets (a real one, or a larger seeded history).

## Typical findings and the lever that fixes them

| Symptom in the score | Usual cause | Lever |
|---|---|---|
| wrong file, right area | conventions unknown (e.g. where dates are converted) | project `CLAUDE.md` |
| right file, introducing change not found | commit messages without ticket keys, or no "why" | history quality |
| wrong owner | owner taken from the last committer, not from the area's history | skill instructions (FR-05 weights) |
| bug not reproduced | no page helper or mock endpoint for that page | test harness |
| fix touches too much | no rule about scope | skill instructions + `CLAUDE.md` ("smallest change, no refactoring") |
| low confidence on a clear ticket | description too vague, or evidence not found | ticket template for reporters |

## At work (GitHub Copilot)

The same loop applies. Copilot reads the same `SKILL.md`, and `.github/copilot-instructions.md` plays the role of `CLAUDE.md`. Score Copilot on the same scenarios (see [COPILOT_TEST.md](COPILOT_TEST.md)). Use only tickets without patient data (R-02).
