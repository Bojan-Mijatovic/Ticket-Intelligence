import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, Route } from '@playwright/test';

// Mocked MediBill backend for browser tests. Data mirrors the Flyway seed (api-data.json); rules mirror the backend
// (ChargeImportService, ReceiptService, ExemptionService, ReportController). Every call the frontend makes is recorded.

const data = JSON.parse(readFileSync(join(__dirname, 'api-data.json'), 'utf8'));

type Json = Record<string, any>;

export interface ApiLog {
  /** date of every POST /api/charges/import */
  imports: string[];
  /** fiscalCode of every POST /api/receipts */
  receiptRequests: string[];
  /** { id, action } of every pay / storno */
  receiptActions: { id: string; action: 'pay' | 'storno' }[];
  /** bodies of POST /api/exemptions */
  exemptionWrites: Json[];
  /** month of every GET /api/reports/monthly */
  reportRequests: string[];
}

const CAP = 36.15;
const cents = (n: number) => Math.round(n * 100) / 100;
const error = (route: Route, status: number, detail: string) => route.fulfill({ status, json: { status, error: status === 409 ? 'CONFLICT' : 'VALIDATION_ERROR', details: [detail] } });

export async function mockApi(page: Page): Promise<ApiLog> {
  const log: ApiLog = { imports: [], receiptRequests: [], receiptActions: [], exemptionWrites: [], reportRequests: [] };
  const charges: Json[] = structuredClone(data.charges);
  const receipts: Json[] = structuredClone(data.receipts);
  const exemptions: Json[] = structuredClone(data.exemptions);
  let nextCharge = 1000;
  let nextReceipt = 100;
  let nextExemption = 100;

  const cover = (c: Json) => exemptions.find((e) => e.fiscalCode === c.fiscalCode && e.validFrom <= c.serviceDate && c.serviceDate <= e.validTo && (e.total || e.tariffCodes.split(',').includes(c.tariffCode)));
  const view = (r: Json): Json => ({ ...r, lines: charges.filter((c) => c.receiptId === r.id).map((c) => ({ chargeId: c.id, serviceDate: c.serviceDate, source: c.source, tariffCode: c.tariffCode, description: c.description, amount: c.amount, exempt: !!cover(c) })) });
  const tariff = (code: string) => data.tariffs.find((t: Json) => t.code === code);

  await page.route(/\/api\/tariffs$/, (route) => route.fulfill({ json: data.tariffs }));
  await page.route(/\/api\/mediagenda\/patients(\?|$)/, (route) => {
    const q = (new URL(route.request().url()).searchParams.get('q') ?? '').toLowerCase();
    return route.fulfill({ json: q.length < 2 ? [] : data.patients.filter((p: Json) => p.lastName.toLowerCase().includes(q) || p.fiscalCode.toLowerCase().includes(q)) });
  });

  await page.route(/\/api\/charges(\/import)?(\?|$)/, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/import')) {
      const day = url.searchParams.get('date') ?? '';
      log.imports.push(day);
      let visits = 0;
      let tests = 0;
      let already = 0;
      const skipped: string[] = [];
      for (const b of data.bookings.filter((x: Json) => x.appointmentAt.slice(0, 10) === day)) {
        if (charges.some((c) => c.source === 'VISITA' && c.sourceRef === b.id)) { already++; continue; }
        const t = data.tariffs.find((x: Json) => x.mediagendaResource === b.resourceCode);
        if (!t) { skipped.push(`${b.id}: no visit tariff for provider ${b.resourceCode}`); continue; }
        charges.push({ id: nextCharge++, source: 'VISITA', sourceRef: b.id, serviceDate: day, fiscalCode: b.fiscalCode, patientName: b.patientName, tariffCode: t.code, description: t.description, amount: t.price, status: 'APERTO', receiptId: null });
        visits++;
      }
      for (const o of data.labOrders[day] ?? []) {
        for (const e of o.exams) {
          const ref = `${o.id}/${e.code}`;
          if (charges.some((c) => c.source === 'LABORATORIO' && c.sourceRef === ref)) { already++; continue; }
          const t = tariff(e.tariffCode);
          if (!t) { skipped.push(`${ref}: tariff ${e.tariffCode} is not in the fee schedule`); continue; }
          charges.push({ id: nextCharge++, source: 'LABORATORIO', sourceRef: ref, serviceDate: day, fiscalCode: o.fiscalCode, patientName: o.patientName, tariffCode: t.code, description: t.description, amount: t.price, status: 'APERTO', receiptId: null });
          tests++;
        }
      }
      return route.fulfill({ json: { day, visits, tests, alreadyImported: already, skipped } });
    }
    const status = url.searchParams.get('status') ?? '';
    return route.fulfill({ json: charges.filter((c) => !status || c.status === status).sort((a, b) => b.serviceDate.localeCompare(a.serviceDate) || a.id - b.id) });
  });

  await page.route(/\/api\/receipts(\/[^?]*)?(\?|$)/, (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const [, id, action] = url.pathname.match(/^\/api\/receipts(?:\/([^/]+))?(?:\/(pay|storno))?$/) ?? [];
    if (!id && req.method() === 'GET') {
      const status = url.searchParams.get('status') ?? '';
      return route.fulfill({ json: receipts.filter((r) => !status || r.status === status).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)).map(view) });
    }
    if (!id && req.method() === 'POST') {
      const fiscalCode = req.postDataJSON()?.fiscalCode ?? '';
      log.receiptRequests.push(fiscalCode);
      const open = charges.filter((c) => c.fiscalCode === fiscalCode && c.status === 'APERTO');
      if (!open.length) return error(route, 409, `charges: no open charges for ${fiscalCode}`);
      const total = cents(open.reduce((s, c) => s + c.amount, 0));
      const exemptLines = open.filter(cover);
      const exempt = cents(exemptLines.reduce((s, c) => s + c.amount, 0));
      const codes = [...new Set(exemptLines.map((c) => cover(c)!.code))].sort().join(',');
      const r = { id: `RC-2026-${String(nextReceipt++).padStart(5, '0')}`, fiscalCode, patientName: open[0].patientName, issuedAt: new Date().toISOString().slice(0, 19),
        total, exempt, copay: cents(Math.min(total - exempt, CAP)), exemptionCodes: codes, status: 'EMESSA', paidAt: null };
      receipts.push(r);
      open.forEach((c) => Object.assign(c, { status: 'IN_RICEVUTA', receiptId: r.id }));
      return route.fulfill({ status: 201, json: view(r) });
    }
    const r = receipts.find((x) => x.id === id);
    if (!r) return error(route, 404, `Receipt ${id} not found`);
    if (!action) return route.fulfill({ json: view(r) });
    log.receiptActions.push({ id: id!, action: action as 'pay' | 'storno' });
    if (r.status !== 'EMESSA') return error(route, 409, `status: ${id} is ${r.status}`);
    if (action === 'pay') Object.assign(r, { status: 'PAGATA', paidAt: new Date().toISOString().slice(0, 19) });
    else {
      r.status = 'STORNATA';
      charges.filter((c) => c.receiptId === id).forEach((c) => Object.assign(c, { status: 'APERTO', receiptId: null }));
    }
    return route.fulfill({ json: view(r) });
  });

  await page.route(/\/api\/exemptions(\/types)?$/, (route) => {
    const req = route.request();
    if (req.url().endsWith('/types')) return route.fulfill({ json: data.exemptionTypes.map(({ code, description, total }: Json) => ({ code, description, total })) });
    if (req.method() === 'GET') return route.fulfill({ json: [...exemptions].sort((a, b) => a.patientName.localeCompare(b.patientName)) });
    const body = req.postDataJSON() ?? {};
    log.exemptionWrites.push(body);
    const p = data.patients.find((x: Json) => x.id === body.patientId);
    const type = data.exemptionTypes.find((t: Json) => t.code === body.code);
    if (body.validTo < body.validFrom) return error(route, 400, 'validTo: before validFrom');
    const e = { id: nextExemption++, fiscalCode: p.fiscalCode, patientName: `${p.lastName} ${p.firstName}`, code: type.code, description: type.description, total: type.total, tariffCodes: type.tariffCodes.join(','), validFrom: body.validFrom, validTo: body.validTo };
    exemptions.push(e);
    return route.fulfill({ status: 201, json: e });
  });

  await page.route(/\/api\/reports\/monthly(\?|$)/, (route) => {
    const month = new URL(route.request().url()).searchParams.get('month') ?? '';
    log.reportRequests.push(month);
    const list = receipts.filter((r) => r.issuedAt.slice(0, 7) === month && r.status !== 'STORNATA');
    const sum = (rs: Json[], f: string) => cents(rs.reduce((s, r) => s + r[f], 0));
    const byStatus: Record<string, number> = {};
    list.forEach((r) => (byStatus[r.status] = (byStatus[r.status] ?? 0) + 1));
    return route.fulfill({ json: { month, receipts: list.length, total: sum(list, 'total'), exempt: sum(list, 'exempt'), copay: sum(list, 'copay'), collected: sum(list.filter((r) => r.status === 'PAGATA'), 'copay'), byStatus } });
  });

  return log;
}
