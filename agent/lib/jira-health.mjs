// Is Jira usable? (K16 of docs/KNOWLEDGE_PLAN.md)
//
// Jira Cloud answers a search by a client whose credentials it rejects with an empty list, not with an error. On
// 2026-11-12 an expired API token looked like four empty projects: the watcher picked nothing, Insights offered every
// suggested ticket as new, Ask said "not in the knowledge base", and nothing on the dashboard said why.
// So the agent checks the credentials (myself) and that every watched project is visible before it trusts a search,
// and the work that needs Jira waits while it is not.

const OK_TTL_MS = 5 * 60_000;

/** A short reason for a failed Jira call that says what to do. */
export function describeJiraError(e, project = null) {
  const s = e?.jiraStatus;
  if (s === 401) return 'credentials rejected (401): renew JIRA_API_TOKEN (or JIRA_PAT) in ~/.claude/skills/analyze-ticket/.env, then restart the watcher';
  if (s === 403) return `no permission (403)${project ? ` for project ${project}` : ''}`;
  if (s === 404 && project) return `project ${project} does not exist or this account cannot see it (404)`;
  return String(e?.message ?? e).slice(0, 200);
}

/** The short form of a reason, for a chip: "credentials rejected (401)". */
export const shortReason = (error) => String(error ?? '').split(':')[0];

/**
 * @param {object} p
 * @param {{ myself: Function, project: Function, search: Function }} p.jira  the agent's Jira client
 * @param {string[]} p.projects  the watched project keys
 * @param {Record<string, boolean>} [p.seen]  project key → tickets were seen there before (kept by the caller)
 * @param {(seen: object) => void} [p.onSeen]  called when `seen` changed, to keep it
 * @param {(now: object, before: object) => void} [p.onChange]  called when ok, the reason or the warnings change
 * @returns {{ state: () => object, check: (o?: { force?: boolean }) => Promise<object>, require: () => Promise<object> }}
 */
export function createJiraHealth({ jira, projects, seen = {}, onSeen = () => {}, onChange = () => {}, okTtlMs = OK_TTL_MS, now = () => Date.now() }) {
  let state = { ok: null, checkedAt: null, error: null, user: null, warnings: [] };
  let running = null;

  async function probe() {
    const out = { ok: true, checkedAt: new Date(now()).toISOString(), error: null, user: null, warnings: [] };
    try {
      out.user = (await jira.myself()).name;
    } catch (e) {
      return { ...out, ok: false, error: describeJiraError(e) };
    }
    const missing = [];
    for (const key of projects) {
      try {
        await jira.project(key);
      } catch (e) {
        missing.push(describeJiraError(e, key));
        continue;
      }
      // A project that had tickets and now has none: permissions or a filter changed, or the project was emptied.
      const has = (await jira.search(`project = ${key} ORDER BY created DESC`, 1)).length > 0;
      if (has && !seen[key]) {
        seen[key] = true;
        onSeen(seen);
      }
      if (!has && seen[key]) out.warnings.push(`Jira returns no tickets for ${key}, which had tickets before`);
    }
    return missing.length ? { ...out, ok: false, error: missing.join('; ') } : out;
  }

  async function check({ force = false } = {}) {
    if (!force && state.ok === true && now() - Date.parse(state.checkedAt) < okTtlMs) return state;
    running ??= probe()
      .catch((e) => ({ ok: false, checkedAt: new Date(now()).toISOString(), error: describeJiraError(e), user: null, warnings: [] }))
      .finally(() => {
        running = null;
      });
    const next = await running;
    const before = state;
    state = next;
    if (before.ok !== next.ok || before.error !== next.error || before.warnings.join('\n') !== next.warnings.join('\n')) onChange(next, before);
    return state;
  }

  return {
    state: () => state,
    check,
    /** Throws a 503 error ("Jira unavailable: …") when Jira cannot be used; for the dashboard API. */
    async require() {
      const s = await check();
      if (s.ok === false) throw Object.assign(new Error(`Jira unavailable: ${s.error}`), { status: 503 });
      return s;
    },
  };
}
