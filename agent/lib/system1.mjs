// System 1 (docs/SYSTEM1_PLAN.md): a local fine-tuned decision model (Laya) in front of the Claude analysis.
// J1 runs it in shadow: every picked ticket gets System 1's answers as a `system1` event, in parallel with the
// analysis, and after the analysis a `system1-compared` event says where the two agree. Nothing else changes.
//
// The questions live here, once: the dataset builder (agent/system1-data.mjs) trains with exactly these words and
// options, and the watcher asks with them. The model answers on 127.0.0.1 only (agent/system1/server.py).

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { componentOf } from './insights.mjs';
import { parseKnowledgeFile } from './knowledge.mjs';
import { createRedactor } from '../../.claude/skills/analyze-ticket/scripts/lib/redact.mjs';

export const TYPE = {
  'bug in code': 'the application does something wrong: an error, a wrong value, a screen or an API that misbehaves',
  'change request': 'change how an existing screen or rule works, as someone wishes, not because it is broken',
  'new requirement': 'a new screen, field, function or integration that does not exist yet',
  'system support': 'servers, databases, printers, certificates, accounts, passwords, access; no change to the code',
  'data recovery or fix': 'recover, correct or export data for someone; no change to the code',
  'user question': 'a person asks how to do something',
  unclear: 'too short or vague to tell what is wanted',
};
export const SIDE = {
  frontend: 'the screen in the browser: fields, buttons, lists, labels, colours, navigation',
  backend: 'the server: the API, the database, rules, calculations, imports, other systems',
  both: 'both the screen and the server',
  'not code': 'nothing to change in the code',
};
export const URGENCY = {
  urgent: 'blocks work, patients or many users; needs a fix now',
  normal: 'a real problem or need, with a way to keep working',
  low: 'cosmetic, minor or nice to have',
};
/** The types that need a change in the code; the others can take the light path (J2). */
export const CODE_TYPES = new Set(['bug in code', 'change request', 'new requirement']);
/** A two-option question (the model card's advice instead of a yes/no 'noul', which leans to "no"). */
export const CODE = {
  'needs code': 'something in the application has to be fixed, changed or added',
  'no code change': 'servers, accounts, data, a question or an unclear request; the application stays as it is',
};
export const NONE = 'none of these';
/** Ask (J5): what a question asks for. */
export const INTENT = {
  who: 'the people who know or changed a part of the application',
  history: 'earlier bugs, or whether a problem happened before',
  latest: 'the newest bug, ticket or change',
  how: 'how something works, or why it behaves so',
  where: 'where in the code something is',
  other: 'anything else',
};
/** Privacy (J6): asked on a text where the team's names are masked too, so a name that is left is a stranger's. */
export const PRIVACY = {
  'names a person': "a person's name or surname, or a personal number such as a fiscal code, phone or health card",
  'no person': 'only placeholders like [PERSON_1], roles, product, lot or request codes',
};

/**
 * J7 (WF1): what a report tells, as four two-option questions; the second option of each is "missing" (MISSING).
 * Labels: demo/system1/completeness.json and the written tickets' `missing`.
 */
export const COMPLETE = {
  steps: ['Does the report tell what was done, or when it happens?', {
    'tells what was done': 'the actions, the input or the conditions under which it happens',
    'no steps': 'only the symptom, or nothing',
  }],
  expected: ['Does the report tell what is wrong?', {
    'tells what is wrong': 'what happens compared with what should happen, said or obvious: an error, a wrong value, twice instead of once',
    'not what is wrong': 'only that something does not work, is wrong or is strange',
  }],
  screen: ['Does the report name where in the application or the system?', {
    'names the screen': 'a screen, page, function, button, report, API, device or account',
    'no screen': 'no part of the application or of the system is named',
  }],
  environment: ['Does the report tell where, when or for which record?', {
    'tells where or when': 'a site, desk, PC, user, date or time, or the request, patient or record',
    'no where or when': 'none of these',
  }],
};
export const MISSING = { steps: 'no steps', expected: 'not what is wrong', screen: 'no screen', environment: 'no where or when' };
/** The answers a labelled report should get: `missing` lists the fields it leaves out. */
export const completeLabels = (missing = []) => Object.fromEntries(Object.entries(COMPLETE).map(([q, [, criteria]]) => [q, missing.includes(q) ? MISSING[q] : Object.keys(criteria)[0]]));

const choice = (instructions, criteria) => ({ type: 'choice', instructions, criteria });
/**
 * The intake questions for a project with these component names (no component question without them), its known
 * issues (J4; no known question without them) and, with `complete`, the four questions of J7.
 */
export function questionsFor(componentNames = [], entries = [], { complete = false } = {}) {
  return {
    type: choice('What kind of support ticket is this?', TYPE),
    side: choice('Which part of the application has to change?', SIDE),
    urgency: choice('How urgent is this ticket?', URGENCY),
    ...(componentNames.length ? { component: choice('Which part of the application is this ticket about?', Object.fromEntries(componentNames.map((c) => [c, null]))) } : {}),
    code: choice('Does this ticket need a change in the code?', CODE),
    ...(entries.length ? { known: knownQuestion(entries) } : {}),
    ...(complete ? Object.fromEntries(Object.entries(COMPLETE).map(([q, [instructions, criteria]]) => [q, choice(instructions, criteria)])) : {}),
  };
}
/** The question ids a checkpoint was trained on (its questions.json), or null when it does not say. */
export function trainedQuestions(checkpointDir) {
  try {
    return new Set(Object.keys(JSON.parse(readFileSync(join(checkpointDir, 'questions.json'), 'utf8'))));
  } catch {
    return null;
  }
}
/** "LAB-8 Women's results flagged with the male reference range", cut to fit the question's token budget. */
export const entryOption = (e) => `${e.key} ${String(e.title).replace(/\s+/g, ' ').trim().slice(0, 60)}`;
/** J4: which known issue (of one project) a report describes, or none of them. */
export const knownQuestion = (entries) => choice('Which known issue does this report describe?', Object.fromEntries([...entries.map((e) => [entryOption(e), null]), [NONE, null]]));
export const intentQuestion = () => ({ intent: choice('What does this question ask for?', INTENT) });
export const privacyQuestion = () => ({ privacy: choice('Does this text still name a person or hold a personal identifier?', PRIVACY) });
/** The ticket key of a known-question answer ("LAB-8 Women's …" → "LAB-8"), or null for none of these. */
export const keyOfOption = (option) => (option && option !== NONE ? String(option).split(' ')[0] : null);

/** [FE]/[BE] tags and an "FE - " prefix are taken off: the model must read the side from the words. */
export const stripTags = (s) => String(s ?? '').replace(/\[(FE|BE)\]\s*/gi, '').replace(/^\s*(FE|BE)\s+-\s*/i, '').replace(/^\s*-\s*/, '').trim();
/** The text the model reads: the title without tags and the start of the (masked) description. */
export const stateOf = ({ summary, description }) => `${stripTags(summary)}\n\n${String(description ?? '').slice(0, 1500)}`.trim();

/** laya answers → { question: { choice, p, top: [[option, p], …3] } }. */
export function summarize(answers = {}) {
  const out = {};
  for (const [q, a] of Object.entries(answers)) {
    const probs = a?.probabilities ?? {};
    const top = Object.entries(probs).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => [k, Math.round(v * 1000) / 1000]);
    out[q] = { choice: a?.choice ?? top[0]?.[0] ?? null, p: Math.round((probs[a?.choice] ?? top[0]?.[1] ?? 0) * 1000) / 1000, top };
    if (q === 'type') out[q].notCode = notCodeShare(probs);
    if (q === 'side') out[q].notCode = Math.round((probs['not code'] ?? 0) * 1000) / 1000;
    if (q === 'code') out[q].notCode = Math.round((probs['no code change'] ?? 0) * 1000) / 1000;
    if (q === 'known') out[q].key = keyOfOption(out[q].choice);
  }
  return out;
}

// ---------------------------------------------------------------- the known issues (J4) and the privacy text (J6)

const entryCache = new Map(); // repoDir → { head, entries }
/**
 * The known-issue entries on origin/main of an application repository: { key, title, file, anchor, symptom, test }.
 * Read with git (no checkout), cached per origin/main commit. Entries that only refer to another file are left out.
 */
export function knownEntries(repoDir) {
  const git = (a) => execFileSync('git', ['-C', repoDir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 });
  try {
    const head = git(['rev-parse', 'origin/main']).trim();
    const hit = entryCache.get(repoDir);
    if (hit?.head === head) return hit.entries;
    const files = git(['ls-tree', '--name-only', 'origin/main', 'docs/knowledge/']).split('\n').filter((f) => f.endsWith('.md') && !f.endsWith('README.md'));
    const entries = files.flatMap((f) => parseKnowledgeFile(git(['show', `origin/main:${f}`]), f).entries.filter((e) => !e.reference)
      .map((e) => ({ key: e.key, title: e.title, file: e.file, anchor: e.anchor, symptom: e.fields?.Symptom ?? '', test: Boolean(e.fields?.Test && !/^none/i.test(e.fields.Test)) })));
    entryCache.set(repoDir, { head, entries });
    return entries;
  } catch {
    return [];
  }
}

const strangerMask = createRedactor({ allow: [] });
/**
 * The text for the privacy question: masked again with no one allowed, so the team's names become placeholders too
 * and a name that is left belongs to someone the masking did not know (a patient with an uncommon first name, a
 * surname alone, a name in capitals: VAX-13's "Ferrara Iolanda").
 */
export const strangersOnly = (text) => strangerMask.text(String(text ?? ''));
/** The probability that the ticket needs no change in the code: the share of the types outside CODE_TYPES. */
export const notCodeShare = (probs = {}) => Math.round(Object.entries(probs).reduce((s, [k, v]) => s + (CODE_TYPES.has(k) ? 0 : v), 0) * 1000) / 1000;

/**
 * Whether System 1 would send the ticket down the light path (J2): every not-code signal it has says "no change in
 * the code", each at least `threshold`. The signals are the type (the share of its not-code options), the side (its
 * "not code" option) and, with a model that has it, the code question ("no code change"). At least two must be there.
 * Measured 2026-11-15 with type and side at 0.5: 15 of 23 held-out tickets that are not about code, none of the 24
 * about code; 6 of 9 live ones (docs/SYSTEM1_PLAN.md, section 12).
 * A report System 1 would ask the reporter about (J7, askReporter at `askThreshold`) never takes it: a text that does
 * not tell what is wrong cannot tell that no code is wrong either. ft-4 read "Something is wrong with the doses,
 * please check." as unclear and not about code, and would have skipped the code (2026-11-16).
 */
export function lightPath(answers, threshold = 0.5, { askThreshold = 0.6 } = {}) {
  const signals = [answers?.type?.notCode, answers?.side?.notCode, answers?.code?.notCode].filter((v) => v != null);
  return signals.length >= 2 && signals.every((v) => v >= threshold) && !askReporter(answers, askThreshold);
}

/** J6: whether the privacy answer says the text still names someone, at the threshold. */
export const stillNamesSomeone = (answers, threshold = 0.7) => answers?.privacy?.choice === 'names a person' && answers.privacy.p >= threshold;

/** J4: the known issue System 1 names, at the threshold: { key, p } or null. */
export const knownIssue = (answers, threshold = 0.5) => (answers?.known?.key && answers.known.p >= threshold ? { key: answers.known.key, p: answers.known.p } : null);

/** J7: the fields a report leaves out by System 1's answers, each at the threshold. */
export const missingInfo = (answers, threshold = 0.6) => Object.keys(COMPLETE).filter((q) => answers?.[q]?.choice === MISSING[q] && answers[q].p >= threshold);
/**
 * J7: whether to ask the reporter: a report about code, or an unclear one, that does not tell what is wrong or where.
 * Most good bug reports of the demo name no environment and many need no steps ("the Ricevute page shows 22.5"), so
 * those two alone never ask; when it asks, it asks for everything that is missing. { missing } or null.
 * About code when either the type or the code question says so: a report that does not tell what is wrong often
 * splits them (BIL-23, "Mi dà errore quando stampo la ricevuta": bug in code 56 %, no code change 64 %, 2026-11-16).
 * Unclear when the type says so, or when no type reaches UNSURE_TYPE: "Verificare per favore." got system support at
 * 24 % (W-95). On ft-5's saved answers this asked one report more and no one without need.
 */
export const UNSURE_TYPE = 0.4;
export function askReporter(answers, threshold = 0.6) {
  const missing = missingInfo(answers, threshold);
  if (!missing.includes('expected') && !missing.includes('screen')) return null;
  const aboutCode = answers?.code?.choice === 'needs code' || CODE_TYPES.has(answers?.type?.choice);
  const unclear = answers?.type?.choice === 'unclear' || (typeof answers?.type?.p === 'number' && answers.type.p < UNSURE_TYPE);
  return aboutCode || unclear ? { missing } : null;
}
const IT_WORDS = new Set(['il', 'la', 'che', 'non', 'per', 'una', 'del', 'della', 'è', 'con', 'si', 'mi', 'dà', 'ho', 'nel', 'alla', 'va', 'funziona', 'errore', 'quando', 'sono', 'più']);
const EN_WORDS = new Set(['the', 'is', 'not', 'and', 'of', 'to', 'it', 'with', 'when', 'does', 'doesn', 'we', 'my', 'on', 'for', 'this', 'error', 'works', 'working', 'please']);
/** Italian or English (the default), by the common words of the text: the question goes back in the report's language. */
export function languageOf(text) {
  const words = String(text ?? '').toLowerCase().match(/\p{L}+/gu) ?? [];
  return words.filter((w) => IT_WORDS.has(w)).length > words.filter((w) => EN_WORDS.has(w)).length ? 'it' : 'en';
}
const ASK = {
  it: {
    hello: 'Buongiorno, per analizzare la segnalazione ci servono ancora alcune informazioni:',
    screen: 'In quale schermata o funzione succede?',
    expected: 'Che cosa succede esattamente (il messaggio, il valore) e che cosa si aspettava?',
    steps: 'Che cosa stava facendo quando è successo (pulsanti, dati inseriti)?',
    environment: 'Dove e quando (sede o postazione, data e ora), e per quale richiesta o prenotazione? Ci basta il numero, non il nome del paziente.',
    thanks: 'Grazie.',
  },
  en: {
    hello: 'Hello, to look into this report we need a little more information:',
    screen: 'On which screen or function does it happen?',
    expected: 'What exactly happens (the message, the value), and what did you expect?',
    steps: 'What were you doing when it happened (buttons, data entered)?',
    environment: "Where and when (site or workstation, date and time), and for which request or booking? The number is enough, not the patient's name.",
    thanks: 'Thank you.',
  },
};
/** J7: the question to the reporter, from a template (no model writes it), in the report's language. */
export function askReporterText({ missing = [], text = '' }) {
  const t = ASK[languageOf(text)];
  return [t.hello, ...['screen', 'expected', 'steps', 'environment'].filter((f) => missing.includes(f)).map((f) => `- ${t[f]}`), t.thanks].join('\n');
}

const URGENCY_RANK = { urgent: 0, normal: 1, low: 2 };
/**
 * J3: the index of the queue item to take next. Tickets to analyze go by System 1's urgency (an answer known yet),
 * then by their place in the queue; the other jobs (review, guard, documentation, known-issue tests) keep their
 * place, and a ticket is never moved ahead of one of them.
 * @param {object[]} queue
 * @param {(key: string) => object | undefined} answersOf  System 1's answers of a ticket, when they are in
 */
export function nextIndex(queue, answersOf) {
  if (!queue.length || queue[0].kind !== 'analyze') return 0;
  let best = 0;
  const rank = (i) => URGENCY_RANK[answersOf(queue[i].key)?.urgency?.choice] ?? 1;
  for (let i = 1; i < queue.length && queue[i].kind === 'analyze'; i++) if (rank(i) < rank(best)) best = i;
  return best;
}

/** J4: the verdict of one entry in `node agent/knowledge-tests.mjs --only KEY` output: pass, fail, not-run or none. */
export function knownTestVerdict(output, key) {
  const line = String(output).split('\n').find((l) => new RegExp(`^\\s+${key}\\s`).test(l));
  if (!line) return 'none';
  return /✗/.test(line) ? 'fail' : /\?/.test(line) ? 'not-run' : /✓/.test(line) ? 'pass' : 'none';
}

/** J2: the internal Jira comment of the light path. */
export function triageComment(answers, header = '(robot) *System 1 triage*', { watch = false } = {}) {
  const a = answers ?? {};
  const pc = (p) => `${Math.round(100 * (p ?? 0))} %`;
  return [
    `${header}: recognised as *${a.type?.choice}* (${pc(a.type?.p)}), so no code analysis was run.`,
    `Answers of the local model: needs code? ${a.code ? `${a.code.choice} (${pc(a.code.p)})` : '–'} · side: ${a.side?.choice} (${pc(a.side?.p)}) · urgency: ${a.urgency?.choice}${a.component ? ` · part of the application: ${a.component.choice}` : ''}.`,
    watch
      ? 'If this is a problem in the application, reply here with what goes wrong: a reply starts the full analysis. (A person can also use *Run again* on the agent dashboard.)'
      : 'If this ticket does need a change in the code, use *Run again* on the agent dashboard (or remove the label ai-triaged): it then gets the full analysis.',
  ].join('\n');
}

// ---------------------------------------------------------------- J5: Ask answered from the Insights data

const keyNumber = (k) => Number(String(k).split('-')[1]) || 0;
/**
 * An Ask answer that plain code gives from the project's Insights data, for the intents it can answer: who knows or
 * last worked on a component (its team, by share of the human commits), and the newest tickets (of a component, or of
 * the project). Null for any other intent, or without the data. Answers have the shape of askQuestion()'s.
 */
export function fastAnswer({ question, intent, component = null, insights, ticketUrl = () => null }) {
  if (!insights) return null;
  const ticketsOf = (name) => (insights.tickets ?? []).filter((t) => !name || (t.components ?? []).includes(name));
  const source = (t) => ({ type: 'ticket', ref: t.key, url: ticketUrl(t.key), why: `${t.type}, ${t.status}: ${t.summary}` });
  if (intent === 'who') {
    const c = (insights.components ?? []).find((x) => x.name === component);
    if (!c?.team?.length) return null;
    const lastOf = (name) => (insights.people ?? []).find((p) => p.name === name)?.last ?? null;
    const people = c.team.slice(0, 3).map((p) => `${p.name} (${p.share} % of its commits${lastOf(p.name) ? `, last commit ${String(lastOf(p.name)).slice(0, 10)}` : ''})`);
    const recent = ticketsOf(c.name).sort((a, b) => keyNumber(b.key) - keyNumber(a.key)).slice(0, 3);
    return {
      question, found: true, fast: true, intent, component,
      answer: `The people who know ${c.name} best, by their share of its commits: ${people.join(', ')}.${c.busFactor === 1 ? ' Only one person holds a quarter or more of it (bus factor 1).' : ''}${recent.length ? ` Its newest tickets: ${recent.map((t) => t.key).join(', ')}.` : ''}`,
      sources: recent.map(source),
    };
  }
  if (intent === 'latest') {
    const bugsOnly = /\b(bug|bugs|bag|errore|errori|greška|greške|defect)\b/i.test(question);
    const list = ticketsOf(component).filter((t) => !bugsOnly || t.type === 'Bug').sort((a, b) => keyNumber(b.key) - keyNumber(a.key)).slice(0, 5);
    if (!list.length) return null;
    return {
      question, found: true, fast: true, intent, component,
      answer: `The newest ${bugsOnly ? 'bugs' : 'tickets'}${component ? ` of ${component}` : ''}, newest first: ${list.map((t) => `${t.key} ${t.summary} (${t.type}, ${t.status})`).join('; ')}.`,
      sources: list.map(source),
    };
  }
  return null;
}

// ---------------------------------------------------------------- compared with the analysis and Jira

const codeFiles = (files) => (files ?? []).map((f) => String(f).replace(/\\/g, '/').replace(/:\d+.*$/, '')).filter((f) => !/^[A-Z][A-Z0-9_]+:/.test(f) && !/(^|\/)e2e\//.test(f));
/** frontend / backend / both from the files an analysis names, or null when it names none. */
export function sideOfFiles(files) {
  const fs = codeFiles(files);
  const fe = fs.some((f) => /(^|\/)frontend\//.test(f));
  const be = fs.some((f) => /(^|\/)backend\//.test(f));
  return fe && be ? 'both' : fe ? 'frontend' : be ? 'backend' : null;
}
/** The component most of the analysis' files belong to (insights.components rules), or null. */
export function componentOfFiles(files, rules) {
  const count = new Map();
  for (const f of codeFiles(files)) {
    const c = componentOf(f, rules);
    if (c) count.set(c, (count.get(c) ?? 0) + 1);
  }
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
export const urgencyOfPriority = (p) => ({ Highest: 'urgent', High: 'urgent', Medium: 'normal', Low: 'low', Lowest: 'low' })[p] ?? null;

/**
 * Where System 1 and what is known after the analysis agree. Each entry: { s1, other, agree } with agree null when
 * one of them has no answer. Side: when System 1 says "not code" there is no side to compare (the analysis names
 * files even for a how-to question). Whether a ticket needed code at all is not compared here: the analysis has no
 * such answer, and the outcome (a commit on main) says it later.
 */
export function compare(s1, { result = null, priority = null, rules = [] } = {}) {
  const entry = (a, b) => ({ s1: a ?? null, other: b ?? null, agree: a && b ? a === b : null });
  const files = result?.files ?? [];
  const side = entry(s1?.side?.choice, sideOfFiles(files));
  if (side.s1 === 'not code') side.agree = null;
  return {
    side,
    component: entry(s1?.component?.choice, componentOfFiles(files, rules)),
    urgency: entry(s1?.urgency?.choice, urgencyOfPriority(priority)),
  };
}

const pct = (p) => `${Math.round(100 * (p ?? 0))} %`;
/** "bug in code 82 % · frontend 74 % · Prenotazioni 61 % · normal 55 % · 1.3 s" (+ " · would take the light path") */
export function describeAnswers({ answers = {}, ms = null, lightPath: light = false }) {
  const parts = ['type', 'side', 'component', 'urgency'].filter((q) => answers[q]).map((q) => `${answers[q].choice} ${pct(answers[q].p)}`);
  if (answers.known?.key) parts.push(`known issue ${answers.known.key} ${pct(answers.known.p)}`);
  if (answers.privacy?.choice === 'names a person') parts.push(`still names a person ${pct(answers.privacy.p)}`);
  return `${parts.join(' · ')}${ms != null ? ` · ${(ms / 1000).toFixed(1)} s` : ''}${light ? ' · would take the light path' : ''}`;
}
/** "agrees with the analysis on side, component; urgency normal, Jira says urgent" */
export function describeCompare(c) {
  const withAnalysis = ['side', 'component'];
  const agreed = withAnalysis.filter((k) => c[k]?.agree === true);
  const differ = withAnalysis.filter((k) => c[k]?.agree === false).map((k) => `${k} ${c[k].s1}, the analysis says ${c[k].other}`);
  const urgency = c.urgency?.agree === false ? `urgency ${c.urgency.s1}, Jira says ${c.urgency.other}` : c.urgency?.agree ? 'urgency as in Jira' : null;
  const parts = [agreed.length ? `agrees with the analysis on ${agreed.join(', ')}` : null, ...differ, urgency].filter(Boolean);
  return parts.length ? parts.join('; ') : 'nothing to compare with the analysis';
}

// ---------------------------------------------------------------- J10: the fix warm-up by System 1's side

/**
 * J10: a fix warm-up System 1's side says is not needed. An untagged title gets a worktree and a warm Angular dev
 * server while the analysis runs, whatever the ticket is about; 44 of the 58 warm-ups in the event logs up to
 * 2026-11-17 served no frontend fix (median 31 s of a dev server compiling, up to 199 s, beside the analysis).
 * "backend" at the threshold: the worktree only, as for a [BE] title; "not code": nothing. A fix that still follows
 * prepares what it needs itself (its own worktree, its own dev server), only slower. An answer can skip a warm-up,
 * never add one.
 * @returns {{ side: string, p: number, prepare: boolean, warm: boolean } | null}  null: no reason to prepare less
 */
export function warmSkip(answers, threshold = 0.7) {
  const side = answers?.side;
  if (!side?.choice || !(side.p >= threshold)) return null;
  if (side.choice === 'backend') return { side: side.choice, p: side.p, prepare: true, warm: false };
  if (side.choice === 'not code') return { side: side.choice, p: side.p, prepare: false, warm: false };
  return null;
}

/**
 * J10: whether skipping the warm-up was right, once the fix stage is decided. `needed` is what the fix used: nothing
 * when no automatic fix ran; a worktree, and a dev server for a frontend fix.
 * @param {{ prepare: boolean, warm: boolean }} would  what System 1's side said to prepare
 * @param {{ prepare: boolean, warm: boolean }} needed
 */
export const warmVerdict = (would, needed) => ((needed.prepare && !would.prepare) || (needed.warm && !would.warm) ? 'wrong' : 'right');

/**
 * The card's words for a J10 decision (no verdict yet) or its check (with `verdict` and `needed`).
 * @param {{ side, p, mode, would, verdict?, needed? }} w  `needed.side` is the fix's side when a fix ran
 */
export function describeWarm({ side, p, mode, would, verdict = null, needed = null }) {
  const live = mode === 'auto';
  if (!verdict) {
    const said = `System 1: ${side} (${pct(p)})`;
    if (would.prepare) return live ? `${said}: worktree only, no dev server warmed` : `${said}: would warm no dev server (shadow: warmed as before)`;
    return live ? `${said}: no fix workspace prepared` : `${said}: would prepare no fix workspace (shadow: prepared as before)`;
  }
  if (verdict === 'right') return needed?.prepare ? `warm-up call right: the fix was on the ${needed.side}, no dev server needed` : 'warm-up call right: no automatic fix followed';
  const fix = needed?.side ? `a ${needed.side} fix` : 'a fix';
  const own = !would.prepare ? 'its own workspace' : 'its own dev server';
  return `warm-up call wrong: ${fix} followed, ${live ? `which prepared ${own}` : `which would have prepared ${own}`}`;
}

// ---------------------------------------------------------------- what it did, and how good it is (J8b)

/**
 * The System 1 report of the Impact tab, from the event log, the Ask log and the current checkpoint's evaluation.
 * Shadow numbers say what it *would* have done: the Claude cost and time spent on tickets it would have sent down the
 * light path, and the owner notices sent for them. Calibration: the held-out answers by stated confidence, against
 * how often they were right.
 */
export function system1Report({ events = [], asks = [], evaluation = null, checkpoint = null, policy = {} }) {
  const last = new Map(); // key → the latest system1 event
  const after = new Map(); // key → { costUsd, ms, notified } of the analysis after it
  const tests = { pass: 0, fail: 0, 'not-run': 0 };
  let held = 0;
  let triaged = 0;
  for (const e of events) {
    if (!e.key) continue;
    if (e.type === 'system1') last.set(e.key, e);
    if (e.type === 'analyzed' && last.has(e.key)) after.set(e.key, { ...(after.get(e.key) ?? {}), costUsd: e.meta?.costUsd ?? 0, ms: e.meta?.durationMs ?? 0, confidence: e.result?.confidence ?? null });
    if (e.type === 'notified' && last.has(e.key)) after.set(e.key, { ...(after.get(e.key) ?? {}), notified: true });
    if (e.type === 'known-test' && e.status in tests) tests[e.status]++;
    if (e.type === 'system1-held') held++;
    if (e.type === 'triaged') triaged++;
  }
  const answered = [...last.values()];
  const light = answered.filter((e) => e.lightPath);
  const spent = light.map((e) => after.get(e.key)).filter(Boolean);
  const fast = asks.filter((a) => a.fast);
  const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
  const report = {
    checkpoint,
    modes: policy.system1 ?? {},
    tickets: answered.length,
    modelSeconds: answered.length ? round(answered.reduce((s, e) => s + (e.ms ?? 0), 0) / answered.length / 1000, 1) : null,
    lightPath: { tickets: light.map((e) => e.key), claudeCostUsd: round(spent.reduce((s, x) => s + (x.costUsd ?? 0), 0)), claudeMinutes: round(spent.reduce((s, x) => s + (x.ms ?? 0), 0) / 60000, 1), ownerNotices: spent.filter((x) => x.notified).length },
    known: { tickets: answered.filter((e) => e.known).map((e) => ({ key: e.key, entry: e.known.key, p: e.known.p })), tests },
    privacy: { wouldHold: answered.filter((e) => e.privacy?.hold).map((e) => e.key) },
    // J7: the analyses of the tickets it would ask the reporter about, against the others (the plan's measure).
    askReporter: (() => {
      const low = (es) => {
        const analysed = es.map((e) => after.get(e.key)?.confidence).filter(Boolean);
        return { analysed: analysed.length, low: analysed.filter((c) => c === 'low').length };
      };
      const asked = answered.filter((e) => e.askReporter);
      return { tickets: asked.map((e) => e.key), asked: low(asked), others: low(answered.filter((e) => !e.askReporter && e.missing)) };
    })(),
    held, triaged,
    // J10: the fix warm-ups skipped (auto) or that would have been skipped (shadow), each run with its check after the
    // fix stage: right when the fix did not need what was skipped. A run of the same ticket again is a run of its own.
    warm: (() => {
      const runs = [];
      const open = new Map();
      for (const e of events) {
        if (e.type !== 'system1-warm' || !e.key) continue;
        if (!e.verdict) {
          const run = { key: e.key, mode: e.mode, verdict: null };
          runs.push(run);
          open.set(e.key, run);
        } else if (open.has(e.key)) {
          open.get(e.key).verdict = e.verdict;
          open.delete(e.key);
        }
      }
      return {
        tickets: [...new Set(runs.map((r) => r.key))],
        skipped: runs.filter((r) => r.mode === 'auto').length,
        wouldSkip: runs.filter((r) => r.mode !== 'auto').length,
        right: runs.filter((r) => r.verdict === 'right').length,
        wrong: runs.filter((r) => r.verdict === 'wrong').length,
        wrongTickets: [...new Set(runs.filter((r) => r.verdict === 'wrong').map((r) => r.key))],
      };
    })(),
    ask: { fast: fast.length, all: asks.length, seconds: fast.length ? round(fast.reduce((s, a) => s + (a.durationMs ?? 0), 0) / fast.length / 1000, 1) : null },
    evaluation: null,
  };
  if (evaluation) {
    const thr = Number(policy.system1?.lightPathThreshold ?? 0.5);
    const rule = evaluation.gate?.[`type+side+code@${thr}`] ? `type+side+code@${thr}` : `type+side@${thr}`;
    // Calibration over every held-out answer: said 50–60 %, 60–70 %, … against right.
    const answers = (evaluation.results ?? []).flatMap((r) => Object.entries(r.answers ?? {}).filter(([q]) => q in (r.expected ?? {})).map(([q, a]) => ({ p: a.p, right: a.choice === r.expected[q] })));
    const bins = [];
    for (let lo = 0; lo < 1; lo += 0.1) {
      const inBin = answers.filter((a) => a.p >= lo && (a.p < lo + 0.1 || (lo >= 0.9 && a.p <= 1)));
      if (inBin.length) bins.push({ from: round(lo, 1), to: round(lo + 0.1, 1), n: inBin.length, said: round(inBin.reduce((s, a) => s + a.p, 0) / inBin.length), right: round(inBin.filter((a) => a.right).length / inBin.length) });
    }
    report.evaluation = {
      label: evaluation.label,
      scores: Object.fromEntries(Object.entries(evaluation.scores ?? {}).filter(([, v]) => typeof v?.accuracy === 'number').map(([q, v]) => [q, { n: v.n, accuracy: v.accuracy, majority: v.majority }])),
      known: Object.fromEntries(Object.entries(evaluation.scores ?? {}).filter(([q]) => q.startsWith('known/')).map(([q, v]) => [q.slice(6), `${v.right}/${v.n}`])),
      privacyMissed: evaluation.scores?.['privacy/errors']?.names_missed?.length ?? null,
      lightPath: evaluation.gate?.[rule] ? { rule, ...evaluation.gate[rule] } : null,
      calibration: bins,
    };
  }
  return report;
}

// ---------------------------------------------------------------- the checkpoint (J8b)

/**
 * The checkpoint in use: state/system1/models/current.json, written by agent/system1-train.mjs when a new
 * checkpoint was accepted, else agent.config.json system1.checkpoint.
 */
export function currentCheckpoint({ agentDir, stateDir, cfg }) {
  const models = join(stateDir, 'system1', 'models');
  try {
    const c = JSON.parse(readFileSync(join(models, 'current.json'), 'utf8'));
    const dir = join(models, c.name);
    if (c.name && existsSync(dir)) return { name: c.name, dir, from: 'state/system1/models/current.json' };
  } catch {
    /* none accepted yet */
  }
  const dir = resolve(agentDir, cfg.system1?.checkpoint ?? 'state/system1/models/ft-1');
  return { name: basename(dir), dir, from: 'agent.config.json' };
}

/**
 * J8b: whether a new checkpoint may replace the current one, from their eval.py results on the same held-out rows.
 * Refused when a ticket about code would take the light path (the policy's rule and threshold), when a question is
 * less accurate by more than one held-out item or 1 point (whichever is larger), or when the privacy question misses
 * more names. One item: with 47 tickets a single one is 2.1 points, so a 1-point tolerance alone would refuse a
 * checkpoint over one ticket (ft-2's side answer: 33 of 47 against 34). `incumbent` null: nothing to beat.
 */
export function judgeCandidate(candidate, incumbent, { threshold = 0.5 } = {}) {
  const lines = [];
  let accept = true;
  const rule = candidate.gate?.[`type+side+code@${threshold}`] ? `type+side+code@${threshold}` : `type+side@${threshold}`;
  const gate = candidate.gate?.[rule];
  if (!gate) {
    accept = false;
    lines.push(`light path: no evaluation at the threshold ${threshold}`);
  } else if (gate.code_wrongly_skipped.length) {
    accept = false;
    lines.push(`light path (${rule}): tickets about code would be skipped: ${gate.code_wrongly_skipped.join(', ')}`);
  } else lines.push(`light path (${rule}): ${gate.not_code_caught} not-code tickets caught, no ticket about code skipped`);
  for (const [q, c] of Object.entries(candidate.scores ?? {})) {
    if (typeof c?.accuracy !== 'number') continue;
    const before = incumbent?.scores?.[q]?.accuracy;
    // eval.py rounds to 3 decimals: the 0.0005 keeps one item inside the tolerance.
    const tolerance = Math.max(0.01, c.n ? 1 / c.n : 0) + 0.0005;
    const lower = typeof before === 'number' && c.accuracy < before;
    const worse = lower && c.accuracy < before - tolerance;
    if (worse) accept = false;
    const note = worse ? ' WORSE' : lower ? ' (lower, within one item)' : '';
    lines.push(`${q}: ${Math.round(100 * c.accuracy)} %${typeof before === 'number' ? ` (current ${Math.round(100 * before)} %)` : ''}${note}`);
  }
  const missed = candidate.scores?.['privacy/errors']?.names_missed?.length;
  const missedBefore = incumbent?.scores?.['privacy/errors']?.names_missed?.length;
  if (missed != null && missedBefore != null && missed > missedBefore) {
    accept = false;
    lines.push(`privacy: misses ${missed} names (current ${missedBefore})`);
  }
  return { accept, lines };
}

// ---------------------------------------------------------------- the local server

/**
 * One retry after 2 s for a network failure (LAB-28 lost its answers to one "fetch failed"); the error names the step.
 * A timeout is not retried: the server answers one request at a time and still works on the one given up, so a
 * second request would only wait behind it (LAB-30, 2026-11-15).
 */
async function twice(fn, step) {
  try {
    return await fn();
  } catch (e) {
    if (e.final || e.name === 'TimeoutError') throw new Error(`${step}: ${e.name === 'TimeoutError' ? 'no answer in time' : e.message}`);
    await new Promise((r) => setTimeout(r, 2000));
    try {
      return await fn();
    } catch (e2) {
      throw new Error(`${step}: ${e2.message}`);
    }
  }
}

/**
 * The System 1 client for the watcher. `mode` from policy.json → system1.intake ('off' | 'shadow'); the server is
 * started once (or a healthy one from a previous watcher is reused) and every intake waits for it, up to a limit.
 * Never throws: when the model is missing, slow or down, intake() resolves to null and the ticket goes on as today.
 */
export function createSystem1({ cfg, policy, agentDir, stateDir, log = () => {} }) {
  const s = cfg.system1 ?? {};
  const mode = policy.system1?.intake ?? 'off';
  const port = Number(s.port ?? 7071);
  const base = `http://127.0.0.1:${port}`;
  const python = resolve(agentDir, s.python ?? '../tools/laya-env/Scripts/python.exe');
  let checkpoint = currentCheckpoint({ agentDir, stateDir, cfg }).dir;
  // Only the questions the checkpoint was trained on: ft-1 knew four, and the code and known questions asked of it
  // in J1 got untrained answers.
  let trained = trainedQuestions(checkpoint);
  const knows = (q) => !trained || trained.has(q);
  const dir = join(stateDir, 'system1');
  const pidFile = join(dir, 'server.pid');
  const timeoutMs = 1000 * Number(s.timeoutSeconds ?? 30);
  let ready = null; // Promise<boolean>
  let reason = null;
  let child = null;

  async function health() {
    try {
      const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) });
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  }

  async function startServer() {
    if (mode === 'off') return ((reason = 'policy.json system1.intake is off'), false);
    if (!existsSync(python)) return ((reason = `no Python at ${python}: node demo/get-tools.mjs --only uv,laya`), false);
    if (!existsSync(join(checkpoint, 'config.json')) && !existsSync(join(checkpoint, 'model.safetensors'))) return ((reason = `no trained checkpoint at ${checkpoint} (see agent/README.md, System 1)`), false);
    const running = await health();
    if (running?.checkpoint && resolve(running.checkpoint) === checkpoint) {
      log(`System 1: reusing the server on :${port} (PID ${running.pid}, ${basename(checkpoint)})`);
      return true;
    }
    // A server of a previous watcher with another checkpoint: stop it before taking the port. Only by the PID it
    // reports itself; a PID in a stale file may belong to another process by now.
    if (running?.pid) {
      try {
        process.kill(running.pid);
      } catch {
        /* already gone */
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    mkdirSync(dir, { recursive: true });
    const out = openSync(join(dir, 'server.log'), 'a');
    const env = { ...process.env, HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', HF_HUB_DISABLE_SYMLINKS_WARNING: '1', USE_TF: '0', PYTHONIOENCODING: 'utf-8' };
    if (s.hfHome) env.HF_HOME = resolve(agentDir, s.hfHome);
    const args = ['-I', join(agentDir, 'system1', 'server.py'), '--checkpoint', checkpoint, '--port', String(port), ...(s.threads ? ['--threads', String(s.threads)] : [])];
    const me = spawn(python, args, { stdio: ['ignore', out, out], windowsHide: true, env });
    child = me;
    writeFileSync(pidFile, JSON.stringify({ pid: me.pid, checkpoint, startedAt: new Date().toISOString() }));
    me.on('exit', (code) => {
      if (child === me) child = null; // not a newer server's, after a reload
      if (code && child === null) log(`System 1: the server stopped (exit ${code}); see ${join(dir, 'server.log')}`);
    });
    const until = Date.now() + 1000 * Number(s.startTimeoutSeconds ?? 120);
    const ours = (h) => h?.checkpoint && resolve(h.checkpoint) === checkpoint; // not the old one, still closing
    while (Date.now() < until && child) {
      if (ours(await health())) {
        log(`System 1: server ready on :${port} (${basename(checkpoint)})`);
        return true;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    reason = child ? 'the server did not answer in time' : `the server did not start; see ${join(dir, 'server.log')}`;
    return false;
  }

  return {
    mode,
    get model() {
      return basename(checkpoint);
    },
    knows,
    /**
     * J8b: serves the current checkpoint again (state/system1/models/current.json), after system1-train.mjs accepted
     * a new one: the old server is stopped and the new one loads (10–40 s); until then intake() waits or answers null.
     */
    async reload() {
      const next = currentCheckpoint({ agentDir, stateDir, cfg }).dir;
      if (next === checkpoint && ready && (await ready)) return true;
      const old = child;
      child = null;
      ready = null;
      reason = null;
      checkpoint = next;
      trained = trainedQuestions(checkpoint);
      if (old) {
        old.kill();
        await new Promise((r) => setTimeout(r, 1500));
      }
      log(`System 1: loading ${basename(checkpoint)}`);
      return this.start();
    },
    get reason() {
      return reason;
    },
    /**
     * Starts the server in the background; intake() waits for it. A server that is still running after the start
     * timeout is asked again on the next call instead of being given up for good: on 2026-11-15 one loaded in 42 s
     * while a training run had the CPU, and the watcher's health checks timed out while its event loop was busy with
     * git, so System 1 stayed off with a server that was answering.
     */
    async start() {
      ready ??= startServer().catch((e) => ((reason = e.message), false));
      if ((await ready) || !child) return ready;
      const h = await health();
      if (!h?.checkpoint || resolve(h.checkpoint) !== checkpoint) return false;
      reason = null;
      ready = Promise.resolve(true);
      log(`System 1: server ready on :${port} (${basename(checkpoint)}), after the start timeout`);
      return true;
    },
    /** One call to the model: its summarised answers and the time it took. Retried once on a network failure. */
    async decide(state, questions) {
      if (mode === 'off' || !(await this.start())) return null;
      const started = Date.now();
      const body = await twice(async () => {
        const res = await fetch(`${base}/decide`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state, questions }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw Object.assign(new Error(`answered ${res.status}: ${(await res.text()).slice(0, 200)}`), { final: true });
        return res.json();
      }, 'asking the model');
      return { answers: summarize(body.answers), ms: body.ms ?? Date.now() - started };
    },
    /**
     * System 1's answers for one ticket, or null (off, not ready). Two calls: the intake questions (type, side,
     * urgency, component, needs code, known issue, and what the report leaves out) on the masked text, and, when
     * `privacy`, the privacy question on the text with every name masked (strangersOnly). Only the questions the
     * checkpoint was trained on are asked. `text` is the masked text, for the language of a question to the reporter.
     * Throws, naming the step, when a call fails twice.
     */
    async intake({ issue, jira, components = [], entries = [], threshold = 0.5, askThreshold = 0.6, privacy = true }) {
      if (mode === 'off') return null;
      if (!(await this.start())) return null;
      // masked (R-02), as every model reads a ticket
      const full = await twice(() => jira.getIssue(issue.key), `reading ${issue.key} from Jira`);
      const text = stateOf(full);
      const questions = Object.fromEntries(Object.entries(questionsFor(components, entries, { complete: knows('steps') })).filter(([q]) => knows(q)));
      const main = await this.decide(text, questions);
      const priv = privacy && knows('privacy') ? await this.decide(strangersOnly(text), privacyQuestion()) : null;
      const answers = { ...main.answers, ...(priv?.answers ?? {}) };
      return { answers, ms: main.ms + (priv?.ms ?? 0), model: basename(checkpoint), lightPath: lightPath(answers, threshold, { askThreshold }), text };
    },
    /** Stops a server this watcher started (a reused one keeps running for the next watcher). */
    stop() {
      if (!child) return;
      child.kill();
      rmSync(pidFile, { force: true });
    },
  };
}
