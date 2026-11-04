// Jira REST client (API v2 — works on both Cloud and Server/Data Center and returns plain-text bodies)
// plus normalization into the shape the analysis code expects.

const ISSUE_FIELDS = [
  'summary', 'description', 'status', 'priority', 'issuetype', 'resolution', 'resolutiondate',
  'created', 'updated', 'reporter', 'assignee', 'components', 'labels', 'issuelinks', 'project', 'attachment',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- JQL ----------

export function quoteJql(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function envClause(cfg, value) {
  const f = cfg.environmentField;
  const mode = cfg.environmentMatch === 'auto' ? (f === 'environment' ? 'text' : 'exact') : cfg.environmentMatch;
  const field =
    f === 'components' ? 'component'
    : f === 'labels' ? 'labels'
    : f.startsWith('customfield_') ? `cf[${f.slice('customfield_'.length)}]`
    : f;
  return `${field} ${mode === 'text' ? '~' : '='} ${quoteJql(value)}`;
}

export function buildCandidateQueries(cfg, { target, envs, envOverride, keywords, clues = [] }) {
  const projects = [...new Set([target.project, ...cfg.projects])].filter(Boolean);
  const base = `project in (${projects.map(quoteJql).join(', ')}) AND key != ${target.key} AND updated >= -${cfg.lookbackDays}d`;
  const queries = [];

  // Field values are real options, so they can be matched exactly; an inferred --env value is matched as text,
  // because an "=" against a non-existent select option makes Jira reject the whole query.
  const envParts = envs.map((v) => envClause(cfg, v));
  if (envOverride) envParts.push(`text ~ ${quoteJql(envOverride)}`);
  if (envParts.length) {
    queries.push({ kind: 'environment', jql: `${base} AND (${envParts.join(' OR ')}) ORDER BY updated DESC` });
  }
  if (keywords.length) {
    const kw = keywords.map((k) => `text ~ ${quoteJql(k)}`).join(' OR ');
    queries.push({ kind: 'text', jql: `${base} AND (${kw}) ORDER BY updated DESC` });
  }
  // Specific terms from the description (button names, service and field names) find the tickets
  // the description refers to, e.g. "as we did on the US for the 'PULISCI' button".
  if (clues.length) {
    const cl = clues.map((k) => `text ~ ${quoteJql(k)}`).join(' OR ');
    queries.push({ kind: 'clues', jql: `${base} AND (${cl}) ORDER BY updated DESC` });
  }
  const linked = target.links.map((l) => l.key);
  if (linked.length) queries.push({ kind: 'linked', jql: `key in (${linked.join(', ')})`, keys: linked });
  return queries;
}

export function buildTitleQuery(cfg, words) {
  const scope = cfg.projects.length ? `project in (${cfg.projects.map(quoteJql).join(', ')}) AND ` : '';
  const kw = words.map((k) => `summary ~ ${quoteJql(k)}`).join(' OR ');
  return `${scope}updated >= -${cfg.lookbackDays}d AND (${kw}) ORDER BY updated DESC`;
}

// ---------- normalization ----------

function user(u) {
  if (!u) return null;
  return { id: u.accountId ?? u.key ?? u.name ?? u.emailAddress ?? u.displayName, name: u.displayName ?? u.name ?? 'unknown' };
}

function adfToText(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text ?? '';
  const inner = (node.content ?? []).map(adfToText).join('');
  return ['paragraph', 'heading', 'listItem', 'codeBlock', 'blockquote'].includes(node.type) ? `${inner}\n` : inner;
}

function toStrings(v) {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v.flatMap(toStrings);
  if (typeof v === 'object') {
    if (v.type === 'doc') return toStrings(adfToText(v));
    const own = v.value ?? v.name ?? v.displayName ?? v.key;
    return [...toStrings(own), ...toStrings(v.child)];
  }
  const s = String(v).trim();
  return s ? [s] : [];
}

const text = (v) => (typeof v === 'object' && v !== null ? adfToText(v).trim() : String(v ?? ''));
const byDate = (field) => (a, b) => Date.parse(a[field]) - Date.parse(b[field]);

export function normalizeIssue(raw, cfg, extras = {}) {
  const f = raw.fields ?? {};
  return {
    key: raw.key,
    url: `${cfg.baseUrl}/browse/${raw.key}`,
    project: f.project?.key ?? raw.key.split('-')[0],
    summary: f.summary ?? '',
    description: text(f.description),
    status: f.status?.name ?? null,
    statusCategory: f.status?.statusCategory?.key ?? null,
    priority: f.priority?.name ?? null,
    issueType: f.issuetype?.name ?? null,
    resolution: f.resolution?.name ?? null,
    resolutionDate: f.resolutiondate ?? null,
    created: f.created ?? null,
    updated: f.updated ?? null,
    environments: toStrings(f[cfg.environmentField]),
    components: (f.components ?? []).map((c) => c.name),
    labels: f.labels ?? [],
    reporter: user(f.reporter),
    assignee: user(f.assignee),
    links: (f.issuelinks ?? [])
      .map((l) => {
        const o = l.outwardIssue ?? l.inwardIssue;
        if (!o) return null;
        return { key: o.key, relation: l.outwardIssue ? l.type?.outward : l.type?.inward, summary: o.fields?.summary, status: o.fields?.status?.name };
      })
      .filter(Boolean),
    attachments: (f.attachment ?? []).map((a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      created: a.created,
      author: user(a.author)?.name ?? null,
      url: a.content,
    })),
    comments: (extras.comments ?? []).map((c) => ({ author: user(c.author), created: c.created, body: text(c.body) })).sort(byDate('created')),
    worklogs: (extras.worklogs ?? []).map((w) => ({ author: user(w.author), started: w.started, seconds: w.timeSpentSeconds ?? 0, comment: text(w.comment) })).sort(byDate('started')),
    changelog: (extras.histories ?? [])
      .map((h) => ({
        author: user(h.author),
        created: h.created,
        // `toString` must be read as an own property — every object inherits a toString() function.
        items: (h.items ?? []).map((i) => ({
          field: i.field,
          from: i.fromString ?? i.from ?? null,
          to: (Object.hasOwn(i, 'toString') ? i.toString : null) ?? i.to ?? null,
        })),
      }))
      .sort(byDate('created')),
  };
}

// ---------- client ----------

function authHeader() {
  const { JIRA_PAT, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
  if (JIRA_PAT) return `Bearer ${JIRA_PAT}`;
  if (JIRA_EMAIL && JIRA_API_TOKEN) return `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64')}`;
  throw new Error('No Jira credentials. Set JIRA_EMAIL + JIRA_API_TOKEN (Cloud) or JIRA_PAT (Server/Data Center) in .env');
}

export function createJiraSource(cfg) {
  if (!cfg.baseUrl) throw new Error('JIRA_BASE_URL is not set (or set JIRA_MOCK=1 to use the demo data).');
  const auth = authHeader();
  const cloud = cfg.deployment === 'cloud';
  const fields = [...new Set([...ISSUE_FIELDS, cfg.environmentField])].join(',');

  async function api(method, path, { params, body } = {}) {
    const url = new URL(cfg.baseUrl + path);
    for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        method,
        headers: { Authorization: auth, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if ((res.status === 429 || res.status === 503) && attempt < 3) {
        await sleep((Number(res.headers.get('retry-after')) || 2 ** attempt) * 1000);
        continue;
      }
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        const err = new Error(`${method} ${path} -> ${res.status} ${res.statusText}: ${t.slice(0, 300)}`);
        err.status = res.status;
        throw err;
      }
      return res.status === 204 ? null : res.json();
    }
  }

  async function paginate(path, listKey) {
    const out = [];
    let startAt = 0;
    for (;;) {
      const page = await api('GET', path, { params: { startAt, maxResults: 100 } });
      const items = page[listKey] ?? [];
      out.push(...items);
      startAt += items.length;
      if (!items.length || page.isLast === true || startAt >= (page.total ?? out.length)) break;
    }
    return out;
  }

  const optional = async (p, label, warnings) => {
    try {
      return await p;
    } catch (e) {
      warnings?.push(`${label} unavailable: ${e.message}`);
      return [];
    }
  };

  async function search(jql, max) {
    const out = [];
    if (cloud) {
      let nextPageToken;
      do {
        const page = await api('GET', '/rest/api/2/search/jql', { params: { jql, fields, maxResults: Math.min(100, max - out.length), nextPageToken } });
        out.push(...(page.issues ?? []));
        nextPageToken = page.nextPageToken;
      } while (nextPageToken && out.length < max);
    } else {
      let startAt = 0;
      for (;;) {
        const page = await api('GET', '/rest/api/2/search', { params: { jql, fields, startAt, maxResults: Math.min(100, max - out.length) } });
        const items = page.issues ?? [];
        out.push(...items);
        startAt += items.length;
        if (!items.length || startAt >= page.total || out.length >= max) break;
      }
    }
    return out.slice(0, max).map((r) => normalizeIssue(r, cfg));
  }

  return {
    kind: 'jira',
    async getIssue(key, warnings) {
      const k = encodeURIComponent(key);
      const raw = await api('GET', `/rest/api/2/issue/${k}`, { params: { fields, expand: 'changelog' } });
      let histories = raw.changelog?.histories ?? [];
      if (cloud && raw.changelog && raw.changelog.total > histories.length) {
        histories = await optional(paginate(`/rest/api/2/issue/${k}/changelog`, 'values'), `Full changelog of ${key}`, warnings);
      }
      const [comments, worklogs] = await Promise.all([
        optional(paginate(`/rest/api/2/issue/${k}/comment`, 'comments'), `Comments of ${key}`, warnings),
        optional(paginate(`/rest/api/2/issue/${k}/worklog`, 'worklogs'), `Worklog of ${key}`, warnings),
      ]);
      return normalizeIssue(raw, cfg, { histories, comments, worklogs });
    },
    runQuery: (q) => search(q.jql, cfg.maxCandidates),
    searchTitle: (words) => search(buildTitleQuery(cfg, words), 20),
    recent: (n) => {
      const scope = cfg.projects.length ? `project in (${cfg.projects.map(quoteJql).join(', ')}) AND ` : '';
      return search(`${scope}updated >= -30d ORDER BY updated DESC`, n);
    },
    // Jira Cloud redirects attachment downloads to a signed media URL; fetch follows it.
    async downloadAttachment(att) {
      const res = await fetch(att.url, { headers: { Authorization: auth } });
      if (!res.ok) throw new Error(`download ${att.filename} -> ${res.status} ${res.statusText}`);
      return Buffer.from(await res.arrayBuffer());
    },
    async addComment(key, body) {
      const res = await api('POST', `/rest/api/2/issue/${encodeURIComponent(key)}/comment`, { body: { body } });
      return { id: res.id, url: `${cfg.baseUrl}/browse/${key}?focusedCommentId=${res.id}` };
    },
    async check() {
      const [me, info] = await Promise.all([api('GET', '/rest/api/2/myself'), api('GET', '/rest/api/2/serverInfo')]);
      return { ok: true, user: me.displayName, server: info.serverTitle, version: info.version, deploymentType: info.deploymentType };
    },
    async inspectIssue(key) {
      const raw = await api('GET', `/rest/api/2/issue/${encodeURIComponent(key)}`, { params: { expand: 'names' } });
      const names = raw.names ?? {};
      const skip = new Set(['description', 'comment', 'worklog', 'attachment', 'issuelinks', 'subtasks', 'watches', 'votes', 'timetracking', 'progress', 'aggregateprogress', 'lastViewed', 'thumbnail']);
      return Object.entries(raw.fields ?? {})
        .filter(([id]) => !skip.has(id))
        .map(([id, v]) => ({ id, name: names[id] ?? id, value: toStrings(v).join(', ').slice(0, 150) }))
        .filter((f) => f.value);
    },
    async listFields(filter) {
      const all = await api('GET', '/rest/api/2/field');
      const re = filter ? new RegExp(filter, 'i') : null;
      return all
        .filter((f) => !re || re.test(f.name) || re.test(f.id))
        .map((f) => ({ id: f.id, name: f.name, custom: f.custom, type: f.schema?.custom ?? f.schema?.type ?? null }));
    },
  };
}
