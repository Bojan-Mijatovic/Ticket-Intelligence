// Reproduce-then-fix for one ticket, in an isolated worktree on branch <KEY>.
//
//   phase 1  agent writes e2e/tests/<KEY>.spec.ts            → watcher: only that file changed, and it FAILS
//            commit "<KEY>: add regression test (fails before the fix)"
//   phase 2  agent changes the application code               → watcher: test file untouched, ticket test and smoke
//                                                               tests PASS, ng build passes, backend tests if touched
//            commit "<KEY>: <summary>"
//
// Nothing is pushed here; publish.mjs does that. On any failed check the worktree and branch are discarded.

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runClaude } from './analyze.mjs';
import { createWorkspace } from './workspace.mjs';
import { runBackendTests, runE2E, runFrontendBuild } from './verify.mjs';

const AGENT_AUTHOR = ['-c', 'user.name=Ticket Intelligence Agent', '-c', 'user.email=ticket-intelligence-agent@users.noreply.github.com'];
const TRAILER = '\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';
// The agent may edit files in its worktree, but never touches git history or remotes; the watcher does that.
const NO_GIT_WRITES = ['NotebookEdit', 'Bash(git commit *)', 'Bash(git push *)', 'Bash(git checkout *)', 'Bash(git switch *)', 'Bash(git reset *)', 'Bash(git rebase *)', 'Bash(git merge *)', 'Bash(git branch *)', 'Bash(git worktree *)'];

const ticketContext = (issue, analysis) => `Ticket ${issue.key}: "${issue.summary}"

Ticket description:
${issue.description}

Analysis already made (JSON):
${JSON.stringify({ summary: analysis.summary, likelyCause: analysis.likelyCause, files: analysis.files, proposedFix: analysis.proposedFix }, null, 2)}`;

function reproducePrompt(issue, analysis, testEnv) {
  return `You are running unattended: nobody will answer questions. The current directory is a git worktree of the application on branch ${issue.key}.

${ticketContext(issue, analysis)}

TASK (phase 1 of 2, reproduce): write ONE Playwright test file, e2e/tests/${issue.key}.spec.ts, that reproduces the bug from the user's point of view, following the ticket's reproduction steps.
- First read e2e/README.md and the files in e2e/support/, and use those helpers (mockApi, pickStructure, clearStructureWithKeyboard, resourceCodes, evidence). Look at e2e/tests/agenda.smoke.spec.ts as an example.
- The test asserts the CORRECT behaviour, so it fails now because of the bug. Name it test('${issue.key}: <expected behaviour>', ...).
- Right before the final assertions, call: await evidence(page, '${issue.key}', api)
- Do not change any other file. Do not commit.
- Run it from the e2e folder: ${testEnv} npx playwright test tests/${issue.key}.spec.ts
  It must fail on an assertion that shows the bug, not on a timeout or a missing selector. If it fails for another reason, fix the test and run it again.

Reply with ONLY one \`\`\`json block:
{ "testFile": "e2e/tests/${issue.key}.spec.ts", "reproduced": true, "failure": "one line: what the failing assertion shows", "notes": "anything the reviewer should know" }`;
}

/**
 * Tests the fix may update: the tests of earlier tickets whose behaviour this ticket deliberately replaces
 * (analysis.supersedes), when they exist. Everything else under e2e/ stays read-only for the fix.
 */
export function supersededTests(analysis, issueKey, exists) {
  return [...new Set((analysis.supersedes ?? []).map((s) => String(s?.key ?? '').toUpperCase()))]
    .filter((k) => /^[A-Z][A-Z0-9_]+-\d+$/.test(k) && k !== issueKey)
    .map((k) => ({ key: k, file: `e2e/tests/${k}.spec.ts`, why: (analysis.supersedes ?? []).find((s) => String(s?.key).toUpperCase() === k)?.why ?? '' }))
    .filter((t) => exists(t.file));
}

function fixPrompt(issue, analysis, testEnv, javaHint, updatable = []) {
  const e2eRule = updatable.length
    ? `- This ticket deliberately replaces behaviour of earlier tickets, and their tests assert the OLD behaviour:
${updatable.map((t) => `    ${t.file} (${t.key}${t.why ? `: ${t.why}` : ''})`).join('\n')}
  Update ONLY those test files so they assert the NEW behaviour this ticket asks for (keep what is still valid; do not delete them, do not weaken unrelated assertions).
  Do NOT modify anything else under e2e/, in particular not e2e/tests/${issue.key}.spec.ts.`
    : '- Do NOT modify anything under e2e/.';
  return `You are running unattended: nobody will answer questions. The current directory is a git worktree of the application on branch ${issue.key}.

${ticketContext(issue, analysis)}

TASK (phase 2 of 2, fix): the committed test e2e/tests/${issue.key}.spec.ts reproduces the bug and fails. Implement the smallest correct fix in the application code.
- Follow the proposed fix unless you find a smaller correct one. Keep existing behaviour working (for example the footer PULISCI button).
${e2eRule}
- Match the style of the surrounding code; a short comment referencing ${issue.key} only where it helps a reader.
- Verify from the e2e folder: ${testEnv} npx playwright test   (all tests must pass; a compile error also makes them fail).
  Do not run ng build: the watcher runs the build and all checks again independently.
  Only if you changed backend code: from the backend folder: mvn -q test ${javaHint}
- Do not commit.

Reply with ONLY one \`\`\`json block:
{ "summary": "imperative commit title, max 72 chars, without the ticket key", "description": "2-4 sentences: what was wrong and what changed", "filesChanged": ["path", "..."], "verified": { "e2e": true, "build": true, "backend": "not needed" } }`;
}

const fail = (stage, message, extra = {}) => Object.assign(new Error(message), { stage, ...extra });

/**
 * @returns {Promise<{ branch, wsPath, test: object, fix: object, checks: object, evidence: { before, after, beforeJson, afterJson } }>}
 */
/**
 * @param {object} [p.prepared]  a workspace created in advance (createWorkspace), possibly with a warm dev server
 */
export async function reproduceAndFix({ issue, analysis, repoDir, stateDir, cfg, events, toolsDir, prepared = null, allowSupersededTests = false }) {
  const key = issue.key;
  const evidenceDir = join(stateDir, 'work', key, 'evidence');
  mkdirSync(evidenceDir, { recursive: true });
  const ws = prepared ?? createWorkspace({ repoDir, key, stateDir });
  if (!prepared) events.emit('workspace', { key, text: `worktree on branch ${ws.branch} from origin/main` });
  // With a warm dev server the agent's test runs reuse it (no CI=1); otherwise each run starts its own server.
  const testEnv = ws.server ? `E2E_PORT=${ws.server.port}` : 'CI=1 E2E_PORT=4390';
  const common = { cwd: ws.path, cfg, permissionMode: 'acceptEdits', disallowedTools: NO_GIT_WRITES, timeoutMinutes: cfg.fixTimeoutMinutes ?? 15 };
  const progress = (step) => events.emit('progress', { key, step });
  const specRel = `e2e/tests/${key}.spec.ts`;
  const keep = (name, as) => {
    const src = join(evidenceDir, `${key}.${name}`);
    if (existsSync(src)) copyFileSync(src, join(evidenceDir, as));
    return existsSync(join(evidenceDir, as)) ? join(evidenceDir, as) : null;
  };

  try {
    // ---------------------------------------------------------------- phase 1: reproduce
    events.emit('reproducing', { key, text: 'agent writes a browser test from the ticket steps' });
    const repro = await runClaude({ ...common, prompt: reproducePrompt(issue, analysis, testEnv), transcriptFile: join(stateDir, 'work', key, 'transcript-reproduce.jsonl'), required: ['testFile', 'reproduced'], onProgress: progress });

    const changed1 = ws.changedFiles('HEAD').filter((f) => !f.startsWith('e2e/evidence/') && !f.startsWith('e2e/test-results/'));
    if (changed1.length !== 1 || changed1[0] !== specRel) throw fail('reproduce', `phase 1 must only add ${specRel}; changed: ${changed1.join(', ') || 'nothing'}`);
    const before = await runE2E(ws, [`tests/${key}.spec.ts`], { evidenceDir });
    if (before.failed < 1) throw fail('reproduce', 'the new test passes on the current code, so it does not reproduce the bug');
    const evBefore = { png: keep('png', 'before.png'), json: keep('json', 'before.json') };
    events.emit('reproduced', { key, text: `bug reproduced: ${repro.result.failure ?? 'test fails as expected'}`, failure: before.firstError, evidence: evBefore.png ? 'before.png' : null });

    ws.git(['add', specRel]);
    ws.git([...AGENT_AUTHOR, 'commit', '-q', '-m', `${key}: add regression test (fails before the fix)${TRAILER}`]);
    const testCommit = ws.git(['rev-parse', '--short', 'HEAD']);

    // ---------------------------------------------------------------- phase 2: fix
    events.emit('fixing', { key, text: 'agent implements the fix' });
    const javaHint = toolsDir ? `(if mvn is not on PATH, use the JDK/Maven in ${toolsDir})` : '';
    const updatable = allowSupersededTests ? supersededTests(analysis, key, (f) => existsSync(join(ws.path, f))) : [];
    if (updatable.length) events.emit('progress', { key, step: `may update the tests of replaced behaviour: ${updatable.map((t) => t.file).join(', ')}` });
    const fix = await runClaude({ ...common, prompt: fixPrompt(issue, analysis, testEnv, javaHint, updatable), transcriptFile: join(stateDir, 'work', key, 'transcript-fix.jsonl'), required: ['summary', 'description'], onProgress: progress });

    const changed2 = ws.changedFiles('HEAD').filter((f) => !f.startsWith('e2e/evidence/') && !f.startsWith('e2e/test-results/'));
    if (!changed2.length) throw fail('fix', 'the agent did not change any file');
    const allowed = new Set(updatable.map((t) => t.file));
    const touchedE2E = changed2.filter((f) => f.startsWith('e2e/') && !allowed.has(f));
    if (touchedE2E.length) throw fail('fix', `the fix must not modify tests${allowed.size ? ` other than ${[...allowed].join(', ')}` : ''}: ${touchedE2E.join(', ')}`);
    const updatedTests = updatable.filter((t) => changed2.includes(t.file));
    if (updatedTests.length) events.emit('progress', { key, step: `updated the test of replaced behaviour: ${updatedTests.map((t) => t.file).join(', ')}` });
    // Only application code counts as "the fix"; an updated superseded test alone is not a fix.
    if (!changed2.some((f) => !f.startsWith('e2e/'))) throw fail('fix', 'the agent changed only tests, not the application code');

    events.emit('verifying', { key, text: `independent checks on ${changed2.length} changed file(s)` });
    const after = await runE2E(ws, [], { evidenceDir });
    const evAfter = { png: keep('png', 'after.png'), json: keep('json', 'after.json') };
    const build = changed2.some((f) => f.startsWith('frontend/')) ? await runFrontendBuild(ws) : { ok: true, skipped: true };
    const backend = changed2.some((f) => f.startsWith('backend/')) ? await runBackendTests(ws, toolsDir) : { ok: true, skipped: true };
    const checks = {
      e2e: { ok: after.ok, passed: after.passed, failed: after.failed, firstError: after.firstError },
      build: { ok: build.ok, skipped: Boolean(build.skipped), output: build.ok ? undefined : build.output },
      backend: { ok: backend.ok, skipped: Boolean(backend.skipped), output: backend.ok ? undefined : backend.output },
    };
    events.emit('verified', { key, text: `e2e ${after.passed} passed / ${after.failed} failed · build ${build.skipped ? 'skipped' : build.ok ? 'ok' : 'FAILED'} · backend ${backend.skipped ? 'not changed' : backend.ok ? 'ok' : 'FAILED'}`, checks, evidence: evAfter.png ? 'after.png' : null });
    if (!after.ok || !build.ok || !backend.ok) throw fail('verify', 'independent checks failed after the fix', { checks });

    ws.git(['add', '-A', '--', ...changed2]);
    const title = `${key}: ${String(fix.result.summary).replace(new RegExp(`^${key}:?\\s*`), '')}`.slice(0, 100);
    ws.git([...AGENT_AUTHOR, 'commit', '-q', '-m', `${title}\n\n${fix.result.description}${TRAILER}`]);
    const fixCommit = ws.git(['rev-parse', '--short', 'HEAD']);

    return {
      ws,
      branch: ws.branch,
      title,
      test: { file: specRel, commit: testCommit, failure: repro.result.failure, firstError: before.firstError, notes: repro.result.notes },
      fix: { commit: fixCommit, summary: fix.result.summary, description: fix.result.description, files: changed2, updatedTests },
      checks,
      evidence: { before: evBefore.png, after: evAfter.png, beforeJson: evBefore.json, afterJson: evAfter.json },
      meta: { durationMs: repro.meta.durationMs + fix.meta.durationMs, costUsd: repro.meta.costUsd + fix.meta.costUsd },
    };
  } catch (e) {
    ws.remove();
    try {
      // The branch was never pushed; drop it so a later retry starts clean.
      execFileSync('git', ['branch', '-D', key], { cwd: repoDir, stdio: 'ignore' });
    } catch {
      /* already gone */
    }
    throw e;
  }
}
