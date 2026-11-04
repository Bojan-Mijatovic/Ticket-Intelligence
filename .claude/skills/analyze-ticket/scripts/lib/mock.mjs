// Offline demo source: serves fixtures/mock-jira.json through the same interface as the Jira client.
// Queries are evaluated structurally (environment / keywords / linked keys) instead of by running JQL.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SKILL_DIR } from './config.mjs';
import { stem, stemSet } from './text.mjs';

export function createMockSource() {
  const data = JSON.parse(readFileSync(join(SKILL_DIR, 'fixtures', 'mock-jira.json'), 'utf8'));
  const hydrate = (i) => ({
    url: `${data.baseUrl}/browse/${i.key}`,
    project: i.key.split('-')[0],
    description: '',
    environments: [],
    components: [],
    labels: [],
    links: [],
    attachments: [],
    comments: [],
    worklogs: [],
    changelog: [],
    resolution: null,
    resolutionDate: null,
    assignee: null,
    ...i,
  });
  const issues = new Map(data.issues.map((i) => [i.key, hydrate(i)]));
  const all = () => [...issues.values()].map((i) => structuredClone(i));
  const textOf = (i) => `${i.summary} ${i.description}`;

  return {
    kind: 'mock',
    async getIssue(key) {
      const i = issues.get(key.toUpperCase());
      if (!i) {
        const err = new Error(`Issue ${key} not found in mock data (available: ${[...issues.keys()].join(', ')})`);
        err.status = 404;
        throw err;
      }
      return structuredClone(i);
    },
    async runQuery(q, ctx) {
      if (q.kind === 'linked') return all().filter((i) => q.keys.includes(i.key));
      const others = all().filter((i) => i.key !== ctx.target.key && i.project === ctx.target.project);
      if (q.kind === 'environment') {
        const envs = new Set(ctx.envs.map((e) => e.toLowerCase()));
        const ov = ctx.envOverride?.toLowerCase();
        return others.filter((i) => i.environments.some((e) => envs.has(e.toLowerCase())) || (ov && textOf(i).toLowerCase().includes(ov)));
      }
      const stems = (q.kind === 'clues' ? ctx.clues : ctx.keywords).map(stem);
      return others.filter((i) => {
        const hay = stemSet(textOf(i));
        return stems.some((s) => hay.has(s));
      });
    },
    async searchTitle(words) {
      const stems = words.map(stem);
      return all()
        .map((i) => ({ i, hits: stems.filter((s) => stemSet(i.summary).has(s)).length }))
        .filter((x) => x.hits > 0)
        .sort((a, b) => b.hits - a.hits)
        .map((x) => x.i);
    },
    async recent(n) {
      return all().sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated)).slice(0, n);
    },
    async downloadAttachment(att) {
      throw new Error(`Mock mode has no attachment content (${att.filename})`);
    },
    async addComment(key) {
      return { id: 'mock-comment', url: `${data.baseUrl}/browse/${key}`, note: 'Mock mode: nothing was posted.' };
    },
    async check() {
      return { ok: true, mock: true, issues: issues.size };
    },
    async inspectIssue(key) {
      const i = await this.getIssue(key);
      return [
        ['summary', 'Summary', i.summary],
        ['status', 'Status', i.status],
        ['priority', 'Priority', i.priority],
        ['environment', 'Environment', i.environments.join(', ')],
        ['components', 'Component/s', i.components.join(', ')],
        ['labels', 'Labels', i.labels.join(', ')],
        ['reporter', 'Reporter', i.reporter?.name],
        ['assignee', 'Assignee', i.assignee?.name],
      ].map(([id, name, value]) => ({ id, name, value })).filter((f) => f.value);
    },
    async listFields() {
      return [{ id: 'environment', name: 'Environment', custom: false, type: 'string', note: 'mock data' }];
    },
  };
}
