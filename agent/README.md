# Ticket Intelligence agent

Runs the `/analyze-ticket` skill on its own: it watches a Jira project, analyzes every new ticket headless, posts the analysis to Jira, notifies the most suitable person, and shows everything live on a dashboard.

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

## Tools

| Command | What it does | Writes to Jira |
|---|---|---|
| `node agent/watcher.mjs` | watch, analyze, act, serve the dashboard | per policy |
| `node agent/analyze-one.mjs DEM-7` | dry run: analyze one ticket and print the JSON result | no |
| `node agent/process-one.mjs DEM-7` | full pipeline for one ticket | per policy |
| `node agent/process-one.mjs DEM-7 --reuse-result` | act on the last saved analysis, without analyzing again | per policy |

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
- **The watcher acts, per `policy.json`.** Every action is `auto`, `draft` (prepared and shown on the dashboard for a human) or `off`:

  | Action | Default |
  |---|---|
  | internal Jira comment | auto |
  | labels | auto |
  | notify the owner | auto, only for a real person and at least `notifyMinConfidence` |
  | assign the owner | draft |
  | reply to the reporter | draft |
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
| `analysisTimeoutMinutes` | a run is stopped after this long |
| `dashboardPort` | dashboard port |
| `labels` | the agent's label names |
| `claude.command`, `claude.maxTurns`, `claude.model` | how the headless agent is started |

## Notifications

Without configuration, owner notifications are shown on the dashboard as Teams-style cards. To post them to a real Teams channel, create a webhook in the channel (Workflows › "Post to a channel when a webhook request is received") and set `TEAMS_WEBHOOK_URL=` in `~/.claude/skills/analyze-ticket/.env`.

## Automatic reproduction and fix

For tickets that pass `proposeFixWhen` in `policy.json`, the agent continues after the analysis. By default:

- `[FE]` in the title, **or** a title without any tag where every file the analysis names is under `frontend/` (`inferTagFromFiles`). An explicit other tag such as `[BE]` is respected: no fix.
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

Each fix branch starts from `main`, so previewing one shows only that fix, not earlier ones. The MediAgenda repository is private: a browser that is not signed in to GitHub as the repository owner gets **404** on pull request links.

## Done → documentation

When a ticket the agent analyzed moves to **Done** (`documentOnDone: auto`), the watcher runs the `document-ticket` skill headless on branch `docs/<KEY>`. The agent may only write `docs/knowledge/*.md` (checked); the watcher commits, pushes, opens a draft pull request and comments in Jira. Labels: `ai-documenting` → `ai-documented` (or `ai-doc-failed`).

## Duplicates

When the analysis finds an open ticket reporting the same problem, it returns `duplicateOf`. The dashboard flags it, and the Jira comment mentions it. The agent does not link or close tickets on its own.
