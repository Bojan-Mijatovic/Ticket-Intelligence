import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, Route } from '@playwright/test';

// Mocked MediFarma backend for browser tests. Data mirrors the Flyway seed (api-data.json); rules mirror the backend
// (SafetyService, RenalCheckService, PrescriptionService, DispensingService). The kidney function of a patient is
// what the backend computes from MediLab (api-data.json "kidney"). Every call the frontend makes is recorded.

const data = JSON.parse(readFileSync(join(__dirname, 'api-data.json'), 'utf8'));

type Json = Record<string, any>;

export interface ApiLog {
  /** status filter of every GET /api/prescriptions ('' = all) */
  prescriptionListRequests: string[];
  /** bodies of POST /api/safety/check */
  safetyChecks: { patientId: number; aics: string[] }[];
  /** bodies of POST /api/prescriptions */
  prescriptionWrites: Json[];
  /** id of every POST /api/prescriptions/{id}/dispense */
  dispenseRequests: string[];
  /** id of every POST /api/prescriptions/{id}/cancel */
  cancellations: string[];
  /** days of every GET /api/stock/expiring */
  expiringRequests: number[];
}

const today = () => new Date().toISOString().slice(0, 10);
const error = (route: Route, status: number, detail: string) =>
  route.fulfill({ status, json: { status, error: status === 404 ? 'NOT_FOUND' : status === 409 ? 'CONFLICT' : 'VALIDATION_ERROR', details: [detail] } });

export async function mockApi(page: Page, options: { slowDispense?: number } = {}): Promise<ApiLog> {
  const log: ApiLog = { prescriptionListRequests: [], safetyChecks: [], prescriptionWrites: [], dispenseRequests: [], cancellations: [], expiringRequests: [] };
  const prescriptions: Json[] = structuredClone(data.prescriptions);
  const lots: Json[] = structuredClone(data.lots);
  const dispensings: Json[] = [];
  const drug = (aic: string): Json => data.drugs.find((d: Json) => d.aic === aic);
  const patient = (id: number): Json => data.patients.find((p: Json) => p.id === id);
  let nextRx = 100;

  const view = (p: Json): Json => {
    const pt = patient(p.patientId);
    return { ...p, fiscalCode: pt.fiscalCode, patientName: `${pt.lastName} ${pt.firstName}`, sex: pt.sex, birthDate: pt.birthDate,
      items: p.items.map((i: Json) => ({ ...i, name: drug(i.aic).name })) };
  };
  const check = (patientId: number, aics: string[]): Json => {
    const pt = patient(patientId);
    const list = aics.map(drug);
    const warnings: Json[] = [];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      for (const r of data.interactions) {
        const [a, b] = [list[i].activeIngredient, list[j].activeIngredient];
        if ((r.a === a && r.b === b) || (r.a === b && r.b === a)) warnings.push({ type: 'INTERAZIONE', severity: r.severity, aic: null, drug: `${list[i].name} + ${list[j].name}`, message: r.note });
      }
    }
    const kidney = data.kidney[String(patientId)];
    if (!kidney) warnings.push({ type: 'INFO', severity: 'INFO', aic: null, drug: null, message: 'Nessuna creatinina validata in MediLab: controllo renale non eseguito.' });
    else for (const d of list) {
      const note = d.renalNote ? `. ${d.renalNote}` : '';
      if (d.renalAvoidBelow !== null && kidney.egfr < d.renalAvoidBelow) warnings.push({ type: 'RENE', severity: 'ALTA', aic: d.aic, drug: d.name, message: `eGFR ${kidney.egfr}: controindicato sotto ${d.renalAvoidBelow}${note}` });
      else if (d.renalReduceBelow !== null && kidney.egfr < d.renalReduceBelow) warnings.push({ type: 'RENE', severity: 'MEDIA', aic: d.aic, drug: d.name, message: `eGFR ${kidney.egfr}: ridurre la dose sotto ${d.renalReduceBelow}${note}` });
    }
    warnings.sort((x, y) => Number(y.severity === 'ALTA') - Number(x.severity === 'ALTA'));
    return { patientId, patientName: `${pt.lastName} ${pt.firstName}`, creatinine: kidney?.creatinine ?? null, creatinineUnit: kidney?.creatinineUnit ?? null,
      creatinineDate: kidney?.creatinineDate ?? null, egfr: kidney?.egfr ?? null, warnings };
  };

  await page.route(/\/api\/mediagenda\/patients(\?|$)/, (route) => {
    const q = (new URL(route.request().url()).searchParams.get('q') ?? '').toLowerCase();
    return route.fulfill({ json: q.length < 2 ? [] : data.patients.filter((p: Json) => p.lastName.toLowerCase().includes(q) || p.fiscalCode.toLowerCase().includes(q)) });
  });

  await page.route(/\/api\/drugs(\?|$)/, (route) => {
    const q = (new URL(route.request().url()).searchParams.get('q') ?? '').toLowerCase();
    return route.fulfill({ json: data.drugs.filter((d: Json) => !q || d.name.toLowerCase().includes(q) || d.activeIngredient.toLowerCase().includes(q)).sort((a: Json, b: Json) => a.name.localeCompare(b.name)) });
  });

  await page.route(/\/api\/stock(\/expiring)?(\?|$)/, (route) => {
    const url = new URL(route.request().url());
    const days = url.pathname.endsWith('/expiring') ? Number(url.searchParams.get('days') ?? 60) : null;
    if (days !== null) log.expiringRequests.push(days);
    const now = today();
    const limit = new Date(Date.now() + (days ?? 0) * 86_400_000).toISOString().slice(0, 10);
    const rows = [...data.drugs].sort((a: Json, b: Json) => a.name.localeCompare(b.name)).map((d: Json) => {
      const own = lots.filter((l) => l.aic === d.aic).sort((a, b) => a.expiry.localeCompare(b.expiry))
        .map((l) => ({ ...l, expired: l.expiry < now, daysLeft: Math.round((Date.parse(l.expiry) - Date.parse(now)) / 86_400_000) }));
      const available = own.filter((l) => !l.expired).reduce((s, l) => s + l.quantity, 0);
      return { aic: d.aic, name: d.name, available, minStock: d.minStock, low: available < d.minStock, lots: days === null ? own : own.filter((l) => l.quantity > 0 && l.expiry <= limit) };
    });
    return route.fulfill({ json: days === null ? rows : rows.filter((r) => r.lots.length) });
  });

  await page.route(/\/api\/safety\/check$/, (route) => {
    const body = route.request().postDataJSON() ?? {};
    log.safetyChecks.push(body);
    return route.fulfill({ json: check(body.patientId, body.aics ?? []) });
  });

  await page.route(/\/api\/prescriptions(\/[^?]*)?(\?|$)/, async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const [, id, action] = url.pathname.match(/^\/api\/prescriptions(?:\/([^/]+))?(?:\/(dispense|dispensings|cancel))?$/) ?? [];
    const p = id ? prescriptions.find((x) => x.id === id) : null;
    if (id && !p) return error(route, 404, `Prescription ${id} not found`);
    if (!id && req.method() === 'GET') {
      const status = url.searchParams.get('status') ?? '';
      log.prescriptionListRequests.push(status);
      return route.fulfill({ json: prescriptions.filter((x) => !status || x.status === status).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)).map(view) });
    }
    if (!id && req.method() === 'POST') {
      const body = req.postDataJSON() ?? {};
      log.prescriptionWrites.push(body);
      const c = check(body.patientId, body.items.map((i: Json) => i.aic));
      const high = c.warnings.filter((w: Json) => w.severity === 'ALTA');
      if (high.length && !body.acknowledgeWarnings) return error(route, 409, `warnings: ${high.length} high warning(s) to acknowledge`);
      const created = { id: `RX-2026-${String(nextRx++).padStart(5, '0')}`, patientId: body.patientId, prescriber: body.prescriber, status: 'EMESSA',
        issuedAt: new Date().toISOString().slice(0, 19), egfr: c.egfr, warningsAcknowledged: high.length > 0, items: body.items };
      prescriptions.push(created);
      return route.fulfill({ status: 201, json: view(created) });
    }
    if (!action) return route.fulfill({ json: view(p!) });
    if (action === 'dispensings') return route.fulfill({ json: dispensings.filter((d) => d.prescriptionId === id) });
    if (action === 'cancel') {
      log.cancellations.push(id!);
      if (p!.status !== 'EMESSA') return error(route, 409, `status: only a prescription EMESSA can be cancelled (${id} is ${p!.status})`);
      p!.status = 'ANNULLATA';
      return route.fulfill({ json: view(p!) });
    }
    log.dispenseRequests.push(id!);
    if (options.slowDispense) await new Promise((r) => setTimeout(r, options.slowDispense));
    if (p!.status !== 'EMESSA') return error(route, 409, `status: prescription ${id} is ${p!.status}, not EMESSA`);
    const lines: Json[] = [];
    for (const item of p!.items) {
      let missing = item.packs;
      for (const lot of lots.filter((l) => l.aic === item.aic && l.expiry >= today() && l.quantity > 0).sort((a, b) => a.expiry.localeCompare(b.expiry))) {
        if (!missing) break;
        const packs = Math.min(missing, lot.quantity);
        lot.quantity -= packs;
        missing -= packs;
        lines.push({ aic: item.aic, name: drug(item.aic).name, lotNumber: lot.lotNumber, expiry: lot.expiry, packs });
      }
      if (missing) return error(route, 409, `stock: not enough packs of ${drug(item.aic).name} (${item.packs - missing} of ${item.packs})`);
    }
    p!.status = 'DISPENSATA';
    const d = { id: dispensings.length + 100, prescriptionId: id, patientName: view(p!).patientName, dispensedAt: new Date().toISOString().slice(0, 19), lines };
    dispensings.push(d);
    return route.fulfill({ json: d });
  });

  return log;
}
