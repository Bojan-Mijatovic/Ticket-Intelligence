// Ticket lanes (G1 of docs/GIT_GRAPH.md): a project's graph (lib/git-graph.mjs) laid out like a branch graph. The main
// line is column 0, with one lane per ticket the agent worked on; the newest row comes first. A lane runs from the
// ticket's first step to its last, and joins the main line at the ticket's commits there (the squash merge of its
// PR on git, the commit itself on SVN). Plain code; the dashboard only draws it.

const prNo = (url) => Number(String(url ?? '').match(/\/pull\/(\d+)/)?.[1]) || null;
const riskTone = (text) => (/risk high|needs-changes/i.test(text) ? 'bad' : /risk medium/i.test(text) ? 'warn' : 'ok');

// The steps a lane shows, in the words of a person reading the history. Chatty events (picked, commented, notified)
// are left out; the commits are rows of the main line.
const STEP = {
  analyzed: { tone: 'info', label: (s) => `Analysed · ${s.text}` },
  duplicate: { tone: 'warn', label: (s) => s.text },
  'prior-art': { tone: 'warn', label: (s) => s.text },
  'fix-skipped': { tone: 'muted', label: (s) => s.text.replace(/^no automatic fix:/i, 'No automatic fix:') },
  reproduced: { tone: 'bad', label: () => 'Test written: it fails before the fix' },
  bisected: { tone: (text) => (/broken by \S/.test(text) ? 'warn' : 'muted'), label: (s) => s.text.replace(/^bisect: /, 'Bisect: ') },
  verified: { tone: 'ok', label: () => 'Fix verified: the test and all checks pass' },
  pr: { tone: 'info', label: (s) => `Draft PR${prNo(s.url) ? ` #${prNo(s.url)}` : ''} opened` },
  'fix-failed': { tone: 'bad', label: (s) => `Fix stopped: ${s.text}` },
  reviewed: { tone: riskTone, label: (s) => `AI review: ${s.text}` },
  'pr-merged': { tone: 'ok', label: (s) => s.text },
  'pr-closed': { tone: 'muted', label: (s) => s.text },
  resolved: { tone: 'info', label: () => 'Resolved in Jira' },
  documented: { tone: 'info', label: (s) => `Documentation PR${prNo(s.url) ? ` #${prNo(s.url)}` : ''} opened` },
  'doc-failed': { tone: 'bad', label: (s) => `Documentation failed: ${s.text}` },
  'docs-merged': { tone: 'ok', label: () => 'Documentation merged' },
  failed: { tone: 'bad', label: (s) => `Run failed: ${s.text}` },
};

const worked = (t) => t.analyses.length || t.fixAttempts.length || t.reviews.length || t.documented.length || t.prs.length;

/**
 * @param {object} graph   buildGraph()/loadGraph()
 * @param {object} [o]
 * @param {string} [o.since]      ISO date: rows before it are left out (a lane that started earlier is cut at the bottom)
 * @param {string} [o.ticket]     one ticket: its lane and its commits only
 * @param {boolean} [o.agentOnly] main-line commits only when they are the agent's or belong to a lane
 * @param {number} [o.limit]      at most this many rows, the newest
 * @returns {{ rows: object[], lanes: object[], cols: number, cut: number }}  rows newest first (row.y = its index);
 *   lanes: { ticket, col, top, bottom, merges: [y], end, cut }; cut = older rows left out by the limit
 */
export function laneLayout(graph, { since = null, ticket = null, agentOnly = false, limit = 400 } = {}) {
  const from = since ? Date.parse(since) : null;
  const inWindow = (at) => from == null || Date.parse(at) >= from; // as times, not text (…00Z vs …00.000Z)
  const prOnMain = new Set(graph.commits.filter((c) => c.pr).map((c) => c.pr));
  const laneTickets = graph.tickets.filter((t) => worked(t) && (!ticket || t.key === ticket));
  const laneKeys = new Set(laneTickets.map((t) => t.key));

  let rows = [];
  for (const c of graph.commits) {
    if (!inWindow(c.date) || (ticket && c.ticket !== ticket) || (agentOnly && !c.agent && !laneKeys.has(c.ticket))) continue;
    rows.push({ at: c.date, kind: 'commit', ticket: c.ticket, text: c.subject, ref: c.short, pr: c.pr, by: c.agent ? null : c.author, agent: c.agent, docs: c.kind === 'docs' });
  }
  for (const t of laneTickets) {
    for (const s of t.steps) {
      const def = STEP[s.type];
      if (!def || !inWindow(s.at)) continue;
      if (s.type === 'pr-merged' && prOnMain.has(prNo(s.url))) continue; // the main line shows the merge commit
      rows.push({ at: s.at, kind: 'step', ticket: t.key, type: s.type, text: def.label(s), tone: typeof def.tone === 'function' ? def.tone(s.text) : def.tone, url: s.url ?? null });
    }
  }
  rows.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.kind === b.kind ? 0 : a.kind === 'step' ? -1 : 1));
  const cut = Math.max(0, rows.length - limit);
  rows = rows.slice(cut); // oldest first, the newest `limit`

  // Lanes in time order; a column is free again once its lane has ended (greedy interval colouring).
  const lanes = [];
  for (const key of laneKeys) {
    const steps = rows.map((r, i) => (r.kind === 'step' && r.ticket === key ? i : -1)).filter((i) => i >= 0);
    if (!steps.length) continue;
    const first = steps[0];
    const merges = rows.map((r, i) => (r.kind === 'commit' && r.ticket === key && i > first ? i : -1)).filter((i) => i >= 0);
    const last = Math.max(steps.at(-1), ...merges);
    const lastStep = rows[steps.at(-1)];
    const end = merges.length && merges.at(-1) === last ? 'merged' : lastStep.type === 'pr-closed' ? 'closed' : lastStep.type === 'fix-failed' || lastStep.type === 'failed' ? 'stopped' : 'open';
    lanes.push({ ticket: key, first, last, merges, end, cut: cut > 0 && first === 0 });
  }
  lanes.sort((a, b) => a.first - b.first);
  const busyUntil = []; // column → index of the last row of the lane in it
  for (const l of lanes) {
    let col = busyUntil.findIndex((until, c) => c > 0 && until < l.first);
    if (col < 0) col = Math.max(1, busyUntil.length);
    busyUntil[col] = l.last;
    l.col = col;
  }
  const colOf = new Map(lanes.map((l) => [l.ticket, l.col]));

  // Newest first for display: y = row index from the top.
  const n = rows.length;
  const y = (i) => n - 1 - i;
  const shown = rows.map((r) => ({ ...r, col: r.kind === 'commit' ? 0 : colOf.get(r.ticket) ?? 0 })).reverse().map((r, i) => ({ ...r, y: i }));
  return {
    rows: shown,
    lanes: lanes.map((l) => ({ ticket: l.ticket, col: l.col, top: y(l.last), bottom: y(l.first), merges: l.merges.map(y), end: l.end, cut: l.cut })),
    cols: Math.max(1, ...lanes.map((l) => l.col + 1)),
    cut,
  };
}
