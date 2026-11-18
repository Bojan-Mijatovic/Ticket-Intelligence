#!/usr/bin/env node
// The morning digest (ROADMAP #3, WF3): what the agent did since the last digest, what came back, what waits for a
// person, and the cost, from its own records; posted to the team's Teams channel. The watcher runs it every working day
// at agent.config.json nightShift.digestAt (policy morningDigest); by hand:
//
//   node agent/digest.mjs            build it and print it (nothing posted, nothing recorded)
//   node agent/digest.mjs --post     build, save state/digests/<date>.md, post to Teams, and start the next period
//   node agent/digest.mjs --hours 48 the period: the last 48 hours instead of since the last digest
//
// Reads: the event log, asks.jsonl of each project, open pull requests (gh), held tickets (Jira), the night's checks
// (state/night/<date>.json). Writes only state/digests/. No AI.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDigest } from './lib/digest.mjs';
import { knowledgeGaps, readAsks } from './lib/gaps.mjs';
import { readEvents } from './lib/git-graph.mjs';
import { createJira } from './lib/jira-actions.mjs';
import { notifyDigest } from './lib/notify.mjs';
import { loadProjects } from './lib/projects.mjs';
import { readResearch, researchOf } from './lib/research.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE = join(HERE, 'state');
const DIGESTS = join(STATE, 'digests');
const args = process.argv.slice(2);
const post = args.includes('--post');
const hours = args.includes('--hours') ? Number(args[args.indexOf('--hours') + 1]) : null;
const readJson = (f, fallback) => {
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return fallback;
  }
};

const jira = createJira(); // also loads the .env (Jira, the Teams webhook)
const policy = readJson(join(HERE, 'policy.json'), { actions: {} });
const all = loadProjects(HERE);
const now = new Date();
const last = readJson(join(DIGESTS, 'last.json'), null);
const from = hours ? new Date(now - hours * 3_600_000).toISOString() : last?.at ?? new Date(now - 24 * 3_600_000).toISOString();
const projects = all.projects.filter((p) => existsSync(p.repoDir));
const KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
const time = (d) => {
  const same = d.toDateString() === now.toDateString();
  return d.toLocaleString('en-GB', same ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', hour: '2-digit', minute: '2-digit' });
};

// Open pull requests: the agent's fixes (branch named after its ticket) and the documentation ones.
const fixPrs = [];
const docsPrs = [];
const after = Number(policy.mergeDocsAfterHours ?? 24);
for (const p of projects) {
  let prs = [];
  try {
    prs = JSON.parse(execFileSync('gh', ['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,url,headRefName,createdAt,labels'], { cwd: p.repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60_000 }));
  } catch {
    continue;
  }
  for (const x of prs) {
    const ageHours = Math.floor((now - Date.parse(x.createdAt)) / 3_600_000);
    if (KEY.test(x.headRefName)) fixPrs.push({ key: x.headRefName, url: x.url, number: x.number, ageHours });
    else if (x.headRefName.startsWith('docs/')) {
      const held = (x.labels ?? []).some((l) => /^(hold|no-auto-merge|do-not-merge)$/i.test(l.name));
      const at = new Date(Date.parse(x.createdAt) + after * 3_600_000);
      docsPrs.push({ key: x.headRefName.match(/^docs\/([A-Z][A-Z0-9_]+-\d+)$/)?.[1] ?? null, number: x.number, url: x.url, mergesAt: policy.actions.mergeDocs === 'auto' && !held ? (at <= now ? 'the next check' : time(at)) : null });
    }
  }
}

// Held tickets, with why (the last hold event of each).
const events = readEvents(STATE);
const held = [];
try {
  const keys = projects.map((p) => p.key).join(', ');
  for (const t of await jira.search(`project in (${keys}) AND labels = ai-held AND statusCategory != Done ORDER BY created ASC`, 30)) {
    const e = [...events].reverse().find((x) => x.key === t.key && x.type === 'system1-held');
    held.push({ key: t.key, why: e?.kind === 'asked' ? `waits for the reporter's answer (asked ${time(new Date(e.at))})` : e?.text?.replace(/^held: /, '') ?? 'held for a person' });
  }
} catch {
  /* Jira unavailable: the digest goes without the held tickets */
}

let askCostUsd = 0;
let gaps = 0;
for (const p of projects) {
  const asks = readAsks(p.stateDir);
  askCostUsd += asks.asks.filter((a) => a.at > from && a.at <= now.toISOString()).reduce((s, a) => s + (a.costUsd ?? 0), 0);
  const researched = readResearch(p.stateDir);
  gaps += knowledgeGaps(asks).filter((g) => !researchOf(g, researched)).length;
}

const night = readJson(join(STATE, 'night', `${readJson(join(STATE, 'night', 'last.json'), {}).night ?? 'none'}.json`), null);
const d = buildDigest({ events, from, to: now.toISOString(), askCostUsd, waiting: { fixPrs, docsPrs, held, gaps }, night: night && night.at > from ? night : null, links: { ticket: (k) => jira.browseUrl(k) } });

if (!post) {
  console.log(d.markdown);
  process.exit(0);
}
mkdirSync(DIGESTS, { recursive: true });
const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; // local, as the watcher's digestDue
writeFileSync(join(DIGESTS, `${date}.md`), d.markdown);
let sent = { channel: 'off' };
if ((policy.actions.morningDigest ?? 'auto') !== 'off') sent = await notifyDigest(d);
writeFileSync(join(DIGESTS, `${date}.json`), JSON.stringify({ ...d, from, at: now.toISOString(), channel: sent.channel, error: sent.error ?? null }, null, 2));
writeFileSync(join(DIGESTS, 'last.json'), JSON.stringify({ at: now.toISOString(), date: date }, null, 2));
console.log(d.markdown);
console.log(`DIGEST ${JSON.stringify({ summary: d.summary, counts: d.counts, channel: sent.channel, error: sent.error ?? null, file: `state/digests/${date}.md` })}`);
