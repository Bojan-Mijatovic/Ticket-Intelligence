import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiraHealth, describeJiraError, shortReason } from '../lib/jira-health.mjs';

const fail = (status) => Object.assign(new Error(`GET x -> ${status}`), { jiraStatus: status });

/** A fake Jira: `auth` false → myself fails with 401; `hidden` projects → 404; `tickets[key]` → search results. */
function fakeJira({ auth = true, hidden = [], tickets = {} } = {}) {
  const calls = [];
  const jira = {
    state: { auth, hidden, tickets },
    async myself() {
      calls.push('myself');
      if (!jira.state.auth) throw fail(401);
      return { name: 'Agent User' };
    },
    async project(key) {
      calls.push(`project ${key}`);
      if (jira.state.hidden.includes(key)) throw fail(404);
      return { key };
    },
    async search(jql) {
      calls.push(`search ${jql}`);
      return jira.state.tickets[jql.match(/project = (\w+)/)[1]] ?? [];
    },
  };
  return { jira, calls };
}

test('reasons say what to do', () => {
  assert.match(describeJiraError(fail(401)), /credentials rejected \(401\): renew JIRA_API_TOKEN/);
  assert.match(describeJiraError(fail(404), 'LAB'), /project LAB does not exist or this account cannot see it/);
  assert.match(describeJiraError(fail(403), 'LAB'), /no permission \(403\) for project LAB/);
  assert.equal(describeJiraError(new Error('fetch failed')), 'fetch failed');
  assert.equal(shortReason('credentials rejected (401): renew …'), 'credentials rejected (401)');
});

test('rejected credentials: unavailable, and require() refuses with 503', async () => {
  const { jira, calls } = fakeJira({ auth: false });
  const health = createJiraHealth({ jira, projects: ['DEM'] });
  const s = await health.check();
  assert.equal(s.ok, false);
  assert.match(s.error, /401/);
  assert.deepEqual(calls, ['myself'], 'no project or search call after the credentials failed');
  await assert.rejects(health.require(), (e) => e.status === 503 && /^Jira unavailable: credentials rejected/.test(e.message));
});

test('a project the account cannot see makes Jira unavailable (the poll JQL would fail for all projects)', async () => {
  const { jira } = fakeJira({ hidden: ['BIL'], tickets: { DEM: [{ key: 'DEM-1' }] } });
  const s = await createJiraHealth({ jira, projects: ['DEM', 'BIL'] }).check();
  assert.equal(s.ok, false);
  assert.match(s.error, /project BIL does not exist/);
});

test('ok is cached; a failure is checked again on the next call', async () => {
  let t = 0;
  const { jira, calls } = fakeJira({ tickets: { DEM: [{ key: 'DEM-1' }] } });
  const health = createJiraHealth({ jira, projects: ['DEM'], okTtlMs: 1000, now: () => t });
  assert.equal((await health.check()).ok, true);
  await health.check();
  assert.equal(calls.filter((c) => c === 'myself').length, 1, 'cached within the TTL');
  t = 1001;
  await health.check();
  assert.equal(calls.filter((c) => c === 'myself').length, 2, 'checked again after the TTL');

  jira.state.auth = false;
  t = 5000;
  assert.equal((await health.check()).ok, false);
  await health.check();
  assert.equal(calls.filter((c) => c === 'myself').length, 4, 'a failure is never cached');
});

test('onChange fires on a change only: down once, then up', async () => {
  const changes = [];
  let t = 0;
  const { jira } = fakeJira({ auth: false });
  const health = createJiraHealth({ jira, projects: ['DEM'], okTtlMs: 0, now: () => t++, onChange: (now, before) => changes.push(`${before.ok}→${now.ok}`) });
  await health.check();
  await health.check();
  await health.check();
  jira.state.auth = true;
  await health.check();
  await health.check();
  assert.deepEqual(changes, ['null→false', 'false→true']);
});

test('a project that had tickets and now returns none is a warning, not an outage', async () => {
  const seenSaved = [];
  const { jira } = fakeJira({ tickets: { DEM: [{ key: 'DEM-1' }], LAB: [] } });
  const seen = {};
  const health = createJiraHealth({ jira, projects: ['DEM', 'LAB'], seen, okTtlMs: 0, onSeen: (s) => seenSaved.push({ ...s }) });
  let s = await health.check();
  assert.deepEqual([s.ok, s.warnings], [true, []]);
  assert.deepEqual(seenSaved, [{ DEM: true }], 'remembers where tickets were seen');

  jira.state.tickets.DEM = [];
  s = await health.check();
  assert.equal(s.ok, true);
  assert.deepEqual(s.warnings, ['Jira returns no tickets for DEM, which had tickets before']);
  assert.equal(seenSaved.length, 1, 'LAB never had tickets: no warning, nothing to remember');
});

test('two checks at the same time share one probe', async () => {
  const { jira, calls } = fakeJira({ tickets: { DEM: [] } });
  const health = createJiraHealth({ jira, projects: ['DEM'] });
  const [a, b] = await Promise.all([health.check(), health.check()]);
  assert.equal(a, b);
  assert.equal(calls.filter((c) => c === 'myself').length, 1);
});
