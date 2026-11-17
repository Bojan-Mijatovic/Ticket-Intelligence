import assert from 'node:assert/strict';
import { test } from 'node:test';
import { httpCalls, matchRoute, pageAnswer, pageInQuestion, pageOnly, parseRoutes, resolveImport, sameEndpoint, springEndpoints, traceAddress } from '../lib/page-code.mjs';

// A small app in the shapes of the demo apps: lazy routes, a redirect, a lazy child route file, children, a component
// with a template file and a child component, a store between a page and its service, Spring controllers with and
// without a class-level mapping.
const APP = {
  'frontend/src/app/app.routes.ts': `import { Routes } from '@angular/router';
import { ReportsComponent } from './features/reports/reports.component';
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'pazienti' },
  { path: 'pazienti', loadComponent: () => import('./features/patients/patient-search.component').then((m) => m.PatientSearchComponent) },
  { path: 'pazienti/nuovo', loadComponent: () => import('./features/patients/patient-form.component').then((m) => m.PatientFormComponent) },
  { path: 'pazienti/:id', loadComponent: () => import('./features/patients/patient-card.component').then((m) => m.PatientCardComponent) },
  { path: 'report', component: ReportsComponent },
  { path: 'admin', children: [{ path: 'utenti', loadComponent: () => import('./features/admin/users.component').then((m) => m.UsersComponent) }] },
  { path: 'agenda', loadChildren: () => import('./features/agenda/agenda.routes').then((m) => m.AGENDA_ROUTES) },
];`,
  'frontend/src/app/features/agenda/agenda.routes.ts': `export const AGENDA_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./search-mask.component').then((m) => m.SearchMaskComponent) },
];`,
  'frontend/src/app/features/patients/patient-card.component.ts': `import { Component, inject } from '@angular/core';
import { DoseBadgeComponent } from '../../shared/dose-badge.component';
import { PatientApiService } from './patient-api.service';
@Component({ selector: 'app-patient-card', imports: [DoseBadgeComponent], templateUrl: './patient-card.component.html', styleUrl: './patient-card.component.scss' })
export class PatientCardComponent {
  private readonly api = inject(PatientApiService);
  load(id: number) {
    this.api.card(id).subscribe();
  }
}`,
  'frontend/src/app/features/patients/patient-card.component.html': '<h1>card</h1>',
  'frontend/src/app/features/patients/patient-card.component.scss': '',
  'frontend/src/app/shared/dose-badge.component.ts': `import { Component } from '@angular/core';
@Component({ selector: 'app-dose-badge', template: '<span></span>' })
export class DoseBadgeComponent {}`,
  'frontend/src/app/features/patients/patient-api.service.ts': `import { HttpClient } from '@angular/common/http';
import { API } from '../../core/http/api';
export class PatientApiService {
  private readonly http = inject(HttpClient);
  search(q: string): Observable<Page<Patient>> {
    return this.http.get<Page<Patient>>(\`\${API}/patients\`, { params: { q } });
  }
  card(id: number): Observable<PatientCard> {
    return this.http.get<PatientCard>(\`\${API}/patients/\${id}/card\`);
  }
}`,
  'frontend/src/app/features/patients/patient-search.component.ts': `import { PatientApiService } from './patient-api.service';
export class PatientSearchComponent {
  private readonly api = inject(PatientApiService);
  find(q: string) {
    this.api.search(q).subscribe();
  }
}`,
  'frontend/src/app/features/agenda/search-mask.component.ts': `import { AgendaStore } from './agenda.store';
export class SearchMaskComponent {
  readonly store = inject(AgendaStore);
  go() {
    this.store.load();
  }
}`,
  'frontend/src/app/features/agenda/agenda.store.ts': `import { AgendaApiService } from './agenda-api.service';
export class AgendaStore {
  private readonly api = inject(AgendaApiService);
  load() {
    this.api.slots().subscribe();
  }
}`,
  'frontend/src/app/features/agenda/agenda-api.service.ts': `export class AgendaApiService {
  slots(): Observable<Slot[]> {
    return this.http.post<Slot[]>('/api/agenda/slots', {});
  }
}`,
  'backend/src/main/java/com/x/patient/PatientController.java': `package com.x.patient;
@RestController
@RequestMapping("/api/patients")
public class PatientController {
    @GetMapping
    public Page<Patient> search(@RequestParam String q) {
        return null;
    }
}`,
  'backend/src/main/java/com/x/dose/DoseController.java': `package com.x.dose;
@RestController
public class DoseController {
    @GetMapping("/api/patients/{id}/card")
    @ResponseStatus(HttpStatus.OK)
    public PatientCard card(@PathVariable long id) {
        return null;
    }
}`,
  'backend/src/main/java/com/x/agenda/SlotController.java': `@RestController
@RequestMapping(value = "/api/agenda")
public class SlotController {
    @PostMapping("/slots")
    public List<Slot> slots() { return null; }
}`,
};
const FILES = Object.keys(APP);
const read = async (f) => APP[f] ?? null;

test('the routes of an app: lazy and direct components, a redirect, children, a lazy child route file', () => {
  const routes = parseRoutes('frontend/src/app/app.routes.ts', (f) => APP[f] ?? null);
  const byPath = Object.fromEntries(routes.map((r) => [r.path, r]));
  assert.deepEqual(Object.keys(byPath), ['', 'pazienti', 'pazienti/nuovo', 'pazienti/:id', 'report', 'admin/utenti', 'agenda']);
  assert.deepEqual([byPath['pazienti/:id'].file, byPath['pazienti/:id'].name], ['frontend/src/app/features/patients/patient-card.component.ts', 'PatientCardComponent']);
  assert.equal(byPath.report.file, 'frontend/src/app/features/reports/reports.component.ts', 'a direct component, by its import');
  assert.equal(byPath[''].redirectTo, 'pazienti');
  assert.equal(byPath.agenda.file, 'frontend/src/app/features/agenda/search-mask.component.ts', 'the lazy child file, its path under "agenda"');
  assert.equal(resolveImport('frontend/src/app/a/b.ts', '../c/d.component'), 'frontend/src/app/c/d.component.ts');
  assert.equal(resolveImport('frontend/src/app/a/b.ts', '@angular/core'), null);
});

test('a path to its route: static segments before a parameter; a redirect is followed; nothing matches, nothing', () => {
  const routes = parseRoutes('frontend/src/app/app.routes.ts', (f) => APP[f] ?? null);
  assert.equal(matchRoute(routes, '/pazienti/12').path, 'pazienti/:id');
  assert.equal(matchRoute(routes, '/pazienti/nuovo').path, 'pazienti/nuovo', '"nuovo" is not an id');
  assert.equal(matchRoute(routes, '/PAZIENTI?q=rossi').path, 'pazienti');
  const root = matchRoute(routes, '/');
  assert.deepEqual([root.path, root.redirectedFrom], ['pazienti', '']);
  assert.equal(matchRoute(routes, '/nothing/here'), null);
});

test('HTTP calls with the method they are in; Spring endpoints with the class mapping and the handler line', () => {
  const calls = httpCalls(APP['frontend/src/app/features/patients/patient-api.service.ts']);
  assert.deepEqual(calls.map((c) => [c.method, c.path, c.anyPrefix, c.inMethod]), [['GET', '/patients', true, 'search'], ['GET', '/patients/{…}/card', true, 'card']]);
  assert.deepEqual(springEndpoints(APP['backend/src/main/java/com/x/patient/PatientController.java']), [{ method: 'GET', path: '/api/patients', handler: 'search', line: 5 }]);
  assert.deepEqual(springEndpoints(APP['backend/src/main/java/com/x/dose/DoseController.java']), [{ method: 'GET', path: '/api/patients/{id}/card', handler: 'card', line: 4 }]);
  assert.deepEqual(springEndpoints(APP['backend/src/main/java/com/x/agenda/SlotController.java']).map((e) => [e.method, e.path, e.handler]), [['POST', '/api/agenda/slots', 'slots']]);
  assert.ok(sameEndpoint(calls[1], { method: 'GET', path: '/api/patients/{id}/card' }), 'the API base is a constant: matched by the rest');
  assert.ok(!sameEndpoint(calls[1], { method: 'POST', path: '/api/patients/{id}/card' }), 'not another method');
  assert.ok(!sameEndpoint({ method: 'GET', path: '/api/patients', anyPrefix: false }, { method: 'GET', path: '/v2/api/patients' }), 'a literal path matches only itself');
});

test('an address in a question: the app\'s URL (and hash routing), a page path, an API path; a file path is not one', () => {
  assert.deepEqual(pageInQuestion('http://localhost:4204/pazienti/12'), { kind: 'page', port: 4204, path: '/pazienti/12' });
  assert.deepEqual(pageInQuestion('Which code is behind https://app.example/#/scadenze?'), { kind: 'page', port: null, path: '/scadenze' });
  assert.deepEqual(pageInQuestion('what is /api/patients/3/card?'), { kind: 'api', port: null, path: '/api/patients/3/card' });
  assert.deepEqual(pageInQuestion('Gde je kod za /scadenze'), { kind: 'page', port: null, path: '/scadenze' });
  assert.equal(pageInQuestion('Who changed /frontend/src/app/x.component.ts?'), null);
  assert.equal(pageInQuestion('Is 12/11/2026 shown as dd/mm/yyyy?'), null, 'a date is not a path');
  assert.equal(pageInQuestion('Which bugs did Scadenze have?'), null);
});

test('a question that only names the page gets the code; one that asks why it misbehaves goes to Claude', () => {
  assert.ok(pageOnly('http://localhost:4204/pazienti/12'));
  assert.ok(pageOnly('Which code is behind /scadenze?'));
  assert.ok(pageOnly('Koji kod je iza /scadenze?'));
  for (const q of ['Why does http://localhost:4204/scadenze miss Sunday?', '/scadenze doesn\'t show Sunday', 'Zašto /scadenze ne radi?', 'Perché /scadenze non funziona?', '/pazienti/3 shows the wrong dose']) assert.equal(pageOnly(q), false, q);
});

test('a page traced: route, component and its files, the component inside it, the calls it makes through its service, the controllers', async () => {
  const trace = await traceAddress({ where: { kind: 'page', path: '/pazienti/12' }, files: FILES, read });
  assert.equal(trace.component.name, 'PatientCardComponent');
  assert.deepEqual(trace.component.files, ['frontend/src/app/features/patients/patient-card.component.ts', 'frontend/src/app/features/patients/patient-card.component.html', 'frontend/src/app/features/patients/patient-card.component.scss']);
  assert.deepEqual(trace.children.map((c) => c.name), ['DoseBadgeComponent']);
  assert.deepEqual(trace.calls.map((c) => [c.method, c.path, c.endpoint?.handler]), [['GET', '/patients/{…}/card', 'card']], 'only the service method the page uses: not search');
  const rules = [{ name: 'Scheda', paths: ['frontend/src/app/features/patients/patient-card', 'backend/src/main/java/com/x/dose/'] }];
  const insights = { components: [{ name: 'Scheda', team: [{ name: 'Irene Fabbri', share: 60 }] }], tickets: [{ key: 'VAX-21', type: 'Bug', status: 'Done', summary: 'the third dose is due too early', components: ['Scheda'] }, { key: 'VAX-22', type: 'Story', status: 'Done', summary: 'a label', components: ['Scheda'] }] };
  const a = pageAnswer({ question: 'http://localhost:4204/pazienti/12', trace, rules, insights, ticketUrl: (k) => `J/${k}`, fileUrl: (f) => `G/${f}` });
  assert.equal(a.answer, 'The page /pazienti/12 is the route "pazienti/:id": PatientCardComponent in frontend/src/app/features/patients/patient-card.component.ts (with patient-card.component.html, patient-card.component.scss). Inside it: DoseBadgeComponent (frontend/src/app/shared/dose-badge.component.ts). Its data: GET /api/patients/{id}/card (PatientApiService) → DoseController.card (backend/src/main/java/com/x/dose/DoseController.java:4). Component: Scheda. Who knows it: Irene Fabbri (60 %). Its latest bugs: VAX-21 the third dose is due too early (Done).');
  assert.deepEqual([a.fast, a.intent, a.component, a.found], [true, 'page', 'Scheda', true]);
  assert.ok(a.sources.some((s) => s.ref === 'backend/src/main/java/com/x/dose/DoseController.java:4' && s.url === 'G/backend/src/main/java/com/x/dose/DoseController.java#L4'), 'a controller line is a link to that line');
  assert.ok(a.sources.some((s) => s.ref === 'VAX-21' && s.url === 'J/VAX-21'));
});

test('a page whose data goes through a store; an API path back to the page that calls it; an unknown address is null', async () => {
  const agenda = await traceAddress({ where: { kind: 'page', path: '/agenda' }, files: FILES, read });
  assert.deepEqual(agenda.calls.map((c) => [c.method, c.endpoint?.path, c.via]), [['POST', '/api/agenda/slots', 'AgendaApiService']]);
  assert.deepEqual(agenda.component.services.map((s) => s.name), ['AgendaApiService', 'AgendaStore']);
  const api = await traceAddress({ where: { kind: 'api', path: '/api/patients/3/card' }, files: FILES, read });
  assert.deepEqual(api.endpoints.map((e) => e.handler), ['card']);
  assert.deepEqual(api.callers.map((c) => [c.file, c.inMethod, c.usedBy]), [['frontend/src/app/features/patients/patient-api.service.ts', 'card', ['frontend/src/app/features/patients/patient-card.component.ts']]]);
  assert.match(pageAnswer({ question: '/api/patients/3/card', trace: api }).answer, /^\/api\/patients\/3\/card is answered by GET \/api\/patients\/\{id\}\/card → DoseController\.card \(backend\/src\/main\/java\/com\/x\/dose\/DoseController\.java:4\)\. Called by frontend\/src\/app\/features\/patients\/patient-api\.service\.ts:9 \(card\(\)\), used by patient-card\.component\.ts\./);
  assert.equal(await traceAddress({ where: { kind: 'page', path: '/nothing' }, files: FILES, read }), null);
  assert.equal(await traceAddress({ where: { kind: 'api', path: '/api/nothing' }, files: FILES, read }), null);
});
