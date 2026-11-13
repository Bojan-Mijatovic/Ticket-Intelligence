// The projects the agent works on (agent.config.json "projects"). Each project is one Jira project and one
// application repository; projects can be linked (their apps call each other's APIs), so an analysis may read the
// code and tickets of a linked project too.
//
// A project entry overrides the top-level settings (insights, backendTestDir, …). An old config with only
// "project" and "repo" is read as a single project.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { analysisCheckout } from './workspace.mjs';

/**
 * @typedef {object} Project
 * @property {string} key        Jira project key, e.g. "DEM"
 * @property {string} name       application name, e.g. "MediAgenda"
 * @property {string} repoDir    absolute path of the application clone
 * @property {string} stateDir   absolute path of this project's agent state (results, work, insights, ask)
 * @property {object} cfg        the merged settings for this project (cfg.project = key, cfg.repo, cfg.insights, …)
 * @property {{ frontend: number, backend: number, home: string, url: string }} app   where the running app is served
 * @property {string[]} linked   keys of the projects whose APIs this app uses
 * @property {string[]} askExamples
 */

/** @returns {{ global: object, projects: Project[], byKey: (key: string) => Project | null, ofTicket: (key: string) => Project | null }} */
export function loadProjects(agentDir) {
  const raw = JSON.parse(readFileSync(join(agentDir, 'agent.config.json'), 'utf8'));
  const { projects: list, ...global } = raw;
  const entries = Array.isArray(list) && list.length ? list : [{ key: raw.project, repo: raw.repo, stateDir: 'state' }];
  const projects = entries.map((p) => {
    const key = String(p.key).toUpperCase();
    const app = { frontend: 4200, backend: 8080, home: '/', ...(p.app ?? {}) };
    app.url = `http://localhost:${app.frontend}`;
    const cfg = { ...global, ...p, project: key, repo: p.repo, insights: { ...(global.insights ?? {}), ...(p.insights ?? {}) }, app };
    delete cfg.projects;
    return {
      key,
      name: p.name ?? key,
      repoDir: resolve(agentDir, p.repo),
      stateDir: resolve(agentDir, p.stateDir ?? join('state', 'projects', key)),
      cfg,
      app,
      linked: (p.linked ?? []).map((k) => String(k).toUpperCase()),
      askExamples: p.askExamples ?? [],
    };
  });
  const map = new Map(projects.map((p) => [p.key, p]));
  for (const p of projects) {
    const unknown = p.linked.filter((k) => !map.has(k));
    if (unknown.length) throw new Error(`agent.config.json: project ${p.key} links unknown project(s) ${unknown.join(', ')}`);
  }
  return {
    global,
    projects,
    byKey: (key) => map.get(String(key ?? '').toUpperCase()) ?? null,
    ofTicket: (key) => map.get(String(key ?? '').toUpperCase().split('-')[0]) ?? null,
  };
}

/**
 * Read-only checkouts of origin/main of the projects `project` is linked to, for its analysis
 * ({ key, name, dir, relation }). Each one lives in the linked project's state folder (peer-repo), apart from that
 * project's own analysis checkout. A linked repository that cannot be checked out is left out (with a warning).
 */
export function peerCheckouts(project, all, warn = () => {}, { name = 'peer-repo' } = {}) {
  const out = [];
  for (const key of project.linked) {
    const peer = all.byKey(key);
    try {
      out.push({ key, name: peer.name, dir: analysisCheckout({ repoDir: peer.repoDir, stateDir: peer.stateDir, name }).replace(/\\/g, '/'), relation: project.cfg.relations?.[key] ?? '' });
    } catch (e) {
      warn(`linked project ${key} left out: ${e.message}`);
    }
  }
  return out;
}

/**
 * The project of a command-line tool: from a ticket key (DEM-7 → DEM), from --project <KEY>, or the only/first
 * project. Exits with a message when the key belongs to no configured project.
 */
export function cliProject(all, { key = null, argv = process.argv } = {}) {
  const flag = argv.includes('--project') ? argv[argv.indexOf('--project') + 1] : null;
  const p = flag ? all.byKey(flag) : key ? all.ofTicket(key) : all.projects[0];
  if (!p) {
    console.error(`No configured project for ${flag ?? key}. Projects: ${all.projects.map((x) => x.key).join(', ')} (agent/agent.config.json).`);
    process.exit(1);
  }
  return p;
}
