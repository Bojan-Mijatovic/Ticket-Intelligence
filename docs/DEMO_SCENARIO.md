# Demo Scenario: "From ticket to tested fix, no human in the loop"

| | |
|---|---|
| **Status** | Defined and approved by Bojan Mijatović (2026-11-04); fully implemented and rehearsed (DEM-10, 2026-11-04) |
| **Owner** | Bojan Mijatović |
| **Length** | 15 minutes (9 min live flow + questions) |
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
- [ ] Full rehearsal done (section 4, with `node demo/new-ticket.mjs` and `node demo/resolve-ticket.mjs <KEY>`), and a **screen recording saved** as a fallback (Windows: Win+Alt+R, or Clipchamp).
- [ ] `node demo/reset-demo.mjs` (dry run), then `node demo/reset-demo.mjs --yes`: closes the agent's pull requests and branches, deletes the rehearsal tickets, archives the agent state.
- [ ] Laptop: power plan "never sleep", notifications off, browser zoom 110 %.

**30 minutes before**
- [ ] `node demo/run-mediagenda.mjs` (app on :4200, backend on :8080) and `node agent/watcher.mjs` (dashboard on :7070, restarted after the reset so it starts empty).
- [ ] `node demo/preflight.mjs` → **GO** (Jira, no leftover tickets, Claude CLI, GitHub CLI, clean MediAgenda main, no agent branches/PRs, Playwright, watcher, app).
- [ ] Browser tabs, in order: (1) MediAgenda app, (2) Jira board DEM, (3) dashboard, (4) MediAgenda pull requests on GitHub.

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
| ~3:30 | Dashboard: reproduction | the browser test the agent wrote fails on the current code (checked by the watcher); the "before" screenshot shows providers of both structures | "It proved the bug in the real app, with a test." |
| ~6:30 | Dashboard: fix | browser tests ✓, `ng build` ✓, backend unchanged; before/after screenshots; **Open draft pull request** | "And proposed a tested fix. A developer reviews it, they don't start from zero." |
| 7:00 | Opens the pull request on GitHub | two commits (failing test, then fix), the diff, the verification table | "Merging is always a human decision." |
| 7:30 | In Jira, moves the ticket to Done (or `node demo/resolve-ticket.mjs <KEY>`) | within ~1.5 min: a documentation PR with the known-issue entry (cause, fix, how to verify, recurrence of DEM-5) | "Next time this kind of bug comes, the answer is already in the repo." |
| 9:00 | Questions | | |

## 5. What makes it convincing

- It is a **real Jira** and a **real application**, not slides.
- Nothing is pre-computed: every step streams live, with timings.
- The analysis cites **evidence** (ticket keys, commit hashes, file:line), not just an opinion.
- The safety story is visible: policy chips, drafts waiting for approval, read-only agent.

## 6. If something goes wrong

| Problem | Fallback |
|---|---|
| Network / Jira unavailable | play the recording; the dashboard history still shows earlier runs |
| Agent slower than usual | keep talking over the streamed steps. Measured in the rehearsal (DEM-10): analysis in Jira 1:23, bug reproduced 2:27, draft PR 6:10; Done → documentation PR 1:32 |
| Agent fails (`ai-failed`) | remove the label in Jira; it is retried at the next poll; meanwhile show DEM-7's earlier result |
| Ticket flagged as a duplicate | turn it into a talking point ("it also recognized the duplicate"), then continue |
| Claude CLI session expired | run `claude` once in a terminal before the demo; fallback to the recording |

## 7. Reset after the demo

The demo application lives in its own private repository, https://github.com/Bojan-Mijatovic/MediAgenda (local clone: `demo/mediagenda`). Its `main` is never rewritten; the agent only adds branches and pull requests.

```
node demo/reset-demo.mjs          # dry run: shows what will be closed / deleted
node demo/reset-demo.mjs --yes    # agent PRs closed + branches deleted, demo tickets deleted, agent state archived
```

Then restart the watcher and run `node demo/preflight.mjs`.

`make-mediagenda.mjs --force` refuses to rebuild a repository that has a remote, because the new history would need a force push.

## 8. Expected questions

| Question | Short answer |
|---|---|
| What about patient data? | Must be redacted before analysis and only approved AI services used; this is a precondition for company tickets (see risks R-02). |
| What if it's wrong? | It only writes an internal comment labelled as AI analysis; confidence is shown; humans decide. Low-confidence results don't notify anyone. |
| Does it work with our SVN projects / Copilot? | Yes: SVN is supported and tested on a local repository; Copilot uses the same skill format and is the next thing to validate at work. |
| What does it cost? | ~1 minute and ~10 agent turns per ticket (about $0.70 API-equivalent; included in seat-based subscriptions). |
