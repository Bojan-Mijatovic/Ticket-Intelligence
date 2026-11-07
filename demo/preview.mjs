#!/usr/bin/env node
// Shows an agent fix in the running app: switches the app's clone (MediAgenda on http://localhost:4200, the other
// apps on their own port, agent/agent.config.json) to the ticket's branch and waits until the dev server has rebuilt.
//
//   node demo/preview.mjs DEM-12               the MediAgenda app now shows the DEM-12 fix (LAB-3: the MediLab app)
//   node demo/preview.mjs main [--project LAB] back to main (required before a demo: preflight checks it)
//   node demo/preview.mjs [--project LAB]      which branch the app shows now

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentBranch, previewBranch } from '../agent/lib/preview.mjs';
import { loadProjects } from '../agent/lib/projects.mjs';

const suite = loadProjects(join(dirname(fileURLToPath(import.meta.url)), '..', 'agent'));
const args = process.argv.slice(2);
const flag = args.includes('--project') ? args[args.indexOf('--project') + 1] : null;
const branch = args.find((a) => a !== flag && !a.startsWith('--'));
const project = (branch && branch !== 'main' ? suite.ofTicket(branch) : null) ?? suite.byKey(flag ?? 'DEM');
if (!project) {
  console.error(`No project for ${branch ?? flag}. Projects: ${suite.projects.map((p) => p.key).join(', ')}`);
  process.exit(1);
}
const APP = project.repoDir;
const where = `the ${project.name} app on ${project.app.url}`;

if (!branch) {
  console.log(`${where} shows branch ${currentBranch(APP)}.`);
  process.exit(0);
}
try {
  const r = await previewBranch({ repoDir: APP, branch, appUrl: project.app.url });
  console.log(`Switched ${r.from} → ${r.branch}${r.changed.length ? ` (${r.changed.length} frontend file(s) differ)` : ' (no frontend difference)'}.`);
  console.log(r.served ? `${where} serves it${r.waitedMs > 1500 ? ` (rebuilt in ${Math.round(r.waitedMs / 1000)} s)` : ''}. Reload the page.` : `${where} is not running or has not rebuilt yet; start it with node demo/run-mediagenda.mjs --project ${project.key}, then reload.`);
  if (r.branch !== 'main') console.log(`Back to the original: node demo/preview.mjs main --project ${project.key}`);
} catch (e) {
  console.error(`Preview failed: ${e.message}`);
  process.exitCode = 1;
}
