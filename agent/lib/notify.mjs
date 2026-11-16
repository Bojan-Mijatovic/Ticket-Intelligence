// Owner notification. With TEAMS_WEBHOOK_URL set (a Teams "Workflows" webhook), an Adaptive Card is posted to the
// channel. Without it, the notification is only recorded as an event and shown on the dashboard as a Teams-style card.

/**
 * What the dashboard may know about Teams: whether messages go to a real channel, the channel's link
 * (TEAMS_CHANNEL_URL, "Get link to channel" in Teams) for "Open in Teams", and whether owners are @mentioned. Never
 * the webhook address, which is a secret, nor anyone's sign-in name.
 */
export function teamsInfo(env = process.env) {
  const link = String(env.TEAMS_CHANNEL_URL ?? '').trim();
  const live = Boolean(String(env.TEAMS_WEBHOOK_URL ?? '').trim());
  const mentions = live && Boolean(String(env.TEAMS_MENTION_DOMAIN ?? '').trim() || String(env.TEAMS_MENTIONS ?? '').trim());
  return { live, channelUrl: /^https:\/\//i.test(link) ? link : null, mentions };
}

/**
 * The Teams sign-in name (UPN) to @mention for an owner, or null (T4 of docs/GIT_GRAPH.md). TEAMS_MENTIONS names
 * people one by one ("Marta Ricci=marta.ricci@contoso.com; Luca Bianchi=l.bianchi@contoso.com"); TEAMS_MENTION_DOMAIN
 * gives everyone else first.last@domain, accents dropped, but only to a name of two to four capitalised words ("the
 * team" gets none). Without either, nobody is mentioned. A sign-in name Teams does not know costs only the
 * notification: the message still reaches the channel (checked 2026-11-16 on the test tenant with a person who has no
 * account there).
 */
export function mentionFor(name, env = process.env) {
  const who = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!who) return null;
  // The same person is written "Bojan Mijatović" in one commit and "Bojan Mijatovic" in another.
  const same = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toLowerCase();
  for (const entry of String(env.TEAMS_MENTIONS ?? '').split(/[;\n]/)) {
    const at = entry.lastIndexOf('=');
    if (at < 0) continue;
    const upn = entry.slice(at + 1).trim();
    if (same(entry.slice(0, at)) === same(who) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(upn)) return upn;
  }
  const domain = String(env.TEAMS_MENTION_DOMAIN ?? '').trim().replace(/^@/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain) || !/^\p{Lu}[\p{L}'’.-]*( \p{Lu}[\p{L}'’.-]*){1,3}$/u.test(who)) return null;
  const local = who.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/['’]/g, '').split(' ').map((w) => w.replace(/[^a-z0-9-]/g, '')).filter(Boolean).join('.');
  return local ? `${local}@${domain.toLowerCase()}` : null;
}

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : t;
};

/**
 * @param {string} [p.why]    why this person (the analysis' owner.why, when the message goes to that owner): in the
 *                            pilot, "Authored ad0251f (VAX-18), the suspect change in dates.ts" (T5)
 * @param {string} [p.where]  the first file the analysis names, with its line
 */
export async function notifyOwner({ key, url, title, handoff, confidence, escalate, why = null, where = null }) {
  const webhook = String(process.env.TEAMS_WEBHOOK_URL ?? '').trim();
  const upn = mentionFor(handoff.to);
  const card = {
    to: handoff.to,
    title: `${key}: ${title}`,
    message: handoff.message,
    url,
    confidence,
    escalate: escalate?.yes ? escalate.reason : null,
    why: why ? clip(why, 240) : null,
    where: where ? clip(where, 120) : null,
    ...(upn && webhook ? { mentioned: true } : {}), // Teams was asked to @mention the owner; the UPN itself stays here
  };
  if (!webhook) return { channel: 'dashboard', card };

  // T5: why this person, where to look, how sure: what the owner asks first.
  const facts = [card.why && { title: 'Why you', value: card.why }, card.where && { title: 'Where', value: card.where }, confidence && { title: 'Confidence', value: String(confidence) }].filter(Boolean);
  const body = [
    { type: 'TextBlock', text: card.title, weight: 'Bolder', size: 'Medium', wrap: true },
    { type: 'TextBlock', text: handoff.message, wrap: true },
    ...(facts.length ? [{ type: 'FactSet', spacing: 'Medium', facts }] : []),
    ...(card.escalate ? [{ type: 'TextBlock', text: `Escalation: ${card.escalate}`, wrap: true, color: 'Attention' }] : []),
  ];
  return { ...(await post(webhook, adaptiveCard({ to: handoff.to, upn, body, actions: [{ type: 'Action.OpenUrl', title: 'Open in Jira', url }] }))), card };
}

/**
 * T6: the second message, when the fix is ready. The same owner, @mentioned again, with the draft PR, what was checked
 * and the commit that broke it when the bisect found one. Sent only after a verified draft PR: the fix flow stops
 * before opening one otherwise.
 * @param {object} p.checks  the fix's independent checks (fix.mjs): e2e, build, backend
 * @param {object} [p.bisect]  the bisect's result (bisect.mjs): status 'found' with bad { short, author, ticket }
 */
export async function notifyFixReady({ key, url, prUrl, title, to, checks = {}, bisect = null }) {
  const webhook = String(process.env.TEAMS_WEBHOOK_URL ?? '').trim();
  const upn = mentionFor(to);
  const ran = (c) => c && !c.skipped;
  const tests = [
    'a new test failed before the fix and passes after it',
    ran(checks.e2e) && `${checks.e2e.passed} browser tests ${checks.e2e.ok ? 'pass' : 'FAIL'}`,
    ran(checks.backend) && `${checks.backend.passed ?? 'the'} backend tests ${checks.backend.ok ? 'pass' : 'FAIL'}`,
    ran(checks.build) && `the build ${checks.build.ok ? 'passes' : 'FAILS'}`,
  ].filter(Boolean).join('; ');
  const bad = bisect?.status === 'found' ? bisect.bad : null;
  const broke = bad ? `${bad.short}${bad.ticket ? ` (${bad.ticket})` : ''}${bad.author ? ` by ${bad.author}` : ''}` : null;
  const card = {
    kind: 'fix',
    to,
    title: `${key}: fix ready for review`,
    message: clip(title, 200),
    url,
    prUrl,
    tests,
    broke,
    ...(upn && webhook ? { mentioned: true } : {}),
  };
  if (!webhook) return { channel: 'dashboard', card };
  const facts = [{ title: 'Checked', value: tests }, broke && { title: 'Broken by', value: broke }].filter(Boolean);
  const body = [
    { type: 'TextBlock', text: card.title, weight: 'Bolder', size: 'Medium', wrap: true, color: 'Good' },
    { type: 'TextBlock', text: card.message, wrap: true },
    { type: 'FactSet', spacing: 'Medium', facts },
    { type: 'TextBlock', text: 'A draft: nothing is merged until a person reviews it.', wrap: true, isSubtle: true, size: 'Small' },
  ];
  const actions = [prUrl && { type: 'Action.OpenUrl', title: 'Review the pull request', url: prUrl }, { type: 'Action.OpenUrl', title: 'Open in Jira', url }].filter(Boolean);
  return { ...(await post(webhook, adaptiveCard({ to, upn, body, actions }))), card };
}

/** An Adaptive Card for a person, @mentioned when they have a Teams account: the <at> text and its entity must match. */
function adaptiveCard({ to, upn, body, actions }) {
  const at = `<at>${to}</at>`;
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [{ type: 'TextBlock', text: `For ${upn ? at : to}`, weight: 'Bolder', size: 'Small', color: 'Accent' }, ...body],
          actions,
          ...(upn ? { msteams: { entities: [{ type: 'mention', text: at, mentioned: { id: upn, name: to } }] } } : {}),
        },
      },
    ],
  };
}

/** Posts a card. A channel that does not answer must not stop the ticket: the caller shows it on the dashboard, with why. */
async function post(webhook, adaptive) {
  try {
    const res = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(adaptive), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      const said = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 160);
      return { channel: 'failed', status: res.status, error: `Teams webhook -> ${res.status}${said ? ` ${said}` : ''}` };
    }
    return { channel: 'teams', status: res.status };
  } catch (e) {
    return { channel: 'failed', status: null, error: `Teams webhook: ${e.name === 'TimeoutError' ? 'no answer in 15 s' : e.message}` };
  }
}
