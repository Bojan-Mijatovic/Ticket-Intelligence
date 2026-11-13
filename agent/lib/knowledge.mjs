// The knowledge base as data (K5 of docs/KNOWLEDGE_PLAN.md): docs/knowledge/*.md parsed into entries, and a lint
// that runs before a documentation branch is pushed (document.mjs) and on what is on main (knowledge-lint.mjs).
// Plain code, no AI: the agent writes the entries, the code checks them.

const KEY_RE = /\b[A-Z][A-Z0-9_]+-\d+\b/g;
export const TYPES = ['bug', 'change request', 'configuration'];
export const REQUIRED = ['Type', 'Symptom', 'Search terms', 'Root cause', 'Fix'];

/** GitHub's anchor of a heading: "DEM-32: Pazienti page …" → "dem-32-pazienti-page-…". */
export const anchorOf = (heading) => heading.trim().toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/ /g, '-');

/**
 * One knowledge file → its preamble (title, people) and its entries.
 * An entry is "### KEY: title" up to the next heading; its fields are "- **Name**: value" lines (continued by
 * indented lines). An entry without fields that links elsewhere is a reference to the full entry in another file.
 */
export function parseKnowledgeFile(text, file = '') {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const entries = [];
  let cur = null;
  let field = null;
  const preamble = [];
  for (const line of lines) {
    const head = line.match(/^### ([A-Z][A-Z0-9_]+-\d+):\s*(.*)$/);
    if (head) {
      cur = { key: head[1], title: head[2].trim(), file, anchor: anchorOf(`${head[1]}: ${head[2]}`), fields: {}, body: [] };
      entries.push(cur);
      field = null;
      continue;
    }
    if (/^#{1,3} /.test(line)) {
      cur = null;
      field = null;
      if (!entries.length) preamble.push(line);
      continue;
    }
    if (!cur) {
      if (!entries.length) preamble.push(line);
      continue;
    }
    cur.body.push(line);
    const f = line.match(/^- \*\*([^*]+)\*\*:?\s*(.*)$/);
    if (f) {
      field = f[1].replace(/:$/, '').trim();
      cur.fields[field] = f[2].trim();
    } else if (field && /^\s+\S/.test(line)) {
      cur.fields[field] += `\n${line.trim()}`;
    } else if (line.trim()) field = null;
  }
  for (const e of entries) {
    e.text = e.body.join('\n');
    e.reference = !Object.keys(e.fields).length;
    delete e.body;
  }
  const people = preamble.find((l) => /^\*\*People who know it\*\*/.test(l)) ?? null;
  return { file, people, entries };
}

// Statements about the state of a pull request or a branch: true when written, wrong a week later.
const TIME_BOUND = /\b(not (yet )?merged|may not be merged|is not merged|not been merged|still (open|in review)|as of \d{4}-\d{2}-\d{2}|draft (pull request|PR)\b)/i;

/** Patient (or other personal) data that must never be in the repository. */
const PERSONAL = [
  ['fiscal code', /\b[A-Z]{6}\d{2}[A-EHLMPRST]\d{2}[A-Z]\d{3}[A-Z]\b/],
  ['e-mail address', /[\w.+-]+@[\w-]+\.[\w.-]*[a-z]{2,}/i],
  ['phone number', /(?<![\w,.\-/])(?:\+39[ .-]?)?(?:3\d{2}|0\d{1,3})[ .-]?\d{6,8}(?![\d,.])/],
  ['IBAN', /\b[A-Z]{2}\d{2}[A-Z]\d{10}[0-9A-Z]{12}\b/],
  ['birth date', /\b(nato|nata|born|data di nascita|date of birth|birth date)\b[^.\n]{0,20}?\b\d{1,2}[/.-]\d{1,2}[/.-](19|20)\d{2}\b/i],
];

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
 * @returns {{ file: string, key: string | null, rule: string, message: string }[]}
 */
export function lintKnowledge(files, { commitExists = () => true, projects = null, keys = null } = {}) {
  const out = [];
  const add = (file, key, rule, message) => out.push({ file, key, rule, message });
  for (const { file, text } of files) {
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
