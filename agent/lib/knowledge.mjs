// The knowledge base as data (K5 of docs/KNOWLEDGE_PLAN.md): docs/knowledge/*.md parsed into entries, and a lint
// that runs before a documentation branch is pushed (document.mjs) and on what is on main (knowledge-lint.mjs).
// Plain code, no AI: the agent writes the entries, the code checks them.

const KEY_RE = /\b[A-Z][A-Z0-9_]+-\d+\b/g;
export const TYPES = ['bug', 'change request', 'configuration'];
export const REQUIRED = ['Type', 'Symptom', 'Search terms', 'Root cause', 'Fix', 'Test'];

// The parser is shared with the analyze-ticket skill (it reads the knowledge base for the analysis too).
export { anchorOf, parseKnowledgeFile } from '../../.claude/skills/analyze-ticket/scripts/lib/knowledge-file.mjs';
import { parseTestLine } from './knowledge-tests.mjs';
import { parseKnowledgeFile } from '../../.claude/skills/analyze-ticket/scripts/lib/knowledge-file.mjs';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRedactor, IDENTIFIER_RULES, isToolEmail } from '../../.claude/skills/analyze-ticket/scripts/lib/redact.mjs';

// Statements about the state of a pull request or a branch: true when written, wrong a week later.
const TIME_BOUND = /\b(not (yet )?merged|may not be merged|is not merged|not been merged|still (open|in review)|as of \d{4}-\d{2}-\d{2}|draft (pull request|PR)\b)/i;

/** Patient (or other personal) data that must never be in the repository. */
// The same identifier rules as the redaction (one source of truth, redact.mjs): the lint reports what the redaction
// would mask. A tool address (noreply, example.com) is not a person's.
const LABEL = { FISCAL_CODE: 'fiscal code', IBAN: 'IBAN', HEALTH_CARD: 'health card number', EMAIL: 'e-mail address', PHONE: 'phone number', BIRTH_DATE: 'birth date' };
const PERSONAL = IDENTIFIER_RULES.map(([kind, re]) => {
  const all = new RegExp(re.source, `${re.flags}g`);
  // A matcher with the RegExp interface the checks below use: test() and match() through String.prototype.match.
  const first = (text) => [...String(text).matchAll(all)].map((m) => m[0]).find((v) => kind !== 'EMAIL' || !isToolEmail(v)) ?? null;
  return [LABEL[kind] ?? kind, { test: (t) => first(t) !== null, [Symbol.match]: (t) => (first(t) === null ? null : [first(t)]) }];
});

/** Commit hashes cited in a text: 7–40 hex characters with a digit and a letter, not a CSS colour (#…). */
export const hashesIn = (text) => [...new Set([...String(text).matchAll(/(?<![#\w])[0-9a-f]{7,40}(?![\w])/g)].map((m) => m[0]).filter((h) => /\d/.test(h) && /[a-f]/.test(h)))];

/**
 * Lints knowledge files. Errors block a documentation push; the same rules run on main.
 * @param {{ file: string, text: string }[]} files
 * @param {object} o
 * @param {(hash: string) => boolean} [o.commitExists]
 * @param {string[]} [o.projects]  the Jira project keys a ticket key may have (others are fixture or typo keys)
 * @param {string[]} [o.keys]      check the entry rules only for these tickets (a documentation run checks its own);
 *                                 the file rules (people, personal data) always apply
 * @param {string[]} [o.team]      the team (git authors, staff): with it, a person's name that is not the team's is
 *                                 personal data too (R-02's name rule, redact.mjs)
 * @returns {{ file: string, key: string | null, rule: string, message: string }[]}
 */
export function lintKnowledge(files, { commitExists = () => true, testFileExists = () => true, projects = null, keys = null, team = null } = {}) {
  const out = [];
  const add = (file, key, rule, message) => out.push({ file, key, rule, message });
  for (const { file, text } of files) {
    if (team) {
      // Names of people outside the team, found the same way as the redaction finds them.
      const r = createRedactor({ allow: team });
      r.text(text);
      if ((r.stats().PERSON ?? 0) > 0) {
        const names = [...new Set([...String(text).matchAll(/(?<![\p{L}\p{M}])(\p{Lu}[\p{Ll}\p{M}'’]{1,20})[ \t]+(\p{Lu}[\p{Ll}\p{M}'’]{1,20})(?![\p{L}\p{M}])/gu)].map((x) => x[0]).filter((n) => createRedactor({ allow: team }).text(n) !== n))];
        add(file, null, 'personal-data', `a person's name outside the team: ${names.slice(0, 3).join(', ')} (write "a patient" or "the operator"; add a team member to agent.config.json "staff")`);
      }
    }
    if (/(^|\/)README\.md$/.test(file)) {
      for (const [name, re] of PERSONAL) if (re.test(text)) add(file, null, 'personal-data', `${name}: ${text.match(re)[0]}`);
      continue;
    }
    const parsed = parseKnowledgeFile(text, file);
    if (parsed.people && /\b(agent|bot)\b/i.test(parsed.people)) add(file, null, 'people', '"People who know it" lists the agent or a bot: people only');
    for (const [name, re] of PERSONAL) {
      const m = text.match(re);
      if (m) add(file, null, 'personal-data', `${name}: ${m[0]}`);
    }
    for (const e of parsed.entries) {
      if (keys && !keys.includes(e.key)) continue;
      if (e.reference) {
        if (!/\]\([^)]+\)/.test(e.text)) add(file, e.key, 'reference', 'a short entry must link the full entry ("The full entry is in [file](file.md#anchor)")');
        continue;
      }
      for (const f of REQUIRED) if (!e.fields[f]) add(file, e.key, 'missing-field', `missing **${f}**`);
      const type = (e.fields.Type ?? '').toLowerCase();
      if (e.fields.Type && !TYPES.some((t) => type.startsWith(t))) add(file, e.key, 'type', `Type must be one of: ${TYPES.join(', ')} (is "${e.fields.Type}")`);
      if (e.fields['Root cause'] && !/\b(confirmed|assumed)\b/i.test(e.fields['Root cause'])) add(file, e.key, 'root-cause', 'Root cause is not labelled confirmed or assumed');
      if (e.fields['Search terms'] && e.fields['Search terms'].split(',').filter((t) => t.trim()).length < 3) add(file, e.key, 'search-terms', 'Search terms: at least 3, comma separated (error text, screen and route, the words a user would use)');
      // KB1: the regression tests of the fix, run on main (knowledge-tests.mjs); "none" when the fix added none.
      if (e.fields.Test) {
        const tests = parseTestLine(e.fields.Test);
        if (!tests.length && !/^none\b/i.test(e.fields.Test.trim())) add(file, e.key, 'test', 'Test: name the regression test files in backticks (`backend/src/test/java/…Test.java`, `e2e/tests/…spec.ts`) or write "none: the fix added or changed no test"');
        for (const t of tests) if (!testFileExists(t.file)) add(file, e.key, 'test', `Test: ${t.file} is not on main`);
      }
      const tb = e.text.match(TIME_BOUND);
      if (tb) add(file, e.key, 'time-bound', `states the state of a PR or branch ("${tb[0]}"): it goes stale; cite the commit instead`);
      for (const h of hashesIn(e.text)) if (!commitExists(h)) add(file, e.key, 'commit', `commit ${h} does not exist in the repository`);
      // A key with "_" in its project (CUP_DEMO-2511) is a fixture or an old system's key, not a ticket of these Jira
      // projects. Other KEY-n words are left alone: UTF-8, booking numbers such as RL-2026-00058.
      if (projects) for (const k of new Set(e.text.match(KEY_RE) ?? [])) if (k.split('-')[0].includes('_') && !projects.includes(k.split('-')[0])) add(file, e.key, 'ticket-key', `${k} is not a ticket of ${projects.join(', ')}`);
    }
  }
  return out;
}

/** The findings as a list for a person or for the agent. */
export const describeFindings = (findings) => findings.map((f) => `- ${f.file}${f.key ? ` · ${f.key}` : ''}: ${f.message}`).join('\n');

/**
 * The known issues of a piece of code (K13), for the fix and the review: the entries of `keys` (the ticket's prior
 * art, its related tickets) and the entries that cite one of `files`. Read from `dir`/docs/knowledge (a checkout of
 * main). Returns a short text block, or '' when there is nothing.
 */
export function knowledgeFor({ dir, files = [], keys = [], max = 4, docsPath = 'docs/knowledge' }) {
  let names = [];
  try {
    names = readdirSync(join(dir, docsPath)).filter((f) => f.endsWith('.md') && f !== 'README.md');
  } catch {
    return '';
  }
  const bases = new Set(files.map((f) => String(f).split('\\').join('/').replace(/:\d+.*$/, '').split('/').pop()).filter(Boolean));
  const wanted = new Set(keys.filter(Boolean).map((k) => String(k).toUpperCase()));
  const hits = [];
  for (const name of names) {
    let text = '';
    try {
      text = readFileSync(join(dir, docsPath, name), 'utf8');
    } catch {
      continue;
    }
    for (const e of parseKnowledgeFile(text, `${docsPath}/${name}`).entries.filter((x) => !x.reference)) {
      const cites = [...bases].filter((b) => e.text.includes(b));
      if (!wanted.has(e.key) && !cites.length) continue;
      hits.push({ e, rank: (wanted.has(e.key) ? 2 : 0) + cites.length });
    }
  }
  if (!hits.length) return '';
  const cut = (s, n = 300) => (String(s ?? '').length > n ? `${String(s).slice(0, n)}…` : String(s ?? ''));
  return [
    'Known issues of this code (the project knowledge base, docs/knowledge on main):',
    ...hits.sort((a, b) => b.rank - a.rank).slice(0, max).map(({ e }) => [
      `- ${e.key}: ${e.title} (${e.file}#${e.anchor})`,
      e.fields['Root cause'] ? `  Root cause: ${cut(e.fields['Root cause'])}` : null,
      e.fields.Fix ? `  Fix: ${cut(e.fields.Fix)}` : null,
      e.fields['Prevent recurrence'] ? `  Prevent recurrence: ${cut(e.fields['Prevent recurrence'])}` : null,
      // KB1: the test that guards this known issue must keep passing after the change.
      e.fields.Test && !/^none\b/i.test(e.fields.Test.trim()) ? `  Regression test (must keep passing): ${cut(e.fields.Test)}` : null,
    ].filter(Boolean).join('\n')),
  ].join('\n');
}
