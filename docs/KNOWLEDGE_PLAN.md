# Plan: shared knowledge and prior-art checks

Status: **Approved, in progress** · Date: 2026-11-12 · Owner: Bojan Mijatović · Decisions: [section 8](#8-decisions)

This plan is about what the team learns from its tickets and how that knowledge reaches the next person: how it is **written** (Done → documentation), how it is **found** (the analysis, Ask), how it is **used** (the fix, the review, Insights), and how we **measure** it. The second part (section 1.1, findings F16–F22, phase 5) covers the moment a **new ticket** appears, whether the agent suggests it or a person reports it: is the problem already reported, being fixed, fixed, or documented? Every finding below was checked against the code and the demo data on 2026-11-12.

## 1. How it works today

```
WRITE   ticket with ai-analyzed → Done ──▶ document-ticket (headless) ──▶ docs/<KEY> branch ──▶ draft PR ──▶ (a person merges)
                                                                                                      │
                                                                                                      ▼
READ    analysis (analyze-ticket) ── grep docs/knowledge on origin/main by ticket keys + strong clues ◀─┤
        Ask ── keywords → JQL text~, all saved analyses, git log -400, then Read/Grep/Glob over origin/main ◀─┘
        fix, AI review, Insights ── do not read docs/knowledge
```

| Part | Where | What it does |
|---|---|---|
| Write | `agent/watcher.mjs:112` (`DONE_JQL`), `agent/lib/document.mjs`, `.claude/skills/document-ticket/SKILL.md` | a ticket that has `ai-analyzed` and was moved to Done in the last `lookbackHours` gets an entry in `docs/knowledge/<component-slug>.md` and the README index, on branch `docs/<KEY>`, as a draft PR. The watcher only checks that nothing outside `docs/knowledge/*.md` changed |
| Read: analysis | `.claude/skills/analyze-ticket/scripts/lib/code.mjs:243-252`, SKILL step 8 | lists the doc files, greps them for the ticket key, related keys and strong clues; the agent reads the hits |
| Read: Ask | `agent/lib/ask.mjs` | keywords (≥ 4 letters, no stop words, max 6) → JQL `text ~` OR + the 15 latest tickets → up to 30 full tickets; every saved analysis; `git log -n 400`; a run with Read/Grep/Glob over `origin/main`; cited sources checked |
| Recurrence | `agent/lib/insights.mjs:399` | from the analyses' `relatedTickets`/`duplicateOf`, Jira links and fixes touching the same file; not from knowledge entries |

What already works well and stays: the read-only allow-list for Ask, the source check (an answer with no valid source is "not found"), the **confirmed / assumed** labels in entries, and linking a recurrence to the earlier entry (DEM-33 updated DEM-32's entry).

### 1.1 How a new ticket is checked today

There are two ways a new ticket appears. Neither asks the question "is this already known?" as a step of its own.

```
A. SUGGESTED BY THE AGENT (Insights → Suggested tickets)
   ✦ Review the app (AI) ──▶ findings · refactors · growth, each with a ticket summary   (cached in insights/review.json)
   Insights facts (code)  ──▶ missing fix of a copy · risk file without a test · bus factor 1
        │
        ▼ suggestTickets() (code, on every Insights load)
   hidden when the normalized summary equals an existing ticket's (any status)
   "already open as KEY" when ≥ 60 % of the summary words match an OPEN ticket
        │
        ▼ person: Create in Jira… → edits → confirms (policy createTicket: draft)
   watcher: same check on the cached Insights → jira.createIssue (labels ai-suggested, no-ai)

B. REPORTED BY A PERSON (Jira → watcher → analysis)
   analyze-ticket bundle (code): related tickets (3 JQL + links, relevance), ticket commits, knowledge-doc hits,
                                 branches named after THIS key
   analysis (AI, Sonnet): relatedTickets[], duplicateOf (an OPEN ticket only), free-text cause
        │
        ▼ watcher: duplicateOf → "possible duplicate" event + mention in the comment; automatic fix skipped
          everything else ("solved before", "already fixed on main", "a PR is open") → nothing structured to act on
```

| Step | AI? | Model and tools | What it decides |
|---|---|---|---|
| App review → suggestions | yes, on a button | `claude.model` (CLI default), Read/Grep/Glob over `origin/main` + the Insights facts file, ~$0.80 | the findings, refactors and growth items and their ticket summaries |
| Duplicate check of a suggestion | **no** | plain code, `wordsAlike()` on summaries (`suggestions.mjs:26`) | hidden / "already open" / creatable |
| Type, priority, person of a suggestion | no | plain code (knowledge map) | |
| Analysis of a reported ticket | yes, automatic | `claude.analysisModel` (Sonnet), the skill with read-only shell | related tickets, `duplicateOf`, cause, owner |
| Creating the ticket | no | the watcher, after a person confirms | |

## 2. Findings

| # | Finding | Evidence |
|---|---|---|
| F1 | **The knowledge base is nearly empty.** MediAgenda `main`: 2 entries (DEM-32, DEM-33, both colour change requests) in 4 files. MediLab: LAB-23 sits unmerged on `docs/LAB-23` since 2026-11-10. MediFarma, MediBill: nothing. None of the seeded history (DEM-5 Struttura, the birth date bug, the cancelled slot) is documented. | `git ls-tree origin/main docs` in the four app repos |
| F2 | **Only tickets the agent analyzed are documented**, and only when they reach Done within `lookbackHours` (72 h). A ticket fixed by a person without the agent, before the agent existed, or while the watcher was down for more than 72 h is never documented. | `DONE_JQL` requires `labels = ai-analyzed` and `updated >= -72h` |
| F3 | **Unmerged knowledge is invisible.** Every reader uses `origin/main` (FR-44, `ask-repo`), the documentation PRs are drafts, and nothing reminds anyone to review them. | `document.mjs` opens a draft PR and stops; LAB-23 |
| F4 | **Three different names for one component.** Knowledge files use path slugs (`frontend-src.md`, `e2e.md`), Insights uses business names (Pazienti, Prenotazioni), and people ask about screens and URLs. `frontend/src` is too broad (every global style lands there), `e2e` is tests, not a component. DEM-33 (a Pazienti change) is recorded under `frontend/src`, and the same two tickets appear in three files. | `docs/knowledge/README.md` on MediAgenda; `componentOf()` in `code.mjs:32` |
| F5 | **Entries contain statements that go stale**: "may not be merged into main yet" (DEM-32), "draft PR #14, not merged as of 2026-11-06". Nothing updates an entry when the fix PR is merged or the code changes. | `frontend-src-app-features-patients.md` |
| F6 | **Entries are hard to find by symptom.** There is no line with the exact error text, the screen or route, or the words a user would use. The analysis greps the docs only for ticket keys and strong clues, so a recurrence reported in other words, whose earlier ticket the Jira search did not find, misses the entry. | `code.mjs:246` uses `[...keys, ...strong]`, not `weak` |
| F7 | **Ask search by words is naive** (from the code; **not observed on the demo data**, see K1: the projects are so small that Ask collects nearly every ticket for every question). No stemming (`greška` ≠ `greške`), no translation (a Serbian question vs Italian/English tickets), noise words are search terms (`show`, `last`, `page`, `localhost`, `http`), a URL is not mapped to its screen, and "the last bug" is not a structured query (`issuetype = Bug ORDER BY created DESC`). | `keywords()` in `ask.mjs:19`; `asks.jsonl` questions "show me last bug", "…http://localhost:4200/agenda" |
| F8 | **Ask hides failures.** Both Jira searches end in `.catch(() => [])`, so a Jira error looks like "not in the knowledge base". Tickets that exist only in commit subjects cannot be cited: `checkSources` accepts a ticket only from `tickets.json` or the analyses. Example (2026-11-12, MediBill): Jira returned no tickets (the credentials were rejected, see F16), git has BIL-16…18; the answer cited three commits, could not cite the tickets, and said "not in the knowledge base". | `ask.mjs:33-34`, `:82`; `state/projects/BIL/ask/2026-11-12T16-05-48-982Z/` |
| F9 | **Ask collects too much and too little.** All saved analyses unfiltered (grows with every ticket); a fixed 400 commits (older history is lost); up to 30 tickets fetched one by one. | `ask.mjs:37-48` |
| F10 | **Ask sees one project.** Analysis and Insights read the linked apps; Ask does not, and `checkSources` drops a `DEM:backend/…` file. A MediBill question whose answer is in MediAgenda history ("why are cancelled visits charged?") cannot be answered with its real cause. | `ask.mjs:85` path regex; no peers in `askQuestion` |
| F11 | **Questions teach nothing.** `asks.jsonl` is an audit log only: no feedback, "not found" questions are not collected as gaps, a good answer is not kept. | `ask.mjs:143` |
| F12 | **The fix and the AI review do not use the knowledge.** Their prompts do not mention `docs/knowledge`, so a "Prevent recurrence" note or a documented pitfall is not applied or checked. The app repos have no `CLAUDE.md`, so the "project conventions" lever of [AGENT_TRAINING.md](AGENT_TRAINING.md) is unused. | `agent/lib/fix.mjs`, `agent/lib/review.mjs`; `git ls-tree origin/main` |
| F13 | **No quality gate on entries.** Besides the path check: no format check, no check that cited commits and tickets exist, and **no patient-data check**, although an entry is permanent in git history (R-02 is still open). | `document.mjs:59` |
| F14 | **"People who know it" duplicates the Insights knowledge map and goes stale**, and lists the Ticket Intelligence Agent as a person (Insights deliberately does not). | the entries on MediAgenda |
| F15 | **Not measured.** `score-run.mjs` scores analysis and fix. Ask has two acceptance questions; nothing checks whether the analysis recognizes a documented recurrence. | `docs/AGENT_TRAINING.md`, ROADMAP #6 |
| F23 | **The demo reset throws knowledge away.** `reset-demo.mjs` closes every agent PR, documentation included, and deletes its branch: on MediAgenda 7 of 9 documentation PRs are closed unmerged; LAB-23's (#3) is closed with its branch left. | `demo/reset-demo.mjs:10,60`; `gh pr list` (found in K2) |

**New tickets and prior art**

| # | Finding | Evidence |
|---|---|---|
| F16 | **Jira is unreachable right now and nothing says so.** `ticket.mjs check` gets 401 (credentials rejected). Without valid credentials, `project = DEM` returns **0 tickets with status 200**, not an error. So the watcher picks nothing, Insights shows 0 tickets in all four projects, Ask finds no tickets, and the duplicate check of the suggestions has nothing to compare with: all 55 suggestions look new. The dashboard shows no warning. | 2026-11-12: `/rest/api/2/myself` → 401; `/api/insights` → `tickets: 0` for DEM, LAB, FAR, BIL |
| F17 | **Suggestions are compared by summary words only.** An identical normalized summary (any status) hides a suggestion; ≥ 60 % of the words alike with an **open** ticket shows "already open as". The same problem in other words passes. A Done ticket never blocks ("a regression worth a ticket"), but the suggestion then does not say which ticket or fix it repeats. Checked with a working Jira (2026-11-12): none of the 61 suggestions of the four projects shows "already open"; the three marked "created" (LAB-23, LAB-24, DEM-41) are recognized only because they were created from the suggestion itself (`suggestions-created.json`), not because their content was compared. | `suggestions.mjs:169-179`; `/api/insights`; `demo/score-prior-art.mjs` |
| F18 | **Nobody checks that the problem is still there.** Suggestions come from the cached AI review, also when it is stale (all four reviews are from 2026-11-09 and marked stale). MediLab's "values typed with a decimal comma are saved without decimals" was created as LAB-23 from the suggestion and fixed on main on 2026-11-10 (a427822); the list shows only "created LAB-23", never that it is fixed, and a ticket for it written by hand in other words would leave the suggestion "new". Creating a ticket re-checks nothing: the watcher reuses the cached Insights and calls `createIssue`. | `/api/insights?project=LAB`; `watcher.mjs:438-443` |
| F19 | **The checks ignore what the agent already knows**: the saved analyses (cause, files), open fix PRs and branches of other tickets, knowledge entries, and the linked projects' tickets. MediBill suggests "cancelled MediAgenda visits are charged on import", which is the cause the agent found for BIL-19 and BIL-20. | `suggestTickets()` reads only `insights.tickets`; AGENT_TRAINING.md (BIL-19/20) |
| F20 | **The AI review is not asked to avoid known items.** It gets every ticket's summary but no instruction to leave out (or name) what an open ticket already covers, and it does not see open PRs. | `app-review.mjs:107-134` |
| F21 | **For a reported ticket, only "open duplicate" is structured.** `duplicateOf` means an open ticket. "Solved before" (a Done ticket with the same symptom), "already fixed on main, not released yet", "a fix PR of another ticket is open" and "regression of KEY" exist only as free text, if at all. So the watcher cannot act on them: it still tries an automatic fix (only open duplicates are skipped), and the draft reply cannot say "known problem, fixed in …". The branch check finds only a branch named after the same key. | `analyze.mjs:46`; `pipeline.mjs:57`; `code.mjs:238` |
| F22 | **The person who confirms sees no near-matches.** The editor shows nothing below the 60 % threshold, and duplicates are never linked in Jira (by design), so "A duplicates B" lives only in the agent's state. | `dashboard/index.html:814`, `suggestionEditor()` |

## 3. Goals and metrics

| Metric | How it is measured | Today | Target |
|---|---|---|---|
| Coverage | Done bugs with a fix commit that have an entry on `main` (`document-backfill.mjs` prints it) | before (2026-11-12): 0/12 DEM, 0/13 LAB, 0/10 FAR, 0/11 BIL. **After the backfill (2026-11-13): 12/12, 13/13, 10/10, 11/11**, 0 lint findings on any main | ≥ 80 % per project |
| Review lead time | documentation PR opened → merged | open indefinitely (LAB-23: 2 days and counting) | median ≤ 2 working days |
| Ask quality | eval set (K1): correct "found", expected sources cited, nothing invented | 23/24 pass, 0 invented shown (2026-11-12; the demo data is too small to test retrieval) | ≥ 85 % pass, 0 invented sources, and the cross-app question answered |
| Recurrence recognized | eval scenario (K1): a repeat of a documented bug in other words; the analysis cites the entry | not measured | the entry is cited in the scenario run |
| Cost per question | `asks.jsonl` | $0.07–0.37 | ≤ $0.25 average |
| Jira outage noticed | time from the first 401 to a visible warning | never (F16) | ≤ one poll (30 s) |
| Prior-art verdict | eval (K21): correct verdict on known cases | suggestions 3/4 (2026-11-12) → **4/4** after K17/K19; reported tickets **4/4 verdicts right** (DEM-42, DEM-43, LAB-25, DEM-44; 2026-11-13), no false duplicate on the new problem | ≥ 90 %, and no "duplicate" on a genuinely new problem |
| Ask over the suite | eval cross-app questions | 1/2 → **2/2** after K11 | the cause in a linked app found |
| Duplicate tickets created | `ai-suggested` tickets later resolved as Duplicate, or with "already fixed" in the resolution comment | not measured | 0 |

## 4. Plan

Phase 0 sets the baseline. Phases 1–4 then change **one lever at a time**, re-running the eval after each item (the rule in [AGENT_TRAINING.md](AGENT_TRAINING.md)). Estimates are for one developer working with Claude Code.

### Phase 0: baseline

**K1. Knowledge eval set** · 0.5 d · F15
- `demo/ask-scenarios.json`: per project 6–10 questions with the expected tickets/commits (the answer key stays outside the app repos, like `scenarios.json`). Kinds: history ("has the Struttura bug happened before?" → DEM-5), who ("who knows the time slot code?"), where, latest ("the last bug"), cross-app ("why are cancelled visits charged in MediBill?" → DEM-17 / CUP_DEMO-2533), and 3 that must be "not found" (SAP export).
- `demo/score-ask.mjs [--project X] [--all]`: runs `askQuestion`, scores found-correct, expected sources cited, invented sources dropped (`dropped`), time and cost; writes the table that goes into AGENT_TRAINING.md.
- Recurrence scenario `birth-date-repeat`: document `birth-date` first, then create a ticket with the same symptom in other words ("data di nascita sbagliata dopo il salvataggio"); `score-run.mjs` checks that the analysis cites the knowledge entry.
- **Acceptance:** baseline numbers recorded for DEM and LAB.
- **Done 2026-11-12.** `demo/ask-scenarios.json` (24 questions, 4 projects), `demo/score-ask.mjs`, `demo/prior-art-cases.json`, `demo/score-prior-art.mjs`, scoring in `demo/lib/eval.mjs` (tested in `agent/test/eval.test.mjs`); `score-run.mjs` checks `expected.priorArt` and `expected.knowledgeEntry`; scenarios `struttura-again` and `lab-decimal-again` added; Ask got a `logDir` so eval runs stay out of the real question log. Baseline in [AGENT_TRAINING.md](AGENT_TRAINING.md#knowledge-and-prior-art):
  - Ask **23/24** (DEM 10/10, LAB 8/8, FAR 3/3, BIL 2/3), 0 invented sources shown, avg 15–17 s and $0.13–0.21 per question, $4.11 in all. The one miss is the cross-app question (K11).
  - Prior art of suggestions **3/4**: the miss is "fixed by LAB-23" (K18/K19).
  - Not run yet: the reported-ticket scenarios (they create Jira tickets and run the full pipeline) and the recurrence check (n/a until an entry for DEM-5 is on main, K4).
- **What the baseline changes in the plan.** The demo projects have 18–26 tickets and Ask collects 15–23 of them for every question, so the keyword search cannot miss here: the Serbian, URL and "latest" questions all pass. F7 stays a hypothesis, and **K8 (search plan) moves after K11 and waits for data that can show a miss** (a real project, or a larger seeded history). K11 (Ask over the suite) is confirmed by the only miss.

**K16. Jira health guard** · 0.5 d · F16, F8 · **Done 2026-11-12** (FR-47; `agent/lib/jira-health.mjs`, `agent/test/jira-health.test.mjs`; checked live with a wrong token: header "Jira unavailable: credentials rejected (401)", state "paused", Insights/Ask/Run → 503 with the reason, `ask.mjs` exits without an AI run, one `jira-down` event)
- `jira.health()`: `GET /rest/api/2/myself` plus `GET /rest/api/2/project/<KEY>` for every watched project, at watcher start and on each poll (cached 5 minutes).
- On failure: a red **Jira: unavailable (401 …)** chip in the dashboard header, one `error` event and one `failed` email per outage (not one per poll). Poll, Insights, Ask, documentation and **Create in Jira** stop with "Jira unavailable" instead of working on an empty list.
- A project that had tickets and now returns none gets a warning ("Jira returns no tickets for DEM; it had 40").
- **Acceptance:** with a wrong token the header shows it within one poll; Insights offers no suggestions as "new"; Ask says Jira could not be searched.

### Phase 1: knowledge exists and is visible

**K2. Documentation PRs get reviewed** · 0.5 d · F3, F1
- Dashboard: a **Knowledge** list per project with the open `docs/*` PRs, their age and a link; the morning digest (ROADMAP #3), once it exists, lists them too.
- New `policy.json` key `mergeDocs: off | draft | auto` (default `draft`): `draft` shows **Merge documentation** on the card, which the watcher carries out only after a confirmation (as `merge-fix.mjs --docs` does now); `auto` merges only when the PR changes nothing but `docs/knowledge/*.md` **and** the lint (K5) passes. `mergeFix` stays `off`.
- **Acceptance:** LAB-23's entry can be merged from the dashboard; a PR that changes anything else is never merged.
- **Built 2026-11-12** (FR-48): `agent/lib/docs-prs.mjs` (tested in `agent/test/docs-prs.test.mjs`), `GET /api/knowledge`, `POST /api/knowledge/merge`, **Insights → Knowledge base**, `mergeDocs: draft` in `policy.json`. Checked live: MediLab lists LAB-23 (#3) as "closed, not merged" with **Reopen and merge…**; MediAgenda shows 2 documented tickets on main. The merge itself waits for a person's click (the decision of section 8).
- **Found while building it (F23):** LAB-23's PR was not waiting for review: it was **closed without merging** (its branch is still there). On MediAgenda 7 of 9 documentation PRs are closed unmerged and only 2 merged: `demo/reset-demo.mjs` closes every agent PR, documentation included, and deletes the branches, so the knowledge of every rehearsal is thrown away. Proposal (with K4): the reset keeps `docs/*` PRs and branches by default (`--drop-docs` to discard them), because knowledge is meant to outlive a rehearsal.

**K3. Unreviewed knowledge is readable, labelled** · 0.5 d · F3
- `agent/lib/knowledge.mjs` → `pendingEntries(repoDir)`: entries on `origin/docs/*` branches that are not on `main` (`git diff --name-only origin/main...origin/docs/<KEY> -- docs/knowledge`, then `git show`). Ask and the analysis get them as **unreviewed**; an answer that relies on one says so.
- SVN: no change (documentation is committed directly, or kept as a patch).
- **Acceptance:** before LAB-23's PR is merged, "show me the fix of LAB-23" cites its entry marked unreviewed.

**K4. Every resolved bug is documented, not only the agent's** · 1 d · F1, F2
- `policy.json` → `documentScope: analyzed | withFix` (default `withFix`): the Done poll also takes tickets **without** `ai-analyzed` when a commit on `origin/main` (or a merged PR) names the key. Instead of `updated >= -72h`, the poll uses the time of the last poll (kept in `state/`), so downtime does not lose tickets.
- `node agent/document-backfill.mjs --project DEM [--since 2026-01-01] [--limit 10] [--dry-run]`: Done bugs with a fix commit and no entry → one run per ticket, **one** PR per batch (`docs/backfill-<date>`), so the team reviews 10 entries at once instead of 10 PRs. `--dry-run` lists the tickets and the estimated cost (from the first 3 runs).
- **Acceptance:** DEM backfill of the seeded bugs produces one PR; coverage (§3) is reported by the command.
- **Built 2026-11-12** (FR-40, FR-49): `agent/lib/doc-candidates.mjs` and `agent/document-backfill.mjs` (tested in `agent/test/doc-candidates.test.mjs`); `document.mjs` split into one documentation run (`documentOne`) used by the single ticket and by `documentBatch`; the prompt points at the fix on the ticket's branch or, for older and human fixes, at the commits on main; `documentScope: withFix` and the persisted check time in the watcher; `reset-demo.mjs` keeps documentation PRs (`--drop-docs`), which closes F23. Two deviations from the plan: the command is a **dry run by default** and needs `--yes` (like the other scripts that push), and its `--since` filters by the date of the fix commit, because the Jira dates of the seeded history are all from one day.
- **Dry run, 2026-11-12:** coverage on main is 0 of 12 (DEM), 0 of 13 (LAB, +1 waiting: LAB-23), 0 of 10 (FAR), 0 of 11 (BIL) resolved bugs; each project's first batch is 10 tickets, estimated ~$3.70 (one measured documentation run so far: $0.37). **Not run yet on purpose:** the backfill runs after K5, so the entries are written in the new format and pass the lint.
- **Trial after K5, 2026-11-12:** `--project DEM --limit 3 --yes` → DEM-3, DEM-4, DEM-5 documented in 175 s for **$1.73** (DEM-3 $0.88 with one lint correction: it had kept the agent among the people; DEM-4 $0.39; DEM-5 $0.46), 0 failed, one draft PR: MediAgenda #26 (`docs/backfill-202611122022`). The three new entries pass the lint; the remaining findings on that branch are the old DEM-32/DEM-33 entries (K6). Quality: causes confirmed by the fix commits and ticket comments, search terms in Italian and English, and DEM-5's "Prevent recurrence" names the hand-cleared Struttura field, which is exactly the `struttura` scenario (the recurrence check of K1). Real cost is ~$0.58 per ticket, not the $0.37 estimated from one run.

### Phase 2: entries are findable and trustworthy

**K5. Entry format v2 and a lint** · 1 d · F5, F6, F13, F14
- `document-ticket` SKILL.md section 5, new lines per entry:
  - **Search terms**: the exact error or validation text, the screen and route (`/pazienti`), field and button labels, and the words a user would use, in the ticket's language and in English.
  - **Type**: bug, change request, or configuration.
- Rules added to the skill: no statements about the state of a PR or branch (that goes in the PR body); "People who know it" lists people only, not the agent, and points to the Insights knowledge map.
- `agent/lib/knowledge.mjs` → `parseEntries(dir)` (one object per `### KEY: title` with its fields and anchor) and `lint(entries, { repoDir, project })`, plain code: required fields; Root cause labelled confirmed or assumed; cited commits exist (`git cat-file -e`); cited keys look like keys; no time-bound phrases ("not merged yet", "as of"); **no patient data** (Italian fiscal code, e-mail address, phone number, IBAN, dates of birth next to names).
- `document.mjs`: run the lint before the commit. On a finding, correct it **in the same session** (as `runClaude` already does for invalid JSON); if it still fails, `ai-doc-failed` with the findings, and nothing is pushed.
- `node agent/knowledge-lint.mjs --project DEM`: lint what is on `main` (for the existing entries and the backfill).
- **Acceptance:** unit tests in `agent/test/knowledge.test.mjs` (a good entry, each failing rule, a fiscal code); the DEM-32 entry fails on "may not be merged" and passes after the fix.
- **Built 2026-11-12** (FR-50, FR-52): the skill's format v2 (Type, Search terms, short reference entries, no PR/branch state, people only, personal data named) installed with `node install.mjs`; `agent/lib/knowledge.mjs` (`parseKnowledgeFile`, `lintKnowledge`), the lint with one correction in the same session in `document.mjs` (`runClaude` now returns the `sessionId`), and `agent/knowledge-lint.mjs`. Tests: `agent/test/knowledge.test.mjs`, including no false alarm on dates, amounts, booking codes and lab values. Narrowed from the plan: the ticket-key rule flags only fixture-style keys (`CUP_…`), because `UTF-8` or a booking number `RL-2026-00058` look like keys too.
- **Lint of what exists (2026-11-12):** MediAgenda main, 9 findings: DEM-32 and DEM-33 lack Type and Search terms, DEM-32 says "may not be merged" and DEM-33 "draft PR", and all three component files list the agent among the people. The LAB-23 branch: Type and Search terms missing. These are old-format entries; they are rewritten by the K6 migration (one reviewed PR), not by hand.

**K6. One component name everywhere** · 1 d · F4
- `agent/lib/components.mjs`: one resolver used by Insights, the documentation and the analysis: `insights.components` (business names) when configured, otherwise the path rule of `code.mjs`. Test files belong to the component they test (`e2e/tests/DEM-32.spec.ts` → the screen it opens; `src/test/java` → its main package), never to a component of their own.
- The knowledge file is `<docsPath>/<component-slug>.md` (`pazienti.md`, `prenotazioni.md`) with the paths listed inside it; the analysis bundle passes the name to the skill (`components[].knowledgeDoc`).
- A one-time migration (a documentation PR, reviewed) moves the existing entries of MediAgenda and the LAB-23 branch.
- The analyze-ticket skill keeps working without an agent config (Copilot, SVN): it falls back to the path rule, as now.
- **Acceptance:** the Insights drill-down of a component links its knowledge file; DEM-32 and DEM-33 sit in `pazienti.md`.
- **Done 2026-11-12** (FR-53): `.claude/skills/analyze-ticket/scripts/lib/components.mjs` (rules from `.ticket-intel.json` → `components` or `TICKET_INTEL_COMPONENTS`, which the agent sets from `insights.components` for the analysis and the documentation); `code.mjs` names `knowledgeDoc` after the component (`component` field; no file for a path outside the named components, e.g. `e2e`); the `document-ticket` skill uses it; `agent/lib/knowledge-migrate.mjs` + `agent/knowledge-migrate.mjs`; the Insights drill-down link (checked: Prenotazioni → `prenotazioni.md`). Tests: `agent/test/knowledge-migrate.test.mjs`.
  - **MediAgenda migrated:** 13 path-named files → 6 component files (Agenda search, Fasce orarie, Pazienti, Prenotazioni, Report, Shared) and a rebuilt index, PR #28 merged; DEM-32 and DEM-33 rewritten by hand in the current format (Type, Search terms, no PR state) in the same PR. Main now: **14 documented tickets, 0 lint findings**. DEM-32 is in `pazienti.md`; DEM-33's full entry is in `shared-forms-dates-layout.md` (its fix is the shared style token) with a reference in `pazienti.md`, not in `pazienti.md` as the acceptance guessed.
  - **Found and fixed while testing:** after the backfill, documentation commits ("DEM-3: document …") name their ticket, so the analysis counted `docs/` as a component of the ticket and listed them among the ticket's fix commits. `code.mjs` now leaves files under `docsPath` out of the component scores and drops commits that only touch the knowledge base. Also, the documentation agent tried to run `knowledge-lint.mjs` itself because the skill named it; the skill now says the agent's code runs the checks.
  - **Backfill of the suite, with component names (2026-11-12/13):** MediLab 13 (PRs #4, #5; LAB-23 again, in the current format, with `--include-waiting`), MediFarma 10 (PR #2), MediBill 11 (PR #2); all merged after the lint found nothing. Whole backfill: **46 tickets, ~$20** ($0.29–1.06 per ticket, average ~$0.43). Two problems found and fixed on the way: (1) the account's 5-hour usage limit stopped the first FAR/BIL run; every ticket failed in turn, nothing was pushed; the batch now stops at a usage-limit error and reports the rest as not run. (2) A race: the backfill commented on each ticket before labelling it `ai-documented`, and the watcher (`documentScope: withFix`) took FAR-10 in between and documented it again (duplicate PR MediFarma #3, closed). The label now comes first. And the Knowledge base list no longer offers a closed PR of a ticket documented on main since (LAB-23's #3).
  - **Observed, not changed:** for DEM-3 the top-ranked component is still `e2e` (regression tests of related tickets); tests have no knowledge file now, but they still weigh in the analysis ranking. Worth a look with the analysis scenarios (AGENT_TRAINING), not part of K6.

**K7. Entries stay current** · 0.5 d · F5
- When a fix PR is merged (`merge-fix.mjs`, or the poll seeing it merged) and its ticket has an entry, the entry's **Fix** line is updated by code (merge commit added); no AI run.
- `knowledge-lint` also lists entries whose key files no longer exist on `main` → Insights "stale entries".
- **Acceptance:** after merging a fix the entry names the merge commit; a renamed file shows the entry as stale.
- **Done 2026-11-13** (FR-59), as a command rather than a hook on every merge: `agent/lib/knowledge-refresh.mjs` (`planRefresh`) and `agent/knowledge-refresh.mjs` (dry run; `--yes` = one draft PR on `docs/refresh-<time>`, kept by `reset-demo`). Tests: `agent/test/knowledge-refresh.test.mjs` (the merge commit added, nothing when named or absent, a missing file → stale). The first dry run on the suite found two false alarms in my own code, both fixed: the "commit on main" of DEM-32 was DEM-40's (it names DEM-32 in its body; now only a commit whose subject starts with the key counts), and LAB-23 looked stale because its entry cites `shared/utils/numbers.ts` (a path shortened from the front now matches). After that: all four projects clean. The dashboard does not show stale entries yet; the command is meant for the night shift (ROADMAP #3).

### Phase 3: better retrieval

**K8. A search plan for each question** · 1 d · F7
- One small model call **without tools** (`claude.searchModel`, default `haiku`) turns the question into `{ intent: history|who|where|latest|howto|other, terms: { en, it, original }, routes, components, issueType, since }`. The question is data; the output is validated JSON, and only known fields are used.
- Plain code builds the queries from it: `text ~` per term (all languages), plus structured filters (`issuetype`, `created >=`, `ORDER BY created DESC` for "latest"). A URL or route is mapped to its component with the app's route table (`app.routes.ts`, parsed by code) and `insights.components`.
- If the call fails: the current `keywords()`, and the answer says the search was simplified.
- Also: stemming for EN/IT/SR in `keywords()`, and URL parts (`http`, `localhost`, ports) as stop words.
- **Acceptance:** eval (K1) "show me last bug" and the two URL questions improve; cost per question stays within the target.

**K9. Knowledge first, then the rest** · 1 d · F6, F9
- Ask: `parseEntries` (K5) of `main` + pending (K3), scored by code against the plan's terms, keys and components → `knowledge.json` (top 8 entries, each with file and anchor). The prompt says: read `knowledge.json` first. New source type `knowledge` (file + anchor), checked like a file.
- Analyses: only those that match a key, component or term (max 20), not all.
- Git: the 400 newest commits **plus** `git log -i --grep=<term>` per term (older history reachable).
- Tickets fetched 5 at a time.
- Analysis (`code.mjs`): the doc search also uses the weak keywords and the entries' **Search terms**; the bundle returns the matching entries (key, title, anchor) instead of only file names. SKILL step 8: when an entry matches the symptom, the report says "possible recurrence of KEY" and cites it. The result contract gets an optional `knowledgeEntries[]`, and Insights' `recurringBugs` counts it as `via: 'knowledge'`.
- **Acceptance:** the recurrence scenario (K1) cites the entry; Ask's average cost does not rise.

**K10. Ask is honest about failures** · 0.5 d · F8
- No silent `.catch(() => [])`: a failed source is a `warning` in the answer ("Jira search failed: …"), shown on the page and logged. When Jira failed, "not found" says "Jira could not be searched", not "not in the knowledge base".
- A ticket key that appears in a commit subject of the collected log is a valid source with `inJira: false`.
- **Acceptance:** with the Jira URL broken, the answer shows the warning; the BIL question above cites BIL-18 from git.
- **Done 2026-11-13** (FR-65): `collect()` turns every failed source (each Jira search, tickets Jira could not return, the saved analyses, the git log) into a warning; the run's prompt names what could not be checked; `withWarnings()` makes a "not found" after a failed Jira search say "Jira could not be searched"; `checkSources()` keeps a ticket named only in a commit subject (`inJira: false`); the full tickets are fetched five at a time; the dashboard and `ask.mjs` show the warnings. Tests in `agent/test/ask.test.mjs` with a Jira that fails one search and one ticket. A Jira that is down as a whole is stopped earlier by K16, so the acceptance case "Jira URL broken" is covered by the unit test, not live. Live check: the MediBill question that said "not found" on 2026-11-12 ("show me last bug ?") now answers BIL-18 with its fix commit (8 s, $0.12).

**K11. Ask over the suite** · 1 d · F10
- Ask on a project with `linked` projects also gets their knowledge entries, their git log and their read-only checkouts (`peerCheckouts` already exists); with **All projects** selected, all projects. Sources from another project are written `KEY:path` and checked in that project's checkout.
- **Acceptance:** the cross-app eval question finds the MediAgenda cause.
- **Done 2026-11-13** (FR-56): `collect()` searches `project in (own, linked)`, writes `git-log-<KEY>.txt` per linked app; the run gets read-only checkouts of the linked apps (`ask-peer-repo`, apart from the analysis'); `checkSources()` checks `KEY:path` files and linked commits there, with links to the right repository; the watcher, `ask.mjs` and `score-ask.mjs` pass the linked apps. "All projects" is not a mode of Ask yet: a question is still asked in one project, which reads its linked apps. Eval: LAB 8/8, FAR 3/3, **BIL 3/3 (was 2/3)**: the MediBill question now finds DEM-17.

### Phase 4: the loop closes

**K12. Feedback and knowledge gaps** · 1 d · F11
- Ask: 👍 / 👎 and an optional "the right answer is …" under each answer, stored in `asks.jsonl` (local, as now).
- Insights → **Knowledge gaps**: questions answered "not found" or 👎, grouped by component and terms; plus components with bugs but no entries (coverage per component).
- `suggestions.mjs`: a gap that recurs (≥ 2 questions) becomes a suggested Task "Document …" with the questions as its description, through the existing `createTicket` flow (draft, a person creates it).
- **Acceptance:** two "not found" questions about the same component produce one suggestion.
- **Done 2026-11-13** (FR-57): `agent/lib/gaps.mjs` (`knowledgeGaps`, `coverageByComponent`), `POST /api/ask/feedback` (local `ask-feedback.jsonl`), 👍/👎 with a note under each answer, **Insights → Knowledge gaps** (groups of questions, and the coverage per component built on the page from the Insights components and the entries on main), and a `knowledge-gap` suggestion for a group of two or more (its summary stays stable as questions are added). Tests: `agent/test/gaps.test.mjs`. Grouped by shared search words rather than by component: a question rarely names its component. Live: MediAgenda shows one open question (the SAP export) and 12/12 resolved bugs documented across its five components.

**K13. Knowledge used by the fix and the review** · 0.5 d · F12
- The fix prompt gets the matching entries (K9) of the components it touches, with their **Prevent recurrence** notes. The review prompt gets them too and checks that the change does not bring back a documented cause.
- **Acceptance:** for a scenario touching `dates.ts` after `birth-date` is documented, the review mentions the documented pitfall when the change uses `toISOString()`.
- **Done 2026-11-13** (FR-58): `knowledgeFor()` in `agent/lib/knowledge.mjs` (entries of the given tickets and entries citing the files, at most 4, with root cause, fix and prevention), used by `fix.mjs` (files of the analysis, its prior art and related tickets; a progress step names them) and `review.mjs` (files of the diff; check 6 "Known issues"). Tests in `agent/test/knowledge.test.mjs`. Checked with the DEM-42 PR instead of the birth-date case (that bug is not documented: it was never fixed): `review-one.mjs DEM-42 --dry-run` → "This follows the DEM-5 'Prevent recurrence' note", low risk, $0.20.

**K14. From recurring entries to project conventions** · 0.5 d · F12
- When two or more entries share a root cause (the lint and the recurrence links show it), the documentation run proposes a line for a **Known pitfalls** section of the app's `CLAUDE.md` / `.github/copilot-instructions.md`, in the same documentation PR, for a person to accept.
- **Acceptance:** a draft line appears in the PR, never committed to `main` without review.

**K15. A good answer becomes an FAQ entry** · 0.5 d · later
- An answer with 👍 can be promoted (button, `policy.json` → `promoteFaq: draft`) to `docs/knowledge/faq.md` (question, answer, sources) through a documentation PR. Only after K12 shows which questions repeat.

### Phase 5: prior art before a new ticket

The target flow, the same for both ways a ticket appears:

```
new item: a suggestion (Insights)  or  a ticket a person reported
   │
   ├─ K16  Jira healthy? ── no ──▶ stop and say so
   ├─ K17  prior art, plain code: Jira (own + linked projects, all statuses) · saved analyses · knowledge entries
   │       · open PRs and branches touching the same files · commits on main since the item was written
   ├─ K18  AI verdict on the top 5 candidates (no tools); for a stale review finding: a read-only re-check of the code
   │
   ├─ suggestion ─▶ status chip + "Before you create" panel ─▶ person: create · create anyway (with a reason) · drop
   └─ ticket     ─▶ priorArt in the analysis ─▶ watcher: fix or not, comment, draft reply, draft Jira link
```

**K17. One prior-art check, in plain code** · 1 d · F17, F19
- `agent/lib/prior-art.mjs` → `priorArt({ project, text, files, component, since })`, used by the suggestions, the analysis bundle and Ask. It returns up to 5 candidates, each with a kind and its evidence:

  | Kind | Source | How |
  |---|---|---|
  | open ticket | Jira, own and linked projects, live | JQL `text ~` with the search plan's terms (K8), all statuses |
  | solved before | Jira Done + its fix commit on main | the same search, Done with a commit naming the key |
  | fixed on main since | git | `git log <since>..origin/main -- <files>`, ticket keys from the subjects |
  | fix in progress | open PRs and remote branches | `gh pr list --state open --json number,headRefName,title,files`; `origin/<KEY>` branches touching the files |
  | analyzed | saved analyses | same files or component and overlapping cause words |
  | documented | knowledge entries (K5) | key, search terms, files |

- Scored by code (same file, same component, words alike, same linked-project value), with the reason for each score. If Jira is down it throws (K16); it never returns "nothing found" on a failure.
- **Acceptance:** unit tests with fixture data for each kind.
- **Done 2026-11-13** with K19 (see there). Simplified from the plan: the Jira tickets come from the Insights data already loaded (own project, every status, with their commits), not from a new JQL search per item, and linked projects are not searched yet; "fixed on main since" is a property of a resolved ticket's fix commits (`fixed-by`), not a separate scan of the git log.

**K18. The AI decides only on the close candidates** · 1 d · F17, F18
- One call **without tools** (`claude.priorArtModel`, default `haiku`) gets the new item and the top 5 candidates as text (summary, description excerpt, cause, files, fix commit subject). It returns for each candidate `same | related | different`, and one verdict: `new`, `duplicate-of KEY`, `fixed-by KEY/commit`, `in-progress PR`, `regression-of KEY` or `documented ENTRY`. Code validates it: every key, commit and PR must be one of the candidates, otherwise the verdict is `new` with a warning.
- For an AI-review finding whose file changed since the review: a short read-only run (Read/Grep/Glob, its own checkout of `origin/main`) checks whether the problem is still in the code. It answers `still-there` or `gone`, citing lines. It runs only when a person opens that suggestion, not on every Insights load.
- **Acceptance:** cost ≤ $0.03 per verdict without the re-check; the decimal-comma finding of MediLab comes back `gone`, citing `parseDecimal` (a427822).

**K19. Suggested tickets use it** · 1 d · F17, F18, F19, F20, F22
- Each suggestion carries its prior art (computed on refresh, cached with the Insights fingerprint). The list shows a chip: **new**, **already open KEY**, **fix in progress PR**, **fixed by KEY** (hidden behind "show resolved"), **regression of KEY**.
- The editor gets a **Before you create** panel: the candidates with their verdicts and links. When the verdict is not `new`, **Create** asks for a reason, which goes into the description. A regression gets "Regression of KEY (fixed in commit …)" in the description and an optional Jira link "relates to" (`policy.json` → `linkTickets: draft`).
- At creation the watcher runs K17 again **live** (not from the cache) and answers 409 when a new candidate appeared since the editor opened.
- The app review (`app-review.mjs`) also gets the open tickets, the open PRs and the knowledge entries, and is asked to return an item that an open ticket already covers as `existing: [{ key, why }]` instead of proposing it.
- **Acceptance:** the MediLab decimal-comma suggestion shows "fixed by LAB-23 (a427822)" and is hidden; a reworded copy of an open ticket shows "already open"; MediBill's "cancelled visits are charged" shows the BIL-19 analysis.
- **Done 2026-11-13, together with K17** (FR-54): `agent/lib/prior-art.mjs` (`priorArtCandidates`, `codeVerdict`, `loadPriorArtSources`), wired into `suggestTickets` (watcher: sources cached 2 minutes per project, fresh on create), the list chips and *show the fixed ones*, **Before you create** with the reason required for a non-new verdict, `priorArtSection` in the description, the 409 on create when the live check says otherwise, and the app review's `existing` list. Tests: `agent/test/prior-art.test.mjs`. Prior-art eval: **4/4** (was 3/4).
  - **Calibrated on the 61 real suggestions.** The first weights let a shared file make almost every ticket a candidate (~0.5 for 2–10 % common words) and called LAB-23 the fix of an unrelated suggestion in the same file. Now words decide: a candidate needs ≥ 12 % common words, "fixed-by" ≥ 30 %, and the verdicts need high scores (fixed-by 0.6, duplicate 0.75, in progress 0.6). Result: 4 verdicts that are not "new" (all right), related tickets on 18 suggestions.
  - **Deviations from the plan:** without K18 the verdict is the code's (thresholds above), so "regression of KEY" is not a verdict yet (a resolved ticket before the suggestion is shown as *related*); the Jira link (`linkTickets: draft`) is not built, the related tickets go into the description instead; the acceptance case for BIL-19 cannot be run (the BIL-19/20 tickets were deleted by a demo reset; MediBill's suggestion stays "new", which is right without them); "a reworded copy of an open ticket" is covered by the unit test, not by the demo data (no such pair exists).

**K20. Reported tickets: prior art in the analysis** · 1 d · F21
- The `ticket.mjs analyze` bundle gets `priorArt` (K17). It is the same code, so Claude Code and Copilot users get it too (git; on SVN without PRs).
- `analyze-ticket` SKILL.md gets a step **"Already known?"**, checked in this order: documented entry → open duplicate → fix in progress → fixed on main after the ticket's version → solved before (Done, same symptom) → regression. The report gets an **Already known?** line.
- Result contract: optional `priorArt: { kind: none | duplicate | in-progress | fixed-on-main | solved-before | regression, key, commit, pr, entry, why }`. `duplicateOf` stays for compatibility.
- The watcher acts per kind:

  | Kind | Automatic fix | Jira comment | Draft reply to the reporter |
  |---|---|---|---|
  | duplicate | no (as now) | "possible duplicate of KEY" | already reported, follow KEY |
  | in-progress | no | links the PR | a fix is being prepared |
  | fixed-on-main | no | "fixed on main by commit … (KEY); not released yet?" | fixed, comes with the next release |
  | solved-before | yes if the cause is new; handoff names the earlier resolver | cites the earlier fix and entry | — |
  | regression | yes; the earlier ticket's test must still pass, and the AI review checks both | "regression of KEY, brought back by commit …" | — |

- Insights' `recurringBugs` counts `regression` as `via: 'analysis'`.
- **Acceptance:** the K21 scenarios.
- **Built 2026-11-13** (FR-55): the skill's `lib/known.mjs` (`knownProblems`), `code.mjs` adds `knowledgeDocs.entries` (entries of the ticket, of related tickets from relevance 0.3, or with several words in common) and `otherFixBranches` (git: other tickets' remote branches that change the top components; SVN: not compared), the bundle's `priorArt`; SKILL.md step **Already known?** (7 kinds in a fixed order) and a report line; the agent's `priorArt` field, `normalizePriorArt`, `fixBlocker` with `policy.proposeFixWhen.skipKnown`, the `prior-art` event, the card, the email and Insights' recurrence. The knowledge-file parser moved into the skill (`lib/knowledge-file.mjs`) so the analysis and the agent read entries the same way. Tests: `agent/test/known.test.mjs`.
  - **Calibrated on LAB-24, LAB-19, DEM-22, DEM-25, BIL-12:** matching entries by words first pulled half the knowledge base ("with", "from", "request"); now an entry needs 3 words in common and a fifth of its own words, related tickets count from relevance 0.3, and at most 6 entries are passed.
  - **Scenarios (2026-11-13, K21 b/c/e and the K1 recurrence check):** DEM-43 duplicate of DEM-42 ✓; LAB-25 fixed-on-main LAB-23 with the release caveat ✓, no fix; DEM-44 none ✓, fixed (PR #29, review low risk); DEM-42 solved-before DEM-5 citing `agenda-search.md#dem-5-…` ✓ (the recurrence is recognized through the knowledge base). **Found:** two reports 1.5 s apart named each other duplicates and neither got a fix. Fixed in `fixBlocker`: a duplicate holds the fix back only when it points at an older ticket (same project: lower number) (`isOlder`, tested).
  - **Scored (`score-run.mjs --all`):** 27/29, then **29/29** after two fixes found by the run: the duplicate rule above, and the owner (the analysis took the person who squash-merged the agent's fix PRs for the code's expert; agent-written commits are now left out of the component authors). DEM-42 was fixed after the rerun (PR #30, review low risk).
  - **Live dry run (`analyze-one.mjs LAB-24`, no Jira write, 32 s, $0.20):** `priorArt.kind: none`, with the reason "LAB-11 and LAB-23 are in the same area but have different symptoms"; the origin traced to LAB-7. A true negative, no false duplicate. The positive cases need the scenario tickets (K21 b, c, e), which create Jira tickets: they wait for a go.

**K21. Eval for prior art** · 0.5 d · F15
Added to the K1 eval set:
- (a) the MediLab decimal-comma suggestion → `fixed-by LAB-23`;
- (b) a new ticket repeating an open one in other words → `duplicate`;
- (c) a ticket for the birth-date bug after its fix is merged → `fixed-on-main`;
- (d) the Struttura bug brought back by a later commit → `regression-of DEM-5`;
- (e) a genuinely new problem → `new`, with no false "duplicate".

It measures correct verdicts, false duplicates (target 0 on (e)) and cost.

## 5. Order and effort

```
Phase 0  K16 Jira health ─ K1 eval baseline (+ K21 cases)
Phase 1  K2 review loop ─ K3 pending readable ─ K4 coverage + backfill
Phase 2  K5 format + lint ──┬─ K6 one component name ─ K7 freshness
Phase 3  K8 search plan ────┴─ K9 knowledge first ─ K10 honest failures ─ K11 suite
Phase 4  K12 feedback + gaps ─ K13 fix/review use it ─ K14 conventions ─ (K15 FAQ)
Phase 5  K17 prior art (code) ─ K18 AI verdict ─┬─ K19 suggestions
                                                └─ K20 reported tickets
```

After the K1 baseline, K8 waits until a dataset can show a retrieval miss (see K1); K9–K11 do not depend on it.

K5 comes before K4's backfill runs in bulk, so the backfilled entries already have the new format and pass the lint (run K4's command after K5; build it before). K17 uses the search plan (K8) and the knowledge entries (K5); a first version can use `keywords()` and run before them.

| Phase | Items | Effort |
|---|---|---|
| 0 | K16, K1, K21 | 1.5 d |
| 1 | K2, K3, K4 | 2 d |
| 2 | K5, K6, K7 | 2.5 d |
| 3 | K8, K9, K10, K11 | 3.5 d |
| 4 | K12, K13, K14 (K15 later) | 2 d |
| 5 | K17, K18, K19, K20 | 4 d |
| | **Total** | **about 15.5 days** |

Biggest effect for the least work: **K16 → K1 → K2 → K4 → K5 → K10 → K17 + K19** (about 6 days). After these, a Jira outage is visible, the knowledge base fills up, gets merged and has a gate, Ask stops hiding failures, and no suggested ticket is created for a problem that is already open, being fixed or fixed.

## 6. Decisions

- **No vector database or embeddings now.** The corpus is tens of entries per project. Search terms in the entries (K5), a search plan in several languages (K8) and knowledge-first collection (K9) cover the misses seen so far, keep the answer explainable, and keep the agent free of npm dependencies (NFR-02). Revisit when a project passes about 500 entries or the eval (K1) shows misses caused by wording that K8 does not fix.
- **Plain code decides, the model writes.** Ranking, linting, merging rules and source checks stay deterministic; the model only writes entries, search plans and answers.
- **A human still decides.** New write actions (`mergeDocs`, `promoteFaq`) are `policy.json` keys starting as `draft`. `mergeFix` stays `off`.
- **Patient data first.** The patient-data check of K5 blocks a push; it does not replace R-02 (redaction before the analysis), which is still required before company tickets.
- **Prior art: code finds, the AI judges, a person decides.** Code collects the candidates and their evidence (K17); a small model without tools only compares texts and must name a candidate (K18); the person sees both and creates, creates anyway with a reason, or drops. Tickets are never closed or linked on their own (`linkTickets: draft`), and `createTicket` stays at most `draft`.
- **A failed source is never "nothing found".** Jira, git or GitHub failing stops the check with a visible reason (K16, K10, K17).

## 7. Risks

| Risk | Mitigation |
|---|---|
| The backfill opens a flood of PRs or costs too much | one PR per batch, `--limit`, `--dry-run` with a cost estimate |
| Auto-merged documentation contains a wrong cause | `mergeDocs` defaults to `draft`; `auto` only after the lint; confirmed/assumed labels stay mandatory |
| One component name breaks the skill outside the agent (Copilot, SVN) | fallback to today's path rule when no agent config exists; the bundle format keeps `knowledgeDoc.path` |
| The search-plan call adds latency | Haiku, no tools, a short timeout, fallback to `keywords()` |
| Feedback is gamed or misread | local only, shown as counts; it creates suggestions, never knowledge, without a person |
| Prior art calls a new problem a duplicate, and a real bug is not reported | the verdict never blocks: "create anyway" with a reason; K21 case (e) measures false duplicates |
| Prior art slows the Insights tab | computed on refresh and cached with the fingerprint; the code re-check only when a suggestion is opened |
| `gh` is missing, or the host is not GitHub | the "fix in progress" kind falls back to remote branches; the panel says PRs were not checked |

## 8. Decisions

Decided on 2026-11-12 (Bojan Mijatović), as recommended:

| # | Question | Decision | Items |
|---|---|---|---|
| 1 | May documentation PRs be merged automatically? | `mergeDocs: draft`: a person confirms each merge (one click on the dashboard). `auto` is considered after the lint (K5) has run for a few weeks without a miss. | K2 |
| 2 | Backfill period and cost | bugs with a fix commit, since 2026-01-01; at most 10 tickets per PR; about $5 per project for the first round (estimated with `--dry-run` from the first 3 runs) | K4 |
| 3 | Knowledge files named after the Insights components? | yes (`pazienti.md`, `prenotazioni.md`); the path rule stays as the fallback without an agent config; a one-time migration PR | K6 |
| 4 | Languages of the search terms | the ticket's language (Italian) and English in every entry; Serbian questions are covered by the search plan (K8) | K5, K8 |
| 5 | Who gives Ask feedback? | anyone at the dashboard; feedback only creates suggestions, never knowledge on its own; people are identified once the dashboard is shared with the team | K12 |
| 6 | A suggestion whose problem is already fixed | hidden, with "show resolved" and a count ("3 already fixed") | K19 |
| 7 | Jira links proposed by the agent | yes, as a draft (`linkTickets: draft`); a person confirms each link | K19, K20 |
| 8 | "Fixed on main" vs "released" | for now "fixed on main by commit X (KEY); check whether it is released"; release state comes when the release branches or tags per environment are known | K20 |

## 9. Documents to update as items land

SPEC.md (FR-47 Jira health guard: done; new FR-68 onward: documentation scope and backfill, entry lint, knowledge-first Ask, Ask over the suite, feedback and gaps, prior-art check for suggestions and for reported tickets), [ROADMAP.md](ROADMAP.md) #6, [agent/README.md](../agent/README.md) (Ask, Done → documentation, Suggested tickets, the `priorArt` result field), [AGENT_TRAINING.md](AGENT_TRAINING.md) (the Ask and prior-art eval tables and the knowledge-base lever), `policy.json` (`mergeDocs`, `documentScope`, `linkTickets`), the `document-ticket` and `analyze-ticket` skills.
