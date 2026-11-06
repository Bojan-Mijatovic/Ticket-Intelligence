#!/usr/bin/env node
// Downloads the portable tools the demo uses into tools/ (not in git: about 350 MB). Tools already there are skipped.
//
//   node demo/get-tools.mjs              JDK 21 (Temurin), Maven 3.9.9, Subversion 1.14.5 command line (Windows)
//   node demo/get-tools.mjs --only jdk,maven
//   node demo/get-tools.mjs --dir other/folder
//
// Every download is checked: the JDK against the SHA-256 published by Adoptium, Maven against the SHA-512 published
// by Apache, Subversion against the SHA-256 pinned below (VisualSVN publishes none). Java and Maven are only needed
// for the MediAgenda backend; Subversion only for the SVN variant of the demo (on Linux/macOS use the system svn).

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

const os = { win32: 'windows', linux: 'linux', darwin: 'mac' }[process.platform];
const arch = { x64: 'x64', arm64: 'aarch64' }[process.arch];

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
for (const tool of TOOLS.filter((t) => !ONLY || ONLY.includes(t.name))) {
  if (tool.windowsOnly && !win) {
    console.log(`- ${tool.name}: skipped (Windows only; use the system package)`);
    continue;
  }
  if (existsSync(join(DIR, tool.folder))) {
    console.log(`- ${tool.name}: already in ${join(DIR, tool.folder)}`);
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
    // tar (bsdtar) extracts zip and tar.gz on Windows 10+, Linux and macOS.
    execFileSync('tar', ['-xf', file, '-C', target], { stdio: 'inherit' });
    if (!existsSync(join(DIR, tool.folder))) throw new Error(`after extracting, ${tool.folder} is missing in ${DIR} (found: ${readdirSync(DIR).join(', ')})`);
    console.log(`  extracted to ${join(DIR, tool.folder)}`);
  } catch (e) {
    failed = true;
    console.error(`  ${tool.name} FAILED: ${e.message}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Each tool must start.
for (const tool of TOOLS.filter((t) => (!ONLY || ONLY.includes(t.name)) && !(t.windowsOnly && !win))) {
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
