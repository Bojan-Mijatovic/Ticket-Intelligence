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
node agent/watcher.mjs
```

Open http://localhost:7070, then create a ticket in the Jira project. The agent picks it up within `pollSeconds` (or at once with **Check now**).

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
| `ai-analyzed` | done; remove the label to have the ticket analyzed again |
| `ai-failed` | the analysis failed; see the dashboard; remove the label to retry |
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

## Duplicates

When the analysis finds an open ticket reporting the same problem, it returns `duplicateOf`. The dashboard flags it, and the Jira comment mentions it. The agent does not link or close tickets on its own.
