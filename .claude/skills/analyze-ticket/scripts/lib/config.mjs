import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const DEFAULTS = {
  baseUrl: '',
  deployment: 'cloud', // 'cloud' | 'server' (Server / Data Center)
  projects: [], // extra project keys searched for related tickets; the target's own project is always included
  environmentField: 'environment', // 'environment' | 'components' | 'labels' | 'customfield_NNNNN'
  environmentMatch: 'auto', // 'auto' | 'exact' (=) | 'text' (~)
  lookbackDays: 365,
  maxCandidates: 50,
  maxRelated: 10,
  halfLifeDays: 180,
  doneStatuses: ['Done', 'Resolved', 'Closed', 'Fixed'],
  excludeUsers: ['Automation for Jira', 'Jira Automation'],
  mock: false,
};

function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trimStart().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

export function loadConfig() {
  // Credentials are per user. Order: the skill's own .env (user-level install), then the user-level install's .env
  // (used when the skill runs from a project's .github/skills or .claude/skills copy, which never holds secrets),
  // then the current project's .env (which belongs to the app being analyzed, so it comes last).
  loadDotEnv(join(SKILL_DIR, '.env'));
  loadDotEnv(join(homedir(), '.claude', 'skills', 'analyze-ticket', '.env'));
  loadDotEnv(join(process.cwd(), '.env'));
  const file = join(SKILL_DIR, 'config.json');
  const fromFile = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const cfg = { ...DEFAULTS, ...fromFile };
  const env = process.env;
  if (env.JIRA_BASE_URL) cfg.baseUrl = env.JIRA_BASE_URL;
  if (env.JIRA_DEPLOYMENT) cfg.deployment = env.JIRA_DEPLOYMENT;
  if (env.JIRA_ENV_FIELD) cfg.environmentField = env.JIRA_ENV_FIELD;
  if (env.JIRA_MOCK !== undefined && env.JIRA_MOCK !== '') cfg.mock = /^(1|true|yes)$/i.test(env.JIRA_MOCK);
  // Another data file for the offline source: the agent's replay (AI1b) freezes Jira as it was when a ticket came in.
  if (env.JIRA_MOCK_FILE) cfg.mockFile = env.JIRA_MOCK_FILE;
  // Linked projects (set by the agent for an app that calls other apps' APIs): searched for related tickets too.
  if (env.TICKET_INTEL_PROJECTS) cfg.projects = [...new Set([...(cfg.projects ?? []), ...env.TICKET_INTEL_PROJECTS.split(',').map((k) => k.trim().toUpperCase()).filter(Boolean)])];
  cfg.baseUrl = String(cfg.baseUrl || '').replace(/\/+$/, '');
  return cfg;
}
