import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDigest, digestDue, inWindow, nightOf } from '../lib/digest.mjs';

const at = (s) => new Date(s); // local time, as the watcher's clock

test('the window crosses midnight; a night is the date it started; the digest is due once, in the morning, on working days', () => {
  assert.equal(inWindow(at('2026-11-17T21:30:00'), '20:00', '07:00'), true);
  assert.equal(inWindow(at('2026-11-18T03:00:00'), '20:00', '07:00'), true);
  assert.equal(inWindow(at('2026-11-18T07:00:00'), '20:00', '07:00'), false);
  assert.equal(inWindow(at('2026-11-18T12:00:00'), '20:00', '07:00'), false);
  assert.equal(inWindow(at('2026-11-18T12:00:00'), '09:00', '17:00'), true, 'a window within one day');
  assert.equal(nightOf(at('2026-11-17T21:30:00'), '20:00'), '2026-11-17');
  assert.equal(nightOf(at('2026-11-18T03:00:00'), '20:00'), '2026-11-17');
  assert.equal(digestDue(at('2026-11-18T07:59:00'), '08:00', null), false);
  assert.equal(digestDue(at('2026-11-18T08:01:00'), '08:00', '2026-11-17'), true);
  assert.equal(digestDue(at('2026-11-18T08:01:00'), '08:00', '2026-11-18'), false, 'sent today');
  assert.equal(digestDue(at('2026-11-18T15:00:00'), '08:00', '2026-11-17'), false, 'a watcher started in the afternoon sends none');
  assert.equal(digestDue(at('2026-11-21T08:30:00'), '08:00', '2026-11-20'), false, 'a Saturday');
  assert.equal(digestDue(at('2026-11-21T08:30:00'), '08:00', '2026-11-20', { weekends: true }), true);
});

const FROM = '2026-11-17T08:00:00Z';
const TO = '2026-11-18T08:00:00Z';
const e = (type, key, x = {}) => ({ at: '2026-11-17T20:00:00Z', type, key, ...x });

test('the digest counts what the events say, says what came back and what waits, with the cost', () => {
  const events = [
    e('analyzed', 'VAX-25', { meta: { costUsd: 0.4 } }),
    e('analyzed', 'BIL-27', { meta: { costUsd: 0.3 } }),
    e('triaged', 'BIL-27'),
    e('system1-held', 'BIL-28', { kind: 'asked' }),
    e('fix-proposed', 'VAX-25', { url: 'https://github.com/o/r/pull/16', meta: { costUsd: 1.5 } }),
    e('reviewed', 'VAX-25', { meta: { costUsd: 0.2 } }),
    e('docs-merged', 'LAB-24', { text: 'documentation merged into main (automatically, 24 h after it was opened): PR #9' }),
    e('research', null, { outcome: 'not-found', costUsd: 0.37 }),
    e('guard', 'VAX-15', { verdict: 'alert', short: '5bf4f30', fixes: [{ key: 'VAX-13' }] }),
    e('guard', 'LAB-24', { verdict: 'clear' }),
    e('analyzed', 'OLD-1', { at: '2026-11-16T10:00:00Z', meta: { costUsd: 9 } }),
  ];
  const d = buildDigest({ events, from: FROM, to: TO, askCostUsd: 0.2, waiting: { fixPrs: [{ key: 'VAX-25', url: 'https://github.com/o/r/pull/16', number: 16, ageHours: 17 }], held: [{ key: 'BIL-28', why: "waits for the reporter's answer" }], docsPrs: [{ key: null, number: 14, url: 'u', mergesAt: '11:37' }], gaps: 2 }, night: { kbTests: { passed: 25, failed: [{ project: 'LAB', key: 'LAB-8' }] }, lint: { findings: 0 }, backlog: { queued: 0 } } });
  assert.deepEqual({ analyzed: d.counts.analyzed, fixes: d.counts.fixes, alerts: d.counts.alerts, costUsd: d.counts.costUsd }, { analyzed: 2, fixes: 1, alerts: 2, costUsd: 2.97 });
  assert.match(d.summary, /: 2 tickets analysed, 1 draft fix PR, 2 alerts\. Cost \$2\.97\./);
  const lines = (title) => d.sections.find((s) => s.title === title)?.lines ?? [];
  assert.match(lines('Done')[0], /^Analysed 2 tickets \(1 on the light path, 1 report asked back\): VAX-25, BIL-27$/);
  assert.ok(lines('Done').some((l) => /1 documentation PR merged \(1 on their own\)/.test(l)));
  assert.ok(lines('Done').some((l) => /Researched 1 knowledge gap: 0 answered in the FAQ PR, 1 a real gap/.test(l)));
  assert.deepEqual(lines('Back, or worth a look'), ['Regression guard: commit 5bf4f30 touches the fix of VAX-13 (VAX-15)', "Night test: LAB-8's regression test fails on LAB main"]);
  assert.equal(lines('Waiting for a person').length, 4);
  assert.match(d.markdown, /^# Morning digest · /);
});

test('a quiet period is one line, and says whether anything still waits', () => {
  const quiet = buildDigest({ events: [], from: FROM, to: TO });
  assert.equal(quiet.quiet, true);
  assert.match(quiet.summary, /^Quiet since .*: nothing new, and nothing waits for a person\.$/);
  assert.deepEqual(quiet.sections, []);
  assert.match(buildDigest({ events: [], from: FROM, to: TO, waiting: { gaps: 1 } }).summary, /nothing new; 1 thing still waiting for a person\./);
});
