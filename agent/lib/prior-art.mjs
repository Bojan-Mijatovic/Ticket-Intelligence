// Prior art (K17 of docs/KNOWLEDGE_PLAN.md): before a new ticket is created, what the project already knows about
// the same problem. Plain code collects the candidates and says why each one is close; a person (and later a small
// model, K18) decides. A source that fails throws: "no prior art" must never mean "could not look".
//
// Candidates:
//   open       an open ticket about the same thing (words, files, component)
//   fixed-by   a resolved ticket whose fix commit, after the item was written, changed the item's files
//   solved     a resolved ticket about the same thing, fixed before (related; maybe a regression)
//   documented a knowledge entry about the same thing (docs/knowledge on main)
//   in-progress an open pull request that changes the item's files

import { execFileSync } from 'node:child_process';
import { parseKnowledgeFile } from './knowledge.mjs';

const STOP = new Set('about after again also and are been before being but can cannot does doesn every for from has have into its more not now one only other over same should since some than that the their them then there these they this those through under when where which while will with without your nella delle degli della sono come dopo prima anche'.split(' '));
const isOpen = (status) => !/done|closed|resolved|chius|risolt/i.test(status ?? '');

/** Significant words of a text: 4+ letters, lower case, no stop words, a light stem (plural / -ed / -ing). */
export function wordsOf(text) {
  const out = new Set();
  for (const w of String(text ?? '').toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []) {
    if (STOP.has(w) || /^\d+$/.test(w)) continue;
    out.add(w.replace(/(ing|ed|es|s)$/, '') || w);
  }
  return out;
}

/** Share of words two texts have in common (Jaccard, 0..1). */
export function alike(a, b) {
  const [A, B] = [a instanceof Set ? a : wordsOf(a), b instanceof Set ? b : wordsOf(b)];
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / (A.size + B.size - both || 1);
}

const base = (p) => String(p).split('/').pop();
const sameFile = (a, b) => a === b || (a.includes('/') && b.includes('/') ? false : base(a) === base(b));
const overlap = (as, bs) => as.filter((a) => bs.some((b) => sameFile(a, b)));

/**
 * The candidates for one item, closest first (at most `max`, score ≥ `min`).
 * @param {object} item     { summary, text, files: string[], component, since: ISO date the item was written }
 * @param {object} sources  what loadPriorArtSources() returns, plus `tickets` (Insights tickets: key, type, status,
 *                          summary, components, commits) and `exclude` (keys not to propose, e.g. the item's own)
 * @returns {{ kind: string, key?: string, pr?: number, title: string, url?: string, score: number, reasons: string[] }[]}
 */
// Words decide; a shared file or component only adds to it. Calibrated on the 61 suggestions of the demo suite
// (2026-11-13): a file alone (OrderService.java, touched by many tickets) made nearly every ticket a candidate.
const MIN_WORDS = 0.12; // below this share of common words a ticket is not about the same thing
const scoreOf = (w, sharedFile, sameComponent) => 0.6 * Math.min(1, w / 0.4) + (sharedFile ? 0.25 : 0) + (sameComponent ? 0.15 : 0);

export function priorArtCandidates(item, { tickets = [], commitInfo = new Map(), entries = [], openPrs = [], analyses = new Map(), exclude = [] }, { max = 5, min = 0.35 } = {}) {
  const words = wordsOf(`${item.summary} ${String(item.text ?? '').slice(0, 600)}`);
  const files = (item.files ?? []).filter(Boolean);
  const since = item.since ? Date.parse(item.since) : null;
  const out = [];

  for (const t of tickets) {
    if (exclude.includes(t.key)) continue;
    const analysis = analyses.get(t.key)?.result;
    const tWords = wordsOf(`${t.summary} ${analysis?.likelyCause ?? ''}`);
    const w = alike(words, tWords);
    const fixes = (t.commits ?? []).map((h) => ({ hash: h, ...(commitInfo.get(h) ?? { date: null, files: [] }) }));
    const touched = [...new Set(fixes.flatMap((c) => c.files))];
    const analysisFiles = (analysis?.files ?? []).map((f) => String(f).replace(/:\d+.*$/, ''));
    const sharedFiles = overlap(files, [...touched, ...analysisFiles]);
    const sameComponent = item.component && (t.components ?? []).includes(item.component);
    const score = scoreOf(w, sharedFiles.length > 0, sameComponent);
    if (w < MIN_WORDS || score < min) continue;
    const reasons = [];
    if (w > 0) reasons.push(`${Math.round(w * 100)}% of the words alike`);
    if (sharedFiles.length) reasons.push(`same file${sharedFiles.length > 1 ? 's' : ''}: ${sharedFiles.map(base).join(', ')}`);
    if (sameComponent) reasons.push(`same component (${item.component})`);
    if (analysis?.likelyCause) reasons.push(`agent's analysis: ${String(analysis.likelyCause).slice(0, 140)}`);
    let kind = isOpen(t.status) ? 'open' : 'solved';
    if (!isOpen(t.status) && since && w >= 0.3) {
      // Fixed after the item was written, in its files, and about the same thing (a shared file alone is not enough:
      // LAB-23's fix touched the file of an unrelated suggestion).
      const after = fixes.filter((c) => c.date && Date.parse(c.date) > since && overlap(files, c.files).length);
      if (after.length) {
        kind = 'fixed-by';
        reasons.unshift(`fixed after the suggestion was written: ${after.map((c) => `${c.hash} (${c.date.slice(0, 10)})`).join(', ')}`);
      }
    }
    out.push({ kind, key: t.key, title: t.summary, status: t.status, score: Math.round(score * 100) / 100, reasons });
  }

  for (const e of entries) {
    if (exclude.includes(e.key) || out.some((c) => c.key === e.key && (c.reasons.push(`documented: ${e.file}#${e.anchor}`), true))) continue;
    const eWords = wordsOf(`${e.title} ${e.fields?.Symptom ?? ''} ${e.fields?.['Search terms'] ?? ''}`);
    const w = alike(words, eWords);
    const cited = String(e.text).match(/[\w@.-]+(?:\/[\w@.-]+)*\.(?:ts|java|scss|html|sql)\b/g) ?? [];
    const sharedFiles = overlap(files, cited);
    const score = scoreOf(w, sharedFiles.length > 0, false);
    if (w >= MIN_WORDS && score >= min) out.push({ kind: 'documented', key: e.key, title: e.title, score: Math.round(score * 100) / 100, reasons: [`${Math.round(w * 100)}% of the words alike`, ...(sharedFiles.length ? [`same file: ${sharedFiles.map(base).join(', ')}`] : []), `documented: ${e.file}#${e.anchor}`] });
  }

  for (const pr of openPrs) {
    const sharedFiles = overlap(files, pr.files ?? []);
    if (!sharedFiles.length) continue;
    const w = alike(words, wordsOf(pr.title));
    const score = scoreOf(w, true, false);
    if (w >= MIN_WORDS && score >= min) out.push({ kind: 'in-progress', pr: pr.number, key: pr.key ?? null, title: pr.title, url: pr.url, score: Math.round(score * 100) / 100, reasons: [`open pull request changes ${sharedFiles.map(base).join(', ')}`, ...(w > 0 ? [`${Math.round(w * 100)}% of the words alike`] : [])] });
  }

  return out.sort((a, b) => b.score - a.score).slice(0, max);
}

/**
 * What the code says without a model (K19 before K18): the verdict a person sees first. Thresholds are deliberately
 * high; anything below them stays "new" with its candidates listed as related.
 */
export function codeVerdict(candidates, { own = null } = {}) {
  // A suggestion already created as a ticket: that ticket's state is the answer (fixed once its fix is in).
  if (own) {
    const fixedOwn = candidates.find((c) => c.key === own.key && c.kind === 'fixed-by');
    return fixedOwn ? { verdict: 'fixed-by', key: own.key } : { verdict: 'ticket-exists', key: own.key };
  }
  const top = (kind, min) => candidates.find((c) => c.kind === kind && c.score >= min);
  const fixed = top('fixed-by', 0.6);
  if (fixed) return { verdict: 'fixed-by', key: fixed.key };
  const open = top('open', 0.75);
  if (open) return { verdict: 'duplicate-of', key: open.key };
  const pr = top('in-progress', 0.6);
  if (pr) return { verdict: 'in-progress', key: pr.key, pr: pr.pr };
  return { verdict: 'new', key: null };
}

/**
 * The sources of a project, read once and shared by every item: commit dates and files, knowledge entries on main,
 * open pull requests with their files, the agent's saved analyses. Throws when git fails; GitHub is optional (no
 * remote, no gh), reported in `notes`.
 */
export function loadPriorArtSources({ repoDir, analyses = new Map() }) {
  const git = (args) => execFileSync('git', args, { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();
  const notes = [];
  const commitInfo = new Map();
  for (const block of git(['log', 'origin/main', '--no-merges', '--date=iso-strict', '--format=%x1e%h %ad', '--name-only']).split('\x1e').filter((b) => b.trim())) {
    const [head, ...files] = block.trim().split('\n');
    const [hash, date] = head.split(' ');
    commitInfo.set(hash.slice(0, 7), { date, files: files.filter(Boolean) });
  }
  const entries = [];
  try {
    for (const file of git(['ls-tree', '-r', '--name-only', 'origin/main', '--', 'docs/knowledge']).split('\n').filter((f) => f.endsWith('.md') && !f.endsWith('README.md'))) {
      entries.push(...parseKnowledgeFile(git(['show', `origin/main:${file}`]), file).entries.filter((e) => !e.reference));
    }
  } catch {
    /* no knowledge base on main */
  }
  let openPrs = [];
  try {
    const slug = git(['remote', 'get-url', 'origin']).match(/github\.com[/:]([^/]+)\/([^/.\s]+)/)?.slice(1, 3).join('/');
    if (slug) {
      openPrs = JSON.parse(execFileSync('gh', ['pr', 'list', '--repo', slug, '--state', 'open', '--limit', '50', '--json', 'number,title,url,headRefName,files'], { encoding: 'utf8', timeout: 30_000 }))
        .map((p) => ({ number: p.number, title: p.title, url: p.url, key: /^[A-Z][A-Z0-9_]+-\d+$/.test(p.headRefName) ? p.headRefName : null, files: (p.files ?? []).map((f) => f.path) }));
    } else notes.push('no GitHub remote: open pull requests were not checked');
  } catch (e) {
    notes.push(`open pull requests were not checked (${String(e.message).split('\n')[0].slice(0, 120)})`);
  }
  return { commitInfo, entries, openPrs, analyses, notes };
}
