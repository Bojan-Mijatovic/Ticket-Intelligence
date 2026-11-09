// Picks the version control adapter for a directory: the repository nearest to it, git or SVN. Returns null outside
// a repository. An SVN working copy inside a git repository (or the other way round) is the inner one: the outer
// repository only holds it as files.
// Both adapters expose the same read-only interface:
//   kind, root, files(), logByMessage(terms, opts), logByPaths(paths, opts), grep(term, opts),
//   patch(commit, opts), branches(), info(cfg)

import { resolve } from 'node:path';
import { openGit } from './git.mjs';
import { openSvn } from './svn.mjs';

/** The nearer of two repository roots that both contain the directory: the longer path. */
export function nearer(a, b) {
  if (!a || !b) return a ?? b ?? null;
  return resolve(b.root).length > resolve(a.root).length ? b : a;
}

export function openRepo(dir) {
  return nearer(openGit(dir), openSvn(dir));
}
