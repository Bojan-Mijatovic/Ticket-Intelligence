# Test Plan: Ticket Intelligence in GitHub Copilot (at work)

| | |
|---|---|
| **Goal** | Confirm that `/analyze-ticket` and `/document-ticket` work in GitHub Copilot (VS Code agent mode) on company projects, git and SVN, as they do in Claude Code |
| **Owner** | Bojan Mijatović |
| **Covers** | risk R-07 (Copilot behaves differently), NFR-03 |
| **Time** | about 1 hour |

## 1. Preconditions

- [ ] VS Code ≥ 1.108 with GitHub Copilot (Business or Enterprise licence), **agent mode** available.
- [ ] Node.js 18+ on the workstation.
- [ ] The repository cloned; skills installed: `node install.mjs` (user-level, `~/.claude/skills`, which Copilot reads).
- [ ] Jira credentials for the **company** Jira in `~/.claude/skills/analyze-ticket/.env` (`JIRA_MOCK=0`).
- [ ] For SVN projects: the svn command line client (TortoiseSVN "command line client tools") or `SVN_BIN` in `.env`.
- [ ] **Data protection (R-02):** use only tickets **without patient or personal data** until the AI service and redaction are approved.

Optional, to avoid a confirmation for every command: in VS Code settings, `chat.tools.terminal.autoApprove` → allow `node`.

## 2. Test cases

| # | Case | Steps | Expected |
|---|---|---|---|
| TC-1 | Skills are discovered | Open a project folder; in Copilot Chat (agent mode) type `/` | `analyze-ticket` and `document-ticket` are listed |
| TC-2 | Connection | Ask Copilot to run `node ~/.claude/skills/analyze-ticket/scripts/ticket.mjs check` | `ok: true`, your Jira user |
| TC-3 | Environment field | `ticket.mjs inspect <KEY>` on a typical ticket; set `environmentField` in `config.json` | the field holding the environment is identified |
| TC-4 | Analysis, git project | `/analyze-ticket <KEY> "<title>"` on a resolved ticket whose fix you know | report with problem, code location (path:line), related tickets, owner, next steps; compare with what really happened |
| TC-5 | Analysis, SVN project | same as TC-4 in an SVN working copy | `code.vcs = svn`; revisions `rNNN`; same report structure |
| TC-6 | Screenshot | a ticket with an image attachment | the report describes what the screenshot shows |
| TC-7 | Ticket referring to earlier work | a ticket that says "as we did on …" | the earlier ticket is found and its fix commits are used |
| TC-8 | Language rules | write the request in Serbian | chat report in Serbian; the Jira comment draft in English |
| TC-9 | No unapproved writes | let the analysis finish | Copilot asks before posting a Jira comment; nothing is posted without "yes" |
| TC-10 | Documentation, patch mode | `/document-ticket <KEY>` on a resolved ticket; choose `patch` (SVN) or a review branch (git) | a `docs/knowledge/<component>.md` entry; confirmed vs. assumed facts labelled; nothing committed without approval |

## 3. What to record

For each case: result (pass / fail / partial), time taken, the model selected in Copilot, and any difference from Claude Code (argument handling, terminal approvals, image reading, output quality).

| # | Result | Time | Model | Notes |
|---|---|---|---|---|
| TC-1 | | | | |
| TC-2 | | | | |
| TC-3 | | | | |
| TC-4 | | | | |
| TC-5 | | | | |
| TC-6 | | | | |
| TC-7 | | | | |
| TC-8 | | | | |
| TC-9 | | | | |
| TC-10 | | | | |

## 4. Exit criteria

- TC-1, TC-2, TC-4 and TC-9 pass: the skills are usable in Copilot for on-demand analysis.
- TC-4 and TC-5 correct on at least 3 of 5 real tickets each: proceed to the MVP measurement on 20–30 tickets (PROBLEM_BRIEF §5).
- Any failure: record it in [DEPENDENCIES_AND_RISKS.md](DEPENDENCIES_AND_RISKS.md) (R-07) with the workaround.

## 5. Known differences to watch

- `$ARGUMENTS` may not be substituted; the skills fall back to the ticket ID in your message.
- The skill's base directory may not be shown; the skills fall back to `~/.claude/skills/analyze-ticket`.
- Copilot runs commands in the VS Code terminal (PowerShell by default) and asks before each one unless auto-approved.
- The autonomous agent (`agent/watcher.mjs`) uses the Claude Code CLI headless; it does not run inside Copilot.
