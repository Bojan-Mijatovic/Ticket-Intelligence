// Scoring of the knowledge and prior-art evals (K1, K21 of docs/KNOWLEDGE_PLAN.md). Plain functions, no I/O.

/**
 * One Ask answer against its answer key (demo/ask-scenarios.json).
 * @param {object} q        { found, expect?: keys, min?, files?: paths, names?: people }
 * @param {object} answer   askQuestion() result
 * @param {object} [o]
 * @param {Map<string, string[]>} [o.commits]  short hash → ticket keys of the commit subject: a cited commit counts
 *   for its tickets
 * @param {(key: string) => string} [o.map]    fixture key → live key
 * @returns {{ pass: boolean, checks: [string, boolean, string][], hits: string[], dropped: number }}
 */
export function scoreAnswer(q, answer, { commits = new Map(), map = (k) => k } = {}) {
  const cited = new Set();
  const files = [];
  for (const s of answer.sources ?? []) {
    if (s.type === 'ticket') cited.add(String(s.ref).toUpperCase());
    // A commit of a linked app is cited as "DEM:2af6918" (K11): its keys come from that app's history.
    if (s.type === 'commit') for (const k of commits.get(String(s.ref).replace(/^[A-Z][A-Z0-9_]+:/, '').slice(0, 7)) ?? []) cited.add(k);
    if (s.type === 'file' || s.type === 'knowledge') files.push(String(s.ref).replace(/\\/g, '/'));
  }
  const expect = (q.expect ?? []).map(map);
  const hits = expect.filter((k) => cited.has(k));
  const min = q.min ?? expect.length;
  const checks = [['found', answer.found === q.found, `expected ${q.found}, got ${answer.found}`]];
  if (q.found) {
    if (expect.length && min > 0) checks.push(['sources', hits.length >= min, `${hits.length}/${expect.length} cited (need ${min}): ${hits.join(', ') || '–'}; missing ${expect.filter((k) => !cited.has(k)).join(', ') || '–'}`]);
    for (const f of q.files ?? []) checks.push([`file ${f.split('/').pop()}`, files.some((x) => x.endsWith(f)), files.slice(0, 4).join(', ') || 'no file cited']);
    if (q.names?.length) checks.push(['names', q.names.some((n) => String(answer.answer ?? '').includes(n)), `one of ${q.names.join(', ')}`]);
  }
  return { pass: checks.every(([, ok]) => ok), checks, hits, dropped: answer.dropped ?? 0 };
}

/** Totals of scored rows ({ score, answer }). */
export function summarize(rows) {
  const n = rows.length || 1;
  const sum = (f) => rows.reduce((s, r) => s + f(r), 0);
  return {
    questions: rows.length,
    pass: rows.filter((r) => r.score.pass).length,
    foundCorrect: rows.filter((r) => r.score.checks[0][1]).length,
    invented: sum((r) => r.score.dropped),
    avgSeconds: Math.round(sum((r) => (r.answer.meta?.durationMs ?? 0) / 1000) / n),
    avgCost: Math.round((sum((r) => r.answer.meta?.costUsd ?? 0) / n) * 100) / 100,
    totalCost: Math.round(sum((r) => r.answer.meta?.costUsd ?? 0) * 100) / 100,
  };
}

/**
 * What the agent says today about a suggested ticket: its prior-art verdict once K19 exists, otherwise what
 * suggestTickets() shows ("already open as", "created as", or nothing = new).
 * @returns {{ verdict: string, key: string | null }}
 */
export function suggestionVerdict(s) {
  if (s.priorArt?.verdict) return { verdict: s.priorArt.verdict, key: s.priorArt.key ?? null };
  if (s.created) return { verdict: 'ticket-exists', key: s.created.key };
  if (s.openAs) return { verdict: 'ticket-exists', key: s.openAs };
  return { verdict: 'new', key: null };
}

/**
 * A prior-art case ({ verdicts: accepted verdicts, key? }) against what the agent said ({ verdict, key }).
 * `key` may be a list of accepted keys.
 */
export function priorArtOk(expected, got, map = (k) => k) {
  if (!expected.verdicts.includes(got.verdict)) return false;
  if (!expected.key) return true;
  const keys = [expected.key].flat().map(map);
  return keys.includes(got.key);
}
