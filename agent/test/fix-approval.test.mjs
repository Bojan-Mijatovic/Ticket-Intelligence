import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { after, test } from 'node:test';
import { cardOf, closePullRequest, decisionOf, mayDecide, newDecisions, prOfTicket, readyPullRequest, recordRejection, rejectionsOf, setAsideRejected } from '../lib/fix-approval.mjs';
import { notifyFixReady, notifyOwner } from '../lib/notify.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'fix-approval-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

/** The card as the webhook posts it (notify.mjs), and as Graph returns it: the Adaptive Card as a JSON string. */
async function postedCard(send) {
  const env = { ...process.env };
  const realFetch = globalThis.fetch;
  process.env.TEAMS_WEBHOOK_URL = 'https://hook.example/1';
  process.env.TEAMS_MENTION_DOMAIN = 'contoso.onmicrosoft.com';
  let sent = null;
  globalThis.fetch = async (url, opts) => {
    sent = JSON.parse(opts.body);
    return new Response('', { status: 202 });
  };
  try {
    await send();
  } finally {
    globalThis.fetch = realFetch;
    process.env = env;
  }
  const a = sent.attachments[0];
  return { id: 'root-1', createdDateTime: '2026-11-17T12:00:00Z', from: { application: { displayName: 'Workflows' } }, attachments: [{ contentType: a.contentType, content: JSON.stringify(a.content) }], replies: [] };
}
const FIX = { key: 'VAX-21', url: 'https://jira.example/browse/VAX-21', prUrl: 'https://github.com/o/MediVax/pull/7', title: 'VAX-21: count from the last dose', to: 'Irene Fabbri', checks: {} };

test('the agent\'s cards in the channel: "fix ready" with its ticket, PR and owner; the handoff; nothing else', async () => {
  const fix = await postedCard(() => notifyFixReady(FIX));
  assert.deepEqual(cardOf(fix), { kind: 'fix', key: 'VAX-21', prUrl: 'https://github.com/o/MediVax/pull/7', to: 'Irene Fabbri', toUpn: 'irene.fabbri@contoso.onmicrosoft.com' });
  const handoff = await postedCard(() => notifyOwner({ key: 'VAX-21', url: FIX.url, title: 'x', handoff: { to: 'Irene Fabbri', message: 'please' }, confidence: 'high', escalate: { yes: false } }));
  assert.deepEqual(cardOf(handoff), { kind: 'handoff', key: 'VAX-21', to: 'Irene Fabbri', toUpn: 'irene.fabbri@contoso.onmicrosoft.com' });
  assert.equal(cardOf({ body: { content: '<p>hi</p>' } }), null);
  assert.equal(cardOf({ attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: '{not json' }] }), null);
});

test('a decision in a reply: approve or reject with the reason, in English, Serbian, Italian; anything else is not one', () => {
  assert.deepEqual(decisionOf('approve'), { verdict: 'approve', note: null });
  assert.deepEqual(decisionOf('Approved, looks good'), { verdict: 'approve', note: 'looks good' });
  assert.deepEqual(decisionOf('ti: odobravam'), { verdict: 'approve', note: null });
  assert.deepEqual(decisionOf('reject: the test checks the wrong week'), { verdict: 'reject', reason: 'the test checks the wrong week' });
  assert.deepEqual(decisionOf('odbij - ne menja se DueService, nego dates.ts'), { verdict: 'reject', reason: 'ne menja se DueService, nego dates.ts' });
  assert.deepEqual(decisionOf('rifiutato: manca il caso di domenica'), { verdict: 'reject', reason: 'manca il caso di domenica' });
  assert.deepEqual(decisionOf('reject'), { verdict: 'reject', reason: null }, 'the agent asks for the reason');
  for (const t of ['I will approve it later', 'looks good', 'rejection rate is low', '']) assert.equal(decisionOf(t), null, t);
});

test('who may decide: the person the card was for (by sign-in name, else by name), or a configured approver', () => {
  const card = { to: 'Irene Fabbri', toUpn: 'irene.fabbri@contoso.onmicrosoft.com' };
  assert.ok(mayDecide({ sender: { displayName: 'Irene F.', userPrincipalName: 'Irene.Fabbri@contoso.onmicrosoft.com' }, card }));
  assert.ok(mayDecide({ sender: { displayName: 'irene fabbri' }, card: { to: 'Irene Fabbri' } }), 'no sign-in name on the card: the name');
  assert.ok(!mayDecide({ sender: { displayName: 'Marta Ricci', userPrincipalName: 'marta.ricci@contoso.onmicrosoft.com' }, card }));
  assert.ok(mayDecide({ sender: { displayName: 'Marta Ricci', userPrincipalName: 'marta.ricci@contoso.onmicrosoft.com' }, card, approvers: ['Marta Ricci'] }), 'a team lead in teams.approvers');
  assert.ok(mayDecide({ sender: { displayName: 'Bojan Mijatović' }, card, approvers: ['Bojan Mijatovic'] }), 'accents do not matter');
});

test('the decisions of a read: replies under "fix ready" cards only, from people, new, oldest first', async () => {
  const fix = await postedCard(() => notifyFixReady(FIX));
  const at = (m) => `2026-11-17T12:${String(m).padStart(2, '0')}:00Z`;
  const reply = (id, text, m, who = { id: 'u-1', displayName: 'Irene Fabbri' }) => ({ id, createdDateTime: at(m), from: { user: who }, body: { contentType: 'html', content: `<p>${text}</p>` } });
  fix.replies = [reply('a', 'reject: wrong week', 5), reply('b', 'approve', 3), reply('c', 'nice work', 4), reply('d', 'approve', 6, { id: 'agent-1', displayName: 'Ticket Intelligence' }), reply('old', 'approve', 0)];
  const plainPost = { id: 'root-2', createdDateTime: at(2), from: { user: { id: 'u-1' } }, body: { content: '<p>approve</p>' }, replies: [reply('e', 'approve', 7)] };
  const ds = newDecisions([fix, plainPost], { me: { id: 'agent-1' }, since: at(1), handled: [] });
  assert.deepEqual(ds.map((d) => [d.id, d.verdict, d.card.key]), [['b', 'approve', 'VAX-21'], ['a', 'reject', 'VAX-21']]);
  assert.equal(ds[1].reason, 'wrong week');
  assert.deepEqual(newDecisions([fix], { me: { id: 'agent-1' }, since: at(1), handled: ['b', 'a'] }), []);
});

test('the PR: made ready only when it is an open draft; closed with a comment only when open', async () => {
  const calls = [];
  const fake = (state, isDraft) => async (cmd, args) => {
    calls.push(args.slice(0, 2).join(' '));
    return { stdout: args[1] === 'view' ? JSON.stringify({ number: 7, url: FIX.prUrl, state, isDraft }) : '' };
  };
  assert.deepEqual(await readyPullRequest(FIX.prUrl, { run: fake('OPEN', true) }), { number: 7, url: FIX.prUrl, state: 'OPEN', wasDraft: true, readied: true });
  assert.deepEqual(calls.splice(0), ['pr view', 'pr ready']);
  assert.equal((await readyPullRequest(FIX.prUrl, { run: fake('OPEN', false) })).readied, false, 'already ready');
  assert.equal((await readyPullRequest(FIX.prUrl, { run: fake('MERGED', false) })).state, 'MERGED');
  assert.deepEqual(calls.splice(0), ['pr view', 'pr view'], 'nothing done to a ready or merged PR');
  await closePullRequest(FIX.prUrl, 'why', { run: fake('OPEN', true) });
  await closePullRequest(FIX.prUrl, 'why', { run: fake('CLOSED', false) });
  assert.deepEqual(calls, ['pr view', 'pr close', 'pr view']);
  assert.equal(prOfTicket('VAX-21', [{ key: 'VAX-21', type: 'fix-proposed', url: 'https://github.com/o/MediVax/pull/5' }, { key: 'VAX-21', type: 'pr', url: 'https://github.com/o/MediVax/pull/9' }]), 'https://github.com/o/MediVax/pull/9');
  assert.equal(prOfTicket('VAX-21', [], FIX.prUrl), FIX.prUrl, 'the card\'s link first');
});

test('the rejections of a ticket are counted', () => {
  const dir = join(tmp, 'state');
  assert.deepEqual(rejectionsOf(dir, 'VAX-21'), []);
  recordRejection(dir, 'VAX-21', { by: 'Irene Fabbri', reason: 'wrong week', attempt: 1 });
  assert.deepEqual(rejectionsOf(dir, 'VAX-21').map((r) => [r.attempt, r.reason]), [[1, 'wrong week']]);
});

test('a rejected fix set aside on real git: kept on <KEY>-rejected-1 with its diff, the PR closed, the ticket\'s branch free', async () => {
  const exec = promisify(execFile);
  const g = (cwd, args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  g(tmp, ['init', '-q', '--bare', '-b', 'main', 'origin.git']);
  g(tmp, ['clone', '-q', join(tmp, 'origin.git'), 'repo']);
  const repo = join(tmp, 'repo');
  writeFileSync(join(repo, 'dates.ts'), 'export const due = 1;\n');
  g(repo, ['add', '.']);
  g(repo, ['commit', '-q', '-m', 'init']);
  g(repo, ['push', '-q', 'origin', 'HEAD:main']);
  // The agent's fix: branch VAX-21 in a worktree, pushed.
  mkdirSync(join(tmp, 'work'), { recursive: true });
  g(repo, ['worktree', 'add', '-q', '-b', 'VAX-21', join(tmp, 'work', 'VAX-21'), 'origin/main']);
  writeFileSync(join(tmp, 'work', 'VAX-21', 'dates.ts'), 'export const due = 2; // VAX-21\n');
  g(join(tmp, 'work', 'VAX-21'), ['commit', '-q', '-am', 'VAX-21: fix']);
  g(join(tmp, 'work', 'VAX-21'), ['push', '-q', 'origin', 'VAX-21']);
  let closed = null;
  const removed = [];
  const r = await setAsideRejected({ repoDir: repo, key: 'VAX-21', attempt: 1, by: 'Irene Fabbri', reason: 'wrong week', closePr: async (c) => { closed = c; }, run: exec, removeWorktree: (rd, p) => { removed.push(p); g(rd, ['worktree', 'remove', '--force', p]); } });
  assert.equal(r.branch, 'VAX-21-rejected-1');
  assert.match(r.diff, /dates\.ts \| 2 \+-[\s\S]*\+export const due = 2; \/\/ VAX-21/);
  assert.match(closed, /^Rejected in Teams by Irene Fabbri: wrong week\n\nThe change is kept on branch `VAX-21-rejected-1`/);
  const heads = g(join(tmp, 'origin.git'), ['branch', '--list']);
  assert.match(heads, /VAX-21-rejected-1/);
  assert.doesNotMatch(heads, /^\s*VAX-21$/m, 'the ticket\'s branch is gone on GitHub');
  assert.equal(g(repo, ['branch', '--list', 'VAX-21']), '', 'and here');
  assert.equal(removed.length, 1, 'the worktree that held it is removed');
  assert.equal(g(join(tmp, 'origin.git'), ['log', '-1', '--format=%s', 'VAX-21-rejected-1']), 'VAX-21: fix', 'nothing of the rejected change is lost');
});
