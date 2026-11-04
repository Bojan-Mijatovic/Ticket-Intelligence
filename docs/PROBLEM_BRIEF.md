# Problem Brief: Ticket Intelligence

| | |
|---|---|
| **Status** | Approved (2026-11-04) |
| **Owner** | Bojan Mijatović |
| **Date** | 2026-11-04 |
| **Related** | [SPEC.md](../SPEC.md) · [Demo scenario](DEMO_SCENARIO.md) · [Dependencies and risks](DEPENDENCIES_AND_RISKS.md) · [Exit criteria](EXIT_CRITERIA.md) |

## 1. Problem

Customers of our healthcare scheduling systems (CUP environments) open tickets and then contact us by email or Teams: *"I opened ticket X, what is the status, can it be sped up?"* Answering well means the engineer must:

1. read the ticket, its comments, history and screenshots;
2. search Jira for earlier tickets on the same environment or with the same symptom;
3. find where in the code (git or SVN) the problem lives, and what changed there recently;
4. work out who knows that environment and component;
5. hand the ticket over, with context, to that person.

Today this is done by hand, by whoever receives the request. It is slow, and it depends on who happens to know the history. It is hardest for the people who most often get these tickets: developers or managers who are new to a project.

**Example from the demo data.** DEM-7 (Struttura field keeps a stale structure after manual clearing) is the same defect as DEM-5 (PULISCI button), already fixed two months earlier. The DEM-5 code review even predicted DEM-7. Without that history, a new engineer starts from zero.

## 2. Who is affected

| Group | Pain today |
|---|---|
| Customers / reporters | wait for a first meaningful answer; get vague status updates |
| Support / first line | can't tell the customer anything concrete without a developer |
| Developers new to a project | don't know the code, the history, or who to ask |
| Team leads / managers | spend time routing tickets and chasing status |
| Experienced developers | get interrupted to re-explain history they already documented in old tickets |

## 3. Desired outcome

For every new ticket, within minutes and without a human starting it:

- a written analysis in Jira: problem, likely cause with evidence (tickets, commits, file:line), proposed fix, next steps;
- the most suitable person identified, with the reason, and notified;
- an escalation decision based on explicit rules;
- drafts for the customer reply and the assignment, for a human to approve.

When a ticket is resolved, the cause and fix are recorded in the project's own documentation, so the next similar ticket is answered faster.

## 4. Scope

**In scope (POC / MVP):**
- Jira Cloud as the ticket system (company Jira; a sandbox project for the POC);
- code analysis on git and SVN projects;
- on-demand use from Claude Code and GitHub Copilot (the tool used at work);
- an autonomous agent that watches a Jira project and posts internal analyses;
- a live dashboard; notifications to Teams (simulated in the POC);
- documentation of resolved tickets in the repository (`docs/knowledge/`).

**Out of scope for now:**
- changing ticket status, priority or assignee automatically;
- sending messages to customers automatically;
- email and Teams *intake* (reading customer messages); planned for a later phase;
- Confluence / SharePoint as documentation sources;
- production deployment as a shared service.

## 5. Success metrics

| Metric | Target | POC result |
|---|---|---|
| Time from ticket creation to analysis posted in Jira | < 5 min | ~80 s (13 s pickup + ~60 s analysis), measured on DEM-8 |
| Related history found (the ticket the description refers to) | found in ≥ 80 % of a sample | found in the demo (DEM-5, DEM-2) |
| Likely cause correct (judged by the resolving developer) | ≥ 60 % of a sample | correct in the demo; to be measured on real tickets |
| Recommended owner accepted | ≥ 70 % of a sample | to be measured |
| Unauthorized writes (anything outside `policy.json`) | 0 | 0 |
| Developer time to orient on an unfamiliar ticket | −50 % | to be measured |

Real-ticket metrics need a sample of 20–30 resolved company tickets (see [risks](DEPENDENCIES_AND_RISKS.md), R-01).

## 6. Constraints

- **Patient data.** Tickets may contain personal and health data. Nothing may be sent to an AI service outside the company's approved tools and agreements.
- **Read-only by default.** Every write (Jira comment, commit, message) is governed by an explicit policy and is logged.
- **Mixed tooling.** Jira Cloud; git and SVN repositories; GitHub Copilot at work; Windows workstations.
- **No new infrastructure for the POC.** Everything runs on one workstation.

## 7. Approval

| Role | Name | Decision | Date |
|---|---|---|---|
| Product owner / sponsor | Bojan Mijatović | ☑ Approved | 2026-11-04 |
| Tech lead | Bojan Mijatović | ☑ Approved | 2026-11-04 |
