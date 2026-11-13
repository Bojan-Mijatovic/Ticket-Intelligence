// Knowledge gaps (K12 of docs/KNOWLEDGE_PLAN.md): what people asked and did not get. The questions Ask answered
// "not found" (and not because Jira could not be searched) and the answers someone marked 👎, grouped by the words
// they share; and, per component, the resolved bugs that have no knowledge entry yet. Plain code over local files.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { keywords } from './ask.mjs';

const readLines = (file) => {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter(Boolean);
};

/** The questions of a project and the feedback on them (state/asks.jsonl, state/ask-feedback.jsonl). */
export function readAsks(stateDir) {
  return { asks: readLines(join(stateDir, 'asks.jsonl')), feedback: readLines(join(stateDir, 'ask-feedback.jsonl')) };
}

/**
 * Questions without a good answer, grouped: two questions are in one group when they share a search word.
 * @returns {{ terms: string[], count: number, questions: { question: string, at: string, why: string, note?: string }[] }[]}
 */
export function knowledgeGaps({ asks = [], feedback = [] }) {
  const latestVote = new Map(); // answer time → the last vote on it
  for (const f of feedback) latestVote.set(f.answerAt, f);
  const open = [];
  for (const a of asks) {
    const vote = latestVote.get(a.at);
    if (vote?.vote === 'up') continue; // someone said the answer was right
    const searchFailed = (a.warnings ?? []).some((w) => /Jira/i.test(w));
    if (vote?.vote === 'down') open.push({ question: a.question, at: a.at, why: 'marked as wrong', note: vote.note || undefined });
    else if (a.found === false && !searchFailed) open.push({ question: a.question, at: a.at, why: 'not found' });
  }
  const groups = [];
  for (const q of open) {
    const words = keywords(q.question, 8);
    const g = groups.find((x) => words.some((w) => x.words.has(w)));
    if (g) {
      g.questions.push(q);
      words.forEach((w) => g.words.add(w));
      g.shared = g.shared.filter((w) => words.includes(w)).length ? g.shared.filter((w) => words.includes(w)) : g.shared;
    } else groups.push({ words: new Set(words), shared: words.slice(0, 3), questions: [q] });
  }
  return groups
    .map((g) => ({ terms: g.questions.length > 1 ? g.shared.slice(0, 3) : [...g.words].slice(0, 3), count: g.questions.length, questions: g.questions }))
    .sort((a, b) => b.count - a.count || String(b.questions.at(-1).at).localeCompare(String(a.questions.at(-1).at)));
}

/**
 * Per component: its resolved bugs and which of them have a knowledge entry on main.
 * @param {object[]} components  Insights components (name, bugKeys)
 * @param {object[]} tickets     Insights tickets (key, type, status)
 * @param {string[]} documented  keys with an entry on main
 */
export function coverageByComponent(components, tickets, documented) {
  const done = new Set(tickets.filter((t) => /bug/i.test(t.type ?? '') && /done|closed|resolved/i.test(t.status ?? '')).map((t) => t.key));
  const doc = new Set(documented);
  return components
    .map((c) => {
      const resolved = (c.bugKeys ?? []).filter((k) => done.has(k));
      return { component: c.name, resolved: resolved.length, documented: resolved.filter((k) => doc.has(k)).length, missing: resolved.filter((k) => !doc.has(k)) };
    })
    .filter((c) => c.resolved > 0);
}
