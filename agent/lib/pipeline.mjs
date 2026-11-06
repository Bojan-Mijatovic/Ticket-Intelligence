// One ticket, end to end: lock → headless analysis → policy-checked actions → unlock. Every step is an event.

import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAnalysis } from './analyze.mjs';
import { execFileSync } from 'node:child_process';
import { reproduceAndFix } from './fix.mjs';
import { analysisCheckout, createWorkspace, startDevServer } from './workspace.mjs';
import { notifyOwner } from './notify.mjs';
import { publishFix } from './publish.mjs';

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
  // Test folders (inferIgnoreFiles, e.g. e2e/) say nothing about which side the change belongs to.
  const files = (result?.files ?? []).map((f) => String(f).replace(/\\/g, '/')).filter((f) => !(when.inferIgnoreFiles ?? []).some((d) => under(f, d)));
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
  if (when.skipDuplicates && result.duplicateOf?.key) return `possible duplicate of ${result.duplicateOf.key}`;
  return null;
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
/** Worktree + warm dev server, prepared while the analysis runs. Resolves to the workspace, or null. Never throws. */
async function prepareWorkspace({ key, repoDir, stateDir, events }) {
  let ws = null;
  try {
    ws = createWorkspace({ repoDir, key, stateDir });
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

/** Reproduce → fix → verify → draft PR. Returns true when a pull request was opened. Never throws. */
async function maybeFix({ issue, result, cfg, policy, jira, events, repoDir, stateDir, prepared }) {
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
    const fix = await reproduceAndFix({ issue: full, analysis: result, repoDir, stateDir, cfg, events, toolsDir, prepared: ws, allowSupersededTests });
    const pub = await publishFix({ key, analysis: result, result: fix, jira, events, stateDir });
    // What the reviewer (review.mjs) and agent/review-one.mjs need later, after the worktree is gone.
    const { ws: _ws, ...saved } = fix;
    writeFileSync(join(stateDir, 'work', key, 'fix.json'), JSON.stringify({ ...saved, prUrl: pub.prUrl, at: new Date().toISOString() }, null, 2));
    events.emit('fix-proposed', { key, text: `draft PR ready: ${fix.title}`, url: pub.prUrl, checks: fix.checks, files: fix.fix.files });
    return Boolean(pub.prUrl);
  } catch (e) {
    events.emit('fix-failed', { key, text: `${e.stage ? `${e.stage}: ` : ''}${e.message}`, checks: e.checks });
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
export async function processTicket({ issue, cfg, policy, jira, events, repoDir, stateDir, result: given, followUp = () => {} }) {
  const { key } = issue;
  const auto = (action) => policy.actions[action] === 'auto';
  const started = Date.now();
  events.emit('picked', { key, text: issue.summary, url: jira.browseUrl(key) });

  let prepared = null;
  try {
    await jira.labels(key, { add: [cfg.labels.inProgress], remove: [cfg.labels.failed] });

    // Warm up the fix workspace in parallel with the analysis (only for tickets the title rules allow).
    prepared = mayFixByTitle({ issue, policy }) ? prepareWorkspace({ key, repoDir, stateDir, events }) : null;

    let result = given;
    let meta = { durationMs: 0, costUsd: 0, turns: 0 };
    if (!result) {
      events.emit('analyzing', { key, text: 'headless agent started' });
      // Analyze origin/main, not whatever branch the application clone is on (a preview, a developer's branch).
      const analysisDir = analysisCheckout({ repoDir, stateDir });
      ({ result, meta } = await runAnalysis({ key, repoDir: analysisDir, stateDir, cfg, onProgress: (step) => events.emit('progress', { key, step }) }));
    }
    events.emit('analyzed', {
      key,
      text: `${result.confidence} confidence · owner ${result.owner?.name}`,
      result,
      meta,
    });

    if (auto('postInternalComment')) {
      const c = await jira.comment(key, composeComment(result, meta, policy));
      events.emit('commented', { key, text: 'internal analysis posted to Jira', url: c.url });
    }

    // Notify only a real person, and only when the analysis is confident enough to be worth their attention.
    const rank = { low: 0, medium: 1, high: 2 };
    const realOwner = result.handoff?.to && !/unassigned|unknown|n\/a|triage|team lead/i.test(result.handoff.to);
    const confidentEnough = (rank[result.confidence] ?? 0) >= (rank[policy.notifyMinConfidence] ?? 1);
    if (result.duplicateOf?.key) {
      events.emit('duplicate', { key, text: `possible duplicate of ${result.duplicateOf.key}`, of: result.duplicateOf.key, why: result.duplicateOf.why });
    }
    if (auto('notifyOwner') && !(realOwner && confidentEnough)) {
      events.emit('skipped', { key, text: `no notification: ${realOwner ? `${result.confidence} confidence` : 'no clear owner'}` });
    } else if (auto('notifyOwner')) {
      const n = await notifyOwner({ key, url: jira.browseUrl(key), title: result.title ?? issue.summary, handoff: result.handoff, confidence: result.confidence, escalate: result.escalate });
      events.emit('notified', { key, text: `${n.channel === 'teams' ? 'Teams' : 'Teams (simulated)'} message to ${result.handoff.to}`, card: n.card, channel: n.channel });
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
