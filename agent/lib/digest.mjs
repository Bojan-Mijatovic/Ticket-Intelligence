// The morning digest (ROADMAP #3, WF3 of docs/AUTONOMY_AND_NEXT.md): what the agent did since the last digest, what
// came back, and what waits for a person, with the cost. Plain code over the event log and what the caller read now
// (open pull requests, held tickets, the night's checks). agent/digest.mjs gathers and posts; the watcher runs it at
// nightShift.digestAt.

const uniq = (xs) => [...new Set(xs.filter(Boolean))];
const money = (n) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
const COST_TYPES = new Set(['analyzed', 'fix-proposed', 'fix-failed', 'reviewed', 'documented', 'insights', 'research']);
const keysOf = (evs, max = 8) => {
  const keys = uniq(evs.map((e) => e.key));
  return keys.length > max ? `${keys.slice(0, max).join(', ')} and ${keys.length - max} more` : keys.join(', ');
};
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * @param {object} p
 * @param {object[]} p.events     the agent's events (all projects), any order
 * @param {string} p.from         the start of the period (the last digest), ISO
 * @param {string} p.to           its end, ISO
 * @param {number} [p.askCostUsd] what Ask's Claude answers cost in the period (asks.jsonl of every project)
 * @param {object} [p.waiting]    read now: { fixPrs: [{ key, url, number, ageHours, approved }], docsPrs: [{ key,
 *                                number, url, mergesAt }], held: [{ key, why }], gaps: number }
 * @param {object} [p.night]      the night's checks: { kbTests: { passed, failed: [{ project, key }] }, lint: { findings },
 *                                backlog: { queued, stopped } }
 * @returns {{ title, summary, sections: { title, lines: string[] }[], counts: object, quiet: boolean, markdown: string }}
 */
export function buildDigest({ events = [], from, to, askCostUsd = 0, waiting = {}, night = null, links = {} }) {
  const [a, b] = [Date.parse(from), Date.parse(to)];
  const ev = events.filter((e) => Date.parse(e.at) > a && Date.parse(e.at) <= b);
  const of = (type, f = () => true) => ev.filter((e) => e.type === type && f(e));
  const link = (key) => (links.ticket ? `[${key}](${links.ticket(key)})` : key);

  const analyzed = of('analyzed');
  const triaged = of('triaged');
  const asked = of('system1-held', (e) => e.kind === 'asked');
  const known = of('prior-art');
  const fixes = of('fix-proposed');
  const stopped = of('fix-failed');
  const reviews = of('reviewed');
  const documented = of('documented');
  const merged = of('docs-merged');
  const outcomeOf = (e) => e.outcome ?? (/a real gap/.test(e.text ?? '') ? 'not-found' : /saved as a FAQ/.test(e.text ?? '') ? 'faq' : null); // events before outcome was kept
  const research = of('research', outcomeOf).map((e) => ({ ...e, outcome: outcomeOf(e) }));
  const answeredInTeams = of('teams-answered');
  const decisions = [...of('approved'), ...of('rejected'), ...of('taken'), ...of('handed-on')];
  const alerts = of('guard', (e) => e.verdict === 'alert');
  const knownBack = of('known-test', (e) => e.status === 'fail');
  const demoted = of('system1-demoted');
  const errors = of('error');
  const cost = ev.filter((e) => COST_TYPES.has(e.type)).reduce((s, e) => s + (e.meta?.costUsd ?? e.costUsd ?? 0), 0) + askCostUsd;

  const done = [];
  if (analyzed.length || triaged.length) {
    const extra = [triaged.length && `${triaged.length} on the light path`, asked.length && `${plural(asked.length, 'report')} asked back`, known.length && `${known.length} already known`].filter(Boolean).join(', ');
    done.push(`Analysed ${plural(uniq([...analyzed, ...triaged].map((e) => e.key)).length, 'ticket')}${extra ? ` (${extra})` : ''}: ${keysOf([...analyzed, ...triaged])}`);
  }
  if (fixes.length) done.push(`${plural(fixes.length, 'draft fix PR')} opened, each with a test that failed before the fix: ${fixes.map((e) => (e.url ? `[${e.key}](${e.url})` : e.key)).join(', ')}`);
  if (stopped.length) done.push(`${plural(stopped.length, 'fix', 'fixes')} stopped without a PR: ${keysOf(stopped)}`);
  if (reviews.length) done.push(`${plural(reviews.length, 'AI review')} posted on GitHub`);
  if (documented.length || merged.length) done.push(`Knowledge: ${[documented.length && `${plural(documented.length, 'ticket')} documented`, merged.length && `${plural(merged.length, 'documentation PR')} merged`].filter(Boolean).join(', ')}${merged.some((e) => /automatically/.test(e.text)) ? ` (${merged.filter((e) => /automatically/.test(e.text)).length} on their own)` : ''}`);
  if (research.length) {
    const faq = research.filter((e) => e.outcome === 'faq');
    done.push(`Researched ${plural(research.length, 'knowledge gap')}: ${faq.length} answered in the FAQ PR, ${research.length - faq.length} a real gap`);
  }
  if (answeredInTeams.length || decisions.length) done.push(`Teams: ${plural(answeredInTeams.length, 'question')} answered${decisions.length ? `, ${plural(decisions.length, 'decision')} carried out (${keysOf(decisions)})` : ''}`);
  if (night?.backlog?.queued) done.push(`Night shift: ${plural(night.backlog.queued, 'backlog ticket')} taken${night.backlog.stopped ? `; stopped: ${night.backlog.stopped}` : ''}`);

  const back = [];
  for (const e of alerts) back.push(`Regression guard: commit ${e.short ?? ''} touches the fix of ${uniq((e.fixes ?? []).map((f) => f.key)).join(', ') || 'an earlier bug'}${e.key ? ` (${e.key})` : ''}`);
  for (const e of knownBack) back.push(`${e.entry}'s regression test fails on main: the known issue may be back${e.key ? ` (seen for ${e.key})` : ''}`);
  for (const f of night?.kbTests?.failed ?? []) back.push(`Night test: ${f.key}'s regression test fails on ${f.project} main`);
  if (night?.lint?.findings) back.push(`Knowledge lint: ${plural(night.lint.findings, 'finding')} on main`);
  for (const e of demoted) back.push(`System 1: ${e.text}`);

  const wait = [];
  const fixPrs = waiting.fixPrs ?? [];
  if (fixPrs.length) wait.push(`${plural(fixPrs.length, 'fix PR')} to review: ${fixPrs.map((p) => `[${p.key ?? `#${p.number}`}](${p.url})${p.ageHours != null ? ` (${p.ageHours < 48 ? `${p.ageHours} h` : `${Math.round(p.ageHours / 24)} days`})` : ''}`).join(', ')}`);
  for (const h of waiting.held ?? []) wait.push(`${link(h.key)} held: ${h.why}`);
  for (const d of waiting.docsPrs ?? []) wait.push(`Documentation PR [#${d.number}](${d.url})${d.key ? ` (${d.key})` : ''}${d.mergesAt ? ` merges itself at ${d.mergesAt} unless a person holds it` : ' waits for a person'}`);
  if (waiting.gaps) wait.push(`${plural(waiting.gaps, 'knowledge gap')} on the Insights tab`);

  const sections = [
    { title: 'Done', lines: done },
    { title: 'Back, or worth a look', lines: back },
    { title: 'Waiting for a person', lines: wait },
  ].filter((s) => s.lines.length);
  const quiet = !done.length && !back.length;
  const day = new Date(b).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const since = new Date(a).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const summary = quiet
    ? `Quiet since ${since}: nothing new${wait.length ? `; ${plural(wait.length, 'thing')} still waiting for a person` : ', and nothing waits for a person'}.`
    : `Since ${since}: ${[uniq([...analyzed, ...triaged].map((e) => e.key)).length && plural(uniq([...analyzed, ...triaged].map((e) => e.key)).length, 'ticket') + ' analysed', fixes.length && plural(fixes.length, 'draft fix PR'), documented.length && `${documented.length} documented`, back.length && plural(back.length, 'alert')].filter(Boolean).join(', ') || 'only upkeep'}. Cost ${money(cost)}.`;
  const counts = { analyzed: analyzed.length, triaged: triaged.length, asked: asked.length, fixes: fixes.length, stopped: stopped.length, reviews: reviews.length, documented: documented.length, docsMerged: merged.length, research: research.length, alerts: back.length, waiting: wait.length, errors: errors.length, costUsd: Math.round(cost * 100) / 100 };
  const title = `Morning digest · ${day}`;
  const markdown = [`# ${title}`, '', summary, '', ...sections.flatMap((s) => [`## ${s.title}`, '', ...s.lines.map((l) => `- ${l}`), '']), errors.length ? `_${plural(errors.length, 'error')} in the log (the dashboard lists them)._` : ''].join('\n').trim() + '\n';
  return { title, summary, sections, counts, quiet, markdown };
}

/** Whether `now` (a Date) is in the window from–to ("20:00"–"07:00" crosses midnight), local time. */
export function inWindow(now, from, to) {
  const m = (s) => {
    const [h, mm] = String(s).split(':').map(Number);
    return h * 60 + (mm || 0);
  };
  const t = now.getHours() * 60 + now.getMinutes();
  const [f, e] = [m(from), m(to)];
  return f <= e ? t >= f && t < e : t >= f || t < e;
}

/** The night a moment belongs to: the date the window started (a time after midnight belongs to the day before). */
export function nightOf(now, from) {
  const [h, mm] = String(from).split(':').map(Number);
  const d = new Date(now);
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + (mm || 0)) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Whether the digest is due: from `at` ("08:00") to `lateHours` after it, on a working day (Mon–Fri unless `weekends`),
 * not yet sent today. A watcher started in the afternoon sends none that day.
 */
export function digestDue(now, at, lastDate, { weekends = false, lateHours = 4 } = {}) {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (lastDate === day) return false;
  if (!weekends && (now.getDay() === 0 || now.getDay() === 6)) return false;
  const [h, mm] = String(at).split(':').map(Number);
  const t = now.getHours() * 60 + now.getMinutes();
  return t >= h * 60 + (mm || 0) && t < h * 60 + (mm || 0) + lateHours * 60;
}
