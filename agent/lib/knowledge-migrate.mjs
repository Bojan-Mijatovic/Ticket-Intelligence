// One-time move of a knowledge base from path-named files (frontend-src-app-features-patients.md) to files named
// after the team's components (pazienti.md), K6 of docs/KNOWLEDGE_PLAN.md. Plain code, no AI: entries are moved as
// they are; the result is reviewed as one documentation pull request (agent/knowledge-migrate.mjs).
//
// Where an entry goes:
//   - a full entry: the component of the file it was in (the documenting agent chose it), or, for a file that maps to
//     no component (frontend/src, e2e), the component most of the code paths it cites belong to;
//   - a short reference entry: the component of its file, unless that is where the full entry is now (then dropped);
//   - a file's description, key files and people go to the component of the file (or of most of its full entries).

import { namedComponentOf, namedComponentOfFiles, slugOf } from '../../.claude/skills/analyze-ticket/scripts/lib/components.mjs';
import { parseKnowledgeFile } from './knowledge.mjs';

const PATH_RE = /[\w@.-]+(?:\/[\w@.-]+)+\.(?:ts|java|scss|css|html|sql|json|xml|properties|ya?ml)\b/g;
const keyNum = (k) => Number(k.split('-').pop());

/** The parts of a knowledge file's preamble: title, description, key files block, people. */
function preambleParts(text) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const end = lines.findIndex((l) => /^## /.test(l));
  const pre = lines.slice(0, end < 0 ? lines.length : end);
  const title = (pre.find((l) => /^# /.test(l)) ?? '').replace(/^# /, '').trim();
  const out = { title, description: [], keyFiles: [], people: null };
  let inKeys = false;
  for (const l of pre.slice(pre.findIndex((x) => /^# /.test(x)) + 1)) {
    if (/^\*\*People who know it\*\*/.test(l)) {
      out.people = l.replace(/^\*\*People who know it\*\*:?\s*/, '').trim();
      inKeys = false;
    } else if (/^\*\*Key files\*\*/.test(l)) {
      inKeys = true;
      const rest = l.replace(/^\*\*Key files\*\*:?\s*/, '').trim();
      if (rest) out.keyFiles.push(rest.startsWith('- ') ? rest : `- ${rest}`);
    } else if (inKeys && /^\s*- /.test(l)) out.keyFiles.push(l.trim());
    else if (l.trim()) {
      inKeys = false;
      out.description.push(l);
    } else if (out.description.length && out.description.at(-1) !== '') out.description.push('');
  }
  while (out.description.at(-1) === '') out.description.pop();
  return out;
}

/** "Sara Colombo (…), Ticket Intelligence Agent (…)" → people segments, without the agent or bots. */
export function peopleSegments(line) {
  return String(line ?? '').split(/(?<=\)),\s+/).map((s) => s.trim()).filter((s) => s && !/\b(agent|bot)\b/i.test(s));
}

/**
 * @param {{ file: string, text: string }[]} files  docs/knowledge/*.md (README.md is rebuilt, not read)
 * @param {{ name: string, paths: string[] }[]} rules  the named components
 * @returns {{ files: Map<string, string>, removed: string[], moves: { key: string, from: string, to: string, reference: boolean }[] }}
 */
export function planMigration(files, rules) {
  const DIR = 'docs/knowledge/';
  const sharedName = rules.find((r) => /shared|common/i.test(r.name))?.name ?? rules[0]?.name ?? 'General';
  const old = files.filter((f) => !/README\.md$/.test(f.file)).map((f) => {
    const parsed = parseKnowledgeFile(f.text, f.file);
    const pre = preambleParts(f.text);
    return { ...f, parsed, pre, component: pre.title ? namedComponentOf(`${pre.title.replace(/\/$/, '')}/x`, rules) : null };
  });

  // Full entries first: their component decides where the references point.
  const fullOf = new Map(); // key → { entry, component, from }
  for (const o of old) {
    for (const e of o.parsed.entries.filter((x) => !x.reference)) {
      const cited = [...new Set(e.text.match(PATH_RE) ?? [])].filter((p) => !p.startsWith('e2e/'));
      const component = o.component ?? namedComponentOfFiles(cited, rules) ?? sharedName;
      if (!fullOf.has(e.key)) fullOf.set(e.key, { entry: e, component, from: o.file });
    }
  }
  // A file that maps to no component gives its preamble to the component of most of its full entries.
  for (const o of old.filter((x) => !x.component)) {
    const counts = new Map();
    for (const e of o.parsed.entries.filter((x) => !x.reference)) counts.set(fullOf.get(e.key).component, (counts.get(fullOf.get(e.key).component) ?? 0) + 1);
    o.preambleTo = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null; // none: e.g. e2e, only references
  }

  const comps = new Map(); // name → { descriptions: [], keyFiles: Set, people: [], entries: [] }
  const comp = (name) => {
    if (!comps.has(name)) comps.set(name, { descriptions: [], keyFiles: new Set(), people: [], full: [], refs: [] });
    return comps.get(name);
  };
  for (const o of old) {
    const to = o.component ?? o.preambleTo;
    if (!to) continue;
    const c = comp(to);
    if (o.pre.description.length) c.descriptions.push(o.pre.description.join('\n'));
    o.pre.keyFiles.forEach((k) => c.keyFiles.add(k));
    c.people.push(...peopleSegments(o.pre.people));
  }
  const moves = [];
  for (const [key, f] of fullOf) {
    comp(f.component).full.push(f.entry);
    moves.push({ key, from: f.from, to: `${DIR}${slugOf(f.component)}.md`, reference: false });
  }
  for (const o of old) {
    for (const e of o.parsed.entries.filter((x) => x.reference)) {
      const full = fullOf.get(e.key);
      if (!o.component || !full || o.component === full.component || comp(o.component).refs.some((r) => r.key === e.key)) continue;
      comp(o.component).refs.push({ key: e.key, title: full.entry.title, to: full });
      moves.push({ key: e.key, from: o.file, to: `${DIR}${slugOf(o.component)}.md`, reference: true });
    }
  }

  // Links: old file → new file; an anchor names the ticket, whose full entry may have moved elsewhere.
  const fileTo = new Map(old.map((o) => [o.file.slice(DIR.length), o.component ? `${slugOf(o.component)}.md` : null]));
  const titleTo = new Map(old.filter((o) => o.component).map((o) => [o.pre.title, o.component]));
  const relink = (text) =>
    text.replace(/\[([^\]]+)\]\(([\w.-]+\.md)(#[\w-]+)?\)/g, (all, label, target, anchor) => {
      if (!fileTo.has(target)) return all;
      const key = anchor?.match(/^#([a-z][a-z0-9_]*-\d+)-/)?.[1]?.toUpperCase();
      const dest = key && fullOf.has(key) ? `${slugOf(fullOf.get(key).component)}.md` : fileTo.get(target);
      if (!dest) return label.replace(/`/g, '');
      const name = titleTo.get(label) ?? (key && fullOf.has(key) && label === target.replace(/\.md$/, '') ? fullOf.get(key).component : label);
      return `[${name}](${dest}${anchor ?? ''})`;
    });

  const out = new Map();
  for (const [name, c] of [...comps.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const rule = rules.find((r) => r.name === name);
    const people = new Map();
    for (const seg of c.people) {
      const who = seg.split(' (')[0].trim();
      people.set(who, people.has(who) && people.get(who) !== seg ? `${people.get(who).replace(/\)$/, '')}; ${seg.slice(who.length).trim().replace(/^\(/, '')}` : seg);
    }
    const entries = [
      ...c.full.map((e) => ({ key: e.key, text: `### ${e.key}: ${e.title}\n${relink(e.text).replace(/\n+$/, '')}` })),
      ...c.refs.map((r) => ({ key: r.key, text: `### ${r.key}: ${r.title}\n- The full entry is in [${r.to.component}](${slugOf(r.to.component)}.md#${r.to.entry.anchor}).` })),
    ].sort((a, b) => keyNum(b.key) - keyNum(a.key));
    const body = [
      `# ${name}`,
      '',
      rule ? `**Code**: ${rule.paths.map((p) => `\`${p}\``).join(', ')}` : null,
      rule ? '' : null,
      ...(c.descriptions.length ? [relink(c.descriptions.join('\n\n')), ''] : []),
      ...(c.keyFiles.size ? ['**Key files**:', ...c.keyFiles, ''] : []),
      people.size ? `**People who know it**: ${[...people.values()].join(', ')}` : null,
      people.size ? '' : null,
      '## Known issues',
      '',
      entries.map((e) => e.text).join('\n\n'),
      '',
    ].filter((l) => l !== null);
    out.set(`${DIR}${slugOf(name)}.md`, body.join('\n'));
  }

  // The index, rebuilt.
  const resolved = (e) => e.fields.Resolved?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '';
  const index = [
    '# Knowledge base',
    '',
    "Resolved tickets of this project by component: what users saw, the root cause, the fix and how to verify it. Read the component's file before working on a ticket that touches it, because the same problem may have happened before.",
    '',
    '## Components',
    '',
    '| Component | Code |',
    '|---|---|',
    ...[...comps.keys()].sort().map((n) => `| [${n}](${slugOf(n)}.md) | ${(rules.find((r) => r.name === n)?.paths ?? []).map((p) => `\`${p}\``).join(', ')} |`),
    '',
    '## Documented tickets',
    '',
    '| Ticket | Title | Component | Resolved |',
    '|---|---|---|---|',
    ...[...fullOf.entries()].sort((a, b) => keyNum(b[0]) - keyNum(a[0])).map(([k, f]) => `| ${k} | ${f.entry.title.replace(/\|/g, '/')} | [${f.component}](${slugOf(f.component)}.md#${f.entry.anchor}) | ${resolved(f.entry)} |`),
    '',
  ];
  out.set(`${DIR}README.md`, index.join('\n'));
  const removed = old.map((o) => o.file).filter((f) => !out.has(f));
  return { files: out, removed, moves };
}
