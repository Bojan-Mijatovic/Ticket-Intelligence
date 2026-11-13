// Publishes a verified fix: pushes the branch, opens a DRAFT pull request (GitHub, via gh), attaches the before/after
// screenshots to the Jira ticket and posts a comment with the PR link and the verification results.
// Merging is always left to a human.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bisectJira, bisectMd } from './bisect.mjs';

function githubSlug(remoteUrl) {
  const m = String(remoteUrl).match(/github\.com[/:]([^/]+)\/([^/.]+)(\.git)?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

const mark = (c) => (c.skipped ? 'not needed' : c.ok ? 'passed' : 'FAILED');
const e2eCell = (c) => (c.e2e.skipped ? 'not needed: backend-only change (browser tests use a mocked API)' : `${c.e2e.passed} passed, ${c.e2e.failed} failed`);
const backendCell = (c) => (c.backend.skipped ? 'not needed' : `${c.backend.ok ? 'passed' : 'FAILED'}${c.backend.passed !== undefined ? ` (${c.backend.passed} passed, ${c.backend.failed} failed)` : ''}`);

/** A reviewer must see at once that the fix changed the expected behaviour of an earlier ticket's test. */
function supersededNote(result, format) {
  const t = result.fix.updatedTests ?? [];
  if (!t.length) return '';
  const list = t.map((x) => (format === 'md' ? `- \`${x.file}\` (${x.key}${x.why ? `: ${x.why}` : ''})` : `* {{${x.file}}} (${x.key}${x.why ? `: ${x.why}` : ''})`)).join('\n');
  return format === 'md'
    ? `\n> **⚠ This change replaces earlier behaviour.** The tests of these tickets asserted the old behaviour and were updated to the new one:\n\n${list}\n\nCheck that replacing it is wanted.\n`
    : `\nh3. Replaces earlier behaviour\nThe tests of these tickets asserted the old behaviour and were updated to the new one:\n${list}\n`;
}

function prBody({ key, jiraUrl, analysis, result }) {
  const c = result.checks;
  return `## ${key}

${analysis.summary}

**Jira:** ${jiraUrl}

### Root cause
${analysis.likelyCause}
${bisectMd(result.bisect)}
### Change
${result.fix.description}

Files: ${result.fix.files.map((f) => `\`${f}\``).join(', ')}
${supersededNote(result, 'md')}
### Verification (run independently by the agent's watcher, not reported by the AI)
| Check | Result |
|---|---|
| Regression test \`${result.test.file}\` on the code **before** the fix | failed, as expected (commit ${result.test.commit}) |
| All browser tests **after** the fix | ${e2eCell(c)} |
| Frontend build (\`ng build\`) | ${mark(c.build)} |
| Backend tests (\`mvn test\`) | ${backendCell(c)} |

${result.side === 'backend' ? 'The output of the backend test before the fix and of all backend tests after it is attached to the Jira ticket.' : 'Before/after screenshots and the recorded API calls are attached to the Jira ticket.'}

### Review checklist
- [ ] The test describes the behaviour the ticket asks for
- [ ] The fix is minimal and in the right place
- [ ] Related flows still work (see the analysis in Jira)

---
_Draft pull request opened by the Ticket Intelligence agent. Commits: ${result.test.commit} (test), ${result.fix.commit} (fix). A human reviews and merges._
`;
}

function jiraComment({ prUrl, result, attachments }) {
  const c = result.checks;
  const img = (name) => (attachments.some((a) => a.name === name) ? `!${name}|width=600!` : '_(no screenshot)_');
  return `(robot) *AI reproduction and fix* — a draft pull request is ready for review.

h3. Pull request
[${result.title}|${prUrl}]

h3. Reproduction
${result.side === 'backend' ? `A backend test ({{${result.test.file}}}) written from the ticket fails on the current code:` : "A browser test written from the ticket's steps fails on the current code:"}
{noformat}${String(result.test.firstError ?? result.test.failure ?? '').slice(0, 900)}{noformat}
${bisectJira(result.bisect) ? `\n${bisectJira(result.bisect)}\n` : ''}
h3. Fix
${result.fix.description}
Files: ${result.fix.files.map((f) => `{{${f}}}`).join(', ')}
${supersededNote(result, 'jira')}
h3. Verification (independent checks)
||Check||Result||
|Regression test before the fix|failed, as expected|
|All browser tests after the fix|${e2eCell(c)}|
|Frontend build|${mark(c.build)}|
|Backend tests|${backendCell(c)}|

${result.side === 'backend'
    ? `h3. Before / after
Attached: {{test-before.txt}} (the new test failing on the old code) and {{test-after.txt}} (all backend tests on the fixed code).`
    : `h3. Before / after
*Before:* ${img('before.png')}
*After:* ${img('after.png')}`}

----
_Nothing is merged automatically. Review the pull request and merge it if it is right._`;
}

export async function publishFix({ key, analysis, result, jira, events, stateDir }) {
  const remote = result.ws.git(['remote', 'get-url', 'origin']);
  result.ws.git(['push', '-q', '-u', 'origin', result.branch]);
  events.emit('pushed', { key, text: `branch ${result.branch} pushed` });

  const slug = githubSlug(remote);
  let prUrl = null;
  if (slug) {
    const bodyFile = join(stateDir, 'work', key, 'pr-body.md');
    writeFileSync(bodyFile, prBody({ key, jiraUrl: jira.browseUrl(key), analysis, result }));
    prUrl = execFileSync('gh', ['pr', 'create', '--repo', slug, '--draft', '--base', 'main', '--head', result.branch, '--title', result.title, '--body-file', bodyFile], { encoding: 'utf8' }).trim().split('\n').pop();
    events.emit('pr', { key, text: `draft pull request opened`, url: prUrl });
  } else {
    events.emit('pr', { key, text: `branch pushed to ${remote}; open the pull request in your Git host` });
  }

  const attachments = [];
  for (const [file, name] of [[result.evidence.before, 'before.png'], [result.evidence.after, 'after.png'], [result.evidence.beforeJson, 'api-calls-before.json'], [result.evidence.afterJson, 'api-calls-after.json'], [result.evidence.beforeText, 'test-before.txt'], [result.evidence.afterText, 'test-after.txt']]) {
    if (!file) continue;
    try {
      attachments.push(await jira.attach(key, file, name));
    } catch (e) {
      events.emit('error', { key, text: `attachment ${name}: ${e.message}` });
    }
  }
  const c = await jira.comment(key, jiraComment({ prUrl: prUrl ?? remote, result, attachments }));
  events.emit('commented', { key, text: `reproduction and fix posted to Jira (${attachments.length} attachments)`, url: c.url });

  result.ws.remove(); // the branch stays, locally and on the remote
  return { prUrl, attachments };
}
