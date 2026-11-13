# Where we are, what the AI does on its own, and what makes it a system

Status: **Proposal** · Date: 2026-11-13 · Owner: Bojan Mijatović · Builds on: [KNOWLEDGE_PLAN.md](KNOWLEDGE_PLAN.md), [ROADMAP.md](ROADMAP.md), [REDACTION.md](REDACTION.md)

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

Done: #4 AI reviewer, #5 Insights, #6 Ask. Open: #1 approval from Teams, #2 Mission Control / impact, #3 night shift, #7 release notes, #8 reply on merge.

### Measured

| What | Result |
|---|---|
| Analyses run | 49 (event logs); the latest 8 saved: $0.26 and 48 s on average, all high confidence |
| Automatic fixes | 21 draft PRs, 8 stopped: **72 %** of the attempts end in a verified PR (test fails before, all checks pass after) |
| AI review | 11 reviews, risk and findings posted on GitHub |
| Documentation | 46 backfilled + 11 on Done; 8 merged from the dashboard; 0 lint findings |
| Ask | 24/24 on the eval (23/24 before K11) |
| Prior art | suggestions 4/4; reported-ticket scenarios 29/29 |
| Personal data | masked before every model; 88 tickets audited, 0 false alarms after the fixes |

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
| **App review** / recommendations | a button | yes (read-only) | findings, refactors, ways to grow → suggested tickets | **creating a ticket** (`createTicket: draft`) |
| Prior art of suggestions, gaps, Insights, refresh, backfill selection, redaction, lint | page load or command | no | — | — |

In autonomy levels:

| Level | Meaning | Actions now |
|---|---|---|
| L3: acts, a person approves the result | does the work, a person merges | fix PRs, documentation PRs |
| L2: acts and reports | does it and tells | analysis comment, labels, owner notice, AI review, update emails, documenting on Done |
| L1: drafts, a person sends | prepares, a person decides | reporter reply, assignee, ticket from a suggestion |
| L0: never | not allowed | change priority or status, merge a fix |

## 3. What makes it more than an app

An app is something people open. A system works without being opened, learns from what happens, and earns more autonomy by measurement. Six principles, and where we stand against each:

| Principle | Today | Gap |
|---|---|---|
| **Works where people work** (Jira, GitHub, Teams), without being opened | Jira comments, GitHub reviews, Teams notices (simulated without a webhook) | approvals, Ask and digests live only on the dashboard; no Teams webhook configured |
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

**WF2. Teams as the front door** (ROADMAP #1, extended). The approval card for a fix (Approve → ready for review and Jira comment; Reject → fix again with the reason), the documentation merge, and **Ask in Teams**. People never open the dashboard to act. Needs a Teams app or bot (a webhook only posts). Level unchanged (a person still approves); the gain is reach.

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

| # | Step | Why first | Effort |
|---|---|---|---|
| 1 | **AI1** continuous evaluation | everything else (AG2, AI2, WF5) needs its numbers; no new AI cost | 1.5 d |
| 2 | **WF3** night shift + digest, with K7, lint, audit, gaps | turns the existing checks into a routine; first "works without being opened" | 1.5 d |
| 3 | **KB1** entry ↔ regression test, run nightly | executable knowledge; rides on WF3 | 1 d |
| 4 | **AG1** agent contracts (refactor, no behaviour change) | prerequisite for AG2 and AG3 | 1.5 d |
| 5 | **AG2** trust ladder | autonomy by evidence; needs 1 and 4 | 1 d |
| 6 | **WF1** intake check | fewer low-confidence analyses; cheap model | 1 d |
| 7 | **KG1** + **KG2** gaps from all signals, researcher agent | knowledge grows where it is missing | 2 d |
| 8 | **WF2** Teams front door | reach; needs a Teams bot (IT) | 2 d + IT |
| 9 | KB2 handbooks, WF4, WF5, AI2–AI4, AG3 | after the above shows where it pays | 5 d |

About 16 working days, in three blocks: **measure** (1–3), **earn autonomy** (4–6), **reach and grow** (7–9).

## 6. What needs a decision

1. **The pilot project** (no patient data, as R-02 allows): AI1 and the night shift need real tickets to mean something.
2. **A Teams webhook now, a Teams bot later** (WF2, WF3 digest).
3. **The thresholds of the trust ladder** (AG2): how many runs, which acceptance rate, per action.
4. **The night-shift budget** (AI3, WF3): dollars per night and per month.
5. **R-02**: DPO approval and the AI service ([REDACTION.md](REDACTION.md)).
