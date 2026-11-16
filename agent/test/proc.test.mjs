import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { killTree } from '../lib/proc.mjs';

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (ok, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (ok()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return ok();
};

test('killTree ends the program under the shell, not only the shell (VAX-17)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'proc-'));
  try {
    const pidFile = join(dir, 'pid');
    const script = join(dir, 'busy.js');
    writeFileSync(script, `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`);
    // As the watcher spawns claude and mvn: through a shell, so the program is a grandchild.
    const child = spawn(`"${process.execPath}"`, [`"${script}"`], { shell: true, windowsHide: true, stdio: 'ignore' });
    const closed = new Promise((r) => child.on('close', r));
    assert.ok(await until(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').length > 0, 10_000), 'the program started');
    const pid = Number(readFileSync(pidFile, 'utf8'));
    assert.ok(alive(pid));

    killTree(child);
    await closed;
    assert.ok(await until(() => !alive(pid), 5_000), 'the program under the shell is gone too');
    killTree(child); // a second call after the exit is harmless
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test('killTree on a missing child does nothing', () => {
  killTree(null);
  killTree(undefined);
});
