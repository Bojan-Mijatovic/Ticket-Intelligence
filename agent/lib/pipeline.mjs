// One ticket, end to end: lock → headless analysis → policy-checked actions → unlock. Every step is an event.

import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePriorArt, runAnalysis } from './analyze.mjs';
import { execFileSync } from 'node:child_process';
import { bisectJira } from './bisect.mjs';
import { reproduceAndFix } from './fix.mjs';
import { analysisCheckout, createWorkspace, startDevServer } from './workspace.mjs';
import { savedAnalyses } from './insights.mjs';
import { setAsideRejected } from './fix-approval.mjs';
import { notifyFixReady, notifyOwner } from './notify.mjs';
import { publishFix } from './publish.mjs';
import { compare as compareSystem1, describeCompare, triageComment } from './system1.mjs';

const RANK = { low: 0, medium: 1, high: 2 };
const AGENT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..'); // config paths are relative to agent/

const titleTags = (summary) => [...String(summary).matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim().toUpperCase());

/**
 * A wanted tag that the analysis implies although the title lacks it: `inferTagFromFiles` maps a tag to a folder
 * (e.g. FE → frontend/); the tag counts when every file the analysis names is inside that folder.
 */
function inferredTag({ result, when }) {
  const under = (f, folder) => {
    const dir = folder.replace(/\/?$/, '/');
    return f.startsWith(dir) || f.includes(`/${dir}`);
  };
  // Test folders (inferIgnoreFiles, e.g. e2e/) say nothing about which side the change belongs to, and neither do
  // files of a linked project ("DEM:backend/…"): the fix is made in this repository.
  const files = (result?.files ?? []).map((f) => String(f).replace(/\\/g, '/')).filter((f) => !/^[A-Z][A-Z0-9_]+:/.test(f) && !(when.inferIgnoreFiles ?? []).some((d) => under(f, d)));
  if (!files.length) return null;
  for (const [tag, folder] of Object.entries(when.inferTagFromFiles ?? {})) {
    if (files.every((f) => under(f, folder))) return tag.toUpperCase();
  }
  return null;
}

/** Why the agent should not propose a fix for this ticket, or null when it may. */
export function fixBlocker({ issue, result, policy }) {
  if (policy.actions.proposeFix !== 'auto') return 'proposeFix is not enabled in policy.json';
  const when = policy.proposeFixWhen ?? {};
  if ((RANK[result.confidence] ?? 0) < (RANK[when.minConfidence] ?? 2)) return `confidence is ${result.confidence}`;
  // The fix belongs in a linked project's code: this repository is the wrong place for it.
  const own = String(issue.key).split('-')[0];
  const fixIn = String(result.fixInProject ?? own).trim().toUpperCase();
  if (fixIn && fixIn !== own) return `the fix belongs in project ${fixIn}, not in ${own}`;
  const wanted = (when.titleTags ?? []).map((t) => t.toUpperCase());
  const tags = titleTags(issue.summary);
  if (wanted.length && !wanted.some((t) => tags.includes(t))) {
    // An explicit tag (e.g. [BE]) is the reporter's decision; inference applies only to titles without any tag.
    if (tags.length) return `title is tagged ${tags.map((t) => `[${t}]`).join('')}, not ${wanted.map((t) => `[${t}]`).join('/')}`;
    const tag = inferredTag({ result, when });
    if (!tag || !wanted.includes(tag)) {
      const folders = Object.values(when.inferTagFromFiles ?? {});
      return `title has no ${wanted.map((t) => `[${t}]`).join('/')} tag${folders.length ? ` and the analysis does not place the change only in ${folders.join(' or ')}` : ''}`;
    }
  }
  // A duplicate stops the fix only when it points at an OLDER ticket: two reports of the same problem a minute apart
  // named each other, and neither was fixed (DEM-42/DEM-43, 2026-11-13). The older one is the original.
  const olderThanThis = (other) => isOlder(String(other ?? ''), issue.key);
  if (when.skipDuplicates && result.duplicateOf?.key && olderThanThis(result.duplicateOf.key)) return `possible duplicate of ${result.duplicateOf.key}`;
  // Already known (K20): no automatic fix for a duplicate, a fix in progress elsewhere, or a problem fixed on main.
  const known = normalizePriorArt(result);
  const skipKnown = when.skipKnown ?? ['duplicate', 'in-progress', 'fixed-on-main'];
  if (known.kind === 'duplicate' && !olderThanThis(known.key)) return null;
  if (skipKnown.includes(known.kind)) return `already known: ${PRIOR_ART_TEXT[known.kind]}${known.key ? ` ${known.key}` : ''}${known.branch ? ` (${known.branch})` : ''}`;
  return null;
}

/**
 * Whether ticket `a` is older than ticket `b`: in the same project by number (Jira numbers in creation order); in
 * another project it is treated as older (that report came first, or the fix belongs there).
 */
export function isOlder(a, b) {
  const [pa, na] = String(a).toUpperCase().split('-');
  const [pb, nb] = String(b).toUpperCase().split('-');
  if (!na || !nb) return true;
  return pa !== pb || Number(na) < Number(nb);
}

/**
 * Whether the analysis' handoff names a person, who can get a Teams message: two to four capitalised words, without a
 * role. LAB-26's analysis handed off to "IT support / network administrator" and FAR-21's to "Reporter / product owner
 * (access administrator to be named)"; both got a message as if they were people (docs/SYSTEM1_PLAN.md, J1).
 */
export function isPersonName(name) {
  const s = String(name ?? '').trim();
  if (!s || /[/()@,;:]|\d/.test(s)) return false;
  if (/\b(unassigned|unknown|n\/a|triage|team|lead|support|admin|administrator|helpdesk|desk|service|office|owner|reporter|product|manager|operations|network|it|dba|sysadmin|vendor|customer|user|staff|group|department|ward|lab|pharmacy|billing)\b/i.test(s)) return false;
  return /^\p{Lu}[\p{L}'’.-]+(\s+((de|di|da|del|della|van|von|der|le|la)\s+)?\p{Lu}[\p{L}'’.-]+){1,3}$/u.test(s);
}

export const PRIOR_ART_TEXT = { documented: 'documented', duplicate: 'duplicate of', 'in-progress': 'fix in progress', 'fixed-on-main': 'fixed on main by', regression: 'regression of', 'solved-before': 'solved before as' };

/**
 * Which side reproduces and fixes the ticket: 'frontend' (Playwright with the mocked API) or 'backend' (JUnit against
 * the real code). A title with [FE] keeps the browser harness, also with [BE][FE]; a title with only [BE], or an
 * untagged ticket whose analysis names only backend files, uses the backend harness.
 */
export function fixSide({ issue, result, policy }) {
  const tags = titleTags(issue.summary);
  if (tags.includes('FE')) return 'frontend';
  if (tags.includes('BE')) return 'backend';
  return inferredTag({ result, when: policy.proposeFixWhen ?? {} }) === 'BE' ? 'backend' : 'frontend';
}

/**
 * Before the analysis: whether a fix is possible at all, to decide whether to warm up a workspace. A title with a
 * wanted tag warms up; an untagged title too when tags can be inferred from the analysis; a title tagged only with
 * something else (e.g. [BE]) does not.
 */
function mayFixByTitle({ issue, policy }) {
  if (policy.actions.proposeFix !== 'auto') return false;
  const when = policy.proposeFixWhen ?? {};
  const wanted = (when.titleTags ?? []).map((t) => t.toUpperCase());
  const tags = titleTags(issue.summary);
  if (!wanted.length || wanted.some((t) => tags.includes(t))) return true;
  return Object.keys(when.inferTagFromFiles ?? {}).length > 0 && !tags.length;
}

let warmPort = 4400;
/**
 * Worktree (+ a warm Angular dev server, unless the title says backend only), prepared while the analysis runs.
 * Resolves to the workspace, or null. Never throws.
 */
async function prepareWorkspace({ key, repoDir, stateDir, events, warm = true }) {
  let ws = null;
  try {
    ws = createWorkspace({ repoDir, key, stateDir });
    if (!warm) {
      events.emit('workspace', { key, text: `worktree on branch ${ws.branch} (backend ticket: no dev server needed)` });
      return ws;
    }
    events.emit('workspace', { key, text: `worktree on branch ${ws.branch}; warming the dev server while the analysis runs` });
    const server = await startDevServer(ws, warmPort++);
    events.emit('warmed', { key, text: `dev server ready in ${Math.round(server.warmMs / 1000)} s (port ${server.port})` });
    return ws;
  } catch (e) {
    if (ws) discardWorkspace(ws, repoDir, key);
    events.emit(e.code === 'BRANCH_EXISTS' ? 'fix-skipped' : 'error', { key, text: `workspace not prepared: ${e.message}` });
    return null;
  }
}

function discardWorkspace(ws, repoDir, key) {
  ws.remove();
  try {
    execFileSync('git', ['branch', '-D', key], { cwd: repoDir, stdio: 'ignore' });
  } catch {
    /* never created or already gone */
  }
}

/**
 * Whether a stopped fix is worth one more try (A3, `retryFix`): the machine or the network failed, not the fix. A
 * check that failed, a bug the test did not reproduce, a rule the fix broke (a stage on the error), or a branch that
 * exists, are answers, not accidents: never retried. VAX-17 (2026-11-13): the fix hit its time limit on a machine
 * busy with a training (the clean-up's EBUSY hid that at the time); run again three days later, it took a minute.
 * @returns {string|null} why it is worth a retry, or null
 */
export function retryableFixError(e) {
  if (!e || e.stage || e.code === 'BRANCH_EXISTS') return null;
  const text = `${e.code ?? ''} ${e.message ?? ''}`;
  if (/timed out after \d+ min/.test(text)) return 'the time limit (a busy machine?)';
  if (/\b(EBUSY|EPERM|ENOTEMPTY|EACCES)\b|resource busy|locked/i.test(text)) return 'a file held by another process';
  if (/\b(ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED)\b|socket hang up|fetch failed|Could not resolve host|unable to access|HTTP 5\d\d/i.test(text)) return 'the network';
  if (/did not answer on port/.test(text)) return 'a dev server that did not start';
  return null;
}

/** Reproduce → fix → verify → draft PR. Returns true when a pull request was opened. Never throws. */
async function maybeFix({ issue, result, cfg, policy, jira, events, repoDir, stateDir, prepared, attempt = 1, rejected = null }) {
  const key = issue.key;
  const blocker = fixBlocker({ issue, result, policy });
  const ws = prepared ? await prepared : null;
  if (blocker) {
    if (ws) discardWorkspace(ws, repoDir, key);
    events.emit('fix-skipped', { key, text: `no automatic fix: ${blocker}` });
    return false;
  }
  try {
    const full = await jira.getIssue(key);
    const toolsDir = cfg.toolsDir ? resolve(AGENT_DIR, cfg.toolsDir) : null;
    const allowSupersededTests = policy.proposeFixWhen?.allowSupersededTestUpdates === true;
    const side = fixSide({ issue, result, policy });
    const fix = await reproduceAndFix({ issue: full, analysis: result, repoDir, stateDir, cfg, events, toolsDir, prepared: ws, allowSupersededTests, side, bisect: policy.actions.bisect === 'auto', rejected });
    suggestOwnerFromBisect({ key, result, bisect: fix.bisect, policy, events });
    const pub = await publishFix({ key, analysis: result, result: fix, jira, events, stateDir });
    // What the reviewer (review.mjs) and agent/review-one.mjs need later, after the worktree is gone.
    const { ws: _ws, ...saved } = fix;
    writeFileSync(join(stateDir, 'work', key, 'fix.json'), JSON.stringify({ ...saved, prUrl: pub.prUrl, at: new Date().toISOString() }, null, 2));
    events.emit('fix-proposed', { key, text: `draft PR ready: ${fix.title}`, url: pub.prUrl, checks: fix.checks, files: fix.fix.files, meta: fix.meta });
    // T6: the owner hears that the fix is ready, in the same channel as the first message. Never throws (notify.mjs).
    if (pub.prUrl && policy.actions.notifyFixReady === 'auto' && isPersonName(result.handoff?.to)) {
      const to = result.handoff.to;
      const n = await notifyFixReady({ key, url: jira.browseUrl(key), prUrl: pub.prUrl, title: fix.title, to, checks: fix.checks, bisect: fix.bisect });
      const text = n.channel === 'teams' ? `Teams message to ${to}: fix ready for review` : n.channel === 'failed' ? `Teams message to ${to} not posted (${n.error}); shown on the dashboard only` : `Teams (simulated) message to ${to}: fix ready for review`;
      events.emit('fix-notified', { key, text, card: n.card, channel: n.channel, ...(n.error ? { error: n.error } : {}) });
    }
    return Boolean(pub.prUrl);
  } catch (e) {
    // A3: one more try after an accident, before anyone is told it stopped. Only once, and only while nothing is
    // pushed: a failed attempt removes its worktree and its local branch, so the retry starts clean.
    const why = attempt === 1 && policy.actions.retryFix === 'auto' ? retryableFixError(e) : null;
    let pushed = false;
    try {
      pushed = Boolean(why) && Boolean(execFileSync('git', ['ls-remote', '--heads', 'origin', key], { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000 }).trim());
    } catch {
      /* cannot tell: the retry's own workspace check decides */
    }
    if (why && !pushed) {
      // A failure before reproduceAndFix took the prepared worktree (Jira unreachable) leaves it and its branch.
      if (ws) discardWorkspace(ws, repoDir, key);
      events.emit('fix-retry', { key, text: `the fix stopped on ${why}: trying once more in 30 s (${String(e.message).split('\n')[0].slice(0, 160)})`, error: e.message });
      await new Promise((r) => setTimeout(r, 30_000));
      return maybeFix({ issue, result, cfg, policy, jira, events, repoDir, stateDir, prepared: null, attempt: 2, rejected });
    }
    events.emit('fix-failed', { key, text: `${e.stage ? `${e.stage}: ` : ''}${e.message}${attempt > 1 ? ' (second try)' : ''}`, checks: e.checks });
    // The fix failed, but the commit that broke it is still evidence worth having on the ticket.
    if (['found', 'range', 'older'].includes(e.bisect?.status)) {
      suggestOwnerFromBisect({ key, result, bisect: e.bisect, policy, events });
      if (policy.actions.postInternalComment === 'auto') {
        try {
          const c = await jira.comment(key, `(robot) *AI reproduction* — the automatic fix stopped (${e.stage ?? 'fix'}), but the reproduction test found this:\n\n${bisectJira(e.bisect)}`);
          events.emit('commented', { key, text: 'bisect result posted to Jira', url: c.url });
        } catch (err) {
          events.emit('error', { key, text: `bisect comment skipped: ${err.message.split('\n')[0]}` });
        }
      }
    }
    return false;
  }
}

/**
 * A2: the person who made the change that broke it knows that change best. A draft assignee (policy assignOwner) when
 * bisect found one commit by a person, not the agent, and it is not the owner the analysis already proposed.
 */
export function suggestOwnerFromBisect({ key, result, bisect, policy, events }) {
  const c = bisect?.status === 'found' ? bisect.culprit : null;
  if (!c || c.agent || !c.author || policy.actions.assignOwner !== 'draft') return false;
  if (String(result?.owner?.name ?? '').trim().toLowerCase() === c.author.trim().toLowerCase()) return false;
  events.emit('draft', { key, kind: 'assign', text: `Suggested assignee: ${c.author}`, why: `made the change that broke it, found by bisect: ${c.short} "${c.subject}"${c.ticket ? ` (${c.ticket})` : ''}` });
  return true;
}

/**
 * The light path (J2 of docs/SYSTEM1_PLAN.md): a ticket System 1 recognised as not about code gets no Claude
 * analysis, no worktree and no owner notice; an internal comment says what it was recognised as and how to have it
 * analysed anyway, and the label `triaged` keeps it from being picked again. Run again sends it through the full flow.
 */
export async function triageTicket({ issue, answers, cfg, policy, jira, events, by = 'policy' }) {
  const { key } = issue;
  const started = Date.now();
  events.emit('picked', { key, text: issue.summary, url: jira.browseUrl(key) });
  try {
    if (policy.actions.postInternalComment === 'auto') {
      const c = await jira.comment(key, triageComment(answers));
      events.emit('commented', { key, text: 'light path: System 1 triage comment posted to Jira', url: c.url });
    }
    await jira.labels(key, { add: [cfg.labels.triaged], remove: [cfg.labels.inProgress, cfg.labels.held, cfg.labels.failed].filter(Boolean) });
    events.emit('triaged', { key, text: `light path (${by === 'person' ? 'chosen by a person' : 'policy'}): ${answers?.type?.choice}, no code analysis`, by, answers });
    events.emit('done', { key, text: `done in ${Math.round((Date.now() - started) / 1000)} s, light path`, totalMs: Date.now() - started, meta: { durationMs: 0, costUsd: 0 } });
    return true;
  } catch (e) {
    events.emit('failed', { key, text: `light path: ${e.message}` });
    return false;
  }
}

function composeComment(result, meta, policy) {
  const footer = `----\n_Generated by the ticket-intelligence agent in ${Math.round(meta.durationMs / 1000)} s · confidence: ${result.confidence} · read-only analysis, nothing was changed in the code._`;
  let body = `${policy.commentHeader}\n\n${result.jiraComment}\n\n${footer}`;
  if (body.length > policy.maxCommentChars) body = `${body.slice(0, policy.maxCommentChars - 40)}\n… (truncated)`;
  return body;
}

/**
 * @param {object} p
 * @param {{key: string, summary: string}} p.issue
 * @param {object} [p.result]  reuse an existing analysis instead of running a new one
 * @param {(job: {kind: string, key: string}) => void} [p.followUp]  queues work that runs after this ticket
 *   (the AI review of its pull request), so the next ticket is not held up
 */
/**
 * @param {object} [p.project]  { key, name } of the ticket's project
 * @param {() => object[]} [p.peers]  read-only checkouts of the linked projects (projects.mjs peerCheckouts), made
 *   right before the analysis
 * @param {Promise<object|null>} [p.system1Answer]  System 1's answers for this ticket (lib/system1.mjs), asked when it
 *   was queued; in shadow they are only compared with the analysis
 */
export async function processTicket({ issue, cfg, policy, jira, events, repoDir, stateDir, project = null, peers = () => [], result: given, followUp = () => {}, system1Answer = null }) {
  const { key } = issue;
  const auto = (action) => policy.actions[action] === 'auto';
  const started = Date.now();
  events.emit('picked', { key, text: issue.summary, url: jira.browseUrl(key) });

  // System 1 (J1 of docs/SYSTEM1_PLAN.md, shadow): the watcher asked the local model when it queued the ticket. After
  // the analysis its answers are compared with it, in the background; they change nothing about this ticket yet.
  const rules = cfg.insights?.components ?? [];
  const compareWithSystem1 = async (result) => {
    const a = system1Answer ? await system1Answer : null;
    if (!a) return;
    const compared = compareSystem1(a.answers, { result, priority: issue.priority, rules });
    events.emit('system1-compared', { key, text: describeCompare(compared), compare: compared, model: a.model });
  };

  let prepared = null;
  try {
    await jira.labels(key, { add: [cfg.labels.inProgress], remove: [cfg.labels.failed] });

    // Warm up the fix workspace in parallel with the analysis (only for tickets the title rules allow).
    const onlyBackend = titleTags(issue.summary).includes('BE') && !titleTags(issue.summary).includes('FE');
    prepared = mayFixByTitle({ issue, policy }) ? prepareWorkspace({ key, repoDir, stateDir, events, warm: !onlyBackend }) : null;

    let result = given;
    let meta = { durationMs: 0, costUsd: 0, turns: 0 };
    if (!result) {
      events.emit('analyzing', { key, text: 'headless agent started' });
      // Analyze origin/main, not whatever branch the application clone is on (a preview, a developer's branch).
      const analysisDir = analysisCheckout({ repoDir, stateDir });
      const linked = peers((text) => events.emit('error', { key, text }));
      if (linked.length) events.emit('progress', { key, step: `linked projects: ${linked.map((p) => `${p.name} (${p.key})`).join(', ')}` });
      ({ result, meta } = await runAnalysis({ key, repoDir: analysisDir, stateDir, cfg, project, peers: linked, onProgress: (step) => events.emit('progress', { key, step }) }));
    }
    const others = (Array.isArray(result.otherProjects) ? result.otherProjects : []).filter((o) => o?.key && String(o.key).toUpperCase() !== key.split('-')[0]);
    if (others.length) {
      events.emit('cross-project', { key, text: `involves ${others.map((o) => o.key).join(', ')}: ${others.map((o) => o.why).filter(Boolean).join(' · ')}`, projects: others, fixIn: result.fixInProject ?? null });
    }
    events.emit('analyzed', {
      key,
      text: `${result.confidence} confidence · owner ${result.owner?.name}`,
      result,
      meta,
    });
    compareWithSystem1(result).catch(() => {}); // in the background: a slow model never holds the ticket up

    if (auto('postInternalComment')) {
      const c = await jira.comment(key, composeComment(result, meta, policy));
      events.emit('commented', { key, text: 'internal analysis posted to Jira', url: c.url });
    }

    // Notify only a real person, and only when the analysis is confident enough to be worth their attention.
    const rank = { low: 0, medium: 1, high: 2 };
    const realOwner = isPersonName(result.handoff?.to);
    const confidentEnough = (rank[result.confidence] ?? 0) >= (rank[policy.notifyMinConfidence] ?? 1);
    if (result.duplicateOf?.key) {
      events.emit('duplicate', { key, text: `possible duplicate of ${result.duplicateOf.key}`, of: result.duplicateOf.key, why: result.duplicateOf.why });
    }
    const known = normalizePriorArt(result);
    if (known.kind !== 'none') {
      events.emit('prior-art', { key, text: `already known: ${PRIOR_ART_TEXT[known.kind]}${known.key ? ` ${known.key}` : ''}${known.commit ? ` (${known.commit})` : ''}${known.why ? ` · ${known.why}` : ''}`, priorArt: known });
    }
    if (auto('notifyOwner') && !(realOwner && confidentEnough)) {
      events.emit('skipped', { key, text: `no notification: ${realOwner ? `${result.confidence} confidence` : 'no clear owner'}` });
    } else if (auto('notifyOwner')) {
      // The owner's "why" only when the message goes to that owner (a handoff may name someone else).
      const sameName = (a, b) => String(a ?? '').normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase() === String(b ?? '').normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
      const why = sameName(result.owner?.name, result.handoff.to) ? result.owner?.why : null;
      const n = await notifyOwner({ key, url: jira.browseUrl(key), title: result.title ?? issue.summary, handoff: result.handoff, confidence: result.confidence, escalate: result.escalate, why, where: result.files?.[0] ?? null });
      const to = result.handoff.to;
      const text = n.channel === 'teams' ? `Teams message to ${to}` : n.channel === 'failed' ? `Teams message to ${to} not posted (${n.error}); shown on the dashboard only` : `Teams (simulated) message to ${to}`;
      events.emit('notified', { key, text, card: n.card, channel: n.channel, ...(n.error ? { error: n.error } : {}) });
    }

    if (policy.actions.assignOwner === 'draft' && result.owner?.name) {
      events.emit('draft', { key, kind: 'assign', text: `Suggested assignee: ${result.owner.name}`, why: result.owner.why });
    }
    if (policy.actions.replyToReporter === 'draft' && result.reporterReply) {
      events.emit('draft', { key, kind: 'reply', text: 'Reply to the reporter prepared', body: result.reporterReply });
    }

    const fixed = await maybeFix({ issue, result, cfg, policy, jira, events, repoDir, stateDir, prepared });
    prepared = null; // handed over: maybeFix owns the workspace now

    const doneLabels = [cfg.labels.done, ...(fixed ? [cfg.labels.fixProposed] : [])];
    if (auto('addLabels')) await jira.labels(key, { add: doneLabels, remove: [cfg.labels.inProgress] });
    else await jira.labels(key, { remove: [cfg.labels.inProgress] });

    events.emit('done', { key, text: `done in ${Math.round((Date.now() - started) / 1000)} s`, totalMs: Date.now() - started, meta });
    if (fixed && auto('reviewFix')) followUp({ kind: 'review', key });
    return result;
  } catch (e) {
    events.emit('failed', { key, text: e.message });
    const ws = prepared ? await prepared : null;
    if (ws) discardWorkspace(ws, repoDir, key);
    try {
      await jira.labels(key, { add: [cfg.labels.failed], remove: [cfg.labels.inProgress] });
    } catch {
      /* best effort */
    }
    return null;
  }
}

/**
 * ROADMAP #9 B (T9): a fix its owner rejected in Teams, fixed again with the reason. The rejected attempt is kept on
 * the branch <KEY>-rejected-<n> and its PR closed with the reason; the ticket's branch is freed (on GitHub and here),
 * and the usual flow runs again: reproduce, bisect, fix, every check, a draft PR, the "fix ready" card in Teams. The
 * reason and the rejected diff are in its prompts. The caller counts the attempts (maxFixAttempts). Never throws.
 * @param {number} p.attempt  the attempt that was rejected (1 for the first fix)
 * @param {(url: string, comment: string) => Promise} [p.closePr]  closes the rejected PR (fix-approval.mjs)
 */
export async function refixTicket({ key, reason, by, prUrl = null, attempt = 1, cfg, policy, jira, events, repoDir, stateDir, closePr = null }) {
  try {
    const result = savedAnalyses(stateDir).get(key)?.result;
    if (!result) throw new Error('the analysis of the ticket is not saved here, so there is nothing to fix again from');
    const aside = await setAsideRejected({ repoDir, key, attempt, closePr: prUrl && closePr ? (comment) => closePr(prUrl, comment) : null, by, reason });
    events.emit('refixing', { key, text: `fixing again: ${by} rejected attempt ${attempt} in Teams (${String(reason).slice(0, 200)}); the rejected change is kept on ${aside.branch}`, branch: aside.branch });
    const issue = await jira.getIssue(key);
    return await maybeFix({ issue, result, cfg, policy, jira, events, repoDir, stateDir, prepared: null, rejected: { reason, by, branch: aside.branch, diff: aside.diff, attempt } });
  } catch (e) {
    events.emit('fix-failed', { key, text: `fixing again after the rejection: ${String(e.message).split('\n')[0]}` });
    return false;
  }
}
