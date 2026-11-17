import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { componentInQuestion, fastMore, ruleIntent } from '../lib/ask-fast.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, '..', 'agent.config.json'), 'utf8'));
const RULES = config.projects.find((p) => p.key === 'DEM').insights.components; // MediAgenda's real rules

test('clear wordings in English, Italian and Serbian give the intent; anything else is left to System 1', () => {
  const cases = {
    'What are the latest tickets?': 'latest', 'Koji su poslednji tiketi?': 'latest', 'Quali sono gli ultimi ticket?': 'latest', 'Najnoviji bagovi u Prenotazioni': 'latest',
    'Which bugs did Prenotazioni have?': 'history', 'Istorija bagova za Prenotazioni': 'history', 'Storia dei bug delle prenotazioni': 'history',
    'Where is the code for the booking list?': 'where', 'Gde je kod za prenotazioni?': 'where', 'Dove si trova il codice delle prenotazioni?': 'where', 'U kom fajlu je filter za otkazane?': 'where',
    'Who knows the time slot code best?': 'who', 'Ko zna kod za pacijente?': 'who', 'Chi conosce meglio il codice delle prenotazioni?': 'who', 'who last worked on the agenda page?': 'who',
  };
  for (const [q, intent] of Object.entries(cases)) assert.equal(ruleIntent(q), intent, q);
  for (const q of ['How do I add a new structure?', 'Has the Struttura field bug happened before?', 'give me a solution proposal for a bug']) assert.equal(ruleIntent(q), null, q);
});

test('the component a question names, by name or by a folder only it has; never a guess', () => {
  assert.equal(componentInQuestion('Which bugs did Prenotazioni have?', RULES), 'Prenotazioni');
  assert.equal(componentInQuestion('Istorija bagova za prenotazioni', RULES), 'Prenotazioni');
  assert.equal(componentInQuestion('Who knows the fasce orarie code?', RULES), 'Fasce orarie');
  assert.equal(componentInQuestion('Where is the code for the booking list?', RULES), 'Prenotazioni', 'booking is a folder of Prenotazioni only');
  assert.equal(componentInQuestion('What are the latest tickets?', RULES), null, 'no component named: not "Report" as the model said');
  assert.equal(componentInQuestion('Koji su poslednji tiketi?', RULES), null);
  // "timeslot" is a folder of three components: not enough to choose one.
  assert.equal(componentInQuestion('Who changed the timeslot code?', RULES), null);
});

const INSIGHTS = {
  components: [{ name: 'Prenotazioni', bugs: 3, openBugs: 0, priorityBugs: 2, team: [{ name: 'Marta Ricci', share: 55 }, { name: 'Luca Bianchi', share: 45 }] }],
  tickets: [
    { key: 'DEM-24', type: 'Bug', status: 'Done', summary: 'the booked time is still offered', components: ['Prenotazioni'] },
    { key: 'DEM-25', type: 'Bug', status: 'Done', summary: 'the old Erogatore stays selected', components: ['Prenotazioni'] },
    { key: 'DEM-44', type: 'Bug', status: 'Done', summary: 'the Annullate filter shows no bookings', components: ['Prenotazioni'] },
    { key: 'DEM-46', type: 'Task', status: 'To Do', summary: 'print tomorrow\'s bookings', components: ['Prenotazioni'] },
  ],
  recurring: [{ key: 'DEM-25', of: 'DEM-24', component: 'Prenotazioni' }],
  riskFiles: [{ path: 'frontend/src/app/features/booking/booking-form.component.ts', component: 'Prenotazioni', bugs: ['DEM-24', 'DEM-25'], why: ['2 bug fixes'] }],
};
const FILES = [
  'frontend/src/app/features/booking/booking-list.component.ts', 'frontend/src/app/features/booking/booking-list.component.html',
  'frontend/src/app/features/booking/booking-form.component.ts', 'frontend/src/app/features/booking/booking-list.component.spec.ts',
  'backend/src/main/java/com/mediagenda/booking/BookingController.java', 'e2e/tests/booking.spec.ts',
];

test('history of a component: its bugs newest first, what was fixed twice, what came back, who knows it', () => {
  const a = fastMore({ question: 'Which bugs did Prenotazioni have?', intent: 'history', component: 'Prenotazioni', insights: INSIGHTS, rules: RULES });
  assert.match(a.answer, /^Prenotazioni has had 3 bugs, 2 of them High or Highest, none open\. Newest first: DEM-44 [^;]+; DEM-25 [^;]+; DEM-24 /);
  assert.match(a.answer, /Fixed more than once: booking-form\.component\.ts \(DEM-24, DEM-25\)\. Came back: DEM-25 repeats DEM-24\. Who knows it: Marta Ricci \(55 %\), Luca Bianchi \(45 %\)\.$/);
  assert.doesNotMatch(a.answer, /DEM-46/, 'a task is not a bug');
  assert.equal(fastMore({ question: 'history', intent: 'history', component: null, insights: INSIGHTS }), null, 'no component, no fast history');
});

test('where: the component\'s folders, or the files whose path has the question\'s words; not sure means no answer', () => {
  const named = fastMore({ question: 'Where is Prenotazioni?', intent: 'where', component: 'Prenotazioni', insights: INSIGHTS, rules: RULES });
  assert.match(named.answer, /^Prenotazioni is in frontend\/src\/app\/features\/booking\/, backend\/src\/main\/java\/com\/mediagenda\/booking\//);
  const byWords = fastMore({ question: 'Where is the code for the booking list?', intent: 'where', insights: INSIGHTS, rules: RULES, files: FILES });
  assert.match(byWords.answer, /^The files that match frontend\/src\/app\/features\/booking\/booking-list\.component\.ts, frontend\/src\/app\/features\/booking\/booking-list\.component\.html\. Component: Prenotazioni\. Who knows it: Marta Ricci/);
  assert.doesNotMatch(byWords.answer, /spec|e2e/, 'tests are not where the code is');
  const both = fastMore({ question: 'Where is the code for the booking list?', intent: 'where', component: 'Prenotazioni', insights: INSIGHTS, rules: RULES, files: FILES });
  assert.match(both.answer, /^The files that match frontend\/src\/app\/features\/booking\/booking-list\.component\.ts/, 'the precise file wins over the whole component');
  assert.match(named.answer, /timeslot\/Availab\*/, 'a rule path that starts file names is shown as such');
  assert.equal(fastMore({ question: 'Where is the list?', intent: 'where', insights: INSIGHTS, rules: RULES, files: FILES }), null, 'one short word: not sure');
  assert.match(fastMore({ question: 'Where is the BookingController?', intent: 'where', insights: INSIGHTS, rules: RULES, files: FILES }).answer, /^It is in backend\/src\/main\/java\/com\/mediagenda\/booking\/BookingController\.java\./, 'one distinctive word, one folder');
  assert.equal(fastMore({ question: 'Where is the booking code?', intent: 'where', insights: INSIGHTS, rules: RULES, files: FILES }), null, 'one word, files in two folders (frontend and backend): not sure');
  assert.equal(fastMore({ question: 'Where is the invoice export?', intent: 'where', insights: INSIGHTS, rules: RULES, files: FILES }), null, 'nothing matches: the full way');
});
