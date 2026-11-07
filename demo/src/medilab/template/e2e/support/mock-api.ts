import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, Route } from '@playwright/test';

// Mocked MediLab backend for browser tests. Data mirrors the Flyway seed (api-data.json); rules mirror the backend
// (OrderService, SampleService, ResultService, Flags). Every call the frontend makes is recorded, so tests can
// assert on what is sent.

const data = JSON.parse(readFileSync(join(__dirname, 'api-data.json'), 'utf8'));

type Json = Record<string, any>;

export interface ApiLog {
  /** { status, q } of every GET /api/orders ('' = not sent) */
  orderListRequests: { status: string; q: string }[];
  /** bodies of POST /api/orders */
  orderWrites: Json[];
  /** { id, reason } of every POST /api/orders/{id}/cancel */
  cancellations: { id: string; reason: string }[];
  /** barcode of every GET /api/samples/{barcode}, as sent */
  sampleLookups: string[];
  /** { barcode, action, reason? } of every accept / reject */
  sampleActions: { barcode: string; action: 'accept' | 'reject'; reason?: string }[];
  /** { orderId, entries } of every PUT /api/orders/{id}/results */
  resultWrites: { orderId: string; entries: { examCode: string; value: number }[] }[];
  /** { orderId, validatedBy } of every POST /api/orders/{id}/validate */
  validations: { orderId: string; validatedBy: string }[];
  /** q of every GET /api/mediagenda/patients */
  patientSearches: string[];
}

const error = (route: Route, status: number, detail: string) =>
  route.fulfill({ status, json: { status, error: status === 404 ? 'NOT_FOUND' : status === 409 ? 'CONFLICT' : 'VALIDATION_ERROR', details: [detail] } });

export async function mockApi(page: Page): Promise<ApiLog> {
  const log: ApiLog = { orderListRequests: [], orderWrites: [], cancellations: [], sampleLookups: [], sampleActions: [], resultWrites: [], validations: [], patientSearches: [] };
  // Per-test copies, so writes in one test never leak into another.
  const orders: Json[] = structuredClone(data.orders);
  const samples: Json[] = structuredClone(data.samples);
  const results: Json[] = structuredClone(data.results);
  const exam = (code: string): Json => data.exams.find((e: Json) => e.code === code);
  const patient = (id: number): Json => data.patients.find((p: Json) => p.id === id);
  let nextOrder = 100;
  let nextBarcode = 1000;

  const range = (e: Json, sex: string): [number | null, number | null] => (sex === 'F' ? [e.refMinF, e.refMaxF] : [e.refMinM, e.refMaxM]);
  const flag = (e: Json, sex: string, v: number) => {
    const [min, max] = range(e, sex);
    return min !== null && v < min ? 'L' : max !== null && v > max ? 'H' : 'N';
  };
  const orderView = (o: Json): Json => {
    const p = patient(o.patientId);
    return {
      ...o, fiscalCode: p.fiscalCode, patientName: `${p.lastName} ${p.firstName}`, sex: p.sex, birthDate: p.birthDate,
      exams: [...o.examCodes].sort().map((c: string) => ({ code: c, name: exam(c).name, sampleType: exam(c).sampleType, tariffCode: exam(c).tariffCode })),
      samples: samples.filter((s) => s.orderId === o.id).map((s) => ({ barcode: s.barcode, sampleType: s.sampleType, status: s.status })),
    };
  };
  const sheet = (o: Json): Json => {
    const v = orderView(o);
    const rows = o.examCodes.map((c: string) => exam(c))
      .sort((a: Json, b: Json) => a.sampleType.localeCompare(b.sampleType) || a.code.localeCompare(b.code))
      .map((e: Json) => {
        const r = results.find((x) => x.orderId === o.id && x.examCode === e.code);
        const [refMin, refMax] = range(e, v.sex);
        return { examCode: e.code, name: e.name, sampleType: e.sampleType, unit: e.unit, decimals: e.decimals, refMin, refMax, value: r?.value ?? null, flag: r ? flag(e, v.sex, r.value) : null };
      });
    const validatedBy = results.find((x) => x.orderId === o.id && x.validated)?.validatedBy ?? null;
    return { orderId: o.id, status: o.status, patientName: v.patientName, fiscalCode: v.fiscalCode, sex: v.sex, birthDate: v.birthDate, prescriber: o.prescriber, requestedAt: o.requestedAt, reportedAt: o.reportedAt, validatedBy, rows };
  };
  const sampleView = (s: Json): Json => {
    const o = orderView(orders.find((x) => x.id === s.orderId));
    return { ...s, acceptedAt: null, rejectReason: s.rejectReason ?? null, replacedBy: s.replacedBy ?? null, orderId: o.id, orderStatus: o.status, patientName: o.patientName, fiscalCode: o.fiscalCode, urgent: o.urgent,
      examCodes: o.exams.filter((e: Json) => e.sampleType === s.sampleType).map((e: Json) => e.code) };
  };

  await page.route(/\/api\/exams(\?|$)/, (route) => {
    const q = (new URL(route.request().url()).searchParams.get('q') ?? '').toLowerCase();
    const list = data.exams.filter((e: Json) => !q || e.code.toLowerCase().includes(q) || e.name.toLowerCase().includes(q))
      .sort((a: Json, b: Json) => a.sampleType.localeCompare(b.sampleType) || a.code.localeCompare(b.code));
    return route.fulfill({ json: list });
  });

  await page.route(/\/api\/mediagenda\/patients(\?|$)/, (route) => {
    const q = (new URL(route.request().url()).searchParams.get('q') ?? '').toLowerCase();
    log.patientSearches.push(q);
    const hits = q.length < 2 ? [] : data.patients.filter((p: Json) => p.lastName.toLowerCase().includes(q) || p.fiscalCode.toLowerCase().includes(q));
    return route.fulfill({ json: hits });
  });

  // Requests: list, get, create, cancel; results, validation and report of a request.
  await page.route(/\/api\/orders(\/[^?]*)?(\?|$)/, (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const [, id, action] = url.pathname.match(/^\/api\/orders(?:\/([^/]+))?(?:\/(results|validate|report|cancel))?$/) ?? [];
    const o = id ? orders.find((x) => x.id === id) : null;
    if (id && !o) return error(route, 404, `Request ${id} not found`);

    if (!id && req.method() === 'GET') {
      const status = url.searchParams.get('status') ?? '';
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      log.orderListRequests.push({ status, q });
      const list = orders.map(orderView)
        .filter((v) => !status || v.status === status)
        .filter((v) => !q || v.patientName.toLowerCase().includes(q) || v.fiscalCode.toLowerCase().includes(q))
        .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
      return route.fulfill({ json: list });
    }
    if (!id && req.method() === 'POST') {
      const body = req.postDataJSON() ?? {};
      log.orderWrites.push(body);
      const codes = [...new Set<string>((body.examCodes ?? []).map((c: string) => c.toUpperCase()))];
      const created = { id: `RL-2026-${String(nextOrder++).padStart(5, '0')}`, patientId: body.patientId, prescriber: body.prescriber, prescriptionCode: body.prescriptionCode || null,
        urgent: !!body.urgent, status: 'RICHIESTA', requestedAt: new Date().toISOString().slice(0, 19), reportedAt: null, cancelReason: null, examCodes: codes };
      orders.push(created);
      for (const type of [...new Set(codes.map((c) => exam(c).sampleType))]) {
        samples.push({ barcode: `LB${String(nextBarcode++).padStart(8, '0')}`, orderId: created.id, sampleType: type, status: 'ATTESO' });
      }
      return route.fulfill({ status: 201, json: orderView(created) });
    }
    if (!action && req.method() === 'GET') return route.fulfill({ json: orderView(o!) });
    if (action === 'cancel') {
      const reason = req.postDataJSON()?.reason ?? '';
      log.cancellations.push({ id: id!, reason });
      if (o!.status !== 'RICHIESTA') return error(route, 409, `status: only a request RICHIESTA can be cancelled (${id} is ${o!.status})`);
      Object.assign(o!, { status: 'ANNULLATA', cancelReason: reason });
      samples.filter((s) => s.orderId === id && s.status === 'ATTESO').forEach((s) => (s.status = 'ANNULLATO'));
      return route.fulfill({ json: orderView(o!) });
    }
    if (action === 'results' && req.method() === 'GET') return route.fulfill({ json: sheet(o!) });
    if (action === 'results' && req.method() === 'PUT') {
      const entries = req.postDataJSON() ?? [];
      log.resultWrites.push({ orderId: id!, entries });
      if (o!.status !== 'IN_LAVORAZIONE') return error(route, 409, `status: results can be entered only for a request IN_LAVORAZIONE (${id} is ${o!.status})`);
      for (const e of entries) {
        const ex = exam(String(e.examCode).toUpperCase());
        const value = Number(Number(e.value).toFixed(ex.decimals)); // ResultService rounds to the decimals of the catalog
        const existing = results.find((r) => r.orderId === id && r.examCode === ex.code);
        if (existing) existing.value = value;
        else results.push({ orderId: id, examCode: ex.code, value, validated: false, validatedBy: null });
      }
      return route.fulfill({ json: sheet(o!) });
    }
    if (action === 'validate') {
      const validatedBy = req.postDataJSON()?.validatedBy ?? '';
      log.validations.push({ orderId: id!, validatedBy });
      const missing = o!.examCodes.filter((c: string) => !results.some((r) => r.orderId === id && r.examCode === c)).sort();
      if (missing.length) return error(route, 409, `results: no value yet for ${missing.join(', ')}`);
      results.filter((r) => r.orderId === id).forEach((r) => Object.assign(r, { validated: true, validatedBy }));
      Object.assign(o!, { status: 'REFERTATA', reportedAt: new Date().toISOString().slice(0, 19) });
      return route.fulfill({ json: sheet(o!) });
    }
    if (action === 'report') {
      if (o!.status !== 'REFERTATA') return error(route, 409, `status: request ${id} has no report yet (${o!.status})`);
      return route.fulfill({ json: sheet(o!) });
    }
    return error(route, 400, `not mocked: ${req.method()} ${url.pathname}`);
  });

  // Tubes: lookup by barcode (case-sensitive, like the backend), accept, reject (with a replacement tube).
  await page.route(/\/api\/samples\/[^/]+(\/(accept|reject))?$/, (route: Route) => {
    const req = route.request();
    const [, barcode, action] = new URL(req.url()).pathname.match(/^\/api\/samples\/([^/]+)(?:\/(accept|reject))?$/) ?? [];
    const code = decodeURIComponent(barcode);
    const s = samples.find((x) => x.barcode === code);
    if (!action) log.sampleLookups.push(code);
    if (!s) return error(route, 404, `Sample ${code} not found`);
    if (!action) return route.fulfill({ json: sampleView(s) });
    const o = orders.find((x) => x.id === s.orderId)!;
    if (s.status !== 'ATTESO') return error(route, 409, `status: sample ${code} is ${s.status}, not ATTESO`);
    if (action === 'accept') {
      log.sampleActions.push({ barcode: code, action: 'accept' });
      if (o.status !== 'RICHIESTA' && o.status !== 'IN_LAVORAZIONE') return error(route, 409, `status: request ${o.id} is ${o.status}, its samples cannot be accepted`);
      s.status = 'ACCETTATO';
      if (!samples.some((x) => x.orderId === o.id && x.status === 'ATTESO') && o.status === 'RICHIESTA') o.status = 'IN_LAVORAZIONE';
      return route.fulfill({ json: sampleView(s) });
    }
    const reason = req.postDataJSON()?.reason ?? '';
    log.sampleActions.push({ barcode: code, action: 'reject', reason });
    const replacement = { barcode: `LB${String(nextBarcode++).padStart(8, '0')}`, orderId: s.orderId, sampleType: s.sampleType, status: 'ATTESO' };
    samples.push(replacement);
    Object.assign(s, { status: 'RIFIUTATO', rejectReason: reason, replacedBy: replacement.barcode });
    return route.fulfill({ json: sampleView(s) });
  });

  return log;
}
