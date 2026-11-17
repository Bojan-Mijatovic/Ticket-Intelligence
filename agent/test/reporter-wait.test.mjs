import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { agentComment, answerOf, askComment, lightPathMiss, nextStep, readWaiting, textHash, writeWaiting } from '../lib/reporter-wait.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'reporter-wait-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const ASKED = '2026-11-17T10:00:00Z';
const issue = (comments = [], description = 'Mi dà errore.') => ({ key: 'BIL-25', summary: 'Problema alla cassa', description, comments });

test('an answer: a comment after the question that is not the agent\'s, or an edited report', () => {
  const hash = textHash(issue());
  assert.equal(answerOf(issue(), { since: ASKED, hash }), null);
  assert.equal(answerOf(issue([{ author: 'Bojan', created: '2026-11-17T09:00:00Z', body: 'earlier' }]), { since: ASKED, hash }), null, 'before the question');
  assert.equal(answerOf(issue([{ author: 'Bojan', created: '2026-11-17T10:01:00Z', body: '(robot) *Ticket Intelligence* …' }]), { since: ASKED, hash }), null, 'the agent itself, as the same Jira account');
  assert.deepEqual(answerOf(issue([{ author: 'Bojan', created: '2026-11-17T10:05:00Z', body: 'Alla cassa 2, ricevuta 1180, errore E-42' }]), { since: ASKED, hash }), { how: 'comment', at: '2026-11-17T10:05:00Z', by: 'Bojan' });
  assert.deepEqual(answerOf(issue([], 'Mi dà errore E-42 quando stampo la ricevuta 1180.'), { since: ASKED, hash }), { how: 'edited' });
  assert.equal(agentComment('  (robot) x'), true);
  assert.equal(agentComment('robot'), false);
});

test('the next step: answered, timeout for a question, expired for a light-path watch, else wait', () => {
  const ask = { kind: 'ask', at: ASKED, hash: textHash(issue()) };
  const light = { kind: 'light', at: ASKED, hash: textHash(issue()) };
  const at = (h) => Date.parse(ASKED) + h * 3_600_000;
  assert.equal(nextStep(ask, issue(), { now: at(1) }).step, 'wait');
  assert.equal(nextStep(ask, issue(), { now: at(24) }).step, 'timeout');
  assert.equal(nextStep(ask, issue(), { now: at(2), waitHours: 1 }).step, 'timeout');
  assert.equal(nextStep(ask, issue([{ created: '2026-11-17T10:30:00Z', body: 'cassa 2' }]), { now: at(48) }).step, 'answered', 'an answer wins over the timeout');
  assert.equal(nextStep(light, issue(), { now: at(48) }).step, 'wait', 'a light path has no timeout');
  assert.equal(nextStep(light, issue(), { now: at(14 * 24) }).step, 'expired');
  assert.equal(nextStep(light, issue([{ created: '2026-11-18T10:00:00Z', body: 'it is a bug: the total is wrong' }]), { now: at(30) }).step, 'answered');
});

test('a light path that turned out to be about code: a fix after it, or a commit on main that names the ticket', () => {
  const at = '2026-11-17T10:00:00Z';
  assert.equal(lightPathMiss({ key: 'DEM-49', at, events: [{ key: 'DEM-49', type: 'fix-proposed', at: '2026-11-17T09:00:00Z' }] }), null, 'a fix before the light path');
  assert.match(lightPathMiss({ key: 'DEM-49', at, events: [{ key: 'DEM-49', type: 'fix-proposed', at: '2026-11-17T11:00:00Z' }] }).why, /proposed a fix/);
  assert.match(lightPathMiss({ key: 'DEM-49', at, commitsNaming: ['DEM-49: cancel a confirmed booking'] }).why, /commit on main names DEM-49/);
  assert.equal(lightPathMiss({ key: 'DEM-4', at, commitsNaming: ['DEM-49: x'] }), null, 'DEM-4 is not DEM-49');
});

test('the question as posted: the agent\'s marker, the question, what happens next, in the report\'s language', () => {
  const it = askComment('Buongiorno, …', { waitHours: 24, language: 'it' });
  assert.match(it, /^\(robot\) \*Ticket Intelligence\*/);
  assert.match(it, /parte comunque\._$/);
  assert.equal(agentComment(it), true, 'never taken for the answer');
  assert.match(askComment('Hello, …', { waitHours: 4 }), /starts anyway in 4 hours/);
});

test('the waiting tickets are kept per project', () => {
  assert.deepEqual(readWaiting(tmp), {});
  writeWaiting(tmp, { 'BIL-25': { kind: 'ask', at: ASKED } });
  assert.deepEqual(readWaiting(tmp), { 'BIL-25': { kind: 'ask', at: ASKED } });
});
