// Done → documentation: when a ticket is resolved, record the problem, cause and fix in the application's
// docs/knowledge/ (document-ticket skill), on branch docs/<KEY>, and open a DRAFT pull request.
// The agent may only write under docs/knowledge/; the watcher checks that, commits, pushes and reports.
//
// documentBatch() does the same for several tickets on ONE branch (docs/backfill-<time>) and opens one pull request:
// the backfill of tickets resolved before (agent/document-backfill.mjs, K4 of docs/KNOWLEDGE_PLAN.md).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runClaude, skillEnv } from './analyze.mjs';
import { describeFindings, lintKnowledge } from './knowledge.mjs';
import { createWorkspace } from './workspace.mjs';

const AGENT_AUTHOR = ['-c', 'user.name=Ticket Intelligence Agent', '-c', 'user.email=ticket-intelligence-agent@users.noreply.github.com'];
const TRAILER = '\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';
const NO_GIT_WRITES = ['NotebookEdit', 'Bash(git commit *)', 'Bash(git push *)', 'Bash(git checkout *)', 'Bash(git switch *)', 'Bash(git reset *)', 'Bash(git rebase *)', 'Bash(git merge *)', 'Bash(git branch *)', 'Bash(git worktree *)'];

/**
 * Where the confirmed fix is, for the prompt: the ticket's own branch (the agent's fix, maybe not merged yet) or the
 * commits on main that name the key (a fix made by a person, or merged long ago).
 */
export function fixSource(key, { fixPr = null, fixBranch = false } = {}) {
  if (fixBranch) return `The fix may not be merged into main yet.${fixPr ? ` It is on branch origin/${key} (pull request ${fixPr}).` : ` It is on branch origin/${key}.`} Read it with: git log --format="%h %an %s" origin/main..origin/${key} and git show <hash>. Treat those commits as the confirmed fix.`;
  return `The fix is on main: the commits whose message names ${key} (git log origin/main --format="%h %ad %an %s" --date=short --grep="${key}"; check that the key matches exactly, ${key}0 is another ticket). Read them with git show <hash>. Treat those commits as the confirmed fix.`;
}

function prompt(key, branch, fix) {
  return `You are running unattended: nobody will answer questions. The current directory is a git worktree of the application on branch ${branch}, created from origin/main.

Jira ticket ${key} is resolved (Done). Use the document-ticket skill to record it in this repository's docs/knowledge/ (its section 5 format: one file per component plus the README.md index).
Overrides for this unattended run:
- Only write the documentation files. Do NOT commit, push, create branches or worktrees, or ask questions; skip the skill's commit-mode and approval steps (sections 4, 6 and 7).
- For the skill's analyze step, run the analyze command from the current directory (it is the project folder).
- ${fix}
- Other entries may already be in docs/knowledge/ (also written in this same branch for other tickets): keep them, add yours, and keep the README.md index complete.
- Write in English. Label anything not confirmed by the commits or the ticket comments as assumed.

Reply with ONLY one \`\`\`json block:
{ "files": ["docs/knowledge/…", "…"], "title": "short symptom title, max 60 chars", "rootCause": "one sentence", "fix": "one sentence" }`;
}

const fail = (message) => Object.assign(new Error(message), { stage: 'document' });

/** Files changed in the worktree since its last commit (committed nothing yet: since origin/main). */
const changedSinceHead = (ws) => {
  const tracked = ws.git(['diff', '--name-only', 'HEAD']).split('\n');
  const untracked = ws.git(['ls-files', '--others', '--exclude-standard']).split('\n');
  return [...new Set([...tracked, ...untracked].map((f) => f.trim()).filter(Boolean))];
};

/**
 * One documentation run in an existing worktree: the agent writes docs/knowledge for `key`, the code checks that
 * nothing else changed and commits it. Returns { out, changed, meta }. On a failure the worktree is put back.
 */
/** The knowledge lint (knowledge.mjs) on the files this run changed: entry rules for `key`, file rules for all. */
function lintChanged(ws, key, cfg) {
  const files = changedSinceHead(ws).filter((f) => f.startsWith('docs/knowledge/') && f.endsWith('.md') && existsSync(join(ws.path, f)));
  const commitExists = (h) => {
    try {
      ws.git(['cat-file', '-e', `${h}^{commit}`]);
      return true;
    } catch {
      return false;
    }
  };
  return lintKnowledge(files.map((f) => ({ file: f, text: readFileSync(join(ws.path, f), 'utf8') })), { keys: [key], projects: [cfg.project], commitExists });
}

const correction = (findings) => `The documentation you wrote does not pass the project's knowledge checks. Correct exactly these findings in the files (docs/knowledge/*.md only) and keep everything else as it is. Do not commit.

${describeFindings(findings)}

Then reply with ONLY the same \`\`\`json block as before: { "files": […], "title": "…", "rootCause": "…", "fix": "…" }`;

async function documentOne({ ws, key, fix, cfg, stateDir, onProgress = () => {} }) {
  const undo = () => {
    ws.git(['reset', '-q', '--hard', 'HEAD']);
    ws.git(['clean', '-q', '-fd']);
  };
  mkdirSync(join(stateDir, 'work', key), { recursive: true }); // the transcript's folder (a backfill ticket has none yet)
  const run = (opts) =>
    runClaude({ cwd: ws.path, cfg, env: skillEnv(cfg), permissionMode: 'acceptEdits', disallowedTools: NO_GIT_WRITES, timeoutMinutes: cfg.fixTimeoutMinutes ?? 15, required: ['files', 'title'], onProgress, ...opts }).catch((e) => {
      undo(); // whatever the run wrote before it failed
      throw fail(e.message);
    });
  const checkPaths = () => {
    const changed = changedSinceHead(ws);
    if (!changed.length) {
      undo();
      throw fail('the agent did not write any documentation');
    }
    const outside = changed.filter((f) => !f.startsWith('docs/knowledge/') || !f.endsWith('.md'));
    if (outside.length) {
      undo();
      throw fail(`documentation may only change docs/knowledge/*.md; also changed: ${outside.join(', ')}`);
    }
    return changed;
  };

  let out = await run({ prompt: prompt(key, ws.branch, fix), transcriptFile: join(stateDir, 'work', key, 'transcript-document.jsonl') });
  let changed = checkPaths();
  // The knowledge lint (K5): one correction in the same session, then the entry passes or nothing is pushed.
  let findings = lintChanged(ws, key, cfg);
  if (findings.length && out.meta.sessionId) {
    onProgress(`knowledge lint: ${findings.length} finding(s), the agent corrects them`);
    const again = await run({ resume: out.meta.sessionId, prompt: correction(findings), transcriptFile: join(stateDir, 'work', key, 'transcript-document-lint.jsonl') });
    out = { result: again.result, meta: { ...again.meta, costUsd: (out.meta.costUsd ?? 0) + (again.meta.costUsd ?? 0), durationMs: (out.meta.durationMs ?? 0) + (again.meta.durationMs ?? 0) } };
    changed = checkPaths();
    findings = lintChanged(ws, key, cfg);
  }
  if (findings.length) {
    undo();
    throw fail(`the entry does not pass the knowledge lint:\n${describeFindings(findings)}`);
  }
  ws.git(['add', '--', ...changed]);
  const title = `${key}: document ${String(out.result.title).replace(new RegExp(`^${key}:?\\s*`), '')}`.slice(0, 100);
  ws.git([...AGENT_AUTHOR, 'commit', '-q', '-m', `${title}\n\nRoot cause: ${out.result.rootCause ?? 'see the entry'}\nFix: ${out.result.fix ?? 'see the entry'}${TRAILER}`]);
  return { out, changed, title, meta: out.meta };
}

const slugOf = (cwd) => execFileSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8' }).trim().match(/github\.com[/:]([^/]+)\/([^/.]+)/);

function openDraftPr({ ws, branch, title, body, bodyFile }) {
  const slug = slugOf(ws.path);
  if (!slug) return null;
  writeFileSync(bodyFile, body);
  return execFileSync('gh', ['pr', 'create', '--repo', `${slug[1]}/${slug[2]}`, '--draft', '--base', 'main', '--head', branch, '--title', title, '--body-file', bodyFile], { encoding: 'utf8' }).trim().split('\n').pop();
}

export async function documentResolved({ issue, repoDir, stateDir, cfg, jira, events }) {
  const key = issue.key;
  const branch = `docs/${key}`;
  const ws = createWorkspace({ repoDir, key, stateDir, branch, name: 'docs-repo' });
  let pushed = false;
  try {
    ws.git(['fetch', '-q', 'origin']);
    let fixPr = null;
    try {
      fixPr = execFileSync('gh', ['pr', 'list', '--head', key, '--state', 'all', '--json', 'url', '--jq', '.[0].url'], { cwd: ws.path, encoding: 'utf8' }).trim() || null;
    } catch {
      /* not GitHub or no PR */
    }
    let fixBranch = false;
    try {
      fixBranch = Boolean(ws.git(['ls-remote', '--heads', 'origin', key]));
    } catch {
      /* no remote */
    }
    events.emit('documenting', { key, text: `writing docs/knowledge on branch ${branch}` });
    const { out, changed, title } = await documentOne({ ws, key, fix: fixSource(key, { fixPr, fixBranch }), cfg, stateDir, onProgress: (step) => events.emit('progress', { key, step }) });
    ws.git(['push', '-q', '-u', 'origin', branch]);
    pushed = true;

    const prUrl = openDraftPr({
      ws, branch, title,
      bodyFile: join(stateDir, 'work', key, 'docs-pr-body.md'),
      body: `## ${key}: known-issue documentation\n\n**Jira:** ${jira.browseUrl(key)}${fixPr ? `\n**Fix:** ${fixPr}` : ''}\n\n- **Root cause:** ${out.result.rootCause ?? '—'}\n- **Fix:** ${out.result.fix ?? '—'}\n\nFiles:\n${changed.map((f) => `- \`${f}\``).join('\n')}\n\n---\n_Draft pull request opened by the Ticket Intelligence agent after the ticket was resolved. A human reviews and merges._\n`,
    });
    await jira.comment(key, `(robot) *AI documentation* — the problem and its fix are recorded in the project's knowledge base, ready for review.\n\n${prUrl ? `[${title}|${prUrl}]` : `branch {{${branch}}}`}\nFiles: ${changed.map((f) => `{{${f}}}`).join(', ')}`);
    events.emit('documented', { key, text: `documentation PR ready (${changed.length} file(s))`, url: prUrl, files: changed });
    return { prUrl, files: changed };
  } finally {
    ws.remove(); // a pushed branch stays, locally and on the remote
    if (!pushed) {
      try {
        execFileSync('git', ['branch', '-D', branch], { cwd: repoDir, stdio: 'ignore' }); // so a retry starts clean
      } catch {
        /* already gone */
      }
    }
  }
}

/**
 * Documents several resolved tickets on one branch and opens one draft pull request (the backfill). Tickets are done
 * one after the other in the same worktree, one commit each, so the README index grows with every entry. A failed
 * ticket is left out (its changes are undone) and the batch goes on. Stops before a ticket when `maxCostUsd` is spent.
 * @param {{ key: string, summary: string }[]} p.tickets
 * @returns {Promise<{ branch, prUrl, done: object[], failed: object[], notRun: string[], costUsd: number }>}
 */
export async function documentBatch({ tickets, repoDir, stateDir, cfg, jira, labels = null, maxCostUsd = Infinity, onProgress = () => {} }) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const name = `backfill-${stamp}`;
  const branch = `docs/${name}`;
  const ws = createWorkspace({ repoDir, key: name, stateDir, branch, name: 'docs-repo' });
  const done = [];
  const failed = [];
  const notRun = [];
  let costUsd = 0;
  let pushed = false;
  try {
    ws.git(['fetch', '-q', 'origin']);
    for (const [i, t] of tickets.entries()) {
      if (costUsd >= maxCostUsd) {
        notRun.push(...tickets.slice(i).map((x) => x.key));
        onProgress(`cost limit $${maxCostUsd} reached: ${tickets.length - i} ticket(s) not run`);
        break;
      }
      onProgress(`${i + 1}/${tickets.length} ${t.key}: ${t.summary}`);
      try {
        const r = await documentOne({ ws, key: t.key, fix: fixSource(t.key), cfg, stateDir, onProgress: (s) => onProgress(`   ${t.key} · ${s}`) });
        costUsd += r.meta.costUsd ?? 0;
        done.push({ key: t.key, title: r.title, rootCause: r.out.result.rootCause ?? null, files: r.changed, costUsd: r.meta.costUsd ?? 0 });
        onProgress(`   ${t.key} documented ($${(r.meta.costUsd ?? 0).toFixed(2)}, total $${costUsd.toFixed(2)})`);
      } catch (e) {
        failed.push({ key: t.key, error: e.message });
        onProgress(`   ${t.key} FAILED: ${e.message}`);
        // The account's usage limit: every next ticket would fail the same way, so the batch stops here and the
        // tickets left are reported as not run (run the command again after the reset).
        if (/hit your .*limit|usage limit|rate limit|quota/i.test(e.message)) {
          notRun.push(...tickets.slice(i + 1).map((x) => x.key));
          onProgress(`usage limit reached: ${tickets.length - i - 1} ticket(s) not run`);
          break;
        }
      }
    }
    if (!done.length) return { branch: null, prUrl: null, done, failed, notRun, costUsd };

    ws.git(['push', '-q', '-u', 'origin', branch]);
    pushed = true;
    const files = [...new Set(done.flatMap((d) => d.files))].sort();
    const prUrl = openDraftPr({
      ws, branch,
      title: `Knowledge base: document ${done.length} resolved ticket${done.length === 1 ? '' : 's'}`,
      bodyFile: join(stateDir, 'work', name, 'docs-pr-body.md'),
      body: `## Knowledge base backfill\n\nTickets resolved before the agent documented them, one commit each. Review the root causes: anything not confirmed by a commit or a ticket comment is labelled **assumed**.\n\n| Ticket | Root cause |\n|---|---|\n${done.map((d) => `| [${d.key}](${jira.browseUrl(d.key)}) | ${String(d.rootCause ?? '—').replace(/\|/g, '/')} |`).join('\n')}\n\nFiles:\n${files.map((f) => `- \`${f}\``).join('\n')}\n${failed.length ? `\nNot documented: ${failed.map((f) => `${f.key} (${f.error})`).join('; ')}\n` : ''}\n---\n_Draft pull request opened by the Ticket Intelligence agent (agent/document-backfill.mjs). A human reviews and merges._\n`,
    });
    // Label first: a comment changes the ticket, and the watcher (documentScope withFix) would take a resolved bug
    // without the label for one it still has to document (FAR-10 was documented twice that way, 2026-11-13).
    if (labels) {
      for (const d of done) {
        try {
          await jira.labels(d.key, { add: [labels.documented] });
        } catch (e) {
          onProgress(`   ${d.key}: label skipped (${e.message.split('\n')[0]})`);
        }
      }
    }
    for (const d of done) {
      try {
        await jira.comment(d.key, `(robot) *AI documentation* — this resolved ticket is now recorded in the project's knowledge base (backfill), ready for review.\n\n${prUrl ? `[${d.title}|${prUrl}]` : `branch {{${branch}}}`}`);
      } catch (e) {
        onProgress(`   ${d.key}: Jira comment or label skipped (${e.message.split('\n')[0]})`);
      }
    }
    return { branch, prUrl, done, failed, notRun, costUsd };
  } finally {
    ws.remove();
    if (!pushed) {
      try {
        execFileSync('git', ['branch', '-D', branch], { cwd: repoDir, stdio: 'ignore' });
      } catch {
        /* never created */
      }
    }
  }
}
