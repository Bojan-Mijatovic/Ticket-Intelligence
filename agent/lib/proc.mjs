// Stopping a child process for good. On Windows the watcher spawns through a shell (shell: true), so child.kill()
// ends only cmd.exe: the program under it (claude, mvn, ng serve) keeps running, keeps its working folder open and
// keeps writing to the pipe. VAX-17 showed it: a fix run hit its time limit, the worktree could not be removed (EBUSY)
// and the orphaned agent went on for minutes after the job had ended. taskkill /T ends the whole tree.

import { execFileSync } from 'node:child_process';

/** Ends `child` and everything it started. Safe to call twice or after the child has exited. */
export function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    try {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      return;
    } catch {
      /* already gone, or taskkill refused: fall back to the plain kill */
    }
  }
  try {
    child.kill();
  } catch {
    /* already gone */
  }
}
