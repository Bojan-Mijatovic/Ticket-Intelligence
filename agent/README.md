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

A suggestion whose summary matches an existing ticket is left out, and one that an open ticket already says (most words of the summary alike) shows *already open as KEY* instead of the button. Nothing is created on its own (`policy.json` → `createTicket`: `draft` shows **Create in Jira…**, `off` only lists them). The button opens the ticket for editing (summary, type, priority, description, and the **assignee**: the people Jira lets you assign in that project, with the suggested person picked when they have an account); after a confirmation the watcher creates it with the label `ai-suggested`, plus `no-ai` unless *Let the agent analyze it* is ticked. The picked assignee is checked in Jira again; when the suggested person has no account, or someone else was picked, the description says so. New tickets stay in the backlog: the agent does not move them into a sprint or change their status. Created suggestions are remembered in `insights/suggestions-created.json` and shown with their key.

Who wrote the change that brought a bug in is not shown by default: the table names the change (ticket and commit), not the person. Set `insights.showBugOrigin: true` to add the author column.

## Ask the knowledge base

The dashboard's **Ask** tab (and `node agent/ask.mjs "question"`) answers questions such as "Has the Struttura field bug happened before?" or "Which bugs did Prenotazioni have since June?" in about 20–30 s:

1. **The code collects the data first:** Jira tickets found by the words of the question (plus the latest ones and any key named in it) with description, last comments and links; the agent's saved analyses; the git log of `origin/main` with changed files. They are written to `state/ask/<time>/`.
2. **A headless run reads them**, plus the code and `docs/knowledge/` in its own checkout of `origin/main` (`state/ask-repo`). Its only tools are Read, Grep and Glob (an allow-list), and no MCP servers are loaded: the question is free text from anyone at the dashboard, so a shell or a publishing tool must not exist in that run at all.
3. **Every cited source is checked:** a ticket must be in the collected data, a commit in the git log, a file in the repository. Unknown sources are dropped; an answer with no valid source is shown as "not in the knowledge base", with the closest tickets.

One question at a time (`409` otherwise); `askTimeoutSeconds` (default 120) and `askMaxTurns` (default 16) in `agent.config.json`. Questions and answers are logged locally in `state/asks.jsonl` and `state/ask/`.

## Guided tour

**▶ Tour** in the dashboard header presents the whole tool by itself, in English, in about ten minutes. A cursor moves and clicks, the page scrolls and puts a spotlight on each part, explainer slides open over the page, and a voice explains it all while captions show the text. The caption bar names the chapter:

| Chapter | What it shows |
|---|---|
| The problem | a slide: what an engineer has to do by hand for every ticket, who suffers, the goal |
| Behind the scenes | an animated flow: collect (plain code) → analyze (Claude, read-only) → prove and fix (test, fix, re-checks, draft PR, AI review) → learn (knowledge base, Insights, Ask) |
| The AI | a slide: which models do what (Sonnet for the analysis, Opus for the fix, review and Ask), code versus model, guardrails, why it is not trained, cost |
| The dashboard | the live light, the four apps, the counters |
| Case 1 | a frontend bug end to end: steps, cause, files, owner, Teams message, drafts, failing browser test, fix, draft PR, AI review |
| Case 2 | a backend bug whose cause is in another app: the linked app's change it cites, where the fix belongs, a JUnit test, the PR |
| Case 3 | a duplicate: the agent flags it and makes no second fix |
| Insights | the suite page, one app's numbers, a heatmap cell clicked open, hotspots, the AI review, suggested tickets, risk files, bug origins, the knowledge map |
| Ask | a question typed and answered with checked sources, and one that is "not in the knowledge base" |
| How it was built | a slide: the ideas, how it is tested and scored, results, what comes next |

Numbers and names come from the data on the page (tickets, owners, causes, hotspots, counts); a part with no data is skipped.

- **Replays.** When a ticket has been analyzed since the last reset, Case 1 is that ticket. Otherwise the cases are **recorded runs** from the event logs, archived ones included (`/api/tour/replay`): the ticket arrives, the steps stream in, then the analysis, the Teams message, the failing test, the fix, the pull request and the review appear one after the other, sped up, with the real timings. Ask replays **recorded answers** (`/api/tour/asks`): the example question that was asked before, and the newest "not found" one, with the steps rebuilt from the saved run. Every replay says **REPLAY** and its date, lives only in that browser page and is gone when the tour ends. `tourReplay` in `agent.config.json` lists the tickets (`DEM-36`, `FAR-19`, `BIL-20`); tickets never recorded are left out, and with none the fullest run is chosen.
- **Read-only.** It never starts an agent run, an Ask question, an app review or a recommendation. Its Ask button press is only shown; nothing is sent.
- **Voice.** The browser's own speech synthesis: free, no key, nothing leaves the machine. The tour picks a natural English voice when there is one (Edge on Windows has *Aria*, *Jenny* and *Guy Natural*); the voice and speed can be changed in the caption bar, or switched to *captions only*.
- **Controls.** Back / Pause / Next, or ← space →; Esc ends it. Afterwards the dashboard returns to the tab and project it showed before.
- **For a presentation** open `http://localhost:7070/?tour`: a *Start the guided tour* button covers the page, because browsers let a page speak only after a click.
- **After changing the code** restart the watcher (`node agent/watcher.mjs --replace`) and reload the page: a watcher started earlier does not serve `tour.js`, and the button then does nothing.

The script, the slides and the player are in `dashboard/tour.js`; the choice of the recorded runs and answers in `lib/tour.mjs`.

## Done → documentation

When a ticket the agent analyzed moves to **Done** (`documentOnDone: auto`), the watcher runs the `document-ticket` skill headless on branch `docs/<KEY>`. The agent may only write `docs/knowledge/*.md` (checked); the watcher commits, pushes, opens a draft pull request and comments in Jira. Labels: `ai-documenting` → `ai-documented` (or `ai-doc-failed`).

## Duplicates

When the analysis finds an open ticket reporting the same problem, it returns `duplicateOf`. The dashboard flags it, and the Jira comment mentions it. The agent does not link or close tickets on its own.
