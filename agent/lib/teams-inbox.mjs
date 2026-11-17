// ROADMAP #9, T8: what in the team's channel is a question for the agent, for which project, and the answer as Teams
// shows it in the thread. Plain code: no Graph here (lib/teams-graph.mjs), so every rule is tested on its own.
//
// A question is a message that starts with "ti:" or @mentions the agent's account, in a new post or in a thread. In
// the thread of an answer it continues that answer (a follow-up). Anything else in the channel is people talking, and
// the agent leaves it alone: it never answers its own messages, the webhook's cards, a message twice, or the past.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const PREFIX = 'ti';

/**
 * The inbox's own record (agent/state/teams-inbox.json): the team and channel, `since` (questions before it are never
 * answered), the messages handled (the last 500), and the threads with an answer (project, last answer), for a week.
 */
export function readInboxState(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
export function writeInboxState(file, st, now = Date.now()) {
  const threads = Object.fromEntries(Object.entries(st.threads ?? {}).filter(([, t]) => now - Date.parse(t.at) < 7 * 86_400_000));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ ...st, handled: (st.handled ?? []).slice(-500), threads }, null, 2));
}
/** Where reading starts after a sign-in: now for a new channel; for the same one, where it stopped, at most a day back. */
export const startOf = (prev, channelId, now = Date.now()) =>
  prev?.channelId === channelId && prev.since ? new Date(Math.max(Date.parse(prev.since), now - 86_400_000)).toISOString() : new Date(now).toISOString();

const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** A Teams message's text (it is HTML): tags dropped, entities decoded; an @mention of the agent is taken out. */
export function messageText(msg, { me = null } = {}) {
  const mine = new Set((msg?.mentions ?? []).filter((m) => me?.id && m.mentioned?.user?.id === me.id).map((m) => String(m.id)));
  let html = String(msg?.body?.content ?? '').replace(/<at id="(\d+)">([\s\S]*?)<\/at>/g, (x, id, name) => (mine.has(id) ? '' : name));
  if (msg?.body?.contentType === 'html') html = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]+>/g, '');
  return { text: decode(html).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim(), mentionsMe: mine.size > 0 };
}

/**
 * The question in a message for the agent, or null: a person's message that starts with "ti:" or @mentions it. A post's
 * subject counts too (a channel post may have one, and people write in it): "ti: VAX-21" as the subject, with or
 * without a text under it.
 */
export function questionOf(msg, { me = null, prefix = PREFIX } = {}) {
  if (!msg || msg.deletedDateTime || (msg.messageType && msg.messageType !== 'message')) return null;
  if (!msg.from?.user?.id) return null; // an app or the webhook (the agent's own cards), not a person
  if (me?.id && msg.from.user.id === me.id) return null; // never its own replies
  const { text, mentionsMe } = messageText(msg, { me });
  const ask = (t) => t.match(new RegExp(`^${prefix}\\s*:\\s*([\\s\\S]+)$`, 'i'))?.[1] ?? null;
  const subject = decode(String(msg.subject ?? '')).trim();
  const fromSubject = subject && ask(subject);
  const asked = ask(text) ?? (fromSubject ? `${fromSubject} ${text}` : null) ?? (mentionsMe ? text : null);
  const q = asked?.replace(/\s+/g, ' ').trim();
  return q && q.length >= 2 ? q.slice(0, 500) : null;
}

/**
 * The project of a question: "MediLab: who knows the order code?" or "LAB: …" names it; otherwise the thread's, or the
 * channel's. A ticket key or a page's address in the question picks its own project later, in Ask itself.
 */
export function projectOf(question, projects, fallback) {
  const m = String(question).match(/^([\p{L}\p{N} ._-]{2,30}):\s*([\s\S]+)$/u);
  if (m) {
    const want = m[1].trim().toLowerCase();
    const p = projects.find((x) => x.key.toLowerCase() === want || String(x.name ?? '').toLowerCase() === want);
    if (p) return { project: p.key, question: m[2].trim(), named: true };
  }
  return { project: fallback, question: String(question).trim(), named: false };
}

/**
 * The new questions of one read, oldest first: in posts and in their replies, newer than `since` (the inbox's start:
 * the past is never answered), not yet handled.
 * @param {object[]} roots  Graph channel messages, each with its `replies`
 */
export function newQuestions(roots, { me = null, since, handled = [], prefix = PREFIX } = {}) {
  const done = new Set(handled);
  const from = Date.parse(since);
  const out = [];
  for (const root of roots ?? []) {
    for (const m of [root, ...(root.replies ?? [])]) {
      if (!m?.id || done.has(m.id) || !(Date.parse(m.createdDateTime) > from)) continue;
      const question = questionOf(m, { me, prefix });
      if (question) out.push({ id: m.id, rootId: root.id, inThread: m !== root, question, from: { id: m.from.user.id, name: m.from.user.displayName ?? 'someone' }, at: m.createdDateTime });
    }
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The answer as a reply in the thread: the asker @mentioned (Teams notifies them; a Claude answer takes a minute), the
 * text, the sources as links, and how it was made. `answer` comes masked.
 */
export function answerHtml({ answer, sources = [], found = true }, { asker = null, projectName, how, givenAgain = false, followUp = false }) {
  const links = sources.slice(0, 8).map((s) => (s.url ? `<a href="${esc(s.url)}">${esc(s.ref)}</a>` : esc(s.ref)));
  return [
    asker ? `<at id="0">${esc(asker.name)}</at>` : '',
    `${asker ? ' ' : ''}${esc(answer).replace(/\n/g, '<br>')}`,
    links.length ? `<br><br><b>Sources:</b> ${links.join(' · ')}` : '',
    `<br><i>${esc(projectName)} · ${found ? 'answered' : 'not found'} ${esc(how)}${givenAgain ? ', given again (asked before; main has not changed)' : ''}${followUp ? ', following the answer above' : ''} · reply with "${PREFIX}: …" to ask more</i>`,
  ].join('');
}

/** The mention of the asker that goes with answerHtml's <at id="0">. */
export const mentionOf = (asker) => (asker?.id ? [{ id: 0, mentionText: asker.name, mentioned: { user: { id: asker.id, displayName: asker.name, userIdentityType: 'aadUser' } } }] : []);

/** A short line in the thread (working on it, busy, not answered), as Teams shows it. */
export const noteHtml = (text) => `<i>${esc(text)}</i>`;
