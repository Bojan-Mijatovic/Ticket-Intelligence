// Git adapter. Read-only: git log, git grep, git show, git ls-files, git for-each-ref.

import { execFileSync } from 'node:child_process';

const REC = '\x1e';
const FLD = '\x1f';
const END = '\x1d';
const FORMAT = `--format=${REC}%H${FLD}%an${FLD}%ae${FLD}%aI${FLD}%s${FLD}%b${END}`;

function parseLog(out) {
  return out
    .split(REC)
    .filter((s) => s.trim())
    .map((chunk) => {
      const [head, files = ''] = chunk.split(END);
      const [hash, author, email, date, subject, body = ''] = head.split(FLD);
      return {
        hash,
        short: hash.slice(0, 8),
        author,
        email,
        date,
        subject,
        body: body.trim(),
        files: files.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
      };
    });
}

export function openGit(dir) {
  let root;
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }

  const git = (args, { allowNoMatch = false } = {}) => {
    try {
      return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      if (allowNoMatch && e.status === 1 && !String(e.stderr ?? '').trim()) return '';
      throw new Error(`git ${args.slice(0, 2).join(' ')} failed: ${String(e.stderr || e.message).trim().slice(0, 300)}`);
    }
  };
  const log = (args) => parseLog(git(['log', FORMAT, '--name-only', ...args]));
  // The "(root)" component means files directly in the repo root, not the whole repo.
  const spec = (p) => (p === '(root)' ? ':(glob)*' : p);
  const range = ({ since, until, limit }) => [...(since ? [`--since=${since}`] : []), ...(until ? [`--until=${until}`] : []), ...(limit ? ['-n', String(limit)] : [])];

  return {
    kind: 'git',
    root,

    files: () => git(['ls-files']).split(/\r?\n/).filter(Boolean),

    logByMessage: (terms, { all = false, ...r } = {}) =>
      terms.length ? log([...(all ? ['--all'] : []), '-i', '-F', ...terms.flatMap((t) => ['--grep', t]), ...range(r)]) : [],

    logByPaths: (paths, { all = false, ...r } = {}) => log([...(all ? ['--all'] : []), ...range(r), '--', ...paths.map(spec)]),

    grep(term, { word = false, filesOnly = false, exclude = [], only = null } = {}) {
      const scope = only ? [only] : ['.', ...exclude.map((e) => `:(exclude)${e}`)];
      const out = git(['grep', '-I', '-i', '-F', ...(word ? ['-w'] : []), filesOnly ? '-l' : '-n', '-e', term, '--', ...scope], { allowNoMatch: true });
      return out
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          if (filesOnly) return { file: line };
          const m = line.match(/^(.+?):(\d+):(.*)$/);
          return m ? { file: m[1], line: Number(m[2]), text: m[3] } : null;
        })
        .filter(Boolean);
    },

    patch(commit, { paths = [], maxLines = 150 } = {}) {
      const stat = git(['show', '--format=', '--stat', commit.hash]).trim();
      const lines = git(['show', '--format=', '-U3', commit.hash, '--', ...paths.map(spec)]).split(/\r?\n/);
      return { stat, patch: lines.slice(0, maxLines).join('\n') + (lines.length > maxLines ? `\n… [+${lines.length - maxLines} lines]` : '') };
    },

    branches: () =>
      git(['for-each-ref', '--format=%(refname:short)\t%(committerdate:iso-strict)\t%(authorname)', 'refs/heads', 'refs/remotes'])
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => {
          const [name, lastCommit, author] = l.split('\t');
          return { name, lastCommit, author };
        }),

    info(cfg) {
      let baseBranch = cfg.baseBranch;
      if (!baseBranch) {
        try {
          baseBranch = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).trim().replace(/^origin\//, '');
        } catch {
          const local = git(['for-each-ref', '--format=%(refname:short)', 'refs/heads']).split(/\r?\n/);
          baseBranch = ['main', 'master', 'develop'].find((b) => local.includes(b)) ?? local[0] ?? null;
        }
      }
      return {
        branch: git(['rev-parse', '--abbrev-ref', 'HEAD']).trim(),
        baseBranch,
        remotes: git(['remote', '-v']).split(/\r?\n/).filter((l) => l.endsWith('(push)')).map((l) => l.split(/\s+/).slice(0, 2).join(' ')),
      };
    },
  };
}
