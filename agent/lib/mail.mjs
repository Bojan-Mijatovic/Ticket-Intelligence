// Minimal SMTP client (no npm dependencies): implicit TLS (port 465), STARTTLS (587), AUTH PLAIN, one
// multipart/alternative message (plain text + HTML, UTF-8, base64). Settings come from the per-user .env:
//   SMTP_HOST (default smtp.gmail.com), SMTP_PORT (default 465), SMTP_SECURE (tls | starttls | none),
//   SMTP_USER, SMTP_PASS (for Gmail: an app password), MAIL_FROM (default SMTP_USER), MAIL_TO (comma separated).

import net from 'node:net';
import tls from 'node:tls';
import { randomBytes } from 'node:crypto';

const ADDRESS = /^[^\s<>@,;"]+@[^\s<>@,;"]+\.[^\s<>@,;"]+$/;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

export function mailSettings(env = process.env) {
  const port = Number(env.SMTP_PORT || 465);
  const host = (env.SMTP_HOST || 'smtp.gmail.com').trim();
  // Google shows app passwords in groups of four ("abcd efgh ijkl mnop"); the spaces are not part of it.
  const pass = /gmail\.com$/i.test(host) ? String(env.SMTP_PASS ?? '').replace(/\s+/g, '') : String(env.SMTP_PASS ?? '');
  return {
    host,
    port,
    secure: (env.SMTP_SECURE || (port === 465 ? 'tls' : port === 587 ? 'starttls' : 'none')).toLowerCase(),
    user: (env.SMTP_USER || '').trim(),
    pass,
    from: (env.MAIL_FROM || env.SMTP_USER || '').trim(),
    to: String(env.MAIL_TO ?? '').split(/[,;]/).map((s) => s.trim()).filter(Boolean),
  };
}

/** What is missing or wrong in the settings, as readable reasons (empty = ready to send). */
export function mailProblems(s) {
  const out = [];
  if (!s.to.length) out.push('MAIL_TO is not set');
  for (const a of s.to) if (!ADDRESS.test(a)) out.push(`MAIL_TO has an invalid address: ${a}`);
  if (!s.from) out.push('MAIL_FROM or SMTP_USER is not set');
  else if (!ADDRESS.test(s.from)) out.push(`MAIL_FROM is not an address: ${s.from}`);
  if (!LOOPBACK.has(s.host) && (!s.user || !s.pass)) out.push('SMTP_USER and SMTP_PASS are not set');
  if (!['tls', 'starttls', 'none'].includes(s.secure)) out.push(`SMTP_SECURE must be tls, starttls or none (is ${s.secure})`);
  if (s.secure === 'none' && s.user && !LOOPBACK.has(s.host)) out.push('SMTP_SECURE=none would send the password unencrypted; use tls or starttls');
  return out;
}

// ---------------------------------------------------------------- message

const oneLine = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
const wrap76 = (b64) => b64.replace(/.{76}/g, '$&\r\n');

/** RFC 2047 encoded words of at most 39 UTF-8 bytes each, so every header line stays under 78 characters. */
export function encodeHeader(value) {
  const text = oneLine(value);
  if (/^[\x20-\x7e]*$/.test(text) && text.length <= 70) return text;
  const words = [];
  let chunk = '';
  for (const ch of text) {
    if (Buffer.byteLength(chunk + ch) > 39) {
      words.push(chunk);
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w).toString('base64')}?=`).join('\r\n ');
}

export function buildMessage({ from, fromName = 'Ticket Intelligence', to, subject, text, html, date = new Date() }) {
  const domain = from.split('@')[1] || 'localhost';
  const messageId = `<${randomBytes(12).toString('hex')}@${domain}>`;
  const boundary = `ti-${randomBytes(9).toString('hex')}`;
  const part = (type, body) => [
    `--${boundary}`,
    `Content-Type: ${type}; charset=utf-8`,
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(body, 'utf8').toString('base64')),
  ];
  const lines = [
    `From: ${encodeHeader(fromName)} <${from}>`,
    `To: ${to.join(', ')}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    ...part('text/plain', text),
    ...(html ? part('text/html', html) : []),
    `--${boundary}--`,
    '',
  ];
  return { raw: lines.join('\r\n'), messageId };
}

// ---------------------------------------------------------------- SMTP conversation

class Conversation {
  constructor(socket) {
    this.buf = '';
    this.lines = [];
    this.replies = [];
    this.waiters = [];
    this.error = null;
    this.onData = (d) => this.receive(d);
    this.onError = (e) => this.fail(e);
    this.onClose = () => this.fail(new Error('the SMTP server closed the connection'));
    this.attach(socket);
  }

  attach(socket) {
    this.detach();
    this.socket = socket;
    socket.on('data', this.onData);
    socket.on('error', this.onError);
    socket.on('close', this.onClose);
  }

  detach() {
    if (!this.socket) return;
    this.socket.off('data', this.onData);
    this.socket.off('error', this.onError);
    this.socket.off('close', this.onClose);
  }

  receive(d) {
    this.buf += d.toString('utf8');
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, '');
      this.buf = this.buf.slice(i + 1);
      this.lines.push(line);
      // The last line of a reply is "250 text" (or just "250"); continuation lines are "250-text".
      if (/^\d{3}(?: |$)/.test(line)) {
        const reply = { code: Number(line.slice(0, 3)), text: this.lines.map((l) => l.slice(4)).join(' ').trim() };
        this.lines = [];
        const w = this.waiters.shift();
        if (w) w.resolve(reply);
        else this.replies.push(reply);
      }
    }
  }

  fail(e) {
    if (this.error) return;
    this.error = e;
    for (const w of this.waiters.splice(0)) w.reject(e);
  }

  read() {
    if (this.replies.length) return Promise.resolve(this.replies.shift());
    if (this.error) return Promise.reject(this.error);
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  async expect(codes, what) {
    const r = await this.read();
    if (!codes.includes(r.code)) throw new Error(`SMTP ${what}: ${r.code} ${r.text}`);
    return r;
  }

  async cmd(line, codes, shown = line.split(' ')[0]) {
    this.socket.write(`${line}\r\n`);
    return this.expect(codes, shown);
  }
}

function open(s, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = s.secure === 'tls'
      ? tls.connect({ host: s.host, port: s.port, servername: s.host }, () => resolve(socket))
      : net.connect({ host: s.host, port: s.port }, () => resolve(socket));
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error(`SMTP timeout after ${timeoutMs / 1000} s`)));
    socket.once('error', reject);
  });
}

function upgrade(socket, host, timeoutMs) {
  return new Promise((resolve, reject) => {
    const secure = tls.connect({ socket, servername: host }, () => resolve(secure));
    secure.setTimeout(timeoutMs, () => secure.destroy(new Error(`SMTP timeout after ${timeoutMs / 1000} s`)));
    secure.once('error', reject);
  });
}

/**
 * Sends one message. Resolves to { messageId, to } or throws with the server's answer. The password never appears in
 * an error message.
 */
export async function sendMail({ to, subject, text, html }, settings = mailSettings(), { timeoutMs = 30_000 } = {}) {
  const s = { ...settings, to: to?.length ? to : settings.to };
  const problems = mailProblems(s);
  if (problems.length) throw new Error(`email not configured: ${problems.join('; ')}`);
  const { raw, messageId } = buildMessage({ from: s.from, to: s.to, subject, text, html });

  const c = new Conversation(await open(s, timeoutMs));
  try {
    await c.expect([220], 'greeting');
    await c.cmd('EHLO ticket-intelligence', [250]);
    if (s.secure === 'starttls') {
      await c.cmd('STARTTLS', [220]);
      c.detach();
      c.attach(await upgrade(c.socket, s.host, timeoutMs));
      await c.cmd('EHLO ticket-intelligence', [250]);
    }
    if (s.user && s.pass) {
      await c.cmd(`AUTH PLAIN ${Buffer.from(`\0${s.user}\0${s.pass}`).toString('base64')}`, [235], 'AUTH (check SMTP_USER and SMTP_PASS; Gmail needs an app password)');
    }
    await c.cmd(`MAIL FROM:<${s.from}>`, [250]);
    for (const r of s.to) await c.cmd(`RCPT TO:<${r}>`, [250, 251], `RCPT TO ${r}`);
    await c.cmd('DATA', [354]);
    // Dot-stuffing: a line that starts with "." gets a second one.
    await c.cmd(`${raw.replace(/^\./gm, '..')}\r\n.`, [250], 'message');
    await c.cmd('QUIT', [221]).catch(() => {});
    return { messageId, to: s.to };
  } finally {
    c.detach();
    c.socket.destroy();
  }
}
