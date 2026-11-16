#!/usr/bin/env node
// System 1 (docs/SYSTEM1_PLAN.md, J8b): build the data, fine-tune a new checkpoint from the base model, score it and
// the current one on the same held-out rows, and make it the current one only when it is not worse.
//
//   node agent/system1-train.mjs                 data → train (CPU, 1–3 h) → evaluate both → accept or keep
//   node agent/system1-train.mjs --name ft-3 --epochs 4
//   node agent/system1-train.mjs --eval-only ft-2   score an existing checkpoint against the current one, accept or keep
//   node agent/system1-train.mjs --eval-only ft-2 --reuse   judge again from the saved eval-*.json, without scoring
//   node agent/system1-train.mjs --eval-only ft-4 --rescore the same, with the scores computed again from the saved
//                                                answers (after a rule of eval.py changed; no model is loaded)
//   node agent/system1-train.mjs --nightly       as the scheduled task runs it (agent/system1/schedule.ps1): no
//                                                training when the data has not changed since the last run, and an
//                                                accepted checkpoint is loaded by the running watcher at once
//
// While it runs, Windows does not go to sleep when idle (agent/system1/keep-awake.ps1): on 2026-11-15 the laptop
// slept through most of a night and ft-3 got half an epoch done.
//
// Accepted when, on the held-out rows:
//   - no ticket about code would take the light path under the policy's rule and threshold (the costly error);
//   - no question is less accurate than with the current checkpoint by more than one item or 1 point (the larger);
//   - the privacy question misses no more names than the current one.
// The current checkpoint is state/system1/models/current.json (else agent.config.json system1.checkpoint); the
// watcher reads it when it starts (node agent/watcher.mjs --replace). Nothing is deleted: a refused checkpoint stays
// in state/system1/models/ for a person to look at.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentCheckpoint, judgeCandidate } from './lib/system1.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const cfg = JSON.parse(readFileSync(join(HERE, 'agent.config.json'), 'utf8'));
const policy = JSON.parse(readFileSync(join(HERE, 'policy.json'), 'utf8'));
const s = cfg.system1 ?? {};
const args = process.argv.slice(2);
const opt = (n, d = null) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const DIR = join(HERE, 'state', 'system1');
const MODELS = join(DIR, 'models');
const python = resolve(HERE, s.python ?? '../tools/laya-env/Scripts/python.exe');
const hfHome = resolve(HERE, s.hfHome ?? '../tools/hf');
const env = { ...process.env, HF_HUB_OFFLINE: '1', HF_HOME: hfHome, HF_HUB_DISABLE_SYMLINKS_WARNING: '1', USE_TF: '0', PYTHONIOENCODING: 'utf-8' };
const BASE = join(hfHome, 'hub', 'models--convaiinnovations--laya', 'snapshots', '7b928d828b7b0e022f929d9bd2e44165aa270148', 'multilingual');
const run = (bin, a) => {
  const r = spawnSync(bin, a, { cwd: ROOT, env, stdio: 'inherit', windowsHide: true });
  if (r.status !== 0) throw new Error(`${a[0]} failed (exit ${r.status})`);
};
// --test FILE: score on other held-out rows (e.g. without the rows the current checkpoint was trained on, after the
// split changed); the results are then eval-<name>-<file>.json.
const TEST = opt('--test') ? resolve(opt('--test')) : join(DIR, 'test.jsonl');
const evaluate = (name) => {
  const out = join(DIR, opt('--test') ? `eval-${name}-${basename(TEST, '.jsonl')}.json` : `eval-${name}.json`);
  if ((args.includes('--reuse') || args.includes('--rescore')) && existsSync(out)) {
    if (args.includes('--rescore')) run(python, ['-I', join(HERE, 'system1', 'eval.py'), '--rescore', out]);
    return JSON.parse(readFileSync(out, 'utf8'));
  }
  run(python, ['-I', join(HERE, 'system1', 'eval.py'), join(MODELS, name), TEST, out, name]);
  return JSON.parse(readFileSync(out, 'utf8'));
};

const NIGHTLY = args.includes('--nightly');
const LAST_RUN = join(MODELS, 'last-run.json');
const dataHash = () => createHash('sha256').update(readFileSync(join(DIR, 'train.jsonl'))).update(readFileSync(join(DIR, 'test.jsonl'))).digest('hex').slice(0, 16);
const readJson = (f) => {
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};

const current = currentCheckpoint({ agentDir: HERE, stateDir: join(HERE, 'state'), cfg });
let name = opt('--eval-only');
let hash = null;
if (!name) {
  if (!existsSync(python)) throw new Error(`no Python at ${python}: node demo/get-tools.mjs --only uv,laya`);
  // No idle sleep until this process ends (Windows); the helper ends with it. Started by Start-Process with a hidden
  // window of its own: a `detached` PowerShell has no console and exits at once, and one spawned as a child of this
  // process stopped after about an hour while ft-4 went on (2026-11-16); one started this way lasted to the end.
  if (process.platform === 'win32') {
    const ps1 = join(HERE, 'system1', 'keep-awake.ps1').replace(/'/g, "''");
    spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','"${ps1}"','-ProcessId','${process.pid}'`], { stdio: 'ignore', windowsHide: true }).unref();
  }
  name = opt('--name', `ft-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`);
  console.log(`${new Date().toISOString()} 1/3 data`);
  run(process.execPath, [join(HERE, 'system1-data.mjs')]);
  hash = dataHash();
  const last = readJson(LAST_RUN);
  if (NIGHTLY && last?.dataHash === hash) {
    console.log(`nothing new since ${last.name} (${last.at}): no training tonight`);
    process.exit(0);
  }
  console.log(`2/3 fine-tune ${name} from the base model (CPU; this takes a while)`);
  run(join(dirname(python), process.platform === 'win32' ? 'laya-train.exe' : 'laya-train'), [
    '--data', join(DIR, 'train.jsonl'), '--eval', join(DIR, 'test.jsonl'), '--base', BASE, '--out', join(MODELS, name),
    '--device', 'cpu', '--epochs', opt('--epochs', '4'), '--micro-batch', '8', '--grad-accum', '2', '--shuffle-options', '--loss', 'soft-ce', '--seed', '0',
  ]);
}
console.log(`3/3 evaluate ${name} and the current ${current.name} on the same held-out rows`);
const candidate = evaluate(name);
const incumbent = name === current.name ? null : evaluate(current.name);
const verdict = judgeCandidate(candidate, incumbent, { threshold: Number(policy.system1?.lightPathThreshold ?? 0.5) });
for (const line of verdict.lines) console.log(`  ${line}`);
if (hash) writeFileSync(LAST_RUN, JSON.stringify({ name, at: new Date().toISOString(), dataHash: hash, accepted: verdict.accept, why: verdict.lines }, null, 2));
if (verdict.accept) {
  writeFileSync(join(MODELS, 'current.json'), JSON.stringify({ name, at: new Date().toISOString(), replaced: current.name, why: verdict.lines }, null, 2));
  console.log(`ACCEPTED: ${name} is the current checkpoint.`);
  // A running watcher loads it now (POST /api/system1/reload); without one, the next start does.
  try {
    const res = await fetch(`http://127.0.0.1:${cfg.dashboardPort ?? 7070}/api/system1/reload`, { method: 'POST', signal: AbortSignal.timeout(300_000) });
    const body = await res.json();
    console.log(body.ok ? `the watcher now serves ${body.model}` : `the watcher could not load it: ${body.reason ?? body.error}`);
  } catch {
    console.log('no watcher answered: it loads the new checkpoint when it starts (node agent/watcher.mjs)');
  }
} else {
  console.log(`KEPT ${current.name}: ${name} stays in ${MODELS} for a person to look at.`);
  process.exitCode = 2;
}
