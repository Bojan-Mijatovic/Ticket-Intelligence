# The pilot: MediVax

Status: **Running since 2026-11-13** · Owner: Bojan Mijatović · Builds on: [AUTONOMY_AND_NEXT.md](AUTONOMY_AND_NEXT.md) (decision 1, the pilot project), [REDACTION.md](REDACTION.md) (R-02)

## Why

Everything measured so far comes from demo data, and mostly from the agent fixing its own analyses. Continuous evaluation (AI1) needs a steady flow of tickets the agent has never seen, with a known right answer. No real pilot project has been chosen yet. This demo pilot starts the measurement now and runs until a real project replaces it.

Every case has an **answer key**: the commit that broke the code, the file, and the people who know that code. So the pilot measures for the first time whether the agent finds the **culprit**, through its analysis and its bisect, and not only the right file.

## What runs

| When | What | Who |
|---|---|---|
| working days at 10:00 and 15:00 (`agent.config.json` → `VAX.pilot`) | a developer's change is pushed to MediVax `main`: a Jira story (Done) and one commit by the developer. Inside the change is a bug. First the existing tests of that side run (Maven, or `ng build` and Playwright), as CI would. A case they catch is dropped | `demo/pilot.mjs` (plain code) |
| 1 to 3 hours later | a user reports the symptom in Jira as a `[BE]` or `[FE]` bug, quoting a patient the way real tickets do (name, fiscal code, sometimes birth date, phone, health card) | `demo/pilot.mjs` |
| within minutes | analysis, "already known?", reproduction test, bisect, fix, draft PR, AI review: the agent does what it does for any ticket | the agent (watcher) |
| later | merge or close the PR | a person |
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

`node demo/pilot.mjs check` checks each case without pushing anything: it must apply to `main`, and the existing tests must miss it. All 7 passed this check on 2026-11-13. Seven cases last about four working days, so the catalog has to grow. A case already used can come back later as a regression once its fix is merged, but only if the fix's regression test does not catch it.

## Commands

```
node demo/pilot.mjs status                 the cases so far, their scores, what comes next
node demo/pilot.mjs check [--case id]      dry run: does each change apply, do the tests miss it
node demo/pilot.mjs plant [--case id]      push the next change now
node demo/pilot.mjs report [--case id]     report a pushed case's bug now
node demo/pilot.mjs tick                   what the schedule runs every 30 minutes
node demo/pilot.mjs schedule --install     install the schedule (--remove to stop the pilot)
```

The app itself: `node demo/run-mediagenda.mjs --project VAX` (backend :8084, frontend :4204). Repository: `Bojan-Mijatovic/MediVax` (private), built by `node demo/make-project.mjs medivax` from `demo/src/medivax/`. Jira project: VAX.

## Costs and limits

- **Cost.** About $1 to $2 of model use per case (analysis, fix, review), so $40 to $80 a month at two cases a working day. Planting, reporting and scoring use no AI.
- **The bugs are ours.** They are realistic: each one passes the existing tests, and the ticket describes only the symptom. But we designed them, so the pilot measures the agent on bugs we know. A real project measures the bugs we do not know.
- **A person still merges.** A fix PR left open leaves its bug on `main`. Later cases still apply if they change other code.
- **One machine.** The schedule, the watcher and the apps run on this machine, until the team machine of decision 6 in AUTONOMY_AND_NEXT exists.
