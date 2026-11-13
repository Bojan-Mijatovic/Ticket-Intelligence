import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, Route } from '@playwright/test';

// Mocked MediVax backend for browser tests. Data mirrors the Flyway seed (api-data.json, synthetic patients); rules
// mirror the backend (PatientService, DoseService, Schedule, DueService). Every call the frontend makes is recorded.

const data = JSON.parse(readFileSync(join(__dirname, 'api-data.json'), 'utf8'));

type Json = Record<string, any>;

export interface ApiLog {
  /** q of every GET /api/patients */
  searches: string[];
  /** bodies of POST /api/doses */
  doseRequests: Json[];
  /** { from, to } of every GET /api/due */
  dueRequests: { from: string; to: string }[];
}

const error = (route: Route, status: number, detail: string) => route.fulfill({ status, json: { status, error: status === 409 ? 'CONFLICT' : status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', details: [detail] } });

const parse = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
};
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export const plusDays = (day: string, n: number) => {
  const { y, m, d } = parse(day);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
};
/** As java.time's plusMonths: the day is kept, or moved back to the last day of a shorter month. */
export const plusMonths = (day: string, n: number) => {
  const { y, m, d } = parse(day);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return iso(first.getUTCFullYear(), first.getUTCMonth() + 1, Math.min(d, last));
};
const months = (birth: string, on: string) => {
  const b = parse(birth);
  const o = parse(on);
  return (o.y - b.y) * 12 + (o.m - b.m) - (o.d < b.d ? 1 : 0);
};
const years = (birth: string, on: string) => Math.floor(months(birth, on) / 12);
const italian = (day: string) => day.split('-').reverse().join('/');

/** The next dose of a vaccine after the doses given (Schedule.next). */
export function nextDose(v: Json, given: Json[]): Json | null {
  if (!given.length) return null;
  const last = [...given].sort((a, b) => a.givenOn.localeCompare(b.givenOn) || a.doseNumber - b.doseNumber).at(-1)!;
  const count = Math.max(...given.map((g) => g.doseNumber));
  if (count < v.doses) return { vaccineCode: v.code, vaccineName: v.name, doseNumber: count + 1, dueOn: plusDays(last.givenOn, v.intervalDays), booster: false };
  if (v.boosterMonths !== null) return { vaccineCode: v.code, vaccineName: v.name, doseNumber: count + 1, dueOn: plusMonths(last.givenOn, v.boosterMonths), booster: true };
  return null;
}

export async function mockApi(page: Page): Promise<ApiLog> {
  const log: ApiLog = { searches: [], doseRequests: [], dueRequests: [] };
  const doses: Json[] = structuredClone(data.doses);
  const lots: Json[] = structuredClone(data.lots);
  let nextId = 1000;
  const vaccine = (code: string) => data.vaccines.find((v: Json) => v.code === code);
  const nextDoses = (patientId: number) => {
    const mine = doses.filter((d) => d.patientId === patientId);
    return [...new Set(mine.map((d) => d.vaccineCode))]
      .map((code) => nextDose(vaccine(code), mine.filter((d) => d.vaccineCode === code)))
      .filter(Boolean)
      .sort((a: Json, b: Json) => a.dueOn.localeCompare(b.dueOn) || a.vaccineCode.localeCompare(b.vaccineCode)) as Json[];
  };
  const view = (d: Json) => ({ id: d.id, vaccineCode: d.vaccineCode, vaccineName: vaccine(d.vaccineCode).name, doseNumber: d.doseNumber, givenOn: d.givenOn, lotCode: d.lotCode });

  await page.route(/\/api\/patients(\/\d+(\/card)?)?(\?|$)/, (route) => {
    const url = new URL(route.request().url());
    const [, id, card] = url.pathname.match(/^\/api\/patients(?:\/(\d+))?(\/card)?$/) ?? [];
    if (!id) {
      const q = (url.searchParams.get('q') ?? '').trim();
      log.searches.push(q);
      if (q.length < 2) return route.fulfill({ json: [] });
      const lower = q.toLowerCase();
      return route.fulfill({ json: data.patients.filter((p: Json) => p.lastName.toLowerCase().startsWith(lower) || p.fiscalCode.toLowerCase().startsWith(lower)).sort((a: Json, b: Json) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)) });
    }
    const p = data.patients.find((x: Json) => x.id === Number(id));
    if (!p) return error(route, 404, `Patient ${id} not found`);
    if (!card) return route.fulfill({ json: p });
    const mine = doses.filter((d) => d.patientId === p.id).sort((a, b) => a.givenOn.localeCompare(b.givenOn) || a.id - b.id);
    return route.fulfill({ json: { patient: p, doses: mine.map(view), next: nextDoses(p.id) } });
  });

  await page.route(/\/api\/vaccines$/, (route) => route.fulfill({ json: [...data.vaccines].sort((a: Json, b: Json) => a.name.localeCompare(b.name)) }));
  await page.route(/\/api\/lots(\?|$)/, (route) => {
    const code = new URL(route.request().url()).searchParams.get('vaccine') ?? '';
    return route.fulfill({ json: lots.filter((l) => l.vaccineCode === code).sort((a, b) => a.expiry.localeCompare(b.expiry)) });
  });

  await page.route(/\/api\/doses$/, (route) => {
    const body = route.request().postDataJSON() ?? {};
    log.doseRequests.push(body);
    const p = data.patients.find((x: Json) => x.id === body.patientId);
    if (!p) return error(route, 404, `Patient ${body.patientId} not found`);
    const v = vaccine(body.vaccineCode);
    if (!v) return error(route, 400, `vaccineCode: unknown vaccine ${body.vaccineCode}`);
    const lot = lots.find((l) => l.code === body.lotCode);
    if (!lot) return error(route, 400, `lotCode: unknown lot ${body.lotCode}`);
    if (lot.vaccineCode !== v.code) return error(route, 400, `lotCode: lot ${lot.code} is not a lot of ${v.code}`);
    if (lot.expiry < body.givenOn) return error(route, 409, `lotCode: lot ${lot.code} expired on ${italian(lot.expiry)}`);
    if (lot.dosesLeft <= 0) return error(route, 409, `lotCode: lot ${lot.code} has no doses left`);
    const m = months(p.birthDate, body.givenOn);
    if (m < v.minAgeMonths) return error(route, 409, `age: ${v.code} is given from ${v.minAgeMonths} months, the patient is ${m} months old`);
    const y = years(p.birthDate, body.givenOn);
    if (v.maxAgeYears !== null && y > v.maxAgeYears) return error(route, 409, `age: ${v.code} is given up to ${v.maxAgeYears} years, the patient is ${y}`);
    const given = doses.filter((d) => d.patientId === p.id && d.vaccineCode === v.code);
    let number = 1;
    if (given.length) {
      const next = nextDose(v, given);
      if (!next) return error(route, 409, `vaccineCode: the series of ${v.code} is complete`);
      if (body.givenOn < next.dueOn) return error(route, 409, `givenOn: dose ${next.doseNumber} of ${v.code} not before ${italian(next.dueOn)}`);
      number = next.doseNumber;
    }
    const d = { id: nextId++, patientId: p.id, vaccineCode: v.code, doseNumber: number, givenOn: body.givenOn, lotCode: lot.code };
    doses.push(d);
    lot.dosesLeft--;
    return route.fulfill({ status: 201, json: view(d) });
  });

  await page.route(/\/api\/due(\?|$)/, (route) => {
    const url = new URL(route.request().url());
    const from = url.searchParams.get('from') ?? '';
    const to = url.searchParams.get('to') ?? '';
    log.dueRequests.push({ from, to });
    if (to < from) return error(route, 400, 'to: before from');
    const rows: Json[] = [];
    for (const p of data.patients) {
      for (const n of nextDoses(p.id)) {
        if (n.dueOn >= from && n.dueOn <= to) rows.push({ patientId: p.id, patientName: `${p.lastName} ${p.firstName}`, fiscalCode: p.fiscalCode, phone: p.phone, ...n });
      }
    }
    return route.fulfill({ json: rows.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.patientName.localeCompare(b.patientName)) });
  });

  return log;
}
