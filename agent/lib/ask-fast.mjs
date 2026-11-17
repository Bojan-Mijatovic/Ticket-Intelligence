// Ask, answered by plain code (2/7 of the Ask work): which question it is by clear wording, which component it names,
// and two more fast answers, a component's history and where some code is. System 1 (J5) still reads the questions no
// rule recognises; Claude answers the rest. Every rule here prefers "not sure" to a wrong fast answer: a question it is
// not sure of goes the full way.

/** Lower case, no accents, single spaces: "Šta je" and "sta je" read the same. */
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}/._-]+/gu, ' ').trim();

// Clear wordings, in English, Italian and Serbian (in that order inside each rule). Checked in this order: who, where,
// latest, history. "Who last worked on X" is who, not latest.
const RULES = [
  ['who', /^(who|chi|ko|tko)\b|\b(who (knows|worked|works|wrote|changed|last)|chi (conosce|ha (lavorato|scritto|modificato))|ko (zna|je radio|radi|je pisao|je menjao|je poslednji))\b/],
  ['where', /\b(where (is|are)|in which file|which files?|dove (si trova|sta|e|sono)|in quale file|gde (je|su|se nalazi)|gdje (je|su)|u kom(e)? fajlu|koji fajl)\b/],
  ['latest', /\b(latest|newest|most recent|recent) (tickets?|bugs?|issues?)\b|\b(ultimi|ultime|piu recenti) (ticket|bug|segnalazioni)\b|\b(poslednj\w*|najnovij\w*|zadnj\w*) (tiket\w*|bag\w*|prijav\w*)\b/],
  ['history', /\b(history|which bugs|what bugs|bugs (of|in|did|has|had))\b|\b(storia|storico|quali bug|bug (di|del|della|nelle?))\b|\b(istorij\w*|koji bag\w*|bag(ovi|ove) (u|za|od))\b/],
];

/** The intent a clear wording gives, or null (System 1 or Claude decides then). */
export function ruleIntent(question) {
  const q = norm(question);
  return RULES.find(([, re]) => re.test(q))?.[0] ?? null;
}

// Folder names that say nothing about a component.
const GENERIC = new Set(['src', 'main', 'java', 'com', 'app', 'apps', 'features', 'feature', 'shared', 'components', 'component', 'services', 'service', 'frontend', 'backend', 'core', 'utils', 'util', 'lib', 'test', 'tests', 'resources', 'db', 'migration', 'common', 'api', 'model', 'models', 'pages', 'page']);
const wordsOfPath = (p) => String(p).toLowerCase().split(/[/._-]+/).filter((w) => w.length >= 4 && !GENERIC.has(w) && !/^(medi\w+|styles?|scss|html)$/.test(w));

/**
 * The component a question names: by its name ("Prenotazioni", "fasce orarie"), or by a folder word of its paths that
 * no other component has ("booking" → Prenotazioni). Null when none, or when two components match equally: a model's
 * guess is not used here, because it always names one (on "What are the latest tickets?" it said "Report", 78 %).
 */
export function componentInQuestion(question, rules = []) {
  const q = norm(question);
  const glued = q.replace(/\s+/g, ''); // "time slot" finds "timeslot"
  const has = (w) => new RegExp(`(?<![\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(q) || glued.includes(w);
  const byName = rules.filter((r) => {
    const name = norm(r.name).replace(/\s*\(.*\)\s*/, ''); // "Shared (forms, dates, layout)" → "shared"
    return name.length >= 4 && !GENERIC.has(name) && has(name);
  });
  if (byName.length === 1) return byName[0].name;
  if (byName.length > 1) return null;
  const owners = new Map(); // folder word → components that have it
  for (const r of rules) for (const w of new Set((r.paths ?? []).flatMap(wordsOfPath))) owners.set(w, [...(owners.get(w) ?? []), r.name]);
  const score = new Map();
  for (const [w, names] of owners) if (names.length === 1 && has(w)) score.set(names[0], (score.get(names[0]) ?? 0) + 1);
  const ranked = [...score].sort((a, b) => b[1] - a[1]);
  return ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1]) ? ranked[0][0] : null;
}

const keyNumber = (k) => Number(String(k).split('-')[1]) || 0;

/**
 * The fast answers this module adds: a component's history, and where some code is. Null when the data cannot answer
 * it for sure (no component for a history; no file that matches the words for a where).
 * @param {string[]} [p.files]   the repository's files on main (for "where")
 */
export function fastMore({ question, intent, component = null, insights, rules = [], files = [], ticketUrl = () => null, fileUrl = () => null }) {
  if (!insights) return null;
  const ticketSource = (t) => ({ type: 'ticket', ref: t.key, url: ticketUrl(t.key), why: `${t.type}, ${t.status}: ${t.summary}` });
  const fileSource = (path, why) => ({ type: 'file', ref: path, url: fileUrl(path), why });
  const comp = component ? (insights.components ?? []).find((c) => c.name === component) : null;
  const team = (c) => (c?.team ?? []).slice(0, 3).map((p) => `${p.name} (${p.share} %)`).join(', ');

  if (intent === 'history') {
    if (!comp) return null;
    const bugs = (insights.tickets ?? []).filter((t) => /bug/i.test(t.type ?? '') && (t.components ?? []).includes(comp.name)).sort((a, b) => keyNumber(b.key) - keyNumber(a.key));
    if (!bugs.length) return null;
    const again = (insights.recurring ?? []).filter((r) => r.component === comp.name);
    const repeat = (insights.riskFiles ?? []).filter((f) => f.component === comp.name && (f.bugs ?? []).length > 1);
    const shown = bugs.slice(0, 6);
    return {
      question, found: true, fast: true, intent, component: comp.name,
      answer: [
        `${comp.name} has had ${bugs.length} bug${bugs.length === 1 ? '' : 's'}${comp.priorityBugs ? `, ${comp.priorityBugs} of them High or Highest` : ''}${comp.openBugs ? `, ${comp.openBugs} still open` : ', none open'}.`,
        `Newest first: ${shown.map((t) => `${t.key} ${t.summary} (${t.status})`).join('; ')}${bugs.length > shown.length ? `; and ${bugs.length - shown.length} older` : ''}.`,
        repeat.length ? `Fixed more than once: ${repeat.map((f) => `${f.path.split('/').pop()} (${f.bugs.join(', ')})`).join('; ')}.` : null,
        again.length ? `Came back: ${again.map((r) => `${r.key} repeats ${r.of}`).join('; ')}.` : null,
        comp.team?.length ? `Who knows it: ${team(comp)}.` : null,
      ].filter(Boolean).join(' '),
      sources: shown.map(ticketSource),
    };
  }

  if (intent === 'where') {
    // The files whose path has the question's words first ("the booking list" is one file, not all of Prenotazioni);
    // then, for a component named, its folders and its riskiest files.
    const byWords = filesForWords({ question, files, rules, insights, team, fileSource });
    if (byWords) return { question, found: true, fast: true, intent, ...byWords };
    if (comp) {
      const rule = rules.find((r) => r.name === comp.name);
      const risky = (insights.riskFiles ?? []).filter((f) => f.component === comp.name).slice(0, 3);
      if (!rule?.paths?.length) return null;
      const shown = rule.paths.map((p) => (p.endsWith('/') ? p : `${p}*`)); // a rule path without "/" is the start of file names
      return {
        question, found: true, fast: true, intent, component: comp.name,
        answer: `${comp.name} is in ${shown.join(', ')}.${risky.length ? ` Its files with the most bug fixes and changes: ${risky.map((f) => f.path).join(', ')}.` : ''}${comp.team?.length ? ` Who knows it: ${team(comp)}.` : ''}`,
        sources: risky.map((f) => fileSource(f.path, (f.why ?? []).join(', '))),
      };
    }
    return null;
  }
  return null;
}

/** "Where is the booking list?": the app files whose path has the question's words, when that is sure enough. */
function filesForWords({ question, files, rules, insights, team, fileSource }) {
    const stop = new Set(['where', 'which', 'file', 'files', 'code', 'codice', 'dove', 'trova', 'quale', 'kod', 'koji', 'fajl', 'fajlu', 'nalazi', 'the', 'for', 'del', 'della', 'delle', 'za', 'je', 'su', 'is', 'are', 'si', 'il', 'la', 'le', 'lo', 'gli', 'in', 'of', 'gde', 'gdje', 'sta', 'nel', 'nella']);
    const words = [...new Set(norm(question).split(' ').filter((w) => w.length >= 4 && !stop.has(w)))];
    if (!words.length) return null;
    const app = files.filter((f) => /^(frontend|backend)\//.test(f) && !/(^|\/)(node_modules|dist|target)\//.test(f) && !/\.(spec|test)\.|Test\.java$/.test(f));
    const scored = app.map((f) => ({ f, hits: words.filter((w) => f.toLowerCase().includes(w) || f.toLowerCase().includes(w.replace(/s$/, ''))).length })).filter((x) => x.hits > 0);
    const best = Math.max(0, ...scored.map((x) => x.hits));
    // Sure enough: two words or more found in one path, or a single distinctive word (six letters or more, "dispensing")
    // whose files sit in one folder. One short word alone ("list") matches too much.
    if (!best) return null;
    if (words.length > 1 ? best < 2 : words[0].length < 6) return null;
    const top = scored.filter((x) => x.hits === best).map((x) => x.f).sort((a, b) => a.length - b.length).slice(0, 5);
    if (words.length === 1 && new Set(top.map((f) => f.split('/').slice(0, -1).join('/'))).size > 1) return null;
    const comps = [...new Set(top.map((f) => rules.find((r) => (r.paths ?? []).some((p) => f.startsWith(p)))?.name).filter(Boolean))];
    const owner = comps.length === 1 ? (insights.components ?? []).find((c) => c.name === comps[0]) : null;
    return {
      component: comps.length === 1 ? comps[0] : null,
      answer: `${top.length === 1 ? 'It is in' : 'The files that match'} ${top.join(', ')}.${comps.length ? ` Component: ${comps.join(', ')}.` : ''}${owner?.team?.length ? ` Who knows it: ${team(owner)}.` : ''}`,
      sources: top.map((f) => fileSource(f, `its path has: ${words.filter((w) => f.toLowerCase().includes(w.replace(/s$/, ''))).join(', ')}`)),
    };
}
