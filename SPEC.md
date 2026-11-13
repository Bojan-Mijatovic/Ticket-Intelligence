# SPEC: Ticket Intelligence

| | |
|---|---|
| **Status** | Reviewed and approved (2026-11-04) |
| **Version** | 0.3 (2026-11-04) |
| **Owner** | Bojan Mijatović |
| **Problem brief** | [docs/PROBLEM_BRIEF.md](docs/PROBLEM_BRIEF.md) |

Status labels used below: **Implemented** (built and tested on the demo), **Planned** (POC days 3–4), **Later** (after the POC).

## 1. Overview

Ticket Intelligence gives every Jira ticket a fast, evidence-based first analysis: what is wrong, where in the code it lives, what changed, who knows it, and what to do next. It has three parts:

| Part | What it is | Started by |
|---|---|---|
| `/analyze-ticket` skill | agent skill + Node scripts: collects Jira and VCS data, the agent writes the analysis | a person, in Claude Code or GitHub Copilot |
| `/document-ticket` skill | records a resolved ticket's cause and fix in the project's `docs/knowledge/` | a person (later: the agent, on Done) |
| Autonomous agent | watches a Jira project, runs the analysis headless, acts per policy, live dashboard | nobody: runs continuously |

## 2. Use cases

| ID | Use case | Status |
|---|---|---|
| UC-1 | A developer new to a project runs `/analyze-ticket KEY "title"` in the project folder and gets a report: problem, code location, changes, likely cause, proposed fix, owner, next steps, escalation | Implemented |
| UC-2 | A new ticket appears in Jira; within minutes the agent posts an internal analysis, notifies the owner and prepares drafts, with no human start | Implemented |
| UC-3 | A resolved ticket is documented in `docs/knowledge/<component>.md` and committed for review | Implemented (manual start) |
| UC-4 | The agent reproduces the bug in a browser test, attaches evidence, implements a fix on a branch, runs the tests and opens a draft pull request | Implemented (FE tickets) |
| UC-5 | A customer email or Teams message mentioning a ticket gets a status answer | Later |

## 3. Architecture

```
                         ┌──────────────────────── analyze-ticket skill ────────────────────────┐
 person (Claude Code /   │  SKILL.md (workflow, rules)                                          │
 GitHub Copilot) ───────▶│  scripts/ticket.mjs ──▶ lib/jira.mjs ──▶ Jira REST v2 (Cloud / DC)    │
                         │                     ──▶ lib/code.mjs ──▶ vcs/git.mjs | vcs/svn.mjs   │
                         │                     ──▶ lib/analysis.mjs (signals, relevance, people)│
                         └──────────────────────────────────────────────────────────────────────┘
                                       ▲ claude -p (headless, read-only)
 Jira project ──poll 30 s──▶ agent/watcher.mjs ──▶ lib/pipeline.mjs ──▶ policy.json ──▶ Jira comment, labels,
                                   │                                                   owner notification, drafts
                                   └──▶ state/events.jsonl ──▶ dashboard (SSE, :7070)
```

**Division of work.** Deterministic scripts collect data and compute transparent scores; the agent (LLM) reads the ticket, screenshots, diffs and code, connects the facts and writes text. The agent never writes to Jira or the repository itself; in the autonomous mode it returns a JSON result and the watcher acts on it.

## 4. Functional requirements

### 4.1 Ticket data (Jira)

| ID | Requirement | Status |
|---|---|---|
| FR-01 | Accept a ticket key, a Jira URL, a title, or key + title; verify that the title matches the key; fall back to title search when the key is not found | Implemented |
| FR-02 | Load the ticket with description, comments, worklogs, full changelog, links and attachments; download screenshots for the agent to view | Implemented |
| FR-03 | Compute signals: age, days since update, last team response, last reporter message, waiting on team, reopen count, priority/status/assignee history | Implemented |
| FR-04 | Find related tickets with three JQL queries (environment, title keywords, specific names from the description) plus explicit links, and rank them by relevance | Implemented |
| FR-05 | Rank people by evidence from related tickets (resolutions, worklogs, technical comments, edits), weighted by relevance and recency; the reporter is never a candidate | Implemented |
| FR-06 | Parse title conventions: `[FE]`/`[BE]` tags and the screen path (`Agenda: Search mask: Struttura field`) | Implemented |

### 4.2 Code (git and SVN)

| ID | Requirement | Status |
|---|---|---|
| FR-10 | Detect git or SVN automatically; same analysis on both | Implemented |
| FR-11 | Find commits that reference the ticket or related tickets by key, with diffs | Implemented |
| FR-12 | Search the code for clues from the ticket (paths, quoted labels, camelCase/dotted/snake identifiers, test data); plain words match as whole words | Implemented |
| FR-13 | Map files to components (container folders, Angular `features/shared/core`, Java packages) and rank components | Implemented |
| FR-14 | List suspect changes: commits to the top components within `suspectWindowDays` before the ticket | Implemented |
| FR-15 | Report component authors and branches named after the ticket; read existing `docs/knowledge` entries | Implemented |

### 4.3 Report and drafts

| ID | Requirement | Status |
|---|---|---|
| FR-20 | Report: problem, status, code location, what changed, related history, likely cause with confidence, proposed fix, owner, next steps, escalation decision | Implemented |
| FR-21 | Escalation rules: High+ priority with no team response ≥ 2 days; reporter waiting and asked/raised priority; reopened; a same-environment fix exists but its resolver isn't involved | Implemented |
| FR-22 | Drafts: handoff to owner, reply to reporter, internal Jira comment | Implemented |
| FR-23 | Language: chat report in the user's language; everything written to Jira or the repository in English | Implemented |

### 4.4 Autonomous agent

| ID | Requirement | Status |
|---|---|---|
| FR-30 | Poll the project; pick tickets not Done, created within `lookbackHours`, without agent labels or `no-ai` | Implemented |
| FR-31 | Run the analysis headless (`claude -p`, editing tools disabled) and validate the JSON result | Implemented |
| FR-32 | Act per `policy.json` (`auto` / `draft` / `off` per action) | Implemented |
| FR-33 | Never process a ticket twice; recover tickets left `ai-analyzing` by an interrupted run | Implemented |
| FR-34 | Notify only a real person and only at or above `notifyMinConfidence` | Implemented |
| FR-35 | Flag possible duplicates (`duplicateOf`) without linking or closing | Implemented |
| FR-36 | Live dashboard: ticket feed with each agent step, results, Teams-style notifications, drafts, KPIs, policy; status chip says how a ticket ended (`PR ready`, `fix failed`, `analyzed · no fix` with the reason) | Implemented |
| FR-37 | Post owner notifications to Teams through a Workflows webhook when `TEAMS_WEBHOOK_URL` is set | Implemented (not tested against a real channel) |
| FR-38 | Reproduce the bug with a generated Playwright test (mocked backend API); the watcher verifies that the test fails before the fix; attach screenshot and recorded API calls to Jira | Implemented |
| FR-39 | Implement the fix on a branch named after the ticket in an isolated worktree; the watcher re-runs all browser tests, `ng build` and (if backend code changed) `mvn test`; push and open a draft PR (GitHub). SVN: patch file | Implemented for git/GitHub; SVN patch Later |
| FR-40 | On transition to Done, run `/document-ticket` headless on branch `docs/<KEY>` (only `docs/knowledge/*.md` may change, checked by the watcher) and open a draft documentation PR; `documentScope: withFix` also documents bugs the agent did not analyze when their fix is on main or on a branch named after them; the window reaches back to the last check (K4) | Implemented |
| FR-49 | Backfill: `agent/document-backfill.mjs` documents resolved tickets with a fix on main and no entry, on one branch with one commit each and one draft PR; dry run by default with coverage and a cost estimate; `--limit`, `--max-cost`, `--since`, `--types`, `--only` (K4) | Implemented |
| FR-41 | Fix eligibility: `[FE]` in the title, or no tag at all and every file the analysis names (tests excluded) is under `frontend/` (`inferTagFromFiles`, `inferIgnoreFiles`); an explicit other tag is respected | Implemented |
| FR-42 | Run again: from the dashboard (card button or key field), reset the agent's result labels and queue the ticket now; `no-ai` respected | Implemented |
| FR-43 | Preview: switch the served application clone to a fix branch and wait for the dev server rebuild (dashboard button, `demo/preview.mjs`); the dashboard shows which branch the app serves | Implemented |
| FR-44 | The analysis always reads `origin/main` (detached worktree `state/analysis-repo`), never the branch the application clone is on | Implemented |
| FR-45 | Single watcher instance (`state/watcher.pid`); `--replace` stops the running one; preflight fails when the watcher runs older agent code | Implemented |
| FR-47 | Jira health guard: before trusting a search, check the credentials (`/myself`) and that every watched project is visible; while Jira is unavailable, pause the poll and the queue, refuse Insights, Ask, Run and Create in Jira with the reason (503), show it in the dashboard header, emit `jira-down` / `jira-up` once per change; warn when a project that had tickets returns none (`agent/lib/jira-health.mjs`; K16 of [docs/KNOWLEDGE_PLAN.md](docs/KNOWLEDGE_PLAN.md)) | Implemented |
| FR-48 | Knowledge base on the dashboard: the documented tickets on `main` and the documentation PRs waiting (open, draft, closed-unmerged with their branch); merge one after a person confirms (`mergeDocs: draft`): ready, squash-merge, branch deleted, Jira comment, `docs-merged` event; only `docs/` branches that change nothing but `docs/knowledge/*.md` (`agent/lib/docs-prs.mjs`; K2) | Implemented |
| FR-46 | Update emails: with `emailUpdates: auto`, one email per milestone (`mail.on`: analysis ready, draft fix PR, fix stopped, AI review, documentation PR, failures) to `MAIL_TO`, over SMTP with TLS/STARTTLS (plain Node, `agent/lib/mail.mjs`); sent after the event, one at a time; outcome as `mailed` / `mail-failed`; off with the reason when SMTP is not configured | Implemented (tested against a local SMTP server; real Gmail delivery pending credentials) |

### 4.5 Documentation of resolved tickets

| ID | Requirement | Status |
|---|---|---|
| FR-50 | Write the cause/fix entry to `docs/knowledge/<component>.md` and update the index; confirmed facts vs. assumptions are labelled; each entry has a Type and Search terms (error text, screen and route, user words in the ticket's language and English) and no PR or branch state | Implemented |
| FR-59 | Knowledge refresh: entries citing commits not on main get the ticket's commit on main ("Merged into main as …") through one draft PR; entries citing files gone from main are listed as stale (`agent/knowledge-refresh.mjs`; K7) | Implemented |
| FR-58 | The fix and the AI review get the knowledge entries of the code they touch (files of the analysis or the diff, the prior art and related tickets): root cause, fix, "Prevent recurrence"; a documented cause must not come back (`knowledgeFor`; K13) | Implemented |
| FR-56 | Ask over the suite: a project's linked apps are searched in Jira, their history and code (read-only checkouts) are read, their files cited as `KEY:path` and checked there (K11) | Implemented |
| FR-57 | Ask feedback and knowledge gaps: 👍/👎 with a note per answer; gaps = "not found" and 👎 questions grouped by words; coverage of resolved bugs by knowledge entries per component; a gap asked twice is a suggested ticket (K12) | Implemented |
| FR-55 | Already known? for a reported ticket: the bundle's `priorArt` (related open and resolved tickets with fix dates before or after the report, fix branches of other tickets on the same code, knowledge entries about the ticket); the skill decides one kind (none, documented, duplicate, in-progress, fixed-on-main, regression, solved-before) and reports it; the agent's result has `priorArt`; no automatic fix for `policy.proposeFixWhen.skipKnown` kinds; `prior-art` event, card, email, Insights recurrence (K20) | Implemented |
| FR-54 | Prior art of suggested tickets: candidates from tickets of every status (fix commits, files), saved analyses, knowledge entries and open PRs, each with its reasons; verdict by code (fixed-by, possible duplicate, in progress, new); fixed ones hidden; "Before you create" in the editor; a reason is required to create a non-new one and goes into the description; checked again live on create; the AI review lists what tickets already cover (`agent/lib/prior-art.mjs`; K17, K19) | Implemented |
| FR-53 | One knowledge file per named component (`insights.components`, or `.ticket-intel.json` → `components`; path-based without them), passed to the skills as `TICKET_INTEL_COMPONENTS`; tests belong to what they test; Insights drill-down links the file; one-time migration of path-named files without AI as one draft PR (`agent/knowledge-migrate.mjs`; K6) | Implemented |
| FR-52 | Knowledge lint before a documentation push and on main (`agent/lib/knowledge.mjs`, `agent/knowledge-lint.mjs`): required fields, labelled root cause, existing commits, no PR/branch state, no fixture keys, people only, no personal data; one correction in the same session, otherwise nothing is pushed (K5) | Implemented |
| FR-51 | git: review branch in a separate worktree + PR (`gh` on GitHub), or direct commit; SVN: direct commit of doc files only, `svn copy` branch, or patch file | Implemented |

### 4.6 Post-POC extensions (see [docs/ROADMAP.md](docs/ROADMAP.md))

| ID | Requirement | Status |
|---|---|---|
| FR-60 | Approval card (Teams + dashboard) with before/after, checks and risk; Approve marks the PR ready and comments in Jira; Reject re-runs the fix with the reason (≤ `maxFixAttempts`); never merges | Planned |
| FR-61 | Mission Control: live per-ticket phase timeline; Impact metrics (times, hours saved vs. configured baseline, cost per ticket); Run on ticket and Pause | Planned |
| FR-62 | Night shift: backlog processing in a time window with ticket and cost limits; morning digest to Teams, dashboard and `state/digests/` | Planned |
| FR-63 | AI reviewer: read-only second run on every agent PR (separate queue item, no shell, own checkout of `origin/main`); posts a COMMENT review with inline comments on diff lines and a risk level used by FR-60; never blocks the PR (`agent/lib/review.mjs`, `agent/review-one.mjs`) | Implemented |
| FR-64 | Hotspot map: bugs per component and month (dates and components from git commits, type and status from Jira, open bugs from saved analyses), files fixed more than once, recurrences, churn; top 3 hotspots with an AI recommendation that must cite tickets or commits (`agent/lib/insights.mjs`, Insights tab, `agent/insights.mjs`) | Implemented |
| FR-65 | Ask the knowledge base: the code collects Jira tickets (by the question's words), saved analyses and the git log; a run with only Read/Grep/Glob and no MCP servers answers over them, the code on `origin/main` and `docs/knowledge`; every cited source is checked, an answer without a valid source is "not found" (`agent/lib/ask.mjs`, Ask tab, `agent/ask.mjs`); a failed source is a warning in the answer, and "not found" after a failed Jira search says so; a ticket named only in the git history is a valid source (K10) | Implemented |
| FR-66 | Release notes and sprint report in a technical and a business version, on a branch with a draft PR | Planned |
| FR-67 | Reply to the reporter when the ticket's PR is merged (`replyOnMerge: draft` by default); one reply per merge | Planned |

## 5. Interfaces

### 5.1 CLI (`scripts/ticket.mjs`)

| Command | Purpose |
|---|---|
| `analyze <KEY\|URL> ["title"] [--env X] [--repo P] [--attachments-dir D] [--out F]` | full bundle: ticket, signals, related, people, code context |
| `fetch <KEY>` · `resolve "<title>"` · `recent [N]` · `inspect <KEY>` · `fields [filter]` | single ticket, title search, recent tickets, all fields of a ticket, field ids |
| `comment <KEY> --file F [--yes]` | post a comment (dry run without `--yes`) |
| `check` | connection test |

### 5.2 Agent result contract (headless run → watcher)

Required: `ticket`, `summary`, `likelyCause`, `confidence` (`high|medium|low`), `component`, `proposedFix`, `owner {name, why}`, `escalate {yes, reason}`, `nextSteps[]`, `jiraComment` (Jira wiki markup, ≤ 3500 chars), `handoff {to, message}`.
Optional: `title`, `files[]`, `relatedTickets[{key, why}]`, `duplicateOf {key, why}`, `priorArt {kind, key, commit, branch, entry, why}` (normalized by the watcher; an unknown kind is `none`), `alternatives[]`, `reporterReply`.
A result that is not valid JSON or misses a required field fails the run (`ai-failed`); nothing is posted.

### 5.3 Events (`agent/state/events.jsonl`, dashboard stream)

`started`, `recovered`, `queued` (`rerun: true` when started with Run again), `picked`, `analyzing`, `progress`, `analyzed`, `duplicate`, `commented`, `notified`, `skipped`, `draft`, `done`, `failed`, `error`, `preview`; fix stage: `workspace`, `warmed`, `reproducing`, `reproduced`, `fixing`, `verifying`, `verified`, `pushed`, `pr`, `fix-proposed`, `fix-failed`, `fix-skipped`; documentation: `resolved`, `documenting`, `documented`, `doc-failed`, `docs-merged`; review: `reviewing`, `reviewed` (`review`, `meta`), `review-skipped`; email: `mailed` (`subject`, `for`), `mail-failed`; Jira: `jira-down`, `jira-up` (no `key`). Each event has `at`, `type`, and usually `key` and `text`.

### 5.4 Configuration

| File | Scope | Content |
|---|---|---|
| `~/.claude/skills/analyze-ticket/.env` | per user, secret | `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` or `JIRA_PAT`, `JIRA_MOCK`, `SVN_BIN`, `TEAMS_WEBHOOK_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `MAIL_TO` |
| `~/.claude/skills/analyze-ticket/config.json` | per user | `environmentField`, `environmentMatch`, `projects`, `lookbackDays`, `maxRelated`, `halfLifeDays`, `doneStatuses`, `excludeUsers` |
| `<repo>/.ticket-intel.json` | per project | `docsPath`, `commitMode`, `baseBranch`, `componentContainers`, `suspectWindowDays`, `authorAliases`, `components` (named components: `[{ name, paths }]`) |
| `agent/agent.config.json` | agent | `project`, `repo`, `pollSeconds`, `lookbackHours`, `analysisTimeoutMinutes`, `dashboardPort`, `labels`, `claude.*`, `mail.on` |
| `agent/policy.json` | agent | action → `auto|draft|off`, `notifyMinConfidence`, comment header and size |

### 5.5 External systems

| System | Calls | Notes |
|---|---|---|
| Jira Cloud REST v2 | `issue`, `issue/{k}/comment|worklog|changelog|transitions`, `search/jql`, `field`, `myself`, `serverInfo`, attachment download | Data Center: `search` instead of `search/jql`, PAT auth |
| git | `log`, `grep`, `show`, `ls-files`, `for-each-ref`, `worktree` (docs only) | read-only for analysis |
| SVN | `info`, `status --xml`, `log --xml --search`, `diff -c`, `ls` | read-only for analysis; credentials must be cached |
| Claude Code CLI | `claude -p --output-format stream-json --strict-mcp-config --disallowedTools Edit Write NotebookEdit …` (reviewer, Ask: `--tools Read,Grep,Glob`) | prompt via stdin |
| Teams | Workflows webhook, Adaptive Card | optional |
| SMTP (e.g. Gmail) | `EHLO`, `STARTTLS`, `AUTH PLAIN`, `MAIL FROM`, `RCPT TO`, `DATA` over TLS | optional; update emails (FR-46) |

## 6. Scoring (transparent heuristics)

- **Related ticket relevance** = `0.4·same environment + 0.5·max(text match, clue match) + 0.3·linked + 0.1·resolved`, threshold 0.15.
- **People** = Σ activity points × relevance² × 0.5^(age/180 days). Points: resolved 5, assignee at resolution 3, open assignee 2, technical comment 2, comment 1, worklog 0.75/h (≤ 8 h), status change 0.5, other edit 0.25 (≤ 1.5).
- **Components**: commits referencing related keys (3 × relevance, spread over the commit's files), clue hits in code, message matches, suspect changes (+2).

Scores only order lists; every recommendation must cite tickets, commits or files.

## 7. Security and privacy

| Topic | Rule |
|---|---|
| Credentials | per user in `.env` outside the repository; never copied into project installs or logs |
| Writes | the analysis is read-only; the watcher is the only writer, limited by `policy.json`; SVN/git commits and pushes require explicit confirmation (also enforced in Claude Code permission settings) |
| Prompt injection | ticket text, commit messages and code comments are treated as data, not instructions (stated in both skills); runs that read free text from people other than the ticket reporter (reviewer, Ask) get an allow-list of read tools (`--tools Read,Grep,Glob`); every run starts without MCP servers and without the tools that publish, schedule or message |
| Dashboard | answers only requests from this machine (loopback); `dashboardAllowRemote: true` in `agent.config.json` opens it to the network |
| Patient data | **open:** automatic redaction before analysis is not implemented; required before use on company tickets (R-02) |
| Audit | every agent step and action in `events.jsonl`; per-run transcript and result in `state/work/<KEY>/` |

## 8. Non-functional requirements

| ID | Requirement | Status |
|---|---|---|
| NFR-01 | New ticket analyzed and commented on in < 5 min | ~80 s measured |
| NFR-02 | Runs on Windows; Node 18+; no npm dependencies in the skill or agent | met |
| NFR-03 | Works with Claude Code and GitHub Copilot (same `SKILL.md`) | Claude Code verified; Copilot not yet tested |
| NFR-04 | Restart-safe: no double processing, stale locks recovered | met |
| NFR-05 | Analysis run limited by time (`analysisTimeoutMinutes`) and turns (`maxTurns`) | met |

## 9. Validation status

| Area | Evidence |
|---|---|
| Jira Cloud integration | live project DEM on bojanmijatovic.atlassian.net: search, issue creation, comments, labels, transitions, links (attachment upload implemented, not yet exercised) |
| Analysis quality | DEM-7 / DEM-8: correct cause (file:line), related tickets, owner; DEM-1 (meaningless ticket): low confidence, no notification |
| git vs. SVN | identical components, commits and people on both demo repositories |
| Autonomy | DEM-8 created → picked in 13 s → commented in 59 s, no human action |
| Warm-up | the fix workspace and dev server are prepared during the analysis: reproduction 64 s instead of 197 s (DEM-10 vs DEM-9) |
| Done → docs | DEM-10 moved to Done → documentation PR #4 in 1 min 32 s |
| Reproduce and fix | DEM-9 created → analysis 63 s → test written and failing (verified) → fix → 2 browser tests + `ng build` passing (verified) → draft PR #1 + Jira comment with 4 attachments; 6 min 24 s end to end, no human action |
| Not yet validated | GitHub Copilot, real company tickets, real SVN server, real Teams channel, real email delivery (Gmail SMTP) |

## 10. Open questions

1. Which company Jira project(s) and which field holds the environment there?
2. Is a service account available for the agent (Jira, Teams, VCS)?
3. Which AI service is approved for ticket data (Copilot Business/Enterprise, Claude for Work, Anthropic API), and under which data agreement?
4. Where should the agent run after the POC (a team VM, a CI runner)?
5. Should the agent's internal comment be visible to customers in Jira Service Management projects? (Must be internal-only.)

## 11. Review

| Reviewer | Role | Outcome | Date |
|---|---|---|---|
| Bojan Mijatović | Tech lead | ☑ Approved | 2026-11-04 |
| Bojan Mijatović | Developer (FE) | ☑ Approved | 2026-11-04 |
| Bojan Mijatović | Developer (BE) | ☑ Approved | 2026-11-04 |
