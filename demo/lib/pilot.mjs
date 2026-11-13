// The pilot's plain logic (docs/PILOT.md): what to do now, how to write a ticket's patients, and how a case is scored
// against its answer key. No Jira, no git, no AI here: demo/pilot.mjs does the I/O.

import { codeFiles, compareFiles } from '../../agent/lib/accuracy.mjs';
import { italianDate, rng, syntheticFiscalCode } from './synthetic-patients.mjs';

export const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** A stable number from a text (FNV-1a), for delays and seeds that do not change between runs. */
export function hashOf(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return h;
}

/** Minutes between pushing a case's change and reporting its bug: inside [min, max], fixed per case and run. */
export function reportDelayMinutes(runId, [min, max] = [60, 180]) {
  return min + (hashOf(runId) % (max - min + 1));
}

/**
 * Applies a case's edits to the files of main. Each `from` must occur exactly once (else the case no longer applies).
 * @param {(file: string) => string} read
 * @returns {{ files: Map<string, string>, problems: string[] }}
 */
export function applyEdits(read, edits) {
  const files = new Map();
  const problems = [];
  for (const { file, from, to } of edits) {
    const text = files.get(file) ?? read(file).replace(/\r\n/g, '\n');
    const count = text.split(from).length - 1;
    if (count !== 1) {
      problems.push(`${file}: the text to change occurs ${count} times (expected once): ${from.slice(0, 70)}`);
      continue;
    }
    files.set(file, text.replace(from, () => to));
  }
  return { files, problems };
}

/**
 * What a tick should do now. One case is in flight at a time: a new change is pushed only after the previous bug
 * was reported. Working days only, from the configured hours (local time), up to `perDay` changes a day.
 * @returns {{ plant: object|null, report: object[], why: string }}
 */
export function nextActions({ runs, cases, now = new Date(), cfg = {} }) {
  const { perDay = 2, hours = [10, 15], reportAfterMinutes = [60, 180], lastHour = 18 } = cfg;
  const report = runs.filter((r) => r.status === 'planted' && now - Date.parse(r.plantedAt) >= reportDelayMinutes(r.id, reportAfterMinutes) * 60_000);
  const workday = now.getDay() >= 1 && now.getDay() <= 5;
  const today = localDay(now);
  const plantedToday = runs.filter((r) => r.plantedAt && localDay(new Date(r.plantedAt)) === today).length;
  const inFlight = runs.some((r) => r.status === 'planted');
  // A case is taken once; one the tests caught ("failed") is not retried on every tick (plant --case retries it).
  const used = new Set(runs.map((r) => r.case));
  const next = cases.find((c) => !used.has(c.id)) ?? null;
  let why;
  if (!workday) why = 'not a working day';
  else if (plantedToday >= perDay) why = `${plantedToday} change(s) pushed today already`;
  else if (now.getHours() < (hours[plantedToday] ?? hours.at(-1)) || now.getHours() >= lastHour) why = `next change from ${hours[plantedToday] ?? hours.at(-1)}:00`;
  else if (inFlight) why = 'a case is waiting to be reported';
  else if (!next) why = 'every case of the catalog has been used: add cases to demo/src/medivax/pilot-cases.mjs';
  else return { plant: next, report, why: `push ${next.id}` };
  return { plant: null, report, why };
}

/**
 * The helpers a case's ticket() uses to quote patients, and the identifiers it quoted (for the redaction score).
 * @param {object[]} patients  the seed's synthetic patients (api-data.json)
 * @param {string} day         the report day (ISO)
 */
export function ticketHelpers({ patients, day, seed = 1 }) {
  const identifiers = [];
  const r = rng(seed);
  const digits = (n) => Array.from({ length: n }, () => Math.floor(r() * 10)).join('');
  const quote = (p, { birth = false, phone = false, healthCard = false } = {}) => {
    const name = `${p.lastName} ${p.firstName}`;
    identifiers.push({ kind: 'NAME', value: name }, { kind: 'FISCAL_CODE', value: p.fiscalCode });
    const parts = [`CF ${p.fiscalCode}`];
    if (birth) {
      parts.push(`${p.sex === 'F' ? 'nata' : 'nato'} il ${italianDate(p.birthDate)}`);
      identifiers.push({ kind: 'BIRTH_DATE', value: italianDate(p.birthDate) });
    }
    if (phone && p.phone) {
      parts.push(`tel. ${p.phone}`);
      identifiers.push({ kind: 'PHONE', value: p.phone });
    }
    if (healthCard && p.healthCard) {
      parts.push(`tessera sanitaria ${p.healthCard}`);
      identifiers.push({ kind: 'HEALTH_CARD', value: p.healthCard });
    }
    return `${name} (${parts.join(', ')})`;
  };
  const h = {
    day,
    it: italianDate,
    patient(id, o) {
      const p = patients.find((x) => x.id === id);
      if (!p) throw new Error(`no patient ${id} in the seed`);
      return quote(p, o);
    },
    /** A patient who is not in the seed (registered after it), aged yearsOld + monthsOld on the report day. */
    person({ lastName, firstName, sex, yearsOld, monthsOld = 0, town, birthPlace, phone = false, healthCard = false }) {
      const [y, m, d] = day.split('-').map(Number);
      const b = new Date(y - yearsOld, m - 1 - monthsOld, Math.min(d, 28));
      const birthDate = localDay(b);
      const p = { lastName, firstName, sex, birthDate, birthPlace, fiscalCode: syntheticFiscalCode({ lastName, firstName, birthDate, sex, town }), phone: `3${40 + Math.floor(r() * 50)} ${digits(7)}`, healthCard: `80380${digits(15)}` };
      return quote(p, { birth: true, phone, healthCard });
    },
  };
  return { h, identifiers };
}

/** How many of the identifiers a ticket quoted are gone from its masked text. */
export function redactionScore(maskedText, identifiers) {
  const missed = identifiers.filter((i) => maskedText.includes(i.value));
  return { quoted: identifiers.length, masked: identifiers.length - missed.length, missed };
}

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * A reported case scored against its answer key, from the agent's own records.
 * @param {object} run       the pilot's record: { ticket, sha, short, story, reportedAt }
 * @param {object} answer    the case's { files, owners }
 * @param {object[]} events  the agent's events of that ticket
 * @param {object|null} result  the analysis (state/work/<KEY>/result.json), or the one in the 'analyzed' event
 */
export function scoreRun(run, answer, events, result = null) {
  const mine = run.ticket ? events.filter((e) => e.key === run.ticket).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)) : [];
  const analyzed = mine.find((e) => e.type === 'analyzed');
  const r = result ?? analyzed?.result ?? null;
  const minutes = (e) => (e ? Math.round((Date.parse(e.at) - Date.parse(run.reportedAt)) / 60_000) : null);
  const out = { ticket: run.ticket ?? null, case: run.case, reported: Boolean(run.ticket), analysed: Boolean(r), minutesToAnalysis: minutes(analyzed) };
  if (r) {
    const files = compareFiles(codeFiles(Array.isArray(r.files) ? r.files.map(String) : []), answer.files);
    const text = `${r.likelyCause ?? ''}\n${r.jiraComment ?? ''}\n${r.proposedFix ?? ''}`;
    out.files = { hit: files.hit, named: (r.files ?? []).length };
    out.culpritNamed = Boolean(run.short && (text.includes(run.short) || (run.story && text.includes(run.story))));
    out.owner = { proposed: r.owner?.name ?? null, hit: answer.owners.map(fold).includes(fold(r.owner?.name)) };
    out.priorArt = r.priorArt?.kind ?? 'none';
    out.confidence = r.confidence ?? null;
  }
  const fix = [...mine].reverse().find((e) => ['fix-proposed', 'fix-failed', 'fix-skipped'].includes(e.type));
  out.fix = fix ? { outcome: { 'fix-proposed': 'pr', 'fix-failed': 'stopped', 'fix-skipped': 'not tried' }[fix.type], url: fix.url ?? null, why: fix.type === 'fix-proposed' ? null : String(fix.text ?? '').slice(0, 160), minutes: minutes(fix), filesHit: fix.files ? answer.files.some((f) => fix.files.includes(f)) : null } : null;
  const b = [...mine].reverse().find((e) => e.type === 'bisected')?.bisect;
  out.bisect = b ? { status: b.status, culprit: b.culprit?.short ?? null, exact: Boolean(b.culprit?.sha && run.sha && b.culprit.sha === run.sha), seconds: Math.round((b.durationMs ?? 0) / 1000) } : null;
  // The regression guard (A1) on the case's commit: found by the commit, not the ticket (it comes before the ticket).
  const guard = events.find((e) => e.type === 'guard' && run.sha && e.commit === run.sha);
  out.guard = guard ? { verdict: guard.verdict, beforeReport: !run.reportedAt || Date.parse(guard.at) < Date.parse(run.reportedAt), minutesAfterPush: run.plantedAt ? Math.round((Date.parse(guard.at) - Date.parse(run.plantedAt)) / 60_000) : null } : null;
  out.review = mine.find((e) => e.type === 'reviewed')?.review?.risk ?? null;
  out.costUsd = Math.round(mine.reduce((s, e) => s + (e.meta?.costUsd ?? 0), 0) * 100) / 100;
  return out;
}

/** The pilot's totals over the scored cases, each as { n, of }. */
export function summarize(scores) {
  const of = (list, ok) => ({ n: list.filter(ok).length, of: list.length });
  const analysed = scores.filter((s) => s.analysed);
  const fixes = scores.filter((s) => s.fix);
  const bisects = scores.filter((s) => s.bisect);
  return {
    cases: scores.filter((s) => s.reported !== false).length,
    analysed: analysed.length,
    files: of(analysed, (s) => s.files?.hit),
    culpritNamed: of(analysed, (s) => s.culpritNamed),
    owner: of(analysed, (s) => s.owner?.hit),
    fixPr: of(fixes, (s) => s.fix.outcome === 'pr'),
    bisectExact: of(bisects, (s) => s.bisect.exact),
    // A1: regressions flagged before their ticket; alerts on changes that bring no regression back.
    guardCaught: of(scores.filter((s) => s.regression), (s) => s.guard?.verdict === 'alert' && s.guard.beforeReport),
    guardFalseAlarms: of(scores.filter((s) => !s.regression && s.guard), (s) => s.guard.verdict === 'alert'),
    costUsd: Math.round(scores.reduce((s, x) => s + (x.costUsd ?? 0), 0) * 100) / 100,
  };
}
