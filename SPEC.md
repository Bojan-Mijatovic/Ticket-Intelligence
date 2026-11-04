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
| UC-4 | The agent reproduces the bug in the running application, attaches evidence, implements a fix on a branch, runs the tests and opens a draft pull request | Planned |
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
| FR-36 | Live dashboard: ticket feed with each agent step, results, Teams-style notifications, drafts, KPIs, policy | Implemented |
| FR-37 | Post owner notifications to Teams through a Workflows webhook when `TEAMS_WEBHOOK_URL` is set | Implemented (not tested against a real channel) |
| FR-38 | Reproduce the bug with a generated Playwright test against the running app; attach screenshot and network evidence to Jira | Planned |
| FR-39 | Implement the fix on a branch named after the ticket; run `ng build`, `mvn test` and the reproduction test; open a draft PR (git) or attach a patch (SVN) | Planned |
| FR-40 | On transition to Done, run `/document-ticket` and open a documentation PR | Planned |

### 4.5 Documentation of resolved tickets

| ID | Requirement | Status |
|---|---|---|
| FR-50 | Write the cause/fix entry to `docs/knowledge/<component>.md` and update the index; confirmed facts vs. assumptions are labelled | Implemented |
| FR-51 | git: review branch in a separate worktree + PR (`gh` on GitHub), or direct commit; SVN: direct commit of doc files only, `svn copy` branch, or patch file | Implemented |

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
Optional: `title`, `files[]`, `relatedTickets[{key, why}]`, `duplicateOf {key, why}`, `alternatives[]`, `reporterReply`.
A result that is not valid JSON or misses a required field fails the run (`ai-failed`); nothing is posted.

### 5.3 Events (`agent/state/events.jsonl`, dashboard stream)

`started`, `recovered`, `queued`, `picked`, `analyzing`, `progress`, `analyzed`, `duplicate`, `commented`, `notified`, `skipped`, `draft`, `done`, `failed`, `error`. Each event has `at`, `type`, and usually `key` and `text`.

### 5.4 Configuration

| File | Scope | Content |
|---|---|---|
| `~/.claude/skills/analyze-ticket/.env` | per user, secret | `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` or `JIRA_PAT`, `JIRA_MOCK`, `SVN_BIN`, `TEAMS_WEBHOOK_URL` |
| `~/.claude/skills/analyze-ticket/config.json` | per user | `environmentField`, `environmentMatch`, `projects`, `lookbackDays`, `maxRelated`, `halfLifeDays`, `doneStatuses`, `excludeUsers` |
| `<repo>/.ticket-intel.json` | per project | `docsPath`, `commitMode`, `baseBranch`, `componentContainers`, `suspectWindowDays`, `authorAliases` |
| `agent/agent.config.json` | agent | `project`, `repo`, `pollSeconds`, `lookbackHours`, `analysisTimeoutMinutes`, `dashboardPort`, `labels`, `claude.*` |
| `agent/policy.json` | agent | action → `auto|draft|off`, `notifyMinConfidence`, comment header and size |

### 5.5 External systems

| System | Calls | Notes |
|---|---|---|
| Jira Cloud REST v2 | `issue`, `issue/{k}/comment|worklog|changelog|transitions`, `search/jql`, `field`, `myself`, `serverInfo`, attachment download | Data Center: `search` instead of `search/jql`, PAT auth |
| git | `log`, `grep`, `show`, `ls-files`, `for-each-ref`, `worktree` (docs only) | read-only for analysis |
| SVN | `info`, `status --xml`, `log --xml --search`, `diff -c`, `ls` | read-only for analysis; credentials must be cached |
| Claude Code CLI | `claude -p --output-format stream-json --disallowedTools Edit Write NotebookEdit` | prompt via stdin |
| Teams | Workflows webhook, Adaptive Card | optional |

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
| Prompt injection | ticket text, commit messages and code comments are treated as data, not instructions (stated in both skills) |
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
| Not yet validated | GitHub Copilot, real company tickets, real SVN server, real Teams channel |

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
