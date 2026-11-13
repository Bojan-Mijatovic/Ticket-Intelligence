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
`agent/lib/git-graph.mjs` builds one model per project: nodes (commit, ticket, PR, branch, file, component, person, knowledge entry, app) and edges (`fixes`, `brought-in-by`, `touches`, `part-of`, `opened-for`, `reviewed`, `documented-in`, `copy-of`, `changes-with`). Sources: git on `origin/main` and `refs/pull/*`, `gh pr list`, the events, Jira, the knowledge entries. Cached per repository head, like the other Insights caches. Every view below and the agents of section 4 read it; **AI1** (continuous evaluation) needs exactly its `ticket → fix commit → files` edges. No AI.

**G1. Ticket lanes: what the AI did in the code** · 1 d · reading (b)
A dashboard view: `main` as the spine, one lane per ticket. Each lane shows its steps: analysis → branch → reproduction test (red) → fix (green) → draft PR → AI review (risk colour) → merged into `main` as commit X, or closed → documentation PR → merged. Agent and human work are told apart, with filters for open, merged and closed, and the whole suite. A click opens the ticket, the PR and the Jira comment. Inline SVG, no npm dependencies (NFR-02). For a real repository with merge commits, the same view also draws the classic branch graph (reading a).

**G2. Bug lineage** · 0.5 d
A graph of the commit that brought a bug in → the bug → its fix → a later recurrence or regression. It says, for example, "this change brought in 2 bugs; DEM-5 came back as DEM-42". The data exists (`bugOrigins`, recurring problems); this is a view. The author of the origin stays hidden unless `insights.showBugOrigin` is on (people are not ranked).

**G3. Relationship graph of the suite** · 1 d · reading (c), KB3
Components ↔ tickets ↔ files ↔ people ↔ knowledge entries; apps ↔ apps with the bugs linked across them and the copied files. It answers "what is around this component" in one picture, and Ask can cite it.

## 4. What the AI can do on its own with the graph

Each item states what it does, why, how much of it is plain code, the autonomy level (L0–L3 as in AUTONOMY_AND_NEXT) and how it is measured. Code finds the facts; the model only judges or explains them; a person still merges.

**A1. Regression guard on every commit to `main`** · 1 d · L2
When a new commit lands on `main`, code blames the lines it changes or deletes, in its parent. If some of those lines were written by a **bug fix**, the agent says so before anyone reports anything: "this commit changes lines the fix of DEM-5 added". It names the knowledge entry and its "Prevent recurrence" note, and runs that bug's regression test (KB1). An optional small model, without tools, judges from the diff and the entry whether the change undoes the fix. Output: a comment on the PR it came from, and a notice to the component's owner. *Why:* today a regression is found only when a user reports it; K21's regression case (d) is the one prior-art case we could not test. Measured: alerts, alerts a person confirms, regressions caught before a ticket.

**A2. Automatic bisect with the reproduction test** · 1.5 d · L2
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

| # | Step | Why in this place | Effort |
|---|---|---|---|
| 1 | **GG0** graph model | everything below reads it; **AI1 needs the same edges**, so it is built together with AI1 | 1 d |
| 2 | **G1** ticket lanes | the picture to show the CTO; no new data | 1 d |
| 3 | **A2** automatic bisect | the strongest "on its own" step: proof instead of a guess; no model cost | 1.5 d |
| 4 | **A1** regression guard | catches a regression before a ticket; uses KB1's tests | 1 d |
| 5 | **A3** blast radius | better fixes and reviews; cheap | 1 d |
| 6 | **G2** bug lineage | the data exists | 0.5 d |
| 7 | **A4** branch care | needs real parallel work to pay off | 1 d |
| 8 | **A5** port fixes to copies | suite-level; draft PRs in another app | 1 d |
| 9 | **A6** releases, **A7** orphan commits, **G3** relationship graph | A6 waits for release tags; G3 = KB3 | 2.5 d |

About **10.5 working days**. Steps 1–2 (2 d) give something to show. Steps 3–5 (3.5 d) are the autonomy.

Fit with [AUTONOMY_AND_NEXT.md](AUTONOMY_AND_NEXT.md): step 1 goes **with AI1**, the first item there, at about +0.5 d over AI1 alone. G1 then comes before KB1, and A1 runs KB1's tests once they exist.

## 7. Questions for the CTO

1. **Which picture?** (a) branches and commits, (b) what the AI did per ticket, (c) the relationships, or (d) code dependencies. A sketch of each makes this a one-minute answer.
2. **Who looks at it, and how often?** Developers every day (then a view in the IDE matters), or the team lead and management weekly (then the dashboard).
3. **The real repositories:** merge commits or squash? Release tags or release branches? GitHub, Bitbucket, Azure DevOps or SVN? This decides A4, A6 and how much of G1 comes from git and how much from PRs.
