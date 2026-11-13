// Is this problem already known? (K20 of the Ticket Intelligence knowledge plan.) The facts that answer it, put in
// one place of the bundle for the analysis step "Already known?": open tickets about the same thing, resolved ones
// with the dates of their fixes (before or after this ticket was reported), fix branches of other tickets that change
// the same code, and knowledge entries. Plain code; the agent reads the evidence and decides the kind.

const DONE = /done|closed|resolved|chius|risolt|fatto/i;

/**
 * @param {object} p
 * @param {object} p.target    the normalized ticket (key, created)
 * @param {object[]} p.related the bundle's related tickets (key, summary, status, resolution, relevance, …)
 * @param {object|null} p.code the bundle's code context (ticketCommits, otherFixBranches, knowledgeDocs.entries)
 * @param {number} [p.minRelevance]
 * @returns {{ candidates: object[], summary: string }}
 */
export function knownProblems({ target, related = [], code = null, minRelevance = 0.3 }) {
  const created = Date.parse(target.created ?? '') || null;
  const commits = code?.ticketCommits ?? [];
  const candidates = [];

  for (const r of related.filter((x) => x.relevance >= minRelevance)) {
    const resolved = Boolean(r.resolution) || DONE.test(r.status ?? '');
    if (!resolved) {
      candidates.push({ kind: 'open', key: r.key, summary: r.summary, status: r.status, relevance: r.relevance, why: `open ticket, relevance ${r.relevance}` });
      continue;
    }
    const fixes = commits.filter((c) => (c.keys ?? []).includes(r.key)).map((c) => ({ short: c.short, date: c.date, subject: c.subject }));
    const last = fixes.map((c) => Date.parse(c.date)).filter(Boolean).sort((a, b) => b - a)[0] ?? null;
    candidates.push({
      kind: 'resolved', key: r.key, summary: r.summary, status: r.status, resolution: r.resolution, relevance: r.relevance, fixCommits: fixes.slice(0, 4),
      fixedBeforeThisTicket: last && created ? last < created : null,
      why: fixes.length ? `resolved; fix ${fixes[0].short} (${String(fixes[0].date).slice(0, 10)})${last && created ? (last < created ? ', before this ticket was reported' : ', after this ticket was reported') : ''}` : 'resolved; no fix commit found',
    });
  }

  for (const b of code?.otherFixBranches ?? []) {
    candidates.push({ kind: 'fix-branch', key: b.key, branch: b.branch, files: b.files, lastCommit: b.lastCommit, why: `branch ${b.branch} changes ${b.files.slice(0, 3).join(', ')}` });
  }

  for (const e of code?.knowledgeDocs?.entries ?? []) {
    candidates.push({ kind: 'documented', key: e.key, title: e.title, entry: `${e.file}#${e.anchor}`, symptom: e.symptom, rootCause: e.rootCause, fix: e.fix, why: e.why });
  }

  const count = (k) => candidates.filter((c) => c.kind === k).length;
  const summary = candidates.length
    ? `${count('open')} open, ${count('resolved')} resolved, ${count('fix-branch')} fix branch(es) of other tickets, ${count('documented')} knowledge entr${count('documented') === 1 ? 'y' : 'ies'}`
    : 'nothing found: no related ticket above the relevance threshold, no fix branch of another ticket on the same code, no knowledge entry';
  return { candidates, summary };
}
