// Suggested tickets (Insights, phase E): what the team could open next, each with a summary in the project's style, a
// description that says what to do and why (with its sources), and a suggested person from the knowledge map.
//
// Sources: the AI review of the app (findings, refactors, ways to grow) and the plain facts (a fix of a copy in another
// app that is missing here, risk files without a test, a component that only one person knows). Nothing is created on
// its own: policy.json createTicket "draft" shows a Create in Jira button, and a person checks, edits and confirms.
// The suggested person is assigned only when a Jira user of the project has that name; otherwise the name stays in
// the description.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { componentOf, personKey } from './insights.mjs';
import { codeVerdict, priorArtCandidates } from './prior-art.mjs';

export const TYPES = ['Bug', 'Task', 'Story'];
export const PRIORITIES = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];
const PRIORITY_OF = { high: 'High', medium: 'Medium', low: 'Low' };
const ORDER = { Highest: 0, High: 1, Medium: 2, Low: 3, Lowest: 4 };

const idOf = (...parts) => createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 10);
const base = (p) => String(p).split('/').pop();
const clean = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
const normal = (s) => clean(s).toLowerCase().replace(/^\[[a-z\]\[]+\]\s*-\s*/, '').replace(/[^\p{L}\p{N} ]/gu, '');

/** Share of the words (3+ letters, without the [BE]/[FE] tag) two summaries have in common (0..1). */
export function wordsAlike(a, b) {
  const words = (s) => new Set(normal(s).split(' ').filter((w) => w.length >= 3));
  const [A, B] = [words(a), words(b)];
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / (A.size + B.size - both || 1);
}

/** The first sentence of a text, at most `max` characters (cut at a word). */
export function shortText(text, max = 80) {
  const s = clean(text);
  const one = s.split(/(?<=[.!?])\s/)[0].replace(/[.!?]$/, '');
  return one.length <= max ? one : `${one.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

/** [BE], [FE] or [BE][FE] from the files a ticket is about (the projects' summary style). */
export function sideTag(files) {
  const be = files.some((f) => f.startsWith('backend/'));
  const fe = files.some((f) => f.startsWith('frontend/'));
  return be && fe ? '[BE][FE]' : be ? '[BE]' : fe ? '[FE]' : '';
}

const summaryOf = (tag, component, text) => `${tag ? `${tag} - ` : ''}${component ? `${component}: ` : ''}${text}`.slice(0, 250);

/** Who knows a component best (its largest share of commits), as the person to suggest. */
function whoKnows(insights, component) {
  const top = insights.components.find((c) => c.name === component)?.team?.[0];
  return top ? { name: top.name, why: `knows ${component}: ${top.share}% of its commits` } : null;
}

/** A Jira wiki-markup description: sections, files, the suggested person and the sources. */
function describe({ sections, files = [], person, sources, origin }) {
  const out = [];
  for (const [title, body] of sections) {
    if (!body || (Array.isArray(body) && !body.length)) continue;
    out.push(`h3. ${title}`, Array.isArray(body) ? body.map((b, i) => `${title === 'Steps' ? '#' : '*'} ${b}`).join('\n') : String(body), '');
  }
  if (files.length) out.push('h3. Files', files.map((f) => `* {{${f}}}`).join('\n'), '');
  if (person) out.push('h3. Suggested assignee', `${person.name} (${person.why}).`, '');
  out.push('----', `_Suggested by Ticket Intelligence (${origin}).${sources.length ? ` Sources: ${[...new Set(sources)].join(', ')}.` : ''} Check it before planning it._`);
  return out.join('\n');
}

const refsIn = (...texts) => [...new Set(texts.flat().join(' ').match(/\b[A-Z][A-Z0-9]+-\d+\b|\b(?=[0-9a-f]*[a-f])[0-9a-f]{7}\b/g) ?? [])];

/**
 * The suggested tickets of a project. `review`: the cached AI review (or null); `rules`: insights.components (to place
 * files); `created`: id → { key } of the suggestions already created. Suggestions whose summary matches an existing
 * ticket are left out.
 */
export function suggestTickets({ insights, review = null, rules = [], created = {}, project, priorArtSources = null }) {
  const out = [];
  const add = (s) => out.push({ ...s, id: idOf(s.source, s.summary), created: null });
  const componentOfFiles = (files) => files.map((f) => componentOf(f, rules)).find(Boolean) ?? null;
  const reviewOrigin = review ? `AI review of the app, ${String(review.at).slice(0, 10)}` : '';

  for (const f of review?.findings ?? []) {
    const component = f.component || componentOfFiles([f.file]);
    const priority = PRIORITY_OF[f.priority] ?? 'Medium';
    const person = whoKnows(insights, component);
    add({
      source: 'review-finding', type: f.priority === 'high' ? 'Bug' : 'Task', priority, component, files: [f.file], person, stale: Boolean(review.stale),
      summary: summaryOf(sideTag([f.file]), component, clean(f.ticket) || shortText(f.problem)),
      description: describe({ sections: [['Problem', f.problem], ['Evidence', f.evidence], ['Proposed fix', f.fix], ['How to prevent it', f.prevent]], files: [f.file], person, sources: refsIn(f.evidence, f.problem), origin: reviewOrigin }),
    });
  }
  for (const r of review?.refactors ?? []) {
    const component = componentOfFiles(r.files);
    const person = whoKnows(insights, component);
    add({
      source: 'review-refactor', type: 'Task', priority: 'Medium', component, files: r.files, person, stale: Boolean(review.stale), effort: r.effort ?? null,
      summary: summaryOf(sideTag(r.files), null, `Refactor: ${clean(r.ticket) || shortText(r.title)}`),
      description: describe({ sections: [['Why', r.why], ['Steps', r.steps ?? []], ['Effort', r.effort ? { S: 'small', M: 'medium', L: 'large' }[r.effort] ?? r.effort : null], ['What it gives', r.payoff]], files: r.files, person, sources: refsIn(r.why), origin: reviewOrigin }),
    });
  }
  for (const g of review?.growth ?? []) {
    const files = (g.buildsOn ?? []).filter((b) => /\//.test(b));
    const component = componentOfFiles(files);
    const person = whoKnows(insights, component);
    add({
      source: 'review-growth', type: 'Story', priority: 'Low', component, files, person, stale: Boolean(review.stale),
      summary: summaryOf(sideTag(files), null, clean(g.ticket) || shortText(g.title)),
      description: describe({ sections: [['Why', g.why], ['Builds on', (g.buildsOn ?? []).filter((b) => !/\//.test(b))], ['First', g.prerequisites]], files, person, sources: refsIn(g.why, g.buildsOn ?? []), origin: reviewOrigin }),
    });
  }

  // A bug fixed in a copy of this file in another app, whose new lines are not here.
  const checks = new Map();
  for (const p of insights.shared?.pairs ?? []) for (const key of p.checkHere ?? []) {
    const id = `${key}|${p.path}`;
    if (!checks.has(id)) checks.set(id, { key, path: p.path, copies: [] });
    checks.get(id).copies.push(p);
  }
  for (const { key, path, copies } of checks.values()) {
    const component = componentOf(path, rules);
    const person = whoKnows(insights, component);
    add({
      source: 'shared-check', type: 'Task', priority: 'Medium', component, files: [path], person,
      summary: summaryOf(sideTag([path]), component, `check whether the ${key} fix applies to ${base(path)}`),
      description: describe({
        sections: [
          ['Why', `${key} fixed a bug in a copy of this file in another app of the suite: ${copies.map((c) => `{{${c.peerPath}}} in ${c.peerName ?? c.peer} (${c.identical ? 'identical' : `${c.similarity}% alike`})`).join(', ')}. The lines that fix added are not in {{${path}}}.`],
          ['What to do', `Read the ${key} fix and decide whether the same problem can happen here. If it can, apply the fix with a test; if not, close this ticket with the reason.`],
        ],
        files: [path], person, sources: [key], origin: 'Insights, code shared with other projects',
      }),
    });
  }

  // Files where the bugs were fixed that have no test of their own and none in their package (not the tiny ones, such
  // as an exception class: there is nothing to test in them).
  for (const f of (insights.riskFiles ?? []).filter((x) => x.test === 'none' && x.bugs.length && !(x.lines < 20)).slice(0, 3)) {
    const person = whoKnows(insights, f.component);
    add({
      source: 'risk-test', type: 'Task', priority: f.bugs.length > 1 ? 'Medium' : 'Low', component: f.component, files: [f.path], person,
      summary: summaryOf(sideTag([f.path]), f.component, `add a test for ${base(f.path)}`),
      description: describe({
        sections: [
          ['Why', `{{${base(f.path)}}} has no test of its own and none in its package, and bugs were fixed in it: ${f.bugs.join(', ')} (${f.why.join(', ')}).`],
          ['What to do', `Add a test that pins the behaviour those fixes restored, so the same bug cannot come back unnoticed.`],
        ],
        files: [f.path], person, sources: f.bugs, origin: 'Insights, risk files',
      }),
    });
  }

  // Components that only one person knows (bus factor 1) and that see work.
  for (const c of insights.components.filter((x) => x.busFactor === 1 && x.tickets >= 3 && x.team?.length)) {
    const [holder, second] = c.team;
    const person = second ? { name: second.name, why: `second in ${c.name} with ${second.share}% of its commits, to learn it from ${holder.name}` } : null;
    add({
      source: 'bus-factor', type: 'Task', priority: 'Low', component: c.name, files: [], person,
      summary: summaryOf('', c.name, 'share the knowledge (one person holds most of the commits)'),
      description: describe({
        sections: [
          ['Why', `${holder.name} has ${holder.share}% of the commits of ${c.name}; nobody else has a quarter of them (bus factor 1). ${c.tickets} tickets touched it${c.bugs ? `, ${c.bugs} of them bugs (${c.bugKeys.join(', ')})` : ''}.`],
          ['What to do', 'Pair on the next ticket of this component, review each other\'s changes in it, and write down what is not obvious in docs/knowledge/.'],
        ],
        person, sources: c.bugKeys, origin: 'Insights, knowledge map',
      }),
    });
  }

  const existing = new Set(insights.tickets.map((t) => normal(t.summary)));
  // A created ticket counts only while it is still in Jira (deleted there: the suggestion is open again).
  const keys = new Set(insights.tickets.map((t) => t.key));
  const createdOf = (s) => (created[s.id] && keys.has(created[s.id].key) ? created[s.id] : null);
  // An open ticket that already says the same (most words of the summary alike): no second ticket. A done one does not
  // count: the same problem found again on main is a regression worth a ticket.
  const open = insights.tickets.filter((t) => !/done|closed|resolved/i.test(t.status ?? ''));
  const openAs = (s) => open.find((t) => t.key !== createdOf(s)?.key && wordsAlike(s.summary, t.summary) >= 0.6)?.key ?? null;
  // Prior art (K17, K19): what the project already knows about each suggestion. Without the sources (a caller that
  // did not load them) the suggestions keep only the word check above.
  const reviewAt = review?.at ?? null;
  const priorArtOf = (s) => {
    if (!priorArtSources) return null;
    const candidates = priorArtCandidates(
      { summary: s.summary, text: s.description, files: s.files, component: s.component, since: s.source.startsWith('review') ? reviewAt : null },
      { ...priorArtSources, tickets: insights.tickets },
    );
    return { ...codeVerdict(candidates, { own: createdOf(s) }), candidates, notes: priorArtSources.notes ?? [] };
  };
  return out
    .filter((s) => !existing.has(normal(s.summary)) || createdOf(s))
    .map((s) => ({ ...s, created: createdOf(s), openAs: createdOf(s) ? null : openAs(s), project }))
    .map((s) => ({ ...s, priorArt: priorArtOf(s) }))
    .sort((a, b) => Number(Boolean(a.created)) - Number(Boolean(b.created)) || (ORDER[a.priority] ?? 9) - (ORDER[b.priority] ?? 9) || TYPES.indexOf(a.type) - TYPES.indexOf(b.type));
}

export const createdFile = (stateDir) => join(stateDir, 'insights', 'suggestions-created.json');

export function readCreated(stateDir) {
  try {
    return existsSync(createdFile(stateDir)) ? JSON.parse(readFileSync(createdFile(stateDir), 'utf8')) : {};
  } catch {
    return {};
  }
}

/**
 * Creates one suggested ticket after a person confirmed it, with their edits; labels it ai-suggested, and no-ai unless
 * the agent should analyze it. The assignee:
 *   assigneeId (a string)  the person picked on the dashboard; it must be assignable in the project (checked in Jira)
 *   assigneeId '' or null  nobody
 *   assigneeId undefined   the suggested person, when a Jira user of the project has that name (with assign: true)
 * When the suggested person has no Jira account, the description says so.
 */
/**
 * What was checked before the ticket was created (K19), for its description: the verdict, the reason a person gave
 * to create it anyway, and the related tickets, entries and pull requests.
 */
export function priorArtSection(priorArt, reason = '') {
  if (!priorArt) return '';
  const KIND = { open: 'open ticket', solved: 'resolved before', 'fixed-by': 'fixed after the suggestion', documented: 'knowledge entry', 'in-progress': 'open pull request' };
  const lines = (priorArt.candidates ?? []).map((c) => `* ${c.key ? `${c.key}` : `PR #${c.pr}`} (${KIND[c.kind] ?? c.kind}): ${c.title} — ${c.reasons.slice(0, 2).join('; ')}`);
  if (!lines.length && !reason) return '';
  return ['', 'h3. Checked before creating', ...(reason ? [`Created although the check said *${priorArt.verdict}${priorArt.key ? ` ${priorArt.key}` : ''}*. Reason: ${reason}`] : []), ...(lines.length ? ['Related:', ...lines] : [])].join('\n');
}

export async function createSuggested({ jira, project, stateDir, suggestion, edits = {}, assign = true, assigneeId = undefined, analyze = false, reason = '' }) {
  const summary = clean(edits.summary ?? suggestion.summary);
  const type = edits.type ?? suggestion.type;
  const priority = edits.priority ?? suggestion.priority;
  let description = String(edits.description ?? suggestion.description ?? '').trim() + priorArtSection(suggestion.priorArt, clean(reason).slice(0, 500));
  if (!summary || summary.length > 250) throw Object.assign(new Error('the summary must have 1 to 250 characters'), { status: 400 });
  if (!TYPES.includes(type)) throw Object.assign(new Error(`the type must be one of ${TYPES.join(', ')}`), { status: 400 });
  if (priority && !PRIORITIES.includes(priority)) throw Object.assign(new Error(`the priority must be one of ${PRIORITIES.join(', ')}`), { status: 400 });
  if (description.length > 30000) throw Object.assign(new Error('the description is too long'), { status: 400 });

  let assignee = null;
  if (typeof assigneeId === 'string' && assigneeId) {
    assignee = (await jira.assignableUsers(project, '')).find((u) => u.accountId === assigneeId) ?? null;
    if (!assignee) throw Object.assign(new Error(`that person cannot be assigned tickets in ${project}`), { status: 400 });
  } else if (assigneeId === undefined && assign && suggestion.person) {
    const users = await jira.assignableUsers(project, suggestion.person.name).catch(() => []);
    assignee = users.find((u) => personKey(u.name) === personKey(suggestion.person.name)) ?? null;
  }
  if (suggestion.person && personKey(assignee?.name) !== personKey(suggestion.person.name)) {
    // Say why the suggested person is not the assignee: no account, or someone else (or nobody) was picked.
    const hasAccount = (await jira.assignableUsers(project, suggestion.person.name).catch(() => [])).some((u) => personKey(u.name) === personKey(suggestion.person.name));
    description += hasAccount
      ? `\n\n_Suggested: ${suggestion.person.name}; ${assignee ? `assigned to ${assignee.name}` : 'left unassigned'} when it was created._`
      : `\n\n_${suggestion.person.name} has no Jira account in ${project}${assignee ? `; assigned to ${assignee.name}` : ', so the ticket is not assigned'}._`;
  }
  const labels = ['ai-suggested', ...(analyze ? [] : ['no-ai'])];
  const res = await jira.createIssue({ project, summary, description, type, priority, labels, assigneeId: assignee?.accountId ?? null });
  const created = { key: res.key, url: res.url, at: new Date().toISOString(), summary, assignee: assignee?.name ?? null };
  const all = readCreated(stateDir);
  all[suggestion.id] = created;
  mkdirSync(join(stateDir, 'insights'), { recursive: true });
  writeFileSync(createdFile(stateDir), JSON.stringify(all, null, 2));
  return created;
}
