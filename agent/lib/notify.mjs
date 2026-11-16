// Owner notification. With TEAMS_WEBHOOK_URL set (a Teams "Workflows" webhook), an Adaptive Card is posted to the
// channel. Without it, the notification is only recorded as an event and shown on the dashboard as a Teams-style card.

/**
 * What the dashboard may know about Teams: whether messages go to a real channel, and the channel's link
 * (TEAMS_CHANNEL_URL, "Get link to channel" in Teams) for "Open in Teams". Never the webhook address: it is a secret.
 */
export function teamsInfo(env = process.env) {
  const link = String(env.TEAMS_CHANNEL_URL ?? '').trim();
  return { live: Boolean(String(env.TEAMS_WEBHOOK_URL ?? '').trim()), channelUrl: /^https:\/\//i.test(link) ? link : null };
}

/**
 * The Teams sign-in name (UPN) to @mention for an owner, or null (T4 of docs/GIT_GRAPH.md). TEAMS_MENTIONS names
 * people one by one ("Marta Ricci=marta.ricci@contoso.com; Luca Bianchi=l.bianchi@contoso.com"); TEAMS_MENTION_DOMAIN
 * gives everyone else first.last@domain, accents dropped, but only to a name of two to four capitalised words ("the
 * team" gets none). Without either, nobody is mentioned. A wrong UPN is not refused by the webhook, which answers 202
 * before the workflow runs: the workflow fails afterwards and the message never reaches the channel.
 */
export function mentionFor(name, env = process.env) {
  const who = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!who) return null;
  for (const entry of String(env.TEAMS_MENTIONS ?? '').split(/[;\n]/)) {
    const at = entry.lastIndexOf('=');
    if (at < 0) continue;
    const upn = entry.slice(at + 1).trim();
    if (entry.slice(0, at).trim().replace(/\s+/g, ' ').toLowerCase() === who.toLowerCase() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(upn)) return upn;
  }
  const domain = String(env.TEAMS_MENTION_DOMAIN ?? '').trim().replace(/^@/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain) || !/^\p{Lu}[\p{L}'’.-]*( \p{Lu}[\p{L}'’.-]*){1,3}$/u.test(who)) return null;
  const local = who.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/['’]/g, '').split(' ').map((w) => w.replace(/[^a-z0-9-]/g, '')).filter(Boolean).join('.');
  return local ? `${local}@${domain.toLowerCase()}` : null;
}

export async function notifyOwner({ key, url, title, handoff, confidence, escalate }) {
  const webhook = String(process.env.TEAMS_WEBHOOK_URL ?? '').trim();
  const upn = mentionFor(handoff.to);
  const card = {
    to: handoff.to,
    title: `${key}: ${title}`,
    message: handoff.message,
    url,
    confidence,
    escalate: escalate?.yes ? escalate.reason : null,
    ...(upn && webhook ? { mentioned: true } : {}), // Teams was asked to @mention the owner; the UPN itself stays here
  };
  if (!webhook) return { channel: 'dashboard', card };

  // The mention: the <at> text in the card and the entity that ties it to the person must match exactly.
  const at = `<at>${handoff.to}</at>`;
  const adaptive = {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            { type: 'TextBlock', text: `For ${upn ? at : handoff.to}`, weight: 'Bolder', size: 'Small', color: 'Accent' },
            { type: 'TextBlock', text: card.title, weight: 'Bolder', size: 'Medium', wrap: true },
            { type: 'TextBlock', text: handoff.message, wrap: true },
            ...(card.escalate ? [{ type: 'TextBlock', text: `Escalation: ${card.escalate}`, wrap: true, color: 'Attention' }] : []),
          ],
          actions: [{ type: 'Action.OpenUrl', title: 'Open in Jira', url }],
          ...(upn ? { msteams: { entities: [{ type: 'mention', text: at, mentioned: { id: upn, name: handoff.to } }] } } : {}),
        },
      },
    ],
  };
  // A channel that does not answer must not stop the ticket: the message is still shown on the dashboard, with why.
  try {
    const res = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(adaptive), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      const said = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 160);
      return { channel: 'failed', card, status: res.status, error: `Teams webhook -> ${res.status}${said ? ` ${said}` : ''}` };
    }
    return { channel: 'teams', card, status: res.status };
  } catch (e) {
    return { channel: 'failed', card, status: null, error: `Teams webhook: ${e.name === 'TimeoutError' ? 'no answer in 15 s' : e.message}` };
  }
}
