import assert from 'node:assert/strict';
import net from 'node:net';
import { test } from 'node:test';
import { buildMessage, encodeHeader, mailProblems, mailSettings, sendMail } from '../lib/mail.mjs';
import { attachMailUpdates, composeUpdate } from '../lib/mail-updates.mjs';

/** A plain-text SMTP server on localhost that records the conversation. `reject` answers one command with an error. */
function fakeSmtp({ reject } = {}) {
  const sessions = [];
  const server = net.createServer((sock) => {
    const s = { commands: [], data: '' };
    sessions.push(s);
    let buf = '';
    let inData = false;
    sock.write('220 fake ESMTP\r\n');
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      for (;;) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end < 0) return;
          s.data = buf.slice(0, end);
          buf = buf.slice(end + 5);
          inData = false;
          sock.write('250 queued\r\n');
          continue;
        }
        const i = buf.indexOf('\r\n');
        if (i < 0) return;
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        s.commands.push(line);
        const verb = line.split(/[ :]/)[0].toUpperCase();
        if (reject && verb === reject.verb) sock.write(`${reject.reply}\r\n`);
        else if (verb === 'EHLO') sock.write('250-fake\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n');
        else if (verb === 'AUTH') sock.write('235 ok\r\n');
        else if (verb === 'DATA') {
          inData = true;
          sock.write('354 go\r\n');
        } else if (verb === 'QUIT') {
          sock.write('221 bye\r\n');
          sock.end();
        } else sock.write('250 ok\r\n');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, sessions, close: () => server.close() })));
}

const local = (port, extra = {}) => mailSettings({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), SMTP_SECURE: 'none', MAIL_FROM: 'agent@example.com', MAIL_TO: 'dev@example.com', ...extra });

const decodeParts = (raw) => [...raw.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g)].map((m) => Buffer.from(m[1].replace(/\r\n/g, ''), 'base64').toString('utf8'));

test('settings: Gmail defaults, app password spaces removed, recipients split', () => {
  const s = mailSettings({ SMTP_USER: 'me@gmail.com', SMTP_PASS: 'abcd efgh ijkl mnop', MAIL_TO: 'a@x.com, b@y.com' });
  assert.equal(s.host, 'smtp.gmail.com');
  assert.equal(s.port, 465);
  assert.equal(s.secure, 'tls');
  assert.equal(s.pass, 'abcdefghijklmnop');
  assert.equal(s.from, 'me@gmail.com');
  assert.deepEqual(s.to, ['a@x.com', 'b@y.com']);
  assert.deepEqual(mailProblems(s), []);
  assert.equal(mailSettings({ SMTP_PORT: '587' }).secure, 'starttls');
});

test('settings: problems are named; a password is never sent unencrypted to another host', () => {
  assert.match(mailProblems(mailSettings({})).join(' | '), /MAIL_TO is not set.*SMTP_USER/);
  assert.match(mailProblems(mailSettings({ MAIL_TO: 'not-an-address', SMTP_USER: 'a@b.com', SMTP_PASS: 'x' })).join(), /invalid address/);
  const plain = mailSettings({ SMTP_HOST: 'mail.example.com', SMTP_PORT: '25', SMTP_USER: 'a@b.com', SMTP_PASS: 'x', MAIL_TO: 'c@d.com' });
  assert.match(mailProblems(plain).join(), /unencrypted/);
});

test('message: subject encoded (UTF-8, no header injection), both parts decode back', () => {
  const { raw } = buildMessage({ from: 'a@b.com', to: ['c@d.com'], subject: 'DEM-7 · Struttura: čćžšđ\r\nBcc: evil@x.com', text: 'Zdravo ✓', html: '<p>Zdravo ✓</p>' });
  const subject = raw.match(/^Subject: (.*(?:\r\n .*)*)/m)[1];
  assert.doesNotMatch(raw, /^Bcc:/m);
  const decoded = [...subject.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)].map((m) => Buffer.from(m[1], 'base64').toString('utf8')).join('');
  assert.equal(decoded, 'DEM-7 · Struttura: čćžšđ Bcc: evil@x.com');
  for (const line of raw.split('\r\n')) assert.ok(line.length <= 78, `line too long: ${line}`);
  assert.deepEqual(decodeParts(raw), ['Zdravo ✓', '<p>Zdravo ✓</p>']);
  assert.equal(encodeHeader('plain subject'), 'plain subject');
});

test('sendMail: full SMTP conversation against a local server', async () => {
  const srv = await fakeSmtp();
  try {
    const r = await sendMail({ subject: 'Hello', text: 'body', html: '<b>body</b>' }, local(srv.port, { MAIL_TO: 'one@example.com;two@example.com' }));
    assert.deepEqual(r.to, ['one@example.com', 'two@example.com']);
    const [s] = srv.sessions;
    assert.deepEqual(s.commands.map((c) => c.split(':')[0]), ['EHLO ticket-intelligence', 'MAIL FROM', 'RCPT TO', 'RCPT TO', 'DATA', 'QUIT']);
    assert.match(s.data, /^Subject: Hello$/m);
    assert.deepEqual(decodeParts(s.data), ['body', '<b>body</b>']);
  } finally {
    srv.close();
  }
});

test('sendMail: the server refusal is reported, the password is not', async () => {
  const srv = await fakeSmtp({ reject: { verb: 'AUTH', reply: '535 5.7.8 Username and Password not accepted' } });
  try {
    await assert.rejects(
      sendMail({ subject: 's', text: 't' }, local(srv.port, { SMTP_USER: 'me@example.com', SMTP_PASS: 'secret-pass' })),
      (e) => /535/.test(e.message) && /app password/.test(e.message) && !e.message.includes('secret-pass'),
    );
  } finally {
    srv.close();
  }
});

test('sendMail: not configured → no connection attempt', async () => {
  await assert.rejects(sendMail({ subject: 's', text: 't' }, mailSettings({})), /email not configured: MAIL_TO is not set/);
});

const RESULT = {
  ticket: 'DEM-7',
  title: '[FE] Struttura field keeps the old structure',
  summary: 'Clearing the field by hand leaves the old structure in the search.',
  likelyCause: 'agenda-search.store.ts appends structures (DEM-2398).',
  confidence: 'high',
  component: 'frontend/src/app/features/agenda',
  proposedFix: 'Reset the store when the field is emptied.',
  owner: { name: 'Sara Colombo', why: 'fixed DEM-5' },
  escalate: { yes: true, reason: 'reopened once' },
  nextSteps: ['Emit structureCleared — Sara', 'Add a regression test — Sara'],
  handoff: { to: 'Sara Colombo', message: 'Hi Sara, <b>DEM-7</b> needs you.' },
  reporterReply: 'We are on it.',
  duplicateOf: { key: 'DEM-5', why: 'same store bug' },
};

test('compose: analysis update carries owner, cause, fix, steps, drafts; HTML is escaped', () => {
  const m = composeUpdate({ type: 'analyzed', key: 'DEM-7', result: RESULT }, { title: RESULT.title, url: 'https://jira/browse/DEM-7' });
  assert.equal(m.subject, '[DEM-7] Analysis ready · high confidence · [FE] Struttura field keeps the old structure');
  for (const part of ['Recommended person: Sara Colombo', 'Escalate: yes · reopened once', 'LIKELY CAUSE', '1. Emit structureCleared — Sara', 'DEM-5: same store bug', '> We are on it.', 'https://jira/browse/DEM-7']) {
    assert.ok(m.text.includes(part), `text misses: ${part}`);
  }
  assert.ok(m.html.includes('&lt;b&gt;DEM-7&lt;/b&gt;'));
  assert.ok(!m.html.includes('<b>DEM-7</b>'));
});

test('compose: fix, review and failure updates; other events are not mailed', () => {
  const fix = composeUpdate({ type: 'fix-proposed', key: 'DEM-7', text: 'draft PR ready: DEM-7: reset store', url: 'https://github.com/o/r/pull/3', files: ['a.ts'], checks: { e2e: { ok: true, passed: 12, failed: 0 }, backend: { ok: true, skipped: true } } }, {});
  assert.match(fix.subject, /^\[DEM-7\] Draft fix PR ready$/);
  assert.match(fix.text, /browser tests: passed \(12 passed, 0 failed\)/);
  assert.match(fix.text, /backend tests \(mvn test\): not needed/);
  const rev = composeUpdate({ type: 'reviewed', key: 'DEM-7', url: 'u', review: { risk: 'high', verdict: 'needs-changes', summary: 's', testsCoverTheBug: { yes: false, why: 'no assert' }, findings: [{ file: 'a.ts', line: 3, severity: 'major', comment: 'wrong' }] } }, {});
  assert.match(rev.subject, /risk high · needs-changes/);
  assert.match(rev.text, /Review the findings first|Review the findings before/);
  assert.match(rev.text, /\[major\] a\.ts:3: wrong/);
  assert.match(rev.text, /Test covers the bug: no · no assert/);
  assert.match(composeUpdate({ type: 'failed', key: 'DEM-9', text: 'timeout' }, {}).text, /timeout/);
  assert.equal(composeUpdate({ type: 'progress', key: 'DEM-7' }, {}), null);
});

test('updates: Jira unavailable is mailed once, without a ticket', async () => {
  const events = memoryEvents();
  const sent = [];
  const mail = attachMailUpdates({ events, policy: { actions: { emailUpdates: 'auto' } }, cfg: {}, browseUrl: (k) => `https://jira/browse/${k}`, settings: local(1), send: async (msg) => sent.push(msg) });
  events.emit('jira-down', { text: 'Jira unavailable: credentials rejected (401): renew JIRA_API_TOKEN' });
  events.emit('error', { text: 'Jira still unavailable: …' });
  await mail.flush();
  assert.deepEqual(sent.map((m) => m.subject), ['Jira unavailable · the agent is paused']);
  assert.match(sent[0].text, /^Ticket Intelligence agent\n/);
  assert.match(sent[0].text, /renew JIRA_API_TOKEN/);
  assert.doesNotMatch(sent[0].text, /undefined|jira\/browse/);
});

function memoryEvents() {
  const subs = new Set();
  const log = [];
  return {
    log,
    emit(type, data = {}) {
      const ev = { at: new Date().toISOString(), type, ...data };
      log.push(ev);
      for (const fn of subs) fn(ev);
      return ev;
    },
    subscribe(fn) {
      subs.add(fn);
    },
  };
}

test('updates: mails the configured milestones one by one, with the title from queued; reports failures as events', async () => {
  const events = memoryEvents();
  const sent = [];
  const send = async (msg) => {
    if (msg.subject.includes('fix stopped')) throw new Error('535 not accepted');
    sent.push(msg);
  };
  const mail = attachMailUpdates({ events, policy: { actions: { emailUpdates: 'auto' } }, cfg: {}, browseUrl: (k) => `https://jira/browse/${k}`, settings: local(1), send });
  assert.equal(mail.enabled, true);
  events.emit('queued', { key: 'DEM-7', text: 'Struttura field bug' });
  events.emit('progress', { key: 'DEM-7', step: 'reading' });
  events.emit('analyzed', { key: 'DEM-7', result: { ...RESULT, title: undefined } });
  events.emit('fix-failed', { key: 'DEM-7', text: 'fix: test still fails' });
  await mail.flush();
  assert.deepEqual(sent.map((m) => m.subject), ['[DEM-7] Analysis ready · high confidence · Struttura field bug']);
  assert.deepEqual(sent[0].to, ['dev@example.com']);
  assert.deepEqual(events.log.filter((e) => /^mail/.test(e.type)).map((e) => [e.type, e.for]), [['mailed', 'analyzed'], ['mail-failed', 'fix-failed']]);
});

test('updates: off by policy or without settings, with the reason', () => {
  const base = { events: memoryEvents(), cfg: {}, browseUrl: () => '' };
  assert.match(attachMailUpdates({ ...base, policy: { actions: {} }, settings: local(1) }).reason, /emailUpdates is "off"/);
  assert.match(attachMailUpdates({ ...base, policy: { actions: { emailUpdates: 'auto' } }, settings: mailSettings({}) }).reason, /MAIL_TO is not set/);
});
