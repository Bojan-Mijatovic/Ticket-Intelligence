// What the dashboard's guided tour replays, so that the demo shows the agent at work without starting (and paying for)
// a run: recorded runs of tickets from the event logs, the archived ones included (state/events-*.jsonl), and recorded
// Ask answers (state/ask/<time>/). Plain code, read-only.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeTool } from './analyze.mjs';
import { keywords } from './ask.mjs';
import { parseKnowledgeFile } from './knowledge.mjs';
import { askReporterText, triageComment } from './system1.mjs';

// What makes a run worth showing: the more of the flow it went through, the better; a failure counts against it.
const SCORE = { notified: 1, draft: 1, reproduced: 2, verified: 2, 'fix-proposed': 4, reviewed: 3, documented: 2, 'fix-failed': -6, failed: -10 };

/** Splits events into runs: one ticket, from its queued/picked event up to the next time it is picked again. */
export function runsOf(events) {
  const runs = [];
  const open = new Map();
  for (const e of events) {
    if (!e?.key || !e.type) continue;
    let run = open.get(e.key);
    if (run && (e.type === 'queued' || e.type === 'picked') && run.events.some((x) => x.type === 'picked')) run = null;
    if (!run) {
      run = { key: e.key, events: [] };
      open.set(e.key, run);
      runs.push(run);
    }
    run.events.push(e);
  }
  return runs;
}

/** A run's score; a run without a pick and an analysis cannot be shown at all. */
export function scoreRun(run) {
  const types = new Set(run.events.map((e) => e.type));
  if (!types.has('picked') || !types.has('analyzed')) return -Infinity;
  return [...types].reduce((s, t) => s + (SCORE[t] ?? 0), 0);
}

const shape = (run) => ({ key: run.key, recordedAt: run.events.find((e) => e.type === 'picked')?.at ?? run.events[0].at, events: run.events });

/** The best run (the newest of equals), or null. With `prefer` (a ticket key), only that ticket's runs, if it has one. */
export function bestRun(events, prefer = null) {
  return bestRuns(events, prefer ? [prefer] : [])[0] ?? null;
}

/**
 * The runs to replay: the best run of each ticket in `prefer`, in that order (tickets never recorded are left out);
 * when none of them was recorded, the single best run of all.
 */
export function bestRuns(events, prefer = []) {
  const runs = runsOf(events).filter((r) => scoreRun(r) > -Infinity);
  const best = (list) => list.reduce((a, r) => (!a || scoreRun(r) >= scoreRun(a) ? r : a), null);
  const chosen = prefer.map((k) => best(runs.filter((r) => r.key === k))).filter(Boolean);
  if (chosen.length) return chosen.map(shape);
  const top = best(runs);
  return top ? [shape(top)] : [];
}

export function readEvents(stateDir) {
  let files = [];
  try {
    files = readdirSync(stateDir).filter((f) => /^events.*\.jsonl$/.test(f));
  } catch {
    return [];
  }
  const events = [];
  for (const f of files) {
    for (const line of readFileSync(join(stateDir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        /* a half-written line */
      }
    }
  }
  return events.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/** The best recorded run in the event logs of `stateDir` (current and archived); `prefer`: the ticket to show, if recorded. */
export function recordedRun(stateDir, prefer = null) {
  return bestRun(readEvents(stateDir), prefer);
}

/** The recorded runs of the tickets in `prefer` (a key or a list of keys), or the best run when none was recorded. */
export function recordedRuns(stateDir, prefer = []) {
  return bestRuns(readEvents(stateDir), [prefer].flat().filter(Boolean));
}

/**
 * System 1's chapter (docs/SYSTEM1_PLAN.md, J9): for each ticket, its newest run in which System 1 answered and an
 * analysis followed, so the tour shows both on one card. Tickets without such a run are left out.
 */
export function system1Runs(stateDir, keys = []) {
  const runs = runsOf(readEvents(stateDir));
  const has = (r, type) => r.events.some((e) => e.type === type);
  return keys.map((k) => runs.filter((r) => r.key === k && has(r, 'system1') && has(r, 'analyzed')).at(-1)).filter(Boolean).map(shape);
}

/**
 * The privacy moment of the chapter: a ticket's latest System 1 answer that would hold it (J6), and what the analysis
 * of that ticket then said, sent to the cloud model because the check was in shadow. Null when there is none.
 */
export function system1Privacy(stateDir, key) {
  const evs = readEvents(stateDir).filter((e) => e.key === key);
  const s1 = evs.filter((e) => e.type === 'system1' && e.privacy?.hold).at(-1);
  if (!s1) return null;
  const analyzed = evs.filter((e) => e.type === 'analyzed').at(-1);
  return { key, p: s1.privacy.p, mode: s1.privacy.mode, summary: analyzed?.result?.summary ?? null, costUsd: analyzed?.meta?.costUsd ?? null, commented: evs.some((e) => e.type === 'commented') };
}

const readJson = (file, fallback) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

/** One recorded Ask answer, with the progress steps the dashboard showed while it ran (rebuilt from what was saved). */
export function recordedAsk(dir) {
  const a = readJson(join(dir, 'answer.json'), null);
  if (!a) return null;
  const words = keywords(a.question);
  const steps = [
    'collecting tickets, analyses and history',
    `${readJson(join(dir, 'tickets.json'), []).length} tickets, ${readJson(join(dir, 'analyses.json'), []).length} analyses, git history${words.length ? ` · search: ${words.join(', ')}` : ''}`,
  ];
  const transcript = join(dir, 'transcript.jsonl');
  if (existsSync(transcript)) {
    for (const line of readFileSync(transcript, 'utf8').split('\n')) {
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (e.type !== 'assistant') continue;
      for (const part of e.message?.content ?? []) if (part.type === 'tool_use') steps.push(describeTool(part.name, part.input));
    }
  }
  return { ...a, steps };
}

/**
 * Two recorded Ask answers for the tour: one answered from sources (the first of `examples` that was asked, else the
 * newest one with at least three sources) and one "not in the knowledge base" (the newest). Either may be missing.
 */
export function recordedAsks(stateDir, examples = []) {
  const root = join(stateDir, 'ask');
  let dirs = [];
  try {
    dirs = readdirSync(root).sort().reverse();
  } catch {
    return [];
  }
  const all = dirs.map((d) => ({ dir: join(root, d), a: readJson(join(root, d, 'answer.json'), null) })).filter((x) => x.a?.question);
  const same = (x, q) => x.a.question.trim().toLowerCase() === String(q).trim().toLowerCase();
  const found = examples.map((q) => all.find((x) => x.a.found && same(x, q))).find(Boolean)
    ?? all.find((x) => x.a.found && (x.a.sources?.length ?? 0) >= 3)
    ?? all.find((x) => x.a.found);
  const notFound = all.find((x) => !x.a.found);
  return [found, notFound].filter(Boolean).map((x) => recordedAsk(x.dir)).filter(Boolean);
}

// ------------------------------------------------------------------ the presentation's facts (docs/PRESENTATION_PLAN.md)

const secsBetween = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 1000) : null);
const cents2 = (x) => Math.round(x * 100) / 100;
const costOf = (evs) => cents2(evs.reduce((s, e) => s + (Number(e.meta?.costUsd) || 0), 0));
const firstSentence = (s) => (String(s ?? '').replace(/\s+/g, ' ').trim().match(/^.+?[.!?](?=\s|$)/)?.[0] ?? String(s ?? '').trim());
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A report as the reporter wrote it, from its masked text and the identifiers the pilot quoted in it (synthetic
 * patients only): each placeholder of a kind gets that kind's identifiers in order. A person's placeholder takes the
 * whole name when the masking left the first name after it ("[PERSON_1] Laura" → "De Luca Laura"). Null without
 * identifiers.
 */
export function unmask(text, identifiers = []) {
  if (!text || !identifiers.length) return null;
  let out = String(text);
  const n = {};
  for (const id of identifiers) {
    const kind = id.kind === 'NAME' ? 'PERSON' : id.kind;
    n[kind] = (n[kind] ?? 0) + 1;
    const ph = `[${kind}_${n[kind]}]`;
    if (kind === 'PERSON') {
      const last = String(id.value).split(/\s+/).at(-1);
      out = out.replace(new RegExp(`${escapeRe(ph)}(\\s+${escapeRe(last)}\\b)?`), id.value);
    } else out = out.replace(ph, id.value);
  }
  return out;
}

/** The entry of `key` in the knowledge base of a repository (docs/knowledge/*.md, as checked out): title, test, cause. */
export function knowledgeEntry(repoDir, key) {
  if (!repoDir) return null;
  const dir = join(repoDir, 'docs', 'knowledge');
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md');
  } catch {
    return null;
  }
  for (const f of files) {
    const e = parseKnowledgeFile(readFileSync(join(dir, f), 'utf8'), `docs/knowledge/${f}`).entries.find((x) => x.key === key && !x.reference);
    if (e) {
      const cause = e.fields['Root cause'] ?? '';
      return { file: `docs/knowledge/${f}`, title: e.title, test: e.fields.Test ?? null, confirmed: /\*\*confirmed\*\*/i.test(cause), assumed: /\*\*assumed\*\*/i.test(e.text), fields: Object.keys(e.fields) };
    }
  }
  return null;
}

/**
 * Everything the presentation shows as a number or a quote, read from the agent's own records: the event logs, the
 * saved work of a ticket, the pilot's records, the Teams answers, the latest digest, System 1's current model. Plain
 * code, read-only; a fact that is not in the records is null, and the slide says less.
 * @param {object} o
 * @param {string} o.stateDir       the watcher's state (events*.jsonl, digests/, system1/)
 * @param {object} o.pres           agent.config.json "presentation": case, system1 (keys), catches { cross, guard, review }
 * @param {(key: string) => string|null} o.stateDirOf  a ticket's project state
 * @param {(key: string) => string|null} o.repoDirOf   a ticket's project repository
 * @param {object} [o.nightShift]   agent.config.json "nightShift"
 * @param {object} [o.policy]       policy.json (only the number of its actions is shown)
 * @param {object[]} [o.events]     the events, when already read
 */
/**
 * A commit as a developer sees it, for the presentation's "a developer's change" (read-only): its message, its date
 * and the lines it changed in `file` (at most six, removed then added, trimmed). Null when git cannot say.
 */
export function commitChange(repoDir, commit, file = null) {
  if (!repoDir || !commit || !existsSync(repoDir)) return null;
  try {
    const out = execFileSync('git', ['show', '--unified=0', '--format=%s%n%aI', commit, ...(file ? ['--', file] : [])],
      { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000, windowsHide: true });
    const [message = '', date = '', ...rest] = out.split('\n');
    const lines = rest.filter((l) => /^[-+]/.test(l) && !/^(---|\+\+\+)\s/.test(l)).map((l) => ({ kind: l[0] === '+' ? 'add' : 'del', text: l.slice(1).trim() })).filter((l) => l.text).slice(0, 6);
    const at = rest.find((l) => l.startsWith('@@'))?.match(/\+(\d+)/)?.[1];
    return { message: message.trim(), date: date.trim() || null, file, line: at ? Number(at) : null, lines };
  } catch { return null; }
}

export function presentationFacts({ stateDir, pres = {}, stateDirOf = () => null, repoDirOf = () => null, nightShift = null, policy = null, events = null }) {
  const all = events ?? readEvents(stateDir);
  const byKey = (k) => all.filter((e) => e.key === k);
  const safe = (fn) => { try { return fn(); } catch { return null; } };

  // Every analysis with its cost and time (each event once, also when an archived log repeats it).
  const seen = new Map();
  for (const e of all) if (e.type === 'analyzed' && e.meta?.costUsd != null) seen.set(`${e.key}|${e.at}`, e.meta);
  const metas = [...seen.values()];
  const timed = metas.filter((m) => m.durationMs);
  const analyses = metas.length ? { n: metas.length, avgCostUsd: cents2(metas.reduce((s, m) => s + m.costUsd, 0) / metas.length), avgSecs: timed.length ? Math.round(timed.reduce((s, m) => s + m.durationMs, 0) / timed.length / 1000) : null } : null;

  const pilotRuns = (key) => (stateDirOf(key) ? readJson(join(stateDirOf(key), 'pilot', 'state.json'), {}).runs ?? [] : []);

  function caseFacts(key) {
    const run = bestRun(all, key);
    if (!run || run.key !== key) return null;
    const evs = run.events;
    const first = (type) => evs.find((e) => e.type === type);
    const dir = stateDirOf(key);
    const bundle = dir ? readJson(join(dir, 'work', key, `ticket-${key}.json`), null)?.target ?? null : null;
    const pilot = pilotRuns(key).find((r) => r.ticket === key) ?? null;
    const reportedAt = pilot?.reportedAt ?? bundle?.created ?? first('queued')?.at;
    const at = (type) => secsBetween(reportedAt, first(type)?.at);
    const analyzed = first('analyzed');
    const r = analyzed?.result ?? null;
    const reviewed = first('reviewed');
    // The merge commit of the fix on main is the guard's commit that starts with the ticket's key.
    // Guard events carry the commit, not always the ticket: they are found by the commit's message and hash.
    const merge = all.find((e) => e.type === 'guard' && e.at > (first('fix-proposed')?.at ?? '') && new RegExp(`"${escapeRe(key)}:`).test(String(e.text)));
    const breakGuard = pilot?.short ? all.find((e) => e.type === 'guard' && (e.short === pilot.short || String(e.text).startsWith(`regression guard: ${pilot.short} `))) : null;
    const desc = String(bundle?.description ?? '').split(/\n\s*\n/)[0].trim();
    return {
      key,
      title: bundle?.summary ?? first('queued')?.text ?? null,
      priority: bundle?.priority ?? null,
      reportedAt,
      report: desc ? { masked: desc, original: unmask(desc, pilot?.identifiers ?? []), quoted: pilot?.redaction?.quoted ?? null, maskedCount: pilot?.redaction?.masked ?? null } : null,
      breaking: pilot ? { story: pilot.story, commit: pilot.short, author: pilot.author, checks: pilot.checks ?? null, guard: breakGuard?.text ?? null,
        // The change itself, in the file the analysis names (the developer's diff, as git shows it).
        change: safe(() => commitChange(repoDirOf(key), pilot.short, String((r?.files ?? [])[0] ?? '').split(':')[0] || null)) } : null,
      t: {
        picked: at('picked'), analyzed: at('analyzed'), notified: at('notified'), reproduced: at('reproduced'), bisected: at('bisected'),
        verified: at('verified'), pr: at('pr'), fixNotified: at('fix-notified'), reviewed: at('reviewed'),
        merged: merge ? secsBetween(reportedAt, merge.at) : null, resolved: at('resolved'), documented: at('documented'), docsMerged: at('docs-merged'),
        analysis: secsBetween(first('picked')?.at, analyzed?.at),
      },
      system1: first('system1') ? { answers: first('system1').answers ?? null, ms: first('system1').ms ?? null } : null,
      analysis: r ? { confidence: r.confidence ?? null, owner: r.owner ?? null, cause: firstSentence(String(r.likelyCause ?? '').replace(/^Hypothesis,[^.]*\.\s*/, '')), file: (r.files ?? [])[0] ?? null } : null,
      priorArt: first('prior-art')?.priorArt ?? r?.priorArt ?? null,
      reproduced: first('reproduced')?.text ?? null,
      bisected: first('bisected')?.text ?? null,
      verified: first('verified')?.text ?? null,
      prUrl: first('fix-proposed')?.url ?? first('pr')?.url ?? null,
      cards: { owner: first('notified')?.card ?? null, fix: first('fix-notified')?.card ?? null },
      review: reviewed?.review ? { risk: reviewed.review.risk, verdict: reviewed.review.verdict, findings: reviewed.review.findings?.length ?? 0, finding: reviewed.review.findings?.[0]?.comment ?? null } : null,
      docs: { url: first('documented')?.url ?? null, mergedUrl: first('docs-merged')?.url ?? null, entry: safe(() => knowledgeEntry(repoDirOf(key), key)) },
      merge: merge ? { text: merge.text } : null,
      costUsd: costOf(evs),
    };
  }

  /** The answer the agent gave in Teams to a ticket key alone, and how long the thread waited for it. */
  function teamsAnswer(key) {
    const dir = stateDirOf(key);
    if (!dir) return null;
    let rec = null;
    try {
      for (const line of readFileSync(join(dir, 'asks.jsonl'), 'utf8').split('\n')) {
        if (!line.trim()) continue;
        const a = JSON.parse(line);
        if (a.origin === 'teams' && String(a.question ?? '').trim().toUpperCase() === key) rec = a;
      }
    } catch {
      return null;
    }
    if (!rec) return null;
    const asked = all.filter((e) => e.type === 'teams-asked' && new RegExp(`: ${escapeRe(key)}$`).test(String(e.text))).at(-1);
    const answered = asked ? all.find((e) => e.type === 'teams-answered' && e.at >= asked.at && String(e.text).endsWith(`: ${key}`)) : null;
    return { question: `ti: ${key}`, answer: String(rec.answer ?? ''), at: rec.at ?? null, via: rec.via ?? null, costUsd: rec.meta?.costUsd ?? 0, secs: asked && answered ? secsBetween(asked.at, answered.at) : null };
  }

  /** A System 1 decision on a real ticket: the question to the reporter, or the light path, and what followed. */
  function system1Case(key) {
    const evs = byKey(key);
    const queued = evs.find((e) => e.type === 'queued');
    const s1 = evs.find((e) => e.type === 'system1');
    if (!queued || !s1) return null;
    const title = String(queued.text ?? '');
    const held = evs.find((e) => e.type === 'system1-held');
    const triaged = evs.find((e) => e.type === 'triaged');
    const pickBefore = triaged ? evs.filter((e) => e.type === 'picked' && e.at <= triaged.at).at(-1) : null;
    const replied = evs.find((e) => e.type === 'reporter-answered');
    const after = replied ? evs.filter((e) => e.at >= replied.at) : [];
    const dup = after.find((e) => e.type === 'duplicate');
    const analyzedAfter = after.find((e) => e.type === 'analyzed');
    const a = s1.answers ?? {};
    // The question's language comes from the whole report, as when it was posted (watcher: askReporterText(a.text)).
    const desc = stateDirOf(key) ? readJson(join(stateDirOf(key), 'work', key, `ticket-${key}.json`), null)?.target?.description ?? '' : '';
    const pick = (x) => (x ? { choice: x.choice, p: x.p } : null);
    return {
      key, title, report: String(desc).split(/\n\s*\n/)[0].trim() || null,
      answers: { type: pick(a.type), code: pick(a.code), side: pick(a.side), component: pick(a.component) },
      ms: s1.ms ?? null,
      asked: held ? { secs: secsBetween(queued.at, held.at), text: askReporterText({ missing: s1.missing ?? [], text: `${title}\n\n${desc}` }) } : null,
      lightPath: triaged ? { secs: secsBetween(pickBefore?.at, triaged.at), comment: triageComment(a, 'System 1 triage', { watch: true }).replace(/\*/g, '') } : null,
      replied: replied ? { secs: secsBetween(held?.at ?? triaged?.at ?? queued.at, replied.at), analysed: Boolean(analyzedAfter), duplicateOf: dup?.of ?? null } : null,
    };
  }

  /** What it caught that people missed: a cause in another app, a cheated test, a fix sent back by the AI review. */
  function catches(c = {}) {
    const out = {};
    if (c.cross) {
      const run = bestRun(all, c.cross);
      if (run?.key === c.cross) {
        const f = (t) => run.events.find((e) => e.type === t);
        out.cross = {
          key: c.cross, title: f('queued')?.text ?? f('picked')?.text ?? null, why: f('cross-project')?.text ?? null,
          projects: f('cross-project')?.projects ?? null, found: secsBetween(f('picked')?.at, f('cross-project')?.at ?? f('analyzed')?.at),
          fixed: secsBetween(f('picked')?.at, f('fix-proposed')?.at), reproduced: firstSentence(f('reproduced')?.text ?? ''), costUsd: costOf(run.events),
        };
      }
    }
    if (c.guard) {
      const alert = all.find((e) => e.type === 'guard' && e.key === c.guard && (e.verdict === 'alert' || /\bFAILS\b/.test(String(e.text))));
      const pilot = pilotRuns(c.guard).find((r) => r.story === c.guard) ?? null;
      if (alert) {
        out.guard = {
          key: c.guard, commit: alert.short ?? null, fixes: alert.fixes ?? null, ticket: pilot?.ticket ?? null,
          minutes: pilot ? Math.round((Date.parse(alert.at) - Date.parse(pilot.plantedAt)) / 6000) / 10 : null,
          hoursBefore: pilot?.reportedAt ? Math.round((Date.parse(pilot.reportedAt) - Date.parse(alert.at)) / 3600000) : null,
          text: firstSentence(alert.text),
        };
      }
    }
    if (c.review) {
      const rev = all.find((e) => e.type === 'reviewed' && e.key === c.review && e.review?.verdict && e.review.verdict !== 'looks-good');
      if (rev) out.review = { key: c.review, risk: rev.review.risk, verdict: rev.review.verdict, summary: String(rev.review.summary ?? ''), title: byKey(c.review).find((e) => e.type === 'queued' || e.type === 'picked')?.text ?? null };
    }
    if (c.copies) out.copies = { key: c.copies };
    return out;
  }

  // The latest morning digest, and System 1's current model with what changed against the one it replaced.
  let digest = null;
  try {
    const f = readdirSync(join(stateDir, 'digests')).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort().at(-1);
    if (f) { const d = readJson(join(stateDir, 'digests', f), null); if (d) digest = { date: f.slice(0, 10), at: d.at ?? null, summary: d.summary, sections: d.sections ?? [], counts: d.counts ?? {} }; }
  } catch { /* no digest yet */ }
  const cur = readJson(join(stateDir, 'system1', 'models', 'current.json'), null);
  const model = cur ? {
    name: cur.name, replaced: cur.replaced ?? null, at: cur.at ?? null,
    questions: Object.keys(readJson(join(stateDir, 'system1', 'models', cur.name, 'questions.json'), {})).length || null,
    changes: (cur.why ?? []).map((w) => String(w).match(/^([\w/]+): (\d+) % \(current (\d+) %\)$/)).filter(Boolean).map((m) => ({ question: m[1], now: Number(m[2]), before: Number(m[3]) })),
    lightPath: (cur.why ?? []).find((w) => /^light path/.test(w)) ?? null,
  } : null;

  const caseKey = pres.case ?? null;
  return {
    case: caseKey ? safe(() => caseFacts(caseKey)) : null,
    teams: caseKey ? { answer: safe(() => teamsAnswer(caseKey)), decisions: byKey(caseKey).filter((e) => ['approved', 'rejected', 'taken', 'handed-on'].includes(e.type)).map((e) => ({ type: e.type, at: e.at, text: e.text })) } : null,
    live: pres.live ?? null,
    system1: (pres.system1 ?? []).map((k) => safe(() => system1Case(k))).filter(Boolean),
    model,
    catches: safe(() => catches(pres.catches ?? {})) ?? {},
    digest,
    pilot: caseKey && stateDirOf(caseKey) ? readJson(join(stateDirOf(caseKey), 'pilot', 'score.json'), null)?.summary ?? null : null,
    analyses,
    nightShift: nightShift ? { maxCostUsd: nightShift.maxCostUsd ?? null, maxTickets: nightShift.maxTickets ?? null, digestAt: nightShift.digestAt ?? null } : null,
    policy: policy?.actions ? { actions: Object.keys(policy.actions).length, system1: Object.entries(policy.system1 ?? {}).filter(([k, v]) => !k.startsWith('_') && ['auto', 'shadow', 'draft', 'off'].includes(v)).map(([k, v]) => ({ key: k, mode: v })) } : null,
  };
}
