# Roadmap: after the POC

Status: **Planned** · Date: 2026-11-04 · Owner: Bojan Mijatović

The POC is complete: a new ticket is analyzed, reproduced with a browser test, fixed and opened as a draft PR with no human action, and a ticket moved to Done is documented (see [DEMO_SCENARIO.md](DEMO_SCENARIO.md)). This roadmap adds eight features. Each feature lets the agent do more on its own, or shows team leads and management what it does and what it is worth.

Two rules from the POC still apply:

- **A human decides.** `mergeFix` stays `off`. New write actions get a `policy.json` key and start as `draft`.
- **Nothing leaves the building with patient data.** Features that send text outward (#6, #7, #8) wait for R-02 (redaction) before they are used on company tickets.

## Summary

| # | Feature | Audience | What they see | Effort | Phase |
|---|---|---|---|---|---|
| 1 | Approval from Teams | Team lead | Card with before/after, test result, risk; **Approve** / **Reject** | 1 d | A |
| 2 | Mission Control dashboard | Team lead, management | Live phase timeline + Impact tab (time, hours saved, cost) + "Run on ticket" | 1 d | A |
| 3 | Night shift + morning digest | Management | 08:00 Teams digest: what the agent did overnight | 1 d | C |
| 4 | AI reviewer | Team lead, developers | Second agent reviews the PR, posts comments, sets a risk level | 0.5 d | B |
| 5 | Hotspot map | Management, architects | Which components produce the most bugs, and the trend | 1 d | D |
| 6 | Ask the knowledge base | PM, support, developers | Question in plain language → answer with ticket/PR links | 0.5–1 d | D |
| 7 | Release notes and sprint report | PM, customer, management | Two versions: technical and business | 0.5 d | C |
| 8 | Reply to the customer after merge | Support, customer | "Fixed in …" reply drafted (or posted) when the PR is merged | 0.5 d | B |

Total: about 6–7 working days. These are estimates for one developer working with Claude Code.

### Order and dependencies

```
Phase A  #2 Mission Control ─┬─> #1 Approval (card is shown on the dashboard too)
Phase B  #4 AI reviewer ─────┘   (risk level appears on the approval card)
         #1 Approve → human merges in GitHub → #8 Reply on merge
Phase C  #3 Night shift (uses #2 metrics in the digest) · #7 Reports
Phase D  #5 Hotspots · #6 Ask  (both get better with more processed tickets, which #3 produces)
```

Phase A gives the biggest demo effect for the least work. Phase B closes the loop from report to customer reply. Phases C and D need more data to look convincing, so they come last.

---

## 1. Approval from Teams

**Goal.** The owner approves or rejects the AI fix with one click, without opening GitHub or Jira. This answers "who controls the AI?".

**Flow.**
1. After `fix-proposed`, the agent posts a richer Adaptive Card: ticket, cause, changed files, test result (failed before / passed after), before/after screenshots, risk from #4, links to PR and Jira.
2. **Approve** → `gh pr ready <n>` (draft → ready for review), request review from the owner, Jira comment "Approved by <name>", optional transition to the review status.
3. **Reject** → a text field for the reason → the agent re-runs the fix phase with the reason as reviewer feedback (at most `maxFixAttempts`, default 2). After the last attempt it stops and labels `ai-fix-rejected`.
4. Approval does **not** merge. A human merges in GitHub (`mergeFix: off`).

**Design.**
- The Teams Workflows webhook is one-way, so Teams cannot call the agent back directly. Two options:
  - **POC/demo:** card buttons are `Action.OpenUrl` links to `http://localhost:7070/approve/<KEY>?t=<token>` and `/reject/...`. They work on the demo machine, where the browser and the agent run together. The same card, with working buttons, is shown on the dashboard.
  - **Production:** a Power Automate flow "Post adaptive card and wait for a response" writes the answer to a SharePoint list or Dataverse table that the agent polls, or a Teams bot (Bot Framework) with `Action.Execute`. Both need the service account (open question 2).
- New: `agent/lib/approval.mjs` (tokens, approve/reject handlers), routes in `watcher.mjs`, card builder in `notify.mjs`.
- Token: random, single use, bound to ticket key + PR number, stored in `state/approvals.json`, expires after `approvalTtlHours` (default 72).
- Policy: `approveFix: "draft"` (buttons shown), `transitionOnApprove: "off"`, `maxFixAttempts: 2`.
- Events: `approval-requested`, `approved`, `rejected`, `fix-retry`.
- Jira labels: `ai-fix-approved`, `ai-fix-rejected`.

**Demo moment.** The card arrives in Teams next to the dashboard. The presenter clicks Approve, the PR on GitHub turns from Draft to Open within seconds, and Jira gets the comment.

**Acceptance.** Approve changes the PR to ready and comments in Jira. Reject with a reason produces a second attempt whose prompt contains that reason. A used or expired token returns 410 and does nothing.

**Risks.** A localhost link does not work for anyone outside the demo machine. Say so in the demo and name the production option.

## 2. Mission Control dashboard

**Goal.** One screen for a wall display: what the agent is doing now (team lead) and what it has delivered (management). It also works as a control panel, which is what a "custom Swagger" would have tried to do.

**Live tab.**
- Per-ticket phase timeline built from existing events: picked → analyzed → reproduced (test fails) → fixed → verified → PR → approved → merged → documented. Each phase shows its duration and a status color.
- The before/after screenshots appear inline as they are produced (they are already served from `/evidence/<KEY>/`).
- A "current step" line streams from the `progress` events.

**Impact tab.**
- Tickets processed, analysis time, time to PR, fix success rate (verified PR / attempted), approval rate (#1), duplicates found, documentation PRs.
- **Hours saved** = Σ (baseline − measured) per phase, using `baseline` from `agent.config.json` (e.g. `analysisMinutes: 45`, `reproduceMinutes: 60`, `fixMinutes: 180`, `docsMinutes: 30`). The page states that baselines are team estimates, not measurements.
- **Cost:** sum of `total_cost_usd` from the headless runs (analysis already records it in `meta.costUsd`; add the same for fix, docs, reviewer). Cost per ticket and cost per hour saved.
- Trend by day/week.

**Control.**
- "Run on ticket" field: key → `POST /api/run {key}` → queued like a polled ticket (normal policy applies, `no-ai` still respected).
- "Pause agent" / "Resume" toggle (`POST /api/pause`).

**Design.**
- `agent/lib/metrics.mjs` computes metrics from `events.jsonl` + `state/work/*/result.json`; `GET /api/metrics`.
- Dashboard stays a single file with no npm dependencies (NFR-02); tabs are client-side.
- Events gain `costUsd` and `durationMs` where available.

**Demo moment.** The audience watches the timeline advance while the ticket is processed, then switches to Impact: "10 tickets, 47 hours saved, $3.80".

**Acceptance.** Metrics match a manual count from `events.jsonl` for the demo run. Run on ticket queues and processes a ticket. Pause stops new pickups and lets the current ticket finish.

## 3. Night shift and morning digest

**Goal.** "The team arrives in the morning and the first pass of the work is done."

**Flow.**
- In the configured window, the watcher also takes **backlog** tickets: open, older than `lookbackHours`, without agent labels, oldest or highest priority first.
- Limits: `maxTickets`, `maxCostUsd`, and the existing per-run timeouts. When a limit is reached the night shift stops and says why in the digest.
- At `digestAt` the agent writes the digest and posts it to Teams:
  > Overnight: 9 tickets analyzed, 4 bugs reproduced, 2 draft PRs ready for review, 1 duplicate of DEM-5, 2 tickets need a human (unclear requirements). Cost $2.10.
- Each line links to the ticket or PR. "Needs a human" lists low-confidence tickets and their reasons.

**Design.**
- `agent.config.json` → `nightShift: { enabled, from: "20:00", to: "07:00", jql, maxTickets: 15, maxCostUsd: 10, digestAt: "08:00" }`.
- A scheduler inside the watcher checks the clock every minute, so no cron is needed while the watcher runs. Production: watcher on a team VM (open question 4), or a Windows Task Scheduler entry that starts it.
- `agent/lib/digest.mjs` builds the digest from events of the last window. Output: `state/digests/<date>.md`, a Teams card, and a dashboard panel.
- `demo/night-shift.mjs --now` runs the night shift and the digest immediately on seeded backlog tickets (for rehearsal and demo preparation).

**Demo moment.** The night shift is run before the demo, and only the result is shown: the 08:00 Teams card and the PRs it lists. It closes the demo: "and this also runs while you sleep".

**Acceptance.** It respects the window and both limits. The digest counts match the events. With nothing processed, the digest says so in one line.

**Risks.** Running the night shift on 10–15 tickets takes 30–90 minutes. It has to be prepared, not run live. Cost limits must be set before the first real night.

## 4. AI reviewer

**Goal.** A second agent checks the first agent's PR. This shows that the AI's work is reviewed before a human sees it.

**Flow.**
1. After the draft PR is opened (so the PR itself is not delayed), a headless read-only run receives: ticket, analysis, diff, the reproduction test, check results.
2. It returns JSON: `risk` (`low|medium|high`), `verdict` (`looks-good|needs-changes`), `findings[{file, line, severity, comment}]`, `testsCoverTheBug` (yes/no + why).
3. The agent posts findings as a PR review (`gh api repos/{o}/{r}/pulls/{n}/reviews`, event `COMMENT`; an account cannot approve its own PR) and a summary line in the PR body.
4. The risk level goes on the approval card (#1) and the dashboard. `high` or `needs-changes` → the card says "Review findings first" and the agent does not request a human review automatically.

**Design.**
- `agent/lib/review.mjs`; same `claude -p` runner as the analysis with editing tools disabled; a separate prompt with explicit review criteria (correctness, scope creep, test validity, regressions in shared components).
- Policy: `reviewFix: "auto"`. Optional `fixOnReview: "off"`: one more fix attempt when the verdict is `needs-changes`.
- Events: `reviewing`, `reviewed`.

**Demo moment.** PR comments from "the reviewer" appear a minute after the PR opens. The risk badge is green on the Teams card.

**Acceptance.** The review is posted on every agent PR. Invalid JSON skips the review with an event and never blocks the PR. On a planted bad fix (e.g. a change outside the component) it reports at least one finding.

## 5. Hotspot map

**Goal.** Show management where bugs come from, and therefore where a refactor pays off.

**Content.**
- Component × month heatmap of tickets (from analysis results `component`, and `docs/knowledge/` entries for resolved ones).
- Per component: ticket count, recurring problems (`duplicateOf` and "repeat of" notes in knowledge entries), git churn (commits and changed lines in `suspectWindowDays`), main authors.
- Top 3 hotspots with a short AI-written recommendation (e.g. "the Struttura autocomplete broke 3 times in 2 months after store changes; add a contract test between store and component"). It is regenerated weekly or on demand.

**Design.**
- `agent/lib/insights.mjs`: aggregation is plain code with no AI. Only the recommendation text uses one headless run.
- `GET /api/insights`, "Insights" tab on the dashboard (heatmap as inline SVG or a CSS grid).
- Data volume: the demo has about 10 tickets. To make the map meaningful, `demo/seed-jira.mjs --history` seeds 30–40 resolved historical tickets that match the existing MediAgenda git history.

**Demo moment.** "This is the component that cost us the most this quarter, and why."

**Acceptance.** Counts match a JQL query and `git log` for the same period. Every recommendation cites tickets or commits.

**Risks.** With little data the map is not convincing, so it needs seeded history. It must not be read as a ranking of people. It shows components only, with authors as context, not scores.

## 6. Ask the knowledge base

**Goal.** Anyone can ask "why did the agenda search break last month?" and get a sourced answer in seconds.

**Flow.**
- Dashboard field (later Teams) → `POST /api/ask {question}` → headless read-only run over `docs/knowledge/`, agent results in `state/work/*/result.json`, and Jira (via `ticket.mjs fetch|recent`) → the answer streams to the page.
- Every claim cites a ticket key, PR or file. When nothing is found, it says "not in the knowledge base" and suggests the closest tickets. It does not guess.

**Design.**
- `agent/lib/ask.mjs`; allowed tools: Read, Grep, Glob, and Bash limited to `ticket.mjs` read commands.
- Limits: one question at a time, `askTimeoutSeconds: 60`, answer length limit.
- Knowledge text and ticket text are data, not instructions (same rule as the skills).

**Demo moment.** Right after the Done → docs step: "Has this happened before?" → "Yes, DEM-5, same root cause in the store; fixed in PR #… ; see docs/knowledge/agenda.md".

**Acceptance.** It answers correctly about DEM-5/DEM-10 with links. On an unknown topic it says not found. Answers take under 60 s.

## 7. Release notes and sprint report

**Goal.** At the end of a sprint, the agent writes what was delivered in two versions: technical for the team and business for the customer and management.

**Content.**
- Technical: per ticket, the cause, fix, PR, tests added, and knowledge entry, plus metrics from #2.
- Business: what users notice is fixed, in plain language, grouped by screen. It contains no internal names, no code, and no patient data.

**Design.**
- `agent/report.mjs --since 14d | --sprint <id>`. The demo project has no sprints, so a date range is the default, with a sprint field when the company project uses one.
- Input: Done tickets (JQL), their PRs (`gh pr list --search <KEY>`), knowledge entries. One headless run writes both versions.
- Output: `docs/reports/<date>-release-notes.md` on a branch with a draft PR (like #40), optional Teams post. Policy: `publishReport: "draft"`.
- Dashboard button "Generate report".

**Demo moment.** One click → the business version on screen: "this is what goes to the customer".

**Acceptance.** Every Done ticket in the range appears once. The business version contains no file paths, people's names, or ticket text quoted verbatim.

## 8. Reply to the customer after merge

**Goal.** Close the loop: the customer hears that the issue is fixed as soon as the fix is merged.

**Flow.**
- The watcher polls GitHub for merged PRs whose branch is a ticket key (`gh pr list --state merged --search "head:DEM-"`) or that the agent opened.
- For each new merge: draft a reply to the reporter (what was wrong, in plain words, what changed, when it will be available), using the analysis `reporterReply` as a starting point.
- `replyOnMerge: "draft"` → shown on the dashboard and in Teams for one-click send (same token mechanism as #1). `"auto"` → posted directly. `auto` is for the demo only.
- After sending: label `ai-replied`, and optionally a transition to "Waiting for customer" when the workflow has it (`transitionOnReply: "off"`).

**Design.**
- `agent/lib/merge-watch.mjs`, run in the existing poll loop.
- Release info: Jira `fixVersions` when set. Otherwise "will be included in the next release".
- Jira Service Management: the reply must be a **public** comment and the analysis comment must stay internal (open question 5). Jira Software projects have only one comment visibility, which is fine for the demo.

**Demo moment.** The presenter clicks Merge in GitHub. Within 30 s the customer reply appears on the ticket.

**Acceptance.** One reply per merged PR, never two. It does nothing for PRs not linked to a ticket. A draft is not posted until someone sends it.

---

## Cross-cutting work

| Item | What |
|---|---|
| `policy.json` | new keys: `approveFix`, `transitionOnApprove`, `reviewFix`, `fixOnReview`, `replyOnMerge`, `transitionOnReply`, `publishReport`; all new write actions start as `draft` or `off` |
| `agent.config.json` | `baseline`, `nightShift`, `maxFixAttempts`, `approvalTtlHours`, `askTimeoutSeconds` |
| Events (SPEC 5.3) | `approval-requested`, `approved`, `rejected`, `fix-retry`, `reviewing`, `reviewed`, `merged`, `reply-drafted`, `replied`, `digest`, `report` |
| Labels | `ai-fix-approved`, `ai-fix-rejected`, `ai-replied` |
| `demo/reset-demo.mjs` | also remove approvals, digests, reports, review comments and the new labels |
| `demo/preflight.mjs` | checks: `gh` can mark ready and post reviews; Teams card renders; night-shift limits set; seeded history present |
| `DEMO_SCENARIO.md` | extended storyline (below) |
| Security | approval/reply tokens single use and local only; the dashboard binds to localhost; R-02 redaction before #6/#7/#8 on company data |

## Extended demo storyline (about 12 minutes)

1. New ticket → **Live tab** timeline (#2): analysis, Teams message, reproduction with "before" screenshot.
2. Draft PR → **AI reviewer** comments, risk low (#4).
3. **Teams card** → Approve (#1) → PR ready for review.
4. Presenter merges in GitHub → **customer reply** appears on the ticket (#8).
5. Ticket to Done → documentation PR (existing).
6. **Ask:** "Has this happened before?" → DEM-5 with links (#6).
7. **Impact tab** and **hotspot map** (#2, #5): "what this is worth and where to invest".
8. **Morning digest** from the prepared night shift (#3) and the **business release notes** (#7): "and this is what it does while you sleep".

Steps 1–5 run live. Steps 6–8 use data prepared before the demo. A screen recording of the full run remains the fallback.
