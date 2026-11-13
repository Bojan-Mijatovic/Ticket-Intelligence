#!/usr/bin/env node
// Ticket Intelligence CLI — data collection for the /analyze-ticket skill.
// Read-only except `comment ... --yes`. Prints JSON (or writes it with --out <file>, UTF-8).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './lib/config.mjs';
import { createJiraSource, buildCandidateQueries } from './lib/jira.mjs';
import { createMockSource } from './lib/mock.mjs';
import { keywords, trimText, stem, stemSet, codeClues } from './lib/text.mjs';
import { computeSignals, rankRelated, scorePeople } from './lib/analysis.mjs';
import { codeContext } from './lib/code.mjs';
import { knownProblems } from './lib/known.mjs';
import { openRepo } from './lib/vcs/index.mjs';

const USAGE = `Usage: node ticket.mjs <command> [args]

  analyze <KEY | URL> ["title"] | "title" [--env <environment>] [--max-related N] [--out file.json]
      The optional title is checked against the ticket's summary; if the key is not found, the title is searched.
      When run inside a git repo or SVN working copy (or with --repo <path>), adds code context: likely components, who changed
      them, commits referencing the ticket/related tickets, suspect changes before the ticket, knowledge docs.
      --no-code skips it. --attachments-dir <dir> downloads the ticket's screenshots there.
      Full bundle: ticket + signals + related tickets + ranked people with evidence.
  fetch <KEY> [--out file.json]          One ticket with comments, worklog and changelog.
  resolve "<title text>"                 Find candidate tickets by title.
  comment <KEY> --file <body.txt> [--yes]
      Post an internal comment. Without --yes it is a dry run that only prints what would be posted.
  check                                  Test the connection and credentials.
  recent [N]                             The N most recently updated tickets (default 10).
  inspect <KEY>                        Every non-empty field of one ticket (id, name, value) —
                                         use it to find which field holds the customer environment.
  fields [filter]                        List Jira fields (to find the environment custom field id).

Config: .claude/skills/analyze-ticket/config.json; secrets in .env (see .env.example). JIRA_MOCK=1 uses demo data.`;

function parseArgs(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) opts[a.slice(2)] = true;
      else {
        opts[a.slice(2)] = next;
        i++;
      }
    } else pos.push(a);
  }
  return { pos, opts };
}

export function parseTicketRef(input) {
  const s = String(input ?? '').trim();
  const m =
    s.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/i) ??
    s.match(/[?&](?:selectedIssue|issueKey)=([A-Z][A-Z0-9_]+-\d+)/i) ??
    s.match(/^([A-Z][A-Z0-9_]+-\d+)$/i) ??
    s.match(/\b([A-Z][A-Z0-9_]+-\d+)\b/);
  return m ? m[1].toUpperCase() : null;
}

// Splits `PROJ-123 "Some title"` (or a URL plus a title, in any order) into { key, title }.
export function splitRef(input) {
  const s = String(input ?? '').trim();
  let key = null;
  let title = s;
  const url = s.match(/https?:\/\/\S+/);
  if (url && parseTicketRef(url[0])) {
    key = parseTicketRef(url[0]);
    title = s.replace(url[0], ' ');
  } else {
    const m = s.match(/^([A-Z][A-Z0-9_]+-\d+)\b/i) ?? s.match(/\b([A-Z][A-Z0-9_]+-\d+)\b/);
    if (m) {
      key = m[1].toUpperCase();
      title = s.replace(m[0], ' ');
    }
  }
  title = title.replace(/^[\s"'“”„:–-]+|[\s"'“”„:–-]+$/g, '').trim();
  return { key, title: title || null };
}

function checkTitle(given, actual) {
  const words = keywords(given, { max: 10 });
  const have = stemSet(actual);
  const hits = words.filter((w) => have.has(stem(w)));
  const match = words.length ? Math.round((hits.length / words.length) * 100) / 100 : 1;
  return { given, actual, match, matches: words.length < 2 || match >= 0.34 };
}

// "[FE] - Agenda: Search mask: Struttura field: the button doesn't work"
//   → { tags: ['FE'], path: ['Agenda', 'Search mask', 'Struttura field', "the button doesn't work"] }
export function parseTitle(summary) {
  const tags = [...String(summary).matchAll(/\[([^\]]{1,20})\]/g)].map((m) => m[1].trim());
  const rest = String(summary).replace(/\[[^\]]*\]/g, '').replace(/^[\s\-–:|]+/, '');
  const path = rest.split(/\s*[:>›|]\s+/).map((s) => s.trim()).filter(Boolean);
  return { tags, path };
}

const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

// Saves the ticket's image attachments (screenshots) so Claude can look at them.
async function downloadImages(source, issue, dir, warnings) {
  const list = issue.attachments.map(({ id, filename, mimeType, size, created, author }) => ({ id, filename, mimeType, size, created, author, localPath: null }));
  if (typeof dir !== 'string') return list;
  mkdirSync(dir, { recursive: true });
  const images = issue.attachments.filter((a) => /^image\//.test(a.mimeType ?? '') && (a.size ?? 0) <= IMAGE_MAX_BYTES).slice(0, 8);
  for (const att of images) {
    try {
      const file = join(dir, `${issue.key}-${att.id}-${att.filename.replace(/[^\w.\-]+/g, '_')}`);
      writeFileSync(file, await source.downloadAttachment(att));
      list.find((a) => a.id === att.id).localPath = file;
    } catch (e) {
      warnings.push(`Attachment ${att.filename}: ${e.message}`);
    }
  }
  return list;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const light = (i) => ({ key: i.key, url: i.url, summary: i.summary, status: i.status, resolution: i.resolution, environments: i.environments, assignee: i.assignee?.name ?? null, updated: i.updated });

function presentTarget(t) {
  return {
    ...t,
    description: trimText(t.description, 8000),
    comments: t.comments.slice(-50).map((c) => ({ ...c, author: c.author?.name, body: trimText(c.body, 3000) })),
    worklogs: t.worklogs.map((w) => ({ author: w.author?.name, started: w.started, hours: Math.round((w.seconds / 3600) * 10) / 10, comment: trimText(w.comment, 300) })),
    changelog: t.changelog.slice(-60).map((h) => ({ ...h, author: h.author?.name })),
    reporter: t.reporter?.name ?? null,
    assignee: t.assignee?.name ?? null,
  };
}

function presentRelated(r) {
  const i = r.issue;
  return {
    key: i.key,
    url: i.url,
    summary: i.summary,
    status: i.status,
    resolution: i.resolution,
    resolutionDate: i.resolutionDate,
    created: i.created,
    environments: i.environments,
    assignee: i.assignee?.name ?? null,
    relevance: r.relevance,
    sameEnvironment: r.sameEnvironment,
    matchedKeywords: r.matchedKeywords,
    linked: r.linked,
    description: trimText(i.description, 600),
    lastComments: i.comments.slice(-3).map((c) => ({ author: c.author?.name, created: c.created, body: trimText(c.body, 700) })),
  };
}

async function resolveTitle(source, title) {
  const words = keywords(title, { max: 6 });
  if (!words.length) return [];
  return (await source.searchTitle(words)).slice(0, 8).map(light);
}

async function analyze(source, cfg, ref, opts) {
  const warnings = [];
  const split = splitRef(ref);
  const key = split.key;
  const title = typeof opts.title === 'string' ? opts.title : split.title;
  const selection = async (reason) => ({
    source: source.kind,
    needsSelection: true,
    input: ref,
    reason,
    candidates: title ? await resolveTitle(source, title) : [],
    hint: 'Ask the user which candidate they mean, then rerun analyze with that key.',
  });
  if (!key) return selection('No ticket key in the input; searched by title.');

  let target;
  try {
    target = await source.getIssue(key, warnings);
  } catch (e) {
    if (e.status === 404 && title) return selection(`${key} was not found (or is not visible to this account); searched by title instead.`);
    throw e;
  }
  const titleCheck = title ? checkTitle(title, target.summary) : null;
  if (titleCheck && !titleCheck.matches) {
    warnings.push(`The given title does not match ${key}'s summary ("${target.summary}"). The key may be wrong — confirm with the user.`);
  }
  const envOverride = typeof opts.env === 'string' ? opts.env : null;
  const envs = target.environments;
  if (!envs.length && !envOverride) {
    warnings.push(`Environment field "${cfg.environmentField}" is empty on ${key}; related tickets were found by text only. If the environment can be read from the description, rerun with --env "<name>".`);
  }
  const exclude = [...envs, envOverride ?? ''];
  let kws = keywords(target.summary, { exclude });
  if (kws.length < 3) kws = [...new Set([...kws, ...keywords(target.description, { exclude })])].slice(0, 6);
  const clues = codeClues(`${target.summary}\n${target.description}`, { exclude: [...exclude, target.project] })
    .filter((c) => c.length <= 40 && !kws.includes(c.toLowerCase()))
    .slice(0, 6);

  const attachments = await downloadImages(source, target, opts['attachments-dir'], warnings);

  const ctx = { target, envs, envOverride, keywords: kws, clues };
  const queries = buildCandidateQueries(cfg, ctx);
  const candidates = [];
  for (const q of queries) {
    try {
      candidates.push(...(await source.runQuery(q, ctx)));
    } catch (e) {
      warnings.push(`Query "${q.kind}" failed: ${e.message}`);
    }
  }

  const maxRelated = Number(opts['max-related']) || cfg.maxRelated;
  const ranked = rankRelated(target, candidates, ctx).slice(0, maxRelated);
  const related = await mapLimit(ranked, 4, async (r) => {
    try {
      return { ...r, issue: await source.getIssue(r.issue.key, warnings) };
    } catch (e) {
      warnings.push(`Could not load details of ${r.issue.key}: ${e.message}`);
      return r;
    }
  });

  let code = null;
  if (!opts['no-code']) {
    let vcs = null;
    try {
      vcs = openRepo(typeof opts.repo === 'string' ? opts.repo : process.cwd());
    } catch (e) {
      warnings.push(`Code analysis skipped: ${e.message}`);
    }
    if (!vcs) {
      if (!warnings.some((w) => w.startsWith('Code analysis skipped'))) {
        warnings.push('Not inside a git repository or SVN working copy, so code analysis was skipped. Run from the project folder or pass --repo <path>.');
      }
    } else {
      try {
        code = codeContext({
          vcs,
          target,
          related: related.map((r) => ({ key: r.issue.key, relevance: r.relevance })),
          envs: [...envs, envOverride].filter(Boolean),
        });
      } catch (e) {
        warnings.push(`Code analysis failed: ${e.message}`);
      }
    }
  }

  return {
    source: source.kind,
    generatedAt: new Date().toISOString(),
    titleCheck,
    titleInfo: parseTitle(target.summary),
    clues,
    attachments,
    code,
    target: presentTarget(target),
    signals: computeSignals(target, cfg),
    environment: { field: cfg.environmentField, values: envs, override: envOverride },
    keywords: kws,
    queries: queries.map(({ kind, jql }) => ({ kind, jql })),
    candidatesConsidered: new Set(candidates.map((c) => c.key)).size,
    related: related.map(presentRelated),
    // Already known? (K20): the evidence in one place; the analysis decides the kind (SKILL.md step "Already known?").
    priorArt: knownProblems({ target, related: related.map(presentRelated), code }),
    people: scorePeople(target, related, cfg),
    warnings,
  };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opts } = parseArgs(rest);
  if (!cmd || cmd === 'help' || opts.help) {
    console.log(USAGE);
    return;
  }

  const cfg = loadConfig();
  const source = cfg.mock ? createMockSource(cfg) : createJiraSource(cfg);
  let result;

  switch (cmd) {
    case 'analyze':
      if (!pos.length) throw new Error('analyze needs a ticket key, URL or title');
      result = await analyze(source, cfg, pos.join(' '), opts);
      break;
    case 'fetch': {
      const key = parseTicketRef(pos[0]);
      if (!key) throw new Error('fetch needs a ticket key or URL');
      const warnings = [];
      const issue = await source.getIssue(key, warnings);
      result = { source: source.kind, issue: presentTarget(issue), signals: computeSignals(issue, cfg), warnings };
      break;
    }
    case 'resolve':
      result = { source: source.kind, candidates: await resolveTitle(source, pos.join(' ')) };
      break;
    case 'comment': {
      const key = parseTicketRef(pos[0]);
      if (!key || typeof opts.file !== 'string') throw new Error('usage: comment <KEY> --file <body.txt> [--yes]');
      const body = readFileSync(opts.file, 'utf8').trim();
      if (!body) throw new Error('comment body is empty');
      result = opts.yes
        ? { source: source.kind, posted: true, key, ...(await source.addComment(key, body)) }
        : { source: source.kind, dryRun: true, key, body, hint: 'Nothing posted. Rerun with --yes only after the user approved this exact text.' };
      break;
    }
    case 'check':
      result = { source: source.kind, config: { baseUrl: cfg.baseUrl, deployment: cfg.deployment, environmentField: cfg.environmentField }, ...(await source.check()) };
      break;
    case 'recent':
      result = { source: source.kind, tickets: (await source.recent(Number(pos[0]) || 10)).map(light) };
      break;
    case 'inspect': {
      const key = parseTicketRef(pos[0]);
      if (!key) throw new Error('inspect needs a ticket key or URL');
      result = {
        source: source.kind,
        key,
        currentEnvironmentField: cfg.environmentField,
        fields: await source.inspectIssue(key),
        hint: 'Find the field whose value names the customer environment (e.g. "acme-prod") and put its id into config.json "environmentField".',
      };
      break;
    }
    case 'fields':
      result = { fields: await source.listFields(pos[0]) };
      break;
    default:
      throw new Error(`Unknown command "${cmd}".\n\n${USAGE}`);
  }

  const json = JSON.stringify(result, null, 2);
  if (typeof opts.out === 'string') {
    writeFileSync(opts.out, json, 'utf8');
    console.log(JSON.stringify({ written: opts.out, bytes: Buffer.byteLength(json) }));
  } else {
    console.log(json);
  }
}

main().catch((e) => {
  const hint =
    e.status === 401 ? 'Credentials rejected — check JIRA_EMAIL/JIRA_API_TOKEN or JIRA_PAT.'
    : e.status === 403 ? 'No permission for this resource with these credentials.'
    : e.status === 404 ? 'Not found — check the ticket key, JIRA_BASE_URL and JIRA_DEPLOYMENT (cloud vs server).'
    : e.status === 400 ? 'Jira rejected the request — often a JQL problem (e.g. wrong environmentField / environmentMatch in config.json).'
    : undefined;
  console.error(JSON.stringify({ error: e.message, ...(hint ? { hint } : {}) }, null, 2));
  process.exit(1);
});
