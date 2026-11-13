# Redaction of personal data (R-02)

Status: **Implemented (v1), approval pending** · Date: 2026-11-13 · Owner: Bojan Mijatović · Risk: [R-02](DEPENDENCIES_AND_RISKS.md)

Tickets in a healthcare project can name patients. Before any ticket text reaches an AI model, the tool masks personal data in it. This page says what is masked, where, what is not, and how to check it. It is the technical part of R-02; the organisational part (an approved AI service under a data agreement, DPO approval) is still open.

## What is masked

| Kind | Example | Placeholder |
|---|---|---|
| Italian fiscal code | `MRNPLA61S03C351V` | `[FISCAL_CODE_1]` |
| IBAN | `IT60X0542811101000000123456` | `[IBAN_1]` |
| Health card number | 20 digits starting with 80 | `[HEALTH_CARD_1]` |
| E-mail address | `paolo.marino@gmail.com` (not `noreply`, `example.*`) | `[EMAIL_1]` |
| Phone number | `333 1234567`, `0521 703456` (not a code after AIC, lotto, codice, id) | `[PHONE_1]` |
| Birth date | `nato il 03/11/1961`, `data di nascita 14/06/1991` | `[BIRTH_DATE_1]` |
| A person's name | `Costa Andrea`, `Giulia Ferrari`, `Dr.ssa Anna Ferri` | `[PERSON_1]` |

A name is two capitalised words of which one is a common first name (Italian, English, Serbian; about 250), in either order, also with an accent or a possessive (`Greco's`). The **team stays readable**: every git author of the suite's repositories, every Jira user of the ticket (reporter, assignee, comment authors), and `agent.config.json` → `staff` (people who write no code: testers, product owners). The analysis needs to know who knows the code.

The same value always gets the same placeholder within a run, so the model can tell that two mentions are the same patient. The mapping stays in memory; it is never written or sent.

## Where

One module, `.claude/skills/analyze-ticket/scripts/lib/redact.mjs`, used at every point where ticket text leaves for a model:

| Path | Masked |
|---|---|
| Analysis and documentation (`ticket.mjs analyze`, `fetch`) | the ticket and its related tickets (summary, description, comments, worklog comments, links, text field changes), the commit messages and knowledge entries put in the bundle; the bundle says what was masked (`redaction`) |
| Fix, AI review, Ask (`agent/lib/jira-actions.mjs`: `getIssue`, `getIssueFull`) | summary, description, comments |
| AI review of the app (`app-review.mjs`) | the ticket summaries in its facts |
| Knowledge base (lint before a push, `knowledge-lint.mjs`) | not masked but **refused**: the same rules report an identifier or a name outside the team, so personal data does not enter the repository |

Plain-code pages (Insights, the dashboard's lists) show Jira as it is: they run on this machine and send nothing to a model.

## What is not covered (limits)

- **Screenshots.** Images cannot be masked. With `redaction.attachments: "skip"` in `~/.claude/skills/analyze-ticket/config.json` they are not downloaded (the analysis says so). Recommended for company tickets; the demo keeps them.
- **Names the rule cannot see**: one word ("Andrea called"), all capitals ("COSTA ANDREA"), uncommon first names, names inside identifiers. `redaction-audit.mjs` lists the capitalised pairs it left, for a person to check.
- **The repository itself.** The analysis can read the code, the git history and `docs/knowledge` with its own tools. Masking cannot reach what is in the repository: commit messages and documentation must be kept free of personal data. The knowledge lint enforces it for `docs/knowledge`; for commit messages it is a team rule (the demo history had one: LAB-19's fix commit names a test patient).
- **What the model writes back** (Jira comments, documentation) contains placeholders, never the real values, because it never saw them.

## Settings

| Where | Setting |
|---|---|
| `~/.claude/skills/analyze-ticket/config.json` | `redaction.enabled` (default `true`), `redaction.attachments` (`allow` default, `skip`), `redaction.staff` (names) |
| environment | `TICKET_INTEL_REDACTION=off` for a test without masking; `TICKET_INTEL_STAFF` (set by the agent from `staff`) |
| `agent/agent.config.json` | `staff`: the team that writes no code |

## How to check it

```
node agent/redaction-audit.mjs --project LAB          # every masked value per ticket (local output), the pairs left
node agent/knowledge-lint.mjs --project LAB           # no personal data in docs/knowledge
node --test agent/test/redact.test.mjs                # the rules, including no false alarms on codes, amounts, dates
```

## Results on the demo suite (2026-11-13)

- **Audit of 88 tickets:** masked the test patients (Bianchi Laura, Rossi Mario, Fontana Chiara) and the doctor's name of LAB-24. Found and fixed on the way: a tester (Elena Conti) masked because she is not a git author → `staff`; "Davide Greco's" (possessive) and "Mijatović" written with a combining accent taken for unknown people; a drug's AIC code taken for a phone number. After the fixes: no false alarm.
- **Knowledge lint with the name rule:** one real finding, LAB-19's entry named two patients (written before the redaction existed); fixed (MediLab PR #6). All four knowledge bases: no findings.
- **Quality with masking on:** LAB-19 analysed with its patient names masked: right cause, owner (Francesca Lombardi), high confidence, "already documented" found; no name in the result. Ask eval LAB 8/8; BIL 2/3 (the cross-app answer was right and cited DEM-17, but not BIL-4: a variation in the sources chosen, not caused by the masking).

## Decisions still needed

1. **DPO approval** of this design and its limits, and of the AI service (data agreement) for company tickets.
2. **Screenshots** on company tickets: `skip` (recommended) or allowed for projects without patient data.
3. **Commit messages**: a team rule "no patient data in commits" (a commit hook could reuse `redact.mjs`).
