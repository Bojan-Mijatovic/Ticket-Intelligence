# Dependencies and Risks

| | |
|---|---|
| **Status** | Recorded and approved by Bojan Mijatović (2026-11-04); review weekly during the POC |
| **Owner** | Bojan Mijatović |
| **Date** | 2026-11-04 |

## 1. Dependencies

### 1.1 Software

| Dependency | Version (tested) | Used for | Notes |
|---|---|---|---|
| Node.js | 20.11.1 | skills' scripts, agent, demo tooling | Node 18+ required; no npm packages needed by the skills or the agent |
| Claude Code CLI | 2.1.318 | headless analysis (`claude -p`) | must be logged in on the machine running the agent |
| Claude Code VS Code extension | 2.1.318 | interactive use | |
| GitHub Copilot (VS Code agent mode) | — | interactive use at work | not yet tested |
| git | 2.55 | code analysis, demo repository | |
| Subversion client | 1.14.5 (portable, `tools/svn`) | code analysis on SVN projects | TortoiseSVN needs the "command line client tools" option |
| JDK / Maven | Temurin 21.0.13 / 3.9.9 (portable, `tools/`) | demo backend | not needed for the skills or agent |
| Angular CLI | 18.2 | demo frontend | Angular 19+ needs Node ≥ 20.19 |
| Playwright + Chromium | — | bug reproduction *(planned)* | ~150–300 MB download |
| GitHub CLI (`gh`) | 2.101 | pull requests *(planned)* | GitHub only |

### 1.2 Services and accounts

| Dependency | Status | Needed for |
|---|---|---|
| Jira Cloud sandbox `bojanmijatovic.atlassian.net`, project DEM | available | POC |
| Jira API token (the sandbox owner's account, stored in the per-user `.env`) | available | POC |
| Company Jira project + service account | **missing** | MVP on real tickets |
| Teams channel + Workflows webhook | **not possible now** (no test channel); notifications simulated on the dashboard | real notifications |
| GitHub repository for the demo app | **open** (decision pending) | real draft PRs *(planned)* |
| Approved AI service for company ticket data | **open** | any use on company tickets |

### 1.3 People and decisions

| Decision | Owner | Needed by |
|---|---|---|
| Approve the problem brief | sponsor | end of discovery |
| Review SPEC.md | tech lead | end of discovery |
| Which company project, environment field, VCS repositories | team lead | MVP start |
| AI data processing approval (patient data) | security / DPO | before company tickets |
| Where the agent runs after the POC | tech lead / IT | MVP |

## 2. Assumptions

- A1. Ticket keys appear in most commit messages (`DEM-5: …`). Without them, code links rely on search and are less precise.
- A2. Developers' git/SVN identities can be matched to Jira users (directly, or with `authorAliases`).
- A3. The workstation running the agent stays on and online during working hours (POC).
- A4. One poll every 30 s is within Jira Cloud rate limits for one project.

## 3. Risk register

Likelihood and impact: L = low, M = medium, H = high.

| ID | Risk | L | I | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|
| R-01 | **Wrong analysis** (cause, owner) on real tickets erodes trust | M | H | confidence shown; comment labelled as AI analysis; no notification below `medium`; measure on 20–30 resolved tickets before rollout; humans approve all customer-facing text | Bojan | open |
| R-02 | **Patient / personal data** sent to an AI service | M | H | use only approved enterprise AI services; add automatic redaction before analysis; start with projects without patient data; DPO approval | Security / Bojan | **open: blocker for company tickets** |
| R-03 | **Prompt injection** through ticket text, comments or code ("ignore instructions and …") | L | H | analysis is read-only (editing tools disabled); watcher is the only writer and follows `policy.json`; skills treat ticket/commit text as data | Bojan | mitigated |
| R-04 | **Unintended writes** (comments, commits, pushes) | L | H | policy file; `ai-*` labels prevent double processing; git push / SVN commit always ask; audit log | Bojan | mitigated |
| R-05 | **Live demo failure** (network, Jira, CLI session) | M | M | checklist 30 min before; recorded fallback; dashboard keeps history | Bojan | open |
| R-06 | **Claude CLI session expires** on the agent machine | M | M | check before demos; for an unattended service use an API key or service login | Bojan | open |
| R-07 | **GitHub Copilot behaves differently** (argument substitution, terminal approvals, model quality) | M | M | skills have Copilot fallbacks; test at work in week 1; terminal auto-approve for `node` | Bojan | open |
| R-08 | **Commits without ticket keys** weaken code links | M | M | code search and message matching as fallback; recommend the convention to the team | Team lead | open |
| R-09 | **SVN server access** (credentials, non-interactive mode, slow `svn log`) | M | M | cached credentials; log window cached per run; test on a company SVN repo | Bojan | open |
| R-10 | **Jira differences** (team- vs company-managed, missing Priority/Environment fields, Data Center vs Cloud) | M | L | `environmentField` configurable (labels in DEM); Data Center supported via PAT and `/search`; `inspect`/`fields` commands to discover fields | Bojan | mitigated |
| R-11 | **Cost / usage limits** at scale | L | M | ~10 turns per ticket; `maxTurns` and timeout; `no-ai` label; poll only new tickets | Bojan | open |
| R-12 | **Duplicate tickets** produce repeated noise | M | L | `duplicateOf` flagged on the dashboard and in the comment; no automatic linking yet | Bojan | mitigated |
| R-13 | **Single workstation** is a single point of failure | H | L (POC) | acceptable for the POC; restart-safe watcher; move to a team VM for the MVP | Tech lead | accepted |
| R-14 | **Automatic fixes** (planned) are wrong or unsafe | M | H | fix only on a branch, never merged by the agent; build + tests + reproduction test must pass; draft PR only; human review | Bojan | planned |

## 4. Issues already resolved during the POC

| Issue | Resolution |
|---|---|
| Atlassian login email differed from the expected one (401) | configured the correct account email |
| Windows `cmd.exe` cannot pass a multi-line prompt to `claude -p` | prompt sent through stdin |
| `svn log -r {date}` starts one revision too early | results trimmed by actual commit date |
| "Agenda" matched the Java package `com.mediagenda` in code search | plain words matched as whole words |
| Agent notified a non-person on a meaningless ticket (DEM-1) | notify only real owners at ≥ `medium` confidence |
