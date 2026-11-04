#!/usr/bin/env node
// Shows an agent fix in the running app: switches the MediAgenda clone served on http://localhost:4200 to the
// ticket's branch and waits until the dev server has rebuilt.
//
//   node demo/preview.mjs DEM-12     the app now shows the DEM-12 fix
//   node demo/preview.mjs main       back to main (required before a demo: preflight checks it)
//   node demo/preview.mjs            which branch the app shows now

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentBranch, previewBranch } from '../agent/lib/preview.mjs';

const APP = join(dirname(fileURLToPath(import.meta.url)), 'mediagenda');
const branch = process.argv[2];

if (!branch) {
  console.log(`The app on :4200 shows branch ${currentBranch(APP)}.`);
  process.exit(0);
}
try {
  const r = await previewBranch({ repoDir: APP, branch });
  console.log(`Switched ${r.from} → ${r.branch}${r.changed.length ? ` (${r.changed.length} frontend file(s) differ)` : ' (no frontend difference)'}.`);
  console.log(r.served ? `The app on http://localhost:4200 serves it${r.waitedMs > 1500 ? ` (rebuilt in ${Math.round(r.waitedMs / 1000)} s)` : ''}. Reload the page.` : 'The app on :4200 is not running or has not rebuilt yet; start it with node demo/run-mediagenda.mjs, then reload.');
  if (r.branch !== 'main') console.log('Back to the original: node demo/preview.mjs main');
} catch (e) {
  console.error(`Preview failed: ${e.message}`);
  process.exitCode = 1;
}
