// Ask 3/7: what a person can do with an answer. Send it to the Teams channel (with an @mention of a person it names),
// turn it into a Jira ticket draft, or save it in the knowledge base as a question and its answer (K15 of
// docs/KNOWLEDGE_PLAN.md) through a documentation PR. Every action starts from the answer the agent recorded
// (state/<project>/asks.jsonl), never from text the page sends back: what reaches Teams, Jira or the repository is what
// the agent answered, with personal data masked first. Plain code; the git and GitHub steps are in saveFaq().

import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createRedactor } from '../../.claude/skills/analyze-ticket/scripts/lib/redact.mjs';
import { lintKnowledge, TIME_BOUND } from './knowledge.mjs';
import { removeWorktree } from './workspace.mjs';

export const MAX_ANSWER = 20_000;
const clean = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
/** Lower case, no accents: "Mijatović" and "Mijatovic" are one person, "Šta" and "sta" one word. */
const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------- the record of an answer

/** How an answer was made: from the agent's records, by a rule and plain code, by System 1, or by Claude. */
export function viaOf(a) {
  if (a?.via === 'records') return 'records';
  if (a?.fast) return a.routed?.via === 'rule' || a.via === 'rule' ? 'rule' : 'System 1';
  return 'claude';
}
const VIA_TEXT = {
  records: "from the agent's records (no AI)",
  rule: 'by plain code from the Insights data (no AI)',
  'System 1': 'by System 1 and plain code from the Insights data (no Claude call)',
  claude: 'by Claude from the tickets, the code and the knowledge base',
};
export const viaText = (via) => VIA_TEXT[via] ?? VIA_TEXT.claude;

/**
 * The line of asks.jsonl for an answer: the audit fields it always had (the knowledge gaps and the System 1 report read
 * them), and since Ask 3/7 the answer itself and its sources, so that an action on it uses what the agent said.
 */
export function askRecord(answer, extra = {}) {
  const sources = Array.isArray(answer.sources) ? answer.sources : [];
  return {
    at: answer.at,
    question: String(answer.question ?? ''),
    found: answer.found === true,
    ...(answer.fast ? { fast: true } : {}),
    ...(answer.intent ? { intent: answer.intent } : {}),
    ...(answer.component ? { component: answer.component } : {}),
    via: viaOf(answer),
    sources: sources.map((s) => s.ref),
    warnings: (answer.warnings ?? []).map((w) => (typeof w === 'string' ? w : w.text)),
    costUsd: answer.meta?.costUsd ?? 0,
    durationMs: answer.meta?.durationMs ?? null,
    answer: String(answer.answer ?? '').slice(0, MAX_ANSWER),
    cited: sources.map(({ type, ref, url = null, why = '' }) => ({ type, ref, url: url ?? null, why: String(why ?? '').slice(0, 300) })),
    ...(answer.followUp?.at ? { followUp: answer.followUp.at } : {}), // Ask 4/7: the answer this question followed
    ...(answer.main ? { main: answer.main } : {}), // Ask 6/7: the commit of main the answer was read on
    ...(answer.cachedFrom?.at ? { cachedFrom: answer.cachedFrom.at } : {}), // Ask 6/7: given again from that answer
    ...extra,
  };
}

/** The recorded answers of a project that kept their text (Ask 3/7 on), in the order they were given. */
function readRecords(stateDir) {
  const file = join(stateDir, 'asks.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').flatMap((l) => {
    if (!l.includes('"answer":')) return [];
    try {
      const r = JSON.parse(l);
      return typeof r.answer === 'string' && r.at ? [r] : [];
    } catch {
      return [];
    }
  });
}
/** answer time → the last vote on it (K12). */
function votesOf(stateDir) {
  const file = join(stateDir, 'ask-feedback.jsonl');
  const out = new Map();
  if (!existsSync(file)) return out;
  for (const l of readFileSync(file, 'utf8').split('\n')) {
    try {
      const f = JSON.parse(l);
      if (f.answerAt) out.set(f.answerAt, f.vote);
    } catch {
      /* skip */
    }
  }
  return out;
}

/**
 * Ask 6/7: the earlier answers of a project, newest first, in the shape the page shows an answer: with its vote, what
 * was done with it, the question it followed and the answer it was given again from.
 */
export function askHistory(stateDir, { limit = 50 } = {}) {
  const records = readRecords(stateDir);
  const byAt = new Map(records.map((r) => [r.at, r]));
  const votes = votesOf(stateDir);
  const done = new Map();
  for (const a of actionsOn(stateDir)) done.set(a.answerAt, [...(done.get(a.answerAt) ?? []), a]);
  return records.slice(-limit).reverse().map((r) => ({
    at: r.at,
    question: r.question,
    found: r.found === true,
    ...(r.fast ? { fast: true } : {}),
    via: r.via ?? 'claude',
    intent: r.intent ?? null,
    component: r.component ?? null,
    answer: r.answer,
    sources: r.cited ?? [],
    warnings: (r.warnings ?? []).map((text) => ({ text })),
    followUp: r.followUp ? { at: r.followUp, question: byAt.get(r.followUp)?.question ?? '(an earlier question)' } : null,
    cachedFrom: r.cachedFrom ? { at: r.cachedFrom } : null,
    vote: votes.get(r.at) ?? null,
    done: done.get(r.at) ?? [],
    meta: { costUsd: r.costUsd ?? 0, durationMs: r.durationMs ?? null },
    ...(r.fast && r.via !== 'records' ? { routed: { via: r.via === 'rule' ? 'rule' : 'System 1', intent: r.intent } } : {}),
  }));
}

/** Two questions are the same when only case, accents, punctuation and spaces differ. */
export const sameWords = (a, b) => {
  const n = (s) => fold(s).replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
  return n(a) === n(b);
};

/**
 * Ask 6/7: an earlier Claude answer to give again instead of a new run, or null. The same words, in this project,
 * within `maxHours`, read on the same commit of main; found, with sources and no source warnings; not a follow-up
 * (its meaning came from the conversation); and nobody marked it, or a copy of it, wrong.
 */
export function reusableAnswer(stateDir, question, { head, maxHours = 24, now = Date.now() } = {}) {
  if (!head || !(maxHours > 0)) return null;
  const records = readRecords(stateDir);
  const votes = votesOf(stateDir);
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (r.via !== 'claude' || r.cachedFrom || r.followUp || !r.found || !(r.cited ?? []).length || (r.warnings ?? []).length) continue;
    if (now - Date.parse(r.at) > maxHours * 3_600_000 || r.main !== head || !sameWords(r.question, question)) continue;
    const family = [r.at, ...records.filter((x) => x.cachedFrom === r.at).map((x) => x.at)];
    if (family.some((at) => votes.get(at) === 'down')) continue;
    return r;
  }
  return null;
}

export const logAsk = (dir, answer, extra) => appendFileSync(join(dir, 'asks.jsonl'), `${JSON.stringify(askRecord(answer, extra))}\n`);

/** The recorded answer given at `at`, or null: none, or one from before Ask 3/7, whose text was not kept. */
export function findAnswer(stateDir, at) {
  const file = join(stateDir, 'asks.jsonl');
  if (!at || !existsSync(file)) return null;
  const lines = readFileSync(file, 'utf8').split('\n');
  const needle = `"at":${JSON.stringify(String(at))}`;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes(needle)) continue;
    try {
      const r = JSON.parse(lines[i]);
      if (r.at === at && typeof r.answer === 'string') return { ...r, cited: r.cited ?? [] };
    } catch {
      /* a line cut by a crash */
    }
  }
  return null;
}

/**
 * Ask 4/7: the conversation a follow-up continues, oldest first: the answer it follows, the one that one followed,
 * and so on, at most `max`. Empty when the answer is not in the records.
 */
export function followUpChain(stateDir, at, max = 3) {
  const chain = [];
  const seen = new Set();
  for (let cur = at; cur && chain.length < max && !seen.has(cur); ) {
    seen.add(cur);
    const r = findAnswer(stateDir, cur);
    if (!r) break;
    chain.unshift(r);
    cur = r.followUp ?? null;
  }
  return chain;
}

/** The last vote on an answer (K12), or null. */
export function voteOn(stateDir, at) {
  const file = join(stateDir, 'ask-feedback.jsonl');
  if (!existsSync(file)) return null;
  let last = null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes(String(at))) continue;
    try {
      const f = JSON.parse(line);
      if (f.answerAt === at) last = f.vote;
    } catch {
      /* skip */
    }
  }
  return last;
}

// What was done with each answer: shown under it, and a second click on the same action is asked about first.
const actionsFile = (stateDir) => join(stateDir, 'ask-actions.jsonl');
export function recordAction(stateDir, entry) {
  mkdirSync(stateDir, { recursive: true });
  appendFileSync(actionsFile(stateDir), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}
/** The actions on one answer (or on all, without `answerAt`), oldest first. */
export function actionsOn(stateDir, answerAt = null) {
  const file = actionsFile(stateDir);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
    try {
      const a = JSON.parse(l);
      return !answerAt || a.answerAt === answerAt ? [a] : [];
    } catch {
      return [];
    }
  });
}

// ---------------------------------------------------------------- people and privacy

/**
 * The people to offer for an @mention: the team members the answer names, in the order it names them, then who knows
 * its component best. Never anyone outside the team: the list comes from git authors and the configured staff.
 * @param {string[]} team  teamOf(projects): git authors and committers, agent.config.json "staff"
 */
export function peopleFor(record, { team = [], insights = null, max = 5 } = {}) {
  const text = fold(record?.answer);
  const out = new Map(); // folded name → { name, why }
  const people = [...new Set(team)].filter((n) => /\S \S/.test(n) && !/\b(agent|bot|github|merge-check)\b/i.test(n));
  const named = people
    .map((name) => ({ name, at: text.search(new RegExp(`(?<![\\p{L}])${escapeRe(fold(name))}(?![\\p{L}])`, 'u')) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at);
  for (const { name } of named) if (!out.has(fold(name))) out.set(fold(name), { name, why: 'named in the answer' });
  const comp = record?.component ? (insights?.components ?? []).find((c) => c.name === record.component) : null;
  for (const t of comp?.team ?? []) if (!out.has(fold(t.name))) out.set(fold(t.name), { name: t.name, why: `knows ${comp.name}: ${t.share} % of its commits` });
  return [...out.values()].slice(0, max);
}

/** The answer with personal data masked as the analysis masks it (R-02): names outside the team, identifiers. */
export function maskAnswer(text, team = []) {
  const r = createRedactor({ allow: team });
  const masked = r.text(String(text ?? ''));
  return { text: masked, masked: Object.values(r.stats()).reduce((n, x) => n + x, 0) };
}

// ---------------------------------------------------------------- a ticket from an answer

/** Markdown of an answer as Jira wiki markup: bold, code, lists; brackets escaped (a placeholder is not a link). */
export function wikiOf(md) {
  return String(md ?? '')
    .replace(/[[\]{}]/g, (c) => `\\${c}`)
    .replace(/\*\*([^*\n]+)\*\*/g, '*$1*')
    .replace(/`([^`\n]+)`/g, '{{$1}}')
    .replace(/^#{1,6} +(.+)$/gm, '*$1*')
    .replace(/^(\s*)[-•] +/gm, (m, sp) => `${sp.length >= 2 ? '**' : '*'} `);
}

/**
 * A Jira draft from an answer, for a person to edit and confirm: the question as the summary (with the component
 * when the answer has one), Task and Medium until the person says otherwise, the answer and its sources in the
 * description. `person`: who knows the component best, suggested as the assignee.
 */
export function ticketDraft(record, { time = (iso) => String(iso).slice(0, 16).replace('T', ' '), person = null } = {}) {
  const q = clean(record.question).replace(/\s*[?？]+$/, '');
  const summary = `${record.component && !fold(q).includes(fold(record.component)) ? `${record.component}: ` : ''}${q.charAt(0).toUpperCase()}${q.slice(1)}`.slice(0, 250);
  const sources = (record.cited ?? []).map((s) => `* ${s.url ? `[${s.ref}|${s.url}]` : `{{${s.ref}}}`}${s.why ? ` · ${wikiOf(clean(s.why))}` : ''}`);
  const description = [
    'h3. The question',
    wikiOf(clean(record.question)),
    '',
    `h3. What Ask answered`,
    `_${time(record.at)}, ${viaText(record.via)}._`,
    '',
    wikiOf(record.answer),
    '',
    ...(sources.length ? ['h3. Sources', ...sources, ''] : []),
    ...(person ? ['h3. Suggested assignee', `${person.name} (${person.why}).`, ''] : []),
    '----',
    '_Drafted by Ticket Intelligence from an Ask answer; a person edited and created it. Check the answer against its sources before planning it._',
  ].join('\n');
  return { id: `ask-${record.at}`, summary, type: 'Task', priority: 'Medium', description, person };
}

/** The item the prior-art check (K17/K19) compares with Jira, the knowledge base and the open pull requests. */
export const priorArtItem = (record, summary) => ({
  summary: summary ?? record.question,
  text: record.answer,
  files: (record.cited ?? []).filter((s) => s.type === 'file').map((s) => s.ref),
  component: record.component ?? null,
  since: null,
});

// ---------------------------------------------------------------- a question and its answer in the knowledge base

export const FAQ_FILE = 'docs/knowledge/faq.md';
export const FAQ_BRANCH = 'docs/faq';
const FAQ_HEAD = [
  '# Questions and answers',
  '',
  'Questions asked in Ask (the Ticket Intelligence dashboard) whose answer a person rated right and saved. Each answer lists the sources it was checked against when it was given. The code and the ticket entries stay the reference: when an answer and the code differ, the code is right and the answer is corrected here. Newest first.',
  '',
].join('\n');

/** The questions in a FAQ text ("## …" headings). */
export const faqQuestions = (text) => [...String(text ?? '').matchAll(/^## +(.+)$/gm)].map((m) => m[1].trim());
const sameQuestion = (a, b) => fold(a).replace(/[^\p{L}\p{N} ]/gu, '').trim() === fold(b).replace(/[^\p{L}\p{N} ]/gu, '').trim();
export const faqHas = (text, question) => faqQuestions(text).some((q) => sameQuestion(q, question));

/**
 * One FAQ entry. The answer is a list item whose lines are indented under it; its own headings become bold lines,
 * so that an answer never opens a section of the file.
 */
export function faqEntry(record, { date, answer = record.answer }) {
  const lines = String(answer).replace(/\r/g, '').trim().split('\n').map((l) => l.replace(/^\s*#{1,6} +(.+)$/, '**$1**'));
  const body = lines.map((l, i) => (i === 0 ? l : l.trim() ? `  ${l}` : '')).join('\n');
  const sources = (record.cited ?? []).map((s) => (s.url ? `[${s.ref.replace(/[[\]]/g, '')}](${s.url})` : `\`${s.ref}\``));
  return [
    `## ${clean(record.question)}`,
    '',
    `- **Asked**: ${date}; answered ${viaText(record.via)}; rated right by a person`,
    `- **Answer**: ${body}`,
    ...(sources.length ? [`- **Sources**: ${sources.join(', ')}`] : []),
    '',
  ].join('\n');
}

/** The FAQ file with the entry added, newest first; the file and its head are created when there is none. */
export function addFaq(existing, entry) {
  const text = String(existing ?? '').replace(/\r/g, '');
  if (!text.trim()) return `${FAQ_HEAD}\n${entry}`;
  const first = text.search(/^## /m);
  return first < 0 ? `${text.replace(/\n*$/, '\n\n')}${entry}` : `${text.slice(0, first)}${entry}\n${text.slice(first)}`;
}

/** Why an answer cannot be saved as it is: the knowledge lint's personal-data rules, and statements that go stale. */
export function faqProblems(text, entry, { team = null } = {}) {
  const out = lintKnowledge([{ file: FAQ_FILE, text }], { team }).map((f) => f.message);
  const tb = String(entry).match(TIME_BOUND);
  if (tb) out.push(`it states the state of a pull request or a branch ("${tb[0]}"): true today, wrong next week`);
  return out;
}

/**
 * Why an answer cannot become a FAQ, or null. Only an answer Claude gave from the sources, rated right: a fast answer
 * (a ticket's status, the latest tickets, who knows a component) is computed again from fresh data every time, so a
 * saved copy would only go stale.
 */
export function faqRefusal(record, vote) {
  if (!record) return 'the answer is not in the records (given before answers were kept): ask it again';
  if (record.via !== 'claude') return 'an answer from plain code or the records is made again from fresh data each time it is asked; a saved copy would go stale';
  if (!record.found) return 'the knowledge base had no answer to this question';
  if (!(record.cited ?? []).length) return 'the answer cites no source';
  if (vote !== 'up') return 'rate the answer right (👍) first: only a checked answer goes into the knowledge base';
  return null;
}

const exec = promisify(execFile);

/**
 * Saves an answer as a FAQ entry through a documentation PR: the open FAQ PR collects the entries until a person
 * merges it (one branch, one file, no conflicts between FAQ PRs); without one, a new branch from main and a draft PR.
 * Merging stays a person's (Knowledge base section, policy mergeDocs). Async: the watcher keeps answering.
 * @returns {Promise<{ number: number|null, url: string|null, branch: string, created: boolean, masked: number }>}
 */
export async function saveFaq({ repoDir, workDir, record, date, team = [], now = new Date(), run = exec }) {
  const git = async (cwd, args) => (await run('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true, timeout: 120_000 })).stdout.trim();
  const gh = async (args) => (await run('gh', args, { cwd: repoDir, encoding: 'utf8', windowsHide: true, timeout: 60_000 })).stdout.trim();
  const fail = (message, status = 409) => Object.assign(new Error(message), { status });
  const slug = (await git(repoDir, ['remote', 'get-url', 'origin'])).match(/github\.com[/:]([^/]+)\/([^/.\s]+)/)?.slice(1, 3).join('/');
  if (!slug) throw fail('the repository has no GitHub remote: a documentation PR cannot be opened');
  await git(repoDir, ['fetch', '-q', '--prune', 'origin']);

  const onMain = await git(repoDir, ['show', `origin/main:${FAQ_FILE}`]).catch(() => '');
  if (faqHas(onMain, record.question)) throw fail(`the question is already in ${FAQ_FILE} on main`);
  const open = JSON.parse(await gh(['pr', 'list', '--repo', slug, '--state', 'open', '--limit', '50', '--json', 'number,url,headRefName']))
    .filter((p) => p.headRefName === FAQ_BRANCH || p.headRefName.startsWith(`${FAQ_BRANCH}-`))
    .sort((a, b) => a.number - b.number)[0] ?? null;
  const branch = open?.headRefName ?? `${FAQ_BRANCH}-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${now.toISOString().slice(11, 16).replace(':', '')}`;

  const { text: answer, masked } = maskAnswer(record.answer, team);
  const entry = faqEntry(record, { date, answer });
  mkdirSync(workDir, { recursive: true });
  const wt = join(workDir, 'repo');
  if (existsSync(wt)) removeWorktree(repoDir, wt); // a save that was stopped half-way
  await git(repoDir, ['worktree', 'add', '-q', '--detach', wt, open ? `origin/${branch}` : 'origin/main']);
  try {
    const file = join(wt, FAQ_FILE);
    const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (faqHas(before, record.question)) throw fail(`the question is already in the open FAQ PR #${open?.number}: ${open?.url}`);
    const after = addFaq(before, entry);
    const problems = faqProblems(after, entry, { team });
    if (problems.length) throw fail(`not saved: ${problems.join('; ')}`, 422);
    mkdirSync(join(wt, 'docs', 'knowledge'), { recursive: true });
    writeFileSync(file, after);
    await git(wt, ['add', '--', FAQ_FILE]);
    const title = `FAQ: ${clean(record.question)}`.slice(0, 100);
    await git(wt, ['-c', 'user.name=Ticket Intelligence Agent', '-c', 'user.email=ticket-intelligence-agent@users.noreply.github.com', 'commit', '-q', '-m', `${title}\n\nSaved from Ask after a person rated the answer right.\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`]);
    await git(wt, ['push', '-q', 'origin', `HEAD:refs/heads/${branch}`]);
  } finally {
    removeWorktree(repoDir, wt);
  }

  const line = `- ${clean(record.question)} (asked ${date}, answered ${viaText(record.via)})`;
  if (open) {
    await gh(['pr', 'comment', String(open.number), '--repo', slug, '--body', `Added from Ask:\n${line}`]).catch(() => '');
    return { number: open.number, url: open.url, branch, created: false, masked };
  }
  const body = [
    'Questions and their answers saved from Ask (K15 of docs/KNOWLEDGE_PLAN.md): a person rated each answer right on the Ticket Intelligence dashboard and saved it. More saved answers are added to this PR until it is merged.',
    '',
    line,
    '',
    `Only \`${FAQ_FILE}\` changes. Check each answer against its sources, then merge it here or from the dashboard (Insights → Knowledge base).`,
  ].join('\n');
  const url = (await gh(['pr', 'create', '--repo', slug, '--draft', '--base', 'main', '--head', branch, '--title', 'Knowledge: questions and answers from Ask', '--body', body])).split('\n').pop();
  return { number: Number(url.match(/\/pull\/(\d+)/)?.[1]) || null, url, branch, created: true, masked };
}
