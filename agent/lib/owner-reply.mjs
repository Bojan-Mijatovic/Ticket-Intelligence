// ROADMAP #9, part C (T10): the owner's answer to the agent's handoff in Teams. Under the agent's card for a ticket
// (lib/notify.mjs notifyOwner, or the "fix ready" card), the person it was for replies "preuzimam" / "I take it" (the
// ticket is assigned to them in Jira) or "nije moje: <who>" / "not mine: <who>" (Jira says so, and the agent hands the
// ticket to that person in the same thread, @mentioned). Named with its ticket ("preuzimam VAX-21") it counts anywhere
// the agent is addressed, like a decision on a fix. Plain code here; the watcher reads the channel and acts.

import { agentThread, cardOf, fold, fromPerson } from './fix-approval.mjs';
import { questionOf } from './teams-inbox.mjs';

const END = '(?![\\p{L}\\d])[\\s.!:,;–-]*([\\s\\S]*)$';
const TAKE = new RegExp(`^(preuzimam|preuze[cć]u|uzimam|moje je|moj je|ja [cć]u|i take it|i'?ll take it|taking it|on it|prendo io|lo prendo|me ne occupo)${END}`, 'iu');
const NOT_MINE = new RegExp(`^(nije moje|nije moj|nije za mene|nije meni|not mine|not me|not my ticket|non (?:è|e) mio|non (?:è|e) mia|non (?:è|e) per me|non mi riguarda)${END}`, 'iu');
// Words people put before the name: "nije moje, pitaj Irenu", "not mine: try Irene", "non è mio, chiedi a Irene".
const LEAD = /^(?:nego|ve[cć]|probaj|pitaj|daj|dajte|za|to je|try|ask|it'?s|give it to|for|prova|chiedi a|[eè] di|per)\s+/i;
const KEY = /^([A-Z][A-Z0-9_]+-\d+)(?![\p{L}\d-])[\s.!:,;–-]*([\s\S]*)$/iu;

const whoOf = (rest) => {
  let t = String(rest ?? '').trim();
  for (let i = 0; i < 3 && LEAD.test(t); i++) t = t.replace(LEAD, '').trim();
  t = t.replace(/^@/, '').replace(/[.!?]+$/, '').trim();
  return t && t.length <= 80 ? t : null;
};

/**
 * The owner's answer in a text, in Serbian, English or Italian: { verdict: 'take', note } or
 * { verdict: 'not-mine', who }, with `key` when it names its ticket right after the words ("preuzimam VAX-21",
 * "nije moje VAX-21: Irene Fabbri"). "ti:" before it is allowed. Null for anything else.
 */
export function ownerReplyOf(text) {
  const t = String(text ?? '').trim().replace(/^ti\s*:\s*/i, '');
  const take = t.match(TAKE);
  const notMine = take ? null : t.match(NOT_MINE);
  const m = take ?? notMine;
  if (!m) return null;
  let rest = m[2].trim();
  const keyed = rest.match(KEY);
  const key = keyed ? keyed[1].toUpperCase() : null;
  if (keyed) rest = keyed[2].trim();
  if (take) return { verdict: 'take', ...(key ? { key } : {}), note: rest.replace(/\s+/g, ' ').slice(0, 300) || null };
  return { verdict: 'not-mine', ...(key ? { key } : {}), who: whoOf(rest) };
}

/**
 * A message's text for the owner's answer: the agent's own @mention out (people write "@Ticket Intelligence
 * preuzimam"), other people's mentions kept as their names, the HTML out. `people`: the other people it @mentions,
 * { id, name }, in order.
 */
export function messageWords(m, me = null) {
  const mentions = m?.mentions ?? [];
  const people = [];
  const html = String(m?.body?.content ?? '').replace(/<at id="(\d+)">([\s\S]*?)<\/at>/g, (_, id, name) => {
    const user = mentions.find((x) => String(x.id) === id)?.mentioned?.user;
    if (user?.id && me?.id && user.id === me.id) return ' ';
    if (user?.id && !people.some((p) => p.id === user.id)) people.push({ id: user.id, name: user.displayName ?? name });
    return ` ${name} `;
  });
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return { text, people };
}

/**
 * The owner's answers of one read, oldest first:
 * - a reply under one of the agent's cards (handoff or fix ready): about the card's ticket, or the one it names;
 * - one that names its ticket, as a new post to the agent ("ti: preuzimam VAX-21", or an @mention) or as a reply in a
 *   thread the agent has answered in; its card is the ticket's newest handoff card among the posts read, if any.
 * `misplaced`: one without a ticket in an agent thread that is not under a card, where it cannot be told which ticket
 * it is about (the agent says how to write it instead of saying nothing).
 * @returns {{ replies: object[], misplaced: object[] }}
 */
export function ownerReplies(roots, { me = null, since, handled = [] } = {}) {
  const done = new Set(handled);
  const from = Date.parse(since);
  const fresh = (m) => m?.id && !done.has(m.id) && !m.deletedDateTime && Date.parse(m.createdDateTime) > from && fromPerson(m, me);
  const handoffs = new Map();
  for (const root of roots ?? []) {
    const c = cardOf(root);
    if (c?.kind === 'handoff' && !(Date.parse(handoffs.get(c.key)?.at) >= Date.parse(root.createdDateTime))) handoffs.set(c.key, { card: c, at: root.createdDateTime });
  }
  const replies = [];
  const misplaced = [];
  const add = (m, rootId, reply, card) => {
    const { people } = messageWords(m, me);
    const named = reply.verdict === 'not-mine' ? people[0] ?? null : null; // an @mention says who better than words
    replies.push({
      id: m.id, rootId, key: card.key, card, verdict: reply.verdict,
      ...(reply.verdict === 'take' ? { note: reply.note } : { who: named?.name ?? reply.who, whoId: named?.id ?? null }),
      from: { id: m.from.user.id, name: m.from.user.displayName ?? 'someone' }, at: m.createdDateTime,
    });
  };
  const keyedCard = (key) => handoffs.get(key)?.card ?? { kind: 'handoff', key, to: null, toUpn: null };
  for (const root of roots ?? []) {
    const card = cardOf(root);
    if (card) {
      for (const r of root.replies ?? []) {
        if (!fresh(r)) continue;
        const reply = ownerReplyOf(messageWords(r, me).text);
        if (reply) add(r, root.id, reply, reply.key && reply.key !== card.key ? keyedCard(reply.key) : card);
      }
      continue;
    }
    const asked = fresh(root) ? questionOf(root, { me }) : null; // a new post counts only when it is to the agent
    const first = asked ? ownerReplyOf(asked) : null;
    if (first?.key) add(root, root.id, first, keyedCard(first.key));
    if (!agentThread(root, me)) continue; // people talking
    for (const r of root.replies ?? []) {
      if (!fresh(r)) continue;
      const reply = ownerReplyOf(messageWords(r, me).text);
      if (reply?.key) add(r, root.id, reply, keyedCard(reply.key));
      else if (reply) misplaced.push({ id: r.id, rootId: root.id, verdict: reply.verdict, from: { id: r.from.user.id, name: r.from.user.displayName ?? 'someone' }, at: r.createdDateTime });
    }
  }
  const byTime = (a, b) => Date.parse(a.at) - Date.parse(b.at);
  return { replies: replies.sort(byTime), misplaced: misplaced.sort(byTime) };
}

/**
 * Whether the sender may take or hand on the ticket: the person the card was for, a person it was handed on to since
 * (`handedTo`, names), or one of `approvers` (agent.config.json teams.approvers). Without a card's person (a keyed
 * answer whose card was not among the posts read), only the last two.
 */
export function mayAnswer({ sender, card, approvers = [], handedTo = [] }) {
  const name = fold(sender?.displayName);
  const upn = String(sender?.userPrincipalName ?? '').toLowerCase();
  if (card?.toUpn && upn && upn === String(card.toUpn).toLowerCase()) return true;
  if (name && card?.to && fold(card.to) === name) return true;
  if (name && handedTo.some((n) => fold(n) === name)) return true;
  return approvers.some((a) => fold(a) && (fold(a) === name || fold(a) === upn));
}

/**
 * A Jira user among `users` ({ accountId, name }) with the same name as a Teams person: letters and case aside, so
 * "Bojan Mijatović" in Teams is "Bojan MIjatovic" in Jira. Null when none or more than one match.
 */
export function sameNameUser(users, name) {
  const want = fold(name);
  const hits = (users ?? []).filter((u) => want && fold(u.name) === want);
  return hits.length === 1 ? hits[0] : null;
}
