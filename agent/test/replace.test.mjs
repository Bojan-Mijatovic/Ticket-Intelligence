import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waitUntilIdle } from '../lib/replace.mjs';

/** A running watcher that answers /api/busy from a script of answers, and records what it was asked. */
function fakeWatcher(answers, { old = false } = {}) {
  const calls = [];
  let i = 0;
  const fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    calls.push(`${init.method ?? 'GET'} ${path}${init.body ? ` ${init.body}` : ''}`);
    if (old && (path === '/api/busy' || path === '/api/drain')) return new Response('', { status: 404 });
    if (path === '/api/drain') return Response.json({ ok: true });
    const what = answers[Math.min(i++, answers.length - 1)];
    if (path === '/api/busy') return Response.json({ busy: what.length > 0, what });
    return Response.json({ processing: what.length ? { kind: 'analyze', key: what[0] } : null });
  };
  return { fetch, calls };
}
const clock = () => {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
};

test('--replace waits: no new job, the running one finishes, then idle', async () => {
  const w = fakeWatcher([['fix VAX-17'], ['fix VAX-17'], ['AI review of FAR'], []]);
  const c = clock();
  const said = [];
  const r = await waitUntilIdle({ base: 'http://localhost:7070', waitMs: 15 * 60_000, fetch: w.fetch, ...c, log: (t) => said.push(t) });
  assert.deepEqual([r.idle, r.waitedMs, r.sawBusy], [true, 12_000, true], 'three polls of 4 s');
  assert.equal(w.calls[0], 'POST /api/drain {"on":true}', 'first: no new job');
  assert.deepEqual(said, ['Waiting for the running watcher to finish: fix VAX-17', 'Waiting for the running watcher to finish: AI review of FAR'], 'each change said once');
});

test('--replace gives up after the wait, and puts the old watcher back to work', async () => {
  const w = fakeWatcher([['analyze LAB-24']]);
  const c = clock();
  const r = await waitUntilIdle({ base: 'http://localhost:7070', waitMs: 60_000, fetch: w.fetch, ...c });
  assert.deepEqual([r.idle, r.what], [false, ['analyze LAB-24']]);
  assert.equal(w.calls.at(-1), 'POST /api/drain {"on":false}');
});

test('a request that fails once (a closed keep-alive connection) is asked again, not read as idle', async () => {
  // 2026-11-16: every second poll failed at once; read as "an older watcher", it fell back to /api/status, which does
  // not show an app review, and the watcher was stopped in the middle of one.
  const w = fakeWatcher([['hotspot recommendations'], ['hotspot recommendations'], ['hotspot recommendations'], []]);
  let n = 0;
  const flaky = async (url, init) => (new URL(url).pathname === '/api/busy' && n++ % 2 === 1 ? Promise.reject(new TypeError('fetch failed')) : w.fetch(url, init));
  const r = await waitUntilIdle({ base: 'http://localhost:7070', waitMs: 15 * 60_000, fetch: flaky, ...clock() });
  assert.equal(r.idle, true);
  assert.ok(!w.calls.some((c) => c.includes('/api/status')), 'never took it for an older watcher');
  assert.equal(w.calls.filter((c) => c === 'GET /api/busy').length, 4, 'idle only when it said so');
});

test('an older watcher (no /api/busy): its processing job from /api/status; a watcher that does not answer is idle', async () => {
  const w = fakeWatcher([['LAB-24'], []], { old: true });
  const c = clock();
  const said = [];
  const r = await waitUntilIdle({ base: 'http://localhost:7070', waitMs: 60_000, fetch: w.fetch, ...c, log: (t) => said.push(t) });
  assert.equal(r.idle, true);
  assert.match(said[0], /analyze LAB-24 \(an older watcher: it may start its next job meanwhile\)/);
  const down = await waitUntilIdle({ base: 'http://localhost:7070', waitMs: 60_000, fetch: async () => { throw new TypeError('fetch failed'); }, ...clock() });
  assert.deepEqual([down.idle, down.waitedMs, down.sawBusy], [true, 1200, false], 'asked three times (drain, then busy), then nothing left to protect');
});
