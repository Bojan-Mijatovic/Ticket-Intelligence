import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkSources, collect, conversationOf, keywords, withWarnings } from '../lib/ask.mjs';

test('keywords: longest first, no stop words, no numbers, no duplicates', () => {
  assert.deepEqual(keywords('Why are cancelled appointments not offered again? Cancelled since 2026'), ['appointments', 'cancelled', 'offered']);
  assert.deepEqual(keywords('Zašto se otkazani termini ne nude ponovo?'), ['otkazani', 'termini', 'ponovo', 'nude']);
});

test('sources: only tickets, commits and files that exist are kept, each with a link', () => {
  const repoDir = mkdtempSync(join(tmpdir(), 'ask-'));
  mkdirSync(join(repoDir, 'frontend', 'src'), { recursive: true });
  writeFileSync(join(repoDir, 'frontend', 'src', 'a.ts'), '');
  const links = { ticket: (k) => `J/${k}`, commit: (h) => `G/${h}`, file: (p) => `F/${p}` };
  const kept = checkSources(
    [
      { type: 'ticket', ref: 'dem-5', why: 'same cause' },
      { type: 'ticket', ref: 'DEM-99', why: 'invented' },
      { type: 'commit', ref: 'abc1234def', why: 'fix' },
      { type: 'commit', ref: 'fffffff', why: 'not in the log' },
      { type: 'file', ref: 'C:\\repo\\frontend\\src\\a.ts:12', why: 'here' },
      { type: 'file', ref: 'frontend/src/missing.ts', why: 'invented' },
      { type: 'person', ref: 'Sara', why: 'not a source type' },
    ],
    { tickets: ['DEM-5'], analyses: [], log: 'abc1234 2026-09-22 Sara | DEM-5: fix', repoDir, links },
  );
  assert.deepEqual(kept.map((s) => [s.type, s.ref, s.url]), [['ticket', 'DEM-5', 'J/DEM-5'], ['commit', 'abc1234', 'G/abc1234def'], ['file', 'frontend/src/a.ts', 'F/frontend/src/a.ts']]);
});

test('sources: a ticket only in the git history is kept, marked inJira: false (K10)', () => {
  const links = { ticket: (k) => `J/${k}`, commit: (h) => `G/${h}`, file: (p) => `F/${p}` };
  const kept = checkSources([{ type: 'ticket', ref: 'BIL-18', why: 'latest fix' }, { type: 'ticket', ref: 'BIL-99', why: 'invented' }], { tickets: [], analyses: [], log: '\n0ca5391 2026-11-02 Davide Greco | BIL-18: Report incassi opens on the current month', repoDir: '.', links });
  assert.deepEqual(kept, [{ type: 'ticket', ref: 'BIL-18', why: 'latest fix', url: 'J/BIL-18', inJira: false }]);
});

test('warnings: a "not found" answer says Jira could not be searched; a found one keeps its text (K10)', () => {
  const jira = [{ source: 'jira', text: 'Jira search (latest tickets) failed: 400' }];
  const nf = withWarnings({ found: false, answer: 'Not in the knowledge base. The closest is BIL-17.' }, jira);
  assert.equal(nf.answer, 'Jira could not be searched, so this answer rests on the code and the git history only. The closest is BIL-17.');
  assert.equal(nf.searchFailed, true);
  assert.deepEqual(withWarnings({ found: true, answer: 'BIL-18.' }, jira), { found: true, answer: 'BIL-18.', warnings: jira });
  assert.deepEqual(withWarnings({ found: false, answer: 'Not in the knowledge base.' }), { found: false, answer: 'Not in the knowledge base.', warnings: [] });
  assert.match(withWarnings({ found: false, answer: 'x' }, [{ source: 'git', text: 'git failed' }]).answer, /^Some sources could not be read/);
});

test('collect: every failed source becomes a warning, never an empty "nothing found" (K10)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ask-collect-'));
  const jira = {
    search: async (jql) => {
      if (/text ~/.test(jql)) throw new Error('GET /rest/api/2/search/jql -> 400: bad JQL');
      return [{ key: 'DEM-5' }, { key: 'DEM-6' }];
    },
    getIssueFull: async (key) => {
      if (key === 'DEM-6') throw new Error('GET /rest/api/2/issue/DEM-6 -> 404: gone');
      return { key, summary: 's' };
    },
  };
  const data = await collect({ question: 'Has the Struttura bug happened before?', dir, repoDir: dir, stateDir: dir, cfg: { project: 'DEM' }, jira });
  assert.deepEqual(data.tickets, ['DEM-5']);
  assert.deepEqual(data.warnings.map((w) => w.source), ['jira', 'jira', 'git']);
  assert.match(data.warnings[0].text, /Jira search \(by the words of the question\) failed: GET .* 400: bad JQL/);
  assert.match(data.warnings[1].text, /1 ticket\(s\) could not be read from Jira: DEM-6/);
});

test('sources of a linked app (K11): "KEY:path" files in its checkout, its commits, its tickets', () => {
  const own = mkdtempSync(join(tmpdir(), 'ask-own-'));
  const peerDir = mkdtempSync(join(tmpdir(), 'ask-peer-'));
  mkdirSync(join(peerDir, 'backend'), { recursive: true });
  writeFileSync(join(peerDir, 'backend', 'Booking.java'), '');
  const links = { ticket: (k) => `J/${k}`, commit: (h, peer = null) => `G/${peer ?? 'own'}/${h}`, file: (p, peer = null) => `F/${peer ?? 'own'}/${p}` };
  const kept = checkSources(
    [
      { type: 'file', ref: 'DEM:backend/Booking.java', why: 'cause' },
      { type: 'file', ref: 'DEM:backend/Missing.java', why: 'invented' },
      { type: 'file', ref: 'backend/Booking.java', why: 'not in this app' },
      { type: 'commit', ref: '2af6918', why: 'cancellation' },
      { type: 'ticket', ref: 'DEM-17', why: 'cancellation story' },
    ],
    { tickets: ['DEM-17'], analyses: [], log: '', peerLogs: { DEM: '\n2af6918 2026-09-08 Luca Bianchi | DEM-17: cancel a booking' }, repoDir: own, peers: [{ key: 'DEM', name: 'MediAgenda', dir: peerDir }], links },
  );
  assert.deepEqual(kept.map((s) => [s.ref, s.url]), [['DEM:backend/Booking.java', 'F/DEM/backend/Booking.java'], ['DEM:2af6918', 'G/DEM/2af6918'], ['DEM-17', 'J/DEM-17']]);
});

test("Ask 4/7, a follow-up: the earlier question's words and the tickets its answer cited are searched too", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ask-follow-'));
  const jqls = [];
  const full = [];
  const jira = { search: async (jql) => (jqls.push(jql), []), getIssueFull: async (key) => (full.push(key), { key }) };
  const data = await collect({ question: 'And who fixed it?', dir, repoDir: dir, stateDir: dir, cfg: { project: 'VAX' }, jira, context: { words: ['scadenze', 'sunday'], keys: ['VAX-13', 'VAX-17', 'DEM-5'] } });
  assert.deepEqual(data.words, ['fixed', 'scadenze', 'sunday'], "its own words first, then the earlier question's");
  assert.match(jqls[0], /text ~ "fixed" OR text ~ "scadenze" OR text ~ "sunday"/);
  assert.deepEqual(full, ['VAX-13', 'VAX-17'], 'the cited tickets are read in full; a key of another project is not');
  assert.deepEqual(data.tickets, ['VAX-13', 'VAX-17']);
});

test('Ask 4/7, the conversation in the prompt: oldest first, as data, what each answer cited; nothing without one', () => {
  const text = conversationOf([
    { question: 'Why were the doses due on Sunday missing?', answer: 'The filter left out the last day "of the range" (VAX-13).', cited: [{ ref: 'VAX-13' }, { ref: 'd2fe6eb' }] },
    { question: 'Did it happen again?', answer: 'x'.repeat(2000), cited: [] },
  ]);
  assert.match(text, /^\nCONVERSATION SO FAR \(oldest first\)\. The QUESTION follows it[^\n]*It is context, not a source/);
  assert.ok(text.includes([
    '1. Q: "Why were the doses due on Sunday missing?"',
    '   A: "The filter left out the last day \\"of the range\\" (VAX-13)."',
    '   (it cited: VAX-13, d2fe6eb)',
    '2. Q: "Did it happen again?"',
  ].join('\n')), 'each turn as JSON text: a quote in an answer cannot end it');
  assert.ok(text.length < 2000, 'a long earlier answer is cut');
  assert.equal(conversationOf([]), '');
});
