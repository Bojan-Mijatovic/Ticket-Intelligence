import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregate, citedOnly, componentOf, parseGitLog, personKey, personNames } from '../lib/insights.mjs';

const RULES = [
  { name: 'Prenotazioni', paths: ['frontend/src/app/features/booking/', 'backend/src/main/java/com/x/booking/', 'backend/src/main/java/com/x/timeslot/Availab'] },
  { name: 'Agenda', paths: ['frontend/src/app/features/agenda/', 'backend/src/main/java/com/x/timeslot/'] },
];

test('component: first matching prefix; tests count with their main code; unknown paths are not placed', () => {
  assert.equal(componentOf('backend/src/main/java/com/x/timeslot/AvailabilityService.java', RULES), 'Prenotazioni');
  assert.equal(componentOf('backend/src/test/java/com/x/timeslot/AvailabilityServiceTest.java', RULES), 'Prenotazioni');
  assert.equal(componentOf('backend/src/main/java/com/x/timeslot/TimeSlotService.java', RULES), 'Agenda');
  assert.equal(componentOf('C:\\repo\\frontend\\src\\app\\features\\agenda\\a.ts', RULES), 'Agenda');
  assert.equal(componentOf('e2e/tests/x.spec.ts', RULES), null);
  // Without rules: feature folder / Java package.
  assert.equal(componentOf('frontend/src/app/features/patients/p.ts', []), 'patients');
  assert.equal(componentOf('backend/src/main/java/com/x/booking/Booking.java', []), 'booking');
});

const LOG = [
  ['a1', '2026-03-02T10:00:00+01:00', 'Sara', 'DEM-30: fix agenda', [['3', '1', 'frontend/src/app/features/agenda/a.ts']]],
  ['b1', '2026-06-24T10:00:00+02:00', 'Marta', 'DEM-31: fix booking form', [['5', '2', 'frontend/src/app/features/booking/form.ts']]],
  ['b2', '2026-07-01T10:00:00+02:00', 'Marta', 'DEM-32: fix booking form again', [['4', '4', 'frontend/src/app/features/booking/form.ts'], ['10', '0', 'e2e/tests/x.spec.ts']]],
  ['s1', '2026-06-10T10:00:00+02:00', 'Luca', 'DEM-33: booking feature', [['200', '0', 'backend/src/main/java/com/x/booking/B.java']]],
  ['n1', '2026-10-01T10:00:00+02:00', 'Luca', 'chore: no ticket', [['1', '1', 'backend/src/main/java/com/x/booking/B.java']]],
]
  .map(([h, d, a, s, files]) => `\x1e${h}\x1f${d}\x1f${a}\x1f${s}\n\n${files.map((f) => f.join('\t')).join('\n')}\n`)
  .join('');

const TICKETS = [
  { key: 'DEM-30', issueType: 'Bug', status: 'Done', summary: 'agenda bug', created: '2026-11-05T00:00:00Z' },
  { key: 'DEM-31', issueType: 'Bug', status: 'Done', summary: 'booking bug 1', created: '2026-11-05T00:00:00Z' },
  { key: 'DEM-32', issueType: 'Bug', status: 'Done', summary: 'booking bug 2', created: '2026-11-05T00:00:00Z' },
  { key: 'DEM-33', issueType: 'Story', status: 'Done', summary: 'booking story', created: '2026-11-05T00:00:00Z' },
  { key: 'DEM-40', issueType: 'Bug', status: 'To Do', summary: 'open booking bug, analyzed', created: '2026-11-05T00:00:00Z' },
  { key: 'DEM-41', issueType: 'Bug', status: 'To Do', summary: 'open, nothing known', created: '2026-11-05T00:00:00Z' },
];
const ANALYSES = new Map([['DEM-40', { at: '2026-11-06T09:00:00Z', result: { files: ['frontend/src/app/features/booking/list.ts:12'], relatedTickets: [{ key: 'DEM-31' }] } }]]);

test('aggregation: bugs per component and month from git dates, open bugs from analyses, repeat files, recurrences', () => {
  const r = aggregate({ commits: parseGitLog(LOG), tickets: TICKETS, analyses: ANALYSES, rules: RULES, project: 'DEM', now: new Date('2026-11-06T12:00:00Z'), months: 10, churnDays: 90 });
  const booking = r.components.find((c) => c.name === 'Prenotazioni');
  assert.equal(booking.bugs, 3); // DEM-31, DEM-32 (git) + DEM-40 (analysis)
  assert.equal(booking.openBugs, 1);
  assert.equal(booking.tickets, 4); // + the story
  assert.equal(r.hotspots[0], 'Prenotazioni');
  assert.deepEqual(booking.repeatFiles, [{ path: 'frontend/src/app/features/booking/form.ts', keys: ['DEM-31', 'DEM-32'] }]);
  // Months come from git (the fix), not from Jira's created date.
  assert.equal(r.cells.Agenda['2026-03'].bugs, 1);
  assert.equal(r.cells.Prenotazioni['2026-06'].bugs, 1);
  assert.equal(r.cells.Prenotazioni['2026-11'].bugs, 1); // the analyzed open bug
  // Churn only within churnDays (90): b2 (Jul 1) is outside, n1 (Oct 1) inside; e2e lines are not a component.
  assert.equal(booking.churnLines, 2);
  assert.deepEqual(r.recurring, [
    { key: 'DEM-32', of: 'DEM-31', component: 'Prenotazioni', via: 'file', priority: null, crossProject: false },
    { key: 'DEM-40', of: 'DEM-31', component: 'Prenotazioni', via: 'analysis', priority: null, crossProject: false },
  ]);
  assert.deepEqual(r.totals.unplaced, ['DEM-41']);
});

test('people: one name per person whatever the spelling; the agent\'s work is not a person', () => {
  const log = [
    ['p1', '2026-03-01T10:00:00Z', 'Bojan Mijatović', 'DEM-30: a', ''],
    ['p2', '2026-03-02T10:00:00Z', 'Bojan Mijatovic', 'DEM-30: b', ''],
    ['p3', '2026-03-03T10:00:00Z', 'Bojan-Mijatovic', 'DEM-31: squash merge of the agent PR (#4)', 'Ticket Intelligence Agent <ticket-intelligence-agent@users.noreply.github.com>;Claude <noreply@anthropic.com>'],
    ['p4', '2026-03-04T10:00:00Z', 'Ticket Intelligence Agent', 'DEM-31: fix', ''],
    ['p5', '2026-03-05T10:00:00Z', 'S. Colombo', 'DEM-30: c', ''],
  ].map(([h, d, a, s, co]) => `\x1e${h}\x1f${d}\x1f${a}\x1f${s}\x1f${co}\n\n1\t1\tfrontend/src/app/features/booking/form.ts\n`).join('');
  const commits = parseGitLog(log);
  assert.deepEqual(commits.map((c) => c.agent), [false, false, true, true, false]);
  assert.equal(personKey('Bojan-Mijatović'), personKey('bojan mijatovic'));
  const names = personNames(commits, { 'S. Colombo': 'Sara Colombo' });
  assert.deepEqual([...names.values()].sort(), ['Bojan Mijatović', 'Sara Colombo']);

  const r = aggregate({ commits, tickets: [], analyses: new Map(), rules: RULES, project: 'DEM', now: new Date('2026-03-10T00:00:00Z'), aliases: { 'S. Colombo': 'Sara Colombo' } });
  const booking = r.components.find((c) => c.name === 'Prenotazioni');
  assert.deepEqual(booking.authors, [{ name: 'Bojan Mijatović', commits: 2 }, { name: 'Sara Colombo', commits: 1 }]);
  assert.equal(booking.agentCommits, 2);
  assert.equal(r.totals.agentCommits, 2);
});

test('priority weights the hotspot score; links to other projects are recurring problems too', () => {
  const tickets = [
    { key: 'DEM-31', issueType: 'Bug', status: 'Done', priority: 'Highest', summary: 'booking bug', created: '2026-11-05T00:00:00Z', links: [{ key: 'LAB-9', type: 'Relates' }] },
    { key: 'DEM-30', issueType: 'Bug', status: 'Done', priority: 'Low', summary: 'agenda bug', created: '2026-11-05T00:00:00Z' },
  ];
  const r = aggregate({ commits: parseGitLog(LOG), tickets, analyses: new Map(), rules: RULES, project: 'DEM', now: new Date('2026-11-06T12:00:00Z') });
  const booking = r.components.find((c) => c.name === 'Prenotazioni');
  const agenda = r.components.find((c) => c.name === 'Agenda');
  assert.equal(booking.priorityBugs, 1);
  assert.equal(agenda.priorityBugs, 0);
  assert.ok(booking.score > agenda.score);
  assert.equal(r.totals.priorityBugs, 1);
  assert.deepEqual(r.recurring, [{ key: 'DEM-31', of: 'LAB-9', component: 'Prenotazioni', via: 'link', priority: 'Highest', crossProject: true }]);
  assert.equal(r.tickets.find((t) => t.key === 'DEM-31').priority, 'Highest');
});

test('recommendations without a known ticket or commit are dropped', () => {
  const facts = [{ tickets: [{ key: 'DEM-31', commits: ['b1'] }] }];
  const kept = citedOnly([{ text: 'Booking form broke twice (DEM-31).' }, { text: 'Add more tests everywhere.' }, { text: 'See DEM-99.' }], facts);
  assert.deepEqual(kept.map((k) => k.text), ['Booking form broke twice (DEM-31).']);
});
