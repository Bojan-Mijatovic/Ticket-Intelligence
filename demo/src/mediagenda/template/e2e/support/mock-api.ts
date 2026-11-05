import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, Route } from '@playwright/test';

// Mocked backend for browser tests. Data mirrors the Flyway seed (V2__seed_agenda.sql … V8).
// Every call the frontend makes is recorded, so tests can assert on what is sent to the backend.

const data = JSON.parse(readFileSync(join(__dirname, 'api-data.json'), 'utf8'));
const WEEKDAYS = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const STEP_MINUTES = 20; // AvailabilityService.STEP

export interface ApiLog {
  /** structureIds of every POST /api/agenda/structure-timeslots ("StructuretimeSlot" service), in order */
  timeSlotRequests: string[][];
  /** structureIds of every GET /api/resources, in order */
  resourceRequests: string[][];
  /** q of every GET /api/structures (autocomplete), in order */
  structureSearches: string[];
  /** bodies of POST /api/patients and PUT /api/patients/{id} */
  patientWrites: { method: string; id?: number; body: Record<string, unknown> }[];
  /** status filter of every GET /api/bookings ('' = all) */
  bookingListRequests: string[];
  /** bodies of POST /api/bookings */
  bookingWrites: Record<string, unknown>[];
  /** { id, reason } of every POST /api/bookings/{id}/cancel */
  cancellations: { id: string; reason: string }[];
  /** { resourceCode, date } of every GET /api/agenda/availability */
  availabilityRequests: { resourceCode: string; date: string }[];
  /** bodies of POST /api/timeslots */
  timeSlotWrites: Record<string, unknown>[];
}

type Json = Record<string, any>;

export async function mockApi(page: Page): Promise<ApiLog> {
  const log: ApiLog = {
    timeSlotRequests: [], resourceRequests: [], structureSearches: [],
    patientWrites: [], bookingListRequests: [], bookingWrites: [], cancellations: [], availabilityRequests: [], timeSlotWrites: [],
  };
  // Per-test copies, so writes in one test never leak into another.
  const patients: Json[] = structuredClone(data.patients);
  const bookings: Json[] = structuredClone(data.bookings);
  let nextPatientId = 100;
  let nextBooking = 600;
  let nextSlotId = 200000;

  const view = (b: Json): Json => {
    const p = patients.find((x) => x.id === b.patientId) ?? {};
    const t = data.timeSlots.find((x: Json) => x.id === b.timeSlotId) ?? {};
    return { ...b, patientName: `${p.lastName} ${p.firstName}`, fiscalCode: p.fiscalCode, agendaName: t.agendaName, structureId: t.structureId, resourceCode: t.resourceCode };
  };

  await page.route(/\/api\/structures(\?|$)/, (route) => {
    const q = (new URL(route.request().url()).searchParams.get('q') ?? '').toLowerCase();
    log.structureSearches.push(q);
    const hits = data.structures.filter((s: { id: string; name: string }) => s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
    return route.fulfill({ json: hits });
  });

  await page.route(/\/api\/resources(\?|$)/, (route) => {
    const ids = (new URL(route.request().url()).searchParams.get('structureIds') ?? '').split(',').filter(Boolean);
    log.resourceRequests.push(ids);
    // Same order as the backend (AgendaResourceRepository: ...OrderByCodeAsc).
    const hits = data.resources
      .filter((r: { structureId: string }) => ids.includes(r.structureId))
      .sort((a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code));
    return route.fulfill({ json: hits });
  });

  await page.route(/\/api\/agenda\/structure-timeslots$/, (route) => {
    const body = route.request().postDataJSON() ?? {};
    const ids: string[] = body.structureIds ?? (body.structureId ? [body.structureId] : []);
    log.timeSlotRequests.push(ids);
    // Same order as the backend (TimeSlotRepository: ...OrderByIdAsc).
    const hits = data.timeSlots
      .filter((t: { structureId: string }) => ids.includes(t.structureId))
      .sort((a: { id: number }, b: { id: number }) => a.id - b.id);
    return route.fulfill({ json: hits });
  });

  // Patients: search with paging, get, create, update.
  await page.route(/\/api\/patients(\/\d+)?(\?|$)/, (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const id = Number(url.pathname.match(/\/api\/patients\/(\d+)/)?.[1]) || null;
    if (req.method() === 'GET' && id) {
      const p = patients.find((x) => x.id === id);
      return p ? route.fulfill({ json: p }) : route.fulfill({ status: 404, json: { status: 404, error: 'NOT_FOUND', details: [`Patient ${id} not found`] } });
    }
    if (req.method() === 'GET') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const page = Number(url.searchParams.get('page') ?? 0);
      const size = Number(url.searchParams.get('size') ?? 10);
      const hits = patients
        .filter((p) => p.lastName.toLowerCase().includes(q) || p.fiscalCode.toLowerCase().includes(q))
        .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));
      return route.fulfill({ json: { items: hits.slice(page * size, page * size + size), page, size, total: hits.length } });
    }
    const body = req.postDataJSON() ?? {};
    log.patientWrites.push({ method: req.method(), id: id ?? undefined, body });
    const clash = patients.find((p) => p.fiscalCode === String(body.fiscalCode).toUpperCase() && p.id !== id);
    if (clash) return route.fulfill({ status: 409, json: { status: 409, error: 'CONFLICT', details: [`fiscalCode: already registered for patient ${clash.id}`] } });
    if (req.method() === 'POST') {
      const created = { ...body, id: nextPatientId++, fiscalCode: String(body.fiscalCode).toUpperCase() };
      patients.push(created);
      return route.fulfill({ status: 201, json: created });
    }
    const existing = patients.find((p) => p.id === id);
    Object.assign(existing ?? {}, body);
    return route.fulfill({ json: existing });
  });

  // Bookings: list (optional status), create, cancel.
  await page.route(/\/api\/bookings(\/[^/?]+(\/cancel)?)?(\?|$)/, (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const cancel = url.pathname.match(/\/api\/bookings\/([^/]+)\/cancel$/);
    if (cancel && req.method() === 'POST') {
      const reason = req.postDataJSON()?.reason ?? '';
      log.cancellations.push({ id: cancel[1], reason });
      const b = bookings.find((x) => x.id === cancel[1]);
      if (!b || b.status !== 'CONFERMATA') return route.fulfill({ status: 409, json: { status: 409, error: 'CONFLICT', details: ['status: only a CONFERMATA booking can be cancelled'] } });
      Object.assign(b, { status: 'ANNULLATA', cancelReason: reason });
      return route.fulfill({ json: view(b) });
    }
    if (req.method() === 'GET') {
      const status = url.searchParams.get('status') ?? '';
      log.bookingListRequests.push(status);
      const list = bookings.filter((b) => !status || b.status === status).sort((a, b) => b.appointmentAt.localeCompare(a.appointmentAt));
      return route.fulfill({ json: list.map(view) });
    }
    const body = req.postDataJSON() ?? {};
    log.bookingWrites.push(body);
    const created = { ...body, id: `PR-${new Date().getFullYear()}-${String(nextBooking++).padStart(5, '0')}`, status: 'CONFERMATA', cancelReason: null };
    bookings.push(created);
    return route.fulfill({ status: 201, json: view(created) });
  });

  // Free times of a provider on a day (AvailabilityService): slots of that weekday split into 20-minute appointments.
  await page.route(/\/api\/agenda\/availability(\?|$)/, (route) => {
    const url = new URL(route.request().url());
    const resourceCode = url.searchParams.get('resourceCode') ?? '';
    const date = url.searchParams.get('date') ?? '';
    log.availabilityRequests.push({ resourceCode, date });
    const weekday = WEEKDAYS[new Date(`${date}T12:00:00`).getDay()];
    const taken = new Set(bookings.filter((b) => b.status !== 'ANNULLATA').map((b) => `${b.timeSlotId}|${b.appointmentAt}`));
    const free: Json[] = [];
    for (const t of data.timeSlots.filter((s: Json) => s.resourceCode === resourceCode && s.weekday === weekday && s.startDate <= date && date <= s.endDate)) {
      const [sh, sm] = t.startTime.split(':').map(Number);
      const [eh, em] = t.endTime.split(':').map(Number);
      for (let m = sh * 60 + sm; m + STEP_MINUTES <= eh * 60 + em; m += STEP_MINUTES) {
        const startAt = `${date}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
        if (!taken.has(`${t.id}|${startAt}`)) free.push({ timeSlotId: t.id, startAt, agendaName: t.agendaName, priority: t.priority, structureId: t.structureId });
      }
    }
    return route.fulfill({ json: free });
  });

  // New recurring time slots: one per weekday.
  await page.route(/\/api\/timeslots$/, (route) => {
    const body = route.request().postDataJSON() ?? {};
    log.timeSlotWrites.push(body);
    if (!(body.startTime < body.endTime)) {
      return route.fulfill({ status: 400, json: { status: 400, error: 'VALIDATION_ERROR', details: ['endTime: must be after startTime'] } });
    }
    const slots = (body.weekdays as string[]).map((weekday) => {
      const id = nextSlotId++;
      return {
        id, agendaName: String(body.agendaName).toUpperCase(), slotCode: `${id}|${body.startTime.replace(':', '')}|${body.endTime.replace(':', '')}`,
        startDate: body.startDate, endDate: body.endDate, frequency: `${body.startTime}-${body.endTime}, ogni ${weekday}`, weekday,
        startTime: `${body.startTime}:00`, endTime: `${body.endTime}:00`, calendarEndDate: body.endDate, resourceCode: body.resourceCode,
      };
    });
    return route.fulfill({ status: 201, json: slots });
  });

  return log;
}
