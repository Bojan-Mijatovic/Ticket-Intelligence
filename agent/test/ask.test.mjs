import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkSources, keywords } from '../lib/ask.mjs';

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
