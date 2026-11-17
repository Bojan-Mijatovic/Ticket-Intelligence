// Ask: a ticket key gives its status and its next step from the agent's own records (its events, the ticket in Jira,
// the state of its pull requests), in about a second and with no model. It answers the question this project started
// from: "I opened ticket X: what is the status, and can it be sped up?" (docs/PROBLEM_BRIEF.md).

const KEY = /\b([A-Z][A-Z0-9_]+-\d+)\b/g;
// Words that ask for a status, in the languages the team writes in (English, Italian, Serbian).
// Letter boundaries that know Unicode: \b does not see "š" as a letter, so "šta je sa" never matched.
const STATUS_WORDS = /(?<!\p{L})(status|state|stato|stanje|where|dove|gde|gdje|what about|che succede|šta je sa|sta je sa|progress|avanzamento|napredak)(?!\p{L})/iu;

/**
 * The ticket a question asks about, when it asks only for its status: the key alone ("DEM-46", "DEM-46?"), or one key
 * with a few words that ask for a status ("status DEM-46", "koji je status VAX-21", "what is the status of LAB-24?").
 * A real question about a ticket ("why does DEM-46 happen on Mondays?") goes to the full Ask.
 */
export function ticketKeyQuestion(question) {
  const q = String(question ?? '').trim();
  const keys = [...new Set([...q.matchAll(KEY)].map((m) => m[1]))];
  if (keys.length !== 1) return null;
  const rest = q.replace(KEY, ' ').replace(/[?!.,:;'"()]/g, ' ').trim();
  const words = rest ? rest.split(/\s+/) : [];
  if (!words.length) return keys[0];
  return words.length <= 8 && STATUS_WORDS.test(rest) ? keys[0] : null;
}

const pad = (n) => String(n).padStart(2, '0');
/** 2026-11-16 17:06, in the watcher's own time zone. */
export const localTime = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const prNumber = (url) => Number(String(url ?? '').match(/\/pull\/(\d+)/)?.[1]) || null;

/**
 * @param {string} p.key
 * @param {object|null} p.issue   the ticket in Jira ({ summary, status, priority, created }), or null when Jira has none
 * @param {object[]} p.events     the agent's events (every one; this ticket's are picked here)
 * @param {Record<string, object>} [p.prs]  state by PR url: { state: OPEN|MERGED|CLOSED, isDraft, mergedAt, mergeCommit }
 * @param {object} [p.now]        { processing: { key, kind }, queued: [keys] } from the watcher
 * @returns {{ found: boolean, answer: string, next: string, sources: object[] }}
 */
export function ticketStatus({ key, issue, events, prs = {}, now = {}, ticketUrl = () => null, time = localTime }) {
  const ev = events.filter((e) => e.key === key).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const last = (type, from = ev) => from.filter((e) => e.type === type).at(-1) ?? null;
  // The last run: from its last pick (a Run again starts a new one). PRs and documentation count across runs.
  const lastPick = ev.map((e) => e.type).lastIndexOf('picked');
  const run = lastPick >= 0 ? ev.slice(lastPick) : ev;
  const sources = [{ type: 'ticket', ref: key, url: ticketUrl(key), why: issue ? `${issue.status}: ${issue.summary}` : 'not found in Jira' }];

  if (!issue) {
    return { found: false, next: 'none', sources, answer: `${key}: Jira has no ticket with this key, or this account cannot see it.${ev.length ? ` The agent's records still name it (${ev.length} events, the last on ${time(ev.at(-1).at)}): it may have been deleted.` : ''}` };
  }

  const lines = [];
  const say = (e, text) => lines.push({ at: String(e.at), line: `· ${time(e.at)}  ${text}` }); // sorted by time below
  const analyzed = last('analyzed', run);
  const owner = analyzed?.result?.handoff?.to ?? analyzed?.result?.owner?.name ?? null;
  const notified = last('notified', run);
  const fixPr = last('pr', ev) ?? last('fix-proposed', ev);
  const fixPrUrl = fixPr?.url ?? null;
  const docsPr = last('documented', ev);
  const docsMerged = last('docs-merged', ev);
  const held = last('system1-held', run);
  const released = held && run.some((e) => e.at > held.at && ['picked', 'triaged', 'analyzed'].includes(e.type));

  if (analyzed) say(analyzed, `analysed: ${analyzed.result?.confidence ?? '?'} confidence${owner ? `, owner ${owner}` : ''}${analyzed.meta?.durationMs ? ` (${Math.round(analyzed.meta.durationMs / 1000)} s)` : ''}`);
  const triaged = last('triaged', run);
  if (triaged) say(triaged, triaged.text);
  if (held) say(held, held.text.replace(/^held: /, 'held for a person: '));
  const prior = last('prior-art', run);
  if (prior) say(prior, prior.text.split(' · ')[0]);
  if (notified) say(notified, notified.text);
  const reproduced = last('reproduced', run);
  if (reproduced) say(reproduced, 'bug reproduced by a test');
  const bisected = last('bisected', run);
  if (bisected) say(bisected, bisected.text.replace(/^bisect: broken by /, 'the change that broke it: ').replace(/: the test passes on .*$/, ''));
  const fixFailed = last('fix-failed', run);
  const fixSkipped = last('fix-skipped', run);
  if (fixFailed) say(fixFailed, `the automatic fix stopped: ${fixFailed.text}`);
  if (fixSkipped) say(fixSkipped, fixSkipped.text);
  const pr = fixPrUrl ? prs[fixPrUrl] ?? null : null;
  if (fixPr) say(fixPr, `draft PR #${prNumber(fixPrUrl)} opened${pr ? `: now ${pr.state === 'MERGED' ? `merged${pr.mergedAt ? ` on ${time(pr.mergedAt)}` : ''}${pr.mergeCommit ? ` (${pr.mergeCommit.slice(0, 7)})` : ''}` : pr.state === 'CLOSED' ? 'closed without a merge' : pr.isDraft ? 'open, a draft' : 'open, ready for review'}` : ''}`);
  const reviewed = last('reviewed', ev);
  if (reviewed) say(reviewed, `AI review of the PR: ${reviewed.text}`);
  const mergeCheck = last('merge-check', ev);
  if (mergeCheck) say(mergeCheck, mergeCheck.text);
  const fixNotified = last('fix-notified', ev);
  if (fixNotified) say(fixNotified, fixNotified.text);
  const resolved = last('resolved', ev);
  if (resolved) say(resolved, 'moved to Done');
  const docsPrState = docsPr?.url ? prs[docsPr.url] ?? null : null;
  if (docsPr) say(docsPr, `documentation PR #${prNumber(docsPr.url)}${docsMerged || docsPrState?.state === 'MERGED' ? ', merged' : docsPrState?.state === 'CLOSED' ? ', closed without a merge' : ', waiting for a merge'}`);
  const failed = last('failed', run);
  if (failed && !analyzed) say(failed, `the analysis failed: ${failed.text}`);

  for (const p of [fixPrUrl, docsPr?.url]) if (p) sources.push({ type: 'pr', ref: `PR #${prNumber(p)}`, url: p, why: p === fixPrUrl ? 'the fix' : 'the documentation' });

  // What waits, and for whom: the step that would speed it up.
  const done = /done|closed|resolved/i.test(issue.status ?? '');
  const drafts = run.filter((e) => e.type === 'draft').map((e) => (e.kind === 'assign' ? e.text.replace(/^Suggested assignee: /, 'the assignee ') : e.kind === 'reply' ? 'the reply to the reporter' : e.kind === 'ask-reporter' ? 'the question to the reporter' : e.text));
  const waitingOwner = owner ? `${owner}${notified ? `, who got the Teams message on ${time(notified.at)}` : ''}` : 'a developer of that area';
  let next;
  if (now.processing?.key === key) next = `The agent is working on it right now (${now.processing.kind}).`;
  else if ((now.queued ?? []).includes(key)) next = 'It waits in the agent\'s queue and is taken next in turn.';
  else if (!ev.length) next = done ? 'Done in Jira; the agent never worked on it.' : 'The agent has not picked it up (created before its look-back window, labelled no-ai, or not settled yet). "Run ticket" on the dashboard analyses it now.';
  else if (held && !released) next = `Waits for a person on the dashboard: it is held (${held.kind === 'privacy' ? 'the text may still name a person' : held.kind === 'incomplete' ? 'the report misses what is needed; the question to the reporter is in Drafts' : 'System 1 offers the light path'}). Release it or choose there.`;
  else if (failed && !analyzed) next = `The analysis failed (${failed.text}). "Run again" on its card retries it.`;
  else if (fixPrUrl && pr?.state === 'OPEN') next = `Waits for a person: review and merge PR #${prNumber(fixPrUrl)}${reviewed ? ` (AI review: ${reviewed.text.split(' · ')[0]})` : ''}${mergeCheck ? `; ${mergeCheck.text}` : ''}.`;
  else if (fixPrUrl && pr?.state === 'CLOSED' && !done) next = `The fix PR #${prNumber(fixPrUrl)} was closed without a merge: reopen it, or ${waitingOwner} fixes it by hand.`;
  else if (fixPrUrl && pr?.state === 'MERGED' && !done) next = `Fixed on main (PR #${prNumber(fixPrUrl)} merged): it can be moved to Done.`;
  else if (done) {
    next = docsMerged || docsPrState?.state === 'MERGED' ? 'Nothing waits: done and documented.'
      : docsPr ? `Done; the documentation PR #${prNumber(docsPr.url)} waits for a merge (Insights → Knowledge base).`
        : last('doc-failed', ev) ? `Done; its documentation failed (${last('doc-failed', ev).text}).`
          : 'Done; the agent documents it at its next look at the resolved tickets.';
  } else if (fixFailed) next = `The automatic fix stopped, so it waits for ${waitingOwner}.`;
  else if (fixSkipped) next = `No automatic fix (${fixSkipped.text.replace(/^no automatic fix: /, '')}): it waits for ${waitingOwner}.`;
  else if (triaged) next = 'Answered on the light path (no code analysis). If it does need a change in the code, "Run again" on its card.';
  else if (analyzed) next = `Analysed: it waits for ${waitingOwner}.`;
  else next = 'The agent started on it; nothing more is recorded yet.';
  if (drafts.length && !done) next += ` Drafts wait for a person on the dashboard: ${drafts.join(', ')}.`;

  const head = `${key} · ${issue.summary}\nJira: ${issue.status}${issue.priority ? ` · ${issue.priority}` : ''}${issue.created ? ` · reported ${time(issue.created)}` : ''}`;
  const story = lines.sort((a, b) => a.at.localeCompare(b.at)).map((l) => l.line); // stable: same time keeps its order
  const answer = `${head}\n\n${story.length ? `What happened\n${story.join('\n')}\n\n` : ''}Now\n${next}`;
  return { found: true, next, sources, answer };
}
