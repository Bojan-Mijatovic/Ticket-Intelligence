// `watcher.mjs --replace` waits for the running watcher's work instead of killing it in the middle (2026-11-16: three
// restarts in an afternoon killed two paid app reviews, and the same kill in the middle of a fix leaves a half-made
// branch and worktree). The running watcher is asked to take no new job (POST /api/drain); the new one waits until it
// says it is idle (GET /api/busy), then stops it. A watcher older than this has neither: then its /api/status is read
// (processing). It gives up after `waitMs`, puts the old watcher back to work, and says how to force it.

/**
 * @param {string} p.base       the running watcher, http://localhost:<dashboardPort>
 * @param {number} p.waitMs     how long to wait before giving up
 * @param {(text: string) => void} [p.log]
 * @returns {Promise<{ idle: boolean, what: string[], waitedMs: number, sawBusy: boolean }>} sawBusy: it waited for a job
 */
export async function waitUntilIdle({ base, waitMs, log = () => {}, fetch = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), everyMs = 4000 }) {
  /**
   * { body } an answer · { missing } the watcher has no such route (older code) · { down } no answer after three
   * tries. A single failed request is not an answer: Node closes an idle keep-alive connection after 5 s, and a request
   * that reuses it fails at once ("fetch failed"). With a 5 s poll every second one did, the old code read that as "an
   * older watcher", asked /api/status, which does not show an app review, and stopped the watcher in the middle of it.
   */
  const ask = async (path, init) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(10_000) });
        if (res.status === 404) return { missing: true };
        if (res.ok) return { body: await res.json() };
      } catch {
        /* a closed connection or a timeout: ask again */
      }
      if (attempt < 3) await sleep(300);
    }
    return { down: true };
  };
  const drain = async (on) => Boolean((await ask('/api/drain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on }) })).body);
  /** What the running watcher is doing; [] when it is idle, or does not answer at all (nothing left to protect then). */
  const busy = async () => {
    const b = await ask('/api/busy');
    if (b.body) return b.body.what ?? [];
    if (b.down) return [];
    const s = await ask('/api/status'); // an older watcher (no /api/busy): only its current queue job is known
    const p = s.body?.processing;
    return p ? [`${p.kind ?? 'job'} ${p.key ?? ''}`.trim()] : [];
  };
  const started = now();
  const drained = await drain(true);
  let said = '';
  let sawBusy = false;
  for (;;) {
    const what = await busy();
    if (!what.length) return { idle: true, what: [], waitedMs: now() - started, sawBusy };
    sawBusy = true;
    if (now() - started >= waitMs) {
      if (drained) await drain(false);
      return { idle: false, what, waitedMs: now() - started, sawBusy };
    }
    const line = what.join(', ');
    if (line !== said) log(`Waiting for the running watcher to finish: ${line}${drained ? '' : ' (an older watcher: it may start its next job meanwhile)'}`);
    said = line;
    await sleep(everyMs);
  }
}
