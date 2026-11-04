// Picks the version control adapter for a directory: git first, then SVN. Returns null outside a repository.
// Both adapters expose the same read-only interface:
//   kind, root, files(), logByMessage(terms, opts), logByPaths(paths, opts), grep(term, opts),
//   patch(commit, opts), branches(), info(cfg)

import { openGit } from './git.mjs';
import { openSvn } from './svn.mjs';

export function openRepo(dir) {
  return openGit(dir) ?? openSvn(dir);
}
