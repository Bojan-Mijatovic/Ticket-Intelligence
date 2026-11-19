# The pilot: MediVax

Status: **Running since 2026-11-13**; 7 of 7 cases right on 2026-11-18 · Owner: Bojan Mijatović · Builds on: [AUTONOMY_AND_NEXT.md](AUTONOMY_AND_NEXT.md) (decision 1, the pilot project), [REDACTION.md](REDACTION.md) (R-02)

## Why

Everything measured so far comes from demo data, and mostly from the agent fixing its own analyses. Continuous evaluation (AI1) needs a steady flow of tickets the agent has never seen, with a known right answer. No real pilot project has been chosen yet. This demo pilot starts the measurement now and runs until a real project replaces it.

Every case has an **answer key**: the commit that broke the code, the file, and the people who know that code. So the pilot measures for the first time whether the agent finds the **culprit**, through its analysis and its bisect, and not only the right file.

## What runs

| When | What | Who |
|---|---|---|
| working days at 10:00 and 15:00 (`agent.config.json` → `VAX.pilot`) | a developer's change is pushed to MediVax `main`: a Jira story (Done) and one commit by the developer. Inside the change is a bug. First the existing tests of that side run (Maven, or `ng build` and Playwright), as CI would. A case they catch is dropped | `demo/pilot.mjs` (plain code) |
| 1 to 3 hours later | a user reports the symptom in Jira as a `[BE]` or `[FE]` bug, quoting a patient the way real tickets do (name, fiscal code, sometimes birth date, phone, health card) | `demo/pilot.mjs` |
| within minutes | analysis, "already known?", reproduction test, bisect, fix, draft PR, AI review: the agent does what it does for any ticket. The owner gets a Teams message with an @mention and why it is them, and a second one when the fix is ready (when a channel is set up); they may approve or reject the fix by a reply there | the agent (watcher) |
| later | merge or close the PR | a person |
| at the next tick after the merge | the ticket moves to Done, as the team would close it once its fix is on `main`; the agent then documents it, and the entry names the fix's regression test | `demo/pilot.mjs` |
| within 2 minutes of every push | the regression guard (A1) checks the commit: does it touch an earlier fix, do that fix's tests still pass | the agent (watcher) |
| any time | each case scored against its answer key | `node demo/pilot.mjs status` |

One case is in flight at a time: the next change is pushed only after the previous bug was reported. A Windows scheduled task (`TicketIntelligencePilot`) runs `demo/pilot.mjs tick` every 30 minutes, hidden. Each tick:

- starts the watcher if it is not running;
- reports what is due and pushes what is due;
- writes the scores.

The task runs while this machine is on and the user is logged in.

## The answer key and the scores

| Measure | Right when |
|---|---|
| files | the analysis names a file the case changed (one case accepts either side, see the catalog) |
| culprit named | the analysis cites the breaking commit or its story |
| owner | the proposed owner knows that code: its author, or the developer who made the change |
| fix PR | a verified draft PR, and whether it changed the file the bug is in |
| guard | for a regression case: the regression guard alerted on its commit before the ticket was reported; for the other cases, an alert is a false alarm |
| bisect exact | the bisect names exactly the breaking commit |
| time, cost | from the report to the analysis and to the PR; the model cost of the ticket |
| identifiers masked | the patient data the ticket quoted is gone from the text the model reads |

`node demo/pilot.mjs status` prints each case and the totals, and writes `<state>/projects/VAX/pilot/score.json`. The agent's own accuracy (`agent/accuracy.mjs`, the Graph and Impact tabs) counts the pilot tickets like any other.

## Synthetic patients (R-02)

The pilot does not need the DPO's approval, because it has no real patient data:

- `demo/lib/synthetic-patients.mjs` makes every patient of the seed and of the tickets. It is deterministic and has no real person in it.
- A fiscal code is computed from the invented name, birth date and town, then its check letter is moved by one. It has the official shape, so the masking meets it the way it would meet real data, but it fails the official check, so it cannot belong to anyone.
- Health card numbers use the Italian prefix 80380. Phone numbers are mobile-shaped.
- About a quarter of the first names are uncommon ones that the masking's name list does not know (Iolanda, Ottavio, …). They are there on purpose: the pilot measures the misses, not only the hits.

The masking is measured on every ticket. On the first one (VAX-13) it masked the fiscal code and the phone, but not "Ferrara Iolanda", because "Iolanda" is not on its list of first names. That is the kind of evidence the DPO will ask for before real tickets. Real patient data still needs the DPO's approval and an approved AI service.

## The catalog

`demo/src/medivax/pilot-cases.mjs`, outside the app's repository, so the agent never reads it. A case applies only while the code it changes is on `main` in the same form.

| Case | Side | The change, and the bug inside it | The symptom reported |
|---|---|---|---|
| due-last-day | BE | a cleanup of the due list; the last day of the period is no longer included | the doses due on Sunday are missing from the week |
| hpv-26 | BE | comments on the age checks; the age limit becomes exclusive | a 26-year-old is refused the second HPV dose |
| week-sunday | FE | a simpler week computation; a Sunday gives the next week | on a Sunday, Scadenze shows the next week |
| interval-from-first | BE | "the repository already orders the doses"; the next dose is computed from the first dose | the third ESA dose is due too early |
| card-booster-label | FE | one label for both tables; the booster loses its label on the card | the influenza booster shows as "Dose 2" |
| late-today | FE | a comment on the late marker; a dose due today counts as late | a dose due today is marked "in ritardo" |
| search-two-letters | BE | comments on the search limits; the minimum becomes 3 characters while the page says 2 | two letters find nobody (fixing either side is right) |
| due-last-day-again | BE | **a regression of VAX-13**: half-open periods "as the SMS gateway counts them"; VAX-13's regression test is "adjusted" so CI passes | the patients due on Sunday are not in the week again (fixing the backend or the page is right) |
| booster-anytime | BE | a comment on the interval rule; boosters skip the interval check | an influenza booster is accepted six months after the previous dose |
| due-phone | BE | a note on the call list; the health card goes where the phone was | the phone column of Scadenze shows a 20-digit number |
| vaccines-order | BE | the standard query for the catalog; the alphabetical order is lost | the vaccines are no longer in alphabetical order (low priority) |
| lot-expiry-iso | FE | shorter lot labels; the expiry date loses its Italian format | the lot expiry shows as 2026-11-30 |
| card-sex-raw | FE | a compact card header; the sex shows as its code | the header shows "F" instead of "Femmina" (low priority) |

`node demo/pilot.mjs check` checks each case without pushing anything: it must apply to `main`, and the existing tests must miss it. All 13 passed this check on 2026-11-13. Thirteen cases last about six working days, so the catalog has to keep growing.

A **regression case** (`regressionOf`) brings back a bug whose fix is merged. Regressions that the fix's own test catches never reach `main`, because the planter runs the tests first, as CI would. So a regression case slips past that test: the bug comes back through another path, or the developer "adjusts" the failing test. A regression case is written against the fix as merged, since the agent wrote that fix. The analysis should call the bug a regression, and the regression guard should alert on the commit before the ticket comes.

## Commands

```
node demo/pilot.mjs status                 the cases so far, their scores, what comes next
node demo/pilot.mjs check [--case id]      dry run: does each change apply, do the tests miss it
node demo/pilot.mjs plant [--case id]      push the next change now
node demo/pilot.mjs report [--case id]     report a pushed case's bug now
node demo/pilot.mjs tick                   what the schedule runs every 30 minutes
node demo/pilot.mjs schedule --install     install the schedule (--remove to stop the pilot)
```

**Cases kept for a live demo.** `reserve` in `agent.config.json` → `VAX.pilot` lists cases the schedule never pushes or reports (now `late-today` and `lot-expiry-iso`). A person pushes one with `plant --case` on the morning of a demo and reports it with `report --case` on stage. Until then it is the case in flight, so the schedule pushes nothing else: no unplanned ticket comes during the demo. The steps are in [DEMO_SCENARIO.md](DEMO_SCENARIO.md#9-live-variant-a-real-teams-channel-and-the-medivax-pilot), section 9.

The app itself: `node demo/run-mediagenda.mjs --project VAX` (backend :8084, frontend :4204). Repository: `Bojan-Mijatovic/MediVax` (private), built by `node demo/make-project.mjs medivax` from `demo/src/medivax/`. Jira project: VAX.

## First results (2026-11-13)

| Case | Ticket | Result |
|---|---|---|
| due-last-day | VAX-13 | everything right. The analysis named the breaking commit (d2fe6eb, story VAX-12), the file and the owner. The bisect confirmed the commit in 18 s. The draft PR came 259 s after the ticket was picked: a one-condition fix and a regression test. AI review: low risk. $1.17. Masking: 2 of 3 identifiers (the name "Ferrara Iolanda" passed). A person merged the PR (#3), and the pilot then closed the ticket |
| due-last-day-again | (VAX-15 story, ticket due later) | the regression guard alerted 3.4 minutes after the push. The commit changed 2 lines of VAX-13's fix and its regression test, and that test as it was before failed on the commit. The alert was posted on the commit (GitHub) and on VAX-15 and VAX-13 (Jira) |

The first case found a defect in the bisect, now fixed. For a regression, the analysis gave the breaking commit as `priorArt.commit`, the field meant for the earlier fix, and the bisect plan dropped that commit's parent. Both readings are now covered.

## Results after five cases (2026-11-16)

`node demo/pilot.mjs status`: **5 of 5** analysed, and for every one the files, the breaking commit, the owner, a verified fix PR and an exact bisect were right. The regression guard caught the one regression before its ticket and raised no false alarm on the other pushes. Masking: 11 of 15 quoted identifiers (the misses are uncommon first names, on purpose). Model cost: $11.82 for the five.

| Case | Ticket | What happened |
|---|---|---|
| hpv-26 | VAX-16 | a 26-year-old refused the second HPV dose: the age check had become `>=` in a "comments only" commit (VAX-14). Fix PR #5 |
| due-last-day-again | VAX-17 | the regression of VAX-13. The first fix run stopped on `EBUSY` (a killed `cmd.exe` left the real process holding the worktree; `killTree` fixed that). Run again on 2026-11-16: the analysis named VAX-15 (`5bf4f30`) as the change that brought it back, the bisect confirmed it in 39 s, fix PR #8 |
| week-sunday | VAX-19 | on a Sunday Scadenze showed the next week. Fix PR #6 was right for the page, but the **AI review said "needs changes"**: the patient in the ticket would still be missing, because the backend left out the last day (VAX-17), and the new browser test passed only because the mock API includes it. So #6 was merged only together with #8 |
| interval-from-first | VAX-21 | the next dose counted from the first dose. The whole flow with no one starting anything, measured from the report: handoff in Teams to @Irene Fabbri at 1:58 ("Why you: She authored VAX-20 (6e8e6e1), the regression"), bisect to that commit at 3:56, **fix ready for review** with PR #7 at 5:19 |

**Merging.** Each fix was merged only after a merge check: a throwaway worktree of the current `main` with the fix branches merged in, and every backend test, the frontend build and every browser test run on that result (as CI would). VAX-21 and VAX-16 together: 26 backend tests; VAX-17 and VAX-19 together: 27 backend tests, the build and 10 browser tests. The guard then cleared every merge commit. The pilot moved the tickets to Done and the agent documented them.

**What the pilot taught.**
- A fix PR can be closed by mistake ("ok", then Close instead of Merge: #7). Its branch stays, so it can be reopened.
- The AI review catches what the tests cannot: a test passing against a mock that is more lenient than the real backend (#6).
- A regression whose author "adjusted" the earlier fix's test so CI passed (VAX-15) leaves that test unable to guard anything. Its first version was restored by hand (PR #13): it passes on the fixed `main` and fails on the code before the VAX-17 fix.
- Several documentation PRs written from the same `main` conflict when merged one after another: the index in `docs/knowledge/README.md`, and in the component file the owners line and the top of "Known issues". They were resolved by hand, keeping every entry ([KNOWLEDGE_PLAN.md](KNOWLEDGE_PLAN.md), K22). Since 2026-11-17 the agent merges them entry by entry itself; replayed on these three conflicts, none was left and no entry lost.

## Results after seven cases (2026-11-18)

`node demo/pilot.mjs status`: **7 of 7** analysed; files, the breaking commit, the owner, a verified fix PR and an exact bisect right for every one. Regression guard: the one regression caught before its ticket, no false alarm on the other five pushes. Masking: 16 of 20 quoted identifiers. Model cost: $14.79 for the seven.

| Case | Ticket | What happened |
|---|---|---|
| card-booster-label | VAX-23 | the influenza booster shown as "Dose 2" on the patient's card, brought in by Tommaso Bruno's "same dose label" change (VAX-22). Handoff to @Tommaso Bruno 54 s after the pick, the Playwright test red on main, bisect to `6cc5715` in 26 s, **fix ready** with PR #15 6 min after the pick; AI review: low risk. The PR is kept open for the demo's approval round in Teams |
| search-two-letters | VAX-25 | two letters found nobody: a "comments only" commit (VAX-24, Irene Fabbri) raised the search minimum to 3. The analysis called it a regression of VAX-2, which set the minimum at 2; a JUnit test red on main, bisect to `2717e89` with one test run in 20 s, PR #16, the whole flow in 4 min 27 s; AI review: low risk |
| booster-anytime | VAX-26 (story) | pushed on 2026-11-18 at 10:00 as Federica Gallo's change; the guard cleared it (it touches no earlier fix); its bug is reported by the schedule within three hours |

Both open PRs went through a merge check each time `main` moved (2026-11-17 and 2026-11-18) and are still green.

**The catalog is almost used up.** After `booster-anytime`, the schedule takes `due-phone`, `vaccines-order` and `card-sex-raw`, then only the two reserved cases are left and it pushes nothing (it says so: "only reserved cases are left"). New cases go into `demo/src/medivax/pilot-cases.mjs`, each checked with `pilot.mjs check`.

## Costs and limits

- **Cost.** About $1 to $2.50 of model use per case (analysis, fix, review; $11.82 for the first five, $14.79 for seven), so $40 to $100 a month at two cases a working day. Planting, reporting and scoring use no AI.
- **The bugs are ours.** They are realistic: each one passes the existing tests, and the ticket describes only the symptom. But we designed them, so the pilot measures the agent on bugs we know. A real project measures the bugs we do not know.
- **A person still merges.** A fix PR left open leaves its bug on `main`. Later cases still apply if they change other code.
- **One machine.** The schedule, the watcher and the apps run on this machine, until the team machine of decision 6 in AUTONOMY_AND_NEXT exists.
