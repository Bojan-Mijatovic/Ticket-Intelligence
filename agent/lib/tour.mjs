// The recorded run the dashboard's guided tour replays when no ticket has been analyzed since the last reset: the best
// complete run of one ticket (analysis, reproduction, fix, pull request, review) from the event logs, the archived
// ones included (state/events-*.jsonl). Plain code, read-only.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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

/** The best run (the newest of equals), or null. With `prefer` (a ticket key), only that ticket's runs, if it has one. */
export function bestRun(events, prefer = null) {
  let best = null;
  let bestScore = -Infinity;
  const runs = runsOf(events);
  const mine = prefer ? runs.filter((r) => r.key === prefer && scoreRun(r) > -Infinity) : [];
  for (const run of mine.length ? mine : runs) {
    const s = scoreRun(run);
    if (s > -Infinity && s >= bestScore) {
      best = run;
      bestScore = s;
    }
  }
  return best ? { key: best.key, recordedAt: best.events.find((e) => e.type === 'picked')?.at ?? best.events[0].at, events: best.events } : null;
}

/** The best recorded run in the event logs of `stateDir` (current and archived); `prefer`: the ticket to show, if recorded. */
export function recordedRun(stateDir, prefer = null) {
  let files = [];
  try {
    files = readdirSync(stateDir).filter((f) => /^events.*\.jsonl$/.test(f));
  } catch {
    return null;
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
  events.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return bestRun(events, prefer);
}
