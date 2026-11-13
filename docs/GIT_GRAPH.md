# Git graph: proposals and plan

Status: **Proposal** · Date: 2026-11-13 · Owner: Bojan Mijatović · Builds on: [AUTONOMY_AND_NEXT.md](AUTONOMY_AND_NEXT.md), [ROADMAP.md](ROADMAP.md), [KNOWLEDGE_PLAN.md](KNOWLEDGE_PLAN.md)

After a short demo of the system, the CTO suggested "a git graph". What exactly was meant was not said. This document lists what it can mean, what we already have for each meaning, and what the AI could do **on its own** on top of such a graph. Nothing here is built yet.

## 1. What "git graph" can mean

| # | Reading | What people see | Who it serves |
|---|---|---|---|
| a | **Branch and commit graph** (like `git log --graph`, the VS Code *Git Graph* extension, GitKraken) | lines of `main` and the branches, commits as dots, merges | developers, team lead |
| b | **What the AI did in the code**, per ticket | for each ticket: branch, failing test, fix, PR, review, merge, documentation, as one lane over time | team lead, management (the demo story) |
| c | **Relationship graph** built from git (KB3 of AUTONOMY_AND_NEXT) | components, files, tickets, commits, people, knowledge entries and apps as nodes; "fixed by", "brought in by", "copy of", "knows" as edges | architects, management, Ask |
| d | **Code dependency graph** (imports, calls) | which modules depend on which | architects, impact analysis |

Our guess: (b) on top of (a), because that is what the demo showed in words and could show as one picture. (c) mostly exists as tables already. (d) needs a parser per language. Section 4 gives most of its value more cheaply, from what changes together in git. **Question 1 of section 7 confirms the reading with the CTO.**

## 2. What git holds today (checked 2026-11-13)

| Fact | Consequence for a graph |
|---|---|
| `main` is linear in all four apps: 22–45 commits, **0 merge commits** (PRs are squash-merged) | a plain `git log --graph` is one straight line |
| Agent branches (`<KEY>`, `docs/<KEY>`) are deleted after the merge or by the demo reset; MediAgenda has 30 PRs (9 merged, 21 closed) and 0 ticket branches left | the branches have to be rebuilt from the PRs (GitHub keeps `refs/pull/<n>/head`) and the agent's events |
| **0 tags**, no release branches | "which release contains the fix" cannot be answered yet (decision 8 of KNOWLEDGE_PLAN) |
| Every agent step is an event (`picked`, `reproduced`, `pr`, `reviewed`, `documented`, …), with the ticket key | the lanes of reading (b) can be drawn without new data |

Already computed by plain code (Insights, [agent/README.md](../agent/README.md#insights-hotspot-map)), shown only as tables:

- **Where bugs come from**: `git blame` of the lines each fix changed → the commit and ticket that brought the bug in (`bugOrigins`).
- **Recurring problems**: a later bug repeating an earlier one (analysis, Jira link, same file).
- **Code shared with other apps**: copies of files, and **fixes missing in a copy** (`sharedCode`).
- **Knowledge map**: people per component, bus factor.
- **Trend**: per month, from git.
- **Prior art**: "fixed by KEY (commit)" for suggestions and reported tickets.

So the graph is mostly a **view and a shared data model** over facts we have. The new value is in what the agent does with it (section 4).

## 3. The graph itself (what people see)

**GG0. One graph model, plain code** · 1 d
**Done 2026-11-13** (FR-68), together with AI1. What was built differs from the description below in two ways: the model is computed on request (the watcher caches it for two minutes), not cached per repository head; and knowledge entries are not part of it yet. Tested with fixtures (`agent/test/git-graph.test.mjs`) and on the four apps, and the SVN history was read from the demo working copy.
`agent/lib/git-graph.mjs` builds one model per project: nodes (commit, ticket, PR, branch, file, component, person, knowledge entry, app) and edges (`fixes`, `brought-in-by`, `touches`, `part-of`, `opened-for`, `reviewed`, `documented-in`, `copy-of`, `changes-with`). Sources: git on `origin/main` and `refs/pull/*`, `gh pr list`, the events, Jira, the knowledge entries. Cached per repository head, like the other Insights caches. Every view below and the agents of section 4 read it; **AI1** (continuous evaluation) needs exactly its `ticket → fix commit → files` edges. No AI.

**G1. Ticket lanes: what the AI did in the code** · 1 d · reading (b) · **Done 2026-11-13** (FR-70, the dashboard's Graph tab). Built vertically, newest row first, as in the VS Code Git Graph, because the agent's steps come in bursts of minutes and a time axis would squash them. A merge commit on main is a row of the main line, but people's parallel branches are not drawn as lanes yet: only the tickets' lanes are. The management mode is WF5.
A dashboard view: `main` as the spine, one lane per ticket. Each lane shows its steps: analysis → branch → reproduction test (red) → fix (green) → draft PR → AI review (risk colour) → merged into `main` as commit X, or closed → documentation PR → merged. Agent and human work are told apart, with filters for open, merged and closed, and the whole suite. A click opens the ticket, the PR and the Jira comment. Inline SVG, no npm dependencies (NFR-02). For a real repository with merge commits, the same view also draws the classic branch graph (reading a).

**G2. Bug lineage** · 0.5 d
A graph of the commit that brought a bug in → the bug → its fix → a later recurrence or regression. It says, for example, "this change brought in 2 bugs; DEM-5 came back as DEM-42". The data exists (`bugOrigins`, recurring problems); this is a view. The author of the origin stays hidden unless `insights.showBugOrigin` is on (people are not ranked).

**G3. Relationship graph of the suite** · 1 d · reading (c), KB3
Components ↔ tickets ↔ files ↔ people ↔ knowledge entries; apps ↔ apps with the bugs linked across them and the copied files. It answers "what is around this component" in one picture, and Ask can cite it.

## 4. What the AI can do on its own with the graph

Each item states what it does, why, how much of it is plain code, the autonomy level (L0–L3 as in AUTONOMY_AND_NEXT) and how it is measured. Code finds the facts; the model only judges or explains them; a person still merges.

**A1. Regression guard on every commit to `main`** · 1 d · L2
When a new commit lands on `main`, code blames the lines it changes or deletes, in its parent. If some of those lines were written by a **bug fix**, the agent says so before anyone reports anything: "this commit changes lines the fix of DEM-5 added". It names the knowledge entry and its "Prevent recurrence" note, and runs that bug's regression test (KB1). An optional small model, without tools, judges from the diff and the entry whether the change undoes the fix. Output: a comment on the PR it came from, and a notice to the component's owner. *Why:* today a regression is found only when a user reports it; K21's regression case (d) is the one prior-art case we could not test. Measured: alerts, alerts a person confirms, regressions caught before a ticket.

**A2. Automatic bisect with the reproduction test** · 1.5 d · L2 · **Done 2026-11-13** (FR-74, [agent/README.md](../agent/README.md#which-change-broke-it-bisect)). Built as described below, with three differences. It walks main's first-parent line with its own binary search instead of `git bisect run`, so it can apply time limits, report each step and be unit-tested. Every run tries the last commit before the suspect window as a good point, even when the analysis names nothing, which costs one extra test run. A test that fails another way than on main also counts as "skip". It was proven on planted breaks in scratch copies: MediLab (JUnit, 23 commits, 6 runs, 157 s) and MediAgenda (Playwright, 11 commits, 5 runs, 226 s) each named the planted commit exactly. No real ticket has gone through it yet.
The Fixer already writes a test that fails on `main`. When the analysis says it "worked before", or names suspect commits, code runs `git bisect run` in the agent's own worktree. It goes from a good point (the ticket's earlier fix, the last commit before the suspect window, or a tag) to `main`, with that test as the judge. The result is the **exact commit that broke it**, with its ticket, in the Jira comment and in the fix and review prompts; the owner suggestion uses the author of that change. It costs no model tokens, only test runs: about 6 steps for 45 commits, with a time limit. A test that cannot run on an old commit counts as "skip". *Why:* the analysis now **guesses** suspects from a 14-day window; bisect **proves** them. Measured: bisect runs, agreement with the blame origin (G2) after the fix, time per run.

**A3. Blast radius from what changes together** · 1 d · L2
Code counts the files and components that change in the same commits, and the bugs whose fix had to touch both. When the Fixer or the AI review handles a change to X, the prompt says: "X changed together with Y in 6 of 8 commits; DEM-5 broke because Y was not updated". It also selects which other tests to run. This gives most of reading (d) without a parser. Measured: review findings that cite it; bugs whose fix touched a file the blast radius named.

**A4. The agent looks after its own branches** · 1 d · L2 on its own branches, L1 on others
When `main` moves under one of the agent's open draft PRs and touches the same files, the agent rebases in its worktree, runs the reproduction test again (it must still fail before the fix and pass after) and all checks, and updates the PR with `--force-with-lease`. It does this **only on branches it created**, as recorded in its state. On a conflict it either runs the fix again on the new `main`, within a budget, or labels the PR `ai-needs-rebase` and tells the owner. It deletes its branches whose PR is merged or closed (LAB-23's branch was left behind, F23). For people's branches it only reports: stale branches, conflicts with `main`. Measured: PRs kept mergeable without a person; branches left behind.

**A5. Port a fix to the copies in other apps** · 1 d · L3
Insights already flags **"check"** when the lines a bug fix added to one copy are missing in another app. The agent takes the original fix as the reference, applies it to the copy, writes the test, and opens a **draft PR in the other app**, citing the original ticket and commit. A person merges. Measured: missing fixes closed; ported PRs merged without changes.

**A6. Releases in the graph** · 1 d · L1 · needs tags or release branches
With release tags or branches, code answers "is DEM-5 released, and in which version?" (`git tag --contains`). That sharpens K20's "fixed on main, not released yet?". The same data feeds the reply to the reporter after merge (ROADMAP #8: "comes with release 2.4") and the release notes (ROADMAP #7): code chooses the tickets between two tags, and the model writes the technical and the business version. Measured: replies sent unedited; release notes accepted.

**A7. Commits without a ticket** · 0.5 d · L1
Every edge of the graph depends on the ticket key in the commit subject. Code finds commits without one and candidate tickets for them, by the same files, the time and the author. A small model proposes the link and a person confirms it. Measured: the share of commits with a ticket, per month.

## 5. Guardrails

- The graph is **read-only and plain code**. The model judges (A1), explains, or writes text (A6); it never decides what the facts are.
- The agent writes **only to its own branches** (A4) and its own draft PRs (A5). It never writes to `main` and never to a person's branch. `mergeFix` stays `off`.
- Bisect and rebase run in the agent's own worktree, with time and run limits (AI3).
- **People are not ranked.** The origin of a bug names the change and its ticket. The author is shown only with `insights.showBugOrigin`, as today.
- **SVN:** the history is linear, so G1 is drawn from commits and events, A2 works with `svn update -r`, and A4 does not apply.

## 6. Plan

These steps are part of the one plan in [AUTONOMY_AND_NEXT.md](AUTONOMY_AND_NEXT.md#5-recommended-order), which gives the order and the status. In short: **GG0** is built with AI1 (step 1 there), **G1** comes right after (step 2), then A2, A1 and A3, which are the autonomy. G2, A4–A7 and G3 come later. About 10.5 working days in all.

## 7. Questions for the CTO

1. **Which picture?** (a) branches and commits, (b) what the AI did per ticket, (c) the relationships, or (d) code dependencies. A sketch of each makes this a one-minute answer. *Open.* G1 is built to show both (a) and (b).
2. **Who looks at it, and how often?** *Answered 2026-11-13: everyone. Developers every day; management weekly or more often.*
3. **The real repositories:** merge commits or squash? Release tags or release branches? GitHub, Bitbucket, Azure DevOps or SVN? *Answered in part, 2026-11-13: **both git and SVN**. Merge or squash, and tags, are still open.*

### What the answers change

- **Two audiences, one model.** G1 gets a developer mode (one ticket or branch, every step, every day) and a management mode (the week: what the agent did, how often it was right, what it cost). The management mode is **WF5 (Impact)**, so WF5 moves up in the plan, right after G1.
- **Developers every day** means the dashboard must be reachable by the team. Today it answers only on the machine it runs on (`dashboardAllowRemote` opens it, without sign-in), so this needs a team machine and sign-in (new decision in AUTONOMY_AND_NEXT section 6). Where developers already are, in the IDE, the analyze-ticket skill can print a ticket's lane as text. That works in Claude Code and in Copilot, on git and on SVN.
- **Git and SVN.** GG0 reads history through the skill's VCS adapters (`lib/vcs/git.mjs`, `lib/vcs/svn.mjs`), which already serve the analysis on both. On SVN there are no pull requests, so a lane is built from commits and events. The automatic fix and the AI review are git-only today (draft PRs), so an SVN lane shows the analysis, the commits and the documentation. A2 bisect uses `svn update -r`, and A4 (branch care) does not apply.
