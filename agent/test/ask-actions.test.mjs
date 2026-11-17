import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { after, test } from 'node:test';
import { actionsOn, addFaq, askRecord, faqEntry, faqHas, faqProblems, faqRefusal, findAnswer, logAsk, maskAnswer, peopleFor, recordAction, saveFaq, ticketDraft, viaOf, voteOn, wikiOf } from '../lib/ask-actions.mjs';
import { lintKnowledge, parseKnowledgeFile } from '../lib/knowledge.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'ask-actions-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const CLAUDE = {
  question: 'Why was the third ESA dose due too early?', found: true, at: '2026-11-17T09:42:05.000Z',
  answer: 'The next dose was counted from the first dose instead of the last one (VAX-21). Irene Fabbri fixed it in `dates.ts`; Marta Ricci reviewed it.',
  sources: [{ type: 'ticket', ref: 'VAX-21', url: 'https://jira.example/browse/VAX-21', why: 'the bug' }, { type: 'file', ref: 'frontend/src/app/shared/utils/dates.ts', url: 'https://github.example/blob/main/dates.ts', why: 'nextDue()' }],
  warnings: [{ text: 'MediLab could not be read' }], meta: { costUsd: 0.12, durationMs: 41000 },
};
const FAST = { question: 'Which bugs did Prenotazioni have?', found: true, fast: true, intent: 'history', component: 'Prenotazioni', routed: { via: 'rule' }, answer: 'Prenotazioni has had 3 bugs.', sources: [], at: '2026-11-17T09:50:00.000Z', meta: { costUsd: 0, durationMs: 300 } };
const TEAM = ['Irene Fabbri', 'Marta Ricci', 'Luca Bianchi', 'Bojan Mijatović', 'Ticket Intelligence Agent', 'GitHub'];

test('the record of an answer keeps the audit fields and, since Ask 3/7, the answer and its sources', () => {
  const r = askRecord(CLAUDE);
  assert.deepEqual([r.at, r.question, r.found, r.via, r.sources, r.warnings, r.costUsd, r.durationMs], [CLAUDE.at, CLAUDE.question, true, 'claude', ['VAX-21', 'frontend/src/app/shared/utils/dates.ts'], ['MediLab could not be read'], 0.12, 41000]);
  assert.equal(r.answer, CLAUDE.answer);
  assert.deepEqual(r.cited[1], { type: 'file', ref: 'frontend/src/app/shared/utils/dates.ts', url: 'https://github.example/blob/main/dates.ts', why: 'nextDue()' });
  assert.equal(r.fast, undefined, 'fast only when it was');
  assert.deepEqual([viaOf(FAST), viaOf({ ...FAST, routed: { via: 'System 1' } }), viaOf({ via: 'records', fast: true })], ['rule', 'System 1', 'records']);
  const f = askRecord(FAST);
  assert.deepEqual([f.fast, f.intent, f.component, f.via], [true, 'history', 'Prenotazioni', 'rule']);
});

test('an answer is found again by its time; one from before Ask 3/7 (no text kept) is not', () => {
  const dir = join(tmp, 'records');
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, 'asks.jsonl'), `${JSON.stringify({ at: '2026-11-10T08:00:00.000Z', question: 'old', found: true, sources: [] })}\n{"at":"2026-11-17T09:4`);
  appendFileSync(join(dir, 'asks.jsonl'), '\n');
  logAsk(dir, CLAUDE);
  logAsk(dir, FAST);
  assert.equal(findAnswer(dir, CLAUDE.at).answer, CLAUDE.answer);
  assert.equal(findAnswer(dir, FAST.at).via, 'rule');
  assert.equal(findAnswer(dir, '2026-11-10T08:00:00.000Z'), null, 'no text kept: ask again');
  assert.equal(findAnswer(dir, ''), null);
  assert.equal(findAnswer(join(tmp, 'nothing'), CLAUDE.at), null);
  appendFileSync(join(dir, 'ask-feedback.jsonl'), `${JSON.stringify({ answerAt: CLAUDE.at, vote: 'down' })}\n${JSON.stringify({ answerAt: CLAUDE.at, vote: 'up' })}\n`);
  assert.equal(voteOn(dir, CLAUDE.at), 'up', 'the last vote counts');
  assert.equal(voteOn(dir, FAST.at), null);
  recordAction(dir, { answerAt: CLAUDE.at, action: 'teams', to: null, channel: 'teams' });
  recordAction(dir, { answerAt: FAST.at, action: 'ticket', key: 'DEM-60' });
  assert.deepEqual(actionsOn(dir, CLAUDE.at).map((a) => a.action), ['teams']);
  assert.equal(actionsOn(dir).length, 2);
});

test('the people to @mention: team members the answer names, in its order, then who knows its component; nobody else', () => {
  const named = peopleFor(askRecord(CLAUDE), { team: TEAM });
  assert.deepEqual(named, [{ name: 'Irene Fabbri', why: 'named in the answer' }, { name: 'Marta Ricci', why: 'named in the answer' }]);
  const insights = { components: [{ name: 'Prenotazioni', team: [{ name: 'Marta Ricci', share: 55 }, { name: 'Luca Bianchi', share: 45 }] }] };
  const fast = peopleFor({ ...askRecord(FAST), answer: 'Ask Marta Ricci.' }, { team: TEAM, insights });
  assert.deepEqual(fast.map((p) => p.name), ['Marta Ricci', 'Luca Bianchi'], 'named once, then the component\'s team');
  assert.equal(fast[1].why, 'knows Prenotazioni: 45 % of its commits');
  assert.deepEqual(peopleFor({ answer: 'bojan mijatovic wrote it; the Ticket Intelligence Agent and GitHub did not' }, { team: TEAM }).map((p) => p.name), ['Bojan Mijatović'], 'accents and case do not matter; the agent and bots are not people');
});

test('personal data is masked before an answer leaves the machine; the team stays readable', () => {
  const m = maskAnswer('Giulia Ferrari (RSSMRA80A01H501U) called; Irene Fabbri answered.', TEAM);
  assert.doesNotMatch(m.text, /Giulia Ferrari|RSSMRA80A01H501U/);
  assert.match(m.text, /Irene Fabbri answered/);
  assert.equal(m.masked, 2);
});

test('a ticket draft: the question as the summary, the answer and its sources in Jira wiki markup', () => {
  const d = ticketDraft(askRecord(CLAUDE), { person: { name: 'Irene Fabbri', why: 'named in the answer' }, time: () => '2026-11-17 10:42' });
  assert.equal(d.id, `ask-${CLAUDE.at}`);
  assert.equal(d.summary, 'Why was the third ESA dose due too early');
  assert.deepEqual([d.type, d.priority], ['Task', 'Medium']);
  assert.match(d.description, /^h3\. The question\nWhy was the third ESA dose due too early\?\n\nh3\. What Ask answered\n_2026-11-17 10:42, by Claude from the tickets, the code and the knowledge base\._/);
  assert.match(d.description, /Irene Fabbri fixed it in \{\{dates\.ts\}\}/, 'Markdown code becomes wiki code');
  assert.match(d.description, /h3\. Sources\n\* \[VAX-21\|https:\/\/jira\.example\/browse\/VAX-21\] · the bug\n\* \[frontend\/src\/app\/shared\/utils\/dates\.ts\|https:\/\/github\.example\/blob\/main\/dates\.ts\] · nextDue\(\)/);
  assert.match(d.description, /h3\. Suggested assignee\nIrene Fabbri \(named in the answer\)\./);
  assert.equal(ticketDraft(askRecord(FAST)).summary, 'Which bugs did Prenotazioni have', 'the component is not repeated');
  assert.equal(ticketDraft({ ...askRecord(FAST), question: 'what is late?' }).summary, 'Prenotazioni: What is late', 'the component when the question does not name it');
  assert.equal(wikiOf('**Bold** and [PERSON_1]\n- one\n  - two\n## Head'), '*Bold* and \\[PERSON_1\\]\n* one\n** two\n*Head*', 'a placeholder is not a wiki link');
});

const RECORD = askRecord(CLAUDE);

test('an FAQ entry: a "##" question, its answer indented under one list item; the file stays a valid knowledge file', () => {
  const entry = faqEntry({ ...RECORD, answer: 'First line.\n\n## A heading inside\n- a list' }, { date: '2026-11-17 10:42' });
  assert.equal(entry, [
    '## Why was the third ESA dose due too early?',
    '',
    '- **Asked**: 2026-11-17 10:42; answered by Claude from the tickets, the code and the knowledge base; rated right by a person',
    '- **Answer**: First line.',
    '',
    '  **A heading inside**',
    '  - a list',
    '- **Sources**: [VAX-21](https://jira.example/browse/VAX-21), [frontend/src/app/shared/utils/dates.ts](https://github.example/blob/main/dates.ts)',
    '',
  ].join('\n'));
  const one = addFaq('', entry);
  assert.match(one, /^# Questions and answers\n\nQuestions asked in Ask[^\n]*Newest first\.\n\n## Why was/);
  const two = addFaq(one, faqEntry({ ...RECORD, question: 'How is a lot checked?' }, { date: '2026-11-18 09:00' }));
  assert.deepEqual([...two.matchAll(/^## (.+)$/gm)].map((m) => m[1]), ['How is a lot checked?', 'Why was the third ESA dose due too early?'], 'newest first');
  assert.equal(parseKnowledgeFile(two, 'docs/knowledge/faq.md').entries.length, 0, 'no ticket entries: the entry rules do not apply');
  assert.deepEqual(lintKnowledge([{ file: 'docs/knowledge/faq.md', text: two }], { team: TEAM }), []);
  assert.ok(faqHas(two, 'how is a lot checked'), 'the same question, written another way');
  assert.ok(!faqHas(two, 'How is a lot reserved?'));
});

test('what cannot become an FAQ: a fast answer, a not-found, no sources, no 👍; statements that go stale; personal data', () => {
  assert.equal(faqRefusal(RECORD, 'up'), null);
  assert.match(faqRefusal(askRecord(FAST), 'up'), /made again from fresh data/);
  assert.match(faqRefusal({ ...RECORD, found: false }, 'up'), /no answer/);
  assert.match(faqRefusal({ ...RECORD, cited: [] }, 'up'), /cites no source/);
  assert.match(faqRefusal(RECORD, null), /rate the answer right/);
  assert.match(faqRefusal(RECORD, 'down'), /rate the answer right/);
  assert.match(faqRefusal(null, 'up'), /ask it again/);
  const stale = faqEntry({ ...RECORD, answer: 'The fix is in PR #7, not merged yet.' }, { date: 'x' });
  assert.match(faqProblems(addFaq('', stale), stale, { team: TEAM }).join(), /state of a pull request.*not merged/);
  const personal = faqEntry({ ...RECORD, answer: 'The patient RSSMRA80A01H501U was affected.' }, { date: 'x' });
  assert.match(faqProblems(addFaq('', personal), personal, { team: TEAM }).join(), /fiscal code/);
});

// The documentation PR, on real git: a bare "origin", a clone, the agent's worktree. gh is faked; so is the remote's
// address (a GitHub one), since the clone's origin is a folder.
const exec = promisify(execFile);
const gitSync = (cwd, args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function repoWithOrigin() {
  const root = mkdtempSync(join(tmp, 'faq-'));
  gitSync(root, ['init', '-q', '--bare', '-b', 'main', 'origin.git']);
  gitSync(root, ['clone', '-q', join(root, 'origin.git'), 'repo']);
  const repo = join(root, 'repo');
  mkdirSync(join(repo, 'docs', 'knowledge'), { recursive: true });
  writeFileSync(join(repo, 'docs', 'knowledge', 'README.md'), '# Knowledge base\n');
  gitSync(repo, ['add', '.']);
  gitSync(repo, ['commit', '-q', '-m', 'init']);
  gitSync(repo, ['push', '-q', 'origin', 'HEAD:main']);
  return { root, repo, origin: join(root, 'origin.git') };
}
function fakeRun(openPrs) {
  const calls = [];
  const run = async (cmd, args, opts) => {
    if (cmd === 'gh') {
      calls.push(args.slice(0, 2).join(' '));
      if (args[1] === 'list') return { stdout: JSON.stringify(openPrs()) };
      if (args[1] === 'create') return { stdout: 'https://github.com/o/medivax/pull/14\n' };
      return { stdout: '' };
    }
    if (args[0] === 'remote' && args[1] === 'get-url') return { stdout: 'https://github.com/o/medivax.git\n' };
    return exec(cmd, args, opts);
  };
  return { run, calls };
}

test('saving an FAQ: a draft PR from main the first time; later ones join the open FAQ PR; the same question is refused', async () => {
  const { root, repo, origin } = repoWithOrigin();
  let open = [];
  const { run, calls } = fakeRun(() => open);
  const now = new Date('2026-11-17T09:42:00Z');
  const first = await saveFaq({ repoDir: repo, workDir: join(root, 'work'), record: RECORD, date: '2026-11-17 10:42', team: TEAM, now, run });
  assert.deepEqual([first.branch, first.number, first.created, first.masked], ['docs/faq-20261117-0942', 14, true, 0]);
  assert.deepEqual(calls, ['pr list', 'pr create']);
  const onBranch = gitSync(origin, ['show', 'docs/faq-20261117-0942:docs/knowledge/faq.md']);
  assert.match(onBranch, /^# Questions and answers[\s\S]*## Why was the third ESA dose due too early\?/);
  assert.equal(gitSync(origin, ['log', '-1', '--format=%an', 'docs/faq-20261117-0942']), 'Ticket Intelligence Agent');
  assert.deepEqual(gitSync(origin, ['diff', '--name-only', 'main', 'docs/faq-20261117-0942']).split('\n'), ['docs/knowledge/faq.md'], 'only the FAQ file: the dashboard may merge it');
  assert.equal(gitSync(repo, ['worktree', 'list']).split('\n').length, 1, 'the worktree is gone');

  open = [{ number: 14, url: 'https://github.com/o/medivax/pull/14', headRefName: 'docs/faq-20261117-0942' }];
  const second = await saveFaq({ repoDir: repo, workDir: join(root, 'work'), record: { ...RECORD, question: 'Who checks a lot before it expires?', answer: 'Giulia Ferrari, the nurse.' }, date: '2026-11-17 11:00', team: TEAM, now, run });
  assert.deepEqual([second.branch, second.number, second.created, second.masked], ['docs/faq-20261117-0942', 14, false, 1]);
  assert.deepEqual(calls.slice(2), ['pr list', 'pr comment'], 'a comment on the open PR, no second PR');
  const both = gitSync(origin, ['show', 'docs/faq-20261117-0942:docs/knowledge/faq.md']);
  assert.deepEqual([...both.matchAll(/^## (.+)$/gm)].map((m) => m[1]), ['Who checks a lot before it expires?', 'Why was the third ESA dose due too early?']);
  assert.doesNotMatch(both, /Giulia Ferrari/, 'a name outside the team is masked');

  await assert.rejects(saveFaq({ repoDir: repo, workDir: join(root, 'work'), record: RECORD, date: 'x', team: TEAM, now, run }), (e) => e.status === 409 && /already in the open FAQ PR #14/.test(e.message));
  await assert.rejects(saveFaq({ repoDir: repo, workDir: join(root, 'work'), record: { ...RECORD, question: 'Is it fixed?', answer: 'Yes, in PR #7, not merged yet.' }, date: 'x', team: TEAM, now, run }), (e) => e.status === 422 && /state of a pull request/.test(e.message));
  assert.equal(gitSync(origin, ['log', '--oneline', 'docs/faq-20261117-0942']).split('\n').length, 3, 'nothing pushed for the refused ones');
  assert.equal(gitSync(repo, ['worktree', 'list']).split('\n').length, 1, 'and no worktree left behind');
});

test('saving an FAQ: a question already on main is refused before anything is written', async () => {
  const { root, repo } = repoWithOrigin();
  writeFileSync(join(repo, 'docs', 'knowledge', 'faq.md'), addFaq('', faqEntry(RECORD, { date: 'x' })));
  gitSync(repo, ['add', '.']);
  gitSync(repo, ['commit', '-q', '-m', 'faq']);
  gitSync(repo, ['push', '-q', 'origin', 'HEAD:main']);
  const { run, calls } = fakeRun(() => []);
  await assert.rejects(saveFaq({ repoDir: repo, workDir: join(root, 'work'), record: { ...RECORD, question: 'why was the third ESA dose due too early' }, date: 'x', team: TEAM, run }), /already in docs\/knowledge\/faq\.md on main/);
  assert.deepEqual(calls, [], 'GitHub was not asked');
  assert.equal(readFileSync(join(repo, 'docs', 'knowledge', 'faq.md'), 'utf8').match(/^## /gm).length, 1);
});
