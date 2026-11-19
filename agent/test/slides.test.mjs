import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// slides.js is a browser script: run it with a window of its own and read what it defines.
const here = dirname(fileURLToPath(import.meta.url));
const window = {};
vm.runInNewContext(readFileSync(join(here, '..', 'dashboard', 'slides.js'), 'utf8'), { window });
const { slides, deck, STEPS } = window.TourSlides;

// The records of the presentation, in the shape /api/tour/facts, /api/impact and /api/ask/stats give them.
const facts = {
  case: {
    key: 'VAX-21', title: '[BE] - Scheda paziente: the third <ESA> dose is due too early', priority: 'High', reportedAt: '2026-11-16T16:04:05Z',
    report: { masked: 'The card of [PERSON_1] Laura (CF [FISCAL_CODE_1], [BIRTH_DATE_1]) says the dose is late.', original: 'The card of De Luca Laura (CF DLCLRA26D68F205F, 28/04/2026) says the dose is late.', quoted: 3, maskedCount: 3 },
    breaking: { story: 'VAX-20', commit: '6e8e6e1', author: 'Irene Fabbri', checks: 'backend tests pass (22)', guard: 'regression guard: 6e8e6e1 "VAX-20: take the last dose": touches no earlier bug fix' },
    t: { picked: 67, analyzed: 117, notified: 118, reproduced: 213, bisected: 236, verified: 310, pr: 316, fixNotified: 319, reviewed: 363, merged: 3042, resolved: 3627, documented: 4374, docsMerged: 14871, analysis: 49 },
    system1: { ms: 3200, answers: { type: { choice: 'bug in code', p: 0.84 }, side: { choice: 'backend', p: 0.46 }, component: { choice: 'Scheda e dosi', p: 0.65 }, urgency: { choice: 'urgent', p: 0.52 }, known: { choice: 'none of these', p: 0.88 }, expected: { choice: 'tells what is wrong', p: 0.97 }, screen: { choice: 'names the screen', p: 0.96 }, privacy: { choice: 'no person', p: 0.97 } } },
    analysis: { confidence: 'high', owner: { name: 'Irene Fabbri', why: 'She authored VAX-20 (6e8e6e1), the regression, and is the most recent author.' }, cause: 'Commit 6e8e6e1 replaced the lookup.', file: 'backend/src/main/java/com/medivax/schedule/Schedule.java:28' },
    priorArt: { kind: 'regression', key: 'VAX-5' },
    reproduced: 'bug reproduced: the card shows ESA dose 3 due 2026-09-05 (first dose + 60 days) instead of 2026-11-20 (second dose + 60 days).',
    bisected: 'bisect: broken by 6e8e6e1 "VAX-20: take the last dose" (2026-11-16, Irene Fabbri): the test passes on ad0251f and fails from that commit on (1 test run(s), 22 s)',
    verified: 'e2e not needed · build skipped · backend 24 tests ok',
    prUrl: 'https://github.com/x/MediVax/pull/7',
    cards: { owner: { to: 'Irene Fabbri' }, fix: { to: 'Irene Fabbri', title: 'VAX-21: fix ready for review', message: 'VAX-21: Compute the next dose from the latest dose', tests: 'a new test failed before the fix and passes after it; 24 backend tests pass', broke: '6e8e6e1 (VAX-20) by Irene Fabbri' } },
    review: { risk: 'low', verdict: 'looks-good', findings: 1, finding: 'Both tests use callers that pass ascending lists. More text.' },
    docs: { entry: { file: 'docs/knowledge/scheda-e-dosi.md', title: 'Next dose due too early', test: '`backend/src/test/java/com/medivax/regression/Vax21RegressionTest.java`', confirmed: true, assumed: true, fields: ['Type', 'Symptom', 'Root cause', 'Fix', 'How to verify', 'Test', 'Prevent recurrence'] } },
    costUsd: 2.32,
  },
  teams: { answer: { question: 'ti: VAX-21', answer: 'VAX-21 · the third ESA dose\nJira: Done\n\nWhat happened\n· analysed', secs: 2 }, decisions: [] },
  live: 'VAX-23',
  system1: [
    { key: 'BIL-28', title: 'Problema in cassa', report: 'Oggi non va, controllate per favore.', answers: { type: { choice: 'unclear', p: 0.67 }, code: { choice: 'needs code', p: 0.63 } }, asked: { secs: 4, text: 'Buongiorno, per analizzare la segnalazione ci servono ancora alcune informazioni:\n- Che cosa succede esattamente?' }, lightPath: null, replied: { secs: 89, analysed: true, duplicateOf: 'BIL-23' } },
    { key: 'BIL-27', title: 'Come si ristampa una ricevuta già emessa?', answers: { type: { choice: 'user question', p: 0.97 }, code: { choice: 'no code change', p: 0.96 }, component: { choice: 'Ricevute', p: 0.73 } }, asked: null, lightPath: { secs: 1, comment: 'System 1 triage: recognised as user question (97 %), so no code analysis was run.\nAnswers of the local model: …' }, replied: { secs: 206, analysed: true } },
  ],
  model: { name: 'ft-5', replaced: 'ft-2', questions: 12, changes: [{ question: 'expected', now: 96, before: 54 }, { question: 'screen', now: 92, before: 33 }, { question: 'privacy', now: 100, before: 65 }], lightPath: 'light path: no ticket about code skipped' },
  catches: {
    cross: { key: 'FAR-19', title: '[BE] - Nuova prescrizione: no renal warning for metformin', why: 'involves LAB: MediLab changed the creatinine unit. The change is deliberate.', found: 100, fixed: 287, costUsd: 0.51 },
    guard: { key: 'VAX-15', commit: '5bf4f30', fixes: [{ key: 'VAX-13', testsChanged: ['Vax13RegressionTest.java'] }], minutes: 3.4, hoursBefore: 17 },
    review: { key: 'VAX-19', risk: 'medium', verdict: 'needs-changes', summary: 'The frontend change is correct. But the patient will still be missing in production.', title: '[FE] - Scadenze: on a Sunday the page shows the next week' },
    copies: { key: 'LAB-13' },
  },
  digest: { date: '2026-11-18', at: '2026-11-18T08:57:09Z', summary: 'Since Tue 09:57: 5 tickets analysed, 2 draft fix PRs. Cost $5.53.', sections: [{ title: 'Done', lines: ['2 draft fix PRs: [VAX-23](https://x/15)'] }] },
  pilot: { cases: 7, analysed: 7, files: { n: 7, of: 7 }, culpritNamed: { n: 7, of: 7 }, owner: { n: 7, of: 7 }, fixPr: { n: 7, of: 7 }, bisectExact: { n: 7, of: 7 }, costUsd: 14.79, redaction: { masked: 16, quoted: 20 } },
  analyses: { n: 84, avgCostUsd: 0.32, avgSecs: 56 },
  nightShift: { maxCostUsd: 5, maxTickets: 10, digestAt: '08:00' },
  policy: { actions: 27, system1: [{ key: 'askReporter', mode: 'auto' }, { key: 'lightPath', mode: 'auto' }, { key: 'queueOrder', mode: 'auto' }, { key: 'knownTest', mode: 'auto' }, { key: 'askRouter', mode: 'auto' }, { key: 'privacy', mode: 'shadow' }, { key: 'warmBySide', mode: 'shadow' }] },
};
const week = (w, analysed, hoursSaved, fixMerged, docsMerged) => ({ week: w, analysed, hoursSaved, fixMerged, docsMerged });
const impact = { baseline: { analysisMinutes: 45, reproduceMinutes: 60, fixMinutes: 180, docsMinutes: 30 }, total: { analysed: 62, fixMerged: 10, docsMerged: 56, hoursSaved: 112.8, costUsd: 42.06, avgAnalysisMin: 0.9, avgToPrMin: 4.3 }, accuracy: [{ replayFiles: { n: 12, of: 12 }, replayOwner: { n: 12, of: 12 } }, { replayFiles: { n: 33, of: 33 }, replayOwner: { n: 25, of: 33 } }],
  weeks: [week('2026-10-19', 0, 0, 0, 0), week('2026-10-26', 0, 0, 0, 0), week('2026-11-02', 24, 34.3, 4, 2), week('2026-11-09', 23, 48.8, 2, 48), week('2026-11-16', 16, 30.5, 4, 6)],
  perProject: [{ waiting: { fixPrs: 2, docsPrs: 1 } }, { waiting: { fixPrs: 0, docsPrs: 0 } }] };
const askStats = { total: { withoutAi: { n: 59, of: 87, rate: 0.678 }, costPerClaude: 0.22 } };
const suite = { shared: [{ name: 'GlobalExceptionHandler.java', checks: [{ project: 'DEM', key: 'LAB-13' }, { project: 'VAX', key: 'LAB-13' }] }] };
const apps = [{ key: 'DEM', name: 'MediAgenda' }, { key: 'LAB', name: 'MediLab' }, { key: 'VAX', name: 'MediVax' }];
const insights = { LAB: { totals: { bugs: 17 }, hotspots: ['Risultati'], origins: { medianDaysInCode: 67 }, testCoverage: { backend: { tested: 3, total: 9 } } }, VAX: { totals: { bugs: 9 }, origins: { medianDaysInCode: 3 } } };
const ask = { question: 'Why could http://localhost:4204/scadenze miss the doses due on Sunday?', answer: 'The current main code includes fixes for both known causes. It happened three times.', secs: 24, sources: ['VAX-13', 'VAX-17', 'VAX-19', 'd2fe6eb', '90355db', 'backend/src/main/java/DueService.java'] };
const ctx = (extra = {}) => ({ mode: 'present', full: true, deck: { presenter: 'A. Presenter', contact: 'example.org', insights: 'LAB' }, apps, facts, impact, askStats, suite, insights, ask, teams: { live: true, mentions: true }, ...extra });
const empty = { mode: 'present', full: true, deck: {}, apps: [] };
const P = deck(ctx());
const allSteps = [...P.p1, ...P.p2, ...Object.values(P.case), ...P.p4, ...P.p5, ...P.backup];

test('the presentation in five parts: what it is, under the hood, one case, live, the close; backup slides after the end', () => {
  assert.deepEqual(Array.from(P.p1, (s) => s.slide), ['title', 'problem', 'whatItIs', 'beforeAfter', 'roles', 'life']);
  assert.deepEqual(Array.from(P.p2, (s) => s.slide), ['arch', 's1How', 's1Decides', 's1Cases', 's1Learns', 'analysis', 'prove', 'learnGuard']);
  assert.deepEqual(Object.keys(P.case).sort(), ['caught', 'digest', 'intro', 'learnt', 'report', 'thread', 'timeline']);
  assert.deepEqual(Array.from(P.p4, (s) => s.slide), ['live']);
  assert.equal(P.p4[0].hold, true, 'the live question waits for the presenter');
  assert.deepEqual(Array.from(P.p5, (s) => s.slide), ['different', 'results', 'limits', 'thanks']);
  assert.equal(P.p5.at(-1).hold, true, 'it stays on the last slide');
  assert.ok(P.backup.length >= 8 && P.backup.every((s) => s.backup && s.hold && s.silent));
  assert.deepEqual([...new Set(allSteps.filter((s) => !s.backup).map((s) => s.part))], [1, 2, 3, 4, 5]);
  assert.equal(STEPS.length, 8);
  assert.ok(!allSteps.some((s) => s.stagger), 'no slide of the presentation changes while it is spoken');
});

test('every slide renders with the records and without them, with the page data escaped', () => {
  for (const c of [ctx(), empty]) {
    for (const st of [...deck(c).slidesOnly]) {
      assert.equal(typeof slides[st.slide], 'function', `slide ${st.slide}`);
      const html = slides[st.slide](c);
      assert.ok(html.length > 50, st.slide);
      assert.ok(!html.includes('<ESA>'), `${st.slide} escapes ticket titles`);
      assert.ok(typeof st.say === 'string' && !/undefined|null|NaN/.test(st.say), `${st.slide} says no undefined: ${st.say}`);
    }
    for (const s of Object.values(deck(c).caseSay)) assert.ok(!/undefined|null|NaN/.test(s), s);
  }
  for (const name of ['problem', 'pipeline', 'ai', 'work', 'built']) assert.ok(slides[name]({ full: false }).includes('data-r'), `${name} still works over the dashboard (?tour)`);
});

test('without the records a slide says less, never a number it did not read', () => {
  const html = ['results', 'views', 'roles', 'beforeAfter', 'different', 'caught', 's1How', 'learnGuard'].map((n) => slides[n](empty)).join('');
  for (const s of ['7 of 7', '112', '67 %', '3.4 min', '84 analyses', '96 %']) assert.ok(!html.includes(s), s);
  assert.doesNotMatch(deck(empty).p5[1].say, /\d/, 'the results are not spoken without numbers');
});

// Checked against a run in a browser (2026-11-18, 1440×860, captions only): each step took about 0.9 s more than
// its words and its pause, the voice's start and its sentence gaps; without it the estimate came out short.
test('beats: the screen follows the words; each part a slide lights is said, each beat lights a part', () => {
  const said = [...P.p1, ...P.p2, ...Object.values(P.case), ...P.p5].filter((s) => s.beats?.length);
  assert.ok(said.length >= 20, `${said.length} slides said in beats`);
  for (const st of said) {
    assert.equal(st.say, st.beats.map((b) => b.say).join(' '), `${st.slide}: its words are its beats'`);
    const html = slides[st.slide](ctx());
    const parts = new Set([...html.matchAll(/data-b="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/).map(Number)));
    for (const b of st.beats) if (b.b) assert.ok(parts.has(b.b), `${st.slide}: beat ${b.b} lights a part`);
    for (const p of parts) assert.ok(st.beats.some((b) => b.b === p), `${st.slide}: part ${p} is said`);
  }
  // The dashboard steps: each beat names the part it lights, and the words are the beats'.
  for (const [name, bs] of Object.entries(P.caseBeats)) {
    assert.ok(bs.length && bs.every((b) => b.at && b.say), name);
    assert.equal(P.caseSay[name], bs.map((b) => b.say).join(' '), name);
  }
  for (const name of ['heat', 'knowledge', 'impact']) assert.equal(P.viewSay[name](), P.viewBeats[name]().map((b) => b.say).join(' '), name);
  assert.deepEqual(Array.from(P.caseBeats.analysis, (b) => b.at), ['known', 'cause', 'owner']);
  assert.deepEqual(Array.from(P.caseBeats.teams, (b) => b.at), ['notice', 'message', 'time']);
  assert.deepEqual(Array.from(P.viewBeats.heat(), (b) => b.at), ['kpis', 'heat', 'hotspots', 'origins']);
  assert.deepEqual(Array.from(P.viewBeats.impact(), (b) => b.at), ['head', 'hours', 'analysed', 'merged', 'documented', 'waiting', 'chart']);
});

test('Teams drawn as Teams: the channel, the posts arriving with the words, the phone that rings', () => {
  const th = slides.teamsThread(ctx());
  assert.match(th, /class="tm-app"/);
  assert.match(th, /# support-triage/);
  assert.match(th, /tm-msg" data-b="1"[\s\S]*@Irene Fabbri/, 'the fix card arrives first');
  assert.match(th, /tm-reply" data-b="2"/, 'then the reply in its thread');
  assert.match(th, /tm-msg" data-b="3"[\s\S]*ti: VAX-21/, 'then the question in the channel');
  const phone = window.TourSlides.teamsPop(ctx(), 'owner', 'notice');
  assert.match(phone, /tm-phone/);
  assert.match(phone, /Ticket Intelligence mentioned you in #support-triage/);
  const post = window.TourSlides.teamsPop(ctx({ facts: { ...facts, case: { ...facts.case, cards: { ...facts.case.cards, owner: { to: 'Irene Fabbri', title: 'VAX-21: [BE] - Scheda paziente', message: 'Hi Irene, the card shows the dose late. I think it comes from Schedule.java:28. Please restore it.', why: 'She authored VAX-20 (6e8e6e1), the regression. More.', where: 'backend/src/Schedule.java:28', confidence: 'high' } } } } }), 'owner', 'time');
  assert.match(post, /Hi Irene, the card shows the dose late\. I think it comes from Schedule\.java:28\. …/, 'two sentences, not the whole message');
  assert.match(post, /Why you<\/span>She authored VAX-20, the regression\./);
  assert.match(post, /tm-when hot">1:58 after the report/);
  assert.equal(window.TourSlides.teamsPop(empty, 'owner', 'message'), '', 'no card in the records: nothing drawn');
});

test('a slide whose record arrives after the start is read when it is shown (the suite\'s copies)', () => {
  const late = ctx({ suite: null });
  const D = deck(late);
  assert.equal(D.case.caught.beats.length, 4, 'without the suite: no beat for the copies');
  late.suite = suite;
  assert.equal(D.case.caught.beats.length, 5, 'the suite arrived: its beat is there');
  assert.match(D.case.caught.say, /missing in 2 copies/);
});

test('callouts: the facts a dashboard beat says, large, from the records', () => {
  const co = (step, at) => P.caseBeats[step].find((b) => b.at === at)?.callout ?? '';
  assert.match(co('analysis', 'cause'), /Schedule\.java:28/);
  assert.match(co('analysis', 'cause'), /VAX-20 · commit 6e8e6e1/);
  assert.match(co('analysis', 'owner'), /Irene Fabbri/);
  assert.match(co('proof', 'repro'), /due 5 September, not 20 November/);
  assert.match(co('proof', 'bisect'), /22 s/);
  assert.match(co('fix', 'checks'), /24 backend tests/);
  assert.match(co('fix', 'review'), /low/);
  // Without the records: no callout fact, no number.
  const E = deck(empty);
  for (const bs of Object.values(E.caseBeats)) for (const b of bs) assert.doesNotMatch(b.callout ?? '', /\d/, b.at);
});

test('the voiced run fits 17 minutes: 2.6 words a second at 0.9×, 0.9 s to start each step, 1.5 s after a slide, 2.5 s and the replay (about 5 s) on a dashboard step, a minute live', () => {
  const steps = [...P.p1, ...P.p2, P.case.intro, P.case.report, P.case.thread, P.case.learnt, P.case.caught, ...P.p4, ...P.p5];
  const dash = [...Object.values(P.caseSay), ...Object.values(P.viewSay).map((f) => f())];
  const words = [...steps.map((s) => s.say), ...dash].reduce((n, s) => n + s.split(/\s+/).length, 0);
  const seconds = words / (2.6 * 0.9) + (0.9 + 1.5) * steps.length + (0.9 + 2.5 + 5) * dash.length + 60;
  console.log(`# the voiced run, estimated: ${(seconds / 60).toFixed(1)} min`);
  assert.ok(seconds <= 17 * 60, `${Math.round(seconds)} s`);
  assert.ok(seconds >= 12 * 60, `long enough to say what it does: ${Math.round(seconds)} s`);
  assert.equal(dash.length, 10, 'ten dashboard steps: the case (System 1, the analysis, Teams, the proof, the fix and its review, the Graph tab), Insights twice, Ask, Impact');
});

test('what it is, before and after, what each role gets, and why it is different: plain words, every number read', () => {
  const what = slides.whatItIs(ctx());
  assert.match(what, /An AI colleague for the support and development team/);
  for (const jargon of ['System 1', 'shadow', 'bisect', 'worktree']) assert.ok(!what.includes(jargon), `no ${jargon} before it is explained`);
  const ba = slides.beforeAfter(ctx());
  for (const s of ['about 45 min', '49 s: the cause', '1:58 after the report', 'about 1 h', '3:33', '22 s: the exact commit', 'about 3 h', '5:19', 'about 30 min, often never', 'caught 3.4 min', '2 s in Teams', "the team's own estimate", 'VAX-21, measured from the report']) assert.ok(ba.includes(s), s);
  const ro = slides.roles(ctx());
  for (const s of ['Support', 'Developers', 'Team leads', 'Management', '2 s', '4 s', '68 %', '49 s', '22 s', '5:19', '1:58', '3.4 min', '113 h', '7 of 7', '67 days', 'MediLab']) assert.ok(ro.includes(s), s);
  assert.match(slides.different(ctx()), /an analysis in 56 s on average, a tested fix 5:19 after the report/);
  assert.match(P.p1[3].say, /about 45 minutes by the team's own estimate, 49 seconds here/);
  assert.match(slides.title(ctx()), /An AI colleague that takes every new Jira ticket/);
  assert.doesNotMatch(slides.title(ctx()), /A\. Presenter/, "the presenter's name is not on the first slide");
  assert.match(slides.thanks(ctx()), /A\. Presenter/, 'it stays on the last one');
});

test('System 1 as it is now: what acts, what is in shadow, the real answers and the two real cases', () => {
  const dec = slides.s1Decides(ctx());
  assert.equal((dec.match(/ts-chip acts/g) ?? []).length, 5);
  assert.equal((dec.match(/ts-chip shadow/g) ?? []).length, 2);
  assert.match(P.p2[2].say, /5 act today: ask the reporter, light path, queue order, known issue and ask router\. 2 only say what they would do: privacy hold and fix warm-up/);
  const how = slides.s1How(ctx());
  assert.match(how, /names the screen/);
  assert.match(how, /96 %/);
  assert.match(how, /12 questions<\/b>: 11 about a ticket/);
  assert.match(P.p2[1].say, /bug in code, 84 percent; names the screen, 96 percent; no person named, 97 percent\. 3\.2 seconds/);
  const cases = slides.s1Cases(ctx());
  assert.match(cases, /4 s<\/b> after it came in/);
  assert.match(cases, /Ci basta|Buongiorno/);
  assert.match(cases, /duplicate of <b>BIL-23<\/b>/);
  assert.match(cases, /Light path in 1 s/);
  assert.match(P.p2[3].say, /4 seconds later the reporter is asked, in Italian/);
  assert.match(P.p2[4].say, /names the screen, from 33 to 92 percent/);
});

test('the case: masked report, the timeline, Teams, the entry and its test, from the records', () => {
  const rep = slides.caseReport(ctx());
  // The report as written, its identifiers marked; in what a model reads, each turns into its placeholder on screen.
  assert.match(rep, /<span class="ts-pii">De Luca<\/span> Laura \(CF <span class="ts-pii">DLCLRA26D68F205F<\/span>, <span class="ts-pii">28\/04\/2026<\/span>\)/);
  assert.match(rep, /<span class="from">De Luca<\/span><span class="to">\[PERSON_1\]<\/span>/);
  assert.match(rep, /<span class="from">28\/04\/2026<\/span><span class="to">\[BIRTH_DATE_1\]<\/span>/);
  assert.match(rep, /3 of 3 identifiers masked/);
  assert.match(rep, /ts-ctime[\s\S]*class="on"><b>0:00<\/b>Report/, "the case's own clock, not the eight steps");
  const odd = slides.caseReport(ctx({ facts: { ...facts, case: { ...facts.case, report: { ...facts.case.report, original: 'Something else entirely.' } } } }));
  assert.match(odd, /<span class="ts-mask">\[PERSON_1\]<\/span>/, 'texts that cannot be lined up: the masked text, highlighted');
  // A developer's change, as the team's tools show it: the story, the commit and its diff, the build, the guard.
  const change = { message: 'VAX-20: take the last dose without sorting again', date: '2026-11-16T15:08:54+01:00', file: 'backend/src/main/java/com/medivax/schedule/Schedule.java', line: 28,
    lines: [{ kind: 'del', text: 'Dose last = given.stream().max(…).orElseThrow();' }, { kind: 'add', text: 'Dose last = given.get(0); // the repository returns the doses already ordered' }] };
  const intro = slides.caseIntro(ctx({ facts: { ...facts, case: { ...facts.case, breaking: { ...facts.case.breaking, change } } } }));
  for (const s of ['Jira · the story', 'git · a commit on main', 'VAX-20: take the last dose without sorting again', 'Schedule.java · line 28', 'class="add">+ Dose last = given.get(0)', '22 backend tests pass', 'touches no earlier bug fix', 'The bug is inside']) assert.ok(intro.includes(s), s);
  assert.match(deck(ctx({ facts: { ...facts, case: { ...facts.case, breaking: { ...facts.case.breaking, change } } } })).case.intro.say, /Irene Fabbri took the story VAX-20 in Jira, a small tidy-up, and pushed this one-line change to main\./);
  assert.match(P.case.report.say, /It names the patient, a fiscal code and a birth date\. Before any model reads it, they are masked/);
  assert.doesNotMatch(P.caseSay.fix, /\.\./, 'one full stop');
  const tl = slides.caseTimeline(ctx());
  for (const s of ['1:58', '3:33', '3:56', '5:19', 'due 5 September instead of 20 November', 'in 22 s', '24 backend tests']) assert.ok(tl.includes(s), s);
  const th = slides.teamsThread(ctx());
  assert.match(th, /BUILT · FIRST LIVE ROUND PENDING/, 'the approval is shown as not yet run live');
  assert.match(th, /PR #7 is ready for review/);
  assert.match(th, /ti: VAX-21/);
  const live = slides.teamsThread(ctx({ facts: { ...facts, teams: { ...facts.teams, decisions: [{ type: 'approved', text: 'approved in Teams by Irene Fabbri: PR #7 ready' }] } } }));
  assert.doesNotMatch(live, /PENDING/, 'once it ran live, the real decision is shown');
  assert.match(live, /approved in Teams by Irene Fabbri/);
  const learnt = slides.caseLearnt(ctx());
  assert.match(learnt, /Merged by a person 51 minutes after the report/);
  assert.match(learnt, /Vax21RegressionTest/);
  assert.match(learnt, /<b>confirmed<\/b>/);
  assert.match(P.caseSay.proof, /due on 5 September instead of 20 November.*Irene Fabbri's commit, found in 22 seconds/);
  assert.match(P.caseSay.analysis, /49 seconds after it was picked, the analysis, with high confidence\. Already known: a regression of VAX-5\. The cause, with the file and the line: Schedule\.java, line 28\. The owner: Irene Fabbri, because she authored VAX-20, the regression\./);
  assert.match(P.caseSay.teams, /1 minute 58 after the report/);
});

test('what it caught, the morning digest and the four views, with their numbers', () => {
  const ca = slides.caught(ctx());
  for (const s of ['FAR-19', 'MediLab changed the creatinine unit', '1:40', 'A cheated test', '3.4 min', '17 h before the report', 'needs-changes', 'But the patient will still be missing', 'GlobalExceptionHandler.java', 'MediAgenda and MediVax']) assert.ok(ca.includes(s), s);
  assert.match(P.case.caught.say, /No renal warning for metformin\. The cause was in another app: MediLab changed the creatinine unit, found in 1 minute 40/);
  assert.match(P.case.caught.say, /missing in 2 copies/);
  const dg = slides.digest(ctx());
  assert.match(dg, /5 tickets analysed/);
  assert.match(dg, /2 draft fix PRs: VAX-23/, 'links are shown as their text');
  const v = slides.views(ctx());
  for (const s of ['67 days', 'MediLab', '68 %', '45 of 45', '113 h', '$42.06']) assert.ok(v.includes(s), s);
  const r = slides.results(ctx());
  for (const s of ['56 s on average (84 analyses)', 'the owner told 1:58 after the report', 'pilot 7 of 7', 'replay 45 of 45 files', 'replay 37 of 45']) assert.ok(r.includes(s), s);
});

test('no cost in the presentation itself: no dollar amount or price on a slide or in the voice (only the Q&A slide on cost has them)', () => {
  const main = [...P.p1, ...P.p2, ...Object.values(P.case).filter((s) => s.slide !== 'digest'), ...P.p4, ...P.p5];
  const said = [...main.map((s) => s.say), ...Object.values(P.caseSay), ...Object.values(P.viewSay).map((f) => f())].join(' ');
  const shown = main.map((s) => slides[s.slide](ctx())).join(' ');
  for (const [what, text] of [['said', said], ['shown', shown]]) {
    assert.doesNotMatch(text, /\$\s?\d/, `${what}: no dollar amount`);
    assert.doesNotMatch(text, /\b(cents?|dollars?|costs?|cheap|free|spends?|spent|budget|price)\b/i, `${what}: no price`);
  }
  assert.ok(P.backup.some((s) => s.slide === 'qaCost'), 'the cost stays a backup answer');
  assert.ok(P.backup.some((s) => s.slide === 'digest') && P.backup.some((s) => s.slide === 'views'));
});

test('Insights, Ask and Impact on the dashboard, said from their records when the step comes', () => {
  const v = P.viewSay;
  assert.match(v.heat(), /Here, MediLab: 17 bugs\. On the map, each by part of the app and by month\. The hotspots, where the next bug is most likely: Risultati\. And a bug stays 67 days in the code, at the median, until it is fixed\./);
  assert.match(v.knowledge(), /who knows each part of the code/);
  assert.match(v.ask(), /"Why could the scadenze page miss the doses due on Sunday\?" 24 seconds later, the answer/);
  assert.match(v.ask(), /It cites 3 tickets, 2 commits and 1 file, each checked\./);
  // Impact says what its tiles show: this week's numbers, and the total of the weeks since the agent started.
  assert.match(v.impact(), /This week, 30\.5 hours saved; 112\.8 in the 3 weeks since it started\. 16 tickets analysed\. 4 fixes merged\. 6 tickets documented\. 3 drafts wait for a person to review\./);
  assert.equal(P.impactWeeks(), 3, 'the tab shows the weeks since the start, not the zeros before');
  const late = { ...ctx(), insights: {} };
  const D = deck(late);
  assert.doesNotMatch(D.viewSay.heat(), /\d/, 'before Insights has loaded: no number');
  late.insights.LAB = insights.LAB; // what arrives later is read when the step is spoken
  assert.match(D.viewSay.heat(), /17 bugs/);
  assert.match(deck(empty).viewSay.ask(), /not in the knowledge base/);
});

test('the deck alone (?deck) has a timeline instead of the dashboard, and the same close', () => {
  const s = Array.from(P.slidesOnly, (x) => x.slide);
  assert.deepEqual(s.slice(0, 18), ['title', 'problem', 'whatItIs', 'beforeAfter', 'roles', 'life', 'arch', 's1How', 's1Decides', 's1Cases', 's1Learns', 'analysis', 'prove', 'learnGuard', 'caseIntro', 'caseReport', 'caseTimeline', 'teamsThread']);
  assert.ok(!s.includes('views') || P.slidesOnly.find((x) => x.slide === 'views').backup, 'the dashboard tiles are a backup slide now');
  assert.ok(s.includes('live') && s.indexOf('live') < s.indexOf('results'));
});

test("System 1's privacy slide: the ticket, the answer and the analysis' first sentence, escaped; none without data", () => {
  const html = slides.system1Privacy({ ...ctx(), system1: { privacy: { key: 'DEM-48', p: 0.995, mode: 'shadow', summary: 'A patient <b>X</b> came to the counter. He says more.' } } });
  assert.match(html, /DEM-48/);
  assert.match(html, /100 %/);
  assert.match(html, /A patient &lt;b&gt;X&lt;\/b&gt; came to the counter\./);
  assert.doesNotMatch(html, /He says more/);
  assert.equal(slides.system1Privacy(ctx()), '');
});

test('Teams on the slides: simulated without a channel; a real channel, both ways, when the dashboard has one', () => {
  assert.match(slides.tech({}), /Teams: simulated in the POC/, 'no context: as before');
  assert.match(slides.tech(ctx()), /Workflows webhook: an Adaptive Card in a channel, @mentioning the owner; Microsoft Graph to read the channel's questions and replies/);
  assert.match(slides.live(ctx()), /ti: VAX-23/);
});
