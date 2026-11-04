#!/usr/bin/env node
// Installs /analyze-ticket and /document-ticket.
//
//   node install.mjs                       user-level: ~/.claude/skills
//                                          (used by Claude Code and by GitHub Copilot in VS Code)
//   node install.mjs --copilot-cli         also ~/.copilot/skills (GitHub Copilot CLI)
//   node install.mjs --project <repo>      into <repo>/.github/skills, so the whole team gets the skills with the
//                                          repository (Copilot and Claude Code both read it). No secrets are copied:
//                                          Jira credentials stay in each user's ~/.claude/skills/analyze-ticket/.env.
//
// Re-run after updating; an existing .env and config.json in the target are kept.

import { cpSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const projectIdx = args.indexOf('--project');
const project = projectIdx > -1 ? args[projectIdx + 1] : null;
if (projectIdx > -1 && !project) {
  console.error('usage: node install.mjs --project <path-to-repository>');
  process.exit(1);
}

const userSkills = join(homedir(), '.claude', 'skills');
const targets = project
  ? [{ dir: join(resolve(project), '.github', 'skills'), secrets: false }]
  : [{ dir: userSkills, secrets: true }, ...(args.includes('--copilot-cli') ? [{ dir: join(homedir(), '.copilot', 'skills'), secrets: false }] : [])];

const KEEP = new Set(['.env', 'config.json']); // user's own settings survive re-installs

for (const { dir, secrets } of targets) {
  for (const skill of ['analyze-ticket', 'document-ticket']) {
    const from = join(here, '.claude', 'skills', skill);
    const to = join(dir, skill);
    mkdirSync(to, { recursive: true });
    cpSync(from, to, {
      recursive: true,
      filter: (src) => {
        const rel = src.slice(from.length + 1).replace(/\\/g, '/');
        if (rel === '.env') return false; // never copy secrets; seeded separately below for the user-level install
        return !(KEEP.has(rel) && existsSync(join(to, rel)));
      },
    });
    console.log(`installed ${skill} -> ${to}`);
  }
  if (secrets) {
    const envTarget = join(dir, 'analyze-ticket', '.env');
    if (!existsSync(envTarget) && existsSync(join(here, '.env'))) {
      copyFileSync(join(here, '.env'), envTarget);
      console.log(`copied .env -> ${envTarget}`);
    }
  }
}

console.log(`
Jira settings (per user): ${join(userSkills, 'analyze-ticket', '.env')}
Claude Code / Copilot (VS Code): open the project folder and run /analyze-ticket <ID> "<title>".`);
if (project) console.log(`Commit ${join(resolve(project), '.github', 'skills')} so the team gets the skills (it contains no secrets).`);
