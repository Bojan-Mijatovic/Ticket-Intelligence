import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ticketKeyQuestion, ticketStatus } from '../lib/ticket-status.mjs';

const time = (iso) => String(iso).slice(0, 16).replace('T', ' '); // UTC: the same on every machine
const PR7 = 'https://github.com/o/MediVax/pull/7';
const PR10 = 'https://github.com/o/MediVax/pull/10';
const at = (m) => `2026-11-16T16:${String(m).padStart(2, '0')}:00.000Z`;
const ISSUE = { summary: '[BE] - Scheda paziente: the third ESA dose is due too early', status: 'Done', priority: 'High', created: '2026-11-16T16:04:05.000Z' };
const analysed = [
  { at: at(5), type: 'queued', key: 'VAX-21' },
  { at: at(5), type: 'picked', key: 'VAX-21' },
  { at: at(6), type: 'analyzed', key: 'VAX-21', text: 'high confidence · owner Irene Fabbri', result: { confidence: 'high', owner: { name: 'Irene Fabbri' }, handoff: { to: 'Irene Fabbri' } }, meta: { durationMs: 50000 } },
  { at: at(6), type: 'notified', key: 'VAX-21', text: 'Teams message to Irene Fabbri', channel: 'teams' },
  { at: at(6), type: 'draft', key: 'VAX-21', kind: 'reply', text: 'Reply to the reporter prepared' },
  { at: at(7), type: 'reproduced', key: 'VAX-21', text: 'bug reproduced' },
  { at: at(8), type: 'bisected', key: 'VAX-21', text: 'bisect: broken by 6e8e6e1 "VAX-20: take the last dose" (2026-11-16, Irene Fabbri): the test passes on ad0251f and fails from that commit on' },
];
const withPr = [...analysed, { at: at(9), type: 'pr', key: 'VAX-21', url: PR7 }, { at: at(10), type: 'reviewed', key: 'VAX-21', text: 'risk low · looks-good · 1 finding(s)' }];
const other = [{ at: at(1), type: 'analyzed', key: 'VAX-20', text: 'x' }];

test('a status question: the key alone, or one key with words that ask for a status, in English, Italian, Serbian', () => {
  for (const q of ['VAX-21', 'VAX-21?', 'status VAX-21', 'koji je status VAX-21', 'What is the status of VAX-21?', 'stato di VAX-21?', 'šta je sa VAX-21']) assert.equal(ticketKeyQuestion(q), 'VAX-21', q);
  for (const q of ['why does VAX-21 count from the first dose on Mondays when the clinic opens?', 'VAX-21 and VAX-20', 'Koji su poslednji tiketi?', '', null]) assert.equal(ticketKeyQuestion(q), null, String(q));
});

test('done and documented: what happened, in order, and nothing waits', () => {
  const events = [...withPr, { at: at(30), type: 'resolved', key: 'VAX-21' }, { at: at(31), type: 'documented', key: 'VAX-21', url: PR10 }, { at: at(40), type: 'docs-merged', key: 'VAX-21', url: PR10 }, ...other];
  const r = ticketStatus({ key: 'VAX-21', issue: ISSUE, events, prs: { [PR7]: { state: 'MERGED', mergedAt: '2026-11-16T16:54:26Z', mergeCommit: '08b2cca1234' } }, time });
  assert.equal(r.found, true);
  assert.equal(r.next, 'Nothing waits: done and documented.');
  assert.match(r.answer, /^VAX-21 · \[BE\] - Scheda paziente[^\n]*\nJira: Done · High · reported 2026-11-16 16:04/);
  assert.match(r.answer, /analysed: high confidence, owner Irene Fabbri \(50 s\)[\s\S]*Teams message to Irene Fabbri[\s\S]*the change that broke it: 6e8e6e1 "VAX-20: take the last dose" \(2026-11-16, Irene Fabbri\)\n[\s\S]*draft PR #7 opened: now merged on 2026-11-16 16:54 \(08b2cca\)[\s\S]*documentation PR #10, merged/);
  const times = [...r.answer.matchAll(/^· (\d{4}-\d\d-\d\d \d\d:\d\d)/gm)].map((m) => m[1]);
  assert.deepEqual(times, [...times].sort(), 'what happened, in the order it happened');
  assert.doesNotMatch(r.answer, /VAX-20: x|Drafts wait/, 'only this ticket; no drafts once it is done');
  assert.deepEqual(r.sources.map((s) => s.ref), ['VAX-21', 'PR #7', 'PR #10']);
});

test('an open fix PR: it waits for a person to review and merge it, with the AI review and the merge check', () => {
  const events = [...withPr, { at: at(20), type: 'merge-check', key: 'VAX-21', text: 'merge check on main 6cc5715: still green (backend 27 passed)' }];
  const r = ticketStatus({ key: 'VAX-21', issue: { ...ISSUE, status: 'To Do' }, events, prs: { [PR7]: { state: 'OPEN', isDraft: true } }, time });
  assert.equal(r.next, 'Waits for a person: review and merge PR #7 (AI review: risk low); merge check on main 6cc5715: still green (backend 27 passed). Drafts wait for a person on the dashboard: the reply to the reporter.');
  assert.match(r.answer, /draft PR #7 opened: now open, a draft/);
});

test('a fix that stopped, or was not tried: it waits for the owner, who got the Teams message', () => {
  const stopped = ticketStatus({ key: 'VAX-21', issue: { ...ISSUE, status: 'To Do' }, events: [...analysed, { at: at(9), type: 'fix-failed', key: 'VAX-21', text: 'verify: independent checks failed after the fix' }], time });
  assert.match(stopped.next, /^The automatic fix stopped, so it waits for Irene Fabbri, who got the Teams message on 2026-11-16 16:06\./);
  const skipped = ticketStatus({ key: 'VAX-21', issue: { ...ISSUE, status: 'To Do' }, events: [...analysed, { at: at(9), type: 'fix-skipped', key: 'VAX-21', text: 'no automatic fix: confidence is medium' }], time });
  assert.match(skipped.next, /^No automatic fix \(confidence is medium\): it waits for Irene Fabbri/);
});

test('merged but not closed, closed without a merge, held, never seen, in the queue, being worked on', () => {
  const todo = { ...ISSUE, status: 'To Do' };
  assert.match(ticketStatus({ key: 'VAX-21', issue: todo, events: withPr, prs: { [PR7]: { state: 'MERGED' } }, time }).next, /^Fixed on main \(PR #7 merged\): it can be moved to Done\./);
  assert.match(ticketStatus({ key: 'VAX-21', issue: todo, events: withPr, prs: { [PR7]: { state: 'CLOSED' } }, time }).next, /^The fix PR #7 was closed without a merge: reopen it, or Irene Fabbri/);
  const held = [{ at: at(1), type: 'queued', key: 'BIL-25' }, { at: at(2), type: 'system1-held', key: 'BIL-25', kind: 'incomplete', text: 'held: the report does not tell what is wrong' }];
  assert.match(ticketStatus({ key: 'BIL-25', issue: todo, events: held, time }).next, /^Waits for a person on the dashboard: it is held \(the report misses what is needed/);
  const released = [...held, { at: at(9), type: 'picked', key: 'BIL-25' }, { at: at(10), type: 'analyzed', key: 'BIL-25', result: { confidence: 'low', owner: { name: 'Chiara Marchetti' } } }];
  assert.match(ticketStatus({ key: 'BIL-25', issue: todo, events: released, time }).next, /^Analysed: it waits for Chiara Marchetti\./, 'a new run after the hold is not held');
  assert.match(ticketStatus({ key: 'DEM-50', issue: todo, events: [], time }).next, /^The agent has not picked it up .*"Run ticket"/);
  assert.equal(ticketStatus({ key: 'VAX-21', issue: todo, events: analysed, now: { queued: ['VAX-21'] }, time }).next, 'It waits in the agent\'s queue and is taken next in turn. Drafts wait for a person on the dashboard: the reply to the reporter.');
  assert.match(ticketStatus({ key: 'VAX-21', issue: todo, events: analysed, now: { processing: { key: 'VAX-21', kind: 'analyze' } }, time }).next, /^The agent is working on it right now \(analyze\)\./);
});

test('a key Jira does not have: not found, and the records say so', () => {
  const r = ticketStatus({ key: 'DEM-42', issue: null, events: [{ at: at(1), type: 'analyzed', key: 'DEM-42' }], time });
  assert.equal(r.found, false);
  assert.match(r.answer, /^DEM-42: Jira has no ticket with this key[\s\S]*1 events, the last on 2026-11-16 16:01\): it may have been deleted/);
});

test('ROADMAP #9 B: approved in Teams, rejected and fixed again, rejected after the last attempt', () => {
  const todo = { ...ISSUE, status: 'To Do' };
  const approved = [...withPr, { at: at(20), type: 'approved', key: 'VAX-21', text: 'approved in Teams by Irene Fabbri: PR #7 is ready for review', url: PR7 }];
  const a = ticketStatus({ key: 'VAX-21', issue: todo, events: approved, prs: { [PR7]: { state: 'OPEN', isDraft: false } }, time });
  assert.match(a.next, /^Waits for a person: review and merge PR #7 \(approved in Teams by Irene Fabbri; it is ready for review\)/);
  assert.match(a.answer, /approved in Teams by Irene Fabbri: PR #7 is ready for review/);
  const rejected = [...withPr, { at: at(20), type: 'rejected', key: 'VAX-21', text: 'rejected in Teams by Irene Fabbri (attempt 1 of 2): wrong week; the fix runs again with this reason', url: PR7 }];
  assert.equal(ticketStatus({ key: 'VAX-21', issue: todo, events: rejected, prs: { [PR7]: { state: 'CLOSED' } }, time }).next, 'Rejected in Teams: the agent fixes it again with the reason; the new draft PR comes to the same channel. Drafts wait for a person on the dashboard: the reply to the reporter.', 'not "closed without a merge"');
  const again = [...rejected, { at: at(25), type: 'refixing', key: 'VAX-21', text: 'fixing again' }, { at: at(30), type: 'pr', key: 'VAX-21', url: PR10 }];
  assert.match(ticketStatus({ key: 'VAX-21', issue: todo, events: again, prs: { [PR10]: { state: 'OPEN', isDraft: true } }, time }).next, /^Waits for a person: review and merge PR #10/, 'the new PR after the second attempt');
  const last = [...withPr, { at: at(20), type: 'rejected', key: 'VAX-21', text: 'rejected in Teams by Irene Fabbri (attempt 2 of 2, the last): still wrong; PR #7 closed, the ticket waits for a person', url: PR7 }];
  assert.match(ticketStatus({ key: 'VAX-21', issue: todo, events: last, prs: { [PR7]: { state: 'CLOSED' } }, time }).next, /^Rejected in Teams after the last automatic attempt: it waits for Irene Fabbri, who got the Teams message/);
  const stopped = [...rejected, { at: at(26), type: 'fix-failed', key: 'VAX-21', text: 'verify: the build fails' }];
  assert.match(ticketStatus({ key: 'VAX-21', issue: todo, events: stopped, prs: { [PR7]: { state: 'CLOSED' } }, time }).next, /^The fix made again after the rejection stopped \(verify: the build fails\): it waits for Irene Fabbri/);
});
