// Ask 7/7: how Ask does, for the Impact tab. From every project's asks.jsonl and ask-feedback.jsonl: the questions
// week by week, how many were answered without an AI run (from the records, by plain code, by System 1, or given again),
// how many Claude answered and at what cost, how many were found, and how often people rated the answer right. Plain
// code; the rating is the person's 👍 / 👎 (K12), the last vote on an answer counting.

import { weekOf } from './impact.mjs';

const DAY = 86_400_000;
const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
const rate = (n, of) => (of ? { n, of, rate: n / of } : null);

/**
 * How an answer was made: 'fast' (records, a rule, System 1), 'reused' (an earlier Claude answer given again) or
 * 'claude'. Records from before Ask 3/7 have no `via`: `fast` (System 1, J5) or a ticket status tell them apart.
 */
export function kindOf(r) {
  if (r.cachedFrom) return 'reused';
  if (r.via) return r.via === 'claude' ? 'claude' : 'fast';
  return r.fast || r.intent === 'ticket' ? 'fast' : 'claude';
}

/**
 * @param {{ project: string, name?: string, asks: object[], feedback: object[] }[]} apps
 * @param {{ weeks?: number, now?: Date }} [o]
 */
export function askStats(apps, { weeks = 8, now = new Date() } = {}) {
  const list = Array.from({ length: weeks }, (_, i) => weekOf(new Date(now.getTime() - (weeks - 1 - i) * 7 * DAY).toISOString()));
  const empty = () => ({ asked: 0, fast: 0, reused: 0, claude: 0, found: 0, up: 0, down: 0, costUsd: 0, fastMs: [], claudeMs: [] });
  const byWeek = new Map(list.map((w) => [w, { week: w, ...empty() }]));
  const total = empty();
  const perProject = [];
  const wrong = [];
  for (const app of apps) {
    const votes = new Map();
    for (const f of app.feedback ?? []) if (f.answerAt && (f.vote === 'up' || f.vote === 'down')) votes.set(f.answerAt, f);
    const mine = empty();
    for (const r of app.asks ?? []) {
      if (!r.at) continue;
      const kind = kindOf(r);
      const vote = votes.get(r.at)?.vote ?? null;
      const add = (s) => {
        s.asked++;
        s[kind]++;
        if (r.found) s.found++;
        if (vote) s[vote]++;
        s.costUsd += Number(r.costUsd) || 0;
        if (r.durationMs != null) (kind === 'claude' ? s.claudeMs : kind === 'fast' ? s.fastMs : []).push(r.durationMs);
      };
      add(total);
      add(mine);
      const w = byWeek.get(weekOf(r.at));
      if (w) add(w);
      if (vote === 'down') wrong.push({ project: app.project, at: r.at, question: r.question, note: votes.get(r.at).note || null });
    }
    perProject.push({ project: app.project, name: app.name ?? app.project, ...finish(mine) });
  }
  return {
    weeks: list.map((w) => finish(byWeek.get(w))),
    total: finish(total),
    perProject: perProject.filter((p) => p.asked),
    wrong: wrong.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 5),
  };
}

const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
function finish(s) {
  const { fastMs, claudeMs, ...rest } = s;
  return {
    ...rest,
    costUsd: round(s.costUsd, 2),
    withoutAi: rate(s.fast + s.reused, s.asked), // no Claude run for it
    foundRate: rate(s.found, s.asked),
    upRate: rate(s.up, s.up + s.down), // of the answers people rated
    rated: rate(s.up + s.down, s.asked),
    costPerClaude: s.claude ? round(s.costUsd / s.claude, 2) : null,
    secondsFast: avg(fastMs) == null ? null : round(avg(fastMs) / 1000, 1),
    secondsClaude: avg(claudeMs) == null ? null : Math.round(avg(claudeMs) / 1000),
  };
}
