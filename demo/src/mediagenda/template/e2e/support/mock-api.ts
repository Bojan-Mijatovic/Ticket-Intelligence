import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

// Mocked backend for browser tests. Data mirrors the Flyway seed (V2__seed_agenda.sql).
// Every call the frontend makes is recorded, so tests can assert on what is sent to the backend.

const data = JSON.parse(readFileSync(join(__dirname, 'api-data.json'), 'utf8'));

export interface ApiLog {
  /** structureIds of every POST /api/agenda/structure-timeslots ("StructuretimeSlot" service), in order */
  timeSlotRequests: string[][];
  /** structureIds of every GET /api/resources, in order */
  resourceRequests: string[][];
  /** q of every GET /api/structures (autocomplete), in order */
  structureSearches: string[];
}

export async function mockApi(page: Page): Promise<ApiLog> {
  const log: ApiLog = { timeSlotRequests: [], resourceRequests: [], structureSearches: [] };

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

  return log;
}
