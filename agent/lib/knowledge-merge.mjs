// K22 of docs/KNOWLEDGE_PLAN.md: documentation PRs merge in any order. Several PRs written from the same main each add
// a row at the top of the index (docs/knowledge/README.md), and in a component file each rewrites the owners line
// ("People who know it") and adds its entry at the top of "Known issues", so after the first merge the others conflict
// (VAX-16, VAX-17, VAX-19, VAX-21 on 2026-11-16, resolved by hand). This merges the three versions of such a file
// (base, main, the documentation branch) entry by entry, as was done by hand:
// - the index: table rows of both, by their first cell; ticket rows newest ticket first;
// - a component file: one owners line with the people of both (a person both sides changed keeps main's words, with
//   the tickets and commits only the branch added); every entry once, newest ticket first;
// - any other text must be the same on both sides, or changed on one side only.
// What it cannot place is a conflict, left for a person. Plain code; docs-prs.mjs runs it and the lint checks the result.

const KEY = /^([A-Z][A-Z0-9_]+)-(\d+)$/;
const OWNERS = /^\*\*People who know it\*\*:\s*/;

/** The three-way choice for one piece: the same on both sides, or changed on one side only. undefined = conflict. */
export const threeWay = (base, main, branch) => (main === branch ? main : base === main ? branch : base === branch ? main : undefined);

/** The changes from `a` to `b` (line arrays) as hunks { start, end, lines }: a[start, end) becomes `lines`. */
function hunks(a, b) {
  const n = a.length;
  const m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let [i, j] = [0, 0];
  let cur = null;
  const flush = () => cur && (out.push(cur), (cur = null));
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      flush();
      i++;
      j++;
    } else if (j < m && (i === n || L[i][j + 1] >= L[i + 1][j])) {
      cur ??= { start: i, end: i, lines: [] };
      cur.lines.push(b[j++]);
    } else {
      cur ??= { start: i, end: i, lines: [] };
      cur.end = ++i;
    }
  }
  flush();
  return out;
}

/**
 * A line-by-line three-way merge (text). Changes to different lines are both kept. Where both sides only added lines at
 * the same place (two entries in a list of key files), both are kept, main's first; the same change on both sides is
 * kept once. Anything else that touches the same lines is a conflict: undefined.
 */
export function mergeLines(base, main, branch) {
  const same = threeWay(base, main, branch);
  if (same !== undefined) return same;
  const [B, M, R] = [String(base ?? '').split('\n'), String(main).split('\n'), String(branch).split('\n')];
  const all = [...hunks(B, M).map((h) => ({ ...h, side: 'main' })), ...hunks(B, R).map((h) => ({ ...h, side: 'branch' }))].sort((x, y) => x.start - y.start || x.end - y.end);
  const out = [];
  let at = 0;
  for (let k = 0; k < all.length; ) {
    const group = [all[k]];
    let end = all[k].end;
    for (k++; k < all.length && (all[k].start < end || all[k].start === group[0].start); k++) {
      group.push(all[k]);
      end = Math.max(end, all[k].end);
    }
    const start = group[0].start;
    out.push(...B.slice(at, start));
    const mains = group.filter((h) => h.side === 'main');
    const branches = group.filter((h) => h.side === 'branch');
    if (!mains.length || !branches.length) out.push(...group.flatMap((h) => h.lines)); // one side: one hunk
    else {
      const text = (hs) => JSON.stringify(hs.map((h) => [h.start, h.end, h.lines]));
      if (text(mains) === text(branches)) out.push(...mains.flatMap((h) => h.lines));
      else if (group.every((h) => h.start === h.end && h.start === start)) {
        const m = mains.flatMap((h) => h.lines);
        out.push(...m, ...branches.flatMap((h) => h.lines).filter((l) => !m.includes(l)));
      } else return undefined;
    }
    at = end;
  }
  out.push(...B.slice(at));
  return out.join('\n');
}

const byTicketDesc = (a, b) => {
  const [x, y] = [a.match(KEY), b.match(KEY)];
  if (!x || !y) return 0;
  return x[1] === y[1] ? Number(y[2]) - Number(x[2]) : 0;
};

/**
 * Keyed pieces merged: each key's three-way choice (both changed: `bothChanged(main, branch)`, or a conflict when it
 * returns undefined); a piece one side removed and the other left alone goes. Main's order, then the branch's new
 * ones; `sort` reorders after.
 * @returns {{ items: [string, string][] } | { conflict: string }}
 */
function mergeKeyed(base, main, branch, { bothChanged = () => undefined, sort = null } = {}) {
  const [B, M, R] = [new Map(base), new Map(main), new Map(branch)];
  const keys = [...M.keys(), ...[...R.keys()].filter((k) => !M.has(k))];
  const out = [];
  for (const k of keys) {
    const [b, m, r] = [B.get(k), M.get(k), R.get(k)];
    if (m === undefined || r === undefined) {
      const kept = m ?? r;
      if (b === undefined) out.push([k, kept]); // added on one side
      else if (kept !== b) return { conflict: `${k}: removed on one side and changed on the other` };
      continue; // removed on one side, unchanged on the other
    }
    const v = threeWay(b, m, r) ?? bothChanged(m, r, b);
    if (v === undefined) return { conflict: `${k}: changed on both sides` };
    out.push([k, v]);
  }
  if (sort) out.sort((x, y) => sort(x[0], y[0]));
  return { items: out };
}

// ---------------------------------------------------------------- the index

/** Sections by "## " heading; in each, the lines before its table, the table (header, separator, keyed rows), after. */
function sections(text) {
  const out = [];
  for (const chunk of String(text).replace(/\r\n/g, '\n').split(/^(?=## )/m)) {
    const lines = chunk.split('\n'); // as it is, trailing blank lines too: the sections join back to the same text
    const head = lines[0].startsWith('## ') ? lines[0] : '';
    const body = head ? lines.slice(1) : lines;
    const first = body.findIndex((l) => l.startsWith('|'));
    if (first < 0) {
      out.push({ head, before: body.join('\n'), table: null, after: '' });
      continue;
    }
    let last = first;
    while (last + 1 < body.length && body[last + 1].startsWith('|')) last++;
    const rows = body.slice(first, last + 1);
    out.push({
      head,
      before: body.slice(0, first).join('\n'),
      table: { header: rows.slice(0, 2).join('\n'), rows: rows.slice(2).map((r) => [r.split('|')[1].trim(), r]) },
      after: body.slice(last + 1).join('\n'),
    });
  }
  return out;
}

export function mergeIndex(base, main, branch) {
  const [B, M, R] = [sections(base), sections(main), sections(branch)];
  const heads = [...M.map((s) => s.head), ...R.map((s) => s.head).filter((h) => !M.some((s) => s.head === h))];
  const parts = [];
  for (const head of heads) {
    const [b, m, r] = [B.find((s) => s.head === head), M.find((s) => s.head === head), R.find((s) => s.head === head)];
    if (!m || !r) {
      if (b) return { conflict: `README.md: "${head}" removed on one side` };
      parts.push(m ?? r);
      continue;
    }
    const pick = (f) => mergeLines(b ? f(b) : '', f(m), f(r));
    const before = pick((s) => s.before);
    const after = pick((s) => s.after);
    const header = threeWay(b?.table?.header ?? null, m.table?.header ?? null, r.table?.header ?? null);
    if (before === undefined || after === undefined || header === undefined) return { conflict: `README.md: the text of "${head || 'the top'}" changed on both sides` };
    let table = null;
    if (m.table || r.table) {
      // A row both sides wrote anew (a ticket documented twice): the branch's, the newer documentation.
      const rows = mergeKeyed(b?.table?.rows ?? [], m.table?.rows ?? [], r.table?.rows ?? [], { bothChanged: (_, rb) => rb, sort: byTicketDesc });
      if (rows.conflict) return { conflict: `README.md: ${rows.conflict}` };
      table = { header, rows: rows.items };
    }
    parts.push({ head, before, table, after });
  }
  const text = parts
    .map((s) => [...(s.head ? [s.head] : []), s.before, ...(s.table ? [[s.table.header, ...s.table.rows.map(([, row]) => row)].join('\n'), s.after] : [])].join('\n'))
    .join('');
  return { text: `${text.replace(/\n{3,}/g, '\n\n').trim()}\n` };
}

// ---------------------------------------------------------------- a component file

/** "A (x, y), B (z)" → [[A, "A (x, y)"], [B, "B (z)"]]: commas inside parentheses stay. */
export function parseOwners(line) {
  const text = String(line ?? '').replace(OWNERS, '').replace(/\.\s*$/, '');
  const items = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      items.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) items.push(cur.trim());
  const nameOf = (s) => s.replace(/\s*\([\s\S]*$/, '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  return items.filter(Boolean).map((s) => [nameOf(s), s]);
}

const TOKENS = /\b[A-Z][A-Z0-9_]+-\d+\b|`?\b[0-9a-f]{7,40}\b`?/g;
/**
 * One person both sides changed: main's words, then what only the branch added since base (its tickets and commits):
 * "Bojan (VAX-13, VAX-19: fix commits `a`, `c`)" and "Bojan (VAX-13, VAX-21: fix commits `a`, `d`)" →
 * "Bojan (VAX-13, VAX-19: fix commits `a`, `c`; VAX-21: `d`)".
 */
export function combinePerson(main, branch, base = '') {
  const have = new Set([...String(main).matchAll(TOKENS)].map((m) => m[0].replace(/`/g, '')));
  const before = new Set([...String(base).matchAll(TOKENS)].map((m) => m[0].replace(/`/g, '')));
  const added = [...new Set([...String(branch).matchAll(TOKENS)].map((m) => m[0]))].filter((t) => !have.has(t.replace(/`/g, '')) && !before.has(t.replace(/`/g, '')));
  if (!added.length) return main;
  const keys = added.filter((t) => KEY.test(t));
  const shas = added.filter((t) => !KEY.test(t));
  const extra = `${keys.join(', ')}${keys.length && shas.length ? ': ' : ''}${shas.join(', ')}`;
  return /\)\s*$/.test(main) ? main.replace(/\)\s*$/, `; ${extra})`) : `${main} (${extra})`;
}

function component(text) {
  const t = String(text).replace(/\r\n/g, '\n');
  const at = t.search(/^## Known issues\s*$/m);
  if (at < 0) return null;
  const pre = t.slice(0, at);
  const rest = t.slice(at).split('\n').slice(1).join('\n');
  const next = rest.search(/^## /m);
  const issues = next < 0 ? rest : rest.slice(0, next);
  const tail = next < 0 ? '' : rest.slice(next).trim();
  const lines = pre.replace(/\n+$/, '').split('\n');
  const o = lines.findIndex((l) => OWNERS.test(l));
  const blocks = issues.split(/^(?=### )/m).map((s) => s.trim()).filter((s) => s.startsWith('### '));
  return {
    head: lines.map((l, i) => (i === o ? '\u0000OWNERS' : l)).join('\n'),
    owners: o >= 0 ? lines[o] : null,
    entries: blocks.map((b) => [b.match(/^### ([A-Z][A-Z0-9_]+-\d+):/)?.[1] ?? b.split('\n')[0], b]),
    tail,
  };
}

export function mergeComponent(path, base, main, branch) {
  const [B, M, R] = [component(base ?? ''), component(main), component(branch)];
  if (!M || !R) return { conflict: `${path}: no "## Known issues" section` };
  const head = mergeLines(B?.head ?? '', M.head, R.head);
  const tail = mergeLines(B?.tail ?? '', M.tail, R.tail);
  if (head === undefined || tail === undefined) return { conflict: `${path}: the text outside the entries and the owners line changed on both sides` };
  let owners = threeWay(B?.owners, M.owners, R.owners);
  if (owners === undefined) {
    const people = mergeKeyed(parseOwners(B?.owners), parseOwners(M.owners), parseOwners(R.owners), { bothChanged: (m, r, b) => combinePerson(m, r, b) });
    if (people.conflict) return { conflict: `${path}: owners: ${people.conflict}` };
    owners = `**People who know it**: ${people.items.map(([, s]) => s).join(', ')}${/\.\s*$/.test(M.owners) ? '.' : ''}`;
  }
  const entries = mergeKeyed(B?.entries ?? [], M.entries, R.entries, { sort: byTicketDesc });
  if (entries.conflict) return { conflict: `${path}: ${entries.conflict}` };
  const text = [head.replace('\u0000OWNERS', owners ?? ''), '', '## Known issues', '', entries.items.map(([, e]) => e).join('\n\n'), tail ? `\n${tail}` : ''].join('\n');
  return { text: `${text.replace(/\n{3,}/g, '\n\n').trim()}\n` };
}

/**
 * The merge of one knowledge file: { text } or { conflict: why }. `base` is '' or null for a file both sides added.
 */
export function mergeKnowledgeText(path, { base, main, branch }) {
  const same = threeWay(base ?? undefined, main, branch);
  if (same !== undefined) return { text: same };
  if (/(^|\/)README\.md$/.test(path)) return mergeIndex(base ?? '', main, branch);
  if (/\.md$/.test(path) && /^## Known issues\s*$/m.test(main) && /^## Known issues\s*$/m.test(branch)) return mergeComponent(path, base, main, branch);
  const lines = mergeLines(base ?? '', main, branch);
  return lines === undefined ? { conflict: `${path}: the same lines changed on both sides` } : { text: lines };
}
