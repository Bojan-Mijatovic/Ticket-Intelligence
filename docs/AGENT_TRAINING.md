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
