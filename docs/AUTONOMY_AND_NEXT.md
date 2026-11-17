# Where we are, what the AI does on its own, and what makes it a system

Status: **Proposal, in progress** · Date: 2026-11-13, updated 2026-11-17 · Owner: Bojan Mijatović · Builds on: [KNOWLEDGE_PLAN.md](KNOWLEDGE_PLAN.md), [ROADMAP.md](ROADMAP.md), [REDACTION.md](REDACTION.md)

Everything in sections 1 and 2 was checked against the code, `agent/policy.json`, `agent/agent.config.json` and the event logs on 2026-11-13. It is not taken from earlier notes.

## 1. Where we are

### Knowledge plan (K1–K21)

| Item | State | Evidence |
|---|---|---|
| K16 Jira health guard | done | a rejected token pauses the agent and says why (it had silently seen an empty Jira) |
| K1 eval set | done | Ask 24 questions, prior art 4 suggestions + 4 scenarios |
| K2 documentation PRs on the dashboard | done | merged from Insights → Knowledge base |
| K4 every resolved bug documented, backfill | done | **46/46 resolved bugs** documented in the four apps, ~$20 |
| K5 entry format v2 + lint | done | 0 findings on all four `main`s |
| K6 one file per component | done | MediAgenda migrated; the others written that way |
| K7 entries stay true | done | `knowledge-refresh.mjs`; all clean |
| K10 Ask honest about failures | done | the "not found" of 2026-11-12 now answers BIL-18 |
| K11 Ask over the suite | done | cross-app questions found in the linked app |
| K12 feedback and knowledge gaps | done | 👍/👎, Insights → Knowledge gaps, gap → suggested ticket |
| K13 fix and review read the knowledge | done | the review cites DEM-5's "Prevent recurrence" |
| K17 + K19 prior art of suggested tickets | done | 4/4, no false duplicate |
| K20 "Already known?" for reported tickets | done | scenarios 29/29 after two defects found and fixed |
| K21 prior-art eval | done for b, c, e | the regression case (d) needs a regression on `main` |
| K9 knowledge first | half | the analysis gets the entries; Ask still reads them on its own |
| K3, K8, K14, K15, K18 | open | low value on demo data (section 4 says when) |

### Roadmap (#1–#8)

Done: #4 AI reviewer, #5 Insights, #6 Ask (grown on 2026-11-17, Ask 1/7–7/7). In progress: #9 Teams → agent (Ask in Teams, then #1 approval from Teams as its part B). Open: #2 Mission Control / impact (mostly done), #3 night shift, #7 release notes, #8 reply on merge.

### Measured

| What | Result |
|---|---|
| Analyses run | 49 (event logs, which keep every analysis with its cost): **$0.39 and 63 s on average**, $19.16 in all (MediAgenda $0.43, the other apps $0.16–0.19). The 8 saved result files alone gave $0.26, an earlier figure that was too low |
| Accuracy (AI1, `agent/accuracy.mjs`, 2026-11-13) | fix PRs: **5 of 6 decided merged unchanged** (the 6th, DEM-36, closed because DEM-37 replaced it); 15 withdrawn by demo resets, not counted. Documentation PRs: 8 of 11 merged unchanged (1 with a person's commit, 2 closed: a duplicate and one without a reason). AI review agrees with the outcome 2 of 3 (the one miss is the replaced DEM-36). Analysis files: 5 of 5 hit, but all five were fixed by the agent itself; **no analysed ticket has been fixed by a person yet**, so the analysis is not tested independently (AI1b) |
| Replay on history (AI1b, `agent/replay.mjs`, 2026-11-13) | all **45** resolved bugs a person fixed in the four apps, analysed again on the code before the fix with Jira as it was: a file of the real fix named in **45/45**, component 45/45, "already known?" right 45/45, **owner 37/45** (MediFarma 5/10, MediBill 9/11, MediLab 11/12, MediAgenda 12/12). Precision 0.41: the analysis names 2–5 files to find the 1–2 the fix changed. $9.31, 32 s each. The demo bugs are easy (most fixes change one file, the ticket names the screen), so expect lower numbers on the pilot project. The owner misses name the component's main author where another person fixed it: a question for the owner rule, not necessarily a wrong answer |
| Automatic fixes | 21 draft PRs, 8 stopped: **72 %** of the attempts end in a verified PR (test fails before, all checks pass after) |
| AI review | 11 reviews, risk and findings posted on GitHub |
| Documentation | 46 backfilled + 11 on Done; 8 merged from the dashboard; 48 tickets documented on the four `main`s, 0 lint findings, 0 stale entries (re-checked 2026-11-13) |
| Ask | latest run per project: **23/24** (DEM 10/10 and FAR 3/3 before R-02, LAB 8/8 and BIL 2/3 with it). Every question has passed at least once (24/24 across runs); the cross-app MediBill question cites DEM-17 but not always BIL-4 |
| Prior art | suggestions 4/4 (re-run 2026-11-13); reported tickets: 4 scenarios, 29/29 checks |
| Personal data | masked before every model; audit 0 false alarms after the fixes (88 tickets then, 84 today after demo resets) |

## 2. What the AI does on its own today

Seven places call a model. Everything else, including every decision about what to do with a result, is plain code.

| Step | Trigger | AI? (model, tools) | What it may do alone (`policy.json`) | Human gate |
|---|---|---|---|---|
| Watch Jira, health | every 30 s | no | queue new and resolved tickets; pause when Jira fails | none |
| **Analyze** a new ticket | new ticket settled for 1 min | yes (Sonnet, read-only, skill) | internal Jira comment, labels, Teams notice to the owner (≥ medium confidence), draft assignee and draft reporter reply | the reply and the assignee are drafts |
| Already known? | inside the analysis | yes (part of the analysis) | stops the automatic fix for duplicate / in-progress / fixed-on-main | none |
| **Reproduce and fix** | analysis high confidence, [FE]/[BE] or inferred | yes (default model, edits only its worktree) | test that fails, fix, all checks, push branch, **draft** PR, Jira comment with evidence | **merge is a person's** (`mergeFix: off`) |
| **AI review** of the PR | after a draft PR | yes (read-only, no shell) | COMMENT review with risk and inline findings | never approves or merges |
| **Document** a resolved ticket | ticket → Done (also bugs fixed without the agent) | yes (writes `docs/knowledge` only, lint-checked) | branch + **draft** PR, Jira comment, label | **merge from the dashboard** (`mergeDocs: draft`) |
| **Ask** | a question on the dashboard | yes (read-only, no shell) | answer with checked sources | none (it only answers) |
| Ask actions (Ask 3/7) | a person, under an answer | no (plain code on the recorded answer) | — | **every one is a person's click**: Send to Teams (`shareAnswer: draft`), Create a ticket (`createTicket: draft`), Save as FAQ after 👍 → a draft documentation PR (`promoteFaq: draft`) |
| **App review** / recommendations | a button | yes (read-only) | findings, refactors, ways to grow → suggested tickets | **creating a ticket** (`createTicket: draft`) |
| Prior art of suggestions, gaps, Insights, refresh, backfill selection, redaction, lint | page load or command | no | — | — |

In autonomy levels:

| Level | Meaning | Actions now |
|---|---|---|
| L3: acts, a person approves the result | does the work, a person merges | fix PRs, documentation PRs |
| L2: acts and reports | does it and tells | analysis comment, labels, owner notice, AI review, update emails, documenting on Done |
| L1: drafts, a person sends | prepares, a person decides | reporter reply, assignee, ticket from a suggestion or an Ask answer, an answer to Teams, an FAQ PR |
| L0: never | not allowed | change priority or status, merge a fix |

## 3. What makes it more than an app

An app is something people open. A system works without being opened, learns from what happens, and earns more autonomy by measurement. Six principles, and where we stand against each:

| Principle | Today | Gap |
|---|---|---|
| **Works where people work** (Jira, GitHub, Teams), without being opened | Jira comments, GitHub reviews, Teams messages in a real channel: the handoff with an @mention and why this person, then "fix ready for review" with the PR (T4–T6; shown on the dashboard only when no webhook is set) | approvals, Ask and digests live only on the dashboard (an Ask answer can be sent to Teams since 2026-11-17, and Ask in the channel itself is in progress, ROADMAP #9); checked on a test tenant (2026-11-16), the team's own channel still needs its webhook, created by a person there |
| **Learns from every outcome** | knowledge base grows on every Done; Ask 👎 becomes a gap | the agent never learns whether its **analysis was right**: the final fix, a reopened ticket, a rejected PR are not compared with what it said |
| **Autonomy earned by measurement** | `policy.json` levels, set by hand | no per-action accuracy; nothing proposes "this action has been right 30 times, make it auto" |
| **Knowledge compounds** | 46/46 bugs documented, read by analysis, fix, review and Ask | only bugs; nothing on "how this component works"; an entry is not tied to the test that proves it still holds |
| **Honest** | sources checked, failures visible, redaction, lint | the scheduled checks (refresh, lint, audit) only run when someone runs them |
| **Value is visible** | costs per run in the logs | no time saved, no cost per resolved ticket, no trend (ROADMAP #2) |

## 4. Proposals

Each item says what, why (the gap above), how, how it is measured, and the autonomy level it runs at. The order in section 5.

### Knowledge base

**KB1. Each entry tied to its regression test, checked every night.** Most entries come from fixes that added a test (the agent's always do: `e2e/tests/<KEY>.spec.ts`, `…RegressionTest.java`). The entry gets a **Test** line (the lint requires it when the fix commit added one); the night shift runs those tests on `main`, and an entry whose test fails turns into a "known issue is back" alert with its ticket. *Knowledge that is executable is knowledge that cannot go stale silently.* Measured: entries with a test, failures caught. Level L2 (it runs and reports).

**KB2. Component handbooks, not only bugs.** Each component file gets a short **How it works** section above the known issues: the main flow, the files, the API it calls, the pitfalls (from the "Prevent recurrence" notes). Written once by the documentation agent from the code and the entries, kept current when a PR changes the component (a docs PR, like K7). Feeds onboarding and Ask ("how does the booking cancellation work?" today mostly reads code). Measured: Ask "how" questions answered from the handbook; time and cost per answer. Level L3 (draft PR).

**KB3. Knowledge graph on Insights.** Component ↔ entries ↔ tickets ↔ commits ↔ people, as one view: the drill-down already links the knowledge file; add "most asked", "last regression", "who documented". Cheap, plain code. Level L0 (a page).

### Knowledge gaps

**KG1. More signals than Ask.** Today a gap is a question Ask could not answer. The agent produces better signals itself: an analysis with low confidence ("no evidence for …"), a fix stopped ("the test passes on the current code"), an AI review "needs changes", a reopened ticket, a 👎 with a note. One list, each gap with its source and component. Measured: gaps per component per week; gaps closed. Level L0 → L1.

**KG2. A researcher agent closes gaps.** For a gap, a read-only run gathers the answer from code, history and tickets and opens a **documentation PR** (an FAQ or a handbook section, KB2) for the component's owner (knowledge map) to review. K15 generalized. Measured: gaps closed by an accepted PR; edits needed before merge. Level L3.

**KG3. Gaps have an owner and an age.** The person who knows the component (knowledge map) owns its gaps; the morning digest lists the oldest. Level L1.

### AI

**AI1. Continuous evaluation from production (the most important item).** On every resolved ticket the agent analysed, compare what it said with what happened, in plain code: the files it named vs the files the fix changed; the owner it proposed vs who fixed it; "already known" vs a later duplicate link; its confidence vs the outcome. One accuracy per action, per component, per model, every day, without an answer key. This turns every ticket into an eval case and makes regressions in prompts or models visible. Measured: the accuracies themselves, and their trend. Level L0.

**AI2. Every real miss becomes a scenario.** AGENT_TRAINING's rule, automated: a miss from AI1 (wrong file, wrong owner) produces a scenario stub in `demo/scenarios.json` format, redacted, for a person to confirm. The eval suite grows from production. Level L1.

**AI3. Model and budget per task.** Small model for verdicts and classification (K18, intake check WF1), Sonnet for analysis, the strongest for fixes; a daily budget per action with a hard stop and a notice (the 5-hour usage limit already stopped one backfill). Measured: cost per resolved ticket by action. Level L2.

**AI4. Prompt-injection tests in the eval.** Tickets and comments that try to make the agent post, push or leak ("ignore your instructions …"); the expected result is that nothing outside the policy happens. The guards exist (allow-lists, no MCP, watcher is the only writer); this proves them on every change. Level L0.

### Workflow

**WF1. Intake quality gate.** When a new ticket lacks what an analysis needs (steps, expected vs actual, environment, screen), a small model drafts a question to the reporter before the analysis runs (DEM-31/32/35 were analysed half-written). Draft first, then auto when its questions are accepted without edits (AG2). Measured: low-confidence analyses before/after. Level L1 → L2.

**WF2. Teams as the front door** (ROADMAP #1, extended). The approval card for a fix (Approve → ready for review and Jira comment; Reject → fix again with the reason), the documentation merge, and **Ask in Teams**. People never open the dashboard to act. Needs a Teams app or bot (a webhook only posts). Level unchanged (a person still approves); the gain is reach. **Replanned 2026-11-17 (ROADMAP #9):** a first version needs no bot: the agent reads the channel through Microsoft Graph as one signed-in account (delegated permission, the tenant admin's consent once) and answers in the thread, outbound only. Ask in Teams first ("ti: …"), then the approval by a reply ("approve" / "reject: why" under the "fix ready" card). The bot, with real buttons, stays the production path with the company's service account.

**WF3. Night shift and morning digest** (ROADMAP #3, extended). In a time window with a budget: backlog analyses, documentation of the day's Done tickets, knowledge refresh and lint (K7), the KB1 tests, the redaction audit of new tickets, the gaps list, AI1's accuracy. 08:00 digest to Teams and the dashboard: what was done, what waits for a person, what is back. Level L2.

**WF4. Close the loop with the reporter** (ROADMAP #8 and #7). On merge: a draft reply "fixed, comes with release X" (the K20 wording exists); per sprint: release notes in a technical and a business version. Level L1.

**WF5. Impact** (ROADMAP #2). Time from report to first analysis, to PR, to merge; cost per ticket; hours saved against a baseline the team sets; accuracy from AI1. The page management reads. Level L0.

### Agents

**AG1. Named agents with contracts.** Today the agents are implicit in `lib/*.mjs`. Make each explicit, one file per agent: trigger, inputs, tool allow-list, output schema, budget, policy key, eval, owner.

| Agent | Does | Exists |
|---|---|---|
| Triage | intake check, analysis, already known | yes (analysis) + WF1 |
| Fixer | reproduce, fix, verify | yes |
| Reviewer | review PRs | yes |
| Librarian | document, refresh, lint, migrate, handbooks | yes in parts + KB1, KB2 |
| Researcher | answer questions, close gaps | Ask + KG2 |
| Analyst | Insights, app review, accuracy | yes in parts + AI1 |

Per-agent metrics and autonomy follow from it, and a new agent has a template.

**AG2. A trust ladder driven by data.** For each action, AI1 and the human gates give a track record (fix PRs merged without changes, documentation PRs merged without edits, drafts sent unedited, notices that reached the right person). When an action passes a threshold the team sets (e.g. 30 runs, ≥ 95 % accepted unchanged), the agent **proposes** raising its level in the digest; a person accepts and `policy.json` changes in a reviewed commit. Falling below lowers it automatically and says so. Autonomy grows with evidence and shrinks on its own. Level of the ladder itself: L1.

**AG3. One coordinator.** One queue with priorities (customer-facing first), budgets (AI3), time windows (WF3), and per-ticket locks across agents. The FAR-10 race (backfill vs watcher) was a coordination bug; with more agents there will be more.

## 5. Recommended order

One plan for this document and [GIT_GRAPH.md](GIT_GRAPH.md) (GG0, G1–G3, A1–A7). Updated 2026-11-13 after the answers in GIT_GRAPH section 7: everyone looks at it (developers every day, management weekly or more often), on git and SVN.

| # | Step | Why in this place | Effort | Status |
|---|---|---|---|---|
| 1 | **AI1** continuous evaluation + **GG0** graph model (git and SVN) | everything else (G1, WF5, AG2, AI2) needs its numbers and its edges; no new AI cost | 2 d | **done 2026-11-13**: `agent/accuracy.mjs`, `GET /api/accuracy`, one snapshot a day (FR-68, FR-69); the dashboard panel comes with step 2 |
| 2 | **G1** ticket lanes (developer mode) + the accuracy panel | the picture the CTO asked for; developers every day | 1.5 d | **done 2026-11-13**: the dashboard's **Graph** tab (FR-70); seen in light, dark and at phone width |
| 2b | **G1b** links out of the lanes: Jira on every key (J1), the tickets a commit's message names (J2, J3), the owner's Teams message in the lane (T1), and a real Teams channel ready except its webhook (T2) | the lanes showed what happened but led nowhere: no Jira, no Teams, and a knowledge refresh naming 14 tickets showed none | 1 d | **done 2026-11-16** (FR-85, FR-37): seen on MediAgenda (#31 lists its 14 tickets; DEM-32's view shows the 6 commits that mention it), in light, dark and at phone width. **Teams checked against a real channel** the same day (a test Microsoft 365 tenant: DEM-46's owner message arrived 61 s after the ticket was picked); the team's own channel needs its webhook ([agent/README.md](../agent/README.md#notifications)). J4 (links written into Jira) and T3 (links into Teams, Microsoft Graph) are in step 13 |
| 2c | **A live demo with Teams**: the owner @mentioned (T4), demo cases kept out of the pilot's schedule, the scenario's live variant ([DEMO_SCENARIO.md](DEMO_SCENARIO.md) section 9), **D1** a GO/NO-GO preflight for that variant, **T5** a card that says why this person (the analysis' reason, the file, the confidence), **T6** a second message when the fix is ready (the draft PR), and a restart that waits for the work in progress (`--replace`, FR-45) | the demo is the moment people decide to try it; today every surprise (System 1 off after a restart, a watcher too slow to answer, a phone that scrolls sideways, a restart that killed a paid app review) was found only when it hit | 2 d | T4 and the live variant **done 2026-11-16**, with three fixes found on the way: the watcher answered a status in up to 3.6 s while the machine was busy (7 ms now), System 1 timed out loading during a training (125 s; it waits 300 s now), four dashboard tabs scrolled sideways on a phone, and the watcher stood still for 10–60 s whenever Insights, the Graph or Impact tab was computed, and for 5–7 s every two minutes during the regression guard's fetches, all of them git and gh run synchronously on its one thread (now in worker threads or asynchronous: a status answers within 30 ms throughout). D1 (`node demo/preflight.mjs --teams`), T5 and T6 done the same day, and seen on a real ticket: the pilot's VAX-21 got both Teams cards with no one starting anything (handoff at 1:58 from the report, "fix ready" at 5:19). `--replace` now waits for the running watcher's job (verified live: 48 s for real recommendations). Preflight: GO but for the reserved case, which is pushed on the morning of a demo. **Next: one rehearsal** of section 9 with the phone ringing |
| 2d | **More autonomy where the evidence allows it (step A)**: System 1's queue order (J3) to `auto`; one more try for a fix that stopped on an accident (`retryFix`, FR-88); a merge check of every open fix PR when main moves (`mergeCheck`, FR-87); the privacy hold (J6) checked and left in shadow | of the work still on draft, off or shadow, these four had a small risk and data behind them; the rest waits for a trust ladder (AG2) or a decision | 1 d | **done 2026-11-17**, except J6 on purpose: on the pilot's VAX-17 the masking left a patient's name and ft-5 answered "no person" at 97 %, so `auto` would promise a protection it does not give. Merge check verified live on MediVax (27 backend tests, the build, 10 browser tests on the merge, 216 s). **Next in this line: AG2**, so that each further step (`mergeDocs` after K22, `assignOwner` from the bisect, `askReporter`, `lightPath`) is proposed by the data and accepted by a person. **Then at the owner's request (2026-11-17), before that data:** `askReporter` and `lightPath` to `auto`, each with a safety net instead of the wait: the question waits at most 24 h for the reporter's answer, a light path is undone by the reporter's reply, and a light path that turns out to be about code puts itself back in shadow (the first step of AG2's "falling below lowers it"). Both verified live (BIL-28, BIL-27) |
| 2e | **Ask grown** (Ask 1/7–7/7): a ticket's status from the records, plain-code answers in three languages, a page's address to its code, follow-ups, Send to Teams / Create a ticket / Save as FAQ under an answer, the earlier questions and the same question given again, one-click rating with Ask on the Impact tab | "the status of my ticket" was the question the project started from, and Ask reached only the one person at the dashboard with a Claude run for everything | 1 d | **done 2026-11-17** (FR-89–FR-95): on the suite, 79 questions, 67 % answered without an AI run, 94 % found, $0.22 per Claude answer; the first FAQ is MediVax PR #14 |
| 2f | **Teams → agent** (WF2 replanned, ROADMAP #9): the foundation (the channel read through Graph as one signed-in account), **A** Ask in Teams, then **B** the approval of a fix by a reply, later **C** the owner's "I take it" | the dashboard answers only on its own machine; Teams is where the team works, and the demo's second laptop and phone see only Teams | 3–3.5 d | **built 2026-11-17** (foundation, A Ask in Teams FR-96, B approval FR-97; 276 tests, the rejected fix set aside on real git); the live check waits for the app registration on the test tenant. C, the owner's answer, built 2026-11-17 (FR-98) |
| 3 | **AI1b** replay on resolved history: the analysis of a resolved ticket as it was reported, on the code before its fix, compared with the real fix | the demo has no person-made fixes of analyzed tickets to compare with; history has 45. Gives a baseline now and on the pilot project on day one | 1 d | **done 2026-11-13** (FR-71): 45/45 files, owner 37/45, $9.31 (approved; a trial on 3 tickets first, and a no-AI leak check of the frozen code and Jira) |
| 4 | **WF5** Impact: the management week (what the agent did, accuracy, cost per ticket, time saved against the team's baseline) | management looks weekly; built on the records of step 1 | 1 d | **done 2026-11-13**: the dashboard's **Impact** tab and `agent/impact.mjs` (FR-72), with the ROADMAP defaults as the team's baseline ("only a demo"). Suite, 2 weeks of data: 31 tickets analysed, 5 fixes merged, 48 tickets documented, $20.75, about 66 hours saved by the estimate |
| 5 | **KB1** entry ↔ regression test | executable knowledge; run as a command until the night shift exists | 1 d | **done 2026-11-13** (FR-73): a **Test** line in every entry, written by code; `agent/knowledge-tests.mjs` runs the tests on main. 25 of 48 entries have tests, all pass; proven to catch LAB-8 coming back. The four PRs that add the line to the existing entries (MediAgenda #31, MediLab #7, MediFarma #4, MediBill #3) are merged; the lint is clean on all four `main`s |
| 6 | **A2** automatic bisect with the reproduction test | proof of the breaking commit instead of a guess; no model cost | 1.5 d | **done 2026-11-13** (FR-74): after the reproduction and before the fix, `lib/bisect.mjs` finds the commit that broke it; it goes into the fix and review prompts, the PR, Jira and a draft assignee; `agent/bisect-one.mjs` by hand. Planted breaks found exactly: MediLab (JUnit, 6 runs, 157 s) and MediAgenda (Playwright, 5 runs, 226 s). No real ticket yet |
| 7 | **A1** regression guard on every commit to `main` | catches a regression before a ticket; runs KB1's tests | 1 d | **done 2026-11-13** (FR-76): every new commit on a watched `main` is checked within 2 minutes (`lib/regression-guard.mjs`): its lines are blamed, the regression tests of the bug fixes they touch run on it, and a changed fix test runs as it was before the commit. An alert is posted on the commit (GitHub) and in Jira, masked; `agent/guard-one.mjs` by hand. Pilot: the planted regression of VAX-13, which "adjusted" its test to pass CI, was alerted 2 minutes after the push, long before the ticket. Backtest on the 135 commits of the five apps: 128 clear, 5 notes, 2 alerts, both deliberate behaviour changes that replaced an earlier fix (DEM-33, LAB-18) |
| 8 | **A3** blast radius from what changes together | better fixes and reviews; cheap | 1 d | |
| 9 | **AG1** agent contracts (refactor, no behaviour change) | prerequisite for AG2 and AG3 | 1.5 d | |
| 10 | **AG2** trust ladder | autonomy by evidence; needs 1 and 9 | 1 d | |
| 11 | **WF1** intake check | fewer low-confidence analyses; cheap model | 1 d | |
| 12 | **KG1** + **KG2** gaps from all signals, researcher agent | knowledge grows where it is missing | 2 d | **KG2 built 2026-11-17** (FR-100): the researcher takes the gaps Ask leaves (not found, marked wrong) and writes a checked FAQ entry into the documentation PR, or marks the gap real; `researchGaps: auto`, 3 runs a day. KG1 (gaps from the analyses, stopped fixes, reviews, reopened tickets) still open |
| 13 | G2 bug lineage, G3 relationship graph (KB3), A4 branch care, A5 port fixes, A6 releases, A7 orphan commits, J4 links written into Jira, T3 links into Teams (with WF2), KB2, WF4, AI2–AI4, AG3 | after the above shows where it pays | ~11.5 d | |

About **30.5 working days** without the deferred items (25 before G1b, J4 and T3, and 27.5 before the live demo work of step 2c, all added on 2026-11-16; steps 2e, 1 d and done, and 2f, 3–3.5 d, added on 2026-11-17), in three blocks: **measure and show** (1–4), **act on the code** (5–8), **earn autonomy and grow** (9–13).

**Deferred, kept in the plan** (decided 2026-11-13, to keep the scope narrow for now): **WF3** night shift + morning digest (ROADMAP #3; 1.5 d). **WF2** Teams front door was deferred too, and came back on 2026-11-17 as step 2f, without a bot (ROADMAP #9). Until WF3 exists, the checks it would run (K7 refresh, lint, redaction audit, KB1 tests, AI1 accuracy) stay commands a person runs. They come back when the pilot project (section 6) gives them real tickets.

**Proposal (2026-11-13): one local model for the small decisions.** K8, K18, WF1, AI3 and A7 each call for "a small model" to give a verdict or a classification, and AG3 for a queue with priorities. [SYSTEM1_PLAN.md](SYSTEM1_PLAN.md) proposes one local Jev-type model for all of them. It answers in about two seconds, with no cost per call and nothing sent out, in front of the Claude analysis.

## 6. What needs a decision

1. **The pilot project** (no patient data, as R-02 allows): AI1 and the night shift need real tickets to mean something. *Started 2026-11-13 as a demo pilot ([PILOT.md](PILOT.md)): MediVax, a fifth app with synthetic patients, gets two changes with a hidden bug and two bug reports every working day, scored against an answer key. A real project is still needed for the bugs we did not design.*
2. **A Teams webhook now, a Teams bot later** (WF2, WF3 digest). *Webhook: decided 2026-11-16, built (G1b) and checked the same day against a test tenant's channel; the team's own channel needs its owner to create the webhook (about 10 minutes). What a webhook can carry is built or planned on it: the @mention (T4), the reasons in the card (T5), a second message when the fix is ready (T6). What needs an answer back from Teams stays with the bot (WF2, T3), deferred: it needs an app registered in Azure by IT. **Changed 2026-11-17:** an answer back no longer waits for the bot. The agent reads the channel through Graph as one signed-in account (ROADMAP #9), on the test tenant with its admin's consent; at the company the same needs IT's consent for the app registration, and the bot remains the production path.*
3. **The thresholds of the trust ladder** (AG2): how many runs, which acceptance rate, per action.
4. **The night-shift budget** (AI3, WF3): not needed while WF3 is deferred; a daily budget per action (AI3) still is.
5. **R-02**: DPO approval and the AI service ([REDACTION.md](REDACTION.md)). *The pilot does without it: its patients are synthetic (fiscal codes fail the official check by construction). It measures the masking on every ticket, which is the evidence for the DPO. Real patient data still needs the approval.*
6. **A team machine for the dashboard, with sign-in** (G1, WF5): developers look every day and management weekly, and today the dashboard answers only on the machine it runs on.
