// Status updates by email: listens to the agent's events and mails one message per milestone of a ticket (analysis
// ready, draft fix PR, fix stopped, AI review, documentation PR, failures). Recipients: MAIL_TO in the per-user .env
// (a test or team inbox; every update goes there). Policy: actions.emailUpdates = auto | off. Sends one message at a
// time, after the event, so a slow or failing mail server never holds up a ticket; the outcome is an event
// (`mailed` / `mail-failed`).

import { mailProblems, mailSettings, sendMail } from './mail.mjs';

export const DEFAULT_ON = ['analyzed', 'fix-proposed', 'fix-failed', 'reviewed', 'documented', 'doc-failed', 'failed'];

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

/**
 * One update as sections, rendered to plain text and HTML. Returns null for an event that is not mailed.
 * @param {object} ev     the agent event
 * @param {{title?: string, url?: string}} ctx  the ticket's title and Jira link
 */
export function composeUpdate(ev, { title, url } = {}) {
  const key = ev.key;
  const name = title ? `${key} · ${title}` : key;
  const s = [];
  let subject;
  let lead;

  switch (ev.type) {
    case 'analyzed': {
      const r = ev.result ?? {};
      subject = `[${key}] Analysis ready · ${r.confidence ?? '?'} confidence${title ? ` · ${title}` : ''}`;
      lead = 'The agent finished its first analysis of this ticket.';
      s.push({ facts: [
        ['Recommended person', r.handoff?.to || r.owner?.name || 'no clear owner'],
        ['Why', r.owner?.why],
        ['Confidence', r.confidence],
        ['Escalate', r.escalate ? (r.escalate.yes ? `yes · ${r.escalate.reason ?? ''}` : 'no') : null],
        ['Component', r.component],
      ] });
      s.push({ h: 'Summary', p: r.summary });
      s.push({ h: 'Likely cause', p: r.likelyCause });
      s.push({ h: 'Proposed fix', p: r.proposedFix });
      if (r.nextSteps?.length) s.push({ h: 'Next steps', ol: r.nextSteps });
      if (r.duplicateOf?.key) s.push({ h: 'Possible duplicate', p: `${r.duplicateOf.key}: ${r.duplicateOf.why ?? ''}` });
      if (r.relatedTickets?.length) s.push({ h: 'Related tickets', ul: r.relatedTickets.slice(0, 6).map((t) => `${t.key}: ${t.why ?? ''}`) });
      if (r.handoff?.message) s.push({ h: `Handoff message${r.handoff.to ? ` for ${r.handoff.to}` : ''}`, quote: r.handoff.message });
      if (r.reporterReply) s.push({ h: 'Draft reply to the reporter (not sent)', quote: r.reporterReply });
      break;
    }
    case 'fix-proposed': {
      subject = `[${key}] Draft fix PR ready${title ? ` · ${title}` : ''}`;
      lead = 'The bug was reproduced by a failing test, fixed on a branch, and every check passed again in a clean run. A person reviews and merges; the agent never merges.';
      s.push({ facts: [['Pull request', ev.url ?? 'branch pushed, no PR link'], ['Change', ev.text?.replace(/^draft PR ready: /, '')]] });
      if (ev.checks) s.push({ h: 'Checks', ul: checkLines(ev.checks) });
      if (ev.files?.length) s.push({ h: 'Changed files', ul: ev.files.slice(0, 15) });
      break;
    }
    case 'fix-failed':
      subject = `[${key}] Automatic fix stopped${title ? ` · ${title}` : ''}`;
      lead = 'The agent could not produce a verified fix. The analysis stays valid; a person takes it from here.';
      s.push({ h: 'Reason', p: ev.text });
      if (ev.checks) s.push({ h: 'Checks', ul: checkLines(ev.checks) });
      break;
    case 'reviewed': {
      const r = ev.review ?? {};
      subject = `[${key}] AI review · risk ${r.risk ?? '?'} · ${r.verdict ?? ''}`.trim();
      lead = r.risk === 'high' || r.verdict === 'needs-changes' ? 'Review the findings before approving the pull request.' : 'A second, read-only agent reviewed the pull request.';
      s.push({ facts: [['Pull request', ev.url], ['Risk', r.risk], ['Verdict', r.verdict], ['Test covers the bug', fmtCover(r.testsCoverTheBug)]] });
      s.push({ h: 'Summary', p: r.summary });
      if (r.findings?.length) {
        s.push({ h: 'Findings', ul: r.findings.slice(0, 10).map((f) => `${f.severity ? `[${f.severity}] ` : ''}${f.file ? `${f.file}${f.line ? `:${f.line}` : ''}: ` : ''}${clip(f.comment ?? '', 400)}`) });
      }
      break;
    }
    case 'documented':
      subject = `[${key}] Documentation PR ready${title ? ` · ${title}` : ''}`;
      lead = 'The ticket is Done. Its cause and fix were written to the project knowledge docs, on a branch for review.';
      s.push({ facts: [['Pull request', ev.url]] });
      if (ev.files?.length) s.push({ h: 'Files', ul: ev.files });
      break;
    case 'doc-failed':
      subject = `[${key}] Documentation failed${title ? ` · ${title}` : ''}`;
      lead = 'The ticket is Done, but the agent could not write its documentation.';
      s.push({ h: 'Reason', p: ev.text });
      break;
    case 'failed':
      subject = `[${key}] Analysis failed${title ? ` · ${title}` : ''}`;
      lead = 'The agent could not analyze this ticket; nothing was posted to Jira. "Run again" on the dashboard retries it.';
      s.push({ h: 'Reason', p: ev.text });
      break;
    default:
      return null;
  }

  return { subject: clip(subject, 180), ...render({ name, url, lead, sections: s }) };
}

function checkLines(checks) {
  const label = { e2e: 'browser tests', build: 'ng build', backend: 'backend tests (mvn test)' };
  return Object.entries(checks).map(([k, c]) => {
    if (!c || typeof c !== 'object') return `${label[k] ?? k}: ${c}`;
    if (c.skipped) return `${label[k] ?? k}: not needed`;
    const counts = c.passed !== undefined ? ` (${c.passed} passed, ${c.failed ?? 0} failed)` : '';
    return `${label[k] ?? k}: ${c.ok ? 'passed' : 'FAILED'}${counts}${c.firstError ? ` · ${clip(c.firstError, 200)}` : ''}`;
  });
}

function fmtCover(t) {
  if (t == null) return null;
  if (typeof t !== 'object') return String(t);
  return `${t.yes ? 'yes' : 'no'}${t.why ? ` · ${t.why}` : ''}`;
}

const FOOTER = 'Ticket Intelligence agent · automated message, please verify before acting on it.';

function render({ name, url, lead, sections }) {
  const text = [name, url, '', lead].filter((l) => l != null);
  const html = [
    '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2328;max-width:720px">',
    `<div style="font-size:17px;font-weight:600">${url ? `<a href="${esc(url)}" style="color:#0b57d0;text-decoration:none">${esc(name)}</a>` : esc(name)}</div>`,
    `<p style="margin:6px 0 14px;color:#57606a">${esc(lead)}</p>`,
  ];
  for (const sec of sections) {
    if (sec.facts) {
      const rows = sec.facts.filter(([, v]) => v != null && v !== '');
      if (!rows.length) continue;
      text.push('', ...rows.map(([k, v]) => `${k}: ${v}`));
      html.push('<table style="border-collapse:collapse;margin:0 0 12px">');
      for (const [k, v] of rows) {
        const cell = /^https?:\/\//.test(String(v)) ? `<a href="${esc(v)}">${esc(v)}</a>` : esc(v);
        html.push(`<tr><td style="padding:2px 14px 2px 0;color:#57606a;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:2px 0">${cell}</td></tr>`);
      }
      html.push('</table>');
      continue;
    }
    const empty = !sec.p && !sec.quote && !sec.ul?.length && !sec.ol?.length;
    if (empty) continue;
    text.push('', sec.h.toUpperCase());
    html.push(`<div style="font-weight:600;margin:14px 0 4px">${esc(sec.h)}</div>`);
    if (sec.p) {
      text.push(String(sec.p));
      html.push(`<div style="white-space:pre-wrap">${esc(sec.p)}</div>`);
    }
    if (sec.quote) {
      text.push(...String(sec.quote).split('\n').map((l) => `> ${l}`));
      html.push(`<div style="white-space:pre-wrap;border-left:3px solid #d0d7de;padding:4px 0 4px 10px;color:#424a53">${esc(sec.quote)}</div>`);
    }
    for (const [tag, items] of [['ul', sec.ul], ['ol', sec.ol]]) {
      if (!items?.length) continue;
      text.push(...items.map((it, i) => `${tag === 'ol' ? `${i + 1}.` : '-'} ${it}`));
      html.push(`<${tag} style="margin:0;padding-left:22px">${items.map((it) => `<li>${esc(it)}</li>`).join('')}</${tag}>`);
    }
  }
  text.push('', '--', FOOTER);
  html.push(`<p style="margin-top:20px;font-size:12px;color:#8c959f">${esc(FOOTER)}</p></div>`);
  return { text: text.join('\n'), html: html.join('\n') };
}

/**
 * Subscribes to the event log and mails updates. Returns { enabled, reason?, to?, flush() }; flush() resolves when
 * every queued message has been handled (for one-shot scripts that exit afterwards).
 */
export function attachMailUpdates({ events, policy, cfg, browseUrl, settings = mailSettings(), send = sendMail }) {
  const off = (reason) => ({ enabled: false, reason, flush: async () => {} });
  const mode = policy.actions?.emailUpdates ?? 'off';
  if (mode !== 'auto') return off(`emailUpdates is "${mode}" in policy.json`);
  const problems = mailProblems(settings);
  if (problems.length) return off(problems.join('; '));

  const on = new Set(cfg.mail?.on ?? DEFAULT_ON);
  const titles = new Map();
  let chain = Promise.resolve();

  events.subscribe((ev) => {
    if (!ev.key) return;
    if ((ev.type === 'queued' || ev.type === 'picked') && ev.text) titles.set(ev.key, ev.text);
    if (ev.type === 'analyzed' && ev.result?.title) titles.set(ev.key, ev.result.title);
    if (!on.has(ev.type)) return;
    const msg = composeUpdate(ev, { title: titles.get(ev.key), url: browseUrl(ev.key) });
    if (!msg) return;
    chain = chain.then(async () => {
      try {
        await send({ ...msg, to: settings.to }, settings);
        events.emit('mailed', { key: ev.key, text: `email to ${settings.to.join(', ')}: ${msg.subject}`, subject: msg.subject, for: ev.type });
      } catch (e) {
        events.emit('mail-failed', { key: ev.key, text: `email not sent (${ev.type}): ${e.message}`, for: ev.type });
      }
    });
  });

  return { enabled: true, to: settings.to, on: [...on], flush: () => chain };
}
