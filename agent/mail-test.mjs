#!/usr/bin/env node
// Sends one update email, to check the SMTP settings in ~/.claude/skills/analyze-ticket/.env.
//   node agent/mail-test.mjs                 a short test message to MAIL_TO
//   node agent/mail-test.mjs DEM-40          the "analysis ready" update of a saved analysis (state/results/DEM-40.json)
//   node agent/mail-test.mjs DEM-40 --dry-run   print that update instead of sending it

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJira } from './lib/jira-actions.mjs';
import { mailProblems, mailSettings, sendMail } from './lib/mail.mjs';
import { composeUpdate } from './lib/mail-updates.mjs';
import { cliProject, loadProjects } from './lib/projects.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const key = args.find((a) => !a.startsWith('--'))?.toUpperCase();

const jira = createJira(); // also loads the per-user .env into process.env
const settings = mailSettings();

let msg;
if (key) {
  const { stateDir } = cliProject(loadProjects(HERE), { key });
  const file = [join(stateDir, 'results', `${key}.json`), join(stateDir, 'work', key, 'result.json')].find(existsSync);
  if (!file) {
    console.error(`No saved analysis for ${key} (state/results/${key}.json). Run the agent on it first, or omit the key.`);
    process.exit(1);
  }
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  const result = saved.result ?? saved; // state/results wraps the result with { at, result, meta }
  msg = composeUpdate({ type: 'analyzed', key, result }, { title: result.title, url: jira.browseUrl(key) });
} else {
  msg = {
    subject: 'Ticket Intelligence: test email',
    text: `This is a test message from the Ticket Intelligence agent.\nSMTP: ${settings.host}:${settings.port} (${settings.secure}) as ${settings.user || '(no login)'}\nIf you can read this, update emails will arrive here.`,
    html: `<p>This is a test message from the <b>Ticket Intelligence</b> agent.</p><p>SMTP: ${settings.host}:${settings.port} (${settings.secure})</p><p>If you can read this, update emails will arrive here.</p>`,
  };
}

if (dryRun) {
  console.log(`To: ${settings.to.join(', ') || '(MAIL_TO not set)'}\nSubject: ${msg.subject}\n\n${msg.text}`);
  process.exit(0);
}

const problems = mailProblems(settings);
if (problems.length) {
  console.error('Email is not configured:');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nSet these in ~/.claude/skills/analyze-ticket/.env (see .env.example).');
  process.exit(1);
}

try {
  const r = await sendMail(msg, settings);
  console.log(`Sent "${msg.subject}" to ${r.to.join(', ')} (${r.messageId})`);
} catch (e) {
  console.error(`Not sent: ${e.message}`);
  process.exit(1);
}
