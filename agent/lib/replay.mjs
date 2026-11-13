// Replay on resolved history (AI1b of docs/AUTONOMY_AND_NEXT.md): the analysis of a ticket a person fixed, run again
// as if the ticket had just come in, then compared with the real fix. It answers "how often is the analysis right?"
// with independent cases on day one, where the live accuracy (AI1) has to wait for new tickets.
//
// Nothing of the answer may reach the run:
//   - the code is a clone at the fix's parent with every later commit, branch, tag and remote gone (git log --all
//     cannot find the fix); the knowledge base is as it was then (the ticket's entry came later);
//   - Jira is frozen in a file served by the skill's offline source (JIRA_MOCK_FILE): the ticket as reported (no
//     comments, status, resolution, assignee, links or attachments) and the tickets that existed then (a change on
//     the main line before the fix; without one, a lower number), without comments;
//   - linked projects are left out (their code at that time is not rebuilt).
// What it cannot hide: a headless run with a shell could read other folders on the machine; the prompt keeps it in
// the clone. Git only (SVN history is read from the server, where later revisions are visible).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../../.claude/skills/analyze-ticket/scripts/lib/config.mjs';
import { createJiraSource } from '../../.claude/skills/analyze-ticket/scripts/lib/jira.mjs';
import { codeFiles, compareFiles, priorArtOutcome } from './accuracy.mjs';
import { runAnalysis } from './analyze.mjs';
import { componentOf, personKey } from './insights.mjs';

const num = (key) => Number(String(key).split('-')[1]);
const git = (dir, args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, maxBuffer: 64 * 1024 * 1024 }).trim();

/**
 * Resolved bugs a person fixed: Jira type Bug, a change on the main line, none of it the agent's. Oldest key first.
 * Each with its first fix commit (the replay runs on its parent), the code files it changed and the people.
 */
export function replayCandidates(graph, { docsPath = 'docs/knowledge/' } = {}) {
  const commits = new Map(graph.commits.map((c) => [c.id, c]));
  const changesOf = (t) => t.changes.map((id) => commits.get(id)).filter(Boolean).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const firstChange = new Map(graph.tickets.map((t) => [t.key, changesOf(t)[0]?.date ?? null]));
  // Which tickets existed when `key` came in. Git time is the truth (the demo's Jira dates are all one day, and its
  // numbers are not in time order): a ticket with a change before the fix; without a change, a lower number.
  const knownAt = (key, asOf) => graph.tickets.filter((t) => t.key !== key && (firstChange.get(t.key) ? Date.parse(firstChange.get(t.key)) < Date.parse(asOf) : num(t.key) < num(key))).map((t) => t.key);
  return graph.tickets
    .filter((t) => t.exists && /bug/i.test(t.type ?? '') && t.changes.length)
    .map((t) => {
      const changes = changesOf(t);
      return { key: t.key, changes, known: knownAt(t.key, changes[0]?.date), people: [...new Set([...changes.filter((c) => !c.agent).map((c) => c.author), ...(t.assignee ? [t.assignee] : [])])], actual: codeFiles(changes.flatMap((c) => c.files), docsPath) };
    })
    .filter((c) => c.changes.length && c.changes.every((x) => !x.agent) && c.actual.length)
    .sort((a, b) => num(a.key) - num(b.key));
}

/**
 * A clone of `repoDir` whose only history is `commit` and its ancestors: branch main at `commit`, no remote, no tags,
 * unreachable objects pruned. Throws when the clone still knows a commit that names `key` in its subject's start.
 */
export function frozenClone({ repoDir, commit, dir, key }) {
  rmSync(dir, { recursive: true, force: true });
  execFileSync('git', ['clone', '-q', '--no-checkout', '--no-hardlinks', repoDir, dir], { stdio: 'ignore', windowsHide: true });
  git(dir, ['checkout', '-q', '-B', 'main', commit]);
  git(dir, ['remote', 'remove', 'origin']);
  for (const ref of git(dir, ['for-each-ref', '--format=%(refname)']).split('\n').filter((r) => r && r !== 'refs/heads/main')) git(dir, ['update-ref', '-d', ref]);
  git(dir, ['reflog', 'expire', '--expire=now', '--all']);
  git(dir, ['gc', '-q', '--prune=now']);
  const leak = git(dir, ['log', '--all', '--format=%s']).split('\n').find((s) => new RegExp(`^\\[?${key}\\b`, 'i').test(s));
  if (leak) throw new Error(`the frozen clone still has the fix of ${key}: "${leak}"`);
  return dir;
}

/** The ticket as it was reported: what the reporter wrote, nothing that came after. */
export function asReported(issue, asOf) {
  return { ...issue, status: 'Open', statusCategory: 'new', resolution: null, resolutionDate: null, assignee: null, links: [], attachments: [], comments: [], worklogs: [], changelog: [], created: asOf, updated: asOf };
}

/** An older ticket as the run may see it: without comments (they can mention later tickets) and links to newer ones. */
export function olderTicket(issue, known) {
  return { ...issue, comments: [], worklogs: [], changelog: [], attachments: [], links: (issue.links ?? []).filter((l) => known.has(l.key)) };
}

/** Writes the frozen Jira of `key` (skill offline-source format) to `file`, from the live Jira: it and `known` only. */
export async function frozenJira({ key, project, asOf, known, file }) {
  const cfg = { ...loadConfig(), mock: false, maxCandidates: 2000 };
  const jira = createJiraSource(cfg);
  const warnings = [];
  const target = await jira.getIssue(key, warnings);
  const knownSet = new Set(known);
  const others = (await jira.runQuery({ kind: 'all', jql: `project = ${project} ORDER BY key ASC` })).filter((i) => knownSet.has(i.key));
  writeFileSync(file, JSON.stringify({ _note: `Jira as it was when ${key} came in (replay, AI1b)`, baseUrl: cfg.baseUrl, issues: [asReported(target, asOf), ...others.map((i) => olderTicket(i, knownSet))] }, null, 2));
  return { tickets: others.length + 1 };
}

/** The replayed analysis compared with the real fix. */
export function compareReplay({ candidate, result, rules = [] }) {
  const predicted = codeFiles(result.files ?? []);
  const files = { predicted, actual: candidate.actual, ...compareFiles(predicted, candidate.actual) };
  const comps = (fs) => new Set(fs.map((f) => componentOf(f, rules)).filter(Boolean));
  const [pc, ac] = [comps(predicted), comps(candidate.actual)];
  const owner = result.owner?.name ?? null;
  const proposed = owner && !/unassigned|unknown|triage|team lead|n\/a/i.test(owner);
  const kind = result.priorArt?.kind ?? 'none';
  return {
    key: candidate.key,
    fix: candidate.changes.map((c) => c.short),
    confidence: result.confidence ?? null,
    files,
    componentHit: pc.size && ac.size ? [...pc].some((c) => ac.has(c)) : null,
    component: [...ac][0] ?? null,
    owner,
    actualOwners: candidate.people,
    ownerHit: proposed ? candidate.people.some((p) => personKey(p) === personKey(owner)) : null,
    priorArt: kind,
    priorArtOutcome: priorArtOutcome(kind, { ownChange: true }),
  };
}

/**
 * Replays one candidate: frozen clone + frozen Jira + the agent's own analysis, in `workRoot`. Returns the compared
 * row with the run's meta; the row is also saved in <stateDir>/replay/<KEY>.json.
 */
export async function replayOne({ candidate, project, cfg, workRoot, stateDir, onProgress = () => {} }) {
  const fix = candidate.changes[0];
  const dir = join(workRoot, candidate.key);
  mkdirSync(dir, { recursive: true });
  const repo = join(dir, 'repo');
  onProgress(`${candidate.key}: code at ${fix.short}^ (before the fix)`);
  frozenClone({ repoDir: project.repoDir, commit: `${fix.id}^`, dir: repo, key: candidate.key });
  const jiraFile = join(dir, 'jira.json');
  const asOf = fix.date; // the report came before the fix; the demo's Jira dates are all the seeding day
  const { tickets } = await frozenJira({ key: candidate.key, project: project.key, asOf, known: candidate.known, file: jiraFile });
  onProgress(`${candidate.key}: Jira frozen (${tickets} tickets: it and the older ones); analysing`);
  const out = await runAnalysis({ key: candidate.key, repoDir: repo, stateDir: dir, cfg, project: { key: project.key, name: project.name }, env: { JIRA_MOCK: '1', JIRA_MOCK_FILE: jiraFile }, onProgress: (s) => onProgress(`${candidate.key}: ${s}`) });
  const row = { ...compareReplay({ candidate, result: out.result, rules: cfg.insights?.components ?? [] }), at: new Date().toISOString(), meta: { costUsd: out.meta.costUsd, durationMs: out.meta.durationMs, model: out.meta.model ?? null } };
  mkdirSync(join(stateDir, 'replay'), { recursive: true });
  writeFileSync(join(stateDir, 'replay', `${candidate.key}.json`), JSON.stringify({ ...row, result: out.result }, null, 2));
  rmSync(repo, { recursive: true, force: true }); // the clone is only needed during the run
  return row;
}

/** The saved replays of a project (<stateDir>/replay/*.json), newest per ticket. */
export function readReplays(stateDir) {
  const dir = join(stateDir, 'replay');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^[A-Z][A-Z0-9_]+-\d+\.json$/.test(f)).map((f) => {
    try {
      const { result: _r, ...row } = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      return row;
    } catch {
      return null;
    }
  }).filter(Boolean).sort((a, b) => num(a.key) - num(b.key));
}
