import assert from 'node:assert/strict';
import { test } from 'node:test';
import { busFactor, dateBasis, peopleStats, riskFiles, routeCoverage, testOf, ticketStats } from '../lib/insights.mjs';

const ROUTES = `export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'richieste' },
  {
    path: 'richieste',
    loadComponent: () => import('./features/orders/order-list.component').then((m) => m.OrderListComponent),
  },
  {
    path: 'richieste/:id/risultati',
    loadComponent: () => import('./features/results/result-entry.component').then((m) => m.ResultEntryComponent),
  },
  {
    path: 'catalogo',
    loadComponent: () => import('./features/catalog/exam-catalog.component').then((m) => m.ExamCatalogComponent),
  },
];`;

test('screens opened by browser tests: a redirect route does not take the next route\'s component; :id matches', () => {
  const covered = routeCoverage(ROUTES, ['/richieste', '/richieste/RL-2026-00058/risultati']);
  assert.deepEqual([...covered].sort(), ['frontend/src/app/features/orders/order-list.component.ts', 'frontend/src/app/features/results/result-entry.component.ts']);
});

test('test of a file: own unit test, a test in its package, its screen in a browser test, none, or unknown', () => {
  const testFiles = ['backend/src/test/java/com/x/order/OrderServiceTest.java', 'e2e/tests/orders.smoke.spec.ts'];
  const coveredPages = new Set(['frontend/src/app/features/orders/order-list.component.ts']);
  const facts = { testFiles, coveredPages };
  assert.equal(testOf('backend/src/main/java/com/x/order/OrderService.java', facts), 'unit');
  assert.equal(testOf('backend/src/main/java/com/x/order/LabOrder.java', facts), 'package');
  assert.equal(testOf('backend/src/main/java/com/x/sample/SampleService.java', facts), 'none');
  assert.equal(testOf('frontend/src/app/features/orders/order-api.service.ts', facts), 'e2e');
  assert.equal(testOf('frontend/src/app/features/catalog/exam-catalog.component.ts', facts), 'none');
  assert.equal(testOf('frontend/src/app/shared/utils/numbers.ts', facts), null);
});

test('bus factor: people with at least a quarter of the commits', () => {
  assert.equal(busFactor([{ name: 'A', commits: 8 }, { name: 'B', commits: 1 }, { name: 'C', commits: 1 }]), 1);
  assert.equal(busFactor([{ name: 'A', commits: 55 }, { name: 'B', commits: 45 }]), 2);
  assert.equal(busFactor([]), 0);
});

const T = (key, type, priority, status, created, date, components, labels = []) => ({ key, issueType: type, priority, status, created, date, components: new Set(components), labels, commits: [] });

test('opening dates: Jira created, unless the history was seeded in one go (then the first commit)', () => {
  const seeded = [1, 2, 3, 4, 5].map((n) => T(`X-${n}`, 'Bug', 'High', 'Done', '2026-11-07T10:00:00Z', `2026-0${n}-10`, ['A']));
  assert.equal(dateBasis(seeded), 'git');
  const real = [1, 2, 3, 4, 5].map((n) => T(`X-${n}`, 'Bug', 'High', 'Done', `2026-0${n}-01T10:00:00Z`, '2026-11-01', ['A']));
  assert.equal(dateBasis(real), 'jira');
});

test('ticket statistics: type × priority, open by priority, component, environment without agent labels, month', () => {
  const tickets = [
    T('X-1', 'Bug', 'High', 'Done', '2026-11-07', '2026-03-10', ['A'], ['COLLAUDO', 'ai-analyzed']),
    T('X-2', 'Bug', 'High', 'To Do', '2026-11-07', '2026-04-10', ['A', 'B'], ['COLLAUDO']),
    T('X-3', 'Story', 'Medium', 'Done', '2026-11-07', '2026-04-11', ['B'], ['SVIL', 'no-ai']),
    T('X-4', 'Bug', 'Low', 'Done', '2026-11-07', '2026-04-12', [], []),
    T('X-5', 'Task', null, 'Done', '2026-11-07', '2026-04-13', ['B'], []),
  ];
  const s = ticketStats(tickets, ['2026-03', '2026-04']);
  assert.equal(s.dateBasis, 'git');
  assert.deepEqual(s.byTypePriority, { Bug: { High: 2, Low: 1 }, Story: { Medium: 1 }, Task: { None: 1 } });
  assert.deepEqual(s.openByPriority, { High: 1 });
  assert.deepEqual(s.byComponent, { A: { Bug: 2 }, B: { Bug: 1, Story: 1, Task: 1 } });
  assert.deepEqual(s.byEnvironment, { COLLAUDO: 2, SVIL: 1 });
  assert.deepEqual(s.byMonth, { '2026-03': { tickets: 1, bugs: 1 }, '2026-04': { tickets: 4, bugs: 2 } });
});

const C = (hash, author, date, files, agent = false) => ({ hash, author, date, subject: '', agent, files: files.map((path) => ({ path, lines: 2 })) });
const RULES = [{ name: 'Orders', paths: ['backend/src/main/java/com/x/order/', 'frontend/src/app/features/orders/'] }];

test('people: commits, bug fixes and stories they committed for, their components; the agent is not a person', () => {
  const svc = 'backend/src/main/java/com/x/order/OrderService.java';
  const c1 = C('a1', 'Sara', '2026-03-01', [svc]);
  const c2 = C('a2', 'Sara', '2026-04-01', [svc]);
  const c3 = C('a3', 'Luca', '2026-05-01', [svc]);
  const c4 = C('a4', 'Agent', '2026-06-01', [svc], true);
  const byKey = new Map([
    ['X-1', { key: 'X-1', issueType: 'Story', commits: [c1] }],
    ['X-2', { key: 'X-2', issueType: 'Bug', commits: [c2, c4] }],
    ['X-3', { key: 'X-3', issueType: 'Bug', commits: [c3] }],
  ]);
  const people = peopleStats({ commits: [c1, c2, c3, c4], byKey, personOf: (c) => c.author, rules: RULES });
  assert.deepEqual(people.map((p) => [p.name, p.commits, p.bugFixes, p.stories, p.last]), [['Sara', 2, 1, 1, '2026-04-01'], ['Luca', 1, 1, 0, '2026-05-01']]);
  assert.deepEqual(people[0].components, [{ name: 'Orders', commits: 2 }]);
});

test('risk files: bug fixes, changes, size and test; only application code that exists on main', () => {
  const svc = 'backend/src/main/java/com/x/order/OrderService.java';
  const entity = 'backend/src/main/java/com/x/order/LabOrder.java';
  const gone = 'backend/src/main/java/com/x/order/Old.java';
  const commits = [C('a1', 'S', '2026-03-01', [svc, entity]), C('a2', 'S', '2026-04-01', [svc]), C('a3', 'S', '2026-05-01', [svc, gone]), C('a4', 'S', '2026-06-01', [entity, 'e2e/tests/x.spec.ts'])];
  const byKey = new Map([
    ['X-1', { key: 'X-1', issueType: 'Bug', commits: [commits[1]] }],
    ['X-2', { key: 'X-2', issueType: 'Bug', commits: [commits[2]] }],
    ['X-3', { key: 'X-3', issueType: 'Bug', commits: [commits[3]] }],
  ]);
  const files = riskFiles({
    commits, byKey, rules: RULES,
    lineCounts: { [svc]: 320, [entity]: 80 },
    testFiles: ['backend/src/test/java/com/x/order/OrderServiceTest.java'],
  });
  assert.deepEqual(files.map((f) => [f.path.split('/').pop(), f.bugs.length, f.changes, f.test]), [['OrderService.java', 2, 3, 'unit'], ['LabOrder.java', 1, 2, 'package']]);
  assert.deepEqual(files[0].why, ['2 bug fixes', 'changed 3 times', '320 lines']);
  assert.equal(files[0].component, 'Orders');
});
