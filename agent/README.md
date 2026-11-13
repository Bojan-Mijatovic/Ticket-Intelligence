# Ticket Intelligence agent

Runs the `/analyze-ticket` skill on its own: it watches one or more Jira projects, analyzes every new ticket headless, posts the analysis to Jira, notifies the most suitable person, and shows everything live on a dashboard.

```
Jira project ──poll──▶ watcher ──▶ headless agent (claude -p + analyze-ticket skill, read-only)
                         │                    │ structured JSON result
                         ▼                    ▼
                    policy.json ──▶ actions: Jira comment · labels · owner notification · drafts
                         │
                         └──▶ events.jsonl ──▶ dashboard (http://localhost:7070, live)
```

## Run

```
node agent/watcher.mjs              # start
node agent/watcher.mjs --replace    # restart: stops the running watcher first (needed after a code change)
```

Only one watcher runs at a time: a second start stops with the PID of the running one (`state/watcher.pid`). After changing anything in `agent/` (except the dashboard page, which is read on every request), restart with `--replace`; `demo/preflight.mjs` reports a watcher that runs older code.

Open http://localhost:7070, then create a ticket in the Jira project. The agent picks it up within `pollSeconds` (or at once with **Check now**).

On the dashboard:

| Control | What it does |
|---|---|
| **Check now** | poll Jira now |
| **Run ticket** (key field) / **↻ Run again** (on a card) | run the whole flow again for a ticket, e.g. after its title or description was edited: the agent's result labels are removed and it is queued now (`no-ai` is respected) |
| **👁 Preview in app** (on a card with a PR) | switch the app on http://localhost:4200 to the ticket's branch and wait until `ng serve` has rebuilt; the header chip shows which branch the app serves, with **back to main** |
| ticket status chip | `PR ready`, `fix failed`, `analyzed · no fix` (hover or the subtitle says why), or `analyzed` |

Requirements: the Claude Code CLI (`npm install -g @anthropic-ai/claude-code`, logged in), the skills installed (`node install.mjs`), and a real Jira configured in `~/.claude/skills/analyze-ticket/.env`.

## Several projects

`agent.config.json` → `projects` lists the Jira projects the watcher works on, each with its application repository:

| Field | Meaning |
|---|---|
| `key`, `name` | Jira project key and app name (e.g. `LAB`, `MediLab`) |
| `repo` | the app's clone (relative to `agent/`); a project without a clone is not watched |
| `stateDir` | the project's agent state (results, work, insights, Ask); default `state/projects/<KEY>` (MediAgenda keeps `state`) |
| `app` | ports of the running app (`frontend`, `backend`) and its start page (`home`), for Preview |
| `linked`, `relations` | the projects whose APIs the app calls, and what for |
| `insights`, `backendTestDir`, `askExamples` | per project; anything else falls back to the shared settings at the top |

One poll covers every watched project (`project in (DEM, LAB, …)`), and one queue runs their tickets in order. The dashboard has a **Project** selector: *All projects* shows every ticket (with its app's name); Insights and Ask work on the selected project. **Preview in app** switches the app of the ticket's project.

A linked project's analysis also gets a read-only checkout of each linked app (its `main`) and searches the linked Jira projects for related tickets. It reports `otherProjects` (with evidence) and `fixInProject`; when the fix belongs in another project, no automatic fix is made, and the card says where it belongs. See [docs/SUITE.md](../docs/SUITE.md).

The command-line tools take the project from the ticket key (`LAB-7` → MediLab), or `--project <KEY>` (`ask.mjs`, `insights.mjs`, `review-one.mjs --pr`).

## Tools

| Command | What it does | Writes to Jira |
|---|---|---|
| `node agent/watcher.mjs` | watch, analyze, act, serve the dashboard | per policy |
| `node agent/analyze-one.mjs DEM-7` | dry run: analyze one ticket and print the JSON result | no |
| `node agent/process-one.mjs DEM-7` | full pipeline for one ticket | per policy |
| `node agent/process-one.mjs DEM-7 --reuse-result` | act on the last saved analysis, without analyzing again | per policy |
| `node agent/review-one.mjs DEM-7` / `--pr 14` | AI review of a pull request (posted on GitHub; `--dry-run` prints only) | no |
| `node agent/insights.mjs` | hotspot map in the terminal (`--json`, `--recommend`, `--review` runs the AI review of the app) | no |
| `node agent/ask.mjs "question"` | ask the knowledge base (sourced answer or "not found") | no |
| `node agent/accuracy.mjs` | how often the agent was right, per project (`--project DEM`, `--rows`, `--json`) | no |
| `node agent/knowledge-tests.mjs` | run the regression tests of every known-issue entry on main; a failing one means the issue may be back (`--project LAB`, `--only LAB-9`) | no |
| `node agent/impact.mjs` | the management week for the whole suite: what the agent did, cost, hours saved, what waits (`--weeks 4`, `--json`) | no |
| `node agent/replay.mjs --project DEM` | replay resolved bugs a person fixed as they came in, and compare with the real fix (dry run; `--yes`, `--limit`, `--only`, `--max-cost`) | no |
| `node agent/mail-test.mjs` / `DEM-7` / `DEM-7 --dry-run` | send a test email, or the "analysis ready" email of a saved analysis, to `MAIL_TO` | no |
| `node --test agent/test` | unit tests of the agent's plain-code parts | no |

## Which tickets are picked

In `project`, not Done, created within `lookbackHours`, and without any of the agent's labels. The labels are the agent's state, visible in Jira:

| Label | Meaning |
|---|---|
| `ai-analyzing` | being analyzed now (removed automatically if the watcher was interrupted) |
| `ai-analyzed` | done; **Run again** on the dashboard (or removing the label) has the ticket processed again |
| `ai-failed` | the analysis failed; see the dashboard; **Run again** (or remove the label) to retry |
| `ai-fix-proposed` | a draft pull request with a verified fix exists |
| `no-ai` | set by a human: the agent never touches this ticket |

## Safety

- **The agent cannot write.** The headless run has file-editing tools disabled and its prompt forbids any Jira or VCS write. It only returns a JSON result.
- **No run can publish or message.** Every headless run starts without MCP servers (`--strict-mcp-config`) and without the Claude Code tools that publish, schedule or message (Artifact, Cron, RemoteTrigger, SendMessage, …). Runs that read free text from people other than the reporter (the AI reviewer, Ask, the app review) and the recommendation run get an allow-list instead (`--tools Read,Grep,Glob`, or no tools at all).
- **The watcher acts, per `policy.json`.** Every action is `auto`, `draft` (prepared and shown on the dashboard for a human) or `off`:

  | Action | Default |
  |---|---|
  | internal Jira comment | auto |
  | labels | auto |
  | notify the owner | auto, only for a real person and at least `notifyMinConfidence` |
  | assign the owner | draft |
  | reply to the reporter | draft |
  | update emails to `MAIL_TO` | auto (off until SMTP is configured) |
  | change priority / status | off |

- **Validated output.** A result that is not valid JSON or misses required fields is rejected: the ticket gets `ai-failed`, and nothing is posted.
- **Personal data is masked before any model reads a ticket** (R-02): fiscal codes, IBANs, health cards, e-mails, phones, birth dates, and names of people outside the team (git authors, Jira users and `staff` in `agent.config.json` stay readable). Screenshots can be skipped (`redaction.attachments: skip`). `node agent/redaction-audit.mjs --project LAB` shows what is masked per ticket. Details and limits: [docs/REDACTION.md](../docs/REDACTION.md).
- **No work on a Jira it cannot read.** With rejected credentials Jira answers every search with an empty list, not an error (an expired API token once looked like four empty projects). So the watcher first checks the credentials and that every watched project is visible (`lib/jira-health.mjs`; at start and on each poll, a good result is kept 5 minutes). While Jira is unavailable, the header shows **Jira unavailable: <reason>** and the state **paused**; no ticket is picked or started; Insights, Ask, Run ticket and Create in Jira answer 503 with the reason; one `jira-down` event (and email) per outage, `jira-up` when Jira answers again, and then stale labels are cleaned up. A project that had tickets and now returns none is shown as a warning. `ask.mjs` and `insights.mjs` stop with the reason too. A renewed token needs a restart (`--replace`).
- **Everything is logged** in `state/events.jsonl`; each run's transcript and result are in `state/work/<KEY>/`.

## Configuration: `agent.config.json`

| Key | Meaning |
|---|---|
| `project` | Jira project key |
| `repo` | the project's code (git repository or SVN working copy), relative to this folder |
| `pollSeconds` | how often Jira is checked |
| `lookbackHours` | only tickets created in this window are picked |
| `settleMinutes` | a new ticket is picked only after it has not changed for this long (default 1), so a description added right after creating it is read; **Run again** does not wait |
| `analysisTimeoutMinutes` | a run is stopped after this long |
| `dashboardPort` | dashboard port |
| `dashboardAllowRemote` | default off: the dashboard and its API answer only requests from this machine (they start paid agent runs) |
| `tourReplay` | the tickets whose recorded runs the guided tour replays as its cases when nothing was analyzed since the last reset (see [Guided tour](#guided-tour)) |
| `presentation` | `presenter`, `team`, `contact`: shown on the first and last slide of the presentation (see [Presentation](#presentation)) |
| `reviewTimeoutMinutes` | the AI review is stopped after this long (default 8) |
| `askTimeoutSeconds`, `askMaxTurns` | limits of one Ask question (defaults 120 s, 16 turns) |
| `insights.months`, `insights.churnDays`, `insights.components` | hotspot map: months shown, churn window, path rules per component |
| `insights.authorAliases`, `insights.showBugOrigin` | Insights: other spellings of a person's name → their name; show the author of the change that brought a bug in (default off) |
| `labels` | the agent's label names |
| `mail.on` | which events send an update email (see [Update emails](#update-emails)) |
| `claude.command`, `claude.maxTurns`, `claude.model` | how the headless agent is started |
| `claude.analysisModel` | model for the analysis only (the analyze-ticket skill), e.g. `sonnet`; the fix, the review and Ask keep `claude.model` (null = the CLI default) |

## Notifications

Without configuration, owner notifications are shown on the dashboard as Teams-style cards. To post them to a real Teams channel, create a webhook in the channel (Workflows › "Post to a channel when a webhook request is received") and set `TEAMS_WEBHOOK_URL=` in `~/.claude/skills/analyze-ticket/.env`.

### Update emails

With `emailUpdates: auto` in `policy.json`, the agent mails one update per milestone of a ticket to `MAIL_TO`:

| Event (`mail.on` in `agent.config.json`) | Email |
|---|---|
| `analyzed` | analysis ready: recommended person and why, confidence, escalation, summary, likely cause, proposed fix, next steps, possible duplicate, related tickets, the handoff message and the draft reply to the reporter (marked "not sent") |
| `fix-proposed` / `fix-failed` | draft PR ready (link, checks, changed files) / automatic fix stopped (reason) |
| `reviewed` | AI review: risk, verdict, findings |
| `documented` / `doc-failed` | documentation PR ready / documentation failed |
| `failed` | analysis failed |
| `jira-down` | Jira unavailable (rejected credentials, a project it cannot see): the agent is paused; once per outage |

Settings in `~/.claude/skills/analyze-ticket/.env` (see `.env.example`): `SMTP_HOST` (default `smtp.gmail.com`), `SMTP_PORT` (465 = TLS, 587 = STARTTLS), `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` (default `SMTP_USER`), `MAIL_TO` (comma separated). For Gmail, `SMTP_PASS` is an **app password** (https://myaccount.google.com/apppasswords, needs 2-step verification), not the account password.

- Every update goes to `MAIL_TO` (a test or team inbox). Sending to the recommended person directly needs a Jira user → email mapping, which is not built yet.
- The email is sent after the event, one at a time, so a slow or failing mail server never holds up a ticket. The outcome is an event: `mailed` or `mail-failed` (with the server's answer), shown in the ticket's timeline.
- Without the settings the feature is off, and the watcher says why at start (`Email updates off: …`).
- The SMTP client is plain Node (`agent/lib/mail.mjs`, no npm packages). It refuses to send a password over an unencrypted connection to another host.
- Check the settings with `node agent/mail-test.mjs`; `node agent/mail-test.mjs DEM-40` sends the analysis email of a saved analysis.

## Automatic reproduction and fix

For tickets that pass `proposeFixWhen` in `policy.json`, the agent continues after the analysis. By default:

- `[FE]` or `[BE]` in the title, **or** a title without any tag where every file the analysis names is under `frontend/` or under `backend/` (`inferTagFromFiles`). Remove `BE` from `titleTags` to keep backend tickets analysis-only.
- `high` confidence;
- not a duplicate.

The steps:

| Step | Who | Check |
|---|---|---|
| 1. Worktree on a new branch `<KEY>` from `origin/main` | watcher | skipped if the branch already exists (someone may be working on it) |
| 2. Write `e2e/tests/<KEY>.spec.ts` from the ticket's steps | agent | watcher: **only** that file changed, and it **fails** on the current code → commit "add regression test" |
| 3. Fix the application code | agent | watcher: no test was modified; **all** browser tests pass; `ng build` passes; `mvn test` if backend code changed → commit "<KEY>: …" |
| 4. Push the branch, open a **draft** pull request | watcher | GitHub via `gh`; other hosts: branch only |
| 5. Attach before/after screenshots and the recorded API calls to Jira, comment with the PR link and the check results | watcher | |

**Backend tickets** (`[BE]`, or only backend files in the analysis) use a different test harness, because the browser tests run against a mocked API and cannot show a backend bug:

| Step | Frontend (`[FE]`) | Backend (`[BE]`) |
|---|---|---|
| reproduce | Playwright `e2e/tests/<KEY>.spec.ts`, mocked API | JUnit `backend/src/test/java/com/mediagenda/regression/<Key>RegressionTest.java` (`@SpringBootTest`, real H2 + Flyway data); `backendTestDir` in `agent.config.json` |
| "it fails" means | a failing assertion in the browser test | a surefire report with a failure; no report (compile error) is not a reproduction |
| the fix may not touch | `e2e/` | `backend/src/test/` and `e2e/` |
| checks after the fix | all browser tests, `ng build`, `mvn test` if backend changed | all backend tests (`mvn test`); browser tests and `ng build` only if frontend files changed |
| evidence | before/after screenshots, recorded API calls | `test-before.txt` (the new test failing), `test-after.txt` (all backend tests passing) |

A `[BE][FE]` title keeps the browser harness. No Angular dev server is warmed for a `[BE]`-only title. **Preview in app** works for backend fixes too: `run-mediagenda.mjs` restarts the backend when the app clone switches to the branch.

**A change request that replaces earlier behaviour** (e.g. DEM-33 "dark red" after DEM-32 "dark blue" on the same page) makes the earlier ticket's test fail after a correct fix, and the fix may not modify tests. The analysis therefore names the tickets it deliberately replaces (`supersedes`). With `allowSupersededTestUpdates: true` in `policy.json`, the fix may update **only** those tickets' tests (`e2e/tests/<THAT-KEY>.spec.ts`), never its own test or anything else under `e2e/`, and must also change application code; the watcher checks this. The PR and the Jira comment say "replaces earlier behaviour" with the updated tests, and the AI reviewer is told to check that the ticket really asks for it.

The fix also gets the **known issues** of the code it changes: the knowledge entries of the files the analysis names and of its prior art and related tickets (root cause, fix, "Prevent recurrence"), and is told not to bring a documented cause back. The AI review gets them for the files of the diff and checks the same.

The agent may edit files only inside its worktree and cannot run git commands that change history or remotes; every check is re-run by the watcher, so a pull request exists only when the evidence is real. Nothing is merged automatically (`mergeFix: off`).

```
node agent/fix-one.mjs DEM-7 --local     # reproduce + fix + verify, no push / PR / Jira
node agent/fix-one.mjs DEM-7             # full run for one ticket (uses its saved analysis)
```

To keep this fast, the worktree and an Angular dev server are prepared **while the analysis runs** (for `[FE]` titles and titles without a tag; discarded if no fix follows). The agent's own test runs reuse that warm server; the watcher's checks always start their own.

### Seeing the fix in the app

The fix lives on branch `<KEY>`; the app on :4200 serves the clone in `demo/mediagenda`, normally on `main`. To look at a fix there:

```
node demo/preview.mjs DEM-12     # or 👁 Preview in app on the dashboard
node demo/preview.mjs main       # back (preflight requires main before a demo)
node demo/preview.mjs            # which branch the app shows
```

Each fix branch starts from `main`, so previewing one shows only that fix, not earlier ones.

To accept a fix, a person merges it (the agent never does). From the terminal:

```
node demo/merge-fix.mjs DEM-32           # what would be done: PR, files, AI review
node demo/merge-fix.mjs DEM-32 --yes     # ready → squash merge → branch deleted → app on :4200 on the new main
node demo/merge-fix.mjs DEM-32 --yes --docs   # also merge the documentation PR (docs/DEM-32)
```

A review with high risk or "needs changes" stops the merge unless `--force` is given. The script comments the merge in Jira. A merged fix stays on `main`: `reset-demo.mjs` never rewrites `main`. The MediAgenda repository is private: a browser that is not signed in to GitHub as the repository owner gets **404** on pull request links.

## AI review of the pull request

When a draft pull request is opened (`reviewFix: auto`), a **second, read-only agent** reviews it as a separate queue item, so the next ticket is not held up. It gets the ticket, the analysis, the diff and the watcher's check results, and reads the code around the change on `origin/main` (its own checkout, `state/review-repo`). It cannot edit files or run commands.

It checks correctness (root cause, not symptom), scope (changes the ticket does not need), whether the test really covers the bug, regressions in shared code, and style. It returns a risk (`low` / `medium` / `high`), a verdict (`looks-good` / `needs-changes`) and findings. The watcher posts them as a GitHub **COMMENT** review: findings on changed lines as inline comments, the rest in the review body (GitHub rejects a comment on a line outside the diff). An account cannot approve its own pull request, and the reviewer never approves or merges.

The dashboard shows the risk and the findings under the pull request; `high` or `needs-changes` shows "Review findings first". When anything fails, the review is skipped with a `review-skipped` event; the pull request is never blocked. Files: `state/work/<KEY>/review.json`, `review-request.json` (exactly what was sent to GitHub), `transcript-review.jsonl`.

```
node agent/review-one.mjs DEM-21             # review the agent's PR for DEM-21 again
node agent/review-one.mjs --pr 14            # review any pull request of the application repository
node agent/review-one.mjs --pr 14 --dry-run  # print the review, do not post it
```

A review queued in the watcher is lost if the watcher restarts before it runs; run it with `review-one.mjs`.

## Insights: hotspot map

The dashboard's **Insights** tab (and `node agent/insights.mjs` in the terminal) shows where the bugs come from: bugs per component and month, the top 3 hotspots, files fixed by more than one bug, and new bugs that the agent found related to an earlier bug of the same component. The numbers are plain code over:

- **git** (`origin/main`): a ticket's month is the date of its first commit with the key in the subject (for a bug: the fix), and its components are the folders those commits changed. Jira's own `created` is not used for this: tickets imported or seeded later all have the same date.
- **Jira**: type (Bug or not) and status (open bugs) of every ticket in the project.
- **the agent's saved analyses** (`state/results/<KEY>.json`, kept across demo resets): open bugs without commits are placed by the files the analysis names, in the month of the analysis.

Components are configured in `agent.config.json` → `insights.components` (first matching path prefix wins; `src/test/java` counts with its main code). Without that list, Angular feature folders and Java packages are used.

**✦ Write recommendations (AI)** (or `node agent/insights.mjs --recommend`) runs one headless call, without any tools, on the facts of the top hotspots. A recommendation that does not cite a known ticket or commit is dropped. The result is cached in `state/insights/recommendations.json` and marked "data changed since" when the facts change.

The map shows components, not people: authors appear only as context.

The tab also shows, per project (all plain code, no AI run):

| Section | What it is built from |
|---|---|
| KPIs | bugs and High/Highest bugs (Jira priority weights the hotspot score: Highest 4, High 3, Medium 2, Low 1), recurring problems, unit-tested services/controllers and screens opened by browser tests, commits (the agent's apart) |
| Drill-down | click a component or a heatmap cell: its tickets with type, priority, status and commits |
| Risk files | application files on `origin/main` scored by bug fixes, changes, size and their test (own unit test, a test in the package, a browser test that opens the screen, none) |
| Recurring problems | a later bug that repeats an earlier one: the agent's analysis says so, a Jira link (also to another project of the suite), or both fixes changed the same file |
| Where bugs come from | `git blame` of the lines each fix changed, in the code just before the fix (for a fix that only added lines: the lines around the addition). The commit that wrote most of them brought the bug in; its ticket is the change to look at. Shows the changes that brought in more than one bug, bugs brought in by another bug's fix, and the days each bug stayed in the code. Cached per fix in `insights/origins.json` |
| Code shared with other projects | files of this app that are copies (60%+ of the significant lines alike; imports and package names left out) of files in the other projects, the bugs fixed in each copy, and **check** when the lines a bug fix added to one copy are missing in the other. Cached by the repositories' heads in `insights/shared.json` |
| Tickets | type × priority, still open by priority, per component, per environment label, opened per month (from git when the Jira dates were seeded in one go) |
| Trend | month by month from git: bugs and commits of the month, and the code at the end of the month (lines, services/controllers with a unit test, screens opened by browser tests; cached per commit in `insights/trend.json`). Plus one snapshot a day of what git cannot give back later (open bugs, recurring problems, copies to check, the AI review score) in `insights/snapshots.json`, and the change since the first snapshot |
| Knowledge map | each component's people and their share of the commits; bus factor = people with at least 25% (the agent is not a person) |
| People | commits, bugs fixed, stories, main areas and last commit per person, sortable. One name per person whatever the spelling; `insights.authorAliases` maps the rest |

With **All projects** selected, the tab shows **the whole suite** (`/api/insights/suite`, from the same cached per-project insights): every app side by side (bugs, open, recurring, tests, days in code, bus factor 1, copies to check, AI review score, suggestions, bugs per month), bugs per month over all apps, how the apps call each other (`linked` and `relations` in `agent.config.json`) with the bugs linked across each pair, bugs with a Jira link to another app, causes the agent's analyses found in another app (`otherProjects`, `fixInProject`), and the files copied between apps with the bugs fixed in each copy and the fixes missing in a copy (each counted once). **Refresh all** reads every app again.

**✦ Review the app (AI)** (or `node agent/insights.mjs --project LAB --review`) runs one headless call of a few minutes for the selected project (MediLab: about $0.80 and 2–3 minutes). The code writes the facts of the tab to `insights/review-facts.json` (without people's names); the run reads them and the code on main in its own read-only checkout (`review-repo`), with Read, Grep and Glob only. It writes:

- an **evaluation**: a summary, a score 1–5 for reliability, test safety net, design and structure, maintainability and knowledge spread, strengths and risks;
- **findings in the code** (up to 6): the file, the problem, the evidence, the fix, how to prevent that kind of bug, and a priority;
- **refactor proposals** (up to 4): files, why, steps, effort, what it gives (copies shared with the other apps are candidates for a shared library);
- **how the app can grow** (up to 4): what it builds on and what must come first.

Every item must cite a ticket or commit of the facts, or a file that exists on main (a score may also rest on a component's numbers, e.g. its bus factor); the others are dropped (the count is shown), and files that do not exist are removed from an item. The result is cached in `insights/review.json` and marked "data changed since" when the facts change. Limits: `insights.reviewTimeoutMinutes` (12), `insights.reviewMaxTurns` (40).

**Suggested tickets** lists what the team could open next, each with a summary in the project's style (`[BE] - Component: …`), a type and priority, a Jira description (what, why, how to fix and prevent it, the files and the sources) and a suggested person: whoever has the largest share of that component's commits (for a component only one person knows, the second person, to learn it). They come from:

- the AI review: findings (Bug when high priority, otherwise Task), refactors (Task) and ways to grow (Story);
- the facts, without AI: a bug fix of a copy in another app that is missing here, files where bugs were fixed that have no test (not the tiny ones), and components with bus factor 1.

A suggestion whose summary matches an existing ticket is left out. Every other one is **checked for prior art** (`lib/prior-art.mjs`, plain code): the project's tickets of every status with their fix commits and files, the agent's saved analyses, the knowledge entries on `main`, and the open pull requests. A candidate needs words in common with the suggestion (a shared file or component only adds to that), and each says why it is close. The list shows the verdict: **fixed by KEY** (a resolved ticket fixed it in its files after the suggestion was written; hidden behind *show the fixed ones*), **possible duplicate of KEY** (an open ticket says the same), **in progress: PR #n**, or the related tickets. A suggestion created as a ticket takes that ticket's state. The editor opens with **Before you create**: the candidates and their reasons; when the verdict is not "new", creating it needs a reason, which goes into the description with the related tickets ("Checked before creating"). On **Create in Jira** the watcher checks again with fresh Jira, git and pull requests, and answers 409 when the verdict changed and no reason was given. The AI review is told to leave out what an open ticket already reports (its `existing` list). Nothing is created on its own (`policy.json` → `createTicket`: `draft` shows **Create in Jira…**, `off` only lists them). The button opens the ticket for editing (summary, type, priority, description, and the **assignee**: the people Jira lets you assign in that project, with the suggested person picked when they have an account); after a confirmation the watcher creates it with the label `ai-suggested`, plus `no-ai` unless *Let the agent analyze it* is ticked. The picked assignee is checked in Jira again; when the suggested person has no account, or someone else was picked, the description says so. New tickets stay in the backlog: the agent does not move them into a sprint or change their status. Created suggestions are remembered in `insights/suggestions-created.json` and shown with their key.

Who wrote the change that brought a bug in is not shown by default: the table names the change (ticket and commit), not the person. Set `insights.showBugOrigin: true` to add the author column.

## Ask the knowledge base

The dashboard's **Ask** tab (and `node agent/ask.mjs "question"`) answers questions such as "Has the Struttura field bug happened before?" or "Which bugs did Prenotazioni have since June?" in about 20–30 s:

1. **The code collects the data first:** Jira tickets found by the words of the question (plus the latest ones and any key named in it) with description, last comments and links; the agent's saved analyses; the git log of `origin/main` with changed files. They are written to `state/ask/<time>/`.
2. **A headless run reads them**, plus the code and `docs/knowledge/` in its own checkout of `origin/main` (`state/ask-repo`). Its only tools are Read, Grep and Glob (an allow-list), and no MCP servers are loaded: the question is free text from anyone at the dashboard, so a shell or a publishing tool must not exist in that run at all.
3. **Every cited source is checked:** a ticket must be in the collected data or named in a commit subject of the git log (shown as "only in the git history"), a commit in the git log, a file in the repository. Unknown sources are dropped; an answer with no valid source is shown as "not in the knowledge base", with the closest tickets.
4. **The linked apps are read too.** For a project with `linked` apps (MediLab, MediFarma, MediBill), Ask also searches their Jira projects, writes their git history next to this one, and reads their code on main in read-only checkouts of its own (`ask-peer-repo`). Their files are cited as `KEY:path` and checked in that app's checkout, their commits against its history, with links to the right repository. So "why are cancelled visits charged in MediBill?" can find the cause in MediAgenda.
5. **Feedback.** Under each answer: 👍 / 👎 (with an optional note, e.g. the right answer). It is kept locally (`ask-feedback.jsonl`). Questions answered "not found" (not because Jira failed) or marked 👎 are the **Knowledge gaps** of the Insights tab, grouped by their words; a group of two or more becomes a suggested ticket "Document: …". The same section shows, per component, the resolved bugs without a knowledge entry.
6. **A source that failed is said, not hidden.** A failed Jira search, tickets Jira could not return, or an unreadable git history become warnings: the run is told what could not be checked, the answer shows them, and a "not found" answer after a failed Jira search says "Jira could not be searched" instead of "not in the knowledge base". (When Jira is unavailable as a whole, the Jira health guard refuses the question before any run.)

One question at a time (`409` otherwise); `askTimeoutSeconds` (default 120) and `askMaxTurns` (default 16) in `agent.config.json`. Questions and answers are logged locally in `state/asks.jsonl` and `state/ask/`.

## Guided tour

**▶ Tour** in the dashboard header presents the whole tool by itself, in English, in about twelve minutes. A cursor moves and clicks, the page scrolls and puts a spotlight on each part, explainer slides open over the page, and a voice explains it all while captions show the text. The caption bar names the chapter:

| Chapter | What it shows |
|---|---|
| The problem | a slide: what an engineer has to do by hand for every ticket, who suffers, the goal |
| Behind the scenes | an animated flow: collect (plain code) → analyze (Claude, read-only) → prove and fix (test, fix, re-checks, draft PR, AI review) → learn (knowledge base, Insights, Ask) |
| The AI | a slide: which models do what (Sonnet for the analysis, Opus for the fix, review and Ask), code versus model, guardrails, why it is not trained, cost, patient data |
| At work | a slide: the skills in GitHub Copilot (same `SKILL.md`; not tried inside Copilot yet), git and SVN detection, documentation on SVN (commit, branch or patch; asks first), what is git only (the automatic fix, pull requests, Insights) |
| The dashboard | the live light and the four apps |
| Case 1 | a frontend bug end to end, with what happens behind each step: the worktree and the dev server, the facts script, Claude's reading, the validated result (cause, files, owner), Teams message and drafts, the Playwright test the watcher sees fail, the fix and the watcher's own checks, push, draft PR and Jira attachments, the read-only AI review |
| Case 2 | a backend bug whose cause is in another app: read-only copies of the linked apps, the change it cites, where the fix belongs, the JUnit test (and why the tests were green before), the fix, the review |
| Insights | the suite (how the apps call each other, code copied between apps), one app's KPIs and test coverage, the heatmap (a cell clicked open), hotspots, the AI review |
| A new ticket | a suggested ticket opened in the editor: the prepared summary, type, priority and Jira description, the assignee list from Jira with the suggested person, the `no-ai` box, and the confirmation. The cursor stops on **Create in Jira** without clicking it; the editor is closed again |
| Insights (rest) | risk files, recurring problems, where bugs come from, the knowledge map and people |
| Ask | a question typed and answered with checked sources, and one that is "not in the knowledge base" |
| How it was built | a slide: the ideas, how it is tested and scored, results, what comes next |

Numbers and names come from the data on the page (tickets, owners, causes, hotspots, counts); a part with no data is skipped.

- **Replays.** When a ticket has been analyzed since the last reset, Case 1 is that ticket. Otherwise the cases are **recorded runs** from the event logs, archived ones included (`/api/tour/replay`): the ticket arrives, the steps stream in, then the analysis, the Teams message, the failing test, the fix, the pull request and the review appear one after the other, sped up, with the real timings. Ask replays **recorded answers** (`/api/tour/asks`): the example question that was asked before, and the newest "not found" one, with the steps rebuilt from the saved run. Every replay says **REPLAY** and its date, lives only in that browser page and is gone when the tour ends. `tourReplay` in `agent.config.json` lists the tickets (`DEM-36`, `FAR-19`); tickets never recorded are left out, and with none the fullest run is chosen.
- **Read-only.** It never starts an agent run, an Ask question, an app review or a recommendation, and it creates no ticket. Its Ask button press is only shown; nothing is sent. Opening the ticket editor reads the assignable people from Jira, nothing more.
- **Voice.** The browser's own speech synthesis: free, no key, nothing leaves the machine. The tour picks a natural English voice when there is one (Edge on Windows has *Aria*, *Jenny* and *Guy Natural*); the voice and speed can be changed in the caption bar, or switched to *captions only*.
- **Controls.** Back / Pause / Next, or ← space →; Esc ends it. Afterwards the dashboard returns to the tab and project it showed before.
- **For a presentation** open `http://localhost:7070/?tour`: a *Start the guided tour* button covers the page, because browsers let a page speak only after a click.
- **After changing the code** restart the watcher (`node agent/watcher.mjs --replace`) and reload the page: a watcher started earlier does not serve `tour.js` and `slides.js`, and the buttons then do nothing.

### Presentation

**▶ Present** in the header (or `http://localhost:7070/?present`) wraps the tour in a presentation of about fourteen minutes, in three parts. The caption bar has a button per part, so a click goes straight to the demo or to the conclusion:

| Part | Slides (full screen) | About |
|---|---|---|
| **Presentation** | title (presenter and team) · the problem, with an example from the demo data · the goal and its six success metrics · how it works (the flow, row by row) · the AI and the policy · the four demo apps and why the cases are replays · what you will see | 3 min |
| **Demo** | the tour's dashboard part: the dashboard, case 1, case 2, Insights, a suggested ticket, Ask. The caption bar shows where each step is in the flow: Collect › Analyze › Prove & fix › Learn | 8 min |
| **Conclusion** | what you just saw (the flow again, with the cases' real timings) · results against the same six metrics · how it was built and what we learned · technologies · limits and next steps · sources (public documentation and the project's documents) · thank you, with a contact | 2.5 min |

After *Thank you* it stays on that slide. **→** then shows backup slides for questions (patient data, what if it is wrong, cost, Copilot and SVN), without voice.

- **Voice by default.** **P** (or *🎤 Presenter*) switches to presenter mode: no voice, the captions stay as notes, and **→** shows the next part of a slide, then the next slide. **P** again brings the voice back.
- **Full screen.** It asks for full screen at the start; **F** toggles it.
- **The slides alone:** `?deck` (no demo; the recap slide then says "what the demo shows").
- **Who presents:** `presentation` in `agent.config.json` (`presenter`, `team`, `contact`); an empty value is left out.
- The slides and the words of parts 1 and 3 are in `dashboard/slides.js`; `test/slides.test.mjs` checks them, including the time they take.

The script and the player are in `dashboard/tour.js`, the slides in `dashboard/slides.js`; the choice of the recorded runs and answers in `lib/tour.mjs`.

## Done → documentation

When a ticket moves to **Done** (`documentOnDone: auto`), the watcher runs the `document-ticket` skill headless on branch `docs/<KEY>`. Which tickets: `documentScope` in `policy.json`: `analyzed` = the ones the agent analyzed; `withFix` (default) = also bugs it did not analyze, when a commit on `main` names the ticket or a branch named after it holds the fix. The watcher keeps the time of its last check (`state/done-poll.json`) and looks back at least `lookbackHours`, so tickets resolved while it was down are found too. The agent may only write `docs/knowledge/*.md` (checked); the watcher commits, pushes, opens a draft pull request and comments in Jira. Labels: `ai-documenting` → `ai-documented` (or `ai-doc-failed`).

The analysis and Ask read the knowledge base on `main` only, so a documentation PR helps nobody until it is merged. **Insights → Knowledge base** shows how many tickets are documented on `main`, and the documentation PRs waiting: open and draft ones, and ones closed without merging whose branch still exists (a demo reset closes them, see `demo/reset-demo.mjs`). With `mergeDocs: draft` in `policy.json` each has a **Merge…** button (**Reopen and merge…** for a closed one): after a confirmation the watcher marks it ready, squash-merges it, deletes its branch, comments on the ticket in Jira and emits `docs-merged`. A PR that changes anything outside `docs/knowledge/*.md`, or whose branch is not `docs/…`, is never merged from there (`lib/docs-prs.mjs`). GitHub refuses a PR that conflicts with one merged before (both edit the README index): the reason is shown, and the PR is fixed on GitHub. `mergeDocs: off` lists them only; `auto` is not used yet and behaves as `draft`.

**One file per component.** The knowledge files are named after the project's components, the same names as on the Insights tab (`insights.components`): `docs/knowledge/pazienti.md`, `prenotazioni.md`, … The agent passes them to the skills (`TICKET_INTEL_COMPONENTS`); a team that runs the skills by hand (Claude Code, Copilot) puts the same list in the app's `.ticket-intel.json` → `components`, and without either the files stay named after code paths. Tests are documented with the code or screen they test. The Insights drill-down of a component links its knowledge file. A knowledge base written before (path-named files) is moved once, without AI, as one draft PR:

```
node agent/knowledge-migrate.mjs --project DEM          # dry run: where every entry goes, the lint after the move, a preview
node agent/knowledge-migrate.mjs --project DEM --yes    # branch docs/migrate-<time>, one commit, draft PR
```

**Entries stay true.** An entry written while the fix was still on its branch cites commits that are gone after a squash merge; a file it cites may be renamed later. Without AI:

```
node agent/knowledge-refresh.mjs --project DEM          # dry run: entries to update, stale entries
node agent/knowledge-refresh.mjs --project DEM --yes    # "Merged into main as <commit>" on their Fix line, one draft PR
```

The commit on main is the ticket's own (its subject starts with the key; a documentation commit is not one). An entry citing a file that no longer exists on main (a path may be shortened from the front) is listed as stale for a person to update.

**Knowledge lint.** Before a documentation branch is pushed, plain code checks the entries the run wrote (`lib/knowledge.mjs`): **Type**, **Symptom**, **Search terms** (at least 3), **Root cause** labelled confirmed or assumed, and **Fix** are there; every cited commit exists; no statement about the state of a PR or branch ("not merged yet", "draft PR #14", "as of <date>"); no fixture keys (`CUP_…`); "People who know it" lists people, not the agent; and no personal data anywhere in the file (fiscal codes, e-mail addresses, phone numbers, IBANs, birth dates). With findings, the agent corrects them once in the same session; if they remain, nothing is pushed and the ticket gets `ai-doc-failed` with the findings. The same rules on what is already written:

```
node agent/knowledge-lint.mjs --project DEM                          # docs/knowledge on main
node agent/knowledge-lint.mjs --project LAB --ref origin/docs/LAB-23  # a documentation branch
```

**Backfill.** Tickets resolved before the agent documented them get their entries with one command, all on one branch (`docs/backfill-<time>`, one commit per ticket) and one draft pull request:

```
node agent/document-backfill.mjs --project DEM          # dry run: coverage, the tickets, why others are left out, the estimated cost
node agent/document-backfill.mjs --project DEM --yes    # document them (defaults: bugs fixed since 2026-01-01, 10 per PR, stop at $5)
   ... --since 2026-03-01 --limit 5 --max-cost 2 --types Bug,Story --only DEM-5,DEM-22
```

A candidate is a Done ticket of the chosen types with a commit on `main` that names it, no entry on `main`, no `docs/<KEY>` branch waiting, and no `no-ai` label. A ticket whose run fails is left out (its changes undone) and the batch goes on; each documented ticket gets a Jira comment and the `ai-documented` label. The estimate is the average cost of the documentation runs so far. `demo/reset-demo.mjs` keeps documentation PRs and branches (`--drop-docs` closes them too).

### Regression tests of the known issues (KB1)

Every entry has a **Test** line. It names the regression tests the fix added or changed on main, as files plus test names when the fix's diff shows them, for example:

- `` `backend/src/test/java/com/medilab/sample/SampleServiceTest.java` (`aTubeOfACancelledRequestCannotBeAccepted`) ``
- `none: the fix added or changed no test`

The tests come from the ticket's own commits (its key starts the subject; documentation commits excluded), because human fixes rarely name the ticket in the test. **Code writes the line, not the model:** `document.mjs` writes it after the documentation run, and `knowledge-refresh.mjs` adds it to older entries and fills in a `none` once a test exists. The lint requires the line, and the cited test files must be on main.

`node agent/knowledge-tests.mjs` runs the cited tests on a detached checkout of `origin/main` (`<state>/kb-tests-repo`, with node_modules linked). It makes one Maven run with a surefire selection (`SampleServiceTest#a+b,OrderServiceTest`) and one Playwright run with the spec files. Each entry gets one of four verdicts:

- **pass**;
- **fail**: the known issue may be back, before anyone reports it;
- **did not run**: a compile error, or a test renamed since;
- **none**: no regression test.

An entry without a Test line yet gets its tests computed from git, marked "from git". The result goes to `<state>/knowledge-tests.json` and appears at the top of Insights → **Knowledge base**, with the failing entries and the known issues that have no test. The fix and the AI review are told which test guards a known issue in the code they touch.

Checked on 2026-11-13: 25 of the 48 entries have tests, and all pass on main (38 JUnit and 3 Playwright tests, about 1–3 minutes per app). Putting back the code of LAB-8's fix (with its test unchanged) made the run report `fail: flagsWithTheRangeOfThePatientsSex: expected "H"`.

## Duplicates and known problems

Before the analysis looks for a new cause, it answers **Already known?** The skill's bundle puts the evidence in `priorArt`: related open tickets, resolved ones with the dates of their fix commits (before or after this ticket was reported), fix branches of other tickets that change the same code (git), and knowledge entries about the ticket or its related tickets. The analysis decides one kind and returns it in `priorArt`:

| Kind | Automatic fix | Jira comment / draft reply |
|---|---|---|
| `duplicate` (an open ticket reports the same) | no | "Already known: duplicate of KEY" / already reported, follow KEY |
| `in-progress` (another ticket's branch is fixing it) | no | names the branch / a fix is being prepared |
| `fixed-on-main` (fixed before the report; the reporter's version is older) | no | names the fix commit / fixed, coming with the next release |
| `regression` (fixed before, brought back by a later change) | yes | names the earlier ticket and the change |
| `solved-before` (same symptom, another path: the earlier fix is the template) | yes | cites the earlier fix |
| `documented` (a knowledge entry describes it) | yes, if it is a bug | cites the entry |

Which kinds stop the automatic fix: `policy.json` → `proposeFixWhen.skipKnown`. The card shows **Already known?**, the analysis email has it, and Insights counts a regression or a repeat as a recurring problem. The agent does not link or close tickets on its own.

## How often the agent was right (accuracy)

`node agent/accuracy.mjs` (and `GET /api/accuracy?project=DEM`) compares what the agent said or did with what happened afterwards. There is no answer key and no AI run: every ticket the agent analysed that later got its change on the main line, and every pull request it opened, is a test case. This is AI1 of [docs/AUTONOMY_AND_NEXT.md](../docs/AUTONOMY_AND_NEXT.md).

The input is one **graph** of the project (`lib/git-graph.mjs`, GG0 of [docs/GIT_GRAPH.md](../docs/GIT_GRAPH.md)), built from five sources:

- the commits of the shared line, through the skill's VCS adapters, so it works on **git and SVN**;
- the ticket each commit starts with (`DEM-5: …`), or mentions;
- the pull requests, through `gh`, on git and GitHub;
- the agent's event log, all `events*.jsonl`. Every analysis there carries its files, owner, confidence, "already known?" verdict and cost;
- Jira: type, status, resolution, assignee.

| What | Compared with | Notes |
|---|---|---|
| Files the analysis named | the code files of the ticket's change (tests and `docs/` left out) | a hit is any common file; also precision and recall. Shown **apart** when the agent fixed the ticket itself, because then the change follows the analysis and does not test it |
| Component | the component of the changed files (`insights.components`) | |
| Owner | the author of a person's change, or the Jira assignee | only for a person's change |
| Already known? | whether the ticket needed a change of its own | "duplicate / in progress / fixed on main" is right when the ticket closes without one; "new" is wrong when it is closed as a duplicate |
| Fix PRs | merged unchanged, merged with a person's commit, rejected, withdrawn, open | only PRs the agent's runs opened. **Withdrawn** = closed by the demo reset: its comment (`Closed by the demo reset`), or closed together with other agent PRs within two minutes anywhere in the suite. A PR rejected by a person is listed with its last comment as the reason |
| AI review | what became of the PR | "looks good" agrees with merged unchanged; "needs changes" agrees with changed or rejected |
| Documentation PRs | the same outcomes as fix PRs | |

Only a prediction made **before** the change counts: an analysis run after the ticket's change was on main is listed as skipped. Every number says what it is out of, and the notes say what could not be measured and why. One snapshot a day is kept in `<project state>/accuracy/snapshots.json` for the trend.

From 2026-11-13 on, the events also record the model of each run (`meta.model`), and the cost of fixes and documentation (`fix-proposed` and `documented` carry `meta`).

### Replay on resolved history

Until people fix tickets the agent analysed, the live numbers cannot test the analysis. `node agent/replay.mjs --project DEM` fills that gap from history. It runs the analysis again on every resolved bug a person fixed, as if the bug had just come in, and compares the result with the real fix by the same rules as above.

| Hidden from the run | How |
|---|---|
| the fix and everything after it | a clone at the fix's parent: branch `main` only, no remote, no tags, objects pruned. The clone is refused if `git log --all` still finds a commit starting with the ticket's key |
| the knowledge entry of the bug | it is not in that clone (it was written later) |
| what Jira learned later | a frozen Jira (`<state>/replay-work/<KEY>/jira.json`) served by the skill's offline source (`JIRA_MOCK=1`, `JIRA_MOCK_FILE`). It holds the ticket as reported (no comments, status, resolution, assignee, links or attachments) and the tickets that existed then, without comments. "Existed then" goes by git time (a change before the fix; with no change, a lower number), because the demo's Jira dates are all from one day and its numbers are not in time order |

Linked apps are left out, and the replay needs git: SVN shows later revisions from the server. The command is a dry run by default (candidates and estimated cost); `--yes` runs it, with `--limit`, `--only DEM-5,DEM-22`, `--again` and `--max-cost` (default $10). Each result is kept in `<state>/replay/<KEY>.json`. `accuracy.mjs` and the Graph tab show the replays under **Replay**, apart from the live numbers. The frozen Jira file is stored locally only; the skill masks personal data before the model reads anything (R-02).

### Impact tab (the management week)

The **Impact** tab (and `node agent/impact.mjs`) covers the whole suite, week by week, with weeks starting on Monday. It shows six tiles for this week against last week: hours saved, tickets analysed, fixes merged, tickets documented, cost, and what waits for a person. Below them are bars of hours saved and of cost per week, a table week by week, and a table per app that adds the accuracy (fix PRs merged unchanged, review agreement, replay). Everything comes from the projects' graphs, with no AI.

**Hours saved is an estimate, and the page says so.** For each step it takes the team's minutes without the agent (`agent.config.json` → `baseline`: analysis 45, reproduce 60, fix 180, documentation 30) and subtracts the measured time, never going below zero. It counts only work a person can use:

- a ticket's first analysis in the week;
- a fix PR of the agent merged that week (reproduce + fix, minus the time from the analysis to the PR);
- each ticket in a documentation PR merged that week.

The time people spend reviewing is not subtracted. Fixes and documentation have a recorded cost only from 2026-11-13; the page notes how many fix PRs from before then have none.

### Graph tab

The dashboard's **Graph** tab shows the same numbers as six tiles, with the notes and every PR a person closed together with its reason. Below them are the **ticket lanes**. On the left is the main line, and next to it one lane for each ticket the agent worked on. A lane runs from the analysis through the failing test, the fix, the draft PR and the AI review, and bends into the main line at the ticket's commit there (the squash merge of its PR; on SVN, the commit). A lane that never reaches main ends where its PR was closed. The newest row is at the top, as in a branch graph. A node's colour is the state of its step: green for verified, merged or low risk; red for a failing test, a stop or high risk; amber for already known or medium risk; grey for closed or not eligible. The row names the step in words too.

Filters: the time window (7, 30, 90 or 365 days), one ticket (click its key), and only the agent's work. The layout is plain code (`lib/graph-lanes.mjs`), served by `GET /api/graph?project=DEM&days=30[&ticket=DEM-42][&agentOnly=1]`, and is cut to the newest 400 rows. All times are compared in UTC: git gives local time with an offset, while the events and GitHub use UTC.
