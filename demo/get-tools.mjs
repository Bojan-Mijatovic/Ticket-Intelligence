#!/usr/bin/env node
// Downloads the portable tools the demo uses into tools/ (not in git: about 350 MB). Tools already there are skipped.
//
//   node demo/get-tools.mjs              JDK 21 (Temurin), Maven 3.9.9, Subversion 1.14.5 command line (Windows)
//   node demo/get-tools.mjs --only jdk,maven
//   node demo/get-tools.mjs --only uv,laya   the System 1 model (docs/SYSTEM1_PLAN.md): about 1.5 GB, only when named
//   node demo/get-tools.mjs --dir other/folder
//
// Every download is checked: the JDK against the SHA-256 published by Adoptium, Maven against the SHA-512 published
// by Apache, Subversion against the SHA-256 pinned below (VisualSVN publishes none), uv against the SHA-256 published
// with its release. Java and Maven are only needed for the MediAgenda backend; Subversion only for the SVN variant of
// the demo (on Linux/macOS use the system svn).
//
// laya: uv installs its own Python into tools/python and the laya package into tools/laya-env, resolved as of
// LAYA.asOf (packages published later are ignored: the package moves fast, and a two-week-old set is the one checked);
// the multilingual checkpoint goes into tools/hf at a pinned revision of the model repository.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const DIR = resolve(opt('--dir') ?? join(HERE, '..', 'tools'));
const ONLY = opt('--only')?.split(',').map((s) => s.trim());
const win = process.platform === 'win32';

const JDK = 'jdk-21.0.13+9';
const MAVEN = '3.9.9';
const SVN = { version: '1.14.5', sha256: '23d393431b0aeec67490669b7d3b4a1a83332fdc184055fef48ea9123eaf7e0a' };
const UV = '0.13.5';
const LAYA = {
  version: '0.4.18',
  python: '3.12',
  asOf: '2026-10-31T00:00:00Z',
  model: 'convaiinnovations/laya',
  // 2026-10-03; the multilingual weights are unchanged since 2026-09-19, later commits only edit the model card.
  revision: '7b928d828b7b0e022f929d9bd2e44165aa270148',
};

const os = { win32: 'windows', linux: 'linux', darwin: 'mac' }[process.platform];
const arch = { x64: 'x64', arm64: 'aarch64' }[process.arch];
const uvTarget = `${{ x64: 'x86_64', arm64: 'aarch64' }[process.arch]}-${{ win32: 'pc-windows-msvc', linux: 'unknown-linux-gnu', darwin: 'apple-darwin' }[process.platform]}`;

/** uv.exe at the root of tools/uv (Windows zip), or inside its target folder (tar.gz elsewhere). */
function uvBin(dir) {
  const flat = join(dir, 'uv', win ? 'uv.exe' : 'uv');
  return existsSync(flat) ? flat : join(dir, 'uv', `uv-${uvTarget}`, 'uv');
}
/** The Python of the laya environment. */
function layaPython(dir) {
  return join(dir, 'laya-env', win ? join('Scripts', 'python.exe') : join('bin', 'python'));
}
/** uv and the model downloads keep everything inside tools/: the Python, uv's cache, the Hugging Face cache. */
function layaEnv(dir) {
  // UV_PYTHON_BIN_DIR: uv would otherwise put a python3.12.exe into ~/.local/bin, outside tools/.
  return { UV_PYTHON_INSTALL_DIR: join(dir, 'python'), UV_PYTHON_BIN_DIR: join(dir, 'python', 'bin'), UV_PYTHON_PREFERENCE: 'only-managed', UV_CACHE_DIR: join(dir, 'uv-cache'), HF_HOME: join(dir, 'hf'), HF_HUB_DISABLE_TELEMETRY: '1', USE_TF: '0' };
}
function run(bin, binArgs, env = {}) {
  execFileSync(bin, binArgs, { stdio: 'inherit', env: { ...process.env, ...env } });
}

const TOOLS = [
  {
    name: 'jdk',
    folder: JDK,
    async source() {
      const url = `https://api.adoptium.net/v3/assets/release_name/eclipse/${encodeURIComponent(JDK)}?os=${os}&architecture=${arch}&image_type=jdk&heap_size=normal&jvm_impl=hotspot&project=jdk`;
      const release = JSON.parse(curlText(url));
      const pkg = release?.binaries?.find((b) => /\.(zip|tar\.gz)$/.test(b.package?.name ?? ''))?.package;
      if (!pkg) throw new Error(`Adoptium has no ${JDK} build for ${os}/${arch}`);
      return { url: pkg.link, name: pkg.name, hash: ['sha256', pkg.checksum] };
    },
    check: (dir) => [join(dir, JDK, 'bin', win ? 'java.exe' : 'java'), ['-version']],
  },
  {
    name: 'maven',
    folder: `apache-maven-${MAVEN}`,
    async source() {
      const url = `https://archive.apache.org/dist/maven/maven-3/${MAVEN}/binaries/apache-maven-${MAVEN}-bin.zip`;
      const sha512 = curlText(`${url}.sha512`).trim().split(/\s+/)[0];
      return { url, name: `apache-maven-${MAVEN}-bin.zip`, hash: ['sha512', sha512] };
    },
    check: (dir) => [join(dir, `apache-maven-${MAVEN}`, 'bin', win ? 'mvn.cmd' : 'mvn'), ['-v'], { JAVA_HOME: join(dir, JDK) }],
  },
  {
    name: 'svn',
    folder: 'svn',
    windowsOnly: true,
    // The zip has bin/ and Licenses/ at its root, so it is extracted into tools/svn.
    extractInto: 'svn',
    async source() {
      return { url: `https://www.visualsvn.com/files/Apache-Subversion-${SVN.version}.zip`, name: `Apache-Subversion-${SVN.version}.zip`, hash: ['sha256', SVN.sha256] };
    },
    check: (dir) => [join(dir, 'svn', 'bin', 'svn.exe'), ['--version', '--quiet']],
  },
  {
    name: 'uv',
    folder: 'uv',
    optional: true,
    extractInto: 'uv',
    async source() {
      const name = `uv-${uvTarget}.${win ? 'zip' : 'tar.gz'}`;
      const url = `https://github.com/astral-sh/uv/releases/download/${UV}/${name}`;
      const sha256 = curlText(`${url}.sha256`).trim().split(/\s+/)[0];
      return { url, name, hash: ['sha256', sha256] };
    },
    check: (dir) => [uvBin(dir), ['--version']],
  },
  {
    name: 'laya',
    folder: 'laya-env',
    optional: true,
    install(dir) {
      const uv = uvBin(dir);
      if (!existsSync(uv)) throw new Error('uv is missing: run with --only uv,laya');
      const env = layaEnv(dir);
      run(uv, ['python', 'install', LAYA.python], env);
      run(uv, ['venv', join(dir, 'laya-env'), '--python', LAYA.python], env);
      run(uv, ['pip', 'install', '--python', layaPython(dir), '--exclude-newer', LAYA.asOf, `laya[serve]==${LAYA.version}`], env);
      // Only the multilingual checkpoint and the model card, at the pinned revision: no Python files of the model repository.
      const fetch = `from huggingface_hub import snapshot_download; print(snapshot_download(${JSON.stringify(LAYA.model)}, revision=${JSON.stringify(LAYA.revision)}, allow_patterns=["multilingual/*", "README.md"]))`;
      run(layaPython(dir), ['-c', fetch], env);
    },
    check: (dir) => [layaPython(dir), ['-c', 'from importlib.metadata import version as v; import torch; print("laya", v("laya"), "· torch", torch.__version__, "· cpu threads", torch.get_num_threads())'], layaEnv(dir)],
  },
];

// curl (built into Windows 10+, Linux and macOS) instead of fetch: Node's fetch times out on some hosts here
// (archive.apache.org) where curl connects fine, and curl follows the GitHub release redirects as they are.
function curlText(url) {
  return execFileSync('curl', ['-fsSL', '--retry', '2', url], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}
function download(url, file) {
  execFileSync('curl', ['-fL', '--retry', '2', '--progress-bar', '-o', file, url], { stdio: ['ignore', 'inherit', 'inherit'] });
}

function digest(file, algorithm) {
  return createHash(algorithm).update(readFileSync(file)).digest('hex');
}

mkdirSync(DIR, { recursive: true });
let failed = false;
// An optional tool (the System 1 model) is fetched only when --only names it.
const wanted = (t) => (ONLY ? ONLY.includes(t.name) : !t.optional);
for (const tool of TOOLS.filter(wanted)) {
  if (tool.windowsOnly && !win) {
    console.log(`- ${tool.name}: skipped (Windows only; use the system package)`);
    continue;
  }
  if (existsSync(join(DIR, tool.folder))) {
    console.log(`- ${tool.name}: already in ${join(DIR, tool.folder)}`);
    continue;
  }
  if (tool.install) {
    try {
      console.log(`- ${tool.name}: installing …`);
      tool.install(DIR);
    } catch (e) {
      failed = true;
      console.error(`  ${tool.name} FAILED: ${e.message}`);
    }
    continue;
  }
  const tmp = mkdtempSync(join(tmpdir(), `get-tools-${tool.name}-`));
  try {
    const src = await tool.source();
    const file = join(tmp, src.name);
    console.log(`- ${tool.name}: downloading ${src.name} …`);
    await download(src.url, file);
    const [algorithm, expected] = src.hash;
    const actual = digest(file, algorithm);
    if (expected.startsWith('__')) {
      console.log(`  ${algorithm} ${actual} (no pinned value yet)`);
    } else if (actual !== expected.toLowerCase()) {
      throw new Error(`${algorithm} mismatch: expected ${expected}, got ${actual}`);
    } else {
      console.log(`  ${algorithm} verified`);
    }
    const target = tool.extractInto ? join(DIR, tool.extractInto) : DIR;
    mkdirSync(target, { recursive: true });
    // tar (bsdtar) extracts zip and tar.gz on Windows 10+, Linux and macOS. On Windows the system one by its path: from
    // Git Bash, `tar` is GNU tar, which reads "C:\…" as a remote host and cannot open a zip.
    const tar = win ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    execFileSync(tar, ['-xf', file, '-C', target], { stdio: 'inherit' });
    if (!existsSync(join(DIR, tool.folder))) throw new Error(`after extracting, ${tool.folder} is missing in ${DIR} (found: ${readdirSync(DIR).join(', ')})`);
    console.log(`  extracted to ${join(DIR, tool.folder)}`);
  } catch (e) {
    failed = true;
    console.error(`  ${tool.name} FAILED: ${e.message}`);
    // An empty folder left by a failed extract would make the next run skip the tool as "already there".
    const target = tool.extractInto ? join(DIR, tool.extractInto) : null;
    if (target && existsSync(target) && !readdirSync(target).length) rmSync(target, { recursive: true });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Each tool must start.
for (const tool of TOOLS.filter((t) => wanted(t) && !(t.windowsOnly && !win))) {
  const [bin, binArgs, env = {}] = tool.check(DIR);
  // java -version prints to stderr: take whichever output has text.
  const r = spawnSync(win && bin.endsWith('.cmd') ? `"${bin}"` : bin, binArgs, { encoding: 'utf8', shell: win && bin.endsWith('.cmd'), env: { ...process.env, ...env } });
  const first = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n')[0];
  if (r.status === 0) console.log(`✓ ${tool.name}: ${first}`);
  else {
    console.error(`✗ ${tool.name}: ${first || r.error?.message || `exit ${r.status}`}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
