// Done → documentation: when a ticket the agent analyzed is resolved, record the problem, cause and fix in the
// application's docs/knowledge/ (document-ticket skill), on branch docs/<KEY>, and open a DRAFT pull request.
// The agent may only write under docs/knowledge/; the watcher checks that, commits, pushes and reports.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runClaude } from './analyze.mjs';
import { createWorkspace } from './workspace.mjs';

const AGENT_AUTHOR = ['-c', 'user.name=Ticket Intelligence Agent', '-c', 'user.email=ticket-intelligence-agent@users.noreply.github.com'];
const TRAILER = '\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';
const NO_GIT_WRITES = ['NotebookEdit', 'Bash(git commit *)', 'Bash(git push *)', 'Bash(git checkout *)', 'Bash(git switch *)', 'Bash(git reset *)', 'Bash(git rebase *)', 'Bash(git merge *)', 'Bash(git branch *)', 'Bash(git worktree *)'];

function prompt(key, fixPr) {
  return `You are running unattended: nobody will answer questions. The current directory is a git worktree of the application on branch docs/${key}, created from origin/main.

Jira ticket ${key} is resolved (Done). Use the document-ticket skill to record it in this repository's docs/knowledge/ (its section 5 format: one file per component plus the README.md index).
Overrides for this unattended run:
- Only write the documentation files. Do NOT commit, push, create branches or worktrees, or ask questions; skip the skill's commit-mode and approval steps (sections 4, 6 and 7).
- For the skill's analyze step, run the analyze command from the current directory (it is the project folder).
- The fix may not be merged into main yet.${fixPr ? ` It is on branch origin/${key} (pull request ${fixPr}).` : ''} Read it with: git log --format="%h %an %s" origin/main..origin/${key} and git show <hash>. Treat those commits as the confirmed fix.
- Write in English. Label anything not confirmed by the commits or the ticket comments as assumed.

Reply with ONLY one \`\`\`json block:
{ "files": ["docs/knowledge/…", "…"], "title": "short symptom title, max 60 chars", "rootCause": "one sentence", "fix": "one sentence" }`;
}

const fail = (message) => Object.assign(new Error(message), { stage: 'document' });

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
    events.emit('documenting', { key, text: `writing docs/knowledge on branch ${branch}` });
    const out = await runClaude({
      cwd: ws.path,
      prompt: prompt(key, fixPr),
      cfg,
      permissionMode: 'acceptEdits',
      disallowedTools: NO_GIT_WRITES,
      timeoutMinutes: cfg.fixTimeoutMinutes ?? 15,
      transcriptFile: join(stateDir, 'work', key, 'transcript-document.jsonl'),
      required: ['files', 'title'],
      onProgress: (step) => events.emit('progress', { key, step }),
    });

    const changed = ws.changedFiles('HEAD');
    if (!changed.length) throw fail('the agent did not write any documentation');
    const outside = changed.filter((f) => !f.startsWith('docs/knowledge/') || !f.endsWith('.md'));
    if (outside.length) throw fail(`documentation may only change docs/knowledge/*.md; also changed: ${outside.join(', ')}`);

    ws.git(['add', '--', ...changed]);
    const title = `${key}: document ${String(out.result.title).replace(new RegExp(`^${key}:?\\s*`), '')}`.slice(0, 100);
    ws.git([...AGENT_AUTHOR, 'commit', '-q', '-m', `${title}\n\nRoot cause: ${out.result.rootCause ?? 'see the entry'}\nFix: ${out.result.fix ?? 'see the entry'}${TRAILER}`]);
    ws.git(['push', '-q', '-u', 'origin', branch]);
    pushed = true;

    const remote = ws.git(['remote', 'get-url', 'origin']);
    const slug = remote.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    let prUrl = null;
    if (slug) {
      const bodyFile = join(stateDir, 'work', key, 'docs-pr-body.md');
      writeFileSync(bodyFile, `## ${key}: known-issue documentation\n\n**Jira:** ${jira.browseUrl(key)}${fixPr ? `\n**Fix:** ${fixPr}` : ''}\n\n- **Root cause:** ${out.result.rootCause ?? '—'}\n- **Fix:** ${out.result.fix ?? '—'}\n\nFiles:\n${changed.map((f) => `- \`${f}\``).join('\n')}\n\n---\n_Draft pull request opened by the Ticket Intelligence agent after the ticket was resolved. A human reviews and merges._\n`);
      prUrl = execFileSync('gh', ['pr', 'create', '--repo', `${slug[1]}/${slug[2]}`, '--draft', '--base', 'main', '--head', branch, '--title', title, '--body-file', bodyFile], { encoding: 'utf8' }).trim().split('\n').pop();
    }
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
