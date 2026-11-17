# System 1: fast local decisions in front of Claude

Status: **Proposal** · Date: 2026-11-13 · Owner: Bojan Mijatović · Builds on: [AUTONOMY_AND_NEXT.md](AUTONOMY_AND_NEXT.md), [KNOWLEDGE_PLAN.md](KNOWLEDGE_PLAN.md), [REDACTION.md](REDACTION.md), [PILOT.md](PILOT.md)

Today every decision the agent makes about a ticket goes through Claude: one analysis of about a minute, whatever the ticket is. This document proposes a fast layer in front of it. A small local model answers a fixed set of questions about each ticket in a second or two, with a probability for each answer. Claude stays for everything that has to be reasoned out or written. Nothing is built into the agent yet. The spike (J0) and a first fine-tune ran on 2026-11-13; their results are in section 12.

The idea comes from the presentation *Jev with Laya: two-system decisions* (received 2026-11-13), which was built on another company's tickets, not ours. The facts about Laya were checked against its model card ([convaiinnovations/laya](https://huggingface.co/convaiinnovations/laya)) on 2026-11-13; its accuracy figures are the vendor's. The facts about our app were measured on 2026-11-13 from the code, the event logs and the Insights data.

## 1. The idea

A **Jev-type model** does not write text. It reads a text once and, for each question, picks one of the answers we offer and gives a probability: "which component? Prenotazioni 91 %, Pazienti 6 %, …". Several questions are answered in the same pass. **Laya**, the open model the presentation uses, is a multilingual encoder (mmBERT, 322M parameters, 100+ languages) with a decision head. Its model card says:

- **Licence and size:** Apache 2.0. The multilingual checkpoint is about 650 MB and reads up to 1,024 tokens (about 768 for the ticket text).
- **Install:** `pip install laya`, which needs Python 3.10 or newer. `laya-serve` is a ready HTTP server with the same request shape as the TypeSafe Jev API.
- **Speed:** 0.2–0.5 s per request on a CPU. On this laptop (i7-1355U, J0) it is **about 0.7 s per question**, because each question is one pass over the text: about 2 s for a card of four questions, after 25 s to load the model once.
- **Question types:** *choice* (one of the options, each with a description), *score* (an ordered scale) and *noul* (yes/no).
- **Must be fine-tuned:** zero-shot it is near chance on typed decisions (0.34 against a 0.46 majority baseline). The vendor calls it "a fast base to specialise, not a zero-shot decision engine". Fine-tuned, its typed-decisions checkpoint went from 0.36 to 0.77.
- **Weak with many options:** 77 options scored 0.43, where Jev scored 0.87.

The names come from psychology. *System 1* is fast and intuitive; *System 2* is slow and deliberate. **System 1 answers every ticket at once. When it is unsure, or when something must be reasoned out or written, System 2 (Claude) takes over.** System 1's probability decides which way a ticket goes.

The presentation measured these itself, on about 3,800 support tickets in Italian with 11 categories:

- **Zero-shot:** 19 % accuracy, worse than always guessing the largest category.
- **Fine-tuned:** 97.5 % on a random split, which is probably optimistic.
- **Calibrated:** when it says "90 % sure", it is right about 90 % of the time.
- **Unfamiliar tickets:** 5 of 5 out-of-domain tickets fell below the 70 % confidence floor.

## 2. Why it fits this app (checked 2026-11-13)

| Fact | Source | What System 1 changes |
|---|---|---|
| Every new ticket gets a full analysis: **$0.40 and 59 s** (median). 50 analyses of 32 tickets so far | event logs of all five projects | a ticket that needs no code analysis does not get one |
| The queue is first come, first served, one ticket at a time (`ORDER BY created ASC`, `maxParallel: 1`). A fix may take 15 minutes and a bisect 12 | `agent/watcher.mjs`, `agent/agent.config.json` | urgent and patient-safety tickets go first |
| Nothing is decided before the analysis except the [FE]/[BE] tag. An untagged title always warms an Angular dev server | `agent/lib/pipeline.mjs` (`mayFixByTitle`) | the side is known before the analysis |
| "Already known?" candidates are found by shared words (at least 12 %). LAB-8 described in a reporter's own words scores **8.1 %** in Italian, **2.9 %** in English and **0 %** in Serbian, so it is not even a candidate. Only a sentence that reuses the entry's search terms finds it (23 %) | `alike()` in `agent/lib/prior-art.mjs`, run on the LAB-8 entry | the same problem is recognised in other words and in other languages |
| Ask costs **$0.18 and 19 s** per question. 4 of the 18 questions asked so far are "who knows / who last worked on …", and the data for them is already in Insights (knowledge map, people, commits per component) | `asks.jsonl`, `agent/lib/insights.mjs` | those questions are answered in about two seconds, with no Claude call |
| The masking missed "Ferrara Iolanda" on the first pilot ticket (VAX-13): the first name is not on its list | [PILOT.md](PILOT.md) | a second, local check before any text leaves the machine |
| DEM-31, DEM-32 and DEM-35 were analysed half-written. DEM-1, a meaningless ticket, went through a full analysis only to end at low confidence | AUTONOMY_AND_NEXT (WF1), SPEC §9 | what is missing is seen before the analysis |
| **Five open items of our own plan already ask for "a small model"** to give a verdict or a classification: K8 (intent of a question), K18 (same / related / different), WF1 (intake check), AI3 (a small model for verdicts) and A7 (commit to ticket). AG3 asks for a queue with priorities | KNOWLEDGE_PLAN, AUTONOMY_AND_NEXT, GIT_GRAPH | one local model serves them all, with no cost per call, instead of a Haiku call each |

Why this is more than a cheaper Haiku:

- **Always a valid answer.** The answer is always one of our options, so there is nothing to parse or validate.
- **A usable probability.** Every answer comes with a calibrated probability that a policy threshold can use.
- **Local.** It runs on this machine, so the ticket text never leaves it.
- **It learns.** It learns our tickets from our own outcomes (J8).

## 3. How it fits in

```
Jira ─poll─▶ watcher ─▶ masking ─▶ SYSTEM 1  (local, ~0.7 s per question, no cost per call)
                                     type · side · component · urgency · patient risk · complete? · still names a person?
                                     same as a known issue? (the close candidates)
                                       │
          ┌────────────────────────────┼──────────────────────────┬───────────────────────────────┐
          ▼                            ▼                          ▼                               ▼
  sure, not a code ticket      still names a person      same as known issue KEY          everything else
  light path: route,           held for a person:        KEY's regression test (KB1)      SYSTEM 2: the Claude analysis
  comment, label               nothing is sent           runs at once                     as today, with System 1's
  (no code analysis)                                                                      answers as hints

  outcomes: files changed on main, Jira type and resolution, PR outcome, 👍/👎, the analysis itself
        └─▶ labels ─▶ nightly fine-tune ─▶ swapped in only if not worse on held-out tickets
```

- **Where it runs.** A small server of ours, `agent/system1/server.py` (Python standard library, one checkpoint, the model on the CPU). It answers on loopback only, with the model hub offline, and the watcher starts it like the dev servers. It is not Laya's own `laya-serve`, which listens on every network interface by default and routes between checkpoints by language; the agent needs its own checkpoint for every ticket. The agent calls it with Node's built-in `fetch`, so the agent still has no npm dependencies (NFR-02). Python and the model files live in `tools/` and are fetched by `demo/get-tools.mjs` with checksums, like the JDK and Maven.
- **Never in the way.** The call has a 2 s timeout. When the service is down or slow, every ticket takes today's path. System 1 can only make the agent do **less** or do things **in another order**: skip a code analysis, hold a ticket, move it up the queue, propose candidates, or answer a "who" question from plain-code data. It never writes code. Anything posted to Jira goes through `policy.json`, like every other action.
- **Every answer is an event.** The `system1` event holds the questions, each answer with its top 3 probabilities, the model version and the time. The ticket card shows it, and the accuracy (AI1) compares it with what happened.
- **One switch per decision.** `policy.json` → `system1` sets each decision to `off`, `shadow`, `draft` or `auto`, with its own threshold. In `shadow` it answers and logs, and changes nothing. Every decision starts in `shadow`. The trust ladder (AG2) proposes a higher level when the record allows it.

## 4. What it does in the app

Each item says what it does, why, what people see, how it is measured, its autonomy level (L0–L3, as in AUTONOMY_AND_NEXT) and its effort. Percentages in "people see" are examples of what the screen would show, not measurements.

**J1. Intake card in about two seconds** · L0 → L2 · 1.5 d
When the poll finds a ticket, System 1 answers in one pass:

- **type:** bug in code, change request, new requirement, system support, data recovery, question, unclear;
- **side:** FE, BE, both, not code;
- **component:** one of the project's `insights.components`;
- **urgency:** low, normal or urgent;
- **patient risk:** yes or no;
- **complete?:** four yes/no answers: steps, expected vs actual, screen, environment.

Following the model card, yes/no questions are asked as a *choice* between two options, because its *noul* type can lean to "no" (issue #156). Urgency is a *choice* of three, because *score* is its weakest type.

The ticket card shows the answers with their bars before Claude has started. A minute later the analysis lands next to them, with ✓ where the two agree and ⚠ where they do not. *People see:* about two seconds against 59 s, on every ticket. *Measured:* agreement with the analysis for each question, later with the outcome (AI1).

**J2. No code analysis for tickets that are not about code** · L2 · 0.5 d, after J1 has run in shadow
Above the threshold (0.9 to start), a ticket that is not a "bug in code" or a "change request" takes a light path:

- no Claude analysis, no worktree, no dev server;
- a short internal Jira comment: "recognised as system support (96 %); no code analysis";
- the label `ai-triaged`;
- a notice to the queue the team names for that type.

**Run again** on the card sends the ticket through the full analysis and skips this gate. *Why:* the agent is built for bugs in code. A "check Oracle on site X" ticket today costs a minute and $0.40, and gets a code analysis that looks for a cause that is not in the code. In the presentation's tickets the largest category was 62.5 % of all tickets. If the company's mix is similar, most tickets would take the light path. *Measured:* tickets that took the light path, and how many of them later needed a code change. That count must be 0 in shadow before `auto`.

**J3. The queue by urgency** · L2 · 0.5 d (the priority part of AG3)
The queue is ordered by urgency and patient risk, then by age, instead of by age alone. The Jira priority is not changed (`changePriority: off`). *Why:* with one ticket at a time and a fix of up to 15 minutes, an urgent "the doses due today are missing" waits behind a label colour. *Measured:* time from the report to the analysis for urgency 4–5 against the rest.

**J4. A known issue in other words, and its test at once** · L2 · 1.5 d (K18, for reported tickets and suggestions)
Code collects the candidates as today, plus the knowledge entries of the predicted component. System 1 answers *same*, *related* or *different* for each (up to 40), whether the text is in Italian, English or Serbian. A *same* above the threshold is used three ways:

- it becomes the "Already known?" hint for the analysis;
- it becomes the verdict on a suggested ticket;
- when the entry has a **Test** line (KB1), its regression test runs on `main` right away.

*People see:* LAB-8 reported in other words. Today's code scores it 8 % alike. System 1 says "same as LAB-8". Two minutes later the card says "LAB-8's test fails on main: the known issue is back", before anyone has read the code. *Measured:* the K21 prior-art eval, the four LAB-8 sentences of section 2, and reworded pilot cases.

**J5. Ask answers "who" and "latest" in about two seconds** · L1 · 1 d (the intent part of K8)
System 1 gives the question's intent (who, history, latest, how, where, other), its app and its component. Two kinds are answered by plain code from Insights (knowledge map, people, tickets), with links, in about two seconds and with no Claude call:

- "who knows X" and "who last worked on X";
- "the latest bugs of X".

The answer offers "ask Claude" for more. Other intents still go to Claude, but the collected data is narrowed to the app and the component. *Measured:* the Ask eval (K1) does not drop; time and cost per question, by intent.

**J6. A second privacy check before anything leaves the machine** · L2 · 1.5 d (R-02)
After the masking, System 1 answers one yes/no question about the masked text: *does it still name a person, or still hold a personal identifier?* Above the threshold the ticket is **held**: nothing is sent to a cloud model, and the card says why. A person then releases it, or adds the name to the team list. It is trained on texts made by `demo/lib/synthetic-patients.mjs`: no real person, as many examples as needed, including the uncommon first names that the masking misses on purpose. *Why:* VAX-13, and the DPO's question "what if the rules miss one?". *People see:* the VAX-13 ticket held with "still names a person (94 %)", where the masking alone let it through. *Measured:* on every pilot ticket, next to the masking's own score: misses caught, and false holds.

**J7. Ask the reporter before analysing a half-written ticket** · L1 · 1 d (WF1)
J1's four *complete?* answers decide. A template, not a model, drafts the question for what is missing ("Which screen, and what did you expect to see?") as a draft on the dashboard. The analysis still runs, unless the policy says to wait. *Measured:* low-confidence analyses before and after.

**J8. It learns from what happens** · L0 · 2.5 d (J8a and J8b in the plan)
The labels come from what the system already records, not from a feedback form:

| Question | Labels from |
|---|---|
| type | the Jira issue type, and whether the ticket got a commit on `main` |
| side, component | the files of the ticket's commits on `main`, mapped to `insights.components` as Insights already does |
| same as a known issue | Jira "Duplicate" resolutions, the analysis' `priorArt`, knowledge entries and reworded reports |
| urgency | the Jira priority and the time to fix |
| complete? | the analysis' confidence and the reporter's later answers |
| still names a person | synthetic patients and the redaction audit |
| intent of a question | the Ask eval and 👍/👎 |

**System 2 teaches System 1.** Every Claude analysis is a labelled example (type, side, component, already known), and the 45 replays (AI1b) add more. When a later outcome disagrees with both, the outcome wins.

A nightly fine-tune starts from the base model. It is scored, together with the current model, on the same held-out tickets, and it replaces the current model only if it is not worse. That is the presentation's rule, and it matches how our replay is scored. *People see:*

- a calibration chart: "when it says 90 %, it is right 9 times in 10";
- System 1's agreement with Claude;
- on the Impact tab: analyses not needed, and the money and queue minutes saved.

**J9. Two systems in the presentation** · L0 · 0.5 d
A tour chapter and a slide: the race on one ticket (two seconds against 59 s), the light path, the known issue found in other words, and the held ticket. They are replayed from recorded events, like the other chapters.

### Later

- **A7, commits without a ticket.** *Which of these open tickets does this commit belong to?* The options are up to 40 candidates chosen by time and files. Training data is free: every commit that does name its ticket.
- **AI3, model per task.** Predict a fix's difficulty to choose the model and the budget, and predict *will the automatic fix succeed?* (today 72 % of attempts end in a verified PR). This needs more fix outcomes than we have.
- **WF2, Teams and email.** The intent of an incoming message (status question, new problem, thanks, other) and the ticket it is about.
- **A1, regression guard.** *Does this diff undo the fix described in this entry?* An experiment only: an encoder of this size is weak at reading code, so a small Claude model stays the default.

## 5. Where it does not fit

| Task | Why it stays as it is |
|---|---|
| The analysis, the fix, the AI review, the documentation, the Ask answers | they reason over code and write text; System 1 only chooses |
| The owner | today's score rests on evidence (who resolved, worklogs, commits) and replay finds the owner in 37 of 45. A classifier over names would hide the evidence; in the presentation, owners guessed from history were right 9 % of the time at the top of the list |
| The masking itself | System 1 cannot point at the words to mask. It can only say that a text still has some (J6) |
| Bisect, tests, Insights numbers, accuracy | plain code, with nothing to guess |

## 6. The demo, in six moments

| # | Moment | What the audience sees | Built by |
|---|---|---|---|
| 1 | **Two seconds against 59 s** | a pilot ticket arrives; its card fills with answers and bars at once; a minute later Claude's analysis lands with ✓ on each | J1 |
| 2 | **Not a code ticket** | "Verificare Oracle e application server per il cliente …": system support 98 %, light path, $0, no dev server started | J2 |
| 3 | **Back, in other words** | LAB-8 reported in a nurse's words. Today's code finds it 8 % alike and lists nothing. System 1 says "same as LAB-8"; its test runs and fails: "LAB-8 is back" | J4 + KB1 |
| 4 | **Nothing leaves the machine** | the VAX-13 ticket: the masking missed a name, System 1 holds the ticket, and the cloud model never sees it | J6 |
| 5 | **Who knows it?** | "Who knows the time slot code best?" answered in about two seconds from the knowledge map, with no Claude call | J5 |
| 6 | **It knows when it does not know** | the calibration chart, and an unusual ticket at 41 % that goes to Claude | J8 |

Moment 3 needs LAB-8's bug back on `main`. It can be planted in a scratch copy, as for the bisect proof, or added as a pilot case.

## 7. Data: what we have and what we do not

The four demo apps have 83 tickets (48 bugs, 29 stories, 6 tasks), plus the pilot's. That is enough to build and show the mechanism, but not enough to prove the numbers. The presentation's 3,816 tickets belong to another company and are not used: their categories are not ours.

| Question | Labelled examples today | Enough? | Plan |
|---|---|---|---|
| type | **every demo ticket is about code**: 0 examples of system support, data recovery or a question | no | our own categories (question 1); realistic tickets that are not about code, written by Claude for our five apps (one-time, about $1–2), some of them created in Jira for the demo; real tickets from the pilot project later |
| side | 81 of 83 titles carry [FE] or [BE]; 79 tickets have commits on `main` | yes | the tag and the files of the commits |
| component | 79 tickets with commits, over 24 components: 1 to 9 tickets each | thin | plus reworded reports written by Claude for each ticket and entry (one-time, a few dollars), plus the component descriptions as the options' text |
| urgency | the Jira priority: 41 High or Highest, 35 Medium, 7 Low | yes, as a start | |
| same as a known issue | 48 knowledge entries | thin | 5 reworded reports per entry, in Italian, English and Serbian: about 240 positives, with other entries as negatives |
| still names a person | as many as needed | yes | synthetic patients |
| intent of a question | 18 asked and 24 eval questions | thin | plus reworded questions |
| commit to ticket | every commit that names its ticket, in the five repositories | yes | — |

The pilot gives two new tickets every working day, each with an answer key. It is the test set that was not written to fit the model.

## 8. Plan

| # | Step | Effort | Done when |
|---|---|---|---|
| J0 | **Spike.** Portable Python 3.10+ in `tools/` (`get-tools.mjs`), `pip install laya`, `laya-serve` on loopback; the latency on this laptop (10 cores, 32 GB); zero-shot on the four LAB-8 sentences and on our 83 tickets (a baseline: the model card expects it near chance) | 1 d | we know the latency, whether it reads our Italian, and whether to go on |
| J1 | the intake card in **shadow**: `system1` event, card strip, agreement tile | 1.5 d | every new ticket shows its answers before the analysis |
| J8a | labels from git, Jira and the analyses; reworded reports; the first fine-tune, with held-out tickets and calibration | 1.5 d | accuracy and calibration per question, on held-out tickets |
| J4 | a known issue in other words, and its test | 1.5 d | moment 3 works, and the K21 eval is not worse |
| J5 | the Ask router | 1 d | "who" questions answered in about two seconds; the Ask eval is not worse |
| J6 | the privacy check | 1.5 d | on the pilot, VAX-13's name is caught and the false holds are counted |
| J2, J3 | the light path and the queue order, from shadow to `draft` | 1 d | two weeks of shadow with no code bug among the tickets it would have skipped |
| J7 | ask the reporter (WF1) | 1 d | the drafts appear for half-written tickets |
| J8b | the nightly fine-tune with the held-out check; calibration chart; Impact tile | 1 d | a worse model is never swapped in |
| J9 | tour chapter and slide | 0.5 d | the six moments play from recorded events |

**State on 2026-11-16:**

| Step | State |
|---|---|
| J0 spike | done (2026-11-13) |
| J8a first fine-tune | done: `ft-1` (four intake questions), then `ft-2` (all eight questions). `ft-4` (twelve questions, real privacy texts, Ask components, labels from the analyses) refused; **`ft-5`, the current checkpoint since 2026-11-16**, no question worse than `ft-2` on unseen rows. See section 12 |
| J1 intake card in shadow | done (FR-77); first live test with ten tickets that are not about code |
| J4 known issue in other words + its test | built and verified live (FR-79): LAB-30 → LAB-8 (85 %), its regression test run on main and passed (`knownTest: auto`). LAB-8 recognised in 5 of 6 new reports; LAB-29 missed |
| J5 Ask router | built and live (FR-80), `askRouter: auto`: "who" questions answered in about a second when the component is at 0.7 or more. **2026-11-17 (Ask 2/7, FR-90):** a clear wording in English, Italian or Serbian now decides the intent by a rule before System 1, which reads the rest; the component is the one the question names (System 1's own only for "who", at 0.7), after it named "Report" (78 %) for "What are the latest tickets?". Two more plain-code answers (a component's history, where code is), and a ticket key or a page's address is answered before any model. On the suite: 67 % of 79 questions answered without an AI run |
| J6 privacy check | built (FR-81), in shadow. With `ft-2` it would have held 46 of 185 real tickets that name nobody; with `ft-5`, none of the 60 held out. **Not ready for `auto` yet**: the three real texts with a name are all in the training rows, so catching a name in a real ticket is not measured on unseen ones. **2026-11-17, one unseen case and a miss:** the pilot's VAX-17 kept a patient's name after the masking (2 of 3 identifiers masked), and ft-5 answered "no person" at 97 %. So `auto` stays off: it would promise a protection it does not give yet. The pilot writes exactly the labels this question needs (each report's quoted identifiers and which ones the masking missed) |
| J2 light path, J3 queue order | built (FR-78), in shadow. `draft` **verified live** (DEM-49: held, a person chose the light path, triage comment and `ai-triaged` in 1 s, no analysis); `auto` is ready behind the policy switch. **J3 queue order set to `auto` on 2026-11-17**: it only reorders tickets waiting together at the head of the queue, and a ticket without an answer counts as normal |
| J7 ask the reporter (WF1) | built (FR-82), in shadow: 204 reports labelled by hand, 16 half-written bug reports added, the question from a template (IT/EN). With `ft-5`: what is wrong 96 %, where 92 % on unseen rows; asked in 8 of the 10 cases a person marked, never without need. **Verified live** in shadow (BIL-23, BIL-24) and in `draft` with the hold (LAB-31, BIL-25: held, the question in Drafts in the report's language, **Analyze now** releases it) |
| J8b retrain with a check | built (FR-83): `agent/system1-train.mjs` (data → fine-tune → evaluate both → accept only if not worse), `--nightly`, keep-awake, reload without a restart, labels from Claude's analyses, a stable split; the Impact panel with the calibration. The nightly task is ready (`schedule.ps1 -Register`) but **not registered**: it takes about four hours of CPU a night |
| J9 presentation | built (FR-84): the tour's **System 1 chapter** (8 steps, checked in a browser) and the backup Q&A slide |

The light path stays in shadow until two weeks of the pilot show no ticket about code among those it would skip.

About **11.5 working days**. J0 decides whether the rest goes ahead. If Laya does not read our tickets well even after fine-tuning, the same plan works with another open Jev-type model (the presentation counts about 90), because the service hides which model answers.

In the order of [AUTONOMY_AND_NEXT.md](AUTONOMY_AND_NEXT.md#5-recommended-order), this plan takes the small-model part of K8, K18, WF1, AI3 and A7.

## 9. Guardrails

- **Local only.** The service answers on loopback, and the model and Python are on this machine. No ticket text goes to a cloud service for a System 1 decision. TypeSafe Jev, which runs only in the cloud, is not an option for tickets with patient data.
- **When in doubt, today's path.** Below the threshold, on a timeout, or with the service down, Claude analyses the ticket as now. A real bug skipped by mistake costs more than an analysis that was not needed, so the light path has the highest threshold.
- **No new writes.** System 1 does not post, label, assign or create anything on its own. The watcher does that, under `policy.json`, as now. `no-ai` stops it too.
- **It cannot be talked into anything.** It only chooses among our options. A ticket that says "ignore your instructions" can at worst be classified wrong, and a classification can only make the agent do less.
- **Every answer is kept**, with its probabilities and model version, so any decision can be explained and replayed.

## 10. Risks

| Risk | What we do |
|---|---|
| Too little data in the demo | shadow until the pilot or a real project gives labels; Claude-written examples to start |
| Confidently wrong answers. The presentation's 97.5 % was measured on a random split of template-like tickets | thresholds from our own calibration; held-out tickets chosen by time, as in replay; shadow first |
| Python, PyTorch and a 650 MB model on the team machine | portable, fetched with checksums; the agent works without them |
| Fine-tuning on this laptop is slow. Laya's own fine-tuning notebook runs on two GPUs (Kaggle T4); the presentation fine-tuned on a CPU in 1 h 45 min on 16 cores for 3,400 tickets | our sets are smaller (hundreds); it runs at night; J0 measures it. A free GPU notebook is the fallback, for synthetic and demo data only, never for real tickets |
| Out of the box it is over-confident (model card) | refit the calibration temperature on held-out tickets after every fine-tune (J8a), as the presentation and the model card both do |
| The licence or the support of an open model ends | the service hides the model, so another Jev-type model can replace it |
| The company's ticket types differ from the demo's | the questions and their options are configuration (`system1.questions`), not code |

## 11. Questions

1. **Our ticket types.** *Answered 2026-11-13:* bug in code, change request, new requirement, system support, data recovery or fix, user question, unclear.
2. **Tickets that are not about code, for the demo.** *Answered 2026-11-13: yes.* 107 are written (`demo/system1/written-tickets.json`). About ten will be created in Jira once J1 runs in shadow, so the watcher does not give them a full analysis before System 1 is there to compare.
3. **Which ticket types may skip the code analysis**, and which queue gets each of them?
4. **Is Python acceptable on the team machine** (decision 6 of AUTONOMY_AND_NEXT)?

## 12. Results so far

### J0: the spike (2026-11-13)

Installed with `node demo/get-tools.mjs --only uv,laya`: uv 0.13.5, Python 3.12.15, laya 0.4.18, PyTorch 2.15.0 (CPU), every package as of 2026-10-31, and the multilingual checkpoint at revision `7b928d82`. Only the weights are fetched, with none of the model repository's Python files. The model runs offline (`HF_HUB_OFFLINE=1`). The laya package calls the network only in its integrations and its MCP client, which we do not use.

**Zero-shot, no training,** on the 81 demo tickets still in Jira (DEM-37 and DEM-38 were deleted by a demo reset) and on 12 written tickets that are not about code:

| Question | Right | Always the largest class | Note |
|---|---|---|---|
| type (7 options) | 48 % | 57 % | worse than the largest class |
| side (FE, BE, both) | 50 % | 43 % | |
| component (5–7 per app) | 39 % | 11 % | the only clear signal |
| urgency (3) | 41 % | 48 % | "normal" for 72 of 81 |
| code or not code | 58 of 93 | | 27 code tickets called not code, 8 of the 12 others called code; "Non funziona niente" was a bug at 98 % |
| LAB-8 in other words (13 known issues and "none") | 0 of 4 | | the same wrong entry (LAB-3) came first for three of the four sentences: an option-order bias |

**Speed on this laptop:** 0.7 s per question; 2.0 s for four questions on one ticket. Shorter text, fewer threads and `predict_batch` did not help (texts are 263 characters on average; batching was slower). The model loads in 25 s once.

**Verdict:** as the model card says, it is not usable without fine-tuning. The component score shows that it reads our tickets. So J8a, a first fine-tune, came next.

### J8a: the first fine-tune (2026-11-13)

**Data.** 188 tickets: the 81 demo tickets, labelled from Jira (type, priority), the [FE]/[BE] tag and the components of their commits; and the 107 written tickets. They were split 75/25 by source and type with a fixed seed: 141 tickets (489 labelled questions) for training, 47 (165) held out. Questions and options are worded the same in training and in use.

**Run.** `laya-train` on the CPU: 5 epochs, micro-batch 8 × 2 (140 optimizer updates), options shuffled every epoch, soft cross-entropy, temperature fitted on 48 calibration items. It took **69 minutes**; the training loss fell to 0.02, so it partly learned the training set by heart.

**On the 47 held-out tickets** (24 demo tickets about code, 23 written ones that are not):

| Question | Before | After | Always the largest class |
|---|---|---|---|
| type (7) | 34 % | **66 %** | 26 % |
| side (FE, BE, both, not code) | 47 % | **72 %** | 49 % |
| urgency (3) | 32 % | **60 %** | 40 % |
| component (24 tickets) | 50 % | **67 %** | 17 % |
| code or not code | 55 % | **79 %** | |
| calibration error of the type answer (ECE) | 0.33 | **0.12** | |

**The light path, simulated** (a ticket takes it when the types that need no code change hold at least the threshold):

| Threshold | Before: not-code caught / code wrongly skipped | After |
|---|---|---|
| 0.7 | 9 of 23 / **6** (DEM-4, FAR-11, FAR-13, BIL-16, BIL-17, LAB-19) | 13 of 23 / **2** (DEM-4, LAB-7) |
| 0.8 | 7 of 23 / **4** | 10 of 23 / **0** |
| 0.9 | 5 of 23 / 0 | 5 of 23 / 0 |

Most of the remaining type errors are between the three code types (bug, change request, new requirement), which does not matter for the light path. The fine-tuned model is less sure of itself (mean confidence 0.54), so at 0.9 it sends only 5 of 23 tickets down the light path; at 0.8 it sends 10 with no bug among them. Speed: 1.3 s per ticket for three or four questions; it loads in 8 s.

**What the numbers do not show.** The test set is small. The 23 tickets that are not about code were written by the same author as the training ones, so they are easier than real ones. A real ticket of that kind has not been tested yet. That is what J1 in shadow is for: the light path stays off, and System 1's answers are compared with Claude's analysis and with what happens to each ticket.

**Next for the model (J8b):** a dedicated two-option question "does this ticket need a change in the code?" for the gate, instead of summing the type probabilities. More examples: reworded copies of the real tickets. Fewer epochs, against the learning by heart.

### J1: shadow, the first live test (2026-11-15)

**Built** (FR-77). `agent/system1/server.py` holds `ft-1` on 127.0.0.1:7071. The watcher asks it when a ticket is **queued**, while Node's event loop is free; asked when the ticket was picked, the pipeline's synchronous git steps held the answer back by 20–27 s. Before the analysis starts, the watcher waits for the answer for at most `waitSeconds` (8). Then come the `system1` event, the ⚡ strip on the card, `system1-compared` after the analysis, and the KPI **System 1 agreed**. A ticket whose type *and* side both say "no change in the code" (each ≥ `lightPathThreshold`, 0.5) is marked **would take the light path**; nothing is skipped. A failed call is retried once, because LAB-28 lost its answer to one network failure. 8 unit tests; the agent suite passes (185).

**Ten new tickets that are not about code** were created in Jira as `system1-demo` (DEM-45–47, LAB-26–28, FAR-20–21, BIL-21–22). They are new texts, none of them in the training data, and each got a full analysis.

| | System 1 (local) | The Claude analysis (today) |
|---|---|---|
| time | **answer on the card 7.7 s after the ticket was queued**, before the analysis starts (the model itself takes 1.5–2.3 s) | 24–42 s per ticket, 36 s on average |
| cost | none | **$1.83** for the ten |
| type right | 6 of 9 (LAB-28: no answer, see above) | no type; its summary said "a how-to question, not a bug" (DEM-46) and "an access-provisioning request, not a code bug" (FAR-21) |
| what happened to the ticket | shown only | a code analysis posted to Jira on all ten, code files named on 9; **a developer notified in Teams on 5** (DEM-46, DEM-47, LAB-27, FAR-21, BIL-21) for a how-to question, a data export or an account |
| would take the light path | **6 of 9**: DEM-46, DEM-47, LAB-26, LAB-27, FAR-20, BIL-22 | |

The three it would have left to Claude are the hard ones:

- **DEM-45:** "CUP very slow since 11, the server at 100 % CPU" could be a bug.
- **FAR-21:** an access request, read as a new requirement.
- **BIL-21:** a data export, where the side answer was unsure (0.41).

**Why two answers.** On the 47 held-out tickets the rule "type and side both say not code, each ≥ 0.5" catches **15 of 23** tickets that are not about code and **none of the 24 about code**. The type alone needs 0.8 to skip no bug, and then catches only 10 of 23. Two independent answers that agree are safer than one confident answer.

**Found on the way.** The owner notice went to "IT support / network administrator" for LAB-26: the check for a real person (`pipeline.mjs`) does not recognise a role written as a name. The light path would avoid it for such tickets. *Fixed on 2026-11-16* (`isPersonName`): over every saved analysis, only three handoffs change, all of them roles (LAB-26, FAR-20, FAR-21); every person still gets the message.

**Next: J2.** Switch the light path from shadow to `draft`: the card offers it and a person confirms it. Two conditions come first. The pilot's bugs (two a working day, all about code) must keep showing no "would take the light path". The tickets that took it must not later get a commit on main.

### J8a, second run: `ft-2`, all eight questions (2026-11-15)

**Data.** The intake questions as for `ft-1`, plus:

- *needs code?* (two options);
- the known issue (the project's entries on main, or none);
- the intent of an Ask question;
- privacy.

That gave 1,049 training items, 116 for calibration, and 397 held out. **Run:** 4 epochs, **178 minutes** on the CPU; the loss fell from 0.97 to 0.02.

**`ft-1` and `ft-2` on the same held-out rows:**

| Question | Held out | `ft-1` | `ft-2` | Always the largest class |
|---|---|---|---|---|
| type (7) | 47 | 66 % | 68 % | 26 % |
| side (4) | 47 | 72 % | 70 % (one ticket) | 49 % |
| urgency (3) | 47 | 60 % | 62 % | 40 % |
| component | 24 | 67 % | 67 % | 17 % |
| needs code (2) | 72 | 38 % (not trained on it) | **89 %** | 68 % |
| known issue (up to 15) | 76 | 26 % | **86 %** | 46 % |
| intent of an Ask question (6) | 24 | 67 % | **79 %** | 17 % |
| privacy, synthetic sentences (2) | 60 | 40 % | **100 %** | 52 % |

**The known issue, by source:**

| Source | `ft-1` | `ft-2` |
|---|---|---|
| the four LAB-8 sentences of J0 | 0 of 4 | **4 of 4** (0.92, 0.80, 0.32, 0.81) |
| reworded reports | 9 of 25 | 17 of 25 |
| documented Jira tickets | 3 of 21 | 19 of 21 |
| written tickets ("none of these") | 8 of 26 | 25 of 26 |

**Calibration error** fell for type (0.12 → 0.07), side (0.13 → 0.05) and needs code (0.37 → 0.03).

**The light path** (type, side and code all say "no change in the code", each ≥ 0.5) catches **13 of 23** tickets that are not about code and skips **no ticket about code**. The code question alone at 0.5 would skip two (BIL-2, W-102): as with `ft-1`, one confident answer is not enough.

**Speed.** Side by side on the same 30 rows, `ft-2` is as fast as `ft-1` (median 0.77 s against 0.65 s). The 2.8 s of its first evaluation came from a cold disk right after the training. A full intake, with the known-issue question and its up to 15 options, takes 5–7 s.

**Accepted, after one fix to the rule.** The first verdict refused `ft-2` because its side answer was 2 points worse: 33 of 47 against 34, a single ticket. With 47 tickets one ticket is 2.1 points, so a 1-point tolerance refuses over any single ticket. The rule now allows one held-out item or 1 point, whichever is larger. The strict checks are unchanged:

- no ticket about code on the light path;
- no more privacy misses than the current checkpoint.

**Data fixes found on the way.** 6 privacy sentences of the test were also in the training: a template with no patient field gave the same sentence 24 times. Duplicates are now dropped, and a test row never repeats a training text.

### J2–J6 live with `ft-2` (2026-11-15)

**Three new tickets** (`system1-demo`):

- **LAB-29:** LAB-8 in Italian, in the reporter's own words;
- **LAB-30:** LAB-8 in English;
- **DEM-48:** a booking problem with an uncommon name (Ruairi Szczepanski) that the masking does not know.

Ask questions were asked on the dashboard as well.

| Check | Result |
|---|---|
| J6 privacy, DEM-48 | **caught**: "still names a person", 100 %, where the masking had let the name through. In shadow the ticket went on, and Claude's analysis, posted as the internal Jira comment, begins "A patient (Ruairi Szczepanski) came to the counter…": the case J6 is for |
| J6 privacy, LAB-29 | **false**: 86 %, with no name in the text |
| J4 known issue, LAB-29 | **wrong**: LAB-17 (52 %), LAB-8 at 4 %. Claude's analysis found LAB-8, fixed on main, in 67 s for $0.32 |
| J4 known issue, LAB-30 | no answer on the first run (see *Timing*). **Run again** with the fixes: **"known issue LAB-8, 85 %"**, and LAB-8's regression test queued at once. The analysis said "already known: fixed on main by LAB-8" 2 minutes later. The test then ran on main: **"LAB-8's regression test passes on main: the known issue is not back in that form"** (147 s, 5 minutes after the ticket was queued) |
| J5 "Who knows the exemption code best?" | **Esenzioni (0.89): the team and the newest tickets in 0.9 s, no Claude call, $0** |
| J5 "Who knows the time slot code best?" | Pazienti (0.41): **a wrong fast answer**, at the threshold of 0.4 then in use |

**Measured past the three tickets:**

- **Known issue, six new reports:** 5 right. LAB-30, a short Italian LAB-8, LAB-9 and LAB-23 reworded, and a new problem ("none", 0.85). Only LAB-29 is wrong.
- **The component of 48 "who" questions** (`demo/system1/ask-components.json`, English, Italian, Serbian). The intent is right 48 times; the component 30 times, because `ft-2` learnt components from ticket texts only.

  | Component threshold | Fast answers | With the wrong component |
  |---|---|---|
  | 0.4 | 35 | 8 |
  | 0.6 | 21 | 1 |
  | **0.7 (now)** | **17** | **0** |

  The threshold is now `askComponentThreshold` (0.7) in `policy.json`. The questions are in the training data.
- **Privacy on the 188 real ticket texts**, masked as in use. The masking left a name in 3 of them: FAR-15 "Ferrari Giulia", BIL-17 "Bianchi" and "Ricci", LAB-19 "Romano". At 0.7, `ft-2` catches **1 of the 3** (FAR-15) and holds **46 of the 185 others** for nothing. Its 100 % above was measured on sentences from the same ten templates it was trained on. J6 stays in shadow. The real texts, checked by hand (`demo/system1/privacy-real.json`), are now in the data. A new ticket is never labelled without a person reading it.

**Timing.** The answers came 51–57 s after the ticket was queued, not 8 s as in J1, and LAB-30's call timed out. The model itself took 6.4–6.6 s; the rest was the watcher's event loop. Probed every second for five minutes, `/api/status` took 3–35 s and never answered faster. Since J1, the regression guard (A1) runs `git fetch` for six repositories synchronously every two minutes, 7–12 s each under load. The watcher's other git calls are synchronous too.

Fixed on System 1's side:

- a call that times out is not retried, because the server answers one request at a time and would only work on it twice;
- the timeout is 60 s, since a late answer still serves the card and the comparison;
- a server that comes up after the start timeout is used. It loaded in 42 s during a training run and was declared off while it answered.

Not fixed: the synchronous git calls themselves (A1's `checkMains` and others). They need `execFile` with `await`.

**Next: `ft-3`.** Trained with the Ask components, the real privacy texts and no duplicates, for 3 epochs against the learning by heart. It is accepted only by the same rule.

### J7, J8b and J9 built (2026-11-16)

**J7, ask the reporter.** Four two-option questions on what a report tells:

- what was done, or when it happens;
- what is wrong;
- where (the screen, function or thing);
- where, when or for which record.

Labels: the 81 demo tickets (`demo/system1/completeness.json`) and the 123 written ones, read by hand. 16 of the written ones are new: half-written bug reports such as "Mi dà errore quando prescrivo" or "Non salva".

The labels changed the rule. Most good bug reports of the demo name no environment, and many need no steps ("the Ricevute page shows 22.5"). A question about those alone would be noise. So the reporter is asked only when a report about code, or an unclear one, does not tell **what is wrong** or **where**. The question then asks for everything that is missing.

The question comes from a template, in Italian or English like the report, and asks for a request number, never a patient's name. It starts in shadow. `ft-2` was not trained on these questions, and the watcher asks a checkpoint only the questions in its `questions.json`. So J7 waits for `ft-4`. This also showed that J1 had asked `ft-1` two questions it never learnt.

**J8b, the nightly fine-tune.**

- `system1-train.mjs --nightly` skips the training when the data has not changed.
- Windows does not sleep while it runs. On 15 November the laptop slept through most of the night, and `ft-3` got half an epoch done.
- An accepted checkpoint is loaded by the running watcher, with no restart (`POST /api/system1/reload`).
- `system1/schedule.ps1 -Register` makes it a nightly task, but it is **not registered**: three hours of CPU a night is the owner's call.

Two fixes to the data:

- **System 2 teaches System 1.** Every ticket with a saved Claude analysis and no other labels becomes a training row, labelled by that analysis. Today that adds six (DEM-41, LAB-23, LAB-24, VAX-13, VAX-16, VAX-17), and the pilot adds one with every analysis. VAX-16 is labelled "known issue VAX-11" from its "Already known?".
- **A stable split.** The 75/25 split was by position, so each new row moved others between training and test. A nightly run would then test the current checkpoint partly on rows it was trained on, and favour it. The split is now by a hash of each row.

**J9, the tour chapter.** Eight steps after Ask, checked in a browser (Playwright, captions only):

1. the idea;
2. LAB-26: answered 8 s after it was queued, before the analysis, and marked for the light path;
3. what Claude then spent on LAB-26: 52 s, 20 cents, a Teams notice;
4. LAB-30: "LAB-8, 85 %", its test queued;
5. LAB-30: the analysis agrees and the test passes on main;
6. the privacy slide (DEM-48);
7. "Who knows the exemption code best?" asked live, without Claude;
8. the calibration on the Impact tab.

The two tickets play as recorded runs after a demo reset, or as their live cards. The tour adds about three minutes.

### J8a, third run: `ft-4`, refused (2026-11-16)

`ft-4` was trained on all twelve questions: the eight of `ft-2`, and J7's four. Its data added:

- the real ticket texts for privacy;
- the components of Ask questions;
- the six tickets labelled by their Claude analysis.

Training took 2 h 56 min on the CPU: 1,792 items, 3 epochs, mean loss 0.79 → 0.26 → 0.09.

**Two tests, because the split changed.** The new hash split put 154 of the 243 test rows on the side `ft-2` had been trained on. On the full test `ft-2` therefore looks better than it is: urgency 81 %, side 89 %. The fair comparison is the **clean test**: the 89 test rows whose text `ft-2` never saw (`state/system1/test-clean.jsonl`, `--test`).

| Question | `ft-4` | `ft-2` | |
|---|---|---|---|
| what is wrong (J7) | 95 % | 58 % | `ft-2` was not trained on it |
| where (J7) | 95 % | 37 % | idem |
| privacy | 100 % | 67 % | |
| Ask intent | 100 % | 86 % | |
| type | 71 % | 57 % | |
| known issue | 84 % | 78 % | |
| side | 67 % | 72 % | one item, within the rule |
| **component** | **59 %** | **73 %** | 3 of 22 items worse |
| **urgency** | **48 %** | **57 %** | 2 of 21 items worse |

On the full test, J7 would ask the reporter in 7 of the 10 cases a person marked, and never without need. The privacy question held none of the 55 real texts that name nobody. With `ft-2`, 46 of 185 had been held.

**Why it was refused.**

1. **Component and urgency** are worse by more than one item. In four of the five component errors, `ft-4` answers "Pazienti", and urgency mostly says "normal". The training data had nine "Pazienti" rows instead of four, and three epochs instead of `ft-2`'s four.
2. **Two tickets about code would have taken the light path** (full test):
   - **W-114**, "Something is wrong with the doses, please check.": unclear, not code, no code change, all sure. The rule was wrong, not the model: a text that does not tell what is wrong cannot tell that no code is wrong either. **Fixed:** a report System 1 would ask the reporter about never takes the light path (`lightPath`, and the same in `eval.py`).
   - **W-96**, "Ordinare le risorse per descrizione", a change request to a list: read as a data fix (60 %). There were only 12 written change requests. **Fixed in the data:** 14 more (order, columns, a description next to a code, defaults, filters), and 2 data fixes that use the same words.

`ft-2` stays current. The light path is in shadow, so nothing was skipped in use.

`ft-5` is the same data plus these 16 tickets, trained for four epochs like `ft-2`. It is judged on the full test for the light path and on the clean test against `ft-2`. The clean test is rebuilt from the new test rows: `test-clean2.jsonl`.

The keep-awake helper stopped about an hour into `ft-4`; the laptop stayed awake because it was in use. A helper started with `Start-Process` lasted to the end, so `system1-train.mjs` now starts it that way.

### J8a, fourth run: `ft-5`, accepted (2026-11-16)

`ft-5` is `ft-4`'s data plus the 16 tickets for W-96, trained for four epochs. Training took 4 h 20 min with `laya-train`'s own before/after evaluation: 1,899 items, mean loss 0.75 → 0.27 → 0.10 → 0.02. The two evaluations took another 35 minutes.

- **Full test (253 rows):** the light path catches 14 of 28 tickets that are not about code and skips none about code. W-96 is now a change request (60 %), on the frontend.
- **Clean test (99 rows):** the test rows whose text `ft-2` never saw, rebuilt from the new split (`test-clean2.jsonl`).

| Question | `ft-5` | `ft-2` |
|---|---|---|
| what is wrong (J7) | 96 % | 54 % |
| where (J7) | 92 % | 33 % |
| privacy | 100 % | 65 % |
| Ask intent | 93 % | 86 % |
| Ask component ("who" questions) | 80 % | 70 % |
| needs code | 85 % | 79 % |
| type | 69 % | 62 % |
| side | 61 % | 56 % |
| component | 70 % | 70 % |
| known issue | 81 % | 81 % |
| urgency | 58 % | 58 % |

No question is worse, so `ft-5` became current (`state/system1/models/current.json`) and the watcher serves it.

Also measured on the full test:

- J7 would ask the reporter in 7 of the 10 cases a person marked, and never without need.
- The privacy question held none of the 60 real texts that name nobody.
- LAB-8 in other words: 3 of 4. The Serbian sentence went to LAB-15 at 40 %, below the threshold, so nothing would happen.

**J7 live.** Two new BIL tickets (label `system1-demo`):

- **BIL-23**, "Errore in cassa / Mi dà errore quando stampo la ricevuta.". System 1 saw that the report does not tell what is wrong (82 %), how, or when, but **did not ask**: the type said bug in code (56 %), the code question no code change (64 %), and the rule believed only the code question. **Fixed:** about code when either says so. The same rule scored again on the saved answers (`eval.py --rescore`) asks no one more on the held-out rows. On BIL-23's recorded answers it now asks, in Italian, for the message, what was done, and where and when, "Ci basta il numero, non il nome del paziente".
- **BIL-24**, a complete report with the receipt number, the desk, the time and the amounts: no question. Right.

Claude's own reply draft for BIL-23 asked the reporter for the same things, after a 91-second analysis that ended with low confidence. Asked before the analysis, the reporter could have answered while the ticket waited.

One wrong answer: System 1 named **BIL-9** ("amounts as 22.5 instead of 22,50 €") as BIL-24's known issue, at 95 %. BIL-24 is about an exemption on a second visit; both only speak of receipts and amounts. BIL-9 has no regression test, so nothing ran. The known-issue question needs harder "none of these" examples: reports about the same screen and other faults.

### J7 and J2 in `draft`, live (2026-11-16)

The policy was set to `askReporter: draft`, `askReporterHold: true` and `lightPath: draft` for the test, then back to shadow. Five new tickets with the label `system1-demo`:

| Ticket | Text | System 1 | What happened |
|---|---|---|---|
| LAB-31 | "The results are wrong again, please check." | unclear 44 %; no steps, not what is wrong, no where or when | held (`ai-held`), the question in Drafts **in English**; **Analyze now** removed the label and the analysis ran (58 s, low confidence) |
| FAR-22 | "Quando provo a erogare il farmaco mi dà errore." | bug in code 54 %; tells what was done 82 %, **tells what is wrong 67 %** | no question; analysed (54 s, low confidence), and Claude's draft reply asked the reporter for the details. A miss of the model: BIL-23's "mi dà errore quando stampo" was "not what is wrong" at 82 %. For the next training's data |
| DEM-49 | "Come si annulla una prenotazione già confermata? …" | user question 95 %, not code 94 % | held with **Light path / Analyze anyway**; a person chose the light path: the triage comment in Jira, `ai-triaged`, done in 1 s, no analysis and no owner notice |
| BIL-25 | "C'è un problema alla cassa, controllate per favore." | unclear 78 %; type, side and code all say not code (90–94 %) | **not** offered the light path, because the report does not tell what is wrong (the W-114 rule, live). Held with the question in Italian; **Analyze now** queued the analysis (52 s, low confidence) |

Two defects found and fixed:

- **The same question twice.** **Analyze now** (and **Run again**) asks System 1 again, and it drafted the question to the reporter a second time, and queued the known issue's regression test again (LAB-31, LAB-15's test 20 s after it had passed). A run a person starts no longer drafts the question, and a known issue's test runs once per ticket in a watcher's life. BIL-25 then had one question.
- **An unsure type.** "Verificare per favore." (W-95) got system support at 24 % and was not asked, because only "unclear" counted as unclear. Now no type at 40 % or more counts as unclear too. On `ft-5`'s saved answers this asks 8 of the 10 marked reports instead of 7, none without need, and the light path catches 13 of 28 instead of 14: the one it lost is W-95, which should go to the reporter.

Still missed: W-111 "Da ieri la prenotazione non va" (System 1: tells what is wrong, 88 %) and W-115 "We get error 500" (names the screen, 56 %). Both are data for the next training, with FAR-22.
