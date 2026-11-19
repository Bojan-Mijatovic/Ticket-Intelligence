# Plan: the presentation, 17 minutes, how the app works

Status: **Built 2026-11-18** (`?present`, `?present&voice`, `?notes`, `?deck`; 313 tests; walked through in a browser, all 30 steps, no error) · Date: 2026-11-18 · Owner: Bojan Mijatović · Builds on: [HOW_IT_WORKS.md](HOW_IT_WORKS.md), [DEMO_SCENARIO.md](DEMO_SCENARIO.md), [SYSTEM1_PLAN.md](SYSTEM1_PLAN.md), the dashboard's presentation (`agent/dashboard/slides.js`, `tour.js`)

## 1. Decisions (2026-11-18)

| # | Question | Decision |
|---|---|---|
| 1 | Who speaks | **both**: the presenter live (presenter mode, → moves on) and the browser's voice (a voiced run, e.g. for a recording); one text serves both |
| 2 | Length | **17 minutes at most**, questions after |
| 3 | The example | **the recording of one whole case** (VAX-21, $0), and at the end **one `ti:` question live** in Teams |
| 4 | Audience | **management and developers**: each slide says the what in its title and the how in its body |
| 5 | Language | **English** |
| 6 | Insights | **one slide** in the example, plus a backup slide with the hotspot map. A demo of its own took about 3 minutes (11 steps), which 17 minutes do not have; the dashboard stays open for questions |

## 2. What changes against today's `?present`

| Today | New |
|---|---|
| a step moves on 300 ms after the voice; groups appear while it speaks | presenter mode by default: a slide stays until →; in the voiced run, at least 4 s after the voice, at 0.9× |
| 7 opening slides, 2 of them about the four demo apps | 3 slides on what it is (the third: the life of a ticket in eight steps), 8 on how it works under the hood (4 of them System 1) |
| two cases from 2026-11-06/07 (DEM-36, FAR-19), recorded before System 1, the bisect, the Teams cards and the documentation existed | **one case, whole**: VAX-21 from the pilot (2026-11-16), with every step from the commit to the merged documentation; then **what it caught that people missed**, FAR-19 among it, in one slide |
| System 1 at the very end of the demo, in shadow | System 1 early (slides 5–8), as it is now: five decisions act, two in shadow |
| Teams in one sentence | both Teams cards in the case, the reply in the thread, the digest, and the live question |
| Insights 11 steps, a suggested ticket 4 steps, Ask 4 steps | one slide for the four views, each with its number; Ask shown by the live `ti:` question |
| the Graph tab not shown | the case ends on its lane in the Graph tab |

## 2a. Where the wow is (checked 2026-11-18)

Everything below happened on the suite or the pilot and was checked against the event logs, the saved results, the pilot's score, `node agent/impact.mjs` and the Insights data (`/api/insights`). **M** = what management remembers, **D** = what developers remember.

### In the life of one ticket

| # | The wow | The evidence | For |
|---|---|---|---|
| 1 | **Nobody started it, and the right person's phone rang in under two minutes, with why it is them**: "she authored VAX-20 (6e8e6e1), the regression" | VAX-21: report 16:04:05, Teams card 16:06:03 (1:58) | M, D |
| 2 | **Proof, not an opinion**: a test that fails with the reported dates (due 05/09 instead of 20/11), then a bisect that names the exact commit in 22 s, with one test run | VAX-21 `reproduced`, `bisected` | D |
| 3 | **A tested fix in 5 minutes 19**, every test re-run by the watcher itself, before a developer would have read the ticket; the whole ticket, documentation included, for $2.32 | VAX-21 `fix-notified`, event costs | M |
| 4 | **It knows the history**: "already known: a regression of VAX-5"; BIL-28 found as a duplicate of BIL-23; LAB-30, the same bug in other words, recognised as LAB-8 by System 1 (85 %) and LAB-8's test run on main within 5 minutes | `prior-art` events; [SYSTEM1_PLAN.md](SYSTEM1_PLAN.md) section 12 | D, support |
| 5 | **It writes down what it learnt, honestly**: the knowledge entry marks each cause **confirmed** or **assumed**, names the test that guards it, and every later analysis reads it | MediVax `docs/knowledge/scheda-e-dosi.md` | D |
| 6 | **It asks before it spends**: a half-written report asked back in 4 s, in Italian, never for a patient's name; a user question answered with a note in 1 s, with no Claude run | BIL-28, BIL-27 | M, support |

### What it caught that people missed

| # | The wow | The evidence | For |
|---|---|---|---|
| 7 | **A cause in another app, on a patient-safety check**: no kidney warning for metformin, because MediLab changed the creatinine unit; the eGFR came out 269 instead of about 28. Found in 1:40, fixed as a draft PR in 4:47, for $0.51. The tests were green because a fake of the other app still sent the old unit | FAR-19 (2026-11-07) | M, D |
| 8 | **It caught a cheat**: a developer's change broke an earlier fix and "adjusted" that fix's test so CI passed. The guard ran the test as it was before the commit: an alert 3.4 minutes after the push, 17 hours before the bug was reported | VAX-15 → VAX-17, [PILOT.md](PILOT.md) | D, M |
| 9 | **AI checks AI**: a fix whose tests passed was marked "needs changes" by the reviewer: its browser test passed only because the mock API is more lenient than the real backend. It was merged only together with the backend fix | VAX-19, PR #6 | D |
| 10 | **A fix missing in the copies**: the LAB-13 fix to `GlobalExceptionHandler` is missing in the copies in MediAgenda and MediVax; the patient picker is the same file in three apps, and two of them had the same bug (BIL-17 repeats LAB-19) | `/api/insights/suite` (`shared`), Insights `recurring` | D, architects |

### Without a ticket, for everyone

| # | The wow | The evidence | For |
|---|---|---|---|
| 11 | **"Where is my ticket?" in under two seconds, in Teams**, from the agent's own records, no AI, $0: what happened and what waits for whom | `ti: VAX-21` (1.7 s); `ti: VAX-23` read on 2026-11-18 | M, support |
| 12 | **Paste a page's address, get its code**: the route, the component, the API calls and the controller method with its line, in 80–300 ms | FR-93 | D, support |
| 13 | **Ask in Serbian, get Serbian**: "ko je poslednji radio na ovom?" in the Teams channel, answered in Serbian from the code, the commits and Jira | event `teams-answered`, 2026-11-17 15:56 | M |
| 14 | **67 % of questions need no AI**; when the answer is not there it says "not found", and the researcher checks the code too before it calls it a real gap | Ask on the Impact tab (79 questions); `research` events | M |
| 15 | **Where bugs come from**: in MediLab a bug stays 67 days in the code before it is reported (median); only 2 of MediVax's 8 backend services have a unit test; in MediBill one person alone knows the shared code | Insights `origins`, `testCoverage`, `busFactor` | M, architects |

### Measured, not claimed

| # | The wow | The evidence | For |
|---|---|---|---|
| 16 | **7 of 7** pilot bugs with a hidden answer key: the file, the breaking commit, the owner, a verified fix, an exact bisect | `demo/pilot.mjs status` | M |
| 17 | **45 of 45** bugs people fixed, replayed as if new: a file of the real fix named every time; the owner 37 of 45 | AI1b replay | M, D |
| 18 | **112.8 hours saved for $42** over 62 tickets, by the team's own estimates per step (the page says they are estimates; the cost of the fixes before 2026-11-13 was not recorded) | `node agent/impact.mjs` | M |
| 19 | **0 writes outside the policy**, 307 automated tests | event logs, `node --test agent/test/` | M |

### It runs itself

| # | The wow | The evidence | For |
|---|---|---|---|
| 20 | **The morning digest writes itself**: at 08:00 what it did, what came back, what waits for whom, the cost | `state/digests/2026-11-18.md` | M |
| 21 | **It looks after its own work**: open fix PRs checked again whenever main moves; documentation PRs merged in any order and by themselves after 24 h; a light path that turns out wrong switches itself back to shadow; a restart waits for the job in progress | merge-check events (VAX-23, VAX-25); `docs-merged` LAB-24; [HOW_IT_WORKS.md](HOW_IT_WORKS.md) | M, D |

### Where each one is in the run of show

Three changes, agreed on 2026-11-18, brought the strongest in without adding time: the first-draft slides "what it does" and "the flow in eight steps" became one (slide 3: the life of a ticket *is* the eight steps); a new slide 23, **"What it caught that people missed"**; and the dashboard slide (25) shows numbers instead of descriptions.

| Wow | Slide |
|---|---|
| 1, 2, 3, 5 | the VAX-21 case, 12–22 |
| 4 | 15 (already known: a regression of VAX-5); the rest in a backup slide |
| 6 | 7 |
| 7, 8, 9, 10 | **23** |
| 11 | 26, live |
| 12, 14, 15, 18 | 25 |
| 16, 17, 19 | 27 |
| 20 | 24 |
| 21 | 11 (in words), 28 |

Backup slides for questions: 4 (it knows the history), 13 (Serbian), 17 (the replay in detail), 21 (it looks after its own work).

### As built (2026-11-18)

The run of show below was built as written, with these differences, each from the records:

- **Every number on a slide is read, not written**: `GET /api/tour/facts` (`agent/lib/tour.mjs` `presentationFacts`), `/api/impact`, `/api/ask/stats` and each project's Insights. A slide without its record says less; `test/slides.test.mjs` checks that no slide shows a number it did not read.
- **The guard catch** is 3.4 minutes after the push (the alert's time against the pilot's push), 17 hours before the report; earlier documents round it to "2 minutes".
- **BIL-28** (slide 7): its title is "Problema in cassa", its text "Oggi non va, controllate per favore."; the question it got asks what happens, what they were doing, and where and when (the report named neither), in Italian, as posted.
- **`ti: VAX-21`** (slide 20): 2 s between the question and the answer in the event log.
- **Slides 13 and 21 are slides**, the dashboard steps are 14–19 and 22; the rest of VAX-21's run (the merge, Done, the documentation) plays on the dashboard while slide 21 is shown.
- **`?deck`** shows a timeline of the case instead of its dashboard steps.
- **The notes window** (`?notes`, or **N**) is built: the current step's text, where it is, what comes next, ← and →.

## 3. Run of show

The time in brackets is when the step starts. **Say** is the caption: the voice reads it, the presenter uses it as notes. Every number below was checked on 2026-11-18 against the source named in **From**.

### Part 1: what it is (0:00–1:25)

**1. Title** · slide · (0:00)
- Screen: *Ticket Intelligence*. From a Jira ticket to a reviewed fix, with nobody starting it. Presenter, date.
- Say: "Hi. This is Ticket Intelligence: an agent that reads every new Jira ticket, finds the code behind it, proves the bug with a test, proposes a fix, and tells the right person in Teams. In seventeen minutes: what it is, how it works under the hood, one real case from start to end, and one question live."

**2. The problem** · slide · (0:15)
- Screen: "I opened a ticket. What is the status?" and the five things an engineer does by hand, one short line each.
- Say: "Customers ask one question every day: what is the status of my ticket? To answer it, an engineer reads the ticket and its history, looks for earlier tickets like it, finds the code and what changed there, works out who knows it, and hands it over. By hand, and hardest for someone new to the project."

**3. The life of a ticket, in eight steps** · slide · (0:45)
- Screen: the eight steps as one line, each with what happens to the ticket: 1 **Pick & mask** (reported; personal data masked) · 2 **System 1** (read in a second) · 3 **Analysis** (understood: cause, code, owner) · 4 **Act** (the right person told in Teams) · 5 **Prove & fix** (a failing test, the commit that broke it, a fix) · 6 **Review & approve** (a second AI, then a person) · 7 **Learn** (written into the knowledge base) · 8 **Guard** (it does not come back). Under it: *plain code collects and acts · a small local model decides fast · Claude reasons and writes · a person approves and merges*.
- Say: "This is the life of a ticket, in eight steps, and nobody has to start it. It is picked, and its personal data masked. A small local model reads it in a second. Claude works out the cause, the code and the owner, and the right person is told in Teams. When the bug is clear, a failing test proves it and it is fixed. A second AI reviews the fix, and a person approves it. Then the agent writes down what it learnt, and guards against it coming back."

### Part 2: how it works under the hood (1:25–7:10)

From here on, the eight steps of slide 3 stay as a small map at the top of each slide, with the current step lit.

**4. Architecture** · slide · (1:25)
- Screen: the watcher in the middle. Around it: Jira (checked every 30 s), git or SVN, GitHub, the dashboard, and Teams with two arrows (out: cards by webhook; in: questions and replies by Microsoft Graph). Inside it, three layers: **plain code** (facts, checks, every write), **System 1** (on this machine, about a second, $0), **Claude = System 2** (read-only: reasons and writes text). A band: *The model never writes. The watcher does, only what `policy.json` allows: 27 actions, each auto, draft or off.*
- Say: "Under the hood there is one program, the watcher, in plain Node.js. It checks Jira every thirty seconds and talks to git or SVN, GitHub and Teams, in both directions. Inside, three layers. Plain code collects the facts, checks every result and does every write. System 1, a small model on this machine, decides fast and for free. Claude, System 2, reasons and writes, but cannot change anything: the watcher acts, and only what the policy allows."
- From: `agent/policy.json` (27 actions), [HOW_IT_WORKS.md](HOW_IT_WORKS.md) section 2.

**5. System 1: how it answers** · slide · (2:05)
- Screen: left, *a fine-tuned Laya: a multilingual encoder, on this machine's CPU*. Middle: text → encoder → one head per question → our options, each with a probability. Right: VAX-21's real answers as bars: bug in code 84 %, backend 46 %, Scheda e dosi 65 %, urgent 52 %, no known issue 88 %, tells what is wrong 97 %, names the screen 96 %, no person named 97 %; 3.2 s.
- Say: "System 1 is the newest part. It is a small open model, Laya, fine-tuned on our tickets, running on this laptop's processor. It does not write text. For each of its questions it picks one of our answers and says how sure it is: eleven questions about a ticket, one about questions people ask. Here is a real ticket: a bug in code, eighty-four percent; the screen named, ninety-six; no patient named, ninety-seven. Three seconds, nothing sent out, no cost."
- From: the `system1` event of VAX-21 (2026-11-16 16:05:12 UTC); `state/system1/models/ft-5/questions.json` (12 questions).

**6. System 1: what it decides** · slide · (2:50)
- Screen, a table:

  | Decision | What it does | State | Way back |
  |---|---|---|---|
  | Ask the reporter | a report about code that does not say what is wrong or where gets a question in Jira, in its language; the analysis starts on the answer | acts | after 24 h it is analysed anyway |
  | Light path | a ticket not about code gets a short comment instead of an analysis | acts | the reporter's reply gets the full analysis; one miss sends it back to shadow |
  | Queue order | urgent tickets first | acts | only among tickets waiting together |
  | Known issue | the same problem in other words; its regression test runs on main | acts | Claude still analyses |
  | Ask router | "who knows X" answered by plain code, no Claude | acts | *Ask Claude instead* |
  | Privacy hold | a name the masking missed | shadow | — |
  | Fix warm-up | prepare less for a ticket not about the frontend | shadow | — |

- Say: "What it decides. Seven decisions, each with its own switch. Five act today: asking the reporter, the light path, the queue order, a known issue in other words, and fast answers in Ask. Two only say what they would do: the privacy hold, which missed a name on a pilot ticket, and the fix warm-up. Every decision that acts has a way back, in the last column."
- From: `agent/policy.json` → `system1`; [SYSTEM1_PLAN.md](SYSTEM1_PLAN.md) section 8.

**7. System 1: two real cases** · slide · (3:35)
- Screen, two columns. **BIL-28** "Problema in cassa · Oggi non va, controllate per favore." → System 1: unclear 67 % → 4 s later, in Jira: *"Buongiorno, per analizzare la segnalazione ci servono ancora alcune informazioni: Che cosa succede esattamente (il messaggio, il valore) e che cosa si aspettava? Che cosa stava facendo quando è successo? Dove e quando …? Ci basta il numero, non il nome del paziente."* → the reply starts the analysis → duplicate of BIL-23. **BIL-27** "Come si ristampa una ricevuta già emessa?" → user question 97 %, not code 95 % → light path: a comment in 1 s, no Claude run → the reporter replied → the full analysis.
- Say: "Two real cases from the billing app, yesterday. 'It does not work today, check it.' Four seconds later the reporter is asked, in Italian, what is wrong and where; never for a patient's name. The answer started the analysis, which found it was a duplicate. And 'how do I reprint a receipt?': a user question, ninety-seven percent. A short comment in one second, and no Claude run. When the reporter replied, the full analysis ran."
- From: events of BIL-27 and BIL-28 (2026-11-17 19:41–19:48 UTC); the templates in `agent/lib/system1.mjs` (`askReporterText`, `triageComment`).

**8. System 1: how it learns** · slide · (4:15)
- Screen: a loop: Claude's analyses label the training rows (*System 2 teaches System 1*) → a new version is trained → scored with the current one on tickets it never saw → kept only if no question is worse and no code bug takes the light path → new decisions start in shadow → one miss switches a decision back. Beside it, the last change: `ft-5` replaced `ft-2` with *what is wrong* 54 → 96 %, *names the screen* 33 → 92 %, *privacy* 65 → 100 %, no code ticket on the light path.
- Say: "How it learns: Claude teaches it. Every analysis becomes a labelled example. A new version is trained, and scored against the current one on tickets it never saw. It replaces it only if no answer gets worse, and if it never sends a code bug down the light path. The last one more than doubled how well it sees what a report leaves out. New decisions start in shadow, and one that turns out wrong switches itself back."
- From: `state/system1/models/current.json` (ft-5 replaced ft-2, 2026-11-16).

**9. Claude's analysis** · slide · (4:50)
- Screen, three columns. **Collected by code**: the ticket, its comments, history and screenshots; related tickets by three Jira searches; the commits that name them; a code search for the ticket's clues; the people ranked by what they did; the knowledge base. **Answered by Claude**: *Already known?* (duplicate, in progress, fixed on main, regression, solved before, documented); the cause with file and line; the owner and why; the confidence. **Checked by code**: valid JSON; every ticket, commit and file it cites exists.
- Say: "Step three, the analysis. A script gathers the facts first: the ticket, related tickets, the commits that touched that code, who worked on it, and the team's knowledge base. Claude reads that bundle and opens the code itself, read-only. Its first answer is: is this already known? A duplicate, already fixed, or a regression of an earlier fix. Then the cause with file and line, the owner and why, and how sure it is. Code checks every source it cites."

**10. Prove, fix, review, approve** · slide · (5:35)
- Screen, a chain: a test written from the ticket → it must **fail** on main (the watcher runs it) → **bisect**: the exact commit that broke it → the smallest fix (tests may not change) → the watcher re-runs every test and the build → draft pull request, evidence in Jira → Teams: *fix ready* → AI review (read-only: risk, findings) → the owner replies **approve** or **reject: why** → a merge check each time main moves → **a person merges**.
- Say: "When the analysis is sure, the agent proves it. It writes a test from the ticket, which must fail on today's code. A bisect then finds the exact commit that broke it. The fix may not touch the tests, and the watcher re-runs everything itself before it opens a draft pull request. A second AI reviews it. The owner approves or rejects it with one reply in Teams, and merging always stays with a person."

**11. Learn and guard** · slide · (6:20)
- Screen, three blocks. **Learn**: on Done, a knowledge entry (symptom, cause, fix, who knows it, the regression test), checked by a lint, merged in any order and by itself after 24 h unless held, read by every later analysis and by Ask. **Guard**: every commit on main that changes lines of an earlier fix runs that fix's test; the pilot's planted regression was caught 3.4 minutes after the push, 17 hours before its ticket. **While nobody looks**: every night every known issue's test and the backlog, at most $5; at 08:00 a digest in Teams; the questions Ask could not answer get researched.
- Say: "Then it learns. When a ticket is done, it writes what happened into the project's knowledge base, with the test that proves the fix, and every later analysis reads it. It guards: a commit on main that touches an earlier fix runs that fix's test, so a regression is caught before a customer sees it. And at night it runs every known issue's test and the backlog, within five dollars, and at eight it posts a digest in Teams."
- From: [PILOT.md](PILOT.md) (VAX-15/VAX-17), `agent.config.json` → `nightShift`.

### Part 3: one case, whole: VAX-21, and what else it caught (7:10–13:45)

A recorded run, replayed on the dashboard (MediVax), marked REPLAY; nothing is paid. Times are from the report (2026-11-16 16:04 UTC).

**12. The case** · slide · (7:10)
- Screen: the pilot in three lines: a fifth app with synthetic patients; every working day a developer's change with a hidden bug goes to main, its bug is reported later; the answer key is hidden from the agent. This case: Irene Fabbri's commit `6e8e6e1`, *"VAX-20: take the last dose without sorting again"*: 22 backend tests pass; the regression guard: *touches no earlier bug fix*.
- Say: "Now one real case, whole. It comes from our pilot: every working day a developer's change with a hidden bug goes to main, and the bug is reported later, like in real life; the agent never sees the answer. This change by Irene Fabbri tidied the code that finds a patient's last dose. All tests passed, the guard had nothing to say. The bug is inside."
- From: `state/projects/VAX/pilot/state.json` (interval-from-first), the `guard` event of 14:09:53 UTC.

**13. The report, masked** · dashboard, Tickets · (7:35)
- Screen: the card of VAX-21, *[BE] - Scheda paziente: the third ESA dose is due too early*, High. Beside it, before and after the masking: *"The card of De Luca Laura (CF DLCLRA26D68F205F, 28/04/2026)"* → *"The card of [PERSON_1] Laura (CF [FISCAL_CODE_1], [BIRTH_DATE_1])"* (a synthetic patient).
- Say: "A nurse coordinator reports: the third dose of a vaccine is due too early, and the card marks it late. The report names the patient, her fiscal code and her birth date. Before any model reads it, they are masked."
- From: the bundle `work/VAX-21/ticket-VAX-21.json` (masked text), the pilot's `identifiers` (3 of 3 masked).

**14. System 1 reads it** · dashboard, the card's ⚡ strip · (8:00)
- Say: "System 1 reads it the moment it is picked: a bug in code, the patient card, urgent. The report says what is wrong and where, so nobody needs to be asked, and it is about code, so no light path. On to Claude."

**15. The analysis** · dashboard, the card · (8:20), at 1:57
- Screen: high confidence; *Already known: regression of VAX-5*; the cause at `Schedule.java:28`; owner Irene Fabbri and why; *internal analysis posted to Jira*.
- Say: "Fifty seconds later, the analysis, with high confidence. Already known: a regression of VAX-5, the story that got this right. The cause: the new code takes the first item of the list as the last dose, but the list comes oldest first; line twenty-eight of Schedule.java. The owner: Irene Fabbri, because her commit brought it in. It is posted to Jira as an internal comment."
- From: `work/VAX-21/result.json`, events `analyzed`, `prior-art` (16:06:02).

**16. Teams, first card** · dashboard, the Teams panel · (8:55), at 1:58
- Screen: *For @Irene Fabbri* · the handoff · **Why you**: *She authored VAX-20 (6e8e6e1), the regression* · **Where**: `Schedule.java:28` · **Confidence**: high · Open in Jira.
- Say: "In the same second, Irene gets this in Teams, mentioned by name, so her phone rings: what is wrong, why it is her, where to look, how sure it is. One minute fifty-eight after the report, and nobody forwarded anything."
- From: the `notified` event's card (16:06:03).

**17. The proof: test and bisect** · dashboard, the card · (9:20), at 3:33 and 3:56
- Say: "Then the proof. The agent writes a backend test from the ticket: on today's code it fails exactly as reported, the fifth of September instead of the twentieth of November. A bisect then runs that test through the history: broken by Irene's commit, found in twenty-two seconds. Not a guess."
- From: events `reproduced` (16:07:38), `bisected` (16:08:01: one test run, 22 s).

**18. The fix and the second card** · dashboard, the card and the Teams panel · (9:55), at 5:15 and 5:19
- Screen: *backend 24 tests ok*; draft PR #7; the card *fix ready for review*: a new test failed before the fix and passes after it, 24 backend tests pass, broken by `6e8e6e1` (VAX-20) by Irene Fabbri, **Review the pull request**.
- Say: "The fix is one line: find the latest dose again. The watcher runs all twenty-four backend tests itself, then opens a draft pull request and posts the evidence to Jira. Five minutes nineteen after the report, Irene gets a second message: the fix is ready for her review."
- From: events `verified`, `pr`, `fix-notified` (16:09:15–16:09:24).

**19. The AI review** · dashboard, the card · (10:25)
- Say: "A second AI reviews the pull request, read-only: low risk, and one honest finding: the new tests would not notice a later change that works for only one order of the list. It never approves or merges."
- From: the `reviewed` event (risk low, looks-good, 1 finding).

**20. Answering in Teams** · slide, the channel drawn from the recorded events · (10:45)
- Screen: the *fix ready* card; under it **approve**, and the agent's reply *"PR #7 is ready for review"*, Jira: *Fix approved in Teams by …*; then a new post **`ti: VAX-21`** and its answer in the thread, from the agent's records, in 1.7 s, no AI: *What happened … draft PR #7 opened: now merged … Teams message to Irene Fabbri: fix ready for review*.
- Say: "In Teams the owner answers the card. 'Approve' makes the pull request ready for review and notes it in Jira; 'reject' with a reason sends the agent back to fix it again. And anyone can ask in the channel: 'ti: VAX-21' was answered in under two seconds, from the agent's own records, with no AI and no cost."
- From: the `ti: VAX-21` answer in `state/projects/VAX/asks.jsonl` (origin teams, 2026-11-17). **The approve part has not run live yet**: until it has (section 5), the slide labels it *built, first live round pending*; once it has, the slide draws the real events.

**21. Merged, then learnt** · dashboard, the card, then the knowledge entry · (11:20)
- Screen: merged by a person at 16:54 (`08b2cca`), the guard on the merge commit clear; Done at 17:04; at 17:16 the documentation PR; the entry *"VAX-21: Next dose due too early: counted from the first dose"*: symptom, root cause (**confirmed**), fix, how to verify, **Test**: `Vax21RegressionTest.java`; merged into main (PR #10).
- Say: "A person merged it fifty minutes after the report. When the ticket moved to Done, the agent wrote the knowledge entry: the symptom, the confirmed cause, the fix, how to verify it, and the test that guards it. From now on every analysis of this code reads it, and that test runs every night."
- From: events `guard` (16:54:47), `resolved`, `documented`, `docs-merged`; MediVax `docs/knowledge/scheda-e-dosi.md` on main.

**22. The whole story on one line** · dashboard, Graph tab, VAX-21 · (11:55)
- Say: "And the whole story on one line: the Graph tab shows the ticket's lane, from the report to the merged documentation, each step with its time and its link. The same tab shows how often the agent was right, compared with what really happened."

**23. What it caught that people missed** · slide, four tiles · (12:20)
- Screen, each tile one sentence and one number:
  - **A cause in another app, on a safety check** (FAR-19): no kidney warning for metformin, because MediLab changed the creatinine unit; the eGFR came out 269 instead of about 28. Found in 1:40, a draft fix in 4:47, $0.51. The tests were green: a fake of the other app still sent the old unit.
  - **A cheated test** (VAX-15): a change broke an earlier fix and "adjusted" its test so CI passed. The guard ran the test as it was before the commit: an alert **3.4 minutes** after the push, 17 hours before any report.
  - **AI checks AI** (VAX-19): the fix's tests passed, the reviewer said **needs changes**: its browser test passed only against a mock more lenient than the real backend.
  - **A fix missing in its copies** (LAB-13): fixed in MediLab, missing in the same code in **2** other apps.
- Say: "One case shows the flow. These four show what it finds that people miss. A kidney warning missing for a diabetes drug: the cause was another app, which changed a unit, found in under two minutes while every test was green. A developer who adjusted a failing test so the build passed: caught three minutes after the push, before anyone reported it. A fix whose tests passed, sent back by the AI reviewer. And a fix made in one app and missing in two copies of the same code."
- From: FAR-19 events (2026-11-07 14:49–14:53 UTC); [PILOT.md](PILOT.md) (VAX-15/VAX-17, VAX-19 and PR #6); `/api/insights/suite` → `shared` (`GlobalExceptionHandler.java`: the LAB-13 fix to check in DEM and VAX).

**24. The next morning** · slide, the digest card · (13:00)
- Screen: the digest of 2026-11-18: 5 tickets analysed (1 on the light path, 1 asked back, 3 already known), 2 draft fix PRs, 2 AI reviews, 1 documentation PR merged on its own, 2 gaps researched, 2 Teams questions answered; waiting: 2 fix PRs to review (17 h, 20 h); $5.53.
- Say: "Every working morning at eight the team gets this in Teams: what the agent did, what came back, and what waits for whom. This is this morning's: five tickets, two fixes waiting for review, five dollars fifty."
- From: `state/digests/2026-11-18.md`.

**25. The dashboard around it** · slide, four tiles, each with its number · (13:20)
- Screen: **Insights**: where bugs come from, hotspots, who knows what · *in MediLab a bug stays **67 days** in the code until it is fixed (median, from the change that brought it in)*. **Ask**: plain-language questions, from the records, by plain code or by Claude with sources · ***67 %** answered with no AI; a page's address → its code in **0.3 s***. **Graph**: every ticket's lane, how often the agent was right. **Impact**: the management week · ***112.8 hours** saved for **$42**, by the team's own estimates*.
- Say: "Around every ticket, the dashboard has four views. Insights shows where bugs come from: in the lab app, a bug stays sixty-seven days in the code until it is fixed. Ask answers two questions out of three with no AI at all, and turns a page's address into its code in a third of a second. Graph shows every ticket's story and how often the agent was right. And Impact: a hundred and twelve hours saved for forty-two dollars, by the team's own estimates."
- From: `/api/insights?project=LAB` (`origins.medianDaysInCode` 67); Ask on the Impact tab (79 questions, 67 % without an AI run); FR-93 (80–300 ms); `node agent/impact.mjs` (2026-11-18).

### Part 4: live (13:45–14:45)

**26. One question, live** · slide *"Live, in Teams"*, then the phone or the second laptop on `support-triage` · (13:45)
- The presenter types **`ti: VAX-23`** in the channel. The answer comes in the thread within the poll interval (5 s) and about 2 s: what happened to VAX-23, and **Now**: *waits for a person: review and merge PR #15 (AI review: risk low); merge check still green*.
- Say (the presenter, in their own words): "Let me ask it live, where the team works. 'ti: VAX-23.' … A ticket from yesterday: analysed, reproduced, fixed, reviewed, and now waiting for Tommaso's review. No dashboard, no AI, no cost."
- In the voiced run the voice stops on this slide; the presenter asks, then → moves on.
- Fallback, no answer within 20 s: the dashboard's Ask, type `VAX-23` (the same answer from the records), or back to slide 20.
- From: the same `ticketStatus` the Teams inbox uses, run on 2026-11-18 (read only).

### Close (14:45–16:45)

**27. Results** · slide · (14:45)
- Screen, target → result: analysis in Jira < 5 min → **56 s** on average (84 analyses), the owner's phone **1:58** after the report · cause right ≥ 60 % → pilot **7 of 7** (the file and the breaking commit), replay **45 of 45** files · owner ≥ 70 % → pilot **7 of 7**, replay **37 of 45**; acceptance needs real tickets · writes outside the policy → **0** · cost → **$0.32** an analysis, **$1–2.50** a whole bug with the fix and the review.
- Say: "Against the targets set before any code: an analysis in under a minute on average, the owner's phone ringing in under two. On the pilot, where the answer is known, seven bugs out of seven: the right file, the commit that broke it, the right person. Replayed on forty-five bugs people fixed, the right file every time. Nothing written outside the policy. About thirty cents an analysis, one to two and a half dollars for a whole bug."
- From: event logs (2026-11-18), `demo/pilot.mjs status`, [AUTONOMY_AND_NEXT.md](AUTONOMY_AND_NEXT.md) (AI1b).

**28. What stays with people** · slide · (15:25)
- Screen: **never**: merge, priority, status · **a person decides**: approve or reject a fix, the assignee, any reply to the customer (the agent itself only asks what a report leaves out, and says when it took the light path) · **acts and reports, with a way back**: the Jira comment, Teams messages, the question to the reporter, the light path, the documentation after 24 h, the night · patient data masked before every model · everything logged.
- Say: "What stays with people. It never merges and never changes a ticket's priority or status. A person approves every fix, chooses the assignee and sends every reply to the customer. What it does alone, it reports, and every one of those steps has a way back. Patient data is masked before any model, and every step is logged."

**29. Limits and next** · slide · (15:55)
- Screen, limits: company tickets need an approved AI service and the DPO's approval · GitHub Copilot not tried yet · on SVN, the analysis only · the approval from Teams not yet run live · the team's own channel needs IT. Next: the approval round live · a trust ladder that raises and lowers the agent's autonomy from its record · release notes and the reply to the customer after the merge · a pilot on a company project.
- Say: "The limits. Company tickets need an approved AI service and the data protection officer's approval. Copilot reads the same skills but is not tried yet; on SVN the analysis works, the fix is git only. Approving in Teams is built but not yet run live. Next: that round, a trust ladder for the agent's autonomy, release notes and a reply to the customer after the merge, and a pilot on a company project."

**30. Thank you** · slide · (16:30), until the end
- Say: "That is Ticket Intelligence: tickets understood in minutes, the bug proven with a test, a fix proposed and reviewed, the right person told, and the knowledge kept. Thank you. Questions?"

About 16:45, with 15 s to spare. **Backup slides** (after the end, → only): patient data; what if it is wrong; cost; Copilot and SVN; does every ticket need Claude (System 1's numbers); Teams at the company (IT, the bot); Insights with the hotspot map; the autonomy levels L0–L3.

## 3a. Review 2 (2026-11-18): pauses, scrolling, and what the app is

What the owner saw in the voiced run, and what a measured run in a browser (1440×860, captions only, every 250 ms) found.

**Done the same day, measured again:** the pause after a slide 1.3–1.6 s and after a dashboard step 2.6–2.7 s (was 4 s everywhere); the Graph step speaks after 2.9 s (was 11.1 s); on every dashboard step the lit part was **in view 100 % of the time** (was out of view up to 18 %); each case step plays its replay first (2–6 s of the run streaming on the card), then speaks. Three new slides in Part 1 (*What it is*, *Before and after*, *What you get*) and *Why it is different* at the start of the close; the dashboard tiles became a backup slide; the fix and its review are one step. 32 steps; the voiced run checked by the test at under 17 minutes.

### 1. The pauses are long

| Where | Measured | Why |
|---|---|---|
| after every step | **4.0 s** of silence after the voice, on all 25 steps measured | the `dwell` added in the first build (`full ? 4000 : 300` in `play()`), against "it changes too fast" |
| the Graph step (22) | **11.1 s** before the first word | the step opens the Graph tab and waits for the lanes to load (`until(hasContent('graph-lanes'), 20000)`) before it speaks; the graph is computed on first use |
| dashboard steps 14–19 | the voice starts at once (0–0.9 s) | not a pause, but the cause of problem 2 below |

**Proposed.** After a slide **1.5 s**, after a dashboard step **2.5 s** (time to look at what is lit), nothing between steps of the same chapter that need no reading time. The Graph step speaks while the lanes load, and the presentation asks for the case's graph at its start, so it is ready (cached) by step 22. Presenter mode keeps no pause at all: → decides.

### 2. The view does not follow the demo (manual scrolling)

Seen in the screenshots at the start of each dashboard step:

| Step | What the voice says | What the screen shows |
|---|---|---|
| 15 the analysis | "49 seconds after it was picked, the analysis … the owner: Irene Fabbri" | still the System 1 strip; the analysis is not on the card yet (the replay is still streaming the analysis) |
| 17 the proof | "the test fails exactly as reported … bisect" | the analysis' steps and System 1; the reproduction box is below the visible part; the light is on the whole card, 18 % of the time out of view |
| 16 Teams | "Irene gets this in Teams" | the whole Teams panel lit (taller than the screen); the card's end (Where, Open in Jira) needs the panel's own scrollbar |

Three causes in `tour.js`:

1. **The voice starts before the replay reaches what it talks about.** A step's replay (`play`) and its voice start together; the analysis, the test, the fix appear seconds later.
2. **When the target is not there yet, the light falls back to the whole ticket card** (`rowOf(…) ?? ticketEl(kc)`, `boxOf(…) ?? ticketEl(kc)`): a card taller than the screen, scrolled to its top. When the real target appears, the light moves to it (`follow()` looks it up every frame), but **the page does not scroll**: `bringIntoView` runs only when the step starts and after its replay ends.
3. **Panels with their own scrollbar** (the Teams panel, a card's step list) are not scrolled at all; only the window is.

**Proposed.**
- On the case's dashboard steps, **replay first, then speak**: the step plays to the event it talks about (at a quicker pace: a twentieth of the real time, at most 0.6 s between two events, so about 3–6 s), and only then the voice starts (in presenter mode: the presenter sees it arrive, then speaks).
- **The view follows the light**: when the lit element changes or leaves the space between the header and the caption bar, it is scrolled into view, inside its own panel first (`scrollIntoView`, nearest), at most once a second.
- **Precise targets**: the analysis' *Likely cause* row, the reproduction box, the review box, the newest Teams card itself (not the whole panel); while one is not there yet, the ticket's header line, not the whole card.
- A check in the browser test: on every dashboard step, the lit part at least 70 % in view for 90 % of the time.

### 3. What the app is, and what it is good for, is not clear to an observer

The slides explain the problem (2), the process (3) and then the machinery (4–11). Nowhere does a slide say, in plain words, **what Ticket Intelligence is**, **what it does for each person**, and **why it is better than today**. An observer meets "System 1", "shadow", "bisect" and "worktree" before they know what they get. The benefits are scattered (a number on slide 25, another on 27) and the close starts with a metrics table.

**Proposed, in Part 1 (no jargon; numbers from the records):**

| New slide | Says |
|---|---|
| **What it is** | One sentence: *an AI colleague for the support and development team: for every new Jira ticket, without anyone starting it, it does the first hours of an engineer's work in minutes: it finds the cause in the code, tells the right person, proves the bug with a test, proposes a tested fix, and keeps what was learnt.* Under it: *not a chatbot: it works on its own, in the tools the team already uses (Jira, GitHub, Teams), and a person approves.* |
| **Before and after** | one ticket's work, step by step, by hand and with it: understanding the ticket and its history (hours → under a minute); who should take it (asking around → the right person @mentioned with why, 1:58); reproducing the bug (an afternoon → a failing test, 3:33); what broke it (a guess → the exact change, 22 s); a fix (a day → a draft PR, tested and reviewed, 5:19); the knowledge (in someone's head → written with its test); the same bug again (found by the customer → caught before, 3.4 min after the push); "what is the status?" (a meeting → 2 s in Teams) |
| **What each role gets** | **Support**: the status of any ticket in 2 s in Teams; half-written reports asked back in seconds. **Developers**: the cause with file and line, a failing test, the exact commit, a draft fix to review. **Team leads**: the right owner at once, approve or reject a fix by a reply, a morning digest. **Management**: hours saved and cost per ticket, where bugs come from, who knows what. Each with its number |
| **Why it is different** (in the close, before the results) | evidence, not opinion (a failing test, a cited source checked by code); it acts on its own, a person decides; it learns (every fix becomes knowledge with its test; its small model is trained on our tickets); it guards (a broken fix caught before a customer sees it); cheap and fast (cents and minutes); safe (patient data masked, nothing merged by it, everything logged); no new tool to learn |

Also: the title slide's line says what it is (*an AI colleague that takes every new Jira ticket from report to a tested fix*); slide 3 (eight steps) keeps the plain words and moves "System 1" to its own slides; the dashboard tiles slide (25) is folded into "What each role gets"; the close says what you get, then the numbers.

**Timing.** The three new slides take about 2 minutes. They are paid for by the shorter pauses (about 75 s over 30 steps), by folding slide 25 into the roles slide (25 s), and by merging the fix and the review steps of the case (18 and 19, about 20 s). The total stays under 17 minutes; the test's time check covers it.

## 3b. Review 3 (2026-11-18): the dashboard's own tabs, and no money

Asked by the owner after the second run: show Insights, Ask and Impact too, because the app's other possibilities were not seen; leave out what it costs; stay within 17 minutes.

**Built:**

- **Four dashboard steps after *What it caught***, live and read-only, in Part 3. Their numbers are read when they are spoken.
  - **Insights of MediLab:** the bugs by component and month, the hotspots, and how long a bug stays in the code (the median).
  - **Insights' knowledge map:** who knows each part of the code, and the tickets it suggests.
  - **Ask:** the recorded answer to *"Why could …/scadenze miss the doses due on Sunday?"*, replayed. The question is typed, the steps run, and the answer appears with the tickets, commits and files it cites. Nothing is asked or paid now.
  - **Impact:** the management week for the whole suite.
  - Settings: `presentation.insights` (the project) and `presentation.ask` (the question); `GET /api/tour/asks?question=` finds its recorded answer.
- **What made room for them:**
  - *What stays with people*, *The morning digest* and *Around every ticket, four views* moved to the backup slides.
  - The words of four steps are shorter.
- **No money:**
  - Every cost is out of the slides and the voice, the cost row of the results among them.
  - `test/slides.test.mjs` checks every main slide and its words for a `$` amount and for the words cost, cheap, cents and dollars.
  - On the dashboard, `body.no-cost` hides every amount while the presentation runs: the Impact tile, the Impact chart, the cost columns, an Ask answer's price and the app review's price.
  - The backup slide *What does it cost?* stays, for when someone asks.

- **The words "free", "spend" and "budget" are out too** (System 1 "decides fast", no longer "for free"; the System 1 cases slide: *It asks before it analyses, and leaves Claude out where no code is wrong*). The test's word list now has them.

**Measured in a browser** (1440×860, captions only, three runs):

- **Insights speaks 3 s after its step starts** (was 11.6 s). The watcher keeps it two minutes, and read cold it takes 5.4 s; the presentation asks for it on *What it caught*.
- **Impact speaks after 1.6 s** (was 20.9 s).
  - Read cold, it takes 17–30 s: five apps, one by one, and GitHub's pull requests. Each app is kept two minutes on its own.
  - Asked only on the first Insights step, one run still waited 31.5 s: the case's app and the pull requests had expired in between.
  - Now it is asked on each of the three steps before its own, and the step speaks at once in any case: its numbers were read at the start, and the light moves from the tab's title to the tiles when they are there.
- **Ask takes about 10 s before it speaks.** That time is the replay itself: the question being typed, the steps, the answer. While the question is typed, the form is lit; before, the screen stayed dark.
- **The lit part is in view and in place.** It was in view 100 % of the time on every step. In screenshots taken once the view settled, it frames exactly the map, the knowledge table, the answer and the KPIs.
- **The whole run:**
  - Measured part by part, it came to 16.7 minutes with the live minute: what it is 2.9, under the hood 4.2, one case 6.8, live 1, the close 1.75.
  - The last cuts took out about 15 s more (the architecture, how System 1 learns, the analysis), so about 16.4 minutes.
  - The test's estimate is now closer to the browser: 0.9 s more per step, for the voice's start and its sentence gaps. It gives 16.6 minutes.

## 3c. Review 4 (2026-11-18): a first-time viewer — built the same day

A colleague who had not seen the app watched the run. Most of what he missed comes from one thing: **the screen does not follow the voice.** The voice talks about one card, one step or one number, while the screen shows the whole slide or a different number. He also expected Teams to look like Teams, and a developer's change to look like a developer's work. The presentation will be on a TV of unknown resolution.

The owner's decisions:

- the presenter's name off the first slide only;
- both ways stay: the presenter speaks, or the browser does;
- Part 3's step map looks like a repeat of Part 2, so it is replaced;
- Teams drawn as Teams;
- the problem slide gets 3 + 3 points;
- the screen follows the voice on every slide, not only the ones he named.

### Found besides what the viewer said

| What | Where | Why it matters |
|---|---|---|
| **The voice says other numbers than the screen shows** | Impact: the voice says the 8-week totals (63 tickets, 10 fixes, 56 documented, 114 h); the tiles show this week's (16, 4, 6, 30.5 h). Insights: the voice says "17 bugs on the map"; the map's column adds up to 22, because a bug can sit in two parts of the app | a viewer who reads the screen while listening cannot match the two |
| **Empty weeks** | Impact shows 8 weeks; the agent started on 2 November, so 5 of the 8 weeks are zeros, in the chart and in the table | it looks as if nothing happened |
| **At 1280×720 the Teams card is cut** | the case's Teams step: the caption bar covers "Why you", "Where" and the links | 1280×720 is what a 1080p TV gives with 150 % scaling |
| **Dashboard text is small for a TV** | the analysis' *Likely cause* is a 10-line paragraph at 14 px; the Teams message as well | it cannot be read from across a room |
| **The control bar is on the shared screen** | presenter mode hides the captions, but Back/Pause/Next, the parts, the step chips, the voice and speed controls stay | noise on the TV, and 90 px less for the content |

### The plan

**P1. Beats: the screen follows the voice, in both ways of presenting.** This is the core.

- Each slide and each dashboard step gets **beats**. A beat is a part of the screen (a card, a row, a node of the flow, a bar, a message) and the sentence or sentences said about it.
- **Voiced:** the beat changes when its sentence starts. The voice already speaks sentence by sentence.
- **Presenter:**
  - → moves to the next beat, and after the last beat to the next slide; ← goes back a beat.
  - The notes window shows the current beat's words in bold and the rest of the step greyed, so the presenter knows what to say for what is lit.
- **What "lit" means:**
  - The current part gets the accent border and full colour, and comes in with a short animation (a message slides in, a bar fills, a node lights).
  - Parts already said stay, dimmed a little; parts not yet said are faint.
  - The slide stays readable as a whole.
- **On every slide with more than one part:** the problem, what it is, before and after (row by row), what you get, System 1 (bars fill as each one is read, the decisions row by row, the two cases, the learning loop), the analysis (the three cards), prove and fix (node by node), learn and guard, what it caught (tile by tile), the Teams thread (message by message), learnt, why it is different, results, limits and next.
- **On the dashboard steps:**
  - **The analysis:** the cause row, then the owner.
  - **Insights:**
    - the heat map *with its title*;
    - then *Top hotspots*;
    - then *Where bugs come from* (opened; the 67 days are there).
  - **Impact:**
    - what the page is, one sentence;
    - the tiles one by one, this week's numbers as they are on the tiles;
    - the hours chart;
    - the total for the weeks since the agent started.
- **Numbers:** every number said is one that is on the screen at that moment (Impact, and Insights' "17 bugs"). Impact shows only the weeks since the agent started.

**P2. Teams that looks like Teams.**

- **The thread slide is drawn as a Teams channel.**
  - The channel's header and tab, avatars with initials, and the agent's card with its buttons.
  - Replies nest in the thread, with their times.
  - The messages arrive one by one, with the voice: the fix-ready card, Irene's *approve*, the agent's "PR #7 is ready for review", a colleague's `ti: VAX-21`, and the answer 2 s later.
  - Every text is from the records. No Microsoft logo: Teams' colours and layout, and a small line "as posted in the team's channel".
- **The case's Teams step ("the phone rings") becomes a Teams notification, large, over the dashboard.**
  - First the banner: *Ticket Intelligence mentioned you in support-triage*.
  - Then the message as Teams shows it: what is wrong, why you, where, *Open in Jira*. It is the real text of the card.
  - The dashboard's own small panel stays behind it.

**P3. One case: a developer's change, and the case's own clock.**

- **"This change" shows a developer's normal work, step by step:**
  1. the Jira story VAX-20;
  2. the git commit `6e8e6e1` by Irene Fabbri on `main`, with its message and the changed line of `Schedule.java:28` as a small diff;
  3. the CI: 22 backend tests green;
  4. the regression guard: no earlier fix touched;
  5. then *"Green everywhere. The bug is inside."*

  The diff is read from git by `presentationFacts` (plain code, read-only).
- **Part 3 shows its own timeline instead of the 8-step map.** The steps are 0:00 report → System 1 → 0:49 analysis → 1:58 Teams → 3:33 failing test → 3:56 bisect → 5:19 fix ready → merged → documented, with the current point lit and the case's clock running with the replay. It is shown on the case's slides and in the caption bar. Part 2 keeps the 8-step map, where the steps are explained.
- **The masking happens on screen.** The report is shown as written, then the name, the fiscal code and the birth date turn into `[PERSON_1]`, `[FISCAL_CODE_1]` and `[BIRTH_DATE_1]`.

**P4. Made for a TV.**

- **A callout on each dashboard step:** a large card (22 px or more) next to the light, with the 2–4 facts the voice says. For example, for the analysis: *Schedule.java, line 28 · broken by VAX-20, Irene Fabbri · a regression of VAX-5 · high confidence · 49 s*. The dense paragraph stays behind it, for whoever wants to read it.
- **In presenter mode the control bar folds** to a thin line: the progress and the part. It opens on a mouse move or a key.
- **Checked at 1280×720 and 1920×1080 in a browser:** nothing cut, the lit part always whole, no text under the caption bar.

**P5. Small ones.**

- The title slide without the presenter's name (the team stays; the last slide unchanged).
- The problem: 3 points for what an engineer has to do, 3 for who waits today.
- Prove and fix:
  - a short title, smaller: *Proven by a test, approved by a person*;
  - the flow across the whole slide, larger, with its ten nodes in two rows and a small icon each.
- Limits and next, in plain words:
  - approving a fix with a reply in Teams: built, the first real round comes next;
  - more done on its own where its record is good, less where it was wrong;
  - after the merge, release notes and a reply to the customer, for a person to send;
  - a pilot on a real company project, once patient data is approved.

**P6. Checked before it is called done.**

- A browser run in both ways and at both sizes, with screenshots of every beat.
- Tests:
  - every beat's part exists, and the beats match the sentences;
  - no number said that the screen does not show;
  - no cost;
  - the run within 17 minutes.
- The full suite.

**Time.** Beats and animations add no time to the voiced run (they follow the sentences). The Impact sentence on what the page is adds about 8 s, out of a reserve of about 35 s.

**Order** (most effect first): P1 → P2 → P3 → P4 → P5, then P6 on the whole.

### As built

- **P1, beats.**
  - In `slides.js` a step lists its beats, and each slide marks its parts with `data-b`. The dashboard steps have their own beats: `caseBeats` and `viewBeats`, each naming the part it lights (`at`).
  - `tour.js` (`lightBeat`) lights them:
    - with the voice, each beat as its sentence starts;
    - in presenter mode, → lights the next beat and ← the one before;
    - the notes window shows "part n of m" and the beat's words in bold.
  - Every slide with more than one part is said in beats, 23 steps in all.
  - Two corrections came out of it:
    - **Impact** now says this week's numbers as the tiles show them, and the total of the weeks since the agent started. The tab shows only those weeks (3 instead of 8, no zeros); the page's own choice comes back at the end.
    - **Insights** said a bug stays 67 days "before anyone reports it". What it measures is the time from the change that brought the bug in to its fix, and the page says "before the fix". The words are corrected everywhere.
- **P2, Teams.**
  - The thread slide is a Teams channel (`.tm-app`): its posts arrive with their beats.
  - The case's Teams step is `#tour-teams` (`slides.js teamsPop`):
    - first the owner's phone with the notification;
    - then the post as Teams shows it: the first two sentences of the real card, why you, where, how sure;
    - then the same post with its time after the report lit.
  - The fix's message ("fix ready") uses the same post.
- **P3, the case.**
  - *A developer's change* shows the Jira story, then the commit on `main` with its diff (`lib/tour.mjs commitChange`: `git show`, read-only, the file the analysis names), then the CI with 22 tests, then the guard.
  - Part 3 shows the case's own times on its slides and in the caption bar, instead of the eight steps. In the bar a clock runs with the replay: *VAX-21 · 3:56 after the report*, and the times passed turn green.
  - The report's identifiers turn into their placeholders on screen. `maskSwaps` lines up the text as written with the masked one; when they cannot be lined up, the masked text is shown as before.
- **P4, a TV.**
  - Each beat of the case's dashboard steps has a callout (`#tour-callout`), placed on the side away from the light. It holds the facts the beat says: the kind and part of the app, the cause and the commit, the owner and why, the failing test and its dates, the bisect, the tests and the PR, the review.
  - In presenter mode the caption bar folds to one line, 55 px; the controls come back while the mouse moves.
  - No slide scrolls at 1280×720.
- **P5, small ones.** As planned. The words were shortened elsewhere to keep the 17 minutes (the welcome, System 1, the merge, the Graph step, *Next* said short with its full text on the slide).

## 4. Two ways to run it

| | Presenter mode (the default of `?present`) | Voiced run (`?present&voice`) |
|---|---|---|
| Who speaks | the presenter | the browser's voice, at 0.9× |
| Moving on | → (a slide shows all of itself at once) | by itself, at least 4 s after the voice; → still skips ahead |
| The captions | not on the shared screen; in a notes window on the presenter's laptop (`?notes`, kept in step with the slides) | on the screen, as subtitles |
| The replay (slides 13–22) | plays while the presenter speaks; → when it is done | plays while the voice speaks |
| The live question (26) | as written | the voice stops on slide 26 and waits for → |
| Length | about 16:45 at a normal pace | the same text, measured by the test (section 6) |

`P` still switches between the two during a run.

## 5. Before the presentation

| # | What | When |
|---|---|---|
| B1 | the watcher on the current code, System 1 ready (`node demo/preflight.mjs`) | 30 min before |
| B2 | `teams.pollSeconds: 5`, `node agent/teams-login.mjs --check` says the agent is signed in, then `node agent/watcher.mjs --replace` | the day before |
| B3 | VAX-23's PR #15 still open (the live question's answer reads "waits for a person"); its answer read once on the dashboard's Ask (`VAX-23`, $0) | the day before |
| B4 | the second laptop or the phone in `support-triage`, notifications on, 125 % zoom | 30 min before |
| B5 | **the approve / reject round live once** ([DEMO_SCENARIO.md](DEMO_SCENARIO.md#the-rehearsal), step 5), so that slide 20 draws real events; without it, the slide says "first live round pending" | the rehearsal |
| B6 | one full run in each mode, timed; a screen recording of the voiced run as the fallback | the day before |

## 6. What has to be built

| # | Work | Where | Effort |
|---|---|---|---|
| W1 | `?present` in presenter mode by default; `?present&voice` for the voiced run; a 4 s dwell after the voice; 0.9× by default; no staggering on these slides | `tour.js` (`play`, `presenter`, `rate`) | 0.25 d |
| W2 | a notes window (`?notes`) that shows the current step's text and the next step's title, kept in step through a `BroadcastChannel` | `tour.js`, `index.html` | 0.25 d |
| W3 | the eight steps of slide 3 as a map on slides 4–11 and in the caption bar (`STAGES`) | `slides.js`, `tour.js` | 0.25 d |
| W4 | slides 1–11 (2 kept and reworded, 9 new with their diagrams); System 1's bars and the BIL cases read from the recorded events (`GET /api/tour/system1`, extended) | `slides.js`, `lib/tour.mjs` | 1–1.25 d |
| W5 | the case script for VAX-21 (steps 12–22), replacing Case 1 and Case 2: the masking before and after, the Teams panel for both cards, the knowledge entry, the Graph tab with the ticket picked; `tourReplay: ["VAX-21"]` | `tour.js`, `agent.config.json` | 0.75 d |
| W6 | slides 20, 23, 24, 25, 26 from data: the channel drawn from the `notified` / `fix-notified` cards and the `teams-asked` / `teams-answered` records (and the approval events once they exist); the four catches (FAR-19's events, the pilot's VAX-15/VAX-19 records, the suite's `shared`); the latest digest (`GET /api/tour/digest`); the numbers of the dashboard tiles (Insights, Ask stats, Impact) | `slides.js`, `lib/tour.mjs`, `watcher.mjs` | 0.5–0.75 d |
| W7 | slides 27–30 and the backup slides; the results from the event logs and the pilot's score | `slides.js` | 0.25 d |
| W8 | the tests: every step's slide renders, the case plays VAX-21, the voiced run fits 17 minutes (2.3 words a second at 0.9×, plus the dwell and the replay), the presenter mode never moves on by itself | `agent/test/slides.test.mjs`, `tour.test.mjs` | 0.25 d |
| W9 | [DEMO_SCENARIO.md](DEMO_SCENARIO.md) and [agent/README.md](../agent/README.md#presentation) updated to the new run | docs | 0.1 d |

About 3.5–4 working days by the estimate; **W1–W9 were built on 2026-11-18**. The tour (`?tour`, the walk-through of the dashboard) stays, now with VAX-21 and FAR-19 as its cases; `?deck` has the new slides. Still open: B5, the approval round live, after which slide 20 draws its real events.
