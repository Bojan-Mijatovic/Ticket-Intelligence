// Small text helpers: tokenizing, naive stemming, keyword extraction, trimming.

// Words ignored when extracting keywords. Includes common Serbian words, because requests and tickets
// sometimes arrive in Serbian ("hitno", "molim", "tiket").
const STOP = new Set(
  `a an the and or but for with from into onto this that these those is are was were be been being have has had
   not no yes you your our we they them their its it on in at to of by as if when what which who how can could would
   should will may might please any all some also only just very more less than then there here about after before
   since until while per via get got still doesn don isn aren wasn won work works working properly correctly
   ticket issue problem request urgent asap help
   hitno molim tiket problem zahtev može moze možeš mozes da se je su na za od do sa iz ili ali kao koji koja koje
   kada sto što nije nisu smo ste ima imam nema bilo biti kod`.split(/\s+/).filter(Boolean),
);

export function tokenize(text) {
  return String(text ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function stem(w) {
  if (w.length > 5) {
    for (const suf of ['ing', 'ed', 's']) if (w.endsWith(suf)) return w.slice(0, -suf.length);
  } else if (w.length > 3 && w.endsWith('s')) {
    return w.slice(0, -1);
  }
  return w;
}

export const stemSet = (text) => new Set(tokenize(text).map(stem));

export function keywords(text, { exclude = [], max = 6 } = {}) {
  const ex = new Set(exclude.flatMap(tokenize));
  const out = [];
  for (const t of tokenize(text)) {
    if (t.length < 3 || STOP.has(t) || ex.has(t) || /^\d+$/.test(t) || out.includes(t)) continue;
    out.push(t);
  }
  return out.slice(0, max);
}

const HOST_RE = /\b(?:[\w-]+\.)+(?:com|net|org|io|rs|eu|de|co|uk|local|internal|cloud|app|dev)\b/gi;

// Code-like tokens worth searching for in a repository: URL paths, `backticked` or 'quoted' identifiers,
// dotted config keys, camelCase / PascalCase / snake_case names.
export function codeClues(text, { exclude = [], max = 15 } = {}) {
  let s = String(text ?? '');
  const ex = new Set(exclude.map((e) => String(e).toLowerCase()));
  const out = new Map();
  const add = (raw) => {
    const v = String(raw).trim().replace(/[.,:;)]+$/, '');
    const k = v.toLowerCase();
    if (v.length < 3 || ex.has(k) || out.has(k) || /^[A-Z][A-Z0-9_]+-\d+$/i.test(v) || /^\d/.test(v) || STOP.has(k)) return;
    out.set(k, v);
  };
  for (const m of s.matchAll(/https?:\/\/[^\s/]+(\/[^\s?#'")]*)?/g)) if (m[1] && m[1].length > 1) add(m[1]);
  s = s.replace(/https?:\/\/\S+/g, ' ').replace(HOST_RE, ' ');
  for (const m of s.matchAll(/`([^`\n]{2,80})`/g)) add(m[1]);
  // straight and typographic quotes: 'x' "x" ‘x’ “x” — UI labels and button names are usually quoted
  for (const m of s.matchAll(/['"‘’“”]([A-Za-z_][\w.\-/]{2,60})['"‘’“”]/g)) add(m[1]);
  for (const m of s.matchAll(/(?:^|[\s(])(\/[\w\-.{}:]+(?:\/[\w\-.{}:]+)+)/g)) add(m[1]);
  // dotted names (config keys, members); every segment ≥ 2 chars so "e.g" / "f.e" don't count
  for (const m of s.matchAll(/\b[a-zA-Z_]\w+(?:\.[a-zA-Z_]\w+)+\b/g)) add(m[0]);
  // camelCase / PascalCase, including acronyms: timeSlot, structureIDs, StructuretimeSlot, HTTPClient
  for (const m of s.matchAll(/\b[a-z]+(?:[A-Z]+[a-z0-9]*)+\b/g)) add(m[0]);
  for (const m of s.matchAll(/\b[A-Z][a-z0-9]+(?:[A-Z]+[a-z0-9]*)+\b/g)) add(m[0]);
  // snake_case and UPPER_SNAKE (constants, codes, test data such as SVIL_MS_VISITE)
  for (const m of s.matchAll(/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/g)) add(m[0]);
  for (const m of s.matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g)) add(m[0]);
  return [...out.values()].slice(0, max);
}

export function trimText(s, max) {
  s = String(s ?? '');
  return s.length > max ? `${s.slice(0, max)} … [+${s.length - max} chars]` : s;
}
