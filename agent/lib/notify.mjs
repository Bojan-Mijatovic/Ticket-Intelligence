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

export async function notifyOwner({ key, url, title, handoff, confidence, escalate }) {
  const webhook = String(process.env.TEAMS_WEBHOOK_URL ?? '').trim();
  const card = {
    to: handoff.to,
    title: `${key}: ${title}`,
    message: handoff.message,
    url,
    confidence,
    escalate: escalate?.yes ? escalate.reason : null,
  };
  if (!webhook) return { channel: 'dashboard', card };

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
            { type: 'TextBlock', text: `For ${handoff.to}`, weight: 'Bolder', size: 'Small', color: 'Accent' },
            { type: 'TextBlock', text: card.title, weight: 'Bolder', size: 'Medium', wrap: true },
            { type: 'TextBlock', text: handoff.message, wrap: true },
            ...(card.escalate ? [{ type: 'TextBlock', text: `Escalation: ${card.escalate}`, wrap: true, color: 'Attention' }] : []),
          ],
          actions: [{ type: 'Action.OpenUrl', title: 'Open in Jira', url }],
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
