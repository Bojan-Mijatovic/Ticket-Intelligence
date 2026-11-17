import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createDocsPrs } from '../lib/docs-prs.mjs';
import { combinePerson, mergeKnowledgeText, mergeLines, parseOwners } from '../lib/knowledge-merge.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'knowledge-merge-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const INDEX = (rows) => `# Knowledge base

Intro.

## Components

| Component | Description |
|---|---|
| [Scadenze](scadenze.md) | Doses due |

## Documented tickets

| Ticket | Title | Component | Date |
|---|---|---|---|
${rows.map((k) => `| ${k} | title of ${k} | [Scadenze](scadenze.md) | 2026-11-16 |`).join('\n')}
`;
const entry = (k) => `### ${k}: title of ${k}\n- **Type**: bug\n- **Fix**: commit of ${k}`;
const COMPONENT = ({ owners, files = [], entries }) => `# Scadenze

**Code paths**: \`backend/schedule\`

**Key files**:
- \`DueService.java\`: the doses due${files.map((f) => `\n- \`${f}\`: test`).join('')}

${owners}

## Known issues

${entries.map(entry).join('\n\n')}
`;

test('the index: rows of both, newest ticket first; the text around them as it is', () => {
  const base = INDEX(['VAX-13']);
  const r = mergeKnowledgeText('docs/knowledge/README.md', { base, main: INDEX(['VAX-16', 'VAX-13']), branch: INDEX(['VAX-21', 'VAX-13']) });
  assert.equal(r.text, INDEX(['VAX-21', 'VAX-16', 'VAX-13']));
  const intro = mergeKnowledgeText('docs/knowledge/README.md', { base, main: INDEX(['VAX-13']).replace('Intro.', 'Intro, longer.'), branch: INDEX(['VAX-21', 'VAX-13']) });
  assert.equal(intro.text, INDEX(['VAX-21', 'VAX-13']).replace('Intro.', 'Intro, longer.'), 'a change of the intro on one side is kept');
  assert.match(mergeKnowledgeText('docs/knowledge/README.md', { base, main: base.replace('Intro.', 'A.'), branch: base.replace('Intro.', 'B.') }).conflict, /changed on both sides/);
});

test('a component file: every entry once, newest first; the owners of both; key files added on both sides kept', () => {
  const base = COMPONENT({ owners: '**People who know it**: Irene Fabbri (VAX-15), Bojan Mijatović (VAX-13: fix commit `2d633ba`)', entries: ['VAX-13'] });
  const main = COMPONENT({ owners: '**People who know it**: Irene Fabbri (VAX-15), Bojan Mijatović (VAX-13, VAX-17: fix commits `2d633ba`, `90355db`)', files: ['Vax17RegressionTest.java'], entries: ['VAX-17', 'VAX-13'] });
  const branch = COMPONENT({ owners: '**People who know it**: Irene Fabbri (VAX-15, VAX-20), Bojan Mijatović (VAX-13, VAX-19: fix commits `2d633ba`, `57411f4`), Tommaso Bruno (VAX-18)', files: ['Vax19RegressionTest.java'], entries: ['VAX-19', 'VAX-13'] });
  const r = mergeKnowledgeText('docs/knowledge/scadenze.md', { base, main, branch });
  assert.equal(r.text, COMPONENT({
    owners: '**People who know it**: Irene Fabbri (VAX-15, VAX-20), Bojan Mijatović (VAX-13, VAX-17: fix commits `2d633ba`, `90355db`; VAX-19: `57411f4`), Tommaso Bruno (VAX-18)',
    files: ['Vax17RegressionTest.java', 'Vax19RegressionTest.java'],
    entries: ['VAX-19', 'VAX-17', 'VAX-13'],
  }));
  const twice = mergeKnowledgeText('docs/knowledge/scadenze.md', { base, main: main.replace('commit of VAX-13', 'commit A'), branch: branch.replace('commit of VAX-13', 'commit B') });
  assert.match(twice.conflict, /VAX-13: changed on both sides/, 'one entry rewritten differently on both sides: for a person');
});

test('the pieces: owners split outside parentheses, a person changed on both sides, the line merge', () => {
  assert.deepEqual(parseOwners('**People who know it**: Irene Fabbri (VAX-2, VAX-10; commits a, b), Tommaso Bruno (VAX-3).').map(([k]) => k), ['irene fabbri', 'tommaso bruno']);
  assert.equal(combinePerson('B (VAX-1: `aaaaaaa`)', 'B (VAX-1: `aaaaaaa`)', 'B (VAX-1: `aaaaaaa`)'), 'B (VAX-1: `aaaaaaa`)');
  assert.equal(combinePerson('B (VAX-1, VAX-2)', 'B (VAX-1, VAX-3)', 'B (VAX-1)'), 'B (VAX-1, VAX-2; VAX-3)');
  assert.equal(mergeLines('a\nb\nc', 'a\nB\nc', 'a\nb\nc\nd'), 'a\nB\nc\nd');
  assert.equal(mergeLines('a\nc', 'a\nm\nc', 'a\nr\nc'), 'a\nm\nr\nc', 'two additions at the same place: both');
  assert.equal(mergeLines('a\nb\nc', 'a\nM\nc', 'a\nR\nc'), undefined, 'the same line changed on both sides');
  assert.equal(mergeLines('a\nb', 'a\nx\nb', 'a\nx\nb'), 'a\nx\nb');
});

test('a documentation PR that conflicts with main is brought up to date and merged (real git, GitHub faked)', async () => {
  const origin = join(tmp, 'origin.git');
  const work = join(tmp, 'work');
  const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['clone', '-q', origin, work], { stdio: 'ignore' });
  for (const [k, v] of [['user.name', 'Test'], ['user.email', 't@example.com'], ['commit.gpgsign', 'false']]) git(work, 'config', k, v);
  const write = (files) => {
    for (const [f, t] of Object.entries(files)) {
      mkdirSync(join(work, 'docs/knowledge'), { recursive: true });
      writeFileSync(join(work, f), t);
    }
  };
  const owners = '**People who know it**: Bojan (VAX-13)';
  write({ 'docs/knowledge/README.md': INDEX(['VAX-13']), 'docs/knowledge/scadenze.md': COMPONENT({ owners, entries: ['VAX-13'] }) });
  git(work, 'add', '.');
  git(work, 'commit', '-qm', 'base');
  git(work, 'push', '-q', 'origin', 'main');
  for (const k of ['VAX-17', 'VAX-19']) {
    git(work, 'checkout', '-qb', `docs/${k}`, 'main');
    write({ 'docs/knowledge/README.md': INDEX([k, 'VAX-13']), 'docs/knowledge/scadenze.md': COMPONENT({ owners: `**People who know it**: Bojan (VAX-13, ${k})`, entries: [k, 'VAX-13'] }) });
    git(work, 'commit', '-qam', `${k}: document`);
    git(work, 'push', '-q', 'origin', `docs/${k}`);
  }
  git(work, 'checkout', '-q', 'main');
  git(work, 'merge', '-q', '--squash', 'docs/VAX-17');
  git(work, 'commit', '-qm', 'VAX-17: document (#1)');
  git(work, 'push', '-q', 'origin', 'main');

  const prJson = JSON.stringify({ number: 2, url: 'https://github.com/o/r/pull/2', state: 'OPEN', isDraft: false, headRefName: 'docs/VAX-19', files: [{ path: 'docs/knowledge/README.md' }, { path: 'docs/knowledge/scadenze.md' }] });
  let merges = 0;
  const sh = (cmd, args) => {
    if (args[0] === 'remote') return 'https://github.com/o/r.git';
    if (cmd === 'git') return git(work, ...args).trim();
    if (args[1] === 'view') return prJson;
    if (args[1] === 'merge') {
      merges++;
      git(work, 'fetch', '-q', 'origin');
      try {
        git(work, 'merge-base', '--is-ancestor', 'origin/main', 'origin/docs/VAX-19');
      } catch {
        throw Object.assign(new Error('x'), { stderr: 'Pull request is not mergeable: the merge commit cannot be cleanly created.' });
      }
      return '';
    }
    return '';
  };
  const linted = [];
  const m = await createDocsPrs({ repoDir: work, sh, wait: 1, lint: (files) => (linted.push(files.map((f) => f.file)), []) }).merge(2);
  assert.deepEqual(m.mergedFiles, ['docs/knowledge/README.md', 'docs/knowledge/scadenze.md']);
  assert.equal(merges, 2, 'refused once, merged after the branch was brought up to date');
  assert.deepEqual(linted, [['docs/knowledge/README.md', 'docs/knowledge/scadenze.md']]);
  const show = (f) => git(work, 'show', `origin/docs/VAX-19:${f}`);
  assert.equal(show('docs/knowledge/README.md'), INDEX(['VAX-19', 'VAX-17', 'VAX-13']));
  assert.equal(show('docs/knowledge/scadenze.md'), COMPONENT({ owners: '**People who know it**: Bojan (VAX-13, VAX-17; VAX-19)', entries: ['VAX-19', 'VAX-17', 'VAX-13'] }));
  assert.equal(git(work, 'worktree', 'list').trim().split('\n').length, 1, 'the throwaway worktree is gone');

  // A lint finding after the merge stops it, and the branch is left as it was for a person.
  const before = git(work, 'rev-parse', 'origin/docs/VAX-19').trim();
  git(work, 'checkout', '-q', 'main');
  write({ 'docs/knowledge/README.md': INDEX(['VAX-20', 'VAX-17', 'VAX-13']) });
  git(work, 'commit', '-qam', 'VAX-20: document (#3)');
  git(work, 'push', '-q', 'origin', 'main');
  await assert.rejects(createDocsPrs({ repoDir: work, sh, wait: 1, lint: () => [{ file: 'docs/knowledge/scadenze.md', key: 'VAX-19', message: 'no Test line' }] }).merge(2), (e) => e.status === 409 && /left for a person: the knowledge lint after the merge: docs\/knowledge\/scadenze.md VAX-19: no Test line/.test(e.message));
  git(work, 'fetch', '-q', 'origin');
  assert.equal(git(work, 'rev-parse', 'origin/docs/VAX-19').trim(), before);
  assert.equal(readFileSync(join(work, 'docs/knowledge/README.md'), 'utf8'), INDEX(['VAX-20', 'VAX-17', 'VAX-13']));
});
