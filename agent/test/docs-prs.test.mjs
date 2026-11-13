import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyDocsPrs, createDocsPrs, entryKeys, onlyKnowledge } from '../lib/docs-prs.mjs';

const NOW = Date.parse('2026-11-12T12:00:00Z');
const pr = (o) => ({ number: 3, title: 'LAB-23: document …', url: 'https://github.com/o/MediLab/pull/3', state: 'OPEN', isDraft: true, createdAt: '2026-11-10T10:47:31Z', headRefName: 'docs/LAB-23', files: [{ path: 'docs/knowledge/README.md' }, { path: 'docs/knowledge/results.md' }], ...o });

test('only knowledge files: docs/knowledge/*.md and nothing else', () => {
  assert.equal(onlyKnowledge(['docs/knowledge/README.md', 'docs/knowledge/a.md']), true);
  assert.equal(onlyKnowledge(['docs/knowledge/a.md', 'frontend/src/x.ts']), false);
  assert.equal(onlyKnowledge(['docs/knowledge/a.json']), false);
  assert.equal(onlyKnowledge([]), false);
});

test('listed: open docs PRs, and closed ones whose branch still exists; not fix PRs, merged or discarded ones', () => {
  const list = classifyDocsPrs(
    [
      pr({}),
      pr({ number: 2, headRefName: 'LAB-23', title: 'the fix' }),
      pr({ number: 4, headRefName: 'docs/DEM-40', state: 'CLOSED' }),
      pr({ number: 5, headRefName: 'docs/DEM-39', state: 'CLOSED' }),
      pr({ number: 6, headRefName: 'docs/DEM-33', state: 'MERGED' }),
      pr({ number: 7, headRefName: 'docs/DEM-41', isDraft: false, files: [{ path: 'docs/knowledge/a.md' }, { path: 'backend/pom.xml' }] }),
    ],
    new Set(['docs/DEM-40']),
    NOW,
  );
  assert.deepEqual(list.map((x) => [x.number, x.key, x.state, x.mergeable]), [[7, 'DEM-41', 'open', false], [4, 'DEM-40', 'closed', true], [3, 'LAB-23', 'draft', true]]);
  assert.equal(list.find((x) => x.number === 3).ageDays, 2);
  assert.match(list[0].why, /outside docs\/knowledge\/\*\.md: backend\/pom\.xml/);
});

test('a backfill branch covers several tickets: no ticket key', () => {
  const [x] = classifyDocsPrs([pr({ headRefName: 'docs/backfill-202611121530' })], new Set(), NOW);
  assert.equal(x.key, null);
  assert.equal(x.mergeable, true);
});

test('entry keys: one per documented ticket, also when it appears in several files', () => {
  assert.deepEqual(entryKeys('### DEM-33: a\n- x\n### DEM-32: b\n#### not\n### DEM-33: again'), ['DEM-33', 'DEM-32']);
});

/** A fake gh/git: records the calls, answers `gh pr view` with `view`, and the docs branches with `branches`. */
function fake({ view, branches = ['docs/LAB-23'], mergeFails = false }) {
  const calls = [];
  const sh = (cmd, args) => {
    const line = `${cmd} ${args.join(' ')}`;
    calls.push(line);
    if (line.startsWith('git remote get-url')) return 'https://github.com/o/MediLab.git';
    if (line.startsWith('git ls-remote')) return branches.map((b) => `abc\trefs/heads/${b}`).join('\n');
    if (line.startsWith('gh pr view')) return JSON.stringify(view);
    if (line.startsWith('gh pr merge') && mergeFails) throw Object.assign(new Error('x'), { stderr: 'Pull request is not mergeable: the merge commit cannot be cleanly created.' });
    return '';
  };
  return { sh, calls };
}

test('merge: a closed docs PR with its branch is reopened, made ready and squash-merged', async () => {
  const { sh, calls } = fake({ view: pr({ state: 'CLOSED' }) });
  const m = await createDocsPrs({ repoDir: '.', sh }).merge(3);
  assert.deepEqual(m, { number: 3, key: 'LAB-23', branch: 'docs/LAB-23', url: 'https://github.com/o/MediLab/pull/3', reopened: true });
  const gh = calls.filter((c) => c.startsWith('gh pr ') && !c.startsWith('gh pr view'));
  assert.deepEqual(gh, ['gh pr reopen 3 --repo o/MediLab', 'gh pr ready 3 --repo o/MediLab', 'gh pr merge 3 --repo o/MediLab --squash --delete-branch']);
});

test('merge refuses: code changes, a fix branch, a merged PR, a closed one without its branch; a conflict is reported', async () => {
  const refused = async (view, opts = {}) => {
    const { sh, calls } = fake({ view, ...opts });
    await assert.rejects(createDocsPrs({ repoDir: '.', sh }).merge(3), (e) => {
      refused.last = e.message;
      return e.status === 409;
    });
    return calls;
  };
  let calls = await refused(pr({ files: [{ path: 'docs/knowledge/a.md' }, { path: 'frontend/src/app.ts' }] }));
  assert.match(refused.last, /not merged from the dashboard: it changes files outside .*frontend\/src\/app\.ts/);
  assert.ok(!calls.some((c) => c.startsWith('gh pr merge')), 'never merged');
  await refused(pr({ headRefName: 'LAB-23' }));
  assert.match(refused.last, /not a documentation PR/);
  await refused(pr({ state: 'MERGED' }));
  assert.match(refused.last, /already merged/);
  await refused(pr({ state: 'CLOSED' }), { branches: [] });
  assert.match(refused.last, /branch docs\/LAB-23 is gone/);
  await refused(pr({}), { mergeFails: true });
  assert.match(refused.last, /GitHub did not merge PR #3: Pull request is not mergeable/);
});
