// Builds a demo application repository from a template (the code as it is today) and a list of history steps
// (commits with author and date). Shared by the projects of the demo suite (demo/make-project.mjs); MediAgenda has
// its own copy of the same logic in demo/make-mediagenda.mjs (git and SVN).
//
// A step's files map a path to its source:
//   T          the template version (the final one)
//   H('dir')   an older version kept in history/<dir>/<path>
//   B(src, [fixed, buggy], …)   `src` with bugs put back: each `fixed` text (exactly once in the file) becomes `buggy`.
//              A feature commit gets the buggy version; the later commit of the bug ticket sets the file to T.
//              An empty `buggy` removes the text, e.g. a route that is added by a later commit.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

export const T = 'template';
export const H = (dir) => ({ history: dir });
export const B = (base, ...pairs) => ({ base, pairs });

/**
 * A block of a template file, for B() pairs that remove or replace a whole method or test: the text from `start`
 * (which must occur exactly once) up to, not including, the first `end` after it.
 *   const cut = cutter(join(srcDir, 'template'));
 *   B(T, [cut(path, '    @Test\n    void x', '    @Test\n    void y'), ''])
 */
export function cutter(templateDir) {
  return (path, start, end) => {
    const text = readFileSync(join(templateDir, path), 'utf8').replace(/\r\n/g, '\n');
    const at = text.indexOf(start);
    if (at < 0 || text.indexOf(start, at + 1) >= 0) throw new Error(`${path}: the start of a cut must occur exactly once: ${start.slice(0, 60)}`);
    const to = text.indexOf(end, at + start.length);
    if (to < 0) throw new Error(`${path}: the end of a cut was not found after its start: ${end.slice(0, 60)}`);
    return text.slice(at, to);
  };
}

/** Ticket placeholders of the demo stories (CUP_LAB-104, CUP_DEMO-2533, …) → real Jira keys (demo/jira-keys.json). */
export function keyMapper(keysFile) {
  const map = existsSync(keysFile) ? JSON.parse(readFileSync(keysFile, 'utf8')) : {};
  return { map, mapKeys: (s) => String(s ?? '').replace(/CUP_[A-Z]+-\d+/g, (k) => map[k] ?? k) };
}

const listFiles = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => relative(dir, join(d.parentPath ?? d.path, d.name)).replace(/\\/g, '/'));

/** Empties `dir` for a rebuild; refuses a published repository (a rebuild would rewrite its history). */
export function prepare(dir, { force = false, allowRemote = false } = {}) {
  if (existsSync(dir)) {
    if (!force) throw new Error(`${dir} already exists. Rerun with --force to recreate it.`);
    let remote = '';
    if (existsSync(join(dir, '.git'))) {
      try {
        remote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch {
        /* no remote */
      }
    }
    if (remote && !allowRemote) throw new Error(`${dir} is published to ${remote}. Rebuilding it would rewrite its history; reset it by deleting the agent's branches instead.`);
    for (const entry of readdirSync(dir)) rmSync(join(dir, entry), { recursive: true, force: true });
  }
  mkdirSync(dir, { recursive: true });
}

/**
 * @param {object} p
 * @param {string} p.srcDir   demo/src/<name> (template/ and history/)
 * @param {string} p.outDir   the repository to create
 * @param {Record<string, string[]>} p.people   who → [name, email]
 * @param {{ who: string, date: string, message: string, files: Record<string, any> }[]} p.steps
 * @param {(s: string) => string} p.mapKeys
 * @returns {string} the git log summary
 */
export function buildGitHistory({ srcDir, outDir, people, steps, mapKeys }) {
  const TEMPLATE = join(srcDir, 'template');
  const HISTORY = join(srcDir, 'history');
  const committed = new Set();
  const sourceFile = (path, source) => (source === T ? join(TEMPLATE, path) : join(HISTORY, source.history, path));
  const sourceText = (path, source) => {
    const base = source.pairs ? source.base : source;
    const from = sourceFile(path, base);
    if (!existsSync(from)) throw new Error(`Missing source for ${path}: ${from}`);
    let text = readFileSync(from, 'utf8');
    for (const [fixed, buggy] of source.pairs ?? []) {
      const eol = text.includes('\r\n') ? (s) => s.replace(/\r?\n/g, '\r\n') : (s) => s;
      const [f, b] = [eol(fixed), eol(buggy)];
      const count = text.split(f).length - 1;
      if (count !== 1) throw new Error(`${path}: the fixed text of a bug must occur exactly once (found ${count}): ${fixed.slice(0, 80)}`);
      text = text.replace(f, () => b);
    }
    return text;
  };

  const git = (args, env = {}) => execFileSync('git', args, { cwd: outDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'core.autocrlf', 'false']);
  for (const step of steps) {
    for (const [path, source] of Object.entries(step.files)) {
      if (source === null) {
        rmSync(join(outDir, path), { force: true });
        continue;
      }
      mkdirSync(dirname(join(outDir, path)), { recursive: true });
      writeFileSync(join(outDir, path), mapKeys(sourceText(path, source)));
      if (source === T) committed.add(path);
      else committed.delete(path);
    }
    const [name, email] = people[step.who] ?? (() => { throw new Error(`unknown author ${step.who}`); })();
    git(['add', '-A']);
    git(['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', mapKeys(step.message)], { GIT_AUTHOR_DATE: step.date, GIT_COMMITTER_DATE: step.date });
  }

  const template = listFiles(TEMPLATE);
  const missing = template.filter((f) => !committed.has(f));
  if (missing.length) throw new Error(`template files whose last commit is not the template version: ${missing.join(', ')}`);
  const differs = template.filter((f) => readFileSync(join(outDir, f), 'utf8') !== mapKeys(readFileSync(join(TEMPLATE, f), 'utf8')));
  if (differs.length) throw new Error(`the final history differs from the template in: ${differs.join(', ')}`);
  const extra = listFiles(outDir).filter((f) => !f.startsWith('.git/') && !template.includes(f));
  if (extra.length) throw new Error(`files left in the repository that are not in the template: ${extra.join(', ')}`);
  return git(['log', '--format=%ad  %<(18,trunc)%an %s', '--date=short']);
}
