// ROADMAP #9, part B (T9; ROADMAP #1): the approval of a fix from Teams. Under the agent's "fix ready for review" card
// (lib/notify.mjs notifyFixReady), the ticket's owner replies "approve" or "reject: <why>". Approve: the draft PR is
// marked ready for review and Jira says who approved it. Reject: the PR is closed with the reason, the rejected change
// is kept on a branch, and the fix runs again with the reason (pipeline.mjs refixTicket), at most maxFixAttempts in
// all. Merging stays a person's, in GitHub. Plain code here; the watcher reads the channel and acts.

import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The agent's card in a channel message, from its Adaptive Card attachment: { kind: 'fix', key, prUrl, to, toUpn } for
 * a "fix ready for review" card, { kind: 'handoff', key, to, toUpn } for the first one, or null.
 */
export function cardOf(msg) {
  for (const a of msg?.attachments ?? []) {
    if (a.contentType !== 'application/vnd.microsoft.card.adaptive') continue;
    let card = a.content;
    try {
      if (typeof card === 'string') card = JSON.parse(card);
    } catch {
      continue;
    }
    const texts = (card?.body ?? []).filter((b) => b.type === 'TextBlock').map((b) => String(b.text ?? ''));
    const mention = card?.msteams?.entities?.find((e) => e.type === 'mention')?.mentioned ?? null;
    const to = mention?.name ?? texts.find((t) => /^For /.test(t))?.replace(/^For\s+/, '').replace(/<\/?at>/g, '').trim() ?? null;
    const fix = texts.map((t) => t.match(/^([A-Z][A-Z0-9_]+-\d+): fix ready for review$/)).find(Boolean);
    if (fix) {
      const actions = card.actions ?? [];
      const prUrl = (actions.find((x) => /pull request/i.test(x.title ?? '')) ?? actions.find((x) => /\/pull\/\d+/.test(x.url ?? '')))?.url ?? null;
      return { kind: 'fix', key: fix[1], prUrl, to, toUpn: mention?.id ?? null };
    }
    const handoff = texts.map((t) => t.match(/^([A-Z][A-Z0-9_]+-\d+): /)).find(Boolean);
    if (handoff && to) return { kind: 'handoff', key: handoff[1], to, toUpn: mention?.id ?? null };
  }
  return null;
}

/**
 * A decision in a reply, in English, Serbian or Italian: { verdict: 'approve', note } or { verdict: 'reject', reason },
 * or null. "ti:" before it is allowed. A reject without a reason is still a reject: the agent asks for the reason.
 */
export function decisionOf(text) {
  const t = String(text ?? '').trim().replace(/^ti\s*:\s*/i, '');
  const approve = t.match(/^(approve|approved|odobri|odobravam|odobreno|approva|approvo|approvato)\b[\s.!:,–-]*([\s\S]*)$/i);
  if (approve) return { verdict: 'approve', note: approve[2].trim() || null };
  const reject = t.match(/^(reject|rejected|odbij|odbijam|odbijeno|rifiuta|rifiuto|rifiutato)\b[\s.!:,–-]*([\s\S]*)$/i);
  if (reject) return { verdict: 'reject', reason: reject[2].replace(/\s+/g, ' ').trim().slice(0, 1000) || null };
  return null;
}

/**
 * Whether the sender may decide: the person the card was for (by sign-in name when the card @mentioned them, else by
 * name), or one of `approvers` (agent.config.json teams.approvers: a team lead, say).
 */
export function mayDecide({ sender, card, approvers = [] }) {
  const upn = String(sender?.userPrincipalName ?? '').toLowerCase();
  if (card?.toUpn && upn && upn === String(card.toUpn).toLowerCase()) return true;
  if (card?.to && fold(sender?.displayName) && fold(sender.displayName) === fold(card.to)) return true;
  return approvers.some((a) => fold(a) && (fold(a) === fold(sender?.displayName) || fold(a) === upn));
}

/**
 * The decisions of one read: replies under the agent's "fix ready" cards, from a person, newer than `since`, not yet
 * handled, oldest first.
 */
export function newDecisions(roots, { me = null, since, handled = [] } = {}) {
  const done = new Set(handled);
  const from = Date.parse(since);
  const out = [];
  for (const root of roots ?? []) {
    const card = cardOf(root);
    if (card?.kind !== 'fix') continue;
    for (const r of root.replies ?? []) {
      if (!r?.id || done.has(r.id) || r.deletedDateTime || !(Date.parse(r.createdDateTime) > from)) continue;
      if (!r.from?.user?.id || (me?.id && r.from.user.id === me.id)) continue;
      const text = String(r.body?.content ?? '').replace(/<at id="\d+">[\s\S]*?<\/at>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
      const d = decisionOf(text);
      if (d) out.push({ id: r.id, rootId: root.id, card, ...d, from: { id: r.from.user.id, name: r.from.user.displayName ?? 'someone' }, at: r.createdDateTime });
    }
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

// The rejections of a ticket's fixes: state/<project>/work/<KEY>/rejections.json.
const rejectionsFile = (stateDir, key) => join(stateDir, 'work', key, 'rejections.json');
export function rejectionsOf(stateDir, key) {
  try {
    return JSON.parse(readFileSync(rejectionsFile(stateDir, key), 'utf8'));
  } catch {
    return [];
  }
}
export function recordRejection(stateDir, key, entry) {
  const all = [...rejectionsOf(stateDir, key), { at: new Date().toISOString(), ...entry }];
  mkdirSync(join(stateDir, 'work', key), { recursive: true });
  writeFileSync(rejectionsFile(stateDir, key), JSON.stringify(all, null, 2));
  return all;
}

const exec = promisify(execFile);

/**
 * Marks the fix's draft PR ready for review. Nothing is merged. Returns its state before: an already merged or closed
 * PR is not touched, and the caller says why.
 * @returns {Promise<{ number: number, url: string, state: 'OPEN'|'MERGED'|'CLOSED', wasDraft: boolean, readied: boolean }>}
 */
export async function readyPullRequest(prUrl, { cwd, run = exec } = {}) {
  const pr = JSON.parse((await run('gh', ['pr', 'view', prUrl, '--json', 'number,url,state,isDraft'], { cwd, encoding: 'utf8', timeout: 60_000, windowsHide: true })).stdout);
  const out = { number: pr.number, url: pr.url, state: pr.state, wasDraft: pr.isDraft === true, readied: false };
  if (pr.state !== 'OPEN' || !pr.isDraft) return out;
  await run('gh', ['pr', 'ready', prUrl], { cwd, encoding: 'utf8', timeout: 60_000, windowsHide: true });
  return { ...out, readied: true };
}

/** Closes the fix's PR with a comment (its branch stays). */
export async function closePullRequest(prUrl, comment, { cwd, run = exec } = {}) {
  const pr = JSON.parse((await run('gh', ['pr', 'view', prUrl, '--json', 'number,state'], { cwd, encoding: 'utf8', timeout: 60_000, windowsHide: true })).stdout);
  if (pr.state === 'OPEN') await run('gh', ['pr', 'close', prUrl, '--comment', comment], { cwd, encoding: 'utf8', timeout: 60_000, windowsHide: true });
  return { number: pr.number, state: pr.state };
}

/**
 * Sets a rejected fix aside, so that the ticket's branch is free for the next attempt: the branch is copied to
 * <KEY>-rejected-<attempt> on GitHub, its diff kept for the next prompts, its PR closed with the reason (`closePr`), the
 * ticket's branch deleted on GitHub and here (and a worktree still holding it removed). Nothing of the rejected change
 * is lost. Asynchronous, so the watcher keeps answering.
 * @returns {Promise<{ branch: string, diff: string, onGitHub: boolean }>}
 */
export async function setAsideRejected({ repoDir, key, attempt, closePr = null, by = 'a person', reason = '', run = exec, removeWorktree = null }) {
  const git = async (args) => (await run('git', args, { cwd: repoDir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120_000, windowsHide: true })).stdout.trim();
  const branch = `${key}-rejected-${attempt}`;
  await git(['fetch', '-q', '--prune', 'origin']);
  const onGitHub = Boolean(await git(['ls-remote', '--heads', 'origin', key]));
  let diff = '';
  if (onGitHub) {
    await git(['push', '-q', 'origin', `refs/remotes/origin/${key}:refs/heads/${branch}`]);
    const full = `${await git(['diff', '--stat', `origin/main...origin/${key}`])}\n\n${await git(['diff', `origin/main...origin/${key}`])}`;
    diff = full.length > 12_000 ? `${full.slice(0, 12_000)}\n… (cut; the whole diff is on branch ${branch})` : full;
  }
  if (closePr) await closePr(`Rejected in Teams by ${by}: ${reason}\n\nThe change is kept on branch \`${branch}\`. The agent fixes the ticket again with this reason.`);
  if (onGitHub) await git(['push', '-q', 'origin', '--delete', key]);
  const remove = removeWorktree ?? (await import('./workspace.mjs')).removeWorktree;
  for (const block of (await git(['worktree', 'list', '--porcelain'])).split(/\n\s*\n/)) {
    const path = block.match(/^worktree (.+)$/m)?.[1];
    if (path && new RegExp(`^branch refs/heads/${key}$`, 'm').test(block)) remove(repoDir, path);
  }
  await git(['branch', '-D', key]).catch(() => {}); // not here
  return { branch, diff, onGitHub };
}

/** The PR of a ticket's fix: the card's, else the last one the agent opened (events). */
export function prOfTicket(key, events, cardPrUrl = null) {
  if (cardPrUrl) return cardPrUrl;
  return [...events].reverse().find((e) => e.key === key && ['fix-proposed', 'pr'].includes(e.type) && /\/pull\/\d+/.test(e.url ?? ''))?.url ?? null;
}
