// SVN adapter. Read-only: svn info, svn status, svn log --xml, svn diff, svn ls.
// History comes from the server (svn log), code search runs over the local working copy.
//
// The svn client is looked up in this order: SVN_BIN (env / .env), `svn` on PATH, TortoiseSVN, SlikSVN.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const DAY = 864e5;
const TEXT_MAX_BYTES = 1024 * 1024;
const BINARY_EXT = /\.(png|jpe?g|gif|ico|webp|bmp|pdf|zip|jar|war|ear|class|exe|dll|so|dylib|woff2?|ttf|eot|mp[34]|avi|mov|gz|tgz|7z|rar|xls[xm]?|docx?|pptx?)$/i;

function findSvn() {
  const candidates = [
    process.env.SVN_BIN,
    'svn',
    'C:/Program Files/TortoiseSVN/bin/svn.exe',
    'C:/Program Files/SlikSvn/bin/svn.exe',
    'C:/Program Files (x86)/Subversion/bin/svn.exe',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      execFileSync(c, ['--version', '--quiet'], { stdio: ['ignore', 'pipe', 'ignore'] });
      return c;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

function findWcRoot(dir) {
  let d = resolve(dir);
  for (;;) {
    if (existsSync(join(d, '.svn'))) return d;
    const parent = dirname(d);
    if (parent === d) return null;
    d = parent;
  }
}

const unxml = (s) =>
  String(s ?? '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&amp;/g, '&');
const svnDate = (iso) => `{${new Date(iso).toISOString().slice(0, 19)}Z}`;

export function openSvn(dir) {
  const root = findWcRoot(dir);
  if (!root) return null;
  const bin = findSvn();
  if (!bin) {
    throw new Error('This is an SVN working copy, but no svn command line client was found. Install the TortoiseSVN "command line client tools" (or SlikSVN), or set SVN_BIN in .env.');
  }

  const svn = (sub, ...args) => {
    try {
      return execFileSync(bin, [sub, '--non-interactive', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      throw new Error(`svn ${sub} failed: ${String(e.stderr || e.message).trim().slice(0, 300)}`);
    }
  };
  const item = (name) => svn('info', '--show-item', name, root).trim();
  const url = item('url');
  const reposRoot = item('repos-root-url');
  const relativeUrl = item('relative-url'); // ^/trunk, ^/branches/x, or ^/
  const prefix = relativeUrl.replace(/^\^/, '').replace(/\/$/, ''); // /trunk

  // Repository path (/trunk/a/b.ts, /branches/x/a/b.ts) → working-copy-relative path (a/b.ts), or null.
  const toRel = (p) => {
    if (prefix && p.startsWith(`${prefix}/`)) return p.slice(prefix.length + 1);
    if (!prefix) return p.replace(/^\//, '');
    const m = p.match(/^\/(?:trunk|(?:branches|tags)\/[^/]+)\/(.+)$/);
    return m ? m[1] : null;
  };

  const parseLog = (xml) =>
    [...xml.matchAll(/<logentry\s+revision="(\d+)">([\s\S]*?)<\/logentry>/g)].map(([, rev, body]) => {
      const msg = unxml(body.match(/<msg>([\s\S]*?)<\/msg>/)?.[1] ?? '').trim();
      const changes = [...body.matchAll(/<path\b([^>]*)>([^<]*)<\/path>/g)].map(([, attrs, p]) => ({
        action: attrs.match(/action="(\w)"/)?.[1] ?? '?',
        kind: attrs.match(/kind="(\w+)"/)?.[1] ?? '',
        path: unxml(p),
      }));
      const [subject, ...rest] = msg.split(/\r?\n/);
      return {
        hash: `r${rev}`,
        short: `r${rev}`,
        rev: Number(rev),
        parents: [], // revisions are global in SVN: the previous one may belong to another branch
        author: unxml(body.match(/<author>([\s\S]*?)<\/author>/)?.[1] ?? 'unknown'),
        email: '',
        date: body.match(/<date>([^<]+)<\/date>/)?.[1] ?? '',
        subject: subject ?? '',
        body: rest.join('\n').trim(),
        changes,
        files: [...new Set(changes.filter((c) => c.kind !== 'dir').map((c) => toRel(c.path)).filter(Boolean))],
      };
    });

  const revRange = ({ since, until }) => ['-r', `${until ? svnDate(until) : 'HEAD'}:${since ? svnDate(since) : '1'}`];
  // {DATE} resolves to the youngest revision *as of* that date, so the range starts one commit too early: trim by date.
  const inWindow = ({ since, until }) => (c) =>
    (!since || Date.parse(c.date) >= Date.parse(since)) && (!until || Date.parse(c.date) <= Date.parse(until));

  // Whole-window logs are fetched once and filtered locally (each svn log is a server round trip).
  const cache = new Map();
  const logRange = (target, r) => {
    const key = `${target}|${r.since ?? ''}|${r.until ?? ''}`;
    if (!cache.has(key)) cache.set(key, parseLog(svn('log', '--xml', '-v', ...revRange(r), target)));
    return cache.get(key);
  };
  const inPaths = (file, paths) => paths.some((p) => (p === '(root)' ? !file.includes('/') : file === p || file.startsWith(`${p}/`)));

  // Versioned files of the working copy (local, no server call).
  let fileList = null;
  const files = () => {
    if (!fileList) {
      const xml = svn('status', '-v', '--xml', '.');
      fileList = [...xml.matchAll(/<entry\s+path="([^"]+)">\s*<wc-status\s+[^>]*item="(\w+)"/g)]
        .filter(([, , st]) => !['unversioned', 'ignored', 'external', 'deleted', 'missing'].includes(st))
        .map(([, p]) => unxml(p).replace(/\\/g, '/').replace(/^\.\//, ''))
        .filter((p) => p !== '.' && statSync(join(root, p), { throwIfNoEntry: false })?.isFile());
    }
    return fileList;
  };

  const contents = new Map();
  const read = (f) => {
    if (!contents.has(f)) {
      let text = null;
      try {
        if (!BINARY_EXT.test(f) && statSync(join(root, f)).size <= TEXT_MAX_BYTES) {
          const buf = readFileSync(join(root, f));
          if (!buf.subarray(0, 8000).includes(0)) text = buf.toString('utf8');
        }
      } catch {
        /* unreadable: skip */
      }
      contents.set(f, text);
    }
    return contents.get(f);
  };
  const globToRe = (g) => new RegExp(`(^|/)${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`, 'i');
  const excluded = (f, patterns) => patterns.some((p) => (p.includes('*') ? globToRe(p).test(f) : f === p || f.startsWith(`${p}/`)));

  return {
    kind: 'svn',
    root,

    files,

    /** The history of the working copy's line (trunk or a branch), newest first; one server call. Default: one year. */
    history({ since, until, limit } = {}) {
      const window = { since: since ?? new Date(Date.now() - 365 * DAY).toISOString(), until };
      const out = logRange(url, window).filter(inWindow(window));
      return limit ? out.slice(0, limit) : out;
    },

    logByMessage(terms, { all = false, since, until, limit = 200 } = {}) {
      const usable = terms.filter((t) => !/[*?[\]]/.test(t));
      if (!usable.length) return [];
      const xml = svn('log', '--xml', '-v', ...usable.flatMap((t) => ['--search', t]), '-l', String(limit), ...revRange({ since, until }), all ? reposRoot : url);
      // --search also matches authors and paths: keep only commits whose message contains a term.
      const lower = usable.map((t) => t.toLowerCase());
      return parseLog(xml)
        .filter(inWindow({ since, until }))
        .filter((c) => lower.some((t) => `${c.subject}\n${c.body}`.toLowerCase().includes(t)));
    },

    logByPaths(paths, { all = false, since, until, limit = 200 } = {}) {
      const window = { since: since ?? new Date(Date.now() - 365 * DAY).toISOString(), until };
      return logRange(all ? reposRoot : url, window)
        .filter(inWindow(window))
        .filter((c) => c.files.some((f) => inPaths(f, paths)))
        .slice(0, limit);
    },

    grep(term, { word = false, filesOnly = false, exclude = [], only = null } = {}) {
      const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(word ? `(?<![\\w])${esc}(?![\\w])` : esc, 'i');
      const out = [];
      for (const f of files()) {
        if (only ? !(f === only || f.startsWith(`${only}/`)) : excluded(f, exclude)) continue;
        const text = read(f);
        if (text === null || !re.test(text)) continue;
        if (filesOnly) {
          out.push({ file: f });
          continue;
        }
        text.split(/\r?\n/).forEach((line, i) => {
          if (re.test(line)) out.push({ file: f, line: i + 1, text: line });
        });
      }
      return out;
    },

    patch(commit, { paths = [], maxLines = 150 } = {}) {
      const stat = commit.changes.map((c) => `${c.action} ${c.path}`).join('\n');
      // Diff the whole revision at the repository root, then keep the sections of the requested paths.
      const full = svn('diff', '-c', String(commit.rev), reposRoot);
      const sections = full.split(/^(?=Index: )/m).filter((s) => s.startsWith('Index: '));
      const wanted = paths.length
        ? sections.filter((s) => {
            const rel = toRel(`/${s.slice(7, s.indexOf('\n')).trim()}`);
            return rel && inPaths(rel, paths);
          })
        : sections;
      const lines = wanted.join('').split(/\r?\n/);
      return { stat, patch: lines.slice(0, maxLines).join('\n') + (lines.length > maxLines ? `\n… [+${lines.length - maxLines} lines]` : '') };
    },

    /** Not compared on SVN (a branch diff is a server round trip per branch): no fix-in-progress detection there. */
    changedFiles: () => [],

    /** SVN logins are not names: the team for the redaction comes from Jira and the config (redaction.staff). */
    authors: () => [],

    branches() {
      const xml = svn('ls', '--xml', `${reposRoot}/branches`);
      return [...xml.matchAll(/<entry\s+kind="dir">\s*<name>([^<]+)<\/name>[\s\S]*?<author>([^<]*)<\/author>\s*<date>([^<]+)<\/date>/g)].map(([, name, author, date]) => ({
        name: `^/branches/${unxml(name)}`,
        lastCommit: date,
        author: unxml(author),
      }));
    },

    info(cfg) {
      return { branch: relativeUrl, baseBranch: cfg.baseBranch ?? '^/trunk', remotes: [reposRoot] };
    },
  };
}
