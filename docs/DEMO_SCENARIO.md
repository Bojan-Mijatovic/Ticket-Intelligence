# Demo Scenario: "From ticket to tested fix, no human in the loop"

| | |
|---|---|
| **Status** | Defined and approved by Bojan Mijatović (2026-11-04); fully implemented and rehearsed (DEM-10, 2026-11-04). Live Teams variant on MediVax added 2026-11-16 (section 9): built and measured on a real pilot ticket, not rehearsed yet. Updated 2026-11-18: the team's side of Teams (a question in the channel, the approval of a fix by a reply) and the morning digest added as optional moments; readiness checked again (section 9, Readiness) |
| **Owner** | Bojan Mijatović |
| **Length** | 15 minutes (9 min live flow + questions) |
| **Audience** | team leads, developers, support, management |

**The presentation around it** (since 2026-11-18): `http://localhost:7070/?present`, seventeen minutes on how the app works, with the pilot's VAX-21 replayed whole from its records and one `ti:` question live in Teams at the end; the presenter speaks (→ moves on, **N** opens the notes in another window), or `?present&voice` lets the browser's voice speak. Its run of show is [PRESENTATION_PLAN.md](PRESENTATION_PLAN.md); the live variant below (section 9) can replace the replay.

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
| The card says *asked the reporter* or *light path*, and no analysis runs (label `ai-held` or `ai-triaged`) | System 1 read the report as half-written or as not about code (both act on their own since 2026-11-17). A talking point first ("it asks the customer before it spends a minute"), then **Analyze now** or **↻ Run again** on the card: a run a person starts always gets the full analysis. **Run ticket** with the key skips both from the start |

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
| What does it cost? | An analysis: about a minute, $0.32 on average (84 analyses; API-equivalent, included in seat-based subscriptions). Measured on the pilot: $1 to $2.50 per bug including the reproduction, the fix and the AI review ($14.79 for seven). The night shift stops at $5 a night. |
| Can the team just ask it? | Yes, in the Teams channel: `ti: VAX-21` gives the ticket's status in about two seconds, from the agent's records and with no AI; `ti: who knows Scadenze?` or a page's address is answered by plain code; anything else by Claude in about a minute, with its sources. The answer comes in the thread, masked. |
| Does it do anything without a ticket? | Every commit on main is checked against the fixes it touches (regression guard). At night it runs the regression tests of every known issue and the backlog, and at 08:00 it posts a digest: what it did, what came back, what waits for whom, what it cost. |
| Does it bother the customer? | Only to ask what a half-written report leaves out (what is wrong, where), from a template, never for a patient's name, and only for a report about code. The analysis starts on the answer or after 24 h. Everything else customer-facing is a draft a person sends. |
| Does it work with our Teams? | Yes, through a Workflows webhook in a standard channel: about 10 minutes for the channel's owner, no IT. Shown here on a test tenant. Asking and approving in the channel ("ti: VAX-21", "approve VAX-23") go through Microsoft Graph as one signed-in account, the admin's consent once (ROADMAP #9); real buttons on the card would need a Teams app (IT), so the buttons open the PR and Jira. |
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
- [ ] For the replies in the channel to come within seconds: `agent.config.json` → `teams.pollSeconds: 5` (15 by default), then `node agent/watcher.mjs --replace`; `node agent/teams-login.mjs --check` says the agent is signed in as Ticket Intelligence.

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
| *(optional, before 0:00)* | The private laptop, `support-triage` | this morning's **digest** card from 08:00: what the agent did since yesterday, what came back, what waits for whom, the cost | "The team starts the day with this. Nobody wrote it." (working days, when the watcher ran at 08:00) |
| 0:00 | Dashboard, Graph tab, MediVax | this morning's commit on `main` by Tommaso Bruno, its story Done, the regression guard clear | "A small change this morning. The tests are green, CI is green. The bug is inside." |
| 0:30 | Runs `node demo/pilot.mjs report --case late-today`, then opens the new ticket in Jira | a nurse's report, priority High: a patient's name, fiscal code, birth date and phone | "This is what support gets. Nobody assigns it, nobody starts anything." |
| 0:45 | Dashboard: types the key in **Run ticket** (skips the one-minute wait for edits) | the ticket queued, then analyzing; the patient's identifiers masked | "The patient's data never reaches the model." |
| ~2:00 | Waits | the analysis: cause, the breaking commit and its story, owner Tommaso Bruno, high confidence | "It found which change broke it, and who made it." |
| ~2:00 | Turns to the private laptop or the phone | the card in `support-triage`: **For @Tommaso Bruno**, the handoff, then **Why you** (his own commit), **Where** (file and line), **Confidence**, and **Open in Jira**; Tommaso's phone rings | "Tommaso knows, with the context and why it is him, about a minute after the report. Nobody forwarded anything." |
| ~2:30 | Dashboard | the bisect confirms the commit in seconds | "Not a guess: it replayed the history with the test." |
| ~4:00–6:00 | Dashboard | the reproduction test red on the current code, then the fix green, before and after screenshots, a draft PR | "And a tested fix, waiting for a person." |
| right after | The private laptop or the phone | a second card: **fix ready for review**, what was checked, **Broken by** the commit, **Review the pull request**; the phone rings again | "The same person, the same channel: now with the fix to review." |
| ~6:30 | Opens the PR from the card's button | two commits (failing test, then fix), the diff, the verification table | "Merging is always a human decision." |
| *(optional, ~6:45)* | On the phone or the private laptop, under the "fix ready" card: `approve` (as Tommaso, or as the presenter, who is in `teams.approvers`) | within seconds the thread answers that the PR is ready for review; on GitHub the PR is no longer a draft; Jira gets "Fix approved in Teams by …" | "Approving is a reply where the team already is. Merging stays a person's, in GitHub." **Only if it worked in the rehearsal**: its first live round is still pending |
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

**While the fix runs (optional, 2 minutes): Ask.** The minutes between the first card and the PR can show the Ask tab on MediVax. None of it touches the ticket on stage:

| Presenter types or clicks | Audience sees | Talking point |
|---|---|---|
| the new ticket's key alone | in about a second: what happened so far and **Now**: what waits, for whom (a chip "from the agent's records · no AI") | "The first question support asks: where is my ticket. No model, no cost." |
| the same from the phone: `ti: <the key>` in `support-triage` | the same answer in the thread, the asker @mentioned, within the poll interval (5 s for the demo) | "Support asks where it already works. Nobody opens the dashboard." (live since 2026-11-17: "ti: VAX-21" in 1.7 s) |
| "Which bugs did Scadenze have?" | the component's bugs newest first, what was fixed twice, what came back, who knows it, in under a second ("plain code · no AI") | "Most questions are answered by plain code; Claude only gets the rest." |
| **↳ Follow up** on it, then "Who knows it best?" | the people who know Scadenze, again in under a second: the question needs no subject | "It is a conversation, not a search box." |
| the address of the page the nurse was on, pasted from the app (`http://localhost:4204/scadenze`) | the route, the component, the API call and the controller method with its line, who knows it, its latest bugs ("plain code · no AI") | "Support pastes what they see; the developer gets where to look." |
| **Send to Teams…** on that answer, for the channel | the card in `support-triage`, with the sources as links | "An answer is something you pass on, not a chat you copy from." |
| **Create a ticket…** (not created) | the draft with the question, the answer, the sources and **Before you create**: what Jira already has | "Every new ticket is checked against what we already know." |

**Save as FAQ** needs a Claude answer and a 👍; MediVax PR #14 is the first one, to show instead of saving a new one on stage.

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

### Readiness (2026-11-18)

`node demo/preflight.mjs --teams` on 2026-11-18 at 10:19: every line green but the two pilot lines, as expected on a day without a demo (no reserved case pushed; the pilot's own `booster-anytime`, VAX-26, waits to be reported). Open agent PRs from earlier cases (VAX-23, VAX-25) are only a warning: a new ticket gets its own branch.

| What | State | Evidence |
|---|---|---|
| Teams channel, webhook from this machine | ready | `teams-test.mjs` posts; a GET to the webhook answers `TriggerRequestMethodNotValid` (preflight, 2026-11-18) |
| @mention of the owner | ready, not yet confirmed on the phone | the cards for Marta Ricci, Irene Fabbri and Tommaso Bruno arrived; nobody has yet checked that the phone of the mentioned person rings |
| The card: Why you, Where, Confidence (T5) and "fix ready" (T6) | ready | VAX-21, VAX-17, VAX-23 and VAX-25, real pilot tickets, both cards with no one starting anything |
| The whole scene, timed | measured, not rehearsed | VAX-21: handoff at 1:58 from the report, PR and "fix ready" at 5:19 (above). VAX-23 (Tommaso Bruno, frontend, the closest to `late-today`): handoff 54 s after the pick, "fix ready" with PR #15 6 min 2 s after it |
| The reserved cases | ready | `late-today` and `lot-expiry-iso` are not used; the schedule never takes them. Run `pilot.mjs check --case late-today` the day before: `main` moved since 2026-11-16 |
| The pilot on the day | set on the morning of the demo | the schedule pushes two cases a working day. On the morning of the demo, a case it pushed must be reported first (`pilot.mjs report --case <id>`), then the reserved one planted. After `card-sex-raw` (by catalog order, about 2026-11-19 at 15:00) only the reserved cases are left: the schedule then pushes nothing, which is fine for the demo, but the pilot needs new cases |
| Watcher | ready | current code, a status within 4 ms (preflight); a restart waits for the running job. A merge check (when main moves and a fix PR is open) runs for up to four minutes: the preflight warns while one is running, and the reserved case pushed an hour before gives it time to finish |
| System 1 | ready | `ft-5`, answers in about a second. The question to the reporter and the light path act on their own since 2026-11-17; the demo ticket is a clear `[FE]` bug report, and **Run ticket** skips both anyway |
| Fallback DEM-46 | ready | its Teams message came 61 and 74 s after the pick, twice |
| Ask: an answer sent to Teams (Send to Teams) | ready | a MediVax answer posted from the dashboard arrived in `support-triage`, sources as links (2026-11-17) |
| Ask in Teams ("ti: …" in the channel) | ready (ROADMAP #9) | live 2026-11-17: "ti: VAX-21" answered in the thread in 1.7 s, a follow-up by Claude in 25 s; the agent signed in as Ticket Intelligence (`node agent/teams-login.mjs --check` says so) |
| Approval from Teams ("approve" under the card, or "approve VAX-23" / "odbij VAX-25: why") | built, round not yet live | the presenter is in `teams.approvers`; a misplaced decision was answered live; the reject → refix → approve round is checked in the rehearsal. VAX-23's draft PR #15 (Tommaso Bruno) is kept for it: still green on the main of 2026-11-18 (merge check) |
| The owner's reply ("preuzimam" / "nije moje: <who>") | built, round not yet live | checked in the rehearsal, under the handoff card |
| Morning digest | ready | the first one posted to `support-triage` on 2026-11-18 at 09:57 (five tickets, two draft fix PRs, $5.53, what waits); then every working day at 08:00 |
| The private laptop, the room's network, the recording | not done | only possible on the day before |
| The test tenant | a 30-day trial from 2026-11-16 | a demo after mid-December needs one paid month |

### The rehearsal

One full run of this section before the demo, with a case that is **not** reserved, so that both reserved cases stay for the day. `card-booster-label`, named here before, became VAX-23 on 2026-11-17.

1. The morning of the rehearsal: `node demo/pilot.mjs plant --case card-sex-raw` (Tommaso Bruno, frontend: the card's header shows "F" instead of "Femmina"; the last case of the catalog by him that is not reserved). The schedule takes it by itself, after `due-phone` and `vaccines-order`, so plant it by hand before that, or rehearse with the case in flight and the presenter as the owner. Planted, it is in flight and the schedule reports it 1 to 3 hours later: rehearse before that, or the schedule reports it first.
2. `node demo/preflight.mjs --teams`. For the rehearsal its two pilot lines say NO-GO, since this case is not reserved ("a reserved case is pushed") and is in flight ("no other case in flight"); every other line must be green.
3. The phone signed in as Tommaso Bruno, the private laptop on `support-triage`.
4. The script from 0:00: `node demo/pilot.mjs report --case card-sex-raw`, **Run ticket**, the two cards, the PR. Note the real times against the script's.
5. The team's side of Teams, which has not run live yet: under the handoff card, Tommaso replies `preuzimam` (the ticket is assigned to him in Jira); under the "fix ready" card, `reject: <a reason>` once (the PR is closed, the fix runs again with the reason, a new "fix ready" card comes), then `approve` (the new PR is ready for review, Jira gets the comment). From the phone, `ti: <the key>`: the status says what happened. Keep in the demo only what worked here.
6. Afterwards: merge the PR after a merge check, as after a real demo; the pilot then documents it.
