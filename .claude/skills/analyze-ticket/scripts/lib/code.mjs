// Code context for a ticket, independent of the version control system (git or SVN, see vcs/):
// which component the ticket is about, who works there, which commits touched it (by Jira key, by message,
// around the time the problem started), and existing knowledge docs. Read-only.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { codeClues, keywords, trimText } from './text.mjs';
import { componentRules, namedComponentOf, namedComponentOfFiles, slugOf } from './components.mjs';
import { parseKnowledgeFile } from './knowledge-file.mjs';

const DAY = 864e5;
// An AI agent as author or co-author (the Ticket Intelligence agent, Claude, Copilot): its commits are not a person's.
const AGENT_AUTHOR = /ticket[ -]intelligence[ -]agent|noreply@anthropic\.com|\bclaude\b|copilot/i;

const REPO_DEFAULTS = {
  docsPath: 'docs/knowledge',
  commitMode: 'ask', // 'ask' | 'branch-pr' | 'direct'
  baseBranch: null, // null = detect (git: origin/HEAD, main, master; svn: ^/trunk)
  componentContainers: ['src', 'app', 'apps', 'lib', 'libs', 'packages', 'services', 'modules', 'components', 'config', 'internal', 'pkg', 'backend', 'frontend', 'server', 'client', 'web',
    'features', 'shared', 'core', 'pages', 'views', 'main', 'resources'],
  suspectWindowDays: 14,
  lookbackDays: 365,
  authorAliases: {}, // VCS login → display name, e.g. { "scolombo": "Sara Colombo" } (useful for SVN logins)
};

export function loadRepoConfig(root) {
  const file = join(root, '.ticket-intel.json');
  const own = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  return { ...REPO_DEFAULTS, ...own, configFile: existsSync(file) ? '.ticket-intel.json' : null };
}

const isoDaysAgo = (n, from = Date.now()) => new Date(from - n * DAY).toISOString();

// A component is the first directory below any chain of "container" directories:
// backend/src/orders/x.js → backend/src/orders, config/environments/a.yaml → config/environments, frontend/app.js → frontend.
export function componentOf(file, containers) {
  const parts = file.split('/');
  if (parts.length === 1) return '(root)';
  let i = 0;
  while (i < parts.length - 2 && containers.includes(parts[i])) i++;
  return parts.slice(0, i + 1).join('/');
}

// JVM source roots (src/main/java, src/test/kotlin, …): the package prefix shared by every file in the root
// (e.g. com/acme/app) is skipped, so backend/src/main/java/com/acme/app/timeslot/X.java → …/com/acme/app/timeslot.
// Tests are mapped onto the main source root, so a module's tests belong to the same component.
const JVM_ROOT = /^(.*?src\/(?:main|test)\/(?:java|kotlin|scala))\/(.+)$/;
const toMainRoot = (root) => root.replace(/src\/test\//, 'src/main/');

export function makeComponentResolver(files, containers) {
  const prefixes = new Map();
  for (const f of files) {
    const m = f.match(JVM_ROOT);
    if (!m) continue;
    const root = toMainRoot(m[1]);
    const dirs = m[2].split('/').slice(0, -1);
    const cur = prefixes.get(root);
    if (!cur) {
      prefixes.set(root, dirs);
      continue;
    }
    let i = 0;
    while (i < cur.length && i < dirs.length && cur[i] === dirs[i]) i++;
    prefixes.set(root, cur.slice(0, i));
  }
  return (file) => {
    const m = file.match(JVM_ROOT);
    if (!m) return componentOf(file, containers);
    const root = toMainRoot(m[1]);
    const prefix = prefixes.get(root) ?? [];
    const dirs = m[2].split('/').slice(0, -1);
    const next = dirs.length > prefix.length ? [dirs[prefix.length]] : [];
    return [root, ...prefix.slice(0, dirs.length), ...next].join('/');
  };
}

function listDocs(root, docsPath) {
  const dir = join(root, docsPath);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir, { recursive: true })
    .map((f) => String(f).replace(/\\/g, '/'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => `${docsPath}/${f}`);
}

// Plain words ("Agenda", "PULISCI") must match as whole words, otherwise "Agenda" also hits "com.mediagenda".
// Identifiers (timeSlot, structure_id, a.b.c, /api/x) match as substrings, so timeSlot also finds TimeSlotService.
const plainWord = (t) => /^[A-Za-z]+$/.test(t) && (t === t.toUpperCase() || t.slice(1) === t.slice(1).toLowerCase());

/**
 * @param {object} p
 * @param {object} p.vcs       repository adapter from vcs/index.mjs (git or svn)
 * @param {object} p.target    normalized Jira issue
 * @param {Array}  p.related   [{ key, relevance }]
 * @param {string[]} p.envs    environment names (excluded from clues)
 */
export function codeContext({ vcs, target, related, envs }) {
  const repo = vcs.root;
  const cfg = loadRepoConfig(repo);
  const warnings = [];
  const alias = (c) => ({ ...c, author: cfg.authorAliases[c.author] ?? c.author });
  const files = vcs.files();
  const componentFor = makeComponentResolver(files, cfg.componentContainers);
  const rules = componentRules(cfg); // named components (K6), for the knowledge file names; [] = path-based
  const since = isoDaysAgo(cfg.lookbackDays);
  const exclude = [cfg.docsPath, '*lock*'];
  const keyRelevance = new Map([[target.key, 1.2], ...related.map((r) => [r.key, r.relevance])]);
  const keys = [...keyRelevance.keys()];

  // --- clues from the ticket text
  const text = [target.summary, target.description, ...target.comments.map((c) => c.body)].join('\n');
  const strong = codeClues(text, { exclude: [...envs, target.project] });
  const weak = keywords(target.summary, { exclude: [...envs, ...strong] });

  const components = new Map();
  const comp = (path) => {
    if (!components.has(path)) components.set(path, { path, score: 0, reasons: [], files: new Map(), keys: new Set() });
    return components.get(path);
  };
  const note = (c, pts, reason) => {
    c.score += pts;
    if (!c.reasons.includes(reason)) c.reasons.push(reason);
  };

  // --- 1. commits that mention the ticket or related tickets (most reliable link)
  let keyCommits = [];
  try {
    keyCommits = vcs.logByMessage(keys, { all: true, limit: 300 }).map(alias);
  } catch (e) {
    warnings.push(e.message);
  }
  // The knowledge base is not code: a documentation commit ("DEM-3: document …") names the ticket too, but its files
  // must not make docs/knowledge a component of the ticket.
  const isDoc = (f) => f === cfg.docsPath || f.startsWith(`${cfg.docsPath}/`);
  for (const c of keyCommits) {
    const msg = `${c.subject}\n${c.body}`;
    c.keys = keys.filter((k) => new RegExp(`\\b${k}\\b`, 'i').test(msg));
    for (const k of c.keys) {
      for (const f of c.files.filter((x) => !isDoc(x))) {
        const cp = comp(componentFor(f));
        note(cp, (3 * keyRelevance.get(k)) / Math.max(1, c.files.length / 3), `commit ${c.short} references ${k}`);
        cp.keys.add(k);
        cp.files.set(f, (cp.files.get(f) ?? 0) + 1);
      }
    }
  }
  // A commit that only writes the knowledge base is not a fix (the entry itself is found through knowledgeDocs).
  keyCommits = keyCommits.filter((c) => c.keys.length && c.files.some((f) => !isDoc(f)));

  // --- 2. code search for clues from the ticket text
  const grepHits = [];
  for (const term of strong) {
    const hits = vcs.grep(term, { word: plainWord(term), exclude });
    for (const h of hits.slice(0, 8)) grepHits.push({ term, file: h.file, line: h.line, text: trimText(h.text.trim(), 160) });
    const hitFiles = new Set(hits.map((h) => h.file));
    for (const f of hitFiles) {
      const cp = comp(componentFor(f));
      note(cp, 3 / Math.max(1, hitFiles.size / 4), `code contains "${term}"`);
      cp.files.set(f, (cp.files.get(f) ?? 0) + 1);
    }
  }
  for (const term of weak) {
    const hitFiles = new Set(vcs.grep(term, { word: plainWord(term), exclude, filesOnly: true }).map((h) => h.file));
    if (hitFiles.size > 50) continue; // too generic to be a signal
    for (const f of hitFiles) note(comp(componentFor(f)), 0.5, `code mentions "${term}"`);
  }

  // --- 3. commits whose message matches the ticket's words
  const msgTerms = [...strong, ...weak].slice(0, 10);
  if (msgTerms.length) {
    try {
      for (const c of vcs.logByMessage(msgTerms, { all: true, since, limit: 200 })) {
        for (const f of c.files.filter((x) => !isDoc(x))) note(comp(componentFor(f)), 0.3, `commit message ${c.short} matches the ticket text`);
      }
    } catch (e) {
      warnings.push(e.message);
    }
  }

  // --- 4. changes shortly before the problem started (suspects)
  const ranked = [...components.values()].filter((c) => c.path !== '(root)' || c.score > 2).sort((a, b) => b.score - a.score);
  const top = ranked.slice(0, 4);
  const topPaths = top.map((c) => c.path);
  const created = Date.parse(target.created);
  let suspects = [];
  if (top.length && created) {
    suspects = vcs
      .logByPaths(topPaths, { all: true, since: isoDaysAgo(cfg.suspectWindowDays, created), until: new Date(created + DAY).toISOString() })
      .map(alias);
    for (const s of suspects) {
      for (const f of s.files) {
        const cp = components.get(componentFor(f));
        if (cp && top.includes(cp)) note(cp, 2, `changed ${s.date.slice(0, 10)} by ${s.author} (${s.short}), within ${cfg.suspectWindowDays}d before the ticket`);
      }
    }
  }
  ranked.sort((a, b) => b.score - a.score);

  // --- per-component history and people
  const presentComponent = (c) => {
    const history = vcs.logByPaths([c.path], { since, limit: 200 }).map(alias);
    const authors = new Map();
    let agentCommits = 0;
    for (const h of history) {
      // An AI agent's work is not a person's: its own commits, and squash merges of its pull requests, which git
      // credits to whoever clicked Merge (the agent is only a co-author). Counting them made the person who merged
      // the "owner" of code they never wrote (LAB-25, DEM-43 scenarios, 2026-11-13).
      if (AGENT_AUTHOR.test(h.author) || AGENT_AUTHOR.test(String(h.body ?? '').match(/^Co-Authored-By:.*$/gim)?.join('\n') ?? '')) {
        agentCommits += 1;
        continue;
      }
      const a = authors.get(h.author) ?? { name: h.author, commits: 0, lastCommit: h.date, keys: new Set() };
      a.commits += 1;
      if (Date.parse(h.date) > Date.parse(a.lastCommit)) a.lastCommit = h.date;
      for (const m of `${h.subject} ${h.body}`.matchAll(/\b[A-Z][A-Z0-9_]+-\d+\b/g)) a.keys.add(m[0]);
      authors.set(h.author, a);
    }
    // The knowledge file: named after the team's component when there are rules (components.mjs), else the path.
    const hitFiles = [...c.files.keys()];
    const named = rules.length ? namedComponentOfFiles(hitFiles.length ? hitFiles : [`${c.path}/x`], rules) ?? namedComponentOf(`${c.path}/x`, rules) : null;
    const docSlug = named ? slugOf(named) : c.path.replace(/[\\/]/g, '-').replace(/[()]/g, '');
    return {
      path: c.path,
      score: Math.round(c.score * 10) / 10,
      reasons: c.reasons.slice(0, 6),
      relatedTickets: [...c.keys],
      files: [...c.files.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([f]) => f),
      authors: [...authors.values()].sort((a, b) => b.commits - a.commits).slice(0, 6).map((a) => ({ ...a, keys: [...a.keys] })),
      agentCommits, // commits of an AI agent (its own or squash-merged), left out of the authors
      recentCommits: history.slice(0, 8).map(({ short, date, author, subject, files: f }) => ({ short, date, author, subject, files: f.slice(0, 8) })),
      componentReadme: ['README.md', 'readme.md'].map((r) => `${c.path}/${r}`).find((p) => c.path !== '(root)' && existsSync(join(repo, p))) ?? null,
      // With named components, a path outside all of them (tests, build files) has no knowledge file of its own.
      knowledgeDoc: rules.length && !named
        ? { path: null, component: null, exists: false, note: 'not one of the named components: document a fix here in the component of the code or screen it belongs to' }
        : { path: `${cfg.docsPath}/${docSlug}.md`, component: named, exists: existsSync(join(repo, cfg.docsPath, `${docSlug}.md`)) },
    };
  };

  const presentCommit = (c, maxLines, paths = []) => {
    let diff = { stat: '', patch: '' };
    try {
      diff = vcs.patch(c, { paths, maxLines });
    } catch (e) {
      warnings.push(`Diff of ${c.short}: ${e.message}`);
    }
    return {
      short: c.short,
      hash: c.hash,
      date: c.date,
      author: c.author,
      subject: c.subject,
      body: trimText(c.body, 600),
      keys: c.keys ?? [],
      files: c.files.slice(0, 20),
      ...diff,
    };
  };

  // Branches named after the ticket (someone may have started already)
  let branches = [];
  try {
    branches = vcs.branches().filter((b) => new RegExp(`\\b${target.key}\\b`, 'i').test(b.name));
  } catch (e) {
    warnings.push(`Branches: ${e.message}`);
  }

  // Fix branches of OTHER tickets that change the code of this ticket's top components: work in progress on the same
  // problem, maybe (K20). Git only; the remote ones (origin/KEY), compared with the base branch.
  const otherFixBranches = [];
  const baseRef = (() => {
    try {
      const b = vcs.info(cfg).baseBranch;
      return b ? `origin/${b}` : null;
    } catch {
      return null;
    }
  })();
  if (vcs.kind === 'git' && baseRef) {
    const prefixes = topPaths.filter((p) => p !== '(root)').map((p) => `${p}/`); // own-key branches: branchesForTicket
    let candidates = [];
    try {
      candidates = vcs.branches().filter((b) => /^origin\/[A-Z][A-Z0-9_]+-\d+$/.test(b.name) && b.name !== `origin/${target.key}`).slice(0, 30);
    } catch (e) {
      warnings.push(`Branches: ${e.message}`);
    }
    for (const b of candidates) {
      try {
        const changed = vcs.changedFiles(b.name, baseRef).filter((f) => !isDoc(f));
        const touching = changed.filter((f) => prefixes.some((p) => f.startsWith(p)));
        if (touching.length) otherFixBranches.push({ branch: b.name, key: b.name.replace(/^origin\//, ''), lastCommit: b.lastCommit, author: b.author, files: touching.slice(0, 8) });
      } catch {
        /* a branch that cannot be compared (unrelated history): skipped */
      }
    }
  }

  const docs = listDocs(repo, cfg.docsPath);
  const docHits = [];
  if (docs.length) {
    for (const term of [...keys, ...strong]) {
      for (const h of vcs.grep(term, { only: cfg.docsPath, filesOnly: true })) {
        const hit = docHits.find((d) => d.file === h.file) ?? (docHits.push({ file: h.file, matched: [] }), docHits.at(-1));
        if (!hit.matched.includes(term)) hit.matched.push(term);
      }
    }
  }

  // Knowledge entries about this ticket (K20): an entry of the ticket or a related ticket, or one whose title, symptom
  // and search terms share several words with the ticket. Read from the working tree (the analysis runs on main).
  // Calibrated on LAB-24 and DEM-22 (2026-11-13): without stop words "with", "from" and "request" matched half the
  // knowledge base; an entry now needs 3 words in common and a fifth of its own words.
  const STOPW = new Set('with from that this have when after before into instead there their which while where what were been being does done also only than then them they your will would should could about over under same other such some more most very just like page field value values test tests ticket bug problem issue error'.split(' '));
  const wordsOf = (s) => new Set((String(s ?? '').toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter((w) => !/^\d+$/.test(w) && !STOPW.has(w)));
  const ticketWords = wordsOf(`${target.summary} ${target.description ?? ''}`);
  const knowledgeEntries = [];
  for (const file of docs.filter((f) => !/README\.md$/i.test(f))) {
    let text = '';
    try {
      text = readFileSync(join(repo, file), 'utf8');
    } catch {
      continue;
    }
    for (const e of parseKnowledgeFile(text, file).entries.filter((x) => !x.reference)) {
      const entryWords = wordsOf(`${e.title} ${e.fields.Symptom ?? ''} ${e.fields['Search terms'] ?? ''}`);
      const common = [...entryWords].filter((w) => ticketWords.has(w));
      const relevance = e.key === target.key ? 2 : keyRelevance.get(e.key) ?? 0; // related tickets from 0.3, as known.mjs
      const byWords = common.length >= 3 && common.length / Math.max(1, Math.min(entryWords.size, ticketWords.size)) >= 0.2;
      if (relevance < 0.3 && !byWords) continue;
      knowledgeEntries.push({
        rank: Math.max(relevance, byWords ? common.length / 10 : 0),
        key: e.key, title: e.title, file, anchor: e.anchor, why: relevance >= 0.3 ? (e.key === target.key ? 'entry of this ticket' : `entry of a related ticket (relevance ${relevance})`) : `words in common: ${common.slice(0, 6).join(', ')}`,
        symptom: trimText(e.fields.Symptom ?? '', 300), rootCause: trimText(e.fields['Root cause'] ?? '', 300), fix: trimText(e.fields.Fix ?? '', 300),
      });
    }
  }

  return {
    vcs: vcs.kind,
    repo,
    ...vcs.info(cfg),
    repoConfig: cfg,
    clues: { strong, weak },
    components: ranked.slice(0, 5).map(presentComponent),
    grepHits: grepHits.slice(0, 60),
    ticketCommits: keyCommits
      .sort((a, b) => Math.max(...b.keys.map((k) => keyRelevance.get(k))) - Math.max(...a.keys.map((k) => keyRelevance.get(k))) || Date.parse(b.date) - Date.parse(a.date))
      .slice(0, 8)
      .map((c) => presentCommit(c, c.keys.includes(target.key) ? 250 : 80)),
    suspectCommits: suspects.slice(0, 5).map((c) => presentCommit(c, 150, topPaths)),
    branchesForTicket: branches,
    knowledgeDocs: { path: cfg.docsPath, files: docs, hits: docHits, entries: knowledgeEntries.sort((a, b) => b.rank - a.rank).slice(0, 6).map(({ rank, ...e }) => e) },
    otherFixBranches,
    warnings,
  };
}
