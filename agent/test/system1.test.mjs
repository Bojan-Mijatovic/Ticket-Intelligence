import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CODE_TYPES, MISSING, NONE, askReporter, askReporterText, compare, completeLabels, componentOfFiles, createSystem1, currentCheckpoint, describeAnswers,
  describeCompare, entryOption, fastAnswer, judgeCandidate, keyOfOption, knownIssue, knownQuestion, knownTestVerdict, languageOf, lightPath, missingInfo,
  nextIndex, notCodeShare, questionsFor, sideOfFiles, stateOf, stillNamesSomeone, strangersOnly, stripTags, summarize, system1Report, trainedQuestions,
  triageComment, urgencyOfPriority, describeWarm, warmSkip, warmVerdict,
} from '../lib/system1.mjs';
import { warmPlan } from '../lib/pipeline.mjs';

const RULES = [
  { name: 'Prenotazioni', paths: ['frontend/src/app/features/booking/', 'backend/src/main/java/com/mediagenda/booking/'] },
  { name: 'Pazienti', paths: ['frontend/src/app/features/patients/', 'backend/src/main/java/com/mediagenda/patient/'] },
];

test('the side tags are taken off the title, so the model has to read the side from the words', () => {
  assert.equal(stripTags('[FE] - Agenda: Search mask: Struttura field'), 'Agenda: Search mask: Struttura field');
  assert.equal(stripTags('[BE][FE] Booking saved twice'), 'Booking saved twice');
  assert.equal(stripTags('FE - change the background color'), 'change the background color');
  assert.equal(stripTags('Il FE non salva'), 'Il FE non salva');
  assert.equal(stateOf({ summary: '[BE] Totals wrong', description: 'x'.repeat(2000) }).length, 'Totals wrong\n\n'.length + 1500);
});

test('the questions: the same words every time; component and known issue only when the project has them', () => {
  const entries = [{ key: 'LAB-8', title: "Women's results flagged with the male reference range" }, { key: 'LAB-23', title: 'Values typed with a decimal comma saved without decimals and much more text than fits' }];
  const q = questionsFor(['Prenotazioni', 'Pazienti'], entries);
  assert.deepEqual(Object.keys(q), ['type', 'side', 'urgency', 'component', 'code', 'known']);
  assert.deepEqual(Object.keys(q.component.criteria), ['Prenotazioni', 'Pazienti']);
  assert.deepEqual(Object.keys(q.code.criteria), ['needs code', 'no code change']);
  assert.deepEqual(Object.keys(q.known.criteria), ["LAB-8 Women's results flagged with the male reference range", 'LAB-23 Values typed with a decimal comma saved without decimals and', NONE]);
  assert.equal(q.type.type, 'choice');
  assert.deepEqual(Object.keys(questionsFor()), ['type', 'side', 'urgency', 'code']);
  assert.deepEqual(questionsFor(['A']).type, questionsFor(['B']).type);
  assert.deepEqual(knownQuestion(entries), q.known);
  assert.equal(entryOption(entries[0]), "LAB-8 Women's results flagged with the male reference range");
  assert.equal(keyOfOption(entryOption(entries[0])), 'LAB-8');
  assert.equal(keyOfOption(NONE), null);
  assert.deepEqual([...CODE_TYPES], ['bug in code', 'change request', 'new requirement']);
});

test('known issue, privacy and the code question are summarised for the decisions', () => {
  const s = summarize({
    code: { choice: 'no code change', probabilities: { 'no code change': 0.8, 'needs code': 0.2 } },
    known: { choice: 'LAB-8 Women', probabilities: { 'LAB-8 Women': 0.82, [NONE]: 0.18 } },
    privacy: { choice: 'names a person', probabilities: { 'names a person': 0.94, 'no person': 0.06 } },
  });
  assert.equal(s.code.notCode, 0.8);
  assert.equal(s.known.key, 'LAB-8');
  assert.deepEqual(knownIssue(s), { key: 'LAB-8', p: 0.82 });
  assert.equal(knownIssue(s, 0.9), null);
  assert.equal(knownIssue(summarize({ known: { choice: NONE, probabilities: { [NONE]: 0.9 } } })), null);
  assert.equal(stillNamesSomeone(s), true);
  assert.equal(stillNamesSomeone(s, 0.95), false);
  assert.equal(stillNamesSomeone(summarize({ privacy: { choice: 'no person', probabilities: { 'no person': 0.9 } } })), false);
  assert.match(describeAnswers({ answers: s }), /known issue LAB-8 82 % · still names a person 94 %/);
});

test('the privacy text masks every name, the team too, and leaves the ones the masking does not know', () => {
  assert.equal(strangersOnly('Davide Greco says patient Giulia Russo is waiting'), '[PERSON_1] says patient [PERSON_2] is waiting');
  assert.match(strangersOnly('La paziente Ferrara Iolanda non trova la dose'), /Ferrara Iolanda/);
  assert.match(strangersOnly('Il signor Bianchi ha chiamato'), /Bianchi/);
});

test('the queue order: tickets by urgency, never past another kind of job', () => {
  const answers = { 'A-1': { urgency: { choice: 'low' } }, 'A-2': { urgency: { choice: 'urgent' } }, 'A-3': { urgency: { choice: 'normal' } } };
  const of = (k) => answers[k];
  const t = (key) => ({ key, kind: 'analyze' });
  assert.equal(nextIndex([t('A-1'), t('A-3'), t('A-2')], of), 2);
  assert.equal(nextIndex([t('A-1'), { key: 'A-9', kind: 'review' }, t('A-2')], of), 0); // not past the review
  assert.equal(nextIndex([{ key: 'A-9', kind: 'known-test' }, t('A-2')], of), 0);
  assert.equal(nextIndex([t('A-3'), t('X-1')], of), 0); // no answer yet counts as normal: the older stays first
  assert.equal(nextIndex([], of), 0);
});

test("a known issue's test verdict is read from the knowledge-tests output", () => {
  const out = 'MediLab (LAB) · main 1a2b3c4 · 1 entries, 1 with regression tests\n  JUnit: 1 test(s) ran in 40 s\n  LAB-8    ✗ KNOWN ISSUE MAY BE BACK\n      backend/…/ResultServiceTest.java: fail\n  → 0 pass · 1 fail';
  assert.equal(knownTestVerdict(out, 'LAB-8'), 'fail');
  assert.equal(knownTestVerdict('  LAB-8    ✓\n', 'LAB-8'), 'pass');
  assert.equal(knownTestVerdict('  LAB-8    ? did not run\n', 'LAB-8'), 'not-run');
  assert.equal(knownTestVerdict('  LAB-80   ✓\n', 'LAB-8'), 'none');
});

test('the light path comment says what it was recognised as and how to get the full analysis', () => {
  const c = triageComment(summarize({
    type: { choice: 'system support', probabilities: { 'system support': 0.62, 'bug in code': 0.38 } },
    side: { choice: 'not code', probabilities: { 'not code': 0.76, backend: 0.24 } },
    code: { choice: 'no code change', probabilities: { 'no code change': 0.9, 'needs code': 0.1 } },
    urgency: { choice: 'urgent', probabilities: { urgent: 0.5, normal: 0.5 } },
  }));
  assert.match(c, /recognised as \*system support\* \(62 %\), so no code analysis was run/);
  assert.match(c, /needs code\? no code change \(90 %\)/);
  assert.match(c, /Run again/);
});

test('Ask: "who" and "latest" answered from the Insights data, other intents left to Claude', () => {
  const insights = {
    components: [{ name: 'Campioni', busFactor: 1, team: [{ name: 'Elena Russo', commits: 6, share: 75 }, { name: 'Marco Neri', commits: 2, share: 25 }] }],
    people: [{ name: 'Elena Russo', last: '2026-11-10T09:00:00Z' }],
    tickets: [
      { key: 'LAB-6', type: 'Bug', status: 'Done', summary: 'Sample not found', components: ['Campioni'] },
      { key: 'LAB-12', type: 'Bug', status: 'Done', summary: 'Request stuck', components: ['Campioni'] },
      { key: 'LAB-20', type: 'Story', status: 'Done', summary: 'New report', components: ['Risultati'] },
    ],
  };
  const who = fastAnswer({ question: 'Chi conosce i campioni?', intent: 'who', component: 'Campioni', insights, ticketUrl: (k) => `https://j/${k}` });
  assert.equal(who.fast, true);
  assert.match(who.answer, /Elena Russo \(75 % of its commits, last commit 2026-11-10\), Marco Neri \(25 %/);
  assert.match(who.answer, /bus factor 1/);
  assert.deepEqual(who.sources.map((s) => s.ref), ['LAB-12', 'LAB-6']);
  assert.equal(fastAnswer({ question: 'who?', intent: 'who', component: null, insights }), null);
  const latest = fastAnswer({ question: 'show me last bug ?', intent: 'latest', insights });
  assert.match(latest.answer, /^The newest bugs, newest first: LAB-12/);
  assert.ok(!latest.answer.includes('LAB-20'));
  assert.match(fastAnswer({ question: 'What came in today?', intent: 'latest', insights }).answer, /^The newest tickets, newest first: LAB-20/);
  assert.equal(fastAnswer({ question: 'how?', intent: 'how', insights }), null);
});

test('answers are summarised with their top three, and the type answer carries the share of not-code types', () => {
  const s = summarize({
    type: { choice: 'bug in code', probabilities: { 'bug in code': 0.6, 'system support': 0.25, 'user question': 0.1, unclear: 0.05 } },
    side: { choice: 'frontend', probabilities: { frontend: 0.7, backend: 0.2, both: 0.1 } },
  });
  assert.deepEqual(s.type.top, [['bug in code', 0.6], ['system support', 0.25], ['user question', 0.1]]);
  assert.equal(s.type.p, 0.6);
  assert.equal(s.type.notCode, 0.4);
  assert.equal(s.side.notCode, 0);
  assert.equal(notCodeShare({ 'bug in code': 0.1, 'change request': 0.1, unclear: 0.8 }), 0.8);
  assert.equal(describeAnswers({ answers: s, ms: 1284 }), 'bug in code 60 % · frontend 70 % · 1.3 s');
});

test('the light path needs both answers to say "no change in the code", each at the threshold', () => {
  const answers = (typeNotCode, sideNotCode) => summarize({
    type: { choice: 'user question', probabilities: { 'user question': typeNotCode, 'bug in code': 1 - typeNotCode } },
    side: { choice: 'not code', probabilities: { 'not code': sideNotCode, frontend: 1 - sideNotCode } },
  });
  assert.equal(lightPath(answers(0.97, 0.74)), true); // DEM-46, a how-to question
  assert.equal(lightPath(answers(0.23, 0.66)), false); // FAR-21: the type says new requirement
  assert.equal(lightPath(answers(0.66, 0.41)), false); // BIL-21: the side is not sure
  assert.equal(lightPath(answers(0.97, 0.74), 0.8), false);
  assert.equal(lightPath({}), false);
  // With the code question, all three must agree; one signal alone is never enough.
  const withCode = (typeNC, sideNC, codeNC) => ({ ...answers(typeNC, sideNC), code: { notCode: codeNC } });
  assert.equal(lightPath(withCode(0.97, 0.74, 0.9)), true);
  assert.equal(lightPath(withCode(0.97, 0.74, 0.3)), false);
  assert.equal(lightPath({ code: { notCode: 0.99 } }), false);
  assert.equal(describeAnswers({ answers: answers(0.97, 0.74), ms: 1500, lightPath: true }), 'user question 97 % · not code 74 % · 1.5 s · would take the light path');
});

test('side and component come from the files the analysis names; tests, e2e and other projects do not count', () => {
  assert.equal(sideOfFiles(['frontend/src/app/features/booking/list.component.ts:42']), 'frontend');
  assert.equal(sideOfFiles(['backend/src/main/java/com/mediagenda/booking/BookingService.java', 'frontend/src/app/x.ts']), 'both');
  assert.equal(sideOfFiles(['e2e/tests/DEM-9.spec.ts', 'LAB:backend/src/main/java/A.java']), null);
  assert.equal(sideOfFiles([]), null);
  const files = ['backend/src/main/java/com/mediagenda/booking/BookingService.java', 'frontend/src/app/features/booking/a.ts', 'frontend/src/app/features/patients/b.ts'];
  assert.equal(componentOfFiles(files, RULES), 'Prenotazioni');
  assert.equal(componentOfFiles(['docs/README.md'], RULES), null);
});

test('compare: agreement with the analysis and the Jira priority, and null where there is nothing to compare', () => {
  const s1 = summarize({
    type: { choice: 'bug in code', probabilities: { 'bug in code': 0.9, unclear: 0.1 } },
    side: { choice: 'backend', probabilities: { backend: 0.8, frontend: 0.2 } },
    component: { choice: 'Pazienti', probabilities: { Pazienti: 0.7, Prenotazioni: 0.3 } },
    urgency: { choice: 'normal', probabilities: { normal: 0.6, urgent: 0.4 } },
  });
  const c = compare(s1, { result: { files: ['backend/src/main/java/com/mediagenda/booking/BookingService.java'] }, priority: 'High', rules: RULES });
  assert.equal(c.code, undefined);
  assert.deepEqual(c.side, { s1: 'backend', other: 'backend', agree: true });
  assert.deepEqual(c.component, { s1: 'Pazienti', other: 'Prenotazioni', agree: false });
  assert.deepEqual(c.urgency, { s1: 'normal', other: 'urgent', agree: false });
  assert.equal(describeCompare(c), 'agrees with the analysis on side; component Pazienti, the analysis says Prenotazioni; urgency normal, Jira says urgent');
  const none = compare(s1, { result: { files: [] }, priority: null, rules: RULES });
  assert.equal(none.side.agree, null);
  assert.equal(describeCompare(none), 'nothing to compare with the analysis');
  // Only differences: they are said, not "nothing to compare" (FAR-20 on 2026-11-15).
  const differ = compare(s1, { result: { files: ['frontend/src/app/features/booking/a.ts'] }, priority: 'Medium', rules: RULES });
  assert.equal(describeCompare(differ), 'side backend, the analysis says frontend; component Pazienti, the analysis says Prenotazioni; urgency as in Jira');
  // "not code" has no side to compare: the analysis names files even for a how-to question.
  const howTo = summarize({ side: { choice: 'not code', probabilities: { 'not code': 0.74, frontend: 0.26 } } });
  assert.deepEqual(compare(howTo, { result: { files: ['frontend/src/app/x.ts'] } }).side, { s1: 'not code', other: 'frontend', agree: null });
  assert.equal(urgencyOfPriority('Highest'), 'urgent');
  assert.equal(urgencyOfPriority('Lowest'), 'low');
});

test('the report: what the light path would have saved, known-issue tests, fast Ask answers, calibration', () => {
  const events = [
    { type: 'system1', key: 'DEM-46', lightPath: true, ms: 2000 },
    { type: 'analyzed', key: 'DEM-46', meta: { costUsd: 0.21, durationMs: 42000 } },
    { type: 'notified', key: 'DEM-46' },
    { type: 'system1', key: 'LAB-30', lightPath: false, ms: 1000, known: { key: 'LAB-8', p: 0.8 } },
    { type: 'known-test', key: 'LAB-30', status: 'running' },
    { type: 'known-test', key: 'LAB-30', status: 'fail' },
    { type: 'system1', key: 'VAX-20', ms: 1500, privacy: { hold: true } },
    { type: 'analyzed', key: 'DEM-1', meta: { costUsd: 9 } }, // no System 1 answer: not counted
  ];
  const evaluation = {
    label: 'ft-2',
    scores: { type: { n: 2, accuracy: 0.5, majority: 0.5 }, 'known/lab8': { n: 4, right: 3 }, 'privacy/errors': { names_missed: ['P-1'] } },
    gate: { 'type+side+code@0.5': { not_code_caught: '15/23', code_wrongly_skipped: [] } },
    results: [{ expected: { type: 'a' }, answers: { type: { choice: 'a', p: 0.95 } } }, { expected: { type: 'a' }, answers: { type: { choice: 'b', p: 0.62 } } }],
  };
  const r = system1Report({ events, asks: [{ fast: true, durationMs: 1800 }, {}], evaluation, checkpoint: { name: 'ft-2' }, policy: { system1: { lightPathThreshold: 0.5 } } });
  assert.equal(r.tickets, 3);
  assert.equal(r.modelSeconds, 1.5);
  assert.deepEqual(r.lightPath, { tickets: ['DEM-46'], claudeCostUsd: 0.21, claudeMinutes: 0.7, ownerNotices: 1 });
  assert.deepEqual(r.known.tests, { pass: 0, fail: 1, 'not-run': 0 });
  assert.deepEqual(r.privacy.wouldHold, ['VAX-20']);
  assert.deepEqual(r.ask, { fast: 1, all: 2, seconds: 1.8 });
  assert.deepEqual(r.evaluation.known, { lab8: '3/4' });
  assert.equal(r.evaluation.privacyMissed, 1);
  assert.equal(r.evaluation.lightPath.rule, 'type+side+code@0.5');
  assert.deepEqual(r.evaluation.calibration.map((b) => [b.from, b.n, b.right]), [[0.6, 1, 0], [0.9, 1, 1]]);
});

test('J10: the side skips a warm-up only at the threshold, and only "backend" or "not code"', () => {
  const side = (choice, p) => ({ side: { choice, p } });
  assert.deepEqual(warmSkip(side('backend', 0.82)), { side: 'backend', p: 0.82, prepare: true, warm: false });
  assert.deepEqual(warmSkip(side('not code', 0.7)), { side: 'not code', p: 0.7, prepare: false, warm: false });
  assert.equal(warmSkip(side('backend', 0.69)), null);
  assert.equal(warmSkip(side('backend', 0.82), 0.9), null);
  assert.equal(warmSkip(side('frontend', 0.99)), null);
  assert.equal(warmSkip(side('both', 0.99)), null);
  assert.equal(warmSkip({ side: { choice: 'backend' } }), null); // no probability: nothing to trust
  assert.equal(warmSkip(null), null);
});

test('J10: the warm-up call is wrong only when the fix needed what was skipped', () => {
  const backend = { prepare: true, warm: false };
  const notCode = { prepare: false, warm: false };
  const none = { prepare: false, warm: false };
  assert.equal(warmVerdict(backend, none), 'right');
  assert.equal(warmVerdict(backend, { prepare: true, warm: false }), 'right'); // a backend fix: no dev server needed
  assert.equal(warmVerdict(backend, { prepare: true, warm: true }), 'wrong'); // a frontend fix started a cold server
  assert.equal(warmVerdict(notCode, none), 'right');
  assert.equal(warmVerdict(notCode, { prepare: true, warm: false }), 'wrong');
});

test('J10: the card says what was or would have been skipped, and then whether it was right', () => {
  const backend = { side: 'backend', p: 0.82, would: { prepare: true, warm: false } };
  const notCode = { side: 'not code', p: 0.88, would: { prepare: false, warm: false } };
  assert.equal(describeWarm({ ...backend, mode: 'shadow' }), 'System 1: backend (82 %): would warm no dev server (shadow: warmed as before)');
  assert.equal(describeWarm({ ...backend, mode: 'auto' }), 'System 1: backend (82 %): worktree only, no dev server warmed');
  assert.equal(describeWarm({ ...notCode, mode: 'shadow' }), 'System 1: not code (88 %): would prepare no fix workspace (shadow: prepared as before)');
  assert.equal(describeWarm({ ...notCode, mode: 'auto' }), 'System 1: not code (88 %): no fix workspace prepared');
  assert.equal(describeWarm({ ...notCode, mode: 'auto', verdict: 'right', needed: { prepare: false, warm: false, side: null } }), 'warm-up call right: no automatic fix followed');
  assert.equal(describeWarm({ ...backend, mode: 'auto', verdict: 'right', needed: { prepare: true, warm: false, side: 'backend' } }), 'warm-up call right: the fix was on the backend, no dev server needed');
  assert.equal(describeWarm({ ...backend, mode: 'auto', verdict: 'wrong', needed: { prepare: true, warm: true, side: 'frontend' } }), 'warm-up call wrong: a frontend fix followed, which prepared its own dev server');
  assert.equal(describeWarm({ ...notCode, mode: 'shadow', verdict: 'wrong', needed: { prepare: true, warm: false, side: 'backend' } }), 'warm-up call wrong: a backend fix followed, which would have prepared its own workspace');
});

test('J10: the plan follows the title when it states the side, and System 1 only for a title that does not', () => {
  const policy = (warmBySide, extra = {}) => ({ actions: { proposeFix: 'auto' }, proposeFixWhen: { titleTags: ['FE', 'BE'], inferTagFromFiles: { FE: 'frontend/', BE: 'backend/' } }, system1: { ...(warmBySide ? { warmBySide } : {}), ...extra } });
  const issue = (summary) => ({ summary });
  const side = (choice, p) => ({ side: { choice, p } });
  const auto = policy('auto');

  // The title decides; System 1 is not even mentioned.
  assert.deepEqual(warmPlan({ issue: issue('[FE] - x'), policy: auto, answers: side('backend', 0.95) }), { prepare: true, warm: true, system1: null });
  assert.deepEqual(warmPlan({ issue: issue('[BE] - x'), policy: auto, answers: side('frontend', 0.95) }), { prepare: true, warm: false, system1: null });
  assert.deepEqual(warmPlan({ issue: issue('[BE][FE] - x'), policy: auto, answers: side('not code', 0.95) }), { prepare: true, warm: true, system1: null });
  // A title with another tag only is not prepared at all (the title rules), whatever System 1 says.
  assert.deepEqual(warmPlan({ issue: issue('[SVIL] - x'), policy: auto, answers: side('frontend', 0.95) }), { prepare: false, warm: false, system1: null });
  // No automatic fix: nothing to prepare.
  assert.deepEqual(warmPlan({ issue: issue('x'), policy: { ...auto, actions: { proposeFix: 'off' } }, answers: side('backend', 0.95) }), { prepare: false, warm: false, system1: null });

  // An untagged title: as before without an answer, below the threshold, or for frontend/both.
  const before = { prepare: true, warm: true, system1: null };
  assert.deepEqual(warmPlan({ issue: issue('x'), policy: auto }), before);
  assert.deepEqual(warmPlan({ issue: issue('x'), policy: auto, answers: side('backend', 0.6) }), before);
  assert.deepEqual(warmPlan({ issue: issue('x'), policy: auto, answers: side('frontend', 0.9) }), before);
  assert.deepEqual(warmPlan({ issue: issue('x'), policy: auto, answers: side('both', 0.9) }), before);
  assert.deepEqual(warmPlan({ issue: issue('x'), policy: policy('auto', { warmBySideThreshold: 0.9 }), answers: side('backend', 0.82) }), before);

  // auto acts.
  assert.deepEqual(warmPlan({ issue: issue('x'), policy: auto, answers: side('backend', 0.82) }), { prepare: true, warm: false, system1: { side: 'backend', p: 0.82, mode: 'auto', would: { prepare: true, warm: false } } });
  assert.deepEqual(warmPlan({ issue: issue('x'), policy: auto, answers: side('not code', 0.88) }), { prepare: false, warm: false, system1: { side: 'not code', p: 0.88, mode: 'auto', would: { prepare: false, warm: false } } });
  // shadow (also the default) prepares as before and only says what it would skip; off does not ask.
  const shadow = { prepare: true, warm: true, system1: { side: 'backend', p: 0.82, mode: 'shadow', would: { prepare: true, warm: false } } };
  assert.deepEqual(warmPlan({ issue: issue('x'), policy: policy('shadow'), answers: side('backend', 0.82) }), shadow);
  assert.deepEqual(warmPlan({ issue: issue('x'), policy: policy(null), answers: side('backend', 0.82) }), shadow);
  assert.deepEqual(warmPlan({ issue: issue('x'), policy: policy('off'), answers: side('backend', 0.82) }), before);
});

test('J10 in the report: runs skipped or that would have been, and their checks; a run again counts on its own', () => {
  const events = [
    { type: 'system1-warm', key: 'DEM-46', mode: 'shadow' },
    { type: 'system1-warm', key: 'DEM-46', mode: 'shadow', verdict: 'right' },
    { type: 'system1-warm', key: 'LAB-30', mode: 'auto' },
    { type: 'system1-warm', key: 'LAB-30', mode: 'auto', verdict: 'wrong' },
    { type: 'system1-warm', key: 'LAB-30', mode: 'auto' }, // Run again
    { type: 'system1-warm', key: 'LAB-30', mode: 'auto', verdict: 'wrong' },
    { type: 'system1-warm', key: 'BIL-23', mode: 'shadow' }, // still running: no check yet
    { type: 'system1-warm', key: 'FAR-9', mode: 'auto', verdict: 'right' }, // a check without its decision (log rotated): not counted
  ];
  assert.deepEqual(system1Report({ events }).warm, { tickets: ['DEM-46', 'LAB-30', 'BIL-23'], skipped: 2, wouldSkip: 2, right: 1, wrong: 2, wrongTickets: ['LAB-30'] });
  assert.deepEqual(system1Report({ events: [] }).warm, { tickets: [], skipped: 0, wouldSkip: 0, right: 0, wrong: 0, wrongTickets: [] });
});

test('the current checkpoint: the accepted one when there is one, else the configured one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ti-s1-'));
  const cfg = { system1: { checkpoint: 'state/system1/models/ft-1' } };
  assert.equal(currentCheckpoint({ agentDir: dir, stateDir: join(dir, 'state'), cfg }).name, 'ft-1');
  mkdirSync(join(dir, 'state', 'system1', 'models', 'ft-2'), { recursive: true });
  writeFileSync(join(dir, 'state', 'system1', 'models', 'current.json'), JSON.stringify({ name: 'ft-2' }));
  assert.equal(currentCheckpoint({ agentDir: dir, stateDir: join(dir, 'state'), cfg }).name, 'ft-2');
  writeFileSync(join(dir, 'state', 'system1', 'models', 'current.json'), JSON.stringify({ name: 'gone' }));
  assert.equal(currentCheckpoint({ agentDir: dir, stateDir: join(dir, 'state'), cfg }).name, 'ft-1'); // a missing folder is not used
});

test('a new checkpoint replaces the current one only when it skips no code ticket and is not worse', () => {
  const ev = (acc, wrong = [], missed = 1) => ({
    scores: { type: { accuracy: acc }, side: { accuracy: 0.7 }, 'privacy/errors': { names_missed: Array(missed).fill('P') } },
    gate: { 'type+side+code@0.5': { not_code_caught: '15/23', code_wrongly_skipped: wrong } },
  });
  assert.equal(judgeCandidate(ev(0.7), ev(0.66)).accept, true);
  assert.equal(judgeCandidate(ev(0.7), null).accept, true);
  assert.equal(judgeCandidate(ev(0.64), ev(0.66)).accept, false); // 2 points worse
  assert.equal(judgeCandidate(ev(0.655), ev(0.66)).accept, true); // within 1 point
  // With 47 held-out tickets one ticket is 2.1 points: one ticket less is within the tolerance, two are not.
  const of47 = (side) => ({ ...ev(0.7), scores: { ...ev(0.7).scores, side: { n: 47, accuracy: side } } });
  const one = judgeCandidate(of47(0.702), of47(0.723));
  assert.equal(one.accept, true);
  assert.ok(one.lines.some((l) => /side: 70 % \(current 72 %\) \(lower, within one item\)/.test(l)));
  assert.equal(judgeCandidate(of47(0.681), of47(0.723)).accept, false);
  const skip = judgeCandidate(ev(0.8, ['DEM-4']), ev(0.66));
  assert.equal(skip.accept, false);
  assert.match(skip.lines[0], /DEM-4/);
  assert.equal(judgeCandidate(ev(0.7, [], 3), ev(0.66, [], 1)).accept, false); // misses more names
  assert.equal(judgeCandidate({ scores: {}, gate: {} }, null).accept, false); // no light-path evaluation at all
});

const jira = { getIssue: async (key) => ({ key, summary: '[FE] Lista prenotazioni vuota', description: 'Dopo il filtro per data la lista resta vuota.' }) };

test('off in the policy, or without Python or a trained model: no answers, and the reason says why', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ti-s1-'));
  const off = createSystem1({ cfg: {}, policy: {}, agentDir: dir, stateDir: dir });
  assert.equal(off.mode, 'off');
  assert.equal(await off.intake({ issue: { key: 'DEM-1' }, jira }), null);
  const noPython = createSystem1({ cfg: { system1: { python: 'missing.exe' } }, policy: { system1: { intake: 'shadow' } }, agentDir: dir, stateDir: dir });
  assert.equal(await noPython.intake({ issue: { key: 'DEM-1' }, jira }), null);
  assert.match(noPython.reason, /no Python/);
  const noModel = createSystem1({ cfg: { system1: { python: process.execPath, checkpoint: 'none' } }, policy: { system1: { intake: 'shadow' } }, agentDir: dir, stateDir: dir });
  assert.equal(await noModel.start(), false);
  assert.match(noModel.reason, /no trained checkpoint/);
});

test('a healthy server with the same checkpoint is reused, and a ticket is asked with its masked text and the questions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ti-s1-'));
  const checkpoint = join(dir, 'ft');
  mkdirSync(checkpoint);
  writeFileSync(join(checkpoint, 'config.json'), '{}');
  // What laya-train saves: the questions it was trained on (here not J7's, and not the Ask intent).
  writeFileSync(join(checkpoint, 'questions.json'), JSON.stringify(Object.fromEntries(['type', 'side', 'urgency', 'component', 'code', 'known', 'privacy'].map((q) => [q, {}]))));
  const asked = [];
  let calls = 0;
  const server = createServer((req, res) => {
    if (req.url === '/health') return res.end(JSON.stringify({ ok: true, checkpoint, pid: 1 }));
    // The first question is cut off, as a network failure would: the client asks once more.
    if (++calls === 1) return req.socket.destroy();
    let body = '';
    req.on('data', (d) => (body += d)).on('end', () => {
      const b = JSON.parse(body);
      asked.push(b);
      res.end(JSON.stringify(b.questions.privacy
        ? { ms: 300, answers: { privacy: { choice: 'no person', probabilities: { 'no person': 0.9, 'names a person': 0.1 } } } }
        : { ms: 900, answers: { type: { choice: 'bug in code', probabilities: { 'bug in code': 0.8, unclear: 0.2 } }, side: { choice: 'frontend', probabilities: { frontend: 0.9, backend: 0.1 } } } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const s1 = createSystem1({ cfg: { system1: { port: server.address().port, python: process.execPath, checkpoint } }, policy: { system1: { intake: 'shadow' } }, agentDir: dir, stateDir: dir });
    const a = await s1.intake({ issue: { key: 'DEM-7' }, jira, components: ['Prenotazioni'], entries: [{ key: 'DEM-5', title: 'PULISCI does not clear the Struttura selection' }] });
    assert.equal(asked[0].state, 'Lista prenotazioni vuota\n\nDopo il filtro per data la lista resta vuota.');
    assert.deepEqual(Object.keys(asked[0].questions), ['type', 'side', 'urgency', 'component', 'code', 'known']);
    assert.deepEqual(Object.keys(asked[1].questions), ['privacy']);
    assert.equal(a.answers.side.choice, 'frontend');
    assert.equal(a.answers.type.notCode, 0.2);
    assert.equal(a.answers.privacy.choice, 'no person');
    assert.equal(a.ms, 1200);
    assert.equal(a.model, 'ft');
    assert.equal(a.lightPath, false);
    assert.equal(calls, 3);
  } finally {
    server.close();
  }
});

test('only the questions the checkpoint was trained on are asked: J7 with a checkpoint that knows it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ti-s1-'));
  const checkpoint = join(dir, 'ft');
  mkdirSync(checkpoint);
  writeFileSync(join(checkpoint, 'config.json'), '{}');
  writeFileSync(join(checkpoint, 'questions.json'), JSON.stringify(Object.fromEntries(['type', 'side', 'urgency', 'steps', 'expected', 'screen', 'environment'].map((q) => [q, {}]))));
  assert.deepEqual([...trainedQuestions(checkpoint)].sort(), ['environment', 'expected', 'screen', 'side', 'steps', 'type', 'urgency']);
  assert.equal(trainedQuestions(join(dir, 'none')), null);
  const asked = [];
  const server = createServer((req, res) => {
    if (req.url === '/health') return res.end(JSON.stringify({ ok: true, checkpoint, pid: 1 }));
    let body = '';
    req.on('data', (d) => (body += d)).on('end', () => {
      asked.push(JSON.parse(body));
      res.end(JSON.stringify({ ms: 100, answers: { expected: { choice: 'not what is wrong', probabilities: { 'not what is wrong': 0.8, 'tells what is wrong': 0.2 } } } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const s1 = createSystem1({ cfg: { system1: { port: server.address().port, python: process.execPath, checkpoint } }, policy: { system1: { intake: 'shadow' } }, agentDir: dir, stateDir: dir });
    const a = await s1.intake({ issue: { key: 'DEM-7' }, jira, components: ['Prenotazioni'], entries: [{ key: 'DEM-5', title: 'PULISCI' }] });
    // No component, code or known question (not trained), no privacy call (not trained); the four of J7.
    assert.deepEqual(Object.keys(asked[0].questions), ['type', 'side', 'urgency', 'steps', 'expected', 'screen', 'environment']);
    assert.equal(asked.length, 1);
    assert.equal(a.text, 'Lista prenotazioni vuota\n\nDopo il filtro per data la lista resta vuota.');
  } finally {
    server.close();
  }
});

test('J7: the reporter is asked when a report about code does not tell what is wrong or where, in its language', () => {
  const ans = (type, code, missing, p = 0.8) => ({
    type: { choice: type, p: 0.7 }, code: { choice: code, p: 0.8 },
    ...Object.fromEntries(Object.entries(MISSING).map(([q, o]) => [q, { choice: missing.includes(q) ? o : 'present', p }])),
  });
  assert.deepEqual(completeLabels(['steps', 'environment']), { steps: 'no steps', expected: 'tells what is wrong', screen: 'names the screen', environment: 'no where or when' });
  assert.deepEqual(Object.keys(questionsFor([], [], { complete: true })).slice(-4), ['steps', 'expected', 'screen', 'environment']);
  assert.ok(!('steps' in questionsFor()));
  // "Mi dà errore quando prescrivo": steps, what is wrong and where/when missing.
  assert.deepEqual(askReporter(ans('bug in code', 'needs code', ['steps', 'expected', 'environment'])), { missing: ['steps', 'expected', 'environment'] });
  // "The Ricevute page shows 22.5": no steps, no environment, but what is wrong and where are there: no question.
  assert.equal(askReporter(ans('bug in code', 'needs code', ['steps', 'environment'])), null);
  // Not sure enough of the missing answers.
  assert.equal(askReporter(ans('bug in code', 'needs code', ['expected'], 0.55)), null);
  assert.deepEqual(missingInfo(ans('bug in code', 'needs code', ['expected'], 0.55), 0.5), ['expected']);
  // A user question that names no screen is not a half-written bug report; an unclear ticket is asked.
  assert.equal(askReporter(ans('user question', 'no code change', ['screen'])), null);
  // BIL-23 with ft-5: the type says bug in code, the code question no code change; one of them is enough.
  assert.deepEqual(askReporter(ans('bug in code', 'no code change', ['steps', 'expected', 'environment'])), { missing: ['steps', 'expected', 'environment'] });
  assert.deepEqual(askReporter(ans('system support', 'needs code', ['expected'])), { missing: ['expected'] });
  // W-95, "Verificare per favore.": no type is sure (system support 24 %), so it counts as unclear and is asked; the
  // same answers with a sure type are not.
  const vagueType = (p) => ({ ...ans('system support', 'no code change', ['steps', 'expected', 'screen', 'environment']), type: { choice: 'system support', p } });
  assert.equal(askReporter(vagueType(0.24)).missing.length, 4);
  assert.equal(askReporter(vagueType(0.8)), null);
  assert.deepEqual(askReporter(ans('unclear', 'no code change', ['steps', 'expected', 'screen', 'environment'])).missing.length, 4);
  // W-114 with ft-4, "Something is wrong with the doses, please check.": unclear, not code, no code change, all sure;
  // it goes to the reporter, never down the light path. A complete how-to question still takes it.
  const vague = { ...ans('unclear', 'no code change', ['steps', 'expected', 'environment']), type: { choice: 'unclear', p: 0.66, notCode: 0.85 }, side: { choice: 'not code', p: 0.89, notCode: 0.89 }, code: { choice: 'no code change', p: 0.84, notCode: 0.84 } };
  assert.equal(lightPath(vague), false);
  assert.equal(lightPath(vague, 0.5, { askThreshold: 0.95 }), true);
  assert.equal(lightPath({ ...vague, ...ans('user question', 'no code change', ['steps', 'environment']), type: { choice: 'user question', p: 0.9, notCode: 0.95 }, side: vague.side, code: vague.code }), true);
  // The question: a template in the report's language, the missing fields only, never the patient's name.
  const it = askReporterText({ missing: ['expected', 'environment'], text: 'Errore in Nuova prescrizione\n\nMi dà errore quando prescrivo.' });
  assert.match(it, /^Buongiorno/);
  assert.match(it, /che cosa si aspettava/);
  assert.match(it, /non il nome del paziente/);
  assert.doesNotMatch(it, /schermata/);
  const en = askReporterText({ missing: ['screen'], text: 'It crashes when I click the button.' });
  assert.match(en, /^Hello/);
  assert.match(en, /On which screen/);
  assert.equal(languageOf(''), 'en');
});

test('a question with no answer in time is not asked again: the server would only work on it twice', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ti-s1-'));
  const checkpoint = join(dir, 'ft');
  mkdirSync(checkpoint);
  writeFileSync(join(checkpoint, 'config.json'), '{}');
  let decides = 0;
  const server = createServer((req, res) => {
    if (req.url === '/health') return res.end(JSON.stringify({ ok: true, checkpoint, pid: 1 }));
    decides++; // never answers
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const s1 = createSystem1({ cfg: { system1: { port: server.address().port, python: process.execPath, checkpoint, timeoutSeconds: 0.3 } }, policy: { system1: { intake: 'shadow' } }, agentDir: dir, stateDir: dir });
    await assert.rejects(s1.decide('text', { privacy: {} }), /asking the model: no answer in time/);
    assert.equal(decides, 1);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
