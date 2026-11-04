# Ticket Intelligence: `/analyze-ticket` and `/document-ticket`

Two agent skills (Claude Code and GitHub Copilot) for a developer or manager who gets a ticket on a project they don't know.

**`/analyze-ticket CUP_DEMO-2629 "Ticket title"`** runs from the project folder. The skill:
1. loads the ticket from Jira with its description, comments, worklog, change history and screenshots, plus related tickets (same environment, similar symptom, tickets the description refers to);
2. finds the **component in the code** the ticket is about: through commits that mention related tickets, a code search for clues from the description (endpoint, flag or field names, button labels), and the change history;
3. shows **who worked** on that code and on the related tickets, **when**, and **exactly what they changed** (with the diff);
4. highlights **suspect changes**: commits to that component in the days before the problem was reported;
5. reads existing known-issue documentation in `docs/knowledge/`;
6. writes a report with the problem, where it is in the code, the likely cause, a **concrete proposed fix**, who to talk to, next steps and whether to escalate;
7. prepares three drafts: a handoff message to the expert, a reply to the reporter, and a Jira comment.

**`/document-ticket CUP_DEMO-2629`** runs when the ticket is resolved. The skill:
1. takes the confirmed cause and fix from the fix commits and comments;
2. writes them to `docs/knowledge/<component>.md` (symptom, cause, fix, how to verify, who knows the area) and updates the `docs/knowledge/README.md` index;
3. shows the diff and, after your approval, commits it on a review branch or directly, as configured for the project.

Every resolved ticket is recorded in the project itself, and the next `/analyze-ticket` finds it straight away.

Everything is **read-only** until you approve. The only write actions are the Jira comment and the documentation commit, and both need an explicit "yes".

## Project documents

| Document | Purpose |
|---|---|
| [docs/PROBLEM_BRIEF.md](docs/PROBLEM_BRIEF.md) | the problem, who it affects, goals, scope, success metrics |
| [SPEC.md](SPEC.md) | functional requirements, architecture, interfaces, security, validation status |
| [docs/DEMO_SCENARIO.md](docs/DEMO_SCENARIO.md) | demo script, setup checklist, fallbacks, reset |
| [docs/DEPENDENCIES_AND_RISKS.md](docs/DEPENDENCIES_AND_RISKS.md) | dependencies, assumptions, risk register |
| [docs/EXIT_CRITERIA.md](docs/EXIT_CRITERIA.md) | gate from discovery to the next build steps |
| [docs/COPILOT_TEST.md](docs/COPILOT_TEST.md) | test plan for GitHub Copilot on company projects |

## Installation (once)

```
node install.mjs
```

The script copies both skills to `~/.claude/skills/`, so they work in every project you open. Jira settings then live in `~/.claude/skills/analyze-ticket/.env`. After updating the skills, run the same script again; your `.env` and `config.json` are kept.

| Command | Target | Used by |
|---|---|---|
| `node install.mjs` | `~/.claude/skills/` | Claude Code and **GitHub Copilot in VS Code** (Copilot reads this folder too) |
| `node install.mjs --copilot-cli` | also `~/.copilot/skills/` | GitHub Copilot CLI |
| `node install.mjs --project <repo>` | `<repo>/.github/skills/` | the whole team, through the repository. No secrets: Jira credentials stay with each user |

## Autonomous agent

`agent/` runs the analysis on its own: it watches a Jira project, analyzes every new ticket headless, posts the analysis to Jira, notifies the most suitable person and shows everything live on a dashboard. A new ticket is analyzed and commented on in about a minute, with no human start.

```
node agent/watcher.mjs        # dashboard on http://localhost:7070
```

What it may do on its own is set in `agent/policy.json`. See [agent/README.md](agent/README.md).

## GitHub Copilot

Copilot in VS Code supports the same skill format (`SKILL.md`) and reads skills from `~/.claude/skills/` and from the project's `.github/skills/` ([documentation](https://code.visualstudio.com/docs/agent-customization/agent-skills)). In Copilot Chat, agent mode, type `/analyze-ticket CUP_DEMO-2629 "…"` or just ask "analyze ticket CUP_DEMO-2629".

- The scripts are plain Node commands, so Copilot runs them in the terminal just like Claude does. By default Copilot asks before every terminal command; you can allow `node` commands in the VS Code setting `chat.tools.terminal.autoApprove`.
- The quality of the analysis depends on the model selected in Copilot (Claude models can be selected too).
- Not yet tested inside Copilot itself. The format and commands are the same, so the first run at work is the real test.

## Git and SVN

The code analysis works on git repositories and on SVN working copies. The tool detects which one the project uses:

| | git | SVN |
|---|---|---|
| Commits per ticket | `git log --grep` | `svn log --search` (from the server) |
| Diff | `git show` | `svn diff -c <revision>` |
| Code search | `git grep` | search over the working copy files |
| Branches | `refs/heads`, `refs/remotes` | `^/branches/…` |
| Authors | git name and email | SVN login (e.g. `sara.colombo`) |
| `/document-ticket` | review branch + PR, or direct | direct commit, branch (`svn copy`) or patch file. **An SVN commit goes straight to the server**, so it always asks first |

SVN needs the command line `svn` client. With TortoiseSVN that is the "command line client tools" option at install time. If `svn` is not on PATH, put its path in `.env` as `SVN_BIN=…`. The tool runs `svn` non-interactively, so the server credentials must already be cached (log in once through TortoiseSVN or `svn info`).

SVN logins can be mapped to Jira names in the project's `.ticket-intel.json`:
```json
{ "authorAliases": { "sara.colombo": "Sara Colombo", "lbianchi": "Luca Bianchi" } }
```

## Try it on the demo project (no Jira needed): MediAgenda

A fictional project modelled on real tickets, where the AI has to search through frontend, backend and database:

| Part | What |
|---|---|
| Frontend | Angular 18: `core/`, `shared/components/` (Struttura autocomplete, PULISCI/RICERCA footer), `features/` (agenda, booking, patients, reports) |
| Backend | Spring Boot 3, Java 21: modules `structure`, `resource`, `timeslot`, `booking`, `patient`, `report`, `common` |
| Database | H2 (SQL, in memory) + Flyway migrations V1–V4 in `backend/src/main/resources/db/migration` |
| History | 14 commits by 4 people (Davide and Luca on the backend, Marta and Sara on the frontend) |
| Repository | private GitHub repo [Bojan-Mijatovic/MediAgenda](https://github.com/Bojan-Mijatovic/MediAgenda), cloned in `demo/mediagenda`; the agent works there on branches and pull requests |
| Jira (mock) | CUP_DEMO-2398, 2511, 2580, 2602, 2615 and the target ticket **CUP_DEMO-2629** |

The story: CUP_DEMO-2398 made the time slot search work for several structures, and the frontend store started to **append** every selected structure. CUP_DEMO-2511 fixed the PULISCI button, but clearing the Struttura field by hand still leaves the old structure in the store. That is CUP_DEMO-2629.

```
node demo/make-mediagenda.mjs        # builds demo/mediagenda (+ npm install for the frontend)
node demo/run-mediagenda.mjs         # backend http://localhost:8080 + frontend http://localhost:4200
cd demo/mediagenda
claude
> /analyze-ticket CUP_DEMO-2629 "[FE] - Agenda: Search mask: Struttura field: the manually cleaning button doesn't work properly"
```

**Reproducing the bug in the app** (http://localhost:4200/agenda):
1. Type `SVIL` in the Struttura field and pick `SVIL_MS_VISITE`.
2. Clear the field with the keyboard.
3. Type `TEST` and pick `TEST_GEN_25`.

The Risorse list now shows the providers of both structures (`MS_…` and `TG_…`), and in DevTools › Network the `structure-timeslots` request sends both IDs. The backend log shows the same: `StructureTimeSlot search … structureIds=[SVIL_MS_VISITE, TEST_GEN_25]`.

Java and Maven are not installed system-wide: `run-mediagenda.mjs` uses the portable JDK 21 and Maven in `tools/`.

**The same app on SVN:**
```
node demo/make-mediagenda.mjs --svn   # demo/mediagenda-svn-repo (SVN repository, trunk/branches/tags) + demo/mediagenda-svn (working copy)
node demo/run-mediagenda.mjs --svn
cd demo/mediagenda-svn
> /analyze-ticket CUP_DEMO-2629 "…"
```
The history is the same (r2–r15), with SVN logins as authors. The analysis finds the same components and people as on git. The portable SVN client is in `tools/svn`.

## Connecting to a real Jira (Cloud)

1. Create an API token at https://id.atlassian.com/manage-profile/security/api-tokens.
2. In `~/.claude/skills/analyze-ticket/.env` set:
   ```
   JIRA_MOCK=0
   JIRA_BASE_URL=https://your-company.atlassian.net
   JIRA_DEPLOYMENT=cloud
   JIRA_EMAIL=...
   JIRA_API_TOKEN=...
   ```
3. Check the connection: `node ~/.claude/skills/analyze-ticket/scripts/ticket.mjs check`
4. Find which field holds the environment (e.g. `SVIL`, `acme-prod`):
   ```
   node ~/.claude/skills/analyze-ticket/scripts/ticket.mjs recent          # most recently updated tickets
   node ~/.claude/skills/analyze-ticket/scripts/ticket.mjs inspect PROJ-123  # every non-empty field of one ticket
   ```
   Put that field's `id` in `config.json` as `environmentField`:

   | Value | When |
   |---|---|
   | `environment` | the built-in Jira *Environment* field (text search) |
   | `components` | the environment is a Component |
   | `labels` | the environment is a label |
   | `customfield_NNNNN` | a custom field. If it is a text field rather than a select, add `"environmentMatch": "text"` |

   If the environment is not in any field, the skill reads it from the ticket description.

## Per-project settings: `.ticket-intel.json`

Optional file in the root of the application's repository. Without it the defaults apply, and `/document-ticket` asks for the commit mode and offers to save the choice.

```json
{
  "docsPath": "docs/knowledge",
  "commitMode": "branch-pr",
  "baseBranch": "main",
  "componentContainers": ["src", "app", "packages", "services", "config"],
  "suspectWindowDays": 14,
  "authorAliases": { "sara.colombo": "Sara Colombo" }
}
```

- `commitMode`: git: `branch-pr` (review branch and pull request, recommended) or `direct`; SVN: `direct`, `branch` or `patch`; or `ask`.
- `componentContainers`: folders whose subfolders are separate components. For example `src/orders` is a component, `src` is not. Java packages are handled automatically (`…/com/acme/app/timeslot`).
- `suspectWindowDays`: how many days before the ticket was opened a change counts as suspect.
- `authorAliases`: VCS login → display name, mostly for SVN.

The code analysis works best when **commit messages contain the Jira key** (e.g. `CUP_DEMO-2511: ...`). Then the link ticket → commit → file → component is precise. Without keys the skill relies on code and message search, which is less precise.

## How it works

```
.claude/skills/
├── analyze-ticket/
│   ├── SKILL.md              workflow, rules and report format
│   ├── config.json           Jira settings (no secrets)
│   ├── fixtures/             fictional demo Jira data
│   └── scripts/
│       ├── ticket.mjs        CLI: analyze | fetch | resolve | recent | inspect | comment | check | fields
│       └── lib/
│           ├── jira.mjs      Jira REST v2 client (Cloud + Data Center), JQL, normalization, attachments
│           ├── code.mjs      code analysis: components, authors, commits per ticket, suspect changes, docs
│           ├── vcs/git.mjs   git adapter (log, grep, show, branches)
│           ├── vcs/svn.mjs   SVN adapter (svn log --xml, svn diff, working copy search)
│           ├── analysis.mjs  ticket signals, related tickets, people ranking
│           ├── mock.mjs      demo Jira source
│           ├── text.mjs      keywords, clues from text (paths, identifiers, quoted labels)
│           └── config.mjs    .env and config.json
└── document-ticket/
    └── SKILL.md              writes docs/knowledge and commits (git or SVN)
demo/make-mediagenda.mjs      builds demo/mediagenda (git) or, with --svn, demo/mediagenda-svn
demo/run-mediagenda.mjs       starts the backend (8080) and the frontend (4200)
demo/src/mediagenda/template/ the demo project as it is today (HEAD)
demo/src/mediagenda/history/  older versions of files, used to replay the history
install.mjs                   installs the skills (user-level, Copilot CLI or into a project)
agent/                        autonomous watcher, headless analysis, policy, live dashboard
demo/seed-jira.mjs            copies the historical demo tickets into a real Jira project
demo/new-ticket.mjs           opens the demo target ticket in Jira (rehearsal / live demo)
demo/resolve-ticket.mjs       moves a ticket to Done (triggers the documentation stage)
demo/reset-demo.mjs           puts the demo back to its starting point (dry run unless --yes)
demo/preflight.mjs            go / no-go check before a live demo
```

Division of work: the **scripts** collect data from Jira and git/SVN and compute transparent scores; the **agent** reads the ticket, screenshots, diffs and code, connects the facts, and writes the report, the proposed fix and the documentation. The scripts need Node 18+ and have no dependencies. Only read-only VCS commands are used for the analysis.

**Related tickets** are found with three JQL queries (by environment, by title keywords, by specific names from the description) plus explicit links. Relevance is `0.4·same env + 0.5·max(text match, clue match) + 0.3·linked + 0.1·resolved`.

**Components in the code** are ranked by:
- commits that mention this ticket or related tickets (strongest signal, weighted by the ticket's relevance);
- code search hits for clues from the description (paths, quoted or backticked identifiers, camelCase and dotted names);
- commit messages that match the ticket text;
- changes in the window before the ticket was opened.

**People ranking** (points per activity, multiplied by the ticket's relevance² and a recency decay with a 180-day half-life):

| Activity | Points |
|---|---|
| resolved a related ticket | 5 |
| assignee when the ticket was resolved | 3 |
| assignee of an open ticket | 2 |
| technical comment (>200 chars) / regular comment | 2 / 1 |
| worklog, per hour (max 8 h per ticket) | 0.75 |
| status change / other edits | 0.5 / 0.25 |

The agent also takes into account who committed to the component. The ticket's reporter is never a candidate. The score only orders the list; the recommendation is justified with concrete tickets and commits.

## Limitations

- Tested on demo data. Not yet run against a real Jira Cloud or inside GitHub Copilot.
- SVN is tested against a local (`file://`) repository; a real server needs cached credentials.
- The search covers the last 365 days and at most 10 related tickets (`lookbackDays`, `maxRelated` in `config.json`).
- Commits that don't mention a Jira key can't be reliably linked to a ticket.
- Pull requests are opened automatically only on GitHub (`gh`). For GitLab, Bitbucket and Azure DevOps the skill gives the link or the steps.

## Next phases

| Phase | What |
|---|---|
| 2 | Confluence as an additional documentation source, if you use it |
| 3 | Input from Teams and email (Microsoft Graph): a bot recognizes a ticket in a message and starts the analysis |
| 3 | Sending the handoff message directly to the recommended person |
| 4 | Automatic `/document-ticket` when a ticket moves to Done (a service that watches Jira) |
