// Minimal Jira client for the agent: search new tickets, add/remove labels, post comments.
// Credentials come from the analyze-ticket .env (same as the skill).

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SKILL = [join(homedir(), '.claude', 'skills', 'analyze-ticket'), join(process.cwd(), '.claude', 'skills', 'analyze-ticket')].find((p) => existsSync(p));
const { loadConfig } = await import(new URL(`file:///${join(SKILL, 'scripts', 'lib', 'config.mjs').replace(/\\/g, '/')}`));

export function createJira() {
  const cfg = loadConfig();
  if (cfg.mock || !cfg.baseUrl) throw new Error('The agent needs a real Jira: set JIRA_MOCK=0 and JIRA_BASE_URL in the analyze-ticket .env');
  const auth = process.env.JIRA_PAT
    ? `Bearer ${process.env.JIRA_PAT}`
    : `Basic ${Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64')}`;

  async function api(method, path, body) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(cfg.baseUrl + path, {
        method,
        headers: { Authorization: auth, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await new Promise((r) => setTimeout(r, (Number(res.headers.get('retry-after')) || 2 ** attempt) * 1000));
        continue;
      }
      const text = await res.text();
      if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
      return text ? JSON.parse(text) : null;
    }
  }

  return {
    baseUrl: cfg.baseUrl,
    browseUrl: (key) => `${cfg.baseUrl}/browse/${key}`,

    async search(jql, max = 20) {
      const page = await api('GET', `/rest/api/2/search/jql?jql=${encodeURIComponent(jql)}&fields=summary,status,priority,labels,created,reporter&maxResults=${max}`);
      return (page.issues ?? []).map((i) => ({
        key: i.key,
        summary: i.fields.summary,
        status: i.fields.status?.name,
        priority: i.fields.priority?.name ?? null,
        labels: i.fields.labels ?? [],
        created: i.fields.created,
        reporter: i.fields.reporter?.displayName ?? null,
      }));
    },

    async labels(key, { add = [], remove = [] }) {
      const update = [...add.map((l) => ({ add: l })), ...remove.map((l) => ({ remove: l }))];
      if (update.length) await api('PUT', `/rest/api/2/issue/${key}`, { update: { labels: update } });
    },

    async getIssue(key) {
      const i = await api('GET', `/rest/api/2/issue/${encodeURIComponent(key)}?fields=summary,description,labels,priority,status`);
      return { key: i.key, summary: i.fields.summary, description: i.fields.description ?? '', labels: i.fields.labels ?? [], priority: i.fields.priority?.name ?? null, status: i.fields.status?.name };
    },

    /** Uploads a file as an attachment; returns its id and download URL. */
    async attach(key, filePath, name) {
      const { readFileSync } = await import('node:fs');
      const form = new FormData();
      form.append('file', new Blob([readFileSync(filePath)], { type: name.endsWith('.png') ? 'image/png' : 'application/octet-stream' }), name);
      const res = await fetch(`${cfg.baseUrl}/rest/api/2/issue/${encodeURIComponent(key)}/attachments`, {
        method: 'POST',
        headers: { Authorization: auth, Accept: 'application/json', 'X-Atlassian-Token': 'no-check' },
        body: form,
      });
      if (!res.ok) throw new Error(`attach ${name} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const [a] = await res.json();
      return { id: a.id, url: a.content, name: a.filename };
    },

    async comment(key, body) {
      const res = await api('POST', `/rest/api/2/issue/${key}/comment`, { body });
      return { id: res.id, url: `${cfg.baseUrl}/browse/${key}?focusedCommentId=${res.id}` };
    },
  };
}
