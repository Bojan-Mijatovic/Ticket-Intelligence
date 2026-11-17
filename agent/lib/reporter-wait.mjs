// Tickets that wait for the reporter (System 1, J7 and J2 in 'auto'). Plain code; the watcher posts and polls.
//
// - 'ask' (askReporter: auto): the report did not tell what is wrong or where, so the agent asked in Jira and holds
//   the analysis. A reply in Jira (any comment that is not the agent's) or an edited summary or description starts
//   the analysis with the answer in it; after askReporterWaitHours with neither, the analysis runs on what is there.
// - 'light' (lightPath: auto): the ticket took the light path (no code analysis). For lightPathWatchDays a reply from
//   the reporter starts the full analysis (the triage comment says so), and the ticket counts as a miss of the light
//   path when it turns out to be about code: a fix the agent proposed for it, or a commit on main that names it.
//
// The agent's own comments start with "(robot)" (it may write as the same Jira account as the reporter, as on the
// demo's Jira), so they never count as an answer.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const waitingFile = (stateDir) => join(stateDir, 'waiting.json');

export function readWaiting(stateDir) {
  try {
    return JSON.parse(readFileSync(waitingFile(stateDir), 'utf8'));
  } catch {
    return {};
  }
}
export function writeWaiting(stateDir, all) {
  mkdirSync(dirname(waitingFile(stateDir)), { recursive: true });
  writeFileSync(waitingFile(stateDir), JSON.stringify(all, null, 2));
}

/** A fingerprint of what the reporter wrote: an edit of the summary or the description changes it. */
export const textHash = (issue) => createHash('sha256').update(`${issue?.summary ?? ''}\n${issue?.description ?? ''}`).digest('hex').slice(0, 16);

/** Whether a comment is the agent's own. */
export const agentComment = (body) => /^\s*\(robot\)/.test(String(body ?? ''));

/**
 * The reporter's answer to a waiting ticket, from the ticket as Jira returns it now (getIssueFull): { how: 'comment',
 * at, by } for a comment after `since` that is not the agent's, { how: 'edited' } when the summary or the description
 * changed, else null.
 */
export function answerOf(issue, { since, hash = null }) {
  const after = Date.parse(since);
  const c = (issue?.comments ?? []).find((x) => Date.parse(x.created) > after && !agentComment(x.body));
  if (c) return { how: 'comment', at: c.created, by: c.author ?? null };
  if (hash && textHash(issue) !== hash) return { how: 'edited' };
  return null;
}

/**
 * What to do with one waiting ticket now: 'answered' (analyze it with the answer), 'timeout' (an 'ask' that waited
 * long enough: analyze it as it is), 'expired' (a 'light' watch that is over: forget it), or 'wait'.
 */
export function nextStep(entry, issue, { now = Date.now(), waitHours = 24, watchDays = 14 } = {}) {
  const answer = answerOf(issue, { since: entry.at, hash: entry.hash });
  if (answer) return { step: 'answered', answer };
  const age = now - Date.parse(entry.at);
  if (entry.kind === 'ask' && age >= waitHours * 3_600_000) return { step: 'timeout' };
  if (entry.kind === 'light' && age >= watchDays * 86_400_000) return { step: 'expired' };
  return { step: 'wait' };
}

/**
 * Whether a ticket that took the light path turned out to be about code: the agent proposed a fix for it after the
 * triage (events), or a commit on main names it (`commitsNaming`, the subjects of git log --grep). { why } or null.
 */
export function lightPathMiss({ key, at, events = [], commitsNaming = [] }) {
  const after = Date.parse(at);
  const fix = events.find((e) => e.key === key && e.type === 'fix-proposed' && Date.parse(e.at ?? e.time ?? 0) > after);
  if (fix) return { why: `the agent proposed a fix for ${key} after its light path` };
  const commit = commitsNaming.find((s) => new RegExp(`\\b${key}\\b`).test(s));
  if (commit) return { why: `a commit on main names ${key}: ${commit.slice(0, 120)}` };
  return null;
}

/** The question as posted to Jira: the template (system1.mjs askReporterText) and what happens next. */
export function askComment(question, { waitHours = 24, language = 'en' } = {}) {
  const next = language === 'it'
    ? `_L'analisi parte appena risponde qui (o modifica la descrizione); senza risposta entro ${waitHours} ore parte comunque._`
    : `_The analysis starts as soon as you answer here (or edit the description); without an answer it starts anyway in ${waitHours} hours._`;
  return `(robot) *Ticket Intelligence*\n\n${question}\n\n${next}`;
}
