# Demo Scenario: "From ticket to tested fix, no human in the loop"

| | |
|---|---|
| **Status** | Defined and approved by Bojan Mijatović (2026-11-04); fully implemented and rehearsed (DEM-10, 2026-11-04). Live Teams variant on MediVax added 2026-11-16 (section 9): built and measured on a real pilot ticket, not rehearsed yet (see its Readiness table) |
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
- [ ] `node demo/reset-demo.mjs` (dry run), then `node demo/reset-demo.mjs --yes`: closes the agent's pull requests and branches, puts the app back on `main`, deletes the rehearsal tickets, archives the agent state. Tickets made by hand in Jira are kept unless named: the dry run lists them, add `--also DEM-11,DEM-12`.
- [ ] Laptop: power plan "never sleep", notifications off, browser zoom 110 %.

**30 minutes before**
- [ ] `node demo/run-mediagenda.mjs` (app on :4200, backend on :8080) and `node agent/watcher.mjs --replace` (dashboard on :7070; `--replace` stops a watcher that is still running from earlier, so the dashboard starts empty and runs the current code).
- [ ] `node demo/preflight.mjs` → **GO** (Jira, no leftover tickets, Claude CLI, GitHub CLI, MediAgenda clone on a clean `main`, no agent branches/PRs, Playwright, watcher up and running the current code, app).
- [ ] Browser tabs, in order: (1) MediAgenda app, (2) Jira board DEM, (3) dashboard, (4) MediAgenda pull requests on GitHub, **signed in as Bojan-Mijatovic** (the repository is private: signed out, every PR link shows 404).

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
| 7:15 | *(optional)* Dashboard: **👁 Preview in app**, then the MediAgenda tab | the app on :4200 now runs the fix branch: clearing Struttura by hand no longer mixes structures | "This is the fix running, before anyone merged it." (back with **back to main** in the dashboard header) |
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
| Agent fails (`ai-failed`) | **↻ Run again** on the ticket's card (or remove the label in Jira); meanwhile show DEM-7's earlier result |
| Ticket edited after the analysis (e.g. a tag or a clearer description added) | **↻ Run again** on the card, or type the key in **Run ticket** |
| Status `analyzed · no fix` | the subtitle says why (confidence, tag, duplicate). A title without a tag gets a fix only when the analysis places the change entirely in `frontend/` |
| The app on :4200 does not show the fix | the fix is on the ticket's branch: **👁 Preview in app** (or `node demo/preview.mjs DEM-xx`); each branch starts from `main`, so it shows only that fix |
| Pull request link shows GitHub 404 | the browser is not signed in to GitHub as the repository owner (private repository) |
| `A watcher is already running` | `node agent/watcher.mjs --replace` |
| Ticket flagged as a duplicate | turn it into a talking point ("it also recognized the duplicate"), then continue |
| Claude CLI session expired | run `claude` once in a terminal before the demo; fallback to the recording |

## 7. Reset after the demo

The demo application lives in its own private repository, https://github.com/Bojan-Mijatovic/MediAgenda (local clone: `demo/mediagenda`). Its `main` is never rewritten; the agent only adds branches and pull requests.

```
node demo/reset-demo.mjs          # dry run: shows what will be closed / deleted
node demo/reset-demo.mjs --yes    # agent PRs closed + branches deleted, app back on main, demo tickets deleted, agent state archived
node demo/reset-demo.mjs --yes --also DEM-11,DEM-12   # also delete tickets made by hand (the dry run lists them)
```

Then `node agent/watcher.mjs --replace` and `node demo/preflight.mjs`.

`make-mediagenda.mjs --force` refuses to rebuild a repository that has a remote, because the new history would need a force push.

## 8. Expected questions

| Question | Short answer |
|---|---|
| What about patient data? | Must be redacted before analysis and only approved AI services used; this is a precondition for company tickets (see risks R-02). |
| What if it's wrong? | It only writes an internal comment labelled as AI analysis; confidence is shown; humans decide. Low-confidence results don't notify anyone. |
| Does it work with our SVN projects / Copilot? | Yes: SVN is supported and tested on a local repository; Copilot uses the same skill format and is the next thing to validate at work. |
| What does it cost? | ~1 minute and ~10 agent turns per ticket (about $0.70 API-equivalent; included in seat-based subscriptions). Measured on the pilot: $1 to $2.50 per bug including the reproduction, the fix and the AI review ($11.82 for five). |
| Does it work with our Teams? | Yes, through a Workflows webhook in a standard channel: about 10 minutes for the channel's owner, no IT. Shown here on a test tenant. Approving a fix from Teams needs a Teams app (IT), so for now the buttons open the PR and Jira. |
| How does it know who should get it? | From the history: who wrote and changed that code, and for a regression who made the change that broke it. The card says why ("Why you: authored VAX-20, the regression"). On the pilot the owner was right 5 times out of 5. |
| Does patient data end up in Teams? | The Teams message carries the same text as the internal Jira comment, written from the masked ticket. The masking catches most identifiers but not every uncommon name (11 of 15 on the pilot), which is why company tickets wait for R-02. |
| What if the agent is restarted in the middle? | A restart waits for the running job (an analysis, a fix, a review) and then takes over; queued tickets are found again in Jira. |

## 9. Live variant: a real Teams channel and the MediVax pilot

Added 2026-11-16. The same message, with two changes: the owner's message arrives in a **real Teams channel** and @mentions them, so their phone rings in the room, and the bug comes from the **MediVax pilot** ([PILOT.md](PILOT.md)).

**Why MediVax and not MediAgenda.** A pilot bug comes with a developer's change, so the owner is known: the developer who made it, named by the analysis in 4 of 4 pilot tickets. MediAgenda's ownership now leans towards the presenter: 12 commits on its `main` are his merges, and DEM-43, the same report as DEM-42, was handed to him instead of Sara Colombo. MediVax also adds a step the audience remembers: the agent names the commit that broke the code and who made it, and the bisect confirms it.

**The case.** `late-today` (frontend, Tommaso Bruno): "a dose due today is marked *in ritardo*". The spare is `lot-expiry-iso` (frontend, Tommaso Bruno): "the lot expiry is shown as 2026-11-30". Both are in `reserve` (`agent.config.json` → `VAX.pilot`), so the schedule never pushes or reports them. Both passed `node demo/pilot.mjs check` on 2026-11-16: they apply to `main`, and the build and the 9 browser tests miss them.

### Setup

**Two laptops.** The work laptop runs everything: the watcher and dashboard, the MediVax app (:4204), Jira and GitHub. The private laptop only shows Teams: the test tenant's team *MediAgenda Support*, channel `support-triage`. It can be on a guest network or a phone hotspot. Tommaso Bruno is signed in on a phone (or in a private browser window) with the channel's notifications on.

**The test tenant** is a Microsoft 365 Business Basic trial: 30 days from sign-up, so a demo after that needs one paid month. Users are `first.last@<tenant>.onmicrosoft.com`, all members of the team, the presenter included. The work laptop's `.env` has `TEAMS_WEBHOOK_URL`, `TEAMS_MENTION_DOMAIN` and, for **Open in Teams**, `TEAMS_CHANNEL_URL` ([agent/README.md](../agent/README.md#notifications)).

**The day before**
- [ ] From the network of the presentation room: `node agent/teams-test.mjs --mention "Tommaso Bruno"`. The message arrives, his name is highlighted and his phone rings.
- [ ] `node demo/pilot.mjs status`: no case in flight. If `Next:` says a case waits to be reported, report it now (`node demo/pilot.mjs report`), so that its ticket is not processed during the demo.
- [ ] `node demo/pilot.mjs check --case late-today` shows ✓: the change still applies to `main` and the existing tests miss it. If ✗, use `lot-expiry-iso`.
- [ ] A full run recorded as a fallback.
- [ ] No System 1 training running on the work laptop: it slows the machine, and the System 1 server then takes minutes to start.

**The morning of the demo** (at least an hour before)
- [ ] `node demo/pilot.mjs plant --case late-today`. Tommaso's change goes to MediVax `main` (a Jira story, Done, and one commit), and within 2 minutes the regression guard checks it. The schedule now pushes nothing else and does not report this case: no unplanned ticket comes during the demo.
- [ ] *(optional, check in the rehearsal)* the app on :4204 shows the new `main` and the bug on a patient's card.

**30 minutes before:** `node demo/preflight.mjs --teams` says **GO**. It checks, without posting anything:
- Jira, the Claude CLI and GitHub;
- the MediVax clone and the watcher: on current code, answering within a second;
- Teams: the channel is live with @mentions, the webhook answers from this network (a GET, which the workflow refuses without running), and the owner has an account to mention;
- the pilot: the reserved case is pushed, and nothing else is in flight.

It only warns about System 1 and a running training. Then the private laptop goes on the channel at 125 % zoom with *Do not disturb* on, and the dashboard's Teams panel says **live channel, @mentions the owner**.

### Script

| Time | Presenter does | Audience sees | Talking point |
|---|---|---|---|
| 0:00 | Dashboard, Graph tab, MediVax | this morning's commit on `main` by Tommaso Bruno, its story Done, the regression guard clear | "A small change this morning. The tests are green, CI is green. The bug is inside." |
| 0:30 | Runs `node demo/pilot.mjs report --case late-today`, then opens the new ticket in Jira | a nurse's report, priority High: a patient's name, fiscal code, birth date and phone | "This is what support gets. Nobody assigns it, nobody starts anything." |
| 0:45 | Dashboard: types the key in **Run ticket** (skips the one-minute wait for edits) | the ticket queued, then analyzing; the patient's identifiers masked | "The patient's data never reaches the model." |
| ~2:00 | Waits | the analysis: cause, the breaking commit and its story, owner Tommaso Bruno, high confidence | "It found which change broke it, and who made it." |
| ~2:00 | Turns to the private laptop or the phone | the card in `support-triage`: **For @Tommaso Bruno**, the handoff, then **Why you** (his own commit), **Where** (file and line), **Confidence**, and **Open in Jira**; Tommaso's phone rings | "Tommaso knows, with the context and why it is him, about a minute after the report. Nobody forwarded anything." |
| ~2:30 | Dashboard | the bisect confirms the commit in seconds | "Not a guess: it replayed the history with the test." |
| ~4:00–6:00 | Dashboard | the reproduction test red on the current code, then the fix green, before and after screenshots, a draft PR | "And a tested fix, waiting for a person." |
| right after | The private laptop or the phone | a second card: **fix ready for review**, what was checked, **Broken by** the commit, **Review the pull request**; the phone rings again | "The same person, the same channel: now with the fix to review." |
| ~6:30 | Opens the PR from the card's button | two commits (failing test, then fix), the diff, the verification table | "Merging is always a human decision." |
| 7:00 | Questions | | |

The pilot's tickets so far: analysis in about a minute, the Teams message right after it (61–74 s from pick to message, measured 2026-11-16), and the draft PR about 4 minutes after the ticket (VAX-13: 259 s).

**The whole scene, measured on a real pilot ticket** (VAX-21, 2026-11-16, nobody starting anything; times from the report):

| | |
|---|---|
| 0:00 | the nurse's report (3 of 3 patient identifiers masked) |
| 1:07 | picked (the one-minute wait for edits; **Run ticket** skips it) |
| 1:57 | analysis: high confidence, owner Irene Fabbri, a regression of VAX-5 |
| 1:58 | **Teams 1**: For @Irene Fabbri, Why you: "She authored VAX-20 (6e8e6e1), the regression" |
| 3:33 | the backend test reproduces the bug |
| 3:56 | bisect: broken by 6e8e6e1 (VAX-20, Irene Fabbri), in 22 s |
| 5:15 | draft PR #7, 24 backend tests green |
| 5:19 | **Teams 2**: fix ready for review, @Irene Fabbri, Review the pull request |

On stage, with **Run ticket**, both cards come about a minute sooner.

### If something goes wrong

| Problem | Fallback |
|---|---|
| No Teams message | the dashboard's Teams panel shows the card and, if the channel refused it, why. Then **↻ Run again** on DEM-46 (owner Marta Ricci; message in 61–74 s, twice on 2026-11-16) |
| The name in the card is plain text, no phone rings | Teams does not know that sign-in name: the message still arrives. Point at the card; check the user in the tenant afterwards |
| The owner is not Tommaso | a talking point: the analysis says why. The presenter is a member of the team, so if it names him his own phone rings |
| `late-today` no longer applies (`check` ✗) | `lot-expiry-iso`, same steps |
| The private laptop has no network | phone hotspot; or show the dashboard's Teams panel, which holds the same card |
| Anything else | section 6, or the recording |

### After the demo

Merge or close the draft PR. After a merge, the next pilot tick moves the ticket to Done and the agent documents it, as for any pilot case. The schedule then goes on by itself: the case is reported, so nothing is in flight.

Merge only after a merge check, as for the pilot's fixes ([PILOT.md](PILOT.md), *Merging*): the fix branch on the current `main` with every test run on the result. If the PR is closed by mistake, its branch stays: reopen it.

### Readiness (2026-11-16)

| What | State | Evidence |
|---|---|---|
| Teams channel, webhook from this machine | ready | `teams-test.mjs` posts; a GET to the webhook answers `TriggerRequestMethodNotValid` (preflight) |
| @mention of the owner | ready, not yet confirmed on the phone | the card for Marta Ricci and the cards for Irene Fabbri arrived; nobody has yet checked that the phone of the mentioned person rings |
| The card: Why you, Where, Confidence (T5) and "fix ready" (T6) | ready | VAX-21 and VAX-17, real pilot tickets, both cards with no one starting anything |
| The whole scene, timed | measured once, not rehearsed | VAX-21: handoff at 1:58 from the report, PR and "fix ready" at 5:19 (above) |
| The reserved cases | ready | `late-today` and `lot-expiry-iso` pass `pilot.mjs check`; the schedule never takes them |
| Watcher | ready | current code, a status within 30 ms while it works; a restart waits for the running job |
| `node demo/preflight.mjs --teams` | GO but for the reserved case | it is pushed on the morning of the demo, on purpose |
| Fallback DEM-46 | ready | its Teams message came 61 and 74 s after the pick, twice |
| The private laptop, the room's network, the recording | not done | only possible on the day before |
| The test tenant | a 30-day trial from 2026-11-16 | a demo after mid-December needs one paid month |

### The rehearsal

One full run of this section before the demo, with a case that is **not** reserved, so that both reserved cases stay for the day:

1. The morning of the rehearsal: `node demo/pilot.mjs plant --case card-booster-label` (Tommaso Bruno, frontend: the influenza booster shows as "Dose 2"). It is in flight, so the schedule reports it by itself 1 to 3 hours later: rehearse before that, or the schedule reports it first.
2. `node demo/preflight.mjs --teams`. For the rehearsal its two pilot lines say NO-GO, since this case is not reserved ("a reserved case is pushed") and is in flight ("no other case in flight"); every other line must be green.
3. The phone signed in as Tommaso Bruno, the private laptop on `support-triage`.
4. The script from 0:00: `node demo/pilot.mjs report --case card-booster-label`, **Run ticket**, the two cards, the PR. Note the real times against the script's.
5. Afterwards: merge the PR after a merge check, as after a real demo; the pilot then documents it.
