// KG2 of docs/AUTONOMY_AND_NEXT.md: the researcher closes knowledge gaps. A gap is a question Ask answered "not found"
// or an answer a person marked wrong (gaps.mjs, K12). The researcher takes one, reads further than Ask (ask.mjs with
// `research`), and when it finds a checked answer saves it as a FAQ entry through the documentation PR (ask-actions.mjs
// saveFaq), which a person reviews and mergeDocs merges. Without an answer the gap stays, now known to be a real one.
// Plain code here: which gaps, and what became of each; the watcher runs the jobs.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const file = (stateDir) => join(stateDir, 'research.json');
/** A question's identity: case, accents and punctuation aside. */
export const questionKey = (q) => String(q ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();

/** What was researched: { [questionKey]: { question, at, outcome: 'faq'|'not-found'|'failed', url?, costUsd?, why? } }. */
export function readResearch(stateDir) {
  try {
    return JSON.parse(readFileSync(file(stateDir), 'utf8'));
  } catch {
    return {};
  }
}
export function recordResearch(stateDir, questions, entry) {
  const all = readResearch(stateDir);
  const at = new Date().toISOString(); // one time for the run: the daily budget counts runs by it
  for (const q of [].concat(questions)) all[questionKey(q)] = { question: q, at, ...entry };
  mkdirSync(dirname(file(stateDir)), { recursive: true });
  writeFileSync(file(stateDir), JSON.stringify(all, null, 2));
  return all;
}

/**
 * The gaps to research next, most asked first: of each group (gaps.mjs knowledgeGaps) its newest question, unless one
 * of the group was researched already (an answer or a real gap; a failed run is tried again after `retryHours`), or it
 * was asked less than `settleMinutes` ago (the asker may still rephrase it). { question, why, note, group }[].
 */
/**
 * Whether a question is one to research: one Claude answered (a fast answer that found nothing is about a ticket or a
 * person that is not there, not about missing knowledge), not a follow-up (its words lean on the answer before), and
 * of at least five words besides a ticket key or an address ("DEM-42", "show me last bug ?" are not).
 */
export function researchable(q) {
  if (q.via && q.via !== 'claude') return false;
  if (q.followUp) return false;
  const words = String(q.question ?? '').replace(/https?:\/\/\S+/g, ' ').replace(/\b[A-Z][A-Z0-9_]+-\d+\b/g, ' ').match(/\p{L}{2,}/gu) ?? [];
  return words.length >= 5;
}

export function gapsToResearch(gaps, researched, { now = Date.now(), settleMinutes = 30, retryHours = 24, max = 1 } = {}) {
  const out = [];
  for (const g of gaps ?? []) {
    const done = g.questions.some((q) => {
      const r = researched[questionKey(q.question)];
      return r && (r.outcome !== 'failed' || now - Date.parse(r.at) < retryHours * 3_600_000);
    });
    if (done) continue;
    const newest = [...g.questions].filter(researchable).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
    if (!newest) continue;
    if (now - Date.parse(newest.at) < settleMinutes * 60_000) continue;
    out.push({ question: newest.question, why: newest.why, note: newest.note ?? null, group: g.questions.map((q) => q.question) });
    if (out.length >= max) break;
  }
  return out;
}

/** Research runs made today (local date of `now`): the daily budget. */
export function researchedToday(records, now = new Date()) {
  const day = now.toDateString();
  return new Set(Object.values(records).filter((r) => new Date(r.at).toDateString() === day).map((r) => r.at)).size; // one run records its group at one time
}

/** The research state of a gap group, for the dashboard: the record of any of its questions, or null. */
export function researchOf(group, researched) {
  for (const q of group.questions ?? []) {
    const r = researched[questionKey(q.question)];
    if (r) return r;
  }
  return null;
}
