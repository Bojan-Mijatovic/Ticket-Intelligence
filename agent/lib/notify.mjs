// Owner notification. With TEAMS_WEBHOOK_URL set (a Teams "Workflows" webhook), an Adaptive Card is posted to the
// channel. Without it, the notification is only recorded as an event and shown on the dashboard as a Teams-style card.

export async function notifyOwner({ key, url, title, handoff, confidence, escalate }) {
  const webhook = process.env.TEAMS_WEBHOOK_URL;
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
  const res = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(adaptive) });
  if (!res.ok) throw new Error(`Teams webhook -> ${res.status}`);
  return { channel: 'teams', card };
}
