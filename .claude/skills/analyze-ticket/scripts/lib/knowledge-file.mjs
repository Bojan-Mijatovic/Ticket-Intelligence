// A knowledge file (docs/knowledge/<component>.md, written by the document-ticket skill) as data. Shared by the
// analyze-ticket bundle (what is already documented about a ticket) and the Ticket Intelligence agent (its lint and
// migration), so both read entries the same way.

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
