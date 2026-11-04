# Demo Scenario: "From ticket to tested fix, no human in the loop"

| | |
|---|---|
| **Status** | Defined and approved by Bojan Mijatović (2026-11-04); parts marked *(planned)* are built on POC days 3–4 |
| **Owner** | Bojan Mijatović |
| **Length** | 10 minutes (5 min live flow + 5 min questions) |
| **Audience** | team leads, developers, support, management |

## 1. The message

> A customer reports a bug. Within about a minute, without anyone starting anything, the right developer has a precise analysis in Jira and a message in Teams. Within a few more minutes the bug is reproduced, fixed on a branch and tested. People only approve.

## 2. The story

The demo project is **MediAgenda**, a fictional healthcare scheduling app (Angular 18, Spring Boot 3 / Java 21, H2 + Flyway). Its history contains the cause of the bug:

| Ticket | What happened |
|---|---|
| DEM-2 | the time slot search started to accept several structures; the frontend store began to *append* every selected structure |
| DEM-5 | the PULISCI button was fixed to clear the selection; the code review warned that clearing the field by hand was still not handled |
| **new ticket** | "Struttura field: clearing it by hand leaves the old structure; the time slot table mixes two structures" |

## 3. Setup

**The day before**
- [ ] `demo/mediagenda` is on `main`, up to date with GitHub, with no leftover agent branches or open pull requests; `node demo/run-mediagenda.mjs` works.
- [ ] Rehearsal tickets deleted, so the live ticket isn't flagged as a duplicate: `node demo/new-ticket.mjs --delete DEM-7`, the same for DEM-8 and any other rehearsal ticket.
- [ ] Full rehearsal done, and a **screen recording saved** as a fallback.
- [ ] Laptop: power plan "never sleep", notifications off, browser zoom 110 %.

**30 minutes before**
- [ ] `node demo/run-mediagenda.mjs` → http://localhost:4200/agenda loads.
- [ ] `node agent/watcher.mjs` → http://localhost:7070 shows *watching*.
- [ ] `node ~/.claude/skills/analyze-ticket/scripts/ticket.mjs check` → `ok: true`.
- [ ] `claude -p "say OK"` answers (CLI session is valid).
- [ ] Browser tabs, in order: (1) MediAgenda app, (2) Jira board DEM, (3) dashboard.

## 4. Script

| Time | Presenter does | Audience sees | Talking point |
|---|---|---|---|
| 0:00 | Shows MediAgenda: picks SVIL_MS_VISITE, clears the field with the keyboard, picks TEST_GEN_25 | Risorse shows providers of **both** structures | "This is the customer's bug. One structure in the field, two in the results." |
| 0:45 | In Jira, creates the ticket (or runs `node demo/new-ticket.mjs`) | a new Bug in DEM, To Do, label SVIL | "This is all the customer gives us. Nobody assigns it, nobody starts anything." |
| 1:00 | Switches to the dashboard | ticket appears as *queued*, then *analyzing*; each agent step streams in: reads the ticket, finds DEM-5 and DEM-2, opens the store, the autocomplete, the search mask | "It searches Jira and the code the way a senior colleague would." |
| ~2:00 | Waits | result: cause with file:line, high confidence, owner Sara Colombo with the reason, escalation decision | "Cause, evidence, owner and next steps in about a minute." |
| 2:15 | Opens the Jira ticket | the internal AI analysis comment, label `ai-analyzed` | "It's already in Jira, where the team works." |
| 2:30 | Back to the dashboard, Teams panel | the message to Sara, ready to act on | "The right person knows, with context, without a meeting." |
| 2:45 | Shows "Waiting for a human" | drafts: assign to Sara, reply to the reporter | "What the agent may do alone is a policy. Anything customer-facing waits for a person." |
| 3:00 | *(planned)* Dashboard: reproduction | generated browser test runs; screenshot + request with two structureIds attached to Jira | "It proved the bug in the real app." |
| 3:45 | *(planned)* Dashboard: fix | branch DEM-x, the diff, `ng build` ✓, `mvn test` ✓, reproduction test ✓, draft PR | "And proposed a tested fix. A developer reviews it, they don't start from zero." |
| 4:30 | *(planned)* Moves the ticket to Done | a docs PR with the known-issue entry for this component | "Next time this kind of bug comes, the answer is already in the repo." |
| 5:00 | Questions | | |

## 5. What makes it convincing

- It is a **real Jira** and a **real application**, not slides.
- Nothing is pre-computed: every step streams live, with timings.
- The analysis cites **evidence** (ticket keys, commit hashes, file:line), not just an opinion.
- The safety story is visible: policy chips, drafts waiting for approval, read-only agent.

## 6. If something goes wrong

| Problem | Fallback |
|---|---|
| Network / Jira unavailable | play the recording; the dashboard history still shows earlier runs |
| Agent slower than usual | keep talking over the streamed steps; typical run 55–90 s |
| Agent fails (`ai-failed`) | remove the label in Jira; it is retried at the next poll; meanwhile show DEM-7's earlier result |
| Ticket flagged as a duplicate | turn it into a talking point ("it also recognized the duplicate"), then continue |
| Claude CLI session expired | run `claude` once in a terminal before the demo; fallback to the recording |

## 7. Reset after the demo

The demo application lives in its own private repository, https://github.com/Bojan-Mijatovic/MediAgenda (local clone: `demo/mediagenda`). Its `main` is never rewritten; the agent only adds branches and pull requests.

```
node demo/new-ticket.mjs --delete DEM-<n>                 # the live ticket(s)
gh pr close <n> --repo Bojan-Mijatovic/MediAgenda --delete-branch   # each agent pull request + its branch
cd demo/mediagenda && git checkout main && git pull       # local clone back to main
```

`make-mediagenda.mjs --force` refuses to rebuild a repository that has a remote, because the new history would need a force push.

## 8. Expected questions

| Question | Short answer |
|---|---|
| What about patient data? | Must be redacted before analysis and only approved AI services used; this is a precondition for company tickets (see risks R-02). |
| What if it's wrong? | It only writes an internal comment labelled as AI analysis; confidence is shown; humans decide. Low-confidence results don't notify anyone. |
| Does it work with our SVN projects / Copilot? | Yes: SVN is supported and tested on a local repository; Copilot uses the same skill format and is the next thing to validate at work. |
| What does it cost? | ~1 minute and ~10 agent turns per ticket (about $0.70 API-equivalent; included in seat-based subscriptions). |
