// What the dashboard's guided tour replays, so that the demo shows the agent at work without starting (and paying for)
// a run: recorded runs of tickets from the event logs, the archived ones included (state/events-*.jsonl), and recorded
// Ask answers (state/ask/<time>/). Plain code, read-only.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeTool } from './analyze.mjs';
import { keywords } from './ask.mjs';

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

function readEvents(stateDir) {
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
