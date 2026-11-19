// The slides of the guided tour and of the presentation (?present, ?deck), with what is said on them.
//
// ?tour shows a few of them over the dashboard (problem, pipeline, ai, work, system1, built). ?present is the
// presentation of docs/PRESENTATION_PLAN.md, about seventeen minutes: what it is (1–3), how it works under the hood
// (4–11), one case whole (12–25: slides here, the dashboard steps in tour.js), one question live in Teams (26), the
// close (27–30), and backup slides after the end. ?deck is the same without the dashboard: a timeline slide stands in
// for the case's dashboard steps.
//
// tour.js plays them: `TourSlides.slides[name](ctx)` is a slide's HTML, `TourSlides.deck(ctx)` the steps. ctx: { full,
// mode, deck (agent.config.json "presentation"), facts (/api/tour/facts), impact (/api/impact), askStats
// (/api/ask/stats), suite (/api/insights/suite), insights ({ KEY: /api/insights }), teams, apps, cases }. Every number
// on a slide comes from these records; a slide says less when a record is missing, never more.
// Elements with data-r="n" appear one group after another (the tour's slides); the presentation's own slides have none,
// so a slide is shown whole and stays until it is done.

(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
  const pct = (p) => `${Math.round(100 * (p ?? 0))} %`;
  const pctWord = (p) => `${Math.round(100 * (p ?? 0))} percent`;
  /** 118 → "1:58" (on a slide). */
  const mmss = (s) => (s == null ? '–' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
  /** 118 → "one minute fifty-eight"-like words for the voice: "1 minute 58". */
  const spokenTime = (s) => (s == null ? '' : s < 60 ? `${s} seconds` : `${plural(Math.floor(s / 60), 'minute')}${s % 60 ? ` ${s % 60}` : ''}`);
  const usd = (x) => `$${Number(x ?? 0).toFixed(2)}`;
  const nOf = (x) => (x ? `${x.n} of ${x.of}` : '–');
  const firstSentence = (s, max = 200) => {
    const t = String(s ?? '').replace(/\s+/g, ' ').trim();
    const m = t.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? t;
    return m.length > max ? `${m.slice(0, max).replace(/\s+\S*$/, '')}…` : m;
  };
  const noParens = (s) => String(s ?? '').replace(/\s*\([^()]*\)/g, '').replace(/\s+([.,;:])/g, '$1');
  const plainTitle = (s) => String(s ?? '').replace(/^(\s*\[[^\]]+\])+\s*-?\s*/, '');
  const fileName = (p) => String(p ?? '').split(/[/\\]/).pop();
  const longDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) : '');
  const isoDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  /** The time of day `secs` after `iso` ("16:06"), as Teams shows a post's time. */
  const clock = (iso, secs) => (iso && secs != null ? new Date(Date.parse(iso) + secs * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
  const initialsOf = (name) => String(name ?? '?').split(/\s+/).map((p) => p[0] ?? '').join('').slice(0, 2).toUpperCase();
  /** The first `n` sentences (a dot in "Schedule.java:28" does not end one). */
  const sentencesOf = (s, n) => (String(s ?? '').replace(/\s+/g, ' ').trim().match(/.+?[.!?](?=\s|$)/g) ?? [String(s ?? '')]).slice(0, n).map((x) => x.trim()).join(' ');

  const css = `
    #tour-slide { position: fixed; z-index: 62; left: 50%; transform: translateX(-50%); width: min(1120px, calc(100vw - 32px)); overflow: auto;
      background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 18px; padding: 26px 30px 24px;
      box-shadow: 0 20px 50px rgb(0 0 0 / .3); }
    #tour-slide .kick { color: var(--accent); font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; }
    #tour-slide h1 { font-size: 26px; line-height: 1.25; margin: 4px 0 6px; }
    #tour-slide .lead { color: var(--muted); font-size: 15px; margin: 0 0 18px; }
    #tour-slide [data-r] { opacity: 0; transform: translateY(10px); transition: opacity .55s ease, transform .55s ease; }
    #tour-slide [data-r].on { opacity: 1; transform: none; }
    #tour-slide ul, #tour-slide ol { margin: 0; padding-left: 20px; }
    #tour-slide li { margin: 4px 0; font-size: 14px; }
    #tour-slide code { background: var(--code); padding: 1px 5px; border-radius: 4px; }
    .ts-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .ts-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
    .ts-grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .ts-grid.four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .ts-card { border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; background: var(--surface-2); font-size: 14px; }
    .ts-card h3 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--accent); }
    .ts-card p { margin: 0 0 6px; }
    .ts-card .sub { color: var(--muted); }
    .ts-goal { margin-top: 16px; border-left: 4px solid var(--ok); background: var(--ok-soft); padding: 12px 16px; border-radius: 0 10px 10px 0; font-size: 15px; }
    .ts-goal.note { border-left-color: var(--accent); background: var(--accent-soft); }
    .ts-goal.warn { border-left-color: var(--warn); background: var(--warn-soft); }
    .ts-big { font-size: 28px; font-weight: 800; color: var(--text); font-variant-numeric: tabular-nums; }
    .ts-flow { display: grid; gap: 12px; }
    .ts-row { display: grid; grid-template-columns: 120px 1fr; gap: 12px; align-items: center; }
    .ts-row .lbl { font-weight: 800; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; transition: color .4s; }
    .ts-nodes { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .ts-node { border: 1.5px solid var(--border); border-radius: 10px; padding: 7px 11px; background: var(--surface-2); font-size: 13px; font-weight: 650;
      transition: border-color .4s, background .4s, box-shadow .4s; transition-delay: 0s; }
    .ts-node small { display: block; font-weight: 500; color: var(--muted); font-size: 11.5px; }
    .ts-node.ai::before { content: "✦ "; color: var(--teams); }
    .ts-node.person { border-color: var(--ok); }
    .ts-node.done { border-color: var(--ok); background: var(--ok-soft); }
    .ts-node.done::after { content: " ✓"; color: var(--ok); }
    .ts-arrow { color: var(--muted); font-weight: 700; }
    .ts-row.hot .lbl { color: var(--accent); }
    .ts-row.hot .ts-node { border-color: var(--accent); background: var(--accent-soft); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
      transition-delay: calc(var(--i, 0) * 260ms); }
    .ts-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 14px; } /* separate: a hidden row hides its borders too */
    .ts-table th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); padding: 6px 10px; border-bottom: 2px solid var(--border); }
    .ts-table td { padding: 9px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
    .ts-table td.num { font-weight: 750; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .ts-table .res { color: var(--ok); font-weight: 750; }
    .ts-table .open { color: var(--warn); font-weight: 650; }
    .ts-chip { display: inline-block; padding: 1px 9px; border-radius: 999px; font-size: .85em; font-weight: 750; white-space: nowrap; }
    .ts-chip.acts { background: var(--ok-soft); color: var(--ok); }
    .ts-chip.shadow { background: var(--surface-2); color: var(--muted); border: 1px solid var(--border); }
    .ts-src { columns: 2; column-gap: 28px; margin: 0; padding-left: 18px; }
    .ts-src li { break-inside: avoid; }
    .ts-src a { display: block; font-size: .88em; overflow-wrap: anywhere; }
    .ts-title { display: grid; gap: 10px; }
    .ts-title .logo { width: 64px; height: 64px; border-radius: 16px; background: linear-gradient(135deg, var(--accent), var(--teams)); display: grid; place-items: center; color: #fff; font-size: 32px; }
    .ts-title .who { color: var(--muted); margin-top: 18px; font-size: 16px; }
    .ts-title .who b { color: var(--text); }

    /* The eight steps: the life of a ticket (slide 3), then a small map at the top of every slide under the hood. */
    .ts-map { display: flex; flex-wrap: wrap; gap: 5px; margin: 0 0 12px; }
    .ts-map span { padding: 2px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 700; color: var(--muted); background: var(--surface-2); border: 1px solid var(--border); }
    .ts-map span.on { color: #fff; background: var(--accent); border-color: var(--accent); }
    .ts-life { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .ts-life .st { border: 1.5px solid var(--border); border-radius: 12px; padding: 12px 14px; background: var(--surface-2); display: grid; gap: 4px; align-content: start; }
    .ts-life .n { width: 28px; height: 28px; border-radius: 50%; background: var(--accent); color: #fff; display: grid; place-items: center; font-weight: 800; font-size: 14px; }
    .ts-life b { font-size: 15px; }
    .ts-life small { color: var(--muted); font-size: 13px; }

    /* Architecture (slide 4). */
    .ts-arch { display: grid; grid-template-columns: 1fr 1.5fr 1fr; gap: 16px; align-items: center; }
    .ts-arch .side { display: grid; gap: 10px; }
    .ts-arch .sys { border: 1.5px solid var(--border); border-radius: 12px; padding: 10px 14px; background: var(--surface-2); font-weight: 750; }
    .ts-arch .sys small, .ts-arch .layer small, .ts-arch .core-h small { display: block; font-weight: 500; color: var(--muted); font-size: .85em; }
    .ts-arch .core { border: 2px solid var(--accent); border-radius: 16px; padding: 14px; display: grid; gap: 10px; background: var(--accent-soft); }
    .ts-arch .core-h { font-weight: 800; font-size: 1.1em; }
    .ts-arch .layer { border-radius: 10px; padding: 10px 12px; background: var(--surface); border: 1px solid var(--border); }
    .ts-arch .layer.s1 { border-left: 5px solid var(--teams); }
    .ts-arch .layer.ai { border-left: 5px solid var(--accent); }
    .ts-arch .layer.code { border-left: 5px solid var(--ok); }

    /* System 1's answers as bars (slide 5). */
    .ts-bars { display: grid; gap: 9px; }
    .ts-bars .b { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr) 6em; gap: 12px; align-items: center; font-size: .95em; }
    .ts-bars .q { color: var(--muted); }
    .ts-bars .q b { color: var(--text); font-weight: 650; }
    .ts-bars .track { display: block; position: relative; height: 12px; border-radius: 6px; background: var(--surface); border: 1px solid var(--border); overflow: hidden; }
    .ts-bars .fill { display: block; height: 100%; background: var(--accent); border-radius: 6px; }
    .ts-bars .was { position: absolute; top: -2px; bottom: -2px; width: 3px; background: var(--muted); }
    .ts-bars .v { font-weight: 800; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .ts-steps { margin: 0; padding-left: 1.4em; display: grid; gap: 6px; }
    .ts-steps li { padding-left: 4px; }
    .ts-steps small { color: var(--muted); }

    /* A quote from a ticket or a comment. */
    .ts-quote { border-left: 4px solid var(--border); padding: 6px 12px; margin: 6px 0; background: var(--surface); border-radius: 0 8px 8px 0; white-space: pre-line; font-size: .95em; }
    .ts-quote.masked { border-left-color: var(--ok); }
    .ts-mask { background: var(--ok-soft); color: var(--ok); font-weight: 750; border-radius: 4px; padding: 0 3px; }
    .ts-pii { background: var(--warn-soft); color: var(--warn); font-weight: 750; border-radius: 4px; padding: 0 3px; }

    /* Teams, drawn from the recorded cards and answers (slide 20). */
    .ts-teams { display: grid; gap: 8px; }
    .ts-teams .post { border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 8px 14px; }
    .ts-teams .post .who { font-size: .8em; font-weight: 800; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 4px; }
    .ts-teams .card { border-left: 4px solid var(--teams); }
    .ts-teams .reply { margin-left: 28px; }
    .ts-teams .reply.me { border-left: 4px solid var(--ok); }
    .ts-teams .btn { display: inline-block; margin-top: 6px; padding: 3px 10px; border-radius: 6px; border: 1px solid var(--teams); color: var(--teams); font-size: .85em; font-weight: 700; }
    .ts-teams pre { margin: 4px 0 0; white-space: pre-wrap; font: inherit; font-size: .9em; color: var(--text); }
    .ts-pending { display: inline-block; margin-left: 6px; padding: 1px 8px; border-radius: 999px; background: var(--warn-soft); color: var(--warn); font-size: .75em; font-weight: 800; letter-spacing: .04em; vertical-align: middle; }

    /* A timeline of the case (?deck only), and tiles with one number each. */
    .ts-time { display: grid; grid-template-columns: 5.5em 1fr; gap: 6px 14px; font-size: .98em; }
    .ts-time .t { font-weight: 800; font-variant-numeric: tabular-nums; color: var(--accent); text-align: right; }
    .ts-tile { display: grid; gap: 6px; align-content: start; }
    .ts-tile .ts-big { line-height: 1.1; }
    .ts-tile .k { font-size: .82em; font-weight: 800; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }

    /* Beats (tour.js lightBeat): the part being said is lit, the parts not said yet are faint, the ones said stay. */
    #tour-slide [data-b] { transition: opacity .45s ease, box-shadow .45s ease, background-color .45s ease, transform .45s ease; }
    #tour-slide [data-b].pend { opacity: .25; }
    #tour-slide [data-b].lit:not(tr):not(li):not(td):not(th) { box-shadow: 0 0 0 3px var(--accent), 0 14px 32px rgb(0 0 0 / .18); transform: translateY(-3px); position: relative; z-index: 1; }
    #tour-slide li[data-b].lit { background: var(--accent-soft); border-radius: 8px; box-shadow: 0 0 0 2px var(--accent); }
    #tour-slide tr[data-b].lit > td { background: var(--accent-soft); }
    #tour-slide tr[data-b].lit > td:first-child { box-shadow: inset 4px 0 0 var(--accent); }
    #tour-slide td[data-b].lit, #tour-slide th[data-b].lit { background: var(--accent-soft); box-shadow: inset 0 0 0 2px var(--accent); }
    #tour-slide .ts-bars .fill { transition: width .9s cubic-bezier(.3, .7, .2, 1); }
    #tour-slide [data-b].pend .fill { width: 0 !important; }

    /* Teams, drawn the way Teams shows it: the channel, the app's posts and cards, the replies in the thread. The texts
       are the agent's own records. In a slide, a post arrives when it is said. */
    .tm-app { border: 1px solid var(--border); border-radius: 14px; overflow: hidden; background: var(--surface-2); box-shadow: 0 10px 30px rgb(0 0 0 / .12); text-align: left; }
    .tm-top { display: flex; align-items: center; gap: 10px; padding: 9px 16px; background: var(--surface); border-bottom: 1px solid var(--border); }
    .tm-logo { width: 28px; height: 28px; border-radius: 7px; background: var(--teams); color: #fff; display: grid; place-items: center; font-weight: 800; flex: none; }
    .tm-logo.sm { width: 18px; height: 18px; border-radius: 4px; font-size: 11px; display: inline-grid; vertical-align: -3px; }
    .tm-chan { font-weight: 800; }
    .tm-tabs { display: flex; gap: 16px; margin-left: 12px; color: var(--muted); font-size: .9em; }
    .tm-tabs .on { color: var(--text); font-weight: 700; box-shadow: inset 0 -3px 0 var(--teams); padding-bottom: 3px; }
    .tm-feed { display: grid; gap: 12px; padding: 14px 16px; align-items: start; }
    .tm-feed.two { grid-template-columns: 1.15fr 1fr; }
    .tm-msg { display: grid; grid-template-columns: 38px minmax(0, 1fr); gap: 10px; }
    .tm-av { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; font-size: .78em; color: #fff; background: #0f7b6c; flex: none; }
    .tm-av.bot { background: linear-gradient(135deg, var(--accent), var(--teams)); border-radius: 9px; }
    .tm-av.owner { background: #c4314b; }
    .tm-post { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 10px 14px; min-width: 0; }
    .tm-meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; font-size: .8em; color: var(--muted); margin-bottom: 4px; }
    .tm-meta b { color: var(--text); font-size: 1.12em; }
    .tm-tag { font-size: .78em; font-weight: 800; padding: 0 5px; border-radius: 4px; border: 1px solid var(--border); color: var(--muted); }
    .tm-card { border: 1px solid var(--border); border-left: 4px solid var(--teams); border-radius: 8px; padding: 10px 12px; margin-top: 4px; display: grid; gap: 6px; }
    .tm-at { color: var(--teams); font-weight: 800; }
    .tm-title { font-weight: 800; }
    .tm-kv { font-size: .92em; } .tm-kv > span { color: var(--muted); font-weight: 800; margin-right: 6px; }
    .tm-btns { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 2px; } .tm-btns span { border: 1px solid var(--border); border-radius: 6px; padding: 3px 10px; font-weight: 700; font-size: .86em; background: var(--surface-2); }
    .tm-thread { margin-top: 10px; border-top: 1px solid var(--border); padding-top: 8px; display: grid; gap: 8px; }
    .tm-reply { display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 8px; }
    .tm-reply .tm-av { width: 28px; height: 28px; font-size: .68em; }
    .tm-app pre { margin: 2px 0 0; white-space: pre-wrap; font: inherit; font-size: .92em; }
    .tm-when.hot { color: #fff; background: var(--teams); border-radius: 999px; padding: 0 8px; font-weight: 800; }
    #tour-slide .tm-app [data-b] { transition: opacity .5s ease, transform .5s ease, background-color .5s ease; }
    #tour-slide .tm-app [data-b].pend { opacity: 0; transform: translateY(14px); }
    #tour-slide .tm-app [data-b].lit { box-shadow: none; transform: none; }
    #tour-slide .tm-app .tm-msg[data-b].lit > .tm-post, #tour-slide .tm-app .tm-reply[data-b].lit { background: var(--teams-soft); border-radius: 8px; }
    #tour-slide.full .tm-app { font-size: clamp(14px, 1.1vw, 19px); }
    @media (max-width: 1100px) { .tm-feed.two { grid-template-columns: 1fr; } }

    /* Over the dashboard (tour.js #tour-teams): the owner's phone rings, then the post as Teams shows it. */
    #tour-teams { position: fixed; z-index: 61; width: min(700px, 52vw); opacity: 0; transform: translateY(16px) scale(.98); transition: opacity .45s ease, transform .45s ease; pointer-events: none; font-size: clamp(15px, 1.25vw, 22px); line-height: 1.4; }
    #tour-teams.on { opacity: 1; transform: none; }
    #tour-teams.phone { width: auto; }
    .tm-phone { height: clamp(300px, 52vh, 600px); aspect-ratio: 9 / 18; border-radius: 38px; background: linear-gradient(160deg, #1d2440, #3a2f5c 60%, #5b5fc7); border: 10px solid #111; box-shadow: 0 24px 60px rgb(0 0 0 / .45); color: #fff; padding: 18% 7% 0; display: grid; align-content: start; justify-items: center; gap: 4px; position: relative; }
    .tm-phone::before { content: ""; position: absolute; top: 8px; left: 50%; transform: translateX(-50%); width: 30%; height: 18px; border-radius: 0 0 12px 12px; background: #111; }
    .tm-phone .clock { font-size: 2.6em; font-weight: 300; letter-spacing: .02em; line-height: 1; }
    .tm-phone .date { font-size: .8em; opacity: .85; margin-bottom: 14%; }
    .tm-notif { width: 100%; background: rgb(255 255 255 / .92); color: #1b1b1f; border-radius: 16px; padding: 10px 12px; display: grid; gap: 3px; font-size: .78em; text-align: left; box-shadow: 0 8px 24px rgb(0 0 0 / .3); animation: tm-ring 1.1s ease 0.2s 2; }
    .tm-notif .h { display: flex; align-items: center; gap: 6px; font-size: .85em; color: #555; }
    @keyframes tm-ring { 0%, 100% { transform: none; } 15% { transform: rotate(-2deg) translateX(-4px); } 30% { transform: rotate(2deg) translateX(4px); } 45% { transform: rotate(-1deg) translateX(-2px); } 60% { transform: none; } }

    /* One case: a developer's change, the way the team's own tools show it (Jira, git, CI, the guard). */
    .ts-dev { display: grid; grid-template-columns: minmax(0, .75fr) minmax(0, 2fr); gap: 18px; align-items: start; }
    .dev-flow { display: grid; gap: 10px; }
    .dev-step { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 12px; align-items: start; border: 1px solid var(--border); border-radius: 12px; padding: 10px 14px; background: var(--surface-2); }
    .dev-step small { display: block; color: var(--muted); font-weight: 800; font-size: .74em; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 2px; }
    .dev-ic { width: 36px; height: 36px; border-radius: 9px; display: grid; place-items: center; font-weight: 800; color: #fff; background: #2684ff; font-size: 1.05em; }
    .dev-ic.git { background: #f05033; }
    .dev-ic.ok { background: var(--ok); }
    .dev-msg { font-family: ui-monospace, Consolas, monospace; font-size: .9em; margin: 4px 0 0; }
    .dev-diff { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; font-family: ui-monospace, Consolas, monospace; font-size: .78em; margin-top: 8px; }
    .dev-diff .file { padding: 4px 10px; background: var(--surface); color: var(--muted); border-bottom: 1px solid var(--border); font-weight: 700; }
    .dev-diff .del, .dev-diff .add { padding: 3px 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .dev-diff .del { background: var(--bad-soft); color: var(--bad); }
    .dev-diff .add { background: var(--ok-soft); color: var(--ok); }
    .dev-bug { border-left: 4px solid var(--bad); background: var(--bad-soft); padding: 10px 14px; border-radius: 0 10px 10px 0; font-weight: 800; font-size: 1.15em; }
    #tour-slide.full .ts-dev { font-size: clamp(14px, 1.12vw, 19px); }
    @media (max-width: 900px) { .ts-dev { grid-template-columns: 1fr; } }

    /* The case's own clock: its real times from the report, instead of the eight steps' map (Part 3). */
    .ts-map span.done { color: var(--ok); border-color: var(--ok); background: var(--ok-soft); }
    .ts-ctime span b { font-variant-numeric: tabular-nums; margin-right: 3px; }

    /* The masking, on screen: in the report as written the identifiers are marked; in what a model reads they turn
       into placeholders, one after another, when it is said. */
    .ts-swap { display: inline-block; }
    .ts-swap .from { display: none; }
    .ts-swap .to { background: var(--ok-soft); color: var(--ok); font-weight: 750; border-radius: 4px; padding: 0 3px; display: inline-block; }
    #tour-slide [data-b].pend .ts-swap .from { display: inline; background: var(--warn-soft); color: var(--warn); font-weight: 750; border-radius: 4px; padding: 0 3px; }
    #tour-slide [data-b].pend .ts-swap .to { display: none; }
    #tour-slide [data-b].lit .ts-swap .to { animation: ts-pop .7s cubic-bezier(.3, .7, .2, 1) both; animation-delay: calc(.35s + var(--i, 0) * 420ms); }
    @keyframes ts-pop { 0% { opacity: 0; transform: scale(.4) rotateX(80deg); } 60% { opacity: 1; transform: scale(1.18); } 100% { transform: none; } }

    /* Prove and fix: the flow large, ten steps in two rows, each with its icon. */
    .ts-proof { display: grid; gap: 14px; }
    .ts-proof .ts-nodes { flex-wrap: nowrap; align-items: stretch; gap: 8px; }
    .ts-proof .ts-node { flex: 1 1 0; min-width: 0; padding: 14px 14px 12px; border-radius: 14px; display: grid; align-content: start; gap: 2px; }
    .ts-proof .ts-node .ic { font-size: 1.7em; line-height: 1.1; margin-bottom: 4px; }
    .ts-proof .ts-node.ai::before { content: none; }
    .ts-proof .ts-arrow { align-self: center; font-size: 1.3em; }
    .ts-proof .who { display: inline-block; margin-top: 6px; font-size: .72em; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; padding: 1px 8px; border-radius: 999px; background: var(--surface); border: 1px solid var(--border); color: var(--muted); }
    .ts-proof .who.ai { color: var(--teams); border-color: var(--teams); }
    .ts-proof .who.person { color: var(--ok); border-color: var(--ok); }
    #tour-slide.full .ts-proof .ts-node { font-size: clamp(15px, 1.3vw, 23px); }
    #tour-slide.full .ts-proof .ts-node small { font-size: clamp(12.5px, 1vw, 17px); }
    #tour-slide.full h1.small { font-size: clamp(22px, 2vw, 34px); }

    /* Full screen (?present, ?deck): the slide covers the dashboard; the caption bar stays below it. */
    #tour-slide.full { inset: 0; left: 0; transform: none; width: auto; max-height: none !important; border: 0; border-radius: 0; box-shadow: none;
      padding: 4vh 5vw calc(var(--tour-bar-h, 150px) + 3vh); display: grid; align-content: center; opacity: 1; transition: opacity .45s ease; }
    #tour-slide.full.out { opacity: 0; pointer-events: none; }
    #tour-slide.full > .page { width: min(1320px, 100%); margin: 0 auto; }
    #tour-slide.full .kick { font-size: clamp(12px, 1vw, 16px); }
    #tour-slide.full h1 { font-size: clamp(26px, 2.6vw, 44px); margin: 6px 0 12px; }
    #tour-slide.full .lead { font-size: clamp(15px, 1.35vw, 22px); margin-bottom: 2.5vh; }
    #tour-slide.full li, #tour-slide.full .ts-card, #tour-slide.full .ts-table, #tour-slide.full .ts-goal, #tour-slide.full .ts-arch, #tour-slide.full .ts-teams,
    #tour-slide.full .ts-time, #tour-slide.full .ts-bars { font-size: clamp(14px, 1.15vw, 19px); }
    #tour-slide.full .ts-card h3, #tour-slide.full .ts-table th { font-size: clamp(12px, .9vw, 15px); }
    #tour-slide.full .ts-node { font-size: clamp(13px, 1.05vw, 17px); padding: 9px 13px; }
    #tour-slide.full .ts-node small { font-size: clamp(11.5px, .85vw, 14px); }
    #tour-slide.full .ts-row { grid-template-columns: 150px 1fr; }
    #tour-slide.full .ts-row .lbl { font-size: clamp(12px, .95vw, 15px); }
    #tour-slide.full .ts-big { font-size: clamp(28px, 2.6vw, 44px); }
    #tour-slide.full .ts-map span { font-size: clamp(11.5px, .85vw, 14px); }
    #tour-slide.full .ts-life b { font-size: clamp(15px, 1.25vw, 21px); }
    #tour-slide.full .ts-life small { font-size: clamp(13px, 1vw, 17px); }
    #tour-slide.full .ts-title { justify-items: center; text-align: center; }
    #tour-slide.full .ts-title h1 { font-size: clamp(40px, 5vw, 80px); }
    #tour-slide.full .ts-title .lead { font-size: clamp(18px, 1.8vw, 30px); }
    #tour-slide.full .ts-title .who { font-size: clamp(15px, 1.3vw, 22px); }
    @media (max-width: 900px) { .ts-cols, .ts-grid, .ts-grid.two, .ts-grid.four, .ts-life, .ts-arch { grid-template-columns: 1fr; } .ts-row, #tour-slide.full .ts-row { grid-template-columns: 1fr; }
      #tour-slide { padding: 18px; } .ts-src { columns: 1; } .ts-bars .b { grid-template-columns: 1fr 3.4em; } .ts-bars .track { display: none; } }
  `;

  // ------------------------------------------------------------------ pieces
  const node = (t, s, i, cls = '') => `<span class="ts-node ${cls}" style="--i:${i}">${t}${s ? `<small>${s}</small>` : ''}</span>`;
  const row = (g, label, nodes) => `<div class="ts-row" data-r="${g}" data-g="${g}"><div class="lbl">${label}</div><div class="ts-nodes">${nodes.join('<span class="ts-arrow">→</span>')}</div></div>`;
  const chain = (nodes) => `<div class="ts-nodes">${nodes.join('<span class="ts-arrow">→</span>')}</div>`;

  /** The eight steps of a ticket's life (slide 3), and the map of them on the slides under the hood. */
  const STEPS = [
    ['Pick & mask', 'reported; personal data masked'],
    ['System 1', 'read in a second, on this machine'],
    ['Analysis', 'understood: the cause, the code, the owner'],
    ['Act', 'the right person told in Teams'],
    ['Prove & fix', 'a failing test, the commit that broke it, a fix'],
    ['Review & approve', 'a second AI, then a person'],
    ['Learn', 'written into the knowledge base'],
    ['Guard', 'it does not come back'],
  ];
  /** `on`: the steps lit (1-based); none: the whole map. */
  const stepMap = (...on) => `<div class="ts-map">${STEPS.map(([name], i) => `<span class="${on.includes(i + 1) ? 'on' : ''}">${i + 1} ${esc(name)}</span>`).join('')}</div>`;
  /** 118 → "1:58"; an hour or more → "1:12:54". */
  const tclock = (s) => (s == null ? '' : s < 3600 ? mmss(s) : `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`);
  /** The case's own times from the report (Part 3 shows these instead of the eight steps). */
  const caseTimes = (c) => {
    const t = K(c)?.t ?? {};
    return [['report', 'Report', 0], ['system1', 'System 1', t.picked], ['analysis', 'Analysis', t.analyzed], ['teams', 'Teams', t.notified], ['test', 'Test fails', t.reproduced],
      ['bisect', 'Bisect', t.bisected], ['fix', 'Fix ready', t.fixNotified], ['review', 'AI review', t.reviewed], ['merged', 'Merged', t.merged], ['documented', 'Documented', t.documented]]
      .filter(([, , s]) => s != null).map(([key, label, secs]) => ({ key, label, secs, at: tclock(secs) }));
  };
  /** The case's clock on its slides: the times `on` lit, the ones before them done. */
  const caseMap = (c, ...on) => {
    const xs = caseTimes(c);
    if (!K(c) || xs.length < 3) return '';
    const last = Math.max(...xs.map((x, i) => (on.includes(x.key) ? i : -1)));
    return `<div class="ts-map ts-ctime">${xs.map((x, i) => `<span class="${on.includes(x.key) ? 'on' : i < last ? 'done' : ''}"><b>${x.at}</b>${esc(x.label)}</span>`).join('')}</div>`;
  };
  /**
   * The report with each identifier as a swap: as written (from) and as any model reads it (to). The masked text is
   * the original with placeholders: the text between two placeholders is found in the original, in order, and what
   * lies between is the identifier. Null when they cannot be lined up.
   */
  const maskSwaps = (original, masked) => {
    const o = String(original ?? '');
    const parts = String(masked ?? '').split(/(\[[A-Z_]+_\d+\])/);
    if (parts.length < 3) return null;
    let pos = 0;
    let html = '';
    const values = [];
    for (let i = 0; i < parts.length; i += 2) {
      const at = i === 0 ? (o.startsWith(parts[0]) ? 0 : -1) : o.indexOf(parts[i], pos + 1);
      if (at < 0) return null;
      if (i > 0) {
        const value = o.slice(pos, at);
        if (!value.trim()) return null;
        html += `<span class="ts-swap" style="--i:${values.length}"><span class="from">${esc(value)}</span><span class="to">${esc(parts[i - 1])}</span></span>`;
        values.push(value);
      }
      html += esc(parts[i]);
      pos = at + parts[i].length;
    }
    // The report as written, its identifiers marked.
    let shown = '';
    let from = 0;
    for (const v of values) { const at = o.indexOf(v, from); shown += `${esc(o.slice(from, at))}<span class="ts-pii">${esc(v)}</span>`; from = at + v.length; }
    return { html, original: shown + esc(o.slice(from)), values };
  };

  /** What System 1's questions mean, for a slide and for the voice. */
  const QUESTION = {
    type: 'kind of ticket', side: 'side', component: 'part of the app', urgency: 'urgency', code: 'needs code', known: 'known issue',
    steps: 'tells what was done', expected: 'tells what is wrong', screen: 'names the screen', environment: 'tells where or when', privacy: 'names a person', intent: 'what a question asks',
  };
  /** One answer as a line: "kind of ticket: bug in code"; an answer that repeats its question is shown alone. */
  const answerLine = (q, a) => (a.choice === QUESTION[q] ? `<b>${esc(a.choice)}</b>` : `${esc(QUESTION[q] ?? q)}: <b>${esc(a.choice)}</b>`);
  /** System 1's decisions, with their policy.json switch (system1.*) and their way back when they act. */
  const DECISIONS = [
    ['askReporter', 'Ask the reporter', 'a report about code that does not say what is wrong or where gets a question in Jira, in its language; the analysis starts on the answer', 'after 24 h it is analysed anyway'],
    ['lightPath', 'Light path', 'a ticket not about code gets a short comment instead of an analysis', "the reporter's reply gets the full analysis; one miss sends it back to shadow"],
    ['queueOrder', 'Queue order', 'urgent tickets first', 'only among tickets waiting together'],
    ['knownTest', 'Known issue', "the same problem in other words; its regression test runs on main", 'Claude still analyses'],
    ['askRouter', 'Ask router', '"who knows X" answered by plain code, no Claude', '"Ask Claude instead"'],
    ['privacy', 'Privacy hold', 'a name the masking missed: the ticket waits for a person', ''],
    ['warmBySide', 'Fix warm-up', 'prepare less for a ticket not about the frontend', ''],
  ];
  const modeOf = (c, key) => c.facts?.policy?.system1?.find((x) => x.key === key)?.mode ?? null;
  const acts = (m) => m === 'auto';

  /** The public documentation behind each part, and the project's own documents (all checked to resolve). */
  const SOURCES = [
    ['Claude Code: headless mode (claude -p)', 'https://code.claude.com/docs/en/headless'],
    ['Claude Code: Agent Skills (SKILL.md)', 'https://code.claude.com/docs/en/skills'],
    ['Agent Skills, the open format', 'https://agentskills.io'],
    ['Claude models overview', 'https://platform.claude.com/docs/en/models/overview'],
    ['VS Code: agent skills in GitHub Copilot', 'https://code.visualstudio.com/docs/agent-customization/agent-skills'],
    ['Jira Cloud REST API v2', 'https://developer.atlassian.com/cloud/jira/platform/rest/v2/intro/'],
    ['GitHub CLI: gh pr create', 'https://cli.github.com/manual/gh_pr_create'],
    ['git worktree', 'https://git-scm.com/docs/git-worktree'],
    ['Version Control with Subversion (SVN book)', 'https://svnbook.red-bean.com/'],
    ['Playwright', 'https://playwright.dev/docs/intro'],
    ['JUnit', 'https://junit.org/'],
    ['Spring Boot', 'https://docs.spring.io/spring-boot/index.html'],
    ['Angular', 'https://angular.dev'],
    ['Web Speech API (the voice of this tour)', 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API'],
  ];
  const DOCS = ['HOW_IT_WORKS', 'PROBLEM_BRIEF', 'SPEC', 'DEMO_SCENARIO', 'DEPENDENCIES_AND_RISKS', 'EXIT_CRITERIA', 'AGENT_TRAINING', 'SUITE', 'PILOT', 'SYSTEM1_PLAN', 'ROADMAP', 'PRESENTATION_PLAN'];

  // ------------------------------------------------------------------ the facts, read for the slides and the voice
  const F = (c) => c?.facts ?? {};
  const K = (c) => F(c).case ?? null;
  const owner = (c) => K(c)?.analysis?.owner?.name ?? K(c)?.cards?.owner?.to ?? 'the owner';
  /** "She authored VAX-20 (6e8e6e1), the regression, and is …" → "she authored VAX-20, the regression". */
  const whyShort = (c) => {
    const w = noParens(K(c)?.analysis?.owner?.why ?? K(c)?.cards?.owner?.why ?? '').split(/,? and |\. /)[0].trim();
    return w ? w.replace(/^\w/, (x) => x.toLowerCase()) : '';
  };
  const bisectSecs = (c) => Number(String(K(c)?.bisected ?? '').match(/(\d+) s\)\s*$/)?.[1] ?? 0) || null;
  const backendTests = (c) => Number(String(K(c)?.verified ?? '').match(/backend (\d+) tests ok/)?.[1] ?? 0) || null;
  const browserTests = (c) => Number(String(K(c)?.verified ?? '').match(/e2e (\d+) passed/)?.[1] ?? 0) || null;
  /** The reported dates of the reproduction: "due 2026-09-05 … instead of 2026-11-20". */
  const reproDates = (c) => {
    const m = String(K(c)?.reproduced ?? '').match(/(\d{4}-\d{2}-\d{2})[^.]*?instead of (\d{4}-\d{2}-\d{2})/);
    return m ? { got: m[1], want: m[2] } : null;
  };
  const answer = (c, q) => K(c)?.system1?.answers?.[q] ?? null;
  const maskedKinds = (text) => [...new Set([...String(text ?? '').matchAll(/\[([A-Z_]+?)_\d+\]/g)].map((m) => m[1]))]
    .map((k) => ({ PERSON: 'the patient', FISCAL_CODE: 'a fiscal code', BIRTH_DATE: 'a birth date', PHONE: 'a phone number', HEALTH_CARD: 'a health card', EMAIL: 'an e-mail', IBAN: 'an IBAN' })[k] ?? k.toLowerCase());
  const highlight = (text, cls) => esc(text).replace(/\[[A-Z_]+_\d+\]/g, (m) => `<span class="${cls}">${m}</span>`);
  /** The replay's numbers: files and owner of the bugs people fixed, summed over the apps (Impact's accuracy). */
  const replay = (c) => {
    const acc = c.impact?.accuracy ?? [];
    const sum = (k) => acc.reduce((s, a) => ({ n: s.n + (a[k]?.n ?? 0), of: s.of + (a[k]?.of ?? 0) }), { n: 0, of: 0 });
    const files = sum('replayFiles');
    return files.of ? { files, owner: sum('replayOwner') } : null;
  };
  /** The app whose bugs stay longest in the code until they are fixed (Insights, median days from the change to the fix). */
  const longestLived = (c) => Object.entries(c.insights ?? {}).map(([key, x]) => ({ key, days: x?.origins?.medianDaysInCode ?? null, name: (c.apps ?? []).find((a) => a.key === key)?.name ?? key }))
    .filter((x) => x.days != null).sort((a, b) => b.days - a.days)[0] ?? null;
  /** A known bug whose fix is missing in copies of the same code in other apps (the suite's shared code). */
  const missingCopies = (c) => {
    const key = F(c).catches?.copies?.key;
    for (const s of c.suite?.shared ?? []) {
      const checks = (s.checks ?? []).filter((x) => !key || x.key === key);
      if (checks.length) return { key: checks[0].key, file: s.name, apps: checks.map((x) => (c.apps ?? []).find((a) => a.key === x.project)?.name ?? x.project) };
    }
    return null;
  };
  /** "involves LAB: MediLab changed the creatinine unit. The change is …" → "MediLab changed the creatinine unit". */
  const crossWhy = (x) => firstSentence(String(x?.why ?? '').replace(/^involves [A-Z, ]+:\s*/, '')).replace(/\.$/, '');
  const morning = (hhmm) => { const h = Number(String(hhmm ?? '').split(':')[0]); return Number.isFinite(h) && h > 0 ? `${h} in the morning` : 'eight in the morning'; };

  // ------------------------------------------------------------------ slides
  const slides = {
    title: (c) => `
      <div class="ts-title">
        <div class="logo">✦</div>
        <div class="kick">Proof of concept · ${esc(new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }))}</div>
        <h1>Ticket Intelligence</h1>
        <p class="lead">An AI colleague that takes every new Jira ticket from the report to a tested fix,<br>and tells the right person, in minutes, with nobody starting it</p>
        ${c.deck?.team ? `<div class="who">${esc(c.deck.team)}</div>` : ''}
      </div>`,

    problem: (c) => `
      <div class="kick">The problem</div>
      <h1>“I opened a ticket. What is the status? Can it be sped up?”</h1>
      <p class="lead">Customers of hospital scheduling systems ask this every day. A good answer takes a lot of digging.</p>
      <div class="ts-cols">
        <div class="ts-card" data-r="1" data-b="1"><h3>To answer well, an engineer has to</h3><ol>
          <li>read the ticket and its history, and find earlier tickets like it</li>
          <li>find the code behind it, and what changed there lately</li>
          <li>work out who knows that code, and hand it over</li></ol></div>
        <div class="ts-card" data-r="2" data-b="2"><h3>Today it is done by hand</h3><ul>
          <li><b>Customers</b> wait for a real answer</li>
          <li><b>Support</b> cannot say anything concrete without a developer</li>
          <li><b>Someone new to the project</b> does not know the code, the history, or whom to ask</li></ul></div>
      </div>
      ${c?.full ? '' : `<div class="ts-goal" data-r="3"><b>The goal:</b> for every new ticket, within minutes and with no human start, an analysis with evidence in Jira,
          the right person informed, drafts for a human to approve, and the knowledge kept when it is solved.</div>`}`,

    // What it is, in one sentence.
    whatItIs: () => `
      <div class="kick">What it is</div>
      <h1>An AI colleague for the support and development team</h1>
      <div class="ts-goal note" data-b="1" style="font-size:1.25em;line-height:1.5;margin:0 0 2.5vh">For every new Jira ticket, with nobody starting it, it does the first hours of an engineer's work in minutes:
        it finds the cause in the code, tells the right person, proves the bug with a test, proposes a tested fix, and keeps what was learnt.</div>
      <div class="ts-grid">
        <div class="ts-card" data-b="2"><h3>It works on its own</h3><p>It watches Jira and starts by itself on every new ticket, day and night.</p></div>
        <div class="ts-card" data-b="3"><h3>In the tools you have</h3><p>Jira, git or SVN, GitHub and Teams. Not a chatbot to open, and no new tool to learn.</p></div>
        <div class="ts-card" data-b="4"><h3>A person decides</h3><p>It never merges a fix or answers a customer on its own; a person approves.</p></div>
      </div>`,

    // Before and after: one ticket's work, by hand and with it.
    beforeAfter: (c) => {
      const k = K(c);
      const t = k?.t ?? {};
      const b = c.impact?.baseline ?? null;
      const g = F(c).catches?.guard;
      const ans = F(c).teams?.answer;
      const bs = bisectSecs(c);
      const min = (m) => (m ? `about ${m >= 60 ? `${Math.round(m / 60)} h` : `${m} min`}` : '');
      // The last column: the beat that lights the row (deck: understand · who · prove and fix · learn and guard).
      const rows = [
        ['Understand the ticket: its history, the code, the cause', min(b?.analysisMinutes), t.analysis != null ? `${t.analysis} s: the cause, with file and line` : '', 1],
        ['Find who should take it', 'ask around', t.notified != null ? `${mmss(t.notified)} after the report: @mentioned in Teams, with why them` : '', 2],
        ['Reproduce the bug', min(b?.reproduceMinutes), t.reproduced != null ? `${mmss(t.reproduced)}: a test that fails exactly as reported` : '', 3],
        ['Find the change that broke it', 'a guess, if anyone looks', bs ? `${bs} s: the exact commit, proven by the test` : '', 3],
        ['Fix it and test it', min(b?.fixMinutes), t.fixNotified != null ? `${mmss(t.fixNotified)}: a tested fix to review, as a draft pull request` : '', 3],
        ['Write down what was learnt', `${min(b?.docsMinutes)}${b?.docsMinutes ? ', ' : ''}often never`, 'written when the ticket is done, with the test that guards it', 4],
        ['The same bug comes back', 'a customer finds it', g?.minutes != null ? `caught ${g.minutes} min after the change was pushed` : '', 4],
        ['"What is the status?"', 'ask a developer', ans?.secs != null ? `${ans.secs} s in Teams, from its records, no AI` : '', 4],
      ].filter((r) => r[2]);
      return `
      <div class="kick">Before and after</div>
      <h1>One ticket's work, by hand and with it</h1>
      <table class="ts-table"><thead><tr><th>The work</th><th>By hand${b ? ' <span style="font-weight:500;text-transform:none;letter-spacing:0">(the team\'s own estimate)</span>' : ''}</th><th>With Ticket Intelligence${k ? ` <span style="font-weight:500;text-transform:none;letter-spacing:0">(${esc(k.key)}, measured from the report)</span>` : ''}</th></tr></thead><tbody>
        ${rows.map(([w, before, after, beat]) => `<tr data-b="${beat}"><td>${esc(w)}</td><td class="open">${esc(before)}</td><td class="res">${esc(after)}</td></tr>`).join('')}
      </tbody></table>`;
    },

    // What each role gets.
    roles: (c) => {
      const k = K(c);
      const t = k?.t ?? {};
      const f = F(c);
      const ans = f.teams?.answer;
      const s1a = f.system1?.find((x) => x.asked);
      const A = c.askStats?.total;
      const I = c.impact?.total;
      const g = f.catches?.guard;
      const p = f.pilot;
      const L = longestLived(c);
      const bs = bisectSecs(c);
      const li = (big, text) => `<li>${big ? `<b>${big}</b> ` : ''}${text}</li>`;
      return `
      <div class="kick">What you get</div>
      <h1>Something for everyone who touches a ticket</h1>
      <div class="ts-grid four">
        <div class="ts-card" data-b="1"><h3>Support</h3><ul>
          ${li(ans?.secs != null ? `${ans.secs} s` : '', 'the status of any ticket, asked in Teams')}
          ${li(s1a ? `${s1a.asked.secs} s` : '', 'a half-written report asked back, in its language')}
          ${li(A?.withoutAi ? pct(A.withoutAi.rate) : '', 'of questions answered at once, with no AI')}</ul></div>
        <div class="ts-card" data-b="2"><h3>Developers</h3><ul>
          ${li(t.analysis != null ? `${t.analysis} s` : '', 'the cause, with file and line')}
          ${li(bs ? `${bs} s` : '', 'the exact change that broke it, proven by a test')}
          ${li(t.fixNotified != null ? mmss(t.fixNotified) : '', 'a tested fix to review, not to write')}</ul></div>
        <div class="ts-card" data-b="3"><h3>Team leads</h3><ul>
          ${li(t.notified != null ? mmss(t.notified) : '', 'the right person told, with why them')}
          ${li('', 'approve or reject a fix by one reply in Teams')}
          ${li(g?.minutes != null ? `${g.minutes} min` : '', 'a broken fix caught after the push, before a customer')}</ul></div>
        <div class="ts-card" data-b="4"><h3>Management</h3><ul>
          ${li(I?.hoursSaved != null ? `${Math.round(I.hoursSaved)} h` : '', "of the team's work saved, by its own estimates")}
          ${li(p ? `${p.files.n} of ${p.files.of}` : '', 'bugs right on the pilot, where the answer is known')}
          ${li(L ? `${L.days} days` : '', `${L ? `a bug stays in ${esc(L.name)}'s code until it is fixed; ` : ''}where bugs come from, who knows what`)}</ul></div>
      </div>
      <div class="ts-goal" data-b="3">And every morning at ${esc(f.nightShift?.digestAt ?? '08:00')}, a digest in Teams: what it did, what came back, what waits for whom.</div>`;
    },

    // Why it is different (the close, before the results).
    different: (c) => {
      const a = F(c).analyses;
      const p = F(c).pilot;
      return `
      <div class="kick">Why it is different</div>
      <h1>Not a chatbot: a colleague that does the work, shows its evidence, and lets you decide</h1>
      <div class="ts-grid">
        <div class="ts-card" data-b="1"><h3>Evidence, not opinion</h3><p>A test that fails before the fix, the exact change that broke it, and every ticket, commit and file it cites checked by code.</p></div>
        <div class="ts-card" data-b="2"><h3>On its own, under control</h3><p>Nobody starts it. A person approves every fix and every reply to a customer; it never merges.</p></div>
        <div class="ts-card" data-b="3"><h3>It learns</h3><p>Every resolved bug is written down with its test. Its small local model is trained on our own tickets.</p></div>
        <div class="ts-card" data-b="3"><h3>It guards</h3><p>A change that breaks an earlier fix is caught before a customer sees it; every known issue's test runs every night.</p></div>
        <div class="ts-card" data-b="4"><h3>Fast</h3><p>Minutes, not hours${a?.avgSecs ? `: an analysis in ${a.avgSecs} s on average` : ''}${K(c)?.t?.fixNotified != null ? `, a tested fix ${mmss(K(c).t.fixNotified)} after the report` : ''}.</p></div>
        <div class="ts-card" data-b="5"><h3>Safe in a hospital</h3><p>Patient data masked before any model reads it; everything it does is logged; it works in Jira, GitHub and Teams.</p></div>
      </div>`;
    },

    // 3 · The life of a ticket, in eight steps.
    life: () => `
      <div class="kick">What it does</div>
      <h1>The life of a ticket, in eight steps, and nobody has to start it</h1>
      <div class="ts-life">${STEPS.map(([name, what], i) => `<div class="st" data-b="${Math.floor(i / 2) + 1}"><span class="n">${i + 1}</span><b>${esc(name)}</b><small>${esc(what)}</small></div>`).join('')}</div>
      <div class="ts-goal note" data-b="4"><b>Four kinds of worker:</b> plain code collects and acts · a small local model decides fast · Claude reasons and writes · a person approves and merges.</div>`,

    // 4 · Architecture.
    arch: (c) => `
      <div class="kick">Under the hood</div>
      <h1>One program in the middle, and the model never writes</h1>
      <div class="ts-arch">
        <div class="side" data-b="2">
          <div class="sys">Jira<small>checked every 30 seconds</small></div>
          <div class="sys">git or SVN<small>history, code, a worktree per ticket</small></div>
        </div>
        <div class="core" data-b="1">
          <div class="core-h">The watcher<small>one program, plain Node.js</small></div>
          <div class="layer code" data-b="3"><b>Plain code</b><small>collects the facts · checks every result · does every write</small></div>
          <div class="layer s1" data-b="4"><b>System 1</b><small>a small model on this machine · about a second · nothing sent out</small></div>
          <div class="layer ai" data-b="5"><b>Claude = System 2</b><small>read-only · reasons and writes text</small></div>
        </div>
        <div class="side" data-b="2">
          <div class="sys">GitHub<small>draft pull requests, reviews</small></div>
          <div class="sys">Teams<small>out: cards (webhook) · in: questions and replies (Microsoft Graph)</small></div>
          <div class="sys">The dashboard<small>live, on this machine</small></div>
        </div>
      </div>
      <div class="ts-goal" data-b="5"><b>The model never writes.</b> The watcher does, and only what <code>policy.json</code> allows${F(c).policy?.actions ? `: ${F(c).policy.actions} actions, each <b>auto</b>, <b>draft</b> or <b>off</b>` : ''}.</div>`,

    // 5 · System 1: how it answers.
    s1How: (c) => {
      const k = K(c);
      const show = ['type', 'side', 'component', 'urgency', 'known', 'expected', 'screen', 'privacy'].map((q) => [q, answer(c, q)]).filter(([, a]) => a);
      const n = F(c).model?.questions;
      return `
      ${stepMap(2)}
      <div class="kick">System 1 · how it answers</div>
      <h1>A small model on this machine picks one of our answers, and says how sure it is</h1>
      <div class="ts-cols">
        <div class="ts-card" data-b="1"><h3>What it is</h3>
          <p>A fine-tuned <b>Laya</b>: a multilingual encoder, on this laptop's processor.</p>
          <p>It does not write text. For each question it picks one of <b>our</b> options, so it cannot invent an answer.</p>
          ${n ? `<p><b>${n} questions</b>: ${n - 1} about a ticket, one about the questions people ask.</p>` : ''}
          <p>Nothing leaves this machine.</p></div>
        <div class="ts-card" data-b="2"><h3>${esc(k?.key ?? 'A ticket')}, as it read it${k?.system1?.ms ? ` · ${(k.system1.ms / 1000).toFixed(1)} s` : ''}</h3>
          ${show.length ? `<div class="ts-bars">${show.map(([q, a]) => `<div class="b"><span class="q">${answerLine(q, a)}</span><span class="track"><span class="fill" style="width:${Math.round(100 * a.p)}%"></span></span><span class="v">${pct(a.p)}</span></div>`).join('')}</div>` : '<p class="sub">No recorded answers.</p>'}</div>
      </div>`;
    },

    // 6 · System 1: what it decides.
    s1Decides: (c) => `
      ${stepMap(2)}
      <div class="kick">System 1 · what it decides</div>
      <h1>Seven decisions before Claude, each with its own switch and its way back</h1>
      <table class="ts-table"><thead><tr><th>Decision</th><th>What it does</th><th>Now</th><th data-b="3">Way back</th></tr></thead><tbody>
        ${DECISIONS.map(([key, name, what, back]) => { const m = modeOf(c, key); return `<tr data-b="${acts(m) ? 1 : 2}"><td><b>${esc(name)}</b></td><td>${esc(what)}</td><td>${m ? `<span class="ts-chip ${acts(m) ? 'acts' : 'shadow'}">${acts(m) ? 'acts' : esc(m)}</span>` : '–'}</td><td${acts(m) ? ' data-b="3"' : ''}>${acts(m) ? esc(back) : '—'}</td></tr>`; }).join('')}
      </tbody></table>`,

    // 7 · System 1: two real cases.
    s1Cases: (c) => {
      const [a, b] = [F(c).system1?.find((x) => x.asked), F(c).system1?.find((x) => x.lightPath)];
      const card = (x, head, body, b) => `<div class="ts-card" data-b="${b}"><h3>${esc(x.key)} · ${esc(head)}</h3><div class="ts-quote">${esc(plainTitle(x.title))}${x.report ? `\n${esc(x.report)}` : ''}</div>${body}</div>`;
      return `
      ${stepMap(2)}
      <div class="kick">System 1 · two real cases</div>
      <h1>It asks before it analyses, and leaves Claude out where no code is wrong</h1>
      <div class="ts-cols">
        ${a ? card(a, `${a.answers?.type?.choice ?? ''} ${pct(a.answers?.type?.p)}`, `
          <p><b>${a.asked.secs} s</b> after it came in, in Jira:</p>
          <div class="ts-quote masked">${esc(a.asked.text)}</div>
          ${a.replied ? `<p>The reporter answered; the analysis started with the answer${a.replied.duplicateOf ? `, and found it was a duplicate of <b>${esc(a.replied.duplicateOf)}</b>` : ''}.</p>` : ''}`, 1) : ''}
        ${b ? card(b, `${b.answers?.type?.choice ?? ''} ${pct(b.answers?.type?.p)} · not code ${pct(b.answers?.code?.p)}`, `
          <p><b>Light path in ${b.lightPath.secs} s</b>: no Claude run, a comment instead:</p>
          <div class="ts-quote masked">${esc(b.lightPath.comment.split('\n')[0])}</div>
          ${b.replied ? '<p>When the reporter replied, the full analysis ran.</p>' : ''}`, 2) : ''}
      </div>`;
    },

    // 8 · System 1: how it learns.
    s1Learns: (c) => {
      const m = F(c).model;
      const best = (m?.changes ?? []).filter((x) => QUESTION[x.question] && x.now > x.before).sort((x, y) => y.now - y.before - (x.now - x.before)).slice(0, 3);
      return `
      ${stepMap(2)}
      <div class="kick">System 1 · how it learns</div>
      <h1>Claude teaches it, and a new version must not be worse anywhere</h1>
      <div class="ts-cols">
        <div class="ts-card"><h3>The loop</h3><ol class="ts-steps">
          <li data-b="1"><b>Claude analyses a ticket</b> <small>System 2</small></li>
          <li data-b="1"><b>The analysis becomes a labelled example</b> <small>System 2 teaches System 1</small></li>
          <li data-b="2"><b>A new version is trained</b></li>
          <li data-b="2"><b>Scored on tickets it never saw</b> <small>against the current one</small></li>
          <li data-b="2"><b>Kept only if no answer is worse</b> <small>and no code bug takes the light path</small></li>
          <li data-b="4"><b>A new decision starts in shadow</b> <small>one miss switches it back</small></li></ol></div>
        <div class="ts-card" data-b="3"><h3>The last change${m ? `: ${esc(m.name)} replaced ${esc(m.replaced ?? 'the one before')}` : ''}</h3>
          ${best.length ? `<div class="ts-bars">${best.map((x) => `<div class="b"><span class="q">${esc(QUESTION[x.question])}</span><span class="track"><span class="fill" style="width:${x.now}%"></span><span class="was" style="left:${x.before}%"></span></span><span class="v">${x.before} → ${x.now} %</span></div>`).join('')}</div>
          <p class="sub" style="margin-top:8px">The mark is the version before; the bar, the one in use. On tickets it never saw.</p>` : ''}
          ${m?.lightPath ? `<p style="margin-top:8px">${esc(noParens(m.lightPath).replace(/^light path:?\s*/i, 'Light path: '))}</p>` : ''}</div>
      </div>`;
    },

    // 9 · Claude's analysis.
    analysis: (c) => {
      const pa = K(c)?.priorArt;
      return `
      ${stepMap(3)}
      <div class="kick">Step 3 · the analysis</div>
      <h1>Code gathers the facts, Claude reads them, code checks what it says</h1>
      <div class="ts-grid">
        <div class="ts-card" data-b="1"><h3>Collected by code</h3><ul><li>the ticket, its comments, history and screenshots</li><li>related tickets, by three Jira searches</li><li>the commits that name them</li><li>a code search for the ticket's clues</li><li>the people, ranked by what they did</li><li>the knowledge base</li></ul></div>
        <div class="ts-card" data-b="2"><h3>Answered by Claude, read-only</h3><ul><li><b>Already known?</b> duplicate · in progress · fixed on main · regression · solved before · documented</li><li>the cause, with file and line</li><li>the owner, and why</li><li>how sure it is</li></ul>
          ${pa?.kind && pa.kind !== 'none' ? `<p class="sub" style="margin-top:8px">${esc(K(c).key)}: already known, a ${esc(pa.kind)} of ${esc(pa.key ?? '')}</p>` : ''}</div>
        <div class="ts-card" data-b="3"><h3>Checked by code</h3><ul><li>the result is valid JSON, every field there</li><li>every ticket, commit and file it cites exists</li><li>nothing is posted otherwise</li></ul></div>
      </div>`;
    },

    // 10 · Prove, fix, review, approve.
    prove: () => {
      // icon, what, how, who does it (agent: the watcher's code, ai: Claude, person), the beat that lights it.
      const step = ([ic, t, s, who, b]) => `<span class="ts-node${who === 'person' ? ' person' : ''}" data-b="${b}"><span class="ic">${ic}</span>${t}<small>${s}</small><span class="who ${who}">${{ agent: 'the watcher', ai: 'AI', person: 'a person' }[who]}</span></span>`;
      const flow = (xs) => `<div class="ts-nodes">${xs.map(step).join('<span class="ts-arrow">→</span>')}</div>`;
      return `
      ${stepMap(5, 6)}
      <div class="kick">Steps 5 and 6 · prove, fix, review, approve</div>
      <h1 class="small">Proven by a test, approved by a person</h1>
      <div class="ts-proof">
        ${flow([['🧪', 'A test from the ticket', 'JUnit or Playwright', 'ai', 1], ['❌', 'It fails on main', 'exactly as reported', 'agent', 1], ['🔎', 'Bisect', 'the exact commit that broke it', 'agent', 2], ['🛠', 'The smallest fix', 'the tests may not change', 'ai', 3], ['✅', 'Every test again', 'and the build, by the watcher', 'agent', 3]])}
        ${flow([['⇄', 'Draft pull request', 'with the evidence, noted in Jira', 'agent', 3], ['💬', 'Teams: fix ready', 'to the owner, by name', 'agent', 4], ['✦', 'AI review', 'read-only: risk, findings', 'ai', 4], ['👍', 'Approve or reject', 'one reply in Teams, with why', 'person', 5], ['🔀', 'Merge', 'never the agent', 'person', 5]])}
      </div>
      <div class="ts-goal note" data-b="5">While the pull request is open, every move of main checks it again (a merge check). A rejected fix runs again with the reason.</div>`;
    },

    // 11 · Learn and guard.
    learnGuard: (c) => {
      const g = F(c).catches?.guard;
      const ns = F(c).nightShift;
      return `
      ${stepMap(7, 8)}
      <div class="kick">Steps 7 and 8 · learn and guard</div>
      <h1>It writes down what it learnt, and guards against it coming back</h1>
      <div class="ts-grid">
        <div class="ts-card" data-b="1"><h3>Learn</h3><p>When a ticket is done: a knowledge entry with the symptom, the cause, the fix, who knows it, and <b>the test that guards it</b>.</p><p>Checked by a lint; merged in any order, and by itself after 24 h unless a person holds it.</p><p>Every later analysis, fix, review and Ask reads it.</p></div>
        <div class="ts-card" data-b="2"><h3>Guard</h3><p>Every commit on main that changes the lines of an earlier fix runs <b>that fix's test</b>, as it was before the commit.</p>${g?.minutes != null ? `<p>The pilot's planted regression: an alert <b>${g.minutes} minutes</b> after the push${g.hoursBefore ? `, <b>${g.hoursBefore} hours</b> before anyone reported it` : ''}.</p>` : ''}</div>
        <div class="ts-card" data-b="3"><h3>While nobody looks</h3><p>Every night: every known issue's test, the lint, and the tickets nobody took yet.</p><p>At ${esc(ns?.digestAt ?? '08:00')}: a digest in Teams.</p><p>A question Ask could not answer gets researched.</p></div>
      </div>`;
    },

    // 12 · The case.
    caseIntro: (c) => {
      const k = K(c);
      const b = k?.breaking;
      const ch = b?.change;
      const tests = Number(String(b?.checks ?? '').match(/(\d+)/)?.[1] ?? 0) || null;
      const when = ch?.date ? new Date(ch.date).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
      return `
      <div class="kick">One case, whole · ${esc(k?.key ?? '')}</div>
      <h1>A developer's change, with a bug inside, goes to main</h1>
      <div class="ts-dev">
        <div class="ts-card" data-b="1"><h3>The pilot</h3><p>A fifth app, with synthetic patients only.</p><p>Every working day a developer's change with a hidden bug goes to main; its bug is reported later, like in real life.</p><p>The answer key is hidden from the agent: every case is scored.</p></div>
        ${b ? `<div class="dev-flow">
          <div class="dev-step" data-b="2"><span class="dev-ic">J</span><div><small>Jira · the story</small><b>${esc(b.story)}</b> · a story for ${esc(b.author)}</div></div>
          <div class="dev-step" data-b="2"><span class="dev-ic git">⎇</span><div><small>git · a commit on main</small><b><code>${esc(b.commit)}</code></b> · ${esc(b.author)}${when ? ` · ${esc(when)}` : ''}
            ${ch?.message ? `<div class="dev-msg">${esc(ch.message)}</div>` : ''}
            ${ch?.lines?.length ? `<div class="dev-diff"><div class="file">${esc(fileName(ch.file ?? ''))}${ch.line ? ` · line ${ch.line}` : ''}</div>${ch.lines.map((l) => `<div class="${l.kind}">${l.kind === 'add' ? '+' : '−'} ${esc(l.text)}</div>`).join('')}</div>` : ''}</div></div>
          ${tests ? `<div class="dev-step" data-b="3"><span class="dev-ic ok">✓</span><div><small>CI · the build</small><b>${tests} backend tests pass</b></div></div>` : ''}
          ${b.guard ? `<div class="dev-step" data-b="3"><span class="dev-ic ok">⛨</span><div><small>The regression guard</small><b>${esc(b.guard.replace(/^regression guard: \w+ "[^"]*":\s*/, ''))}</b></div></div>` : ''}
          <div class="dev-bug" data-b="4">Green everywhere. The bug is inside.</div>
        </div>` : '<div class="ts-card"><p class="sub">Not a pilot case.</p></div>'}
      </div>`;
    },

    // 13 · The report, masked.
    caseReport: (c) => {
      const k = K(c);
      const r = k?.report;
      // The identifiers turn into placeholders on screen (maskSwaps); when they cannot be lined up, the masked text.
      const sw = r?.original ? maskSwaps(r.original, r.masked) : null;
      return `
      ${caseMap(c, 'report')}
      <div class="kick">${esc(k?.key ?? '')} · 0:00 · the report</div>
      <h1>${esc(plainTitle(k?.title ?? 'The report'))}${k?.priority ? ` <span class="ts-chip shadow">${esc(k.priority)}</span>` : ''}</h1>
      ${r ? `<div class="ts-cols">
        ${r.original ? `<div class="ts-card" data-b="1"><h3>As it was written (synthetic patient)</h3><div class="ts-quote">${sw ? sw.original : esc(r.original)}</div></div>` : ''}
        <div class="ts-card" data-b="2"><h3>What any model reads${r.quoted ? ` · ${r.maskedCount} of ${r.quoted} identifiers masked` : ''}</h3><div class="ts-quote masked">${sw ? sw.html : highlight(r.masked, 'ts-mask')}</div></div>
      </div>` : ''}`;
    },

    // ?deck only: the case's dashboard steps, as one timeline.
    caseTimeline: (c) => {
      const k = K(c);
      const t = k?.t ?? {};
      const d = reproDates(c);
      const rows = [
        [t.picked, `picked; System 1 reads it${k?.system1?.ms ? ` in ${(k.system1.ms / 1000).toFixed(1)} s` : ''}`],
        [t.analyzed, `the analysis: ${k?.analysis?.confidence ?? ''} confidence${k?.priorArt?.kind && k.priorArt.kind !== 'none' ? `, already known: a ${k.priorArt.kind} of ${k.priorArt.key}` : ''}, owner ${owner(c)}`],
        [t.notified, `Teams: For @${owner(c)}, why them, where, how sure`],
        [t.reproduced, `a test fails on main${d ? `: due ${isoDay(d.got)} instead of ${isoDay(d.want)}` : ''}`],
        [t.bisected, `bisect: broken by ${k?.breaking?.commit ?? 'the change'}${bisectSecs(c) ? `, in ${bisectSecs(c)} s` : ''}`],
        [t.pr, `the fix${backendTests(c) ? `, ${backendTests(c)} backend tests` : ''}${browserTests(c) ? `, ${browserTests(c)} browser tests` : ''}; a draft pull request`],
        [t.fixNotified, 'Teams: fix ready for review'],
        [t.reviewed, `AI review: ${k?.review?.risk ?? ''} risk, ${plural(k?.review?.findings ?? 0, 'finding')}`],
        [t.merged, 'merged by a person'],
        [t.documented, 'the knowledge entry, with its regression test'],
      ].filter(([s]) => s != null);
      return `
      <div class="kick">${esc(k?.key ?? '')} · from the report, nobody starting anything</div>
      <h1>The whole way, with its real times</h1>
      <div class="ts-time">${rows.map(([s, what]) => `<span class="t">${mmss(s)}</span><span>${esc(what)}</span>`).join('')}</div>`;
    },

    // 20 · Answering in Teams.
    teamsThread: (c) => {
      const k = K(c);
      const fix = k?.cards?.fix;
      const decided = (F(c).teams?.decisions ?? []).filter((d) => d.type === 'approved' || d.type === 'rejected');
      const ans = F(c).teams?.answer;
      const prNo = String(k?.prUrl ?? '').match(/(\d+)$/)?.[1];
      const chan = c.teams?.channel ?? 'support-triage';
      const who = fix?.to ?? owner(c);
      const bot = (extra = '') => `<span class="tm-av bot">✦</span><div><div class="tm-meta"><b>Ticket Intelligence</b><span class="tm-tag">APP</span>${extra}</div>`;
      const person = (name, cls = 'owner') => `<span class="tm-av ${cls}">${esc(initialsOf(name))}</span>`;
      const replies = decided.length
        ? decided.map((d) => `<div class="tm-reply" data-b="2">${person(who)}<div><div class="tm-meta"><b>${esc(who)}</b></div><b>${d.type === 'approved' ? 'approve' : 'reject'}</b></div></div>
            <div class="tm-reply" data-b="2">${bot()}${esc(d.text)}</div></div>`).join('')
        : `<div class="tm-reply" data-b="2">${person(who)}<div><div class="tm-meta"><b>${esc(who)}</b><span class="ts-pending">BUILT · FIRST LIVE ROUND PENDING</span></div><b>approve</b> &nbsp;·&nbsp; or &nbsp;<b>reject: &lt;why&gt;</b></div></div>
           <div class="tm-reply" data-b="2">${bot()}${prNo ? `PR #${esc(prNo)} is ready for review` : 'The pull request is ready for review'}; Jira: “Fix approved in Teams by …”. A reject runs the fix again with the reason.</div></div>`;
      return `
      ${caseMap(c, 'fix', 'review') || stepMap(4, 6)}
      <div class="kick">Teams · the team's channel</div>
      <h1>The owner answers the card, and anyone can ask</h1>
      <div class="tm-app">
        <div class="tm-top"><span class="tm-logo">T</span><span class="tm-chan"># ${esc(chan)}</span><span class="tm-tabs"><span class="on">Posts</span><span>Files</span></span></div>
        <div class="tm-feed${fix && ans ? ' two' : ''}">
          ${fix ? `<div class="tm-msg" data-b="1"><span class="tm-av bot">✦</span><div class="tm-post">
            <div class="tm-meta"><b>Ticket Intelligence</b><span class="tm-tag">APP</span><span>${clock(k?.reportedAt, k?.t?.fixNotified)}</span></div>
            <div class="tm-card"><div><span class="tm-at">@${esc(fix.to)}</span> · fix ready for review</div><div class="tm-title">${esc(fix.message)}</div>
              ${fix.tests ? `<div class="tm-kv"><span>Checked</span>${esc(fix.tests)}</div>` : ''}${fix.broke ? `<div class="tm-kv"><span>Broken by</span>${esc(fix.broke)}</div>` : ''}
              <div class="tm-btns"><span>Review the pull request</span><span>Open in Jira</span></div></div>
            <div class="tm-thread">${replies}</div></div></div>` : ''}
          ${ans ? `<div class="tm-msg" data-b="3">${person('A colleague', '')}<div class="tm-post">
            <div class="tm-meta"><b>A colleague</b></div><b>${esc(ans.question)}</b>
            <div class="tm-thread"><div class="tm-reply">${bot(`<span>${ans.secs != null ? `${ans.secs} s later · ` : ''}from its records · no AI</span>`)}<pre>${esc(ans.answer.split('\n').filter((l) => l.trim()).slice(0, 4).join('\n'))}\n…</pre></div></div></div></div></div>` : ''}
        </div>
      </div>`;
    },

    // 21 · Merged, then learnt.
    caseLearnt: (c) => {
      const k = K(c);
      const e = k?.docs?.entry;
      return `
      ${caseMap(c, 'merged', 'documented') || stepMap(7, 8)}
      <div class="kick">${esc(k?.key ?? '')} · merged, then learnt</div>
      <h1>${k?.t?.merged != null ? `Merged by a person ${Math.round(k.t.merged / 60)} minutes after the report; then written down` : 'Merged by a person; then written down'}</h1>
      <div class="ts-cols">
        <div class="ts-card" data-b="1"><h3>The knowledge entry${e ? ` · ${esc(e.file)}` : ''}</h3>${e ? `<p><b>${esc(k.key)}: ${esc(e.title)}</b></p>
          <p>${e.fields.filter((f) => !['Search terms', 'Related', 'Resolved', 'Type'].includes(f)).map((f) => `<span class="ts-chip shadow">${esc(f)}</span>`).join(' ')}</p>
          <p>Root cause: ${e.confirmed ? '<b>confirmed</b>' : 'assumed'}${e.assumed && e.confirmed ? ', what is not proven marked <b>assumed</b>' : ''}</p>` : '<p class="sub">Not documented yet.</p>'}</div>
        <div class="ts-card" data-b="2"><h3>The test that guards it</h3>${e?.test ? `<div class="ts-quote">${esc(e.test.replace(/`/g, ''))}</div>` : '<p class="sub">–</p>'}
          <p>Every later analysis of this code reads the entry; the test runs on main every night.</p></div>
      </div>`;
    },

    // 23 · What it caught that people missed.
    caught: (c) => {
      const x = F(c).catches ?? {};
      const cp = missingCopies(c);
      const tile = (k, head, body, b) => `<div class="ts-card ts-tile" data-b="${b}"><span class="k">${esc(k)}</span><h3>${esc(head)}</h3>${body}</div>`;
      return `
      <div class="kick">And more than one case</div>
      <h1>What it caught that people missed</h1>
      <div class="ts-grid two">
        ${x.cross ? tile(x.cross.key, 'A cause in another app', `<p>${esc(plainTitle(x.cross.title))}</p><p>The cause: ${esc(crossWhy(x.cross))}.</p><p><span class="ts-big">${mmss(x.cross.found)}</span> to the cause · ${mmss(x.cross.fixed)} to a draft fix</p>`, 1) : ''}
        ${x.guard ? tile(x.guard.key, (x.guard.fixes ?? []).some((f) => f.testsChanged?.length) ? 'A cheated test' : 'A broken fix, before any report', `<p>A change broke an earlier fix (${esc((x.guard.fixes ?? []).map((f) => f.key).join(', '))})${(x.guard.fixes ?? []).some((f) => f.testsChanged?.length) ? ' and changed its test so CI passed' : ''}.</p><p>The guard ran the test as it was before the commit: <span class="ts-big">${x.guard.minutes} min</span> after the push${x.guard.hoursBefore ? `, ${x.guard.hoursBefore} h before the report` : ''}.</p>`, 2) : ''}
        ${x.review ? tile(x.review.key, 'AI checks AI', `<p>${esc(plainTitle(x.review.title ?? ''))}</p><p>The fix's tests passed. The review: <b>${esc(x.review.verdict)}</b>, risk ${esc(x.review.risk)}: ${esc(firstSentence((x.review.summary.match(/But [^.]+\./)?.[0]) ?? x.review.summary, 180))}</p>`, 3) : ''}
        ${cp ? tile(cp.key, 'A fix missing in its copies', `<p>The fix of ${esc(cp.key)} in <code>${esc(cp.file)}</code> is missing in the same code in</p><p><span class="ts-big">${cp.apps.length}</span> other ${cp.apps.length === 1 ? 'app' : 'apps'}: ${esc(list(cp.apps))}</p>`, 4) : ''}
      </div>`;
    },

    // 24 · The next morning.
    digest: (c) => {
      const d = F(c).digest;
      const strip = (s) => String(s).replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
      return `
      ${stepMap(7, 8)}
      <div class="kick">Every working morning at ${esc(F(c).nightShift?.digestAt ?? '08:00')} · in Teams</div>
      <h1>The morning digest writes itself</h1>
      ${d ? `<div class="ts-teams"><div class="post card"><div class="who">Ticket Intelligence · morning digest · ${esc(longDate(d.at))}</div><b>${esc(String(d.summary).replace(/\s*Cost \$[\d.,]+\.?/, ''))}</b>
        ${d.sections.map((s) => `<p style="margin:8px 0 2px"><b>${esc(s.title)}</b></p><ul>${s.lines.map((l) => `<li>${esc(strip(l))}</li>`).join('')}</ul>`).join('')}</div></div>` : '<p class="sub">No digest yet.</p>'}`;
    },

    // 25 · The dashboard around it, each view with its number.
    views: (c) => {
      const L = longestLived(c);
      const A = c.askStats?.total;
      const I = c.impact?.total;
      const r = replay(c);
      const tile = (k, big, line) => `<div class="ts-card ts-tile"><span class="k">${esc(k)}</span>${big ? `<span class="ts-big">${big}</span>` : ''}<p>${line}</p></div>`;
      return `
      <div class="kick">The dashboard</div>
      <h1>Around every ticket, four views</h1>
      <div class="ts-grid four">
        ${tile('Insights', L ? `${L.days} days` : '', `${L ? `a bug stays in ${esc(L.name)}'s code until it is fixed (median). ` : ''}Hotspots, where bugs come from, who knows what, suggested tickets.`)}
        ${tile('Ask', A?.withoutAi ? pct(A.withoutAi.rate) : '', `${A?.withoutAi ? `of ${A.withoutAi.of} questions answered with no AI. ` : ''}A ticket's status, a page's address to its code, or Claude with checked sources.`)}
        ${tile('Graph', r ? `${r.files.n} of ${r.files.of}` : '', `${r ? `bugs people fixed, replayed: the right file${r.files.n === r.files.of ? ' every time' : ''}. ` : ''}Every ticket's story on one line; how often the agent was right.`)}
        ${tile('Impact', I?.hoursSaved != null ? `${Math.round(I.hoursSaved)} h` : '', `${I?.hoursSaved != null ? `saved for ${usd(I.costUsd)} over ${I.analysed} tickets, by the team's own estimates. ` : ''}The management week.`)}
      </div>`;
    },

    // 26 · One question, live.
    live: (c) => `
      <div class="kick">Live · in the team's Teams channel</div>
      <h1>Ask it where the team works</h1>
      <div class="ts-teams" style="max-width:820px">
        <div class="post"><div class="who">a person in the channel</div><span class="ts-big">ti: ${esc(F(c).live ?? 'VAX-23')}</span></div>
        <div class="post reply"><div class="who">Ticket Intelligence · within seconds · from the agent's records · no AI</div>what happened to the ticket, step by step, and <b>Now</b>: what waits, for whom</div>
      </div>`,

    // 27 · Results against the targets set before the code.
    results: (c) => {
      const a = F(c).analyses;
      const p = F(c).pilot;
      const r = replay(c);
      const k = K(c);
      // The last column: the beats that light the row (deck: time · the pilot · the replay · the policy).
      const rows = [
        ['Time from a new ticket to the analysis in Jira', '< 5 min', a ? `${a.avgSecs} s on average (${a.n} analyses)${k?.t?.notified ? `; the owner told ${mmss(k.t.notified)} after the report` : ''}` : '–', true, '1'],
        ['Likely cause right', '≥ 60 %', `${p ? `pilot ${nOf(p.files)} (the file) and ${nOf(p.culpritNamed)} (the breaking commit)` : ''}${p && r ? '; ' : ''}${r ? `replay ${nOf(r.files)} files` : ''}` || '–', true, '2 3'],
        ['Recommended owner', '≥ 70 %', `${p ? `pilot ${nOf(p.owner)}` : ''}${p && r ? '; ' : ''}${r ? `replay ${nOf(r.owner)}` : ''}; acceptance needs real tickets`, false, '2 3'],
        ['A verified fix', '—', p ? `pilot ${nOf(p.fixPr)}, bisect exact ${nOf(p.bisectExact)}` : '–', true, '2'],
        ['Writes outside the policy', '0', '0', true, '4'],
      ];
      return `
      <div class="kick">Results</div>
      <h1>Against the targets set before any code</h1>
      <table class="ts-table"><thead><tr><th>Metric</th><th>Target</th><th>Result</th></tr></thead><tbody>
        ${rows.map(([what, target, result, ok, b]) => `<tr data-b="${b}"><td>${what}</td><td class="num">${target}</td><td class="${ok ? 'res' : 'open'}">${esc(result)}</td></tr>`).join('')}
      </tbody></table>
      <div class="ts-goal note" data-b="2 3">The pilot's answer keys are hidden from the agent; the replay runs bugs people fixed again as if they were new. Real-ticket numbers need a sample of 20–30 company tickets.</div>`;
    },

    // 28 · What stays with people.
    people: () => `
      <div class="kick">Control</div>
      <h1>What stays with people</h1>
      <div class="ts-grid">
        <div class="ts-card"><h3>Never</h3><p>Merge a fix.</p><p>Change a ticket's priority or status.</p></div>
        <div class="ts-card"><h3>A person decides</h3><p>Approve or reject a fix (a reply in Teams).</p><p>The assignee; every reply to the customer.</p></div>
        <div class="ts-card"><h3>Acts and reports, with a way back</h3><p>The Jira comment, Teams messages, the question to the reporter, the light path, the documentation after 24 h, the night.</p></div>
      </div>
      <div class="ts-goal">Patient data is masked before any model reads a ticket. The model never writes. Every step is logged.</div>`,

    // 29 · Limits and next.
    limits: (c) => `
      <div class="kick">Limits and next steps</div>
      <h1>What it does not do yet, and what comes next</h1>
      <div class="ts-cols">
        <div class="ts-card"><h3>Limits</h3><ul>
          <li data-b="1"><b>Patient data:</b> masked before every model, but an uncommon name can pass${F(c).pilot?.redaction ? ` (${F(c).pilot.redaction.masked} of ${F(c).pilot.redaction.quoted} on the pilot)` : ''}; company tickets need an approved AI service and the DPO's approval.</li>
          <li data-b="2"><b>GitHub Copilot:</b> the same skill files, not tried inside Copilot yet.</li>
          <li data-b="2"><b>SVN:</b> the analysis works; the automatic fix is git only.</li>
          <li data-b="3"><b>Teams:</b> questions in the channel work; approving a fix by a reply is built, not yet run live. The team's own channel needs IT.</li></ul></div>
        <div class="ts-card"><h3>Next</h3><ol>
          <li data-b="4"><b>Approve a fix with a reply in Teams:</b> built; next, the first real round with the team</li>
          <li data-b="5"><b>More on its own, where it has earned it:</b> each kind of work gets more freedom where its record is good, and less where it was wrong</li>
          <li data-b="6"><b>After the merge:</b> release notes, and a reply to the customer for a person to send</li>
          <li data-b="7"><b>A pilot on a company project</b>, once patient data is approved</li></ol></div>
      </div>`,

    thanks: (c) => `
      <div class="ts-title">
        <div class="logo">✦</div>
        <h1>Thank you</h1>
        <p class="lead">Questions?</p>
        ${c.deck?.presenter || c.deck?.contact ? `<div class="who">${c.deck.presenter ? `<b>${esc(c.deck.presenter)}</b>` : ''}${c.deck.presenter && c.deck.contact ? ' · ' : ''}${esc(c.deck.contact ?? '')}</div>` : ''}
      </div>`,

    // ------------------------------------------------------------------ the tour's own slides (?tour)
    pipeline: () => `
      <div class="kick">Behind the scenes</div>
      <h1>From a Jira ticket to a reviewed fix, with nobody starting it</h1>
      <p class="lead">Plain code collects and checks the facts. The AI reads, connects and writes. Only the watcher writes anywhere, and only what the policy allows.</p>
      <div class="ts-flow">
        ${row(1, '1 · Collect', [node('New Jira ticket', 'any of the apps', 0), node('Watcher', 'checks Jira every 30 s', 1), node('System 1, on this machine', 'reads it first, in seconds', 2, 'ai'), node('Facts, by plain code', 'ticket, history, related tickets, commits, code, people', 3)])}
        ${row(2, '2 · Analyze', [node('Claude, headless', 'cannot edit files', 0, 'ai'), node('JSON result', 'checked by code', 1), node('Policy', 'auto · draft · off', 2), node('Jira comment · Teams', 'drafts wait for a human', 3)])}
        ${row(3, '3 · Prove & fix', [node('Own copy of the code', 'a worktree on a branch', 0), node('Test reproduces the bug', 'Playwright or JUnit; must fail', 1, 'ai'), node('Fix', 'smallest change', 2, 'ai'), node('Watcher re-runs everything', 'tests, build, backend', 3), node('Draft pull request', '', 4), node('AI reviewer', 'risk and findings', 5, 'ai')])}
        ${row(4, '4 · Learn', [node('Ticket Done', '', 0), node('Knowledge base', 'docs/knowledge, as a pull request', 1, 'ai'), node('Insights · Ask', 'read all of this history', 2, 'ai')])}
      </div>`,

    ai: (c) => `
      <div class="kick">The AI</div>
      <h1>Claude, by Anthropic, run through Claude Code</h1>
      <p class="lead">Headless runs, started by the watcher. Each run gets only the tools its job needs.</p>
      <div class="ts-grid">
        <div class="ts-card" data-r="1"><h3>Models</h3><p><b>Analysis:</b> Claude Sonnet: fast and cheaper.</p><p><b>Fix, review, Ask, app review:</b> Claude Opus.</p><p>Set in <code>agent.config.json</code>.</p></div>
        <div class="ts-card" data-r="1"><h3>Who does what</h3><p><b>Plain code</b> collects Jira, git or SVN, people and signals, computes scores and checks every result.</p><p><b>The model</b> reads, connects the facts and writes.</p></div>
        <div class="ts-card" data-r="2"><h3>Guardrails</h3><p>The analysis cannot edit files; Ask and the reviewer can only read. No MCP servers, no publishing tools.</p><p>Every cited ticket, commit and file is checked by code.</p></div>
        <div class="ts-card" data-r="2"><h3>Not trained, improved</h3><p>Claude is not fine-tuned: it is the same for everyone and improves through what it reads: instructions, project conventions, commit messages, the knowledge base, tests.</p><p>Only System 1, a small model on this machine, is fine-tuned on our tickets. Each change is scored on tickets with a known answer.</p></div>
        ${c?.full
          ? `<div class="ts-card" data-r="3"><h3>Policy</h3><p>Each action is <b>auto</b>, <b>draft</b> or <b>off</b> in <code>policy.json</code>.</p><p>Auto: the internal Jira comment, the fix as a draft pull request, the review. Draft: the reply to the customer, the assignment. Off: status, priority, <b>merging</b>.</p></div>`
          : '<div class="ts-card" data-r="3"><h3>Cost</h3><p><span class="ts-big">$0.15–0.60</span> per ticket analysis</p><p><span class="ts-big">$0.10–0.40</span> per Ask question, 15–30 s</p></div>'}
        <div class="ts-card" data-r="3"><h3>Patient data</h3><p>Tickets may contain personal and health data. Nothing goes to an AI service outside the approved tools; redaction comes before company tickets.</p></div>
      </div>`,

    built: (c) => `
      <div class="kick">How it was built</div>
      <h1>Problem first, evidence over opinion, and a human decides</h1>
      <div class="ts-cols">
        <div class="ts-card" data-r="1"><h3>The ideas</h3><ol>
          <li><b>Problem first:</b> the problem, success metrics, risks and exit criteria were written and approved before the code.</li>
          <li><b>A skill, then autonomy:</b> <code>/analyze-ticket</code> on demand first, then the watcher that runs it alone.</li>
          <li><b>Evidence over opinion:</b> a test proves the bug, the watcher re-runs every check, every claim cites its source.</li>
          <li><b>A human decides:</b> a policy per action, drafts for anything customer-facing, merging is never automatic.</li></ol></div>
        ${c?.full
          ? `<div class="ts-card" data-r="2"><h3>What we learned</h3><ol>
              <li><b>Check, don't trust.</b> Code checks every ticket, commit and file the model cites before anything is posted.</li>
              <li><b>A bug is proven by a test that fails first.</b> Then the fix must make it pass, with every other test.</li>
              <li><b>The agent improves through what it reads.</b> One change to the prompt for linked apps, and a missed ticket in another app's history was found: 6 → 8 of 8 points.</li>
              <li><b>Test doubles hide cross-app bugs.</b> A fake of the other app still sent the old data, so the tests were green while production was wrong.</li></ol></div>`
          : `<div class="ts-card" data-r="2"><h3>Tested honestly</h3><ul>
              <li>Linked hospital apps with real git history, Jira projects and teams, and a pilot with hidden answer keys</li>
              <li>Bugs brought in by later changes, like real ones; the answer keys are hidden from the agent</li>
              <li>Every run scored: the file, the change that caused it, related tickets, owner, the fix</li></ul>
              <p style="margin-top:10px"><span class="ts-big">~80 s</span> to an analysis in Jira · <span class="ts-big">7 / 7</span> pilot bugs · <span class="ts-big">0</span> writes outside the policy</p></div>`}
      </div>
      ${c?.full ? '' : `<div class="ts-goal" data-r="3"><b>Next:</b> the approval round in Teams, live · a trust ladder for the agent's autonomy · release notes ·
        a reply to the customer after the merge · a pilot on company tickets once patient data is approved.</div>`}`,

    // ------------------------------------------------------------------ backup slides (after the end; → only)
    qaData: (c) => `
      <div class="kick">Questions</div>
      <h1>What about patient data?</h1>
      <div class="ts-grid">
        <div class="ts-card"><h3>Masked first</h3><p>Fiscal codes, IBANs, health cards, e-mails, phones, birth dates and the names of people outside the team are masked before any model reads a ticket.${F(c).pilot?.redaction ? ` On the pilot: ${F(c).pilot.redaction.masked} of ${F(c).pilot.redaction.quoted} quoted identifiers; the misses are uncommon first names, there on purpose.` : ''}</p></div>
        <div class="ts-card"><h3>Nothing out from System 1</h3><p>The small model runs on this machine. A second check on the masked text (the privacy hold) stays in shadow: it missed a name once.</p></div>
        <div class="ts-card"><h3>Before company tickets</h3><p>An approved AI service under a data agreement, and the DPO's approval. The demo and the pilot use invented patients only.</p></div>
      </div>`,
    qaWrong: () => `
      <div class="kick">Questions</div>
      <h1>What if it is wrong?</h1>
      <div class="ts-grid">
        <div class="ts-card"><h3>It says how sure it is</h3><p>Every analysis has a confidence. Below medium, nobody is notified; below high, no fix is attempted.</p></div>
        <div class="ts-card"><h3>It is labelled and checked</h3><p>An internal Jira comment marked as an AI analysis. Every cited ticket, commit and file is checked by code; the knowledge base marks a cause confirmed or assumed.</p></div>
        <div class="ts-card"><h3>A person decides</h3><p>A fix must first make a failing test pass; it is a draft pull request, reviewed, approved and merged by a person.</p></div>
      </div>`,
    qaCost: (c) => {
      const a = F(c).analyses;
      const p = F(c).pilot;
      const A = c.askStats?.total;
      return `
      <div class="kick">Questions</div>
      <h1>What does it cost?</h1>
      <div class="ts-grid">
        <div class="ts-card"><h3>An analysis</h3><p><span class="ts-big">${a ? usd(a.avgCostUsd) : '$0.15–0.60'}</span></p><p>${a ? `on average, ${a.avgSecs} s (${a.n} analyses).` : 'about a minute.'}</p></div>
        <div class="ts-card"><h3>A whole bug</h3><p><span class="ts-big">${p?.costUsd && p.analysed ? usd(p.costUsd / p.analysed) : '$1–2.50'}</span></p><p>from the report to a reviewed fix, on the pilot${p ? ` (${usd(p.costUsd)} for ${p.analysed})` : ''}.</p></div>
        <div class="ts-card"><h3>Ask</h3><p><span class="ts-big">${A?.costPerClaude != null ? usd(A.costPerClaude) : '$0.22'}</span></p><p>per Claude answer; ${A?.withoutAi ? pct(A.withoutAi.rate) : 'most'} of the questions need no AI and cost nothing. System 1, Insights and this presentation are free.</p></div>
      </div>`;
    },
    qaTeams: () => `
      <div class="kick">Questions</div>
      <h1>Does it work with our Teams?</h1>
      <div class="ts-grid">
        <div class="ts-card"><h3>Out</h3><p>A Workflows webhook in a standard channel: about ten minutes for the channel's owner, no IT.</p></div>
        <div class="ts-card"><h3>In</h3><p>Questions and replies are read through Microsoft Graph as one signed-in account: an app registration and the admin's consent once. Outbound only: nothing on this machine is opened to the network.</p></div>
        <div class="ts-card"><h3>Any language</h3><p>A question asked in Serbian was answered in Serbian, from the code, the commits and Jira. A bot with real buttons stays the production path, with IT.</p></div>
      </div>`,
    qaHistory: (c) => {
      const r = replay(c);
      return `
      <div class="kick">Questions</div>
      <h1>Does it know the history?</h1>
      <div class="ts-grid">
        <div class="ts-card"><h3>Already known?</h3><p>Before anything else the analysis asks: a duplicate, in progress, fixed on main, a regression, solved before, documented. It stops the automatic fix when the work is done elsewhere.</p></div>
        <div class="ts-card"><h3>In other words</h3><p>System 1 recognises a known issue described in other words, and runs its regression test on main within minutes.</p></div>
        <div class="ts-card"><h3>Replayed on the past</h3>${r ? `<p><span class="ts-big">${r.files.n} of ${r.files.of}</span></p><p>bugs people fixed, analysed again as if new: a file of the real fix named every time; the owner ${r.owner.n} of ${r.owner.of}.</p>` : '<p>Bugs people fixed are analysed again as if new, and compared with the real fix.</p>'}</div>
      </div>`;
    },
    qaSelf: () => `
      <div class="kick">Questions</div>
      <h1>How much does it do on its own?</h1>
      <div class="ts-grid">
        <div class="ts-card"><h3>It looks after its own work</h3><p>Open fix pull requests are checked again whenever main moves. Documentation merges in any order. A restart waits for the job in progress.</p></div>
        <div class="ts-card"><h3>Autonomy has a way back</h3><p>A light path that turns out to be about code switches itself back to shadow. The question to the reporter waits at most 24 hours. A label <code>hold</code> stops a documentation merge.</p></div>
        <div class="ts-card"><h3>Levels</h3><p><b>L3</b> acts, a person approves: fix PRs. <b>L2</b> acts and reports. <b>L1</b> prepares, a person sends. <b>L0</b> never: merge, priority, status.</p></div>
      </div>`,
    qaInsights: (c) => {
      const rows = Object.entries(c.insights ?? {}).map(([key, x]) => ({ name: (c.apps ?? []).find((a) => a.key === key)?.name ?? key, x })).filter((r) => r.x?.totals);
      return `
      <div class="kick">Questions · Insights</div>
      <h1>Where do the bugs come from?</h1>
      ${rows.length ? `<table class="ts-table"><thead><tr><th>App</th><th>Bugs</th><th>Hotspots</th><th>Days in the code (median)</th><th>Backend services with a unit test</th></tr></thead><tbody>
        ${rows.map(({ name, x }) => `<tr><td><b>${esc(name)}</b></td><td class="num">${x.totals.bugs}</td><td>${esc((x.hotspots ?? []).slice(0, 2).join(', '))}</td><td class="num">${x.origins?.medianDaysInCode ?? '–'}</td><td class="num">${x.testCoverage?.backend ? `${x.testCoverage.backend.tested} of ${x.testCoverage.backend.total}` : '–'}</td></tr>`).join('')}
      </tbody></table>` : '<p class="sub">Insights is still loading.</p>'}
      <div class="ts-goal note">Plain code over git, Jira and the analyses: no AI, no cost. Git blame finds the change that brought each bug in; it names the change, not the person.</div>`;
    },
    tech: (c) => `
      <div class="kick">Technologies</div>
      <h1>What it is made of</h1>
      <div class="ts-grid">
        <div class="ts-card"><h3>AI</h3><p><b>Claude Code</b> CLI, headless (<code>claude -p</code>)</p><p><b>Claude Sonnet</b> for the analysis, <b>Claude Opus</b> for the fix, review and Ask</p><p><b>System 1</b>: a fine-tuned Laya model on this machine (Python, CPU)</p></div>
        <div class="ts-card"><h3>The agent</h3><p><b>Node.js</b> 20, plain ES modules, no npm dependencies</p><p>A watcher, a policy file, a live dashboard</p><p>Agent Skills: <code>SKILL.md</code>, also read by GitHub Copilot</p></div>
        <div class="ts-card"><h3>Integrations</h3><p><b>Jira Cloud</b> REST API v2 · <b>git</b> and <b>SVN</b> · <b>GitHub</b> through <code>gh</code></p><p>${c?.teams?.live ? `<b>Teams</b> through a Workflows webhook: an Adaptive Card in a channel${c.teams.mentions ? ', @mentioning the owner' : ''}; Microsoft Graph to read the channel's questions and replies` : 'Teams: simulated in the POC'}</p></div>
      </div>`,
    sources: () => `
      <div class="kick">Sources</div>
      <h1>Documentation and references</h1>
      <div class="ts-card"><h3>Public documentation</h3><ul class="ts-src">
        ${SOURCES.map(([t, u]) => `<li>${esc(t)} <a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https:\/\//, ''))}</a></li>`).join('')}
      </ul></div>
      <div class="ts-goal note"><b>The project's documents</b> (in the repository, <code>docs/</code>): ${DOCS.map((d) => `<code>${d}.md</code>`).join(' · ')}.</div>`,
  };

  // The "At work" slide (Copilot, git and SVN): in the tour, and a backup slide in the presentation.
  slides.work = () => `
      <div class="kick">At work</div>
      <h1>GitHub Copilot, git and SVN</h1>
      <p class="lead">The same skills on demand in the editor; the autonomous agent runs on Claude Code.</p>
      <div class="ts-grid">
        <div class="ts-card" data-r="1"><h3>GitHub Copilot</h3><p>The two skills, <code>/analyze-ticket</code> and <code>/document-ticket</code>, use the same <code>SKILL.md</code> format: VS Code agent mode and the Copilot CLI read them (<code>node install.mjs</code>).</p><p>Copilot runs the same Node scripts in the terminal, with the model picked there, Claude included.</p><p><b>Status:</b> not tried inside Copilot yet; the test plan is ready.</p></div>
        <div class="ts-card" data-r="2"><h3>git and SVN</h3><p>Detected automatically. git: <code>git log</code>, <code>git show</code>. SVN: <code>svn log --search</code>, <code>svn diff -c</code>, logins mapped to names.</p><p>Tested on an SVN copy of MediAgenda: the same components, people and related tickets as on git.</p></div>
        <div class="ts-card" data-r="3"><h3>Documentation on SVN</h3><p><code>/document-ticket</code> can commit, make a branch (<code>svn copy</code>) or write a patch file. An SVN commit goes straight to the server, so it always asks first. Patch mode is tested.</p><p><b>Git only for now:</b> the automatic fix, pull requests and Insights.</p></div>
      </div>`;

  // System 1 (docs/SYSTEM1_PLAN.md, J9): the tour's chapter slide, and a backup slide in the presentation.
  slides.system1 = () => `
      <div class="kick">Questions · two systems</div>
      <h1>Does every ticket need Claude? No: System 1 decides first</h1>
      <p class="lead">A small model on this machine reads each ticket in a few seconds and picks one of our answers with a probability; Claude, System 2, takes the rest.</p>
      <div class="ts-grid">
        <div class="ts-card" data-r="1"><h3>System 1, local</h3><p>A fine-tuned Laya (multilingual, CPU): type, side, component, urgency, needs code, known issue, privacy. Nothing leaves the machine, no cost per call, and it always answers with one of our options.</p></div>
        <div class="ts-card" data-r="2"><h3>What it decides</h3><p><b>Ask the reporter</b> what a half-written report leaves out. <b>Light path</b> for tickets that are not about code. <b>Known issue</b> in other words, with its regression test run on main. <b>Ask</b> "who knows X" without Claude. <b>Hold</b> a text that still names a patient. Each starts in shadow; the first four act, each with a way back, and the hold stays in shadow.</p></div>
        <div class="ts-card" data-r="3"><h3>Measured</h3><p>Ten new tickets that were not about code: it would have sent <span class="ts-big">6</span> down the light path; Claude analysed all ten as code ($1.83). On reports it never saw: what is wrong 96 %, where 92 %, <b>no bug on the light path</b>. Live: a half-written report asked back in 4 s; "Who knows the exemption code?" answered in 0.9 s, $0.</p></div>
      </div>`;

  // System 1's privacy moment (J9), from the event log (/api/tour/system1): a name the masking did not know.
  slides.system1Privacy = (c) => {
    const x = c.system1?.privacy;
    if (!x) return '';
    const first = String(x.summary ?? '').match(/^[^.!?]+[.!?]/)?.[0] ?? '';
    return `
      <div class="kick">System 1 · privacy</div>
      <h1>A name the masking did not know</h1>
      <p class="lead">Every ticket is masked before a cloud model reads it. System 1 checks the masked text again, on this machine.</p>
      <div class="ts-grid">
        <div class="ts-card" data-r="1"><h3>The masking</h3><p>It replaces the names it knows. In ${esc(x.key)} an uncommon name went through.</p></div>
        <div class="ts-card" data-r="2"><h3>System 1, local</h3><p>On the text with every name masked:</p><p><span class="ts-big">${Math.round(100 * (x.p ?? 0))} %</span> still names a person</p></div>
        <div class="ts-card" data-r="3"><h3>${x.mode === 'shadow' ? 'In shadow, it went on' : 'Held for a person'}</h3>${first && x.mode === 'shadow' ? `<p>The analysis began: “${esc(first)}”</p>` : ''}<p>With the check on, such a ticket waits for a person. Not on yet: on an unseen pilot ticket it missed a name.</p></div>
      </div>`;
  };

  // ------------------------------------------------------------------ what is said (docs/PRESENTATION_PLAN.md, section 3)
  /**
   * The presentation's steps that are slides, by part, and the case's slides (tour.js puts the dashboard steps between
   * them). A step: { part, ch, slide, say, stage (one of the eight steps, for the caption bar's map), hold (stays until
   * →), silent (captions only), backup }. `slidesOnly`: the order of ?deck, with a timeline instead of the dashboard.
   */
  function deck(c) {
    const k = K(c);
    const f = F(c);
    const a = (q) => answer(c, q);
    const s1a = f.system1?.find((x) => x.asked);
    const s1b = f.system1?.find((x) => x.lightPath);
    const actsList = DECISIONS.filter(([key]) => acts(modeOf(c, key))).map(([, name]) => name.toLowerCase());
    const shadowList = DECISIONS.filter(([key]) => modeOf(c, key) && !acts(modeOf(c, key))).map(([, name]) => name.toLowerCase());
    const m = f.model;
    const top = (m?.changes ?? []).filter((x) => QUESTION[x.question] && x.now > x.before).sort((x, y) => y.now - y.before - (x.now - x.before))[0];
    const g = f.catches?.guard;
    const x = f.catches ?? {};
    const cp = missingCopies(c);
    const L = longestLived(c);
    const A = c.askStats?.total;
    const I = c.impact?.total;
    const r = replay(c);
    const pr = f.pilot;
    const d = reproDates(c);
    const langOf = (t) => (/^Buongiorno/.test(String(t ?? '')) ? 'in Italian' : 'in its own language');
    const oneLine = (ch) => ch?.lines?.filter((l) => l.kind === 'del').length === 1 && ch.lines.filter((l) => l.kind === 'add').length === 1;
    // A step said in beats (tour.js): each beat lights the slide's data-b="b" parts while it is said. A beat whose
    // record is missing is left out; the step's words are its beats' words.
    const B = (b, say) => ({ b, say });
    const S = (step, beats) => { const bs = beats.filter((y) => y && y.say); return { ...step, beats: bs, say: bs.map((y) => y.say).join(' ') }; };
    // The same, read when the slide is shown: for a slide whose record arrives after the start (the suite's copies).
    const Slate = (step, build) => Object.defineProperties({ ...step }, {
      beats: { enumerable: true, get: () => build().filter((y) => y && y.say) },
      say: { enumerable: true, get() { return this.beats.map((y) => y.say).join(' '); } },
    });

    const p1 = [
      { ch: 'Welcome', slide: 'title',
        say: 'Hi. This is Ticket Intelligence. In seventeen minutes: what it is, how it works under the hood, one real case from start to end, and one question live.' },
      S({ ch: 'The problem', slide: 'problem' }, [
        B(0, 'Customers ask one question every day: what is the status of my ticket?'),
        B(1, 'To answer it, an engineer reads the ticket and its history, finds the code and what changed there, works out who knows it, and hands it over.'),
        B(2, 'By hand: the customer waits, support cannot say anything concrete, and it is hardest for someone new to the project.'),
      ]),
      S({ ch: 'What it is', slide: 'whatItIs' }, [
        B(0, 'So what is Ticket Intelligence? An AI colleague for the support and development team.'),
        B(1, "For every new Jira ticket, with nobody starting it, it does the first hours of an engineer's work in minutes: it finds the cause in the code, tells the right person, proves the bug with a test, proposes a tested fix, and keeps what was learnt."),
        B(2, 'It works on its own, day and night.'),
        B(3, 'In the tools the team already has.'),
        B(4, 'And a person always decides.'),
      ]),
      S({ ch: 'Before and after', slide: 'beforeAfter' }, [
        B(0, "Here is one real ticket's work, by hand and with it."),
        k?.t?.analysis != null && B(1, `Understanding it: about ${c.impact?.baseline?.analysisMinutes ?? 45} minutes by the team's own estimate, ${k.t.analysis} seconds here.`),
        k?.t?.notified != null && B(2, `The right person: ${spokenTime(k.t.notified)} after the report.`),
        k?.t?.fixNotified != null && B(3, `The bug proven, the change that broke it found, and a tested fix to review: ${spokenTime(k.t.fixNotified)}, where the team estimates three hours.`),
        B(4, 'And what was learnt is written down, so the same bug is caught before a customer finds it again.'),
      ]),
      S({ ch: 'What you get', slide: 'roles' }, [
        B(0, 'What each person gets.'),
        B(1, `Support asks the status of any ticket in Teams${f.teams?.answer?.secs != null ? ` and has it in ${plural(f.teams.answer.secs, 'second')}` : ''}.`),
        B(2, 'Developers get the cause, the change that broke it and a tested fix to review, not to write.'),
        B(3, 'Team leads see the right person told at once, and approve a fix with one reply.'),
        B(4, `Management sees${I?.hoursSaved != null ? ` about ${Math.round(I.hoursSaved)} hours of work saved, by the team's own estimates, and` : ''} where the bugs come from and who knows what.`),
      ]),
      S({ ch: 'The life of a ticket', slide: 'life' }, [
        B(0, 'How? In eight steps.'),
        B(1, 'The ticket is picked and masked, and read by a small local model.'),
        B(2, 'Claude analyses it, and its owner is told in Teams.'),
        B(3, 'A failing test proves the bug, and it is fixed and reviewed.'),
        B(4, 'And what was learnt is written down, and guarded.'),
      ]),
    ];
    const p2 = [
      S({ ch: 'Architecture', slide: 'arch' }, [
        B(1, 'Under the hood there is one program, the watcher, in plain Node.js.'),
        B(2, 'It watches Jira, and works with git, GitHub and Teams.'),
        B(3, 'Inside, three layers. Plain code collects the facts, checks every result and does every write.'),
        B(4, 'System 1, a small model on this machine, decides fast.'),
        B(5, 'Claude, System 2, reasons and writes, but cannot change anything: the watcher acts, and only what the policy allows.'),
      ]),
      S({ ch: 'System 1', slide: 's1How', stage: 2 }, [
        B(1, "System 1 is a small open model, Laya, fine-tuned on our tickets, running on this laptop's processor. It does not write text. For each of its questions it picks one of our answers, and says how sure it is."),
        a('type') && B(2, `Here is a real ticket: ${a('type').choice}, ${pctWord(a('type').p)}${a('screen') ? `; ${a('screen').choice}, ${pctWord(a('screen').p)}` : ''}${a('privacy') ? `; ${a('privacy').choice === 'no person' ? 'no person named' : a('privacy').choice}, ${pctWord(a('privacy').p)}` : ''}.${k?.system1?.ms ? ` ${Math.round(k.system1.ms / 100) / 10} seconds, nothing sent out.` : ' Nothing is sent out.'}`),
      ]),
      S({ ch: 'System 1', slide: 's1Decides', stage: 2 }, [
        B(0, 'What it decides. Seven decisions, each with its own switch.'),
        actsList.length && B(1, `${actsList.length === 7 ? 'All seven act' : `${actsList.length} act today`}: ${list(actsList)}.`),
        shadowList.length && B(2, `${shadowList.length === 1 ? 'One only says' : `${shadowList.length} only say`} what ${shadowList.length === 1 ? 'it' : 'they'} would do: ${list(shadowList)}.`),
        B(3, 'Every decision that acts has a way back, in the last column.'),
      ]),
      S({ ch: 'System 1', slide: 's1Cases', stage: 2 }, [
        B(0, 'Two real cases.'),
        s1a && B(1, `A report that says almost nothing: ${s1a.asked.secs} seconds later the reporter is asked, ${langOf(s1a.asked.text)}, what it leaves out; never for a patient's name. The answer started the analysis${s1a.replied?.duplicateOf ? ', which found it was a duplicate' : ''}.`),
        s1b && B(2, `And a question about ${s1b.answers?.component?.choice ?? 'the app'}: a user question, ${pctWord(s1b.answers?.type?.p)}. A short comment in ${plural(s1b.lightPath.secs, 'second')}, and no Claude run.${s1b.replied ? ' When the reporter replied, the full analysis ran.' : ''}`),
      ]),
      S({ ch: 'System 1', slide: 's1Learns', stage: 2 }, [
        B(1, 'How it learns: Claude teaches it. Every analysis becomes a labelled example.'),
        B(2, 'A new version replaces the current one only if, on tickets it never saw, no answer gets worse.'),
        top && B(3, `The last one: ${QUESTION[top.question]}, from ${top.before} to ${top.now} percent.`),
        B(4, 'New decisions start in shadow, and one that turns out wrong switches itself back.'),
      ]),
      S({ ch: 'The analysis', slide: 'analysis', stage: 3 }, [
        B(1, 'The analysis. A script gathers the facts: related tickets, the commits on that code, who worked on it, the knowledge base.'),
        B(2, 'Claude reads them and opens the code itself, read-only. First: is this already known, a duplicate, already fixed, or a regression? Then the cause with file and line, and the owner and why.'),
        B(3, 'Code checks every source it cites.'),
      ]),
      S({ ch: 'Prove and fix', slide: 'prove', stage: 5 }, [
        B(1, "When the analysis is sure, the agent proves it. It writes a test from the ticket, which must fail on today's code."),
        B(2, 'A bisect then finds the exact commit that broke it.'),
        B(3, 'The fix may not touch the tests, and the watcher re-runs everything itself before it opens a draft pull request.'),
        B(4, 'The owner is told in Teams, and a second AI reviews it.'),
        B(5, 'The owner approves or rejects it with one reply, and merging always stays with a person.'),
      ]),
      S({ ch: 'Learn and guard', slide: 'learnGuard', stage: 7 }, [
        B(1, 'Then it learns: when a ticket is done, what happened is written into the knowledge base, with the test that proves the fix, and every later analysis reads it.'),
        B(2, "And it guards: a change on main that touches an earlier fix runs that fix's test, before a customer sees it."),
        f.nightShift && B(3, `At night it runs all those tests, and at ${morning(f.nightShift.digestAt)} it posts a digest in Teams.`),
      ]),
    ];
    const kinds = maskedKinds(k?.report?.masked);
    const kase = {
      intro: S({ ch: 'One case', slide: 'caseIntro', stage: 1 }, [
        B(1, "Now one real case, whole. It comes from our pilot: every working day a developer's change with a hidden bug goes to main, and the bug is reported later, like in real life; the agent never sees the answer."),
        k?.breaking && B(2, `${k.breaking.author} took the story ${k.breaking.story} in Jira, a small tidy-up, and pushed ${oneLine(k.breaking.change) ? 'this one-line change' : 'this change'} to main.`),
        (k?.breaking?.checks || k?.breaking?.guard) && B(3, 'All the tests passed, and the regression guard had nothing to say.'),
        k?.breaking && B(4, 'The bug is inside.'),
      ]),
      report: S({ ch: 'One case', slide: 'caseReport', stage: 1 }, [
        B(1, `The report arrives: ${plainTitle(k?.title ?? '')}.`),
        kinds.length && B(2, `It names ${list(kinds)}. Before any model reads it, ${kinds.length === 1 ? 'it is' : 'they are'} masked.`),
      ]),
      timeline: { ch: 'One case', slide: 'caseTimeline', stage: 3,
        say: `Here is the whole way, nobody starting anything: the analysis ${spokenTime(k?.t?.analyzed)} after the report, the owner told in Teams at ${spokenTime(k?.t?.notified)}, the bug proven and the breaking commit found, and a reviewed fix at ${spokenTime(k?.t?.fixNotified)}.` },
      thread: S({ ch: 'Teams', slide: 'teamsThread', stage: 6 }, [
        B(1, 'In Teams the owner answers the card.'),
        B(2, 'Approve makes the pull request ready for review and notes it in Jira; reject, with a reason, sends the agent back to fix it again.'),
        f.teams?.answer && B(3, `And anyone can ask in the channel: ti, ${k.key}, was answered${f.teams.answer.secs != null ? ` in ${plural(f.teams.answer.secs, 'second')}` : ''}, from the agent's own records, with no AI.`),
      ]),
      learnt: S({ ch: 'One case', slide: 'caseLearnt', stage: 7 }, [
        B(1, `${k?.t?.merged != null ? `A person merged it ${Math.round(k.t.merged / 60)} minutes after the report. ` : ''}On Done, the agent wrote the knowledge entry: the ${k?.docs?.entry?.confirmed ? 'confirmed ' : ''}cause, the fix, and the test that guards it.`),
        B(2, 'From now on every analysis of this code reads it, and that test runs every night.'),
      ]),
      caught: Slate({ ch: 'What it caught', slide: 'caught', stage: 8 }, () => [
        B(0, 'And what it finds that people miss.'),
        x.cross && B(1, `${plainTitle(x.cross.title).replace(/^[^:]+:\s*/, '').split(/,\s/)[0].replace(/^\w/, (ch) => ch.toUpperCase())}. The cause was in another app: ${crossWhy(x.cross)}, found in ${spokenTime(x.cross.found)}, while the tests were green.`),
        g && B(2, `${(g.fixes ?? []).some((fx) => fx.testsChanged?.length) ? 'A developer who changed a failing test so the build passed' : 'A change that broke an earlier fix'}: caught ${g.minutes} minutes after the push, before anyone reported it.`),
        x.review && B(3, 'A fix whose tests passed, sent back by the AI reviewer.'),
        missingCopies(c) && B(4, `And a fix made in one app and missing in ${plural(missingCopies(c).apps.length, 'copy', 'copies')} of the same code.`),
      ]),
      digest: { ch: 'The next morning', slide: 'digest', stage: 8,
        say: `Every working day at ${morning(f.nightShift?.digestAt)}, the team gets this in Teams: what the agent did, what came back, and what waits for whom.${f.digest ? ` This is the latest one: ${f.digest.summary}` : ''}` },
    };
    const p4 = [
      { ch: 'Live', slide: 'live', hold: true,
        say: `Now one question, live, in the team's channel: ti, ${f.live ?? 'and a ticket key'}. The answer comes in the thread within seconds, from the agent's own records, with no AI.` },
    ];
    const p5 = [
      S({ ch: 'Why it is different', slide: 'different' }, [
        B(1, 'Why it is different. It does the work, and shows its evidence: a test that fails before the fix, and the exact change that broke it.'),
        B(2, 'It works on its own, but a person approves every fix.'),
        B(3, 'It learns from every bug, and guards against it coming back.'),
        B(4, 'It takes minutes, not hours.'),
        B(5, 'And it is safe for a hospital: patient data is masked, and everything it does is logged.'),
      ]),
      S({ ch: 'Results', slide: 'results' }, [
        B(0, 'Against the targets set before any code.'),
        f.analyses && B(1, `An analysis in ${f.analyses.avgSecs} seconds on average${k?.t?.notified ? `, the owner told ${spokenTime(k.t.notified)} after the report` : ''}.`),
        pr && B(2, `On the pilot, where the answer is known, ${pr.files.n} bugs out of ${pr.files.of}: the right file, the commit that broke it, the right person.`),
        r && B(3, `Replayed on ${r.files.of} bugs people fixed, the right file ${r.files.n === r.files.of ? 'every time' : `${r.files.n} times`}.`),
        B(4, 'Nothing written outside the policy.'),
      ]),
      S({ ch: 'Limits and next', slide: 'limits' }, [
        B(1, "The limits. Company tickets need an approved AI service and the data protection officer's approval."),
        B(2, 'Copilot reads the same skills but is not tried yet; on SVN the analysis works, the fix is git only.'),
        B(3, 'Approving in Teams is built but not yet run live.'),
        B(4, 'Next: approving a fix in Teams, for real.'),
        B(5, 'More freedom where its record has earned it.'),
        B(6, 'Release notes, and a reply to the customer.'),
        B(7, 'And a pilot on a company project.'),
      ]),
      { ch: 'Thank you', slide: 'thanks', hold: true,
        say: 'That is Ticket Intelligence: tickets understood in minutes, the bug proven with a test, a fix proposed and reviewed, the right person told, and the knowledge kept. Thank you. Questions?' },
    ];
    const backup = [
      ['people', 'What stays with people?'], ['qaData', 'What about patient data?'], ['qaWrong', 'What if it is wrong?'], ['qaCost', 'What does it cost?'], ['work', 'Does it work with GitHub Copilot and SVN?'],
      ['system1', 'Does every ticket need Claude?'], ['qaTeams', 'Does it work with our Teams?'], ['qaHistory', 'Does it know the history?'], ['qaSelf', 'How much does it do on its own?'],
      ['qaInsights', 'Where do the bugs come from?'], ['digest', 'What does the morning digest say?'], ['views', 'What does the dashboard show?'], ['tech', 'What is it made of?'], ['sources', 'Sources'],
    ].map(([slide, q]) => ({ ch: 'Q&A', slide, hold: true, silent: true, say: `Question: ${q}` }));

    // What is said on the case's dashboard steps (tour.js shows the card, the Teams panel, the Graph tab).
    const t = k?.t ?? {};
    const pa = k?.priorArt?.kind && k.priorArt.kind !== 'none' ? k.priorArt : null;
    const [file, line] = String(k?.analysis?.file ?? '').split(':');
    const bs = bisectSecs(c);
    const bt = backendTests(c);
    const et = browserTests(c);
    const clear = a('expected')?.choice === 'tells what is wrong' && a('screen')?.choice === 'names the screen';
    const codeT = a('type')?.choice === 'bug in code' || a('code')?.choice === 'needs code';
    // Each dashboard step in beats: { at, say, callout }. `at` names the part of the dashboard tour.js lights; the
    // callout is the two to four facts the beat says, large, beside the light (a TV is read from across a room).
    const keep = (bs) => bs.filter((y) => y && y.say);
    const fact = (label, value) => (value ? `<div class="f"><small>${esc(label)}</small><b>${value}</b></div>` : '');
    const box = (title, ...facts) => { const fs = facts.filter(Boolean); return fs.length ? `<div class="k">${esc(title)}</div>${fs.join('')}` : null; };
    const up = (s) => String(s ?? '').replace(/^\w/, (ch) => ch.toUpperCase());
    const prNo = String(k?.prUrl ?? '').match(/(\d+)$/)?.[1];
    const conf = k?.analysis?.confidence;
    const caseBeats = {
      s1: keep([{ at: 's1',
        say: `System 1 reads it${k?.system1?.ms ? ` in ${Math.round(k.system1.ms / 100) / 10} seconds` : ' as it comes in'}${a('type') ? `: ${a('type').choice}` : ''}${a('component') ? `, ${a('component').choice}` : ''}${a('urgency') ? `, ${a('urgency').choice}` : ''}.${clear ? ' Clear enough to need no question' : ''}${codeT ? `${clear ? ', and' : ' It is'} about code` : ''}${clear || codeT ? '.' : ''} On to Claude.`,
        callout: box('System 1 · on this machine', a('type') && fact('Kind', `${esc(a('type').choice)} · ${pct(a('type').p)}`), a('component') && fact('Part of the app', esc(a('component').choice)), a('urgency') && fact('Urgency', esc(a('urgency').choice)), k?.system1?.ms && fact('Time', `${(k.system1.ms / 1000).toFixed(1)} s · nothing sent out`)) }]),
      analysis: keep([
        { at: 'known', say: `${t.analysis != null ? `${t.analysis} seconds after it was picked, the` : 'The'} analysis${conf ? `, with ${conf} confidence` : ''}.${pa ? ` Already known: a ${pa.kind} of ${pa.key}.` : ''}`,
          callout: box('The analysis, by Claude', t.analysis != null && fact('Time', `${t.analysis} s after it was picked`), conf && fact('Confidence', esc(conf)), pa && fact('Already known', `a ${esc(pa.kind)} of ${esc(pa.key)}`)) },
        file && { at: 'cause', say: `The cause, with the file and the line: ${fileName(file)}${line ? `, line ${line}` : ''}.`,
          callout: box('The cause', fact('File and line', `<code>${esc(fileName(file))}${line ? `:${esc(line)}` : ''}</code>`), k?.breaking && fact('Brought in by', `${esc(k.breaking.story)} · commit ${esc(k.breaking.commit)}`), k?.breaking && fact('Written by', esc(k.breaking.author))) },
        k?.analysis?.owner?.name && { at: 'owner', say: `The owner: ${owner(c)}${whyShort(c) ? `, because ${whyShort(c)}` : ''}. It is posted to Jira as an internal comment.`,
          callout: box('The owner', fact('Who', esc(owner(c))), whyShort(c) && fact('Why', esc(up(whyShort(c))))) },
      ]),
      teams: keep([
        { at: 'notice', say: `In the same second, ${owner(c)} gets this in Teams, mentioned by name, so the phone rings.` },
        { at: 'message', say: 'What is wrong, why it is them, where to look, how sure it is.' },
        t.notified != null && { at: 'time', say: `${spokenTime(t.notified)} after the report, and nobody forwarded anything.` },
      ]),
      proof: keep([
        { at: 'repro', say: `Then the proof. The agent writes a ${bt ? 'backend' : 'browser'} test from the ticket: on today's code it fails exactly as reported${d ? `, due on ${isoDay(d.got)} instead of ${isoDay(d.want)}` : ''}.`,
          callout: box('The bug, proven', (bt || et) && fact('A test from the ticket', bt ? 'JUnit, on the backend' : 'Playwright, in the browser'), d && fact('On main it fails', `due ${esc(isoDay(d.got))}, not ${esc(isoDay(d.want))}`), t.reproduced != null && fact('After the report', mmss(t.reproduced))) },
        { at: 'bisect', say: `A bisect then runs that test through the history: broken by ${k?.breaking?.author ? `${k.breaking.author}'s commit` : 'one commit'}${bs ? `, found in ${bs} seconds` : ''}. Not a guess.`,
          callout: box('The change that broke it', k?.breaking && fact('Commit', `${esc(k.breaking.commit)} · ${esc(k.breaking.story)}`), k?.breaking && fact('By', esc(k.breaking.author)), bs && fact('Found by the bisect in', `${bs} s`)) },
      ]),
      fix: keep([
        { at: 'checks', say: `The fix is small. The watcher runs ${bt ? `all ${bt} backend tests` : et ? `all ${et} browser tests` : 'every test'} itself, then opens a draft pull request with the evidence.`,
          callout: box('The fix', (bt || et) && fact('Run by the watcher', bt ? `${bt} backend tests ✓` : `${et} browser tests ✓`), prNo && fact('Draft pull request', `#${esc(prNo)}`), t.pr != null && fact('After the report', mmss(t.pr))) },
        t.fixNotified != null && { at: 'teams', say: `${spokenTime(t.fixNotified)} after the report, ${owner(c)} gets a second message: the fix is ready for review.` },
        { at: 'review', say: `A second AI reviews it, read-only${k?.review ? `: ${k.review.risk} risk, ${plural(k.review.findings, 'finding')}` : ''}. It never approves or merges.`,
          callout: k?.review ? box('AI review, read-only', fact('Risk', esc(k.review.risk)), fact('Findings', String(k.review.findings)), fact('It never', 'approves or merges')) : null },
      ]),
      graph: [{ at: 'lane', say: "And the whole story on one line: the ticket's lane on the Graph tab, from the report to the merged documentation, each step with its time and its link." }],
    };
    const said = (bs) => bs.map((y) => y.say).join(' ');
    const caseSay = Object.fromEntries(Object.entries(caseBeats).map(([key, bs]) => [key, said(bs)]));

    // What is said on the dashboard's own tabs after the case (Insights, Ask, Impact). Functions: the data of a tab is
    // read when its step is spoken, so records that arrived after the start still count.
    const insKey = c.deck?.insights ?? null;
    const insName = (c.apps ?? []).find((x) => x.key === insKey)?.name ?? insKey ?? 'one app';
    const countOf = (srcs, re) => (srcs ?? []).filter((s) => re.test(s)).length;
    // Impact: the weeks since the agent started (the weeks before are zeros), and this week's numbers as on the tiles.
    const impactNow = () => {
      const W = c.impact?.weeks ?? [];
      const start = W.findIndex((w) => w.analysed || w.hoursSaved);
      const now = W.at(-1);
      if (!now || !c.impact?.total) return null;
      const waiting = (c.impact.perProject ?? []).reduce((s, p) => s + (p.waiting?.fixPrs ?? 0) + (p.waiting?.docsPrs ?? 0), 0);
      return { now, total: c.impact.total, weeks: start < 0 ? W.length : W.length - start, waiting };
    };
    const viewBeats = {
      heat: () => {
        const x = c.insights?.[insKey];
        return keep([
          { at: 'kpis', say: `Insights reads the whole history, with no AI. Here, ${insName}${x?.totals ? `: ${x.totals.bugs} bugs` : ''}.` },
          x?.totals && { at: 'heat', say: 'On the map, each by part of the app and by month.' },
          x?.hotspots?.length && { at: 'hotspots', say: `The hotspots, where the next bug is most likely: ${list(x.hotspots.slice(0, 2))}.` },
          x?.origins?.medianDaysInCode != null && { at: 'origins', say: `And a bug stays ${x.origins.medianDaysInCode} days in the code, at the median, until it is fixed.` },
        ]);
      },
      knowledge: () => {
        const x = c.insights?.[insKey];
        const one = (x?.components ?? []).filter((k) => k.team?.length && k.busFactor <= 1).length;
        return keep([
          { at: 'knowledge', say: `The knowledge map: who knows each part of the code, from what they changed${one ? `; ${one === 1 ? 'one part is' : `${one} parts are`} known by one person only` : ''}. It is for knowing whom to ask, not for ranking anyone.` },
          x?.suggestions?.length && { at: 'suggestions', say: `From all this it suggests ${x.suggestions.length} tickets worth opening, each checked against what Jira already has.` },
        ]);
      },
      ask: () => [{ at: 'answer', say: viewSay.ask() }],
      impact: () => {
        const m = impactNow();
        if (!m) return [{ at: 'head', say: 'And Impact, the management week: what the agent did, what waits for a person, and the time it saved.' }];
        return keep([
          { at: 'head', say: "And Impact, the page for management: each week, what the agent did and the hours it saved, by the team's own estimates." },
          { at: 'hours', say: `This week, ${m.now.hoursSaved} hours saved; ${m.total.hoursSaved} in the ${plural(m.weeks, 'week')} since it started.` },
          { at: 'analysed', say: `${plural(m.now.analysed, 'ticket')} analysed.` },
          { at: 'merged', say: `${plural(m.now.fixMerged, 'fix', 'fixes')} merged.` },
          { at: 'documented', say: `${plural(m.now.docsMerged, 'ticket')} documented.` },
          { at: 'waiting', say: `${m.waiting} ${m.waiting === 1 ? 'draft waits' : 'drafts wait'} for a person to review.` },
          { at: 'chart', say: 'And the hours saved, week by week.' },
        ]);
      },
    };
    const viewSay = {
      heat: () => said(viewBeats.heat()),
      knowledge: () => said(viewBeats.knowledge()),
      impact: () => said(viewBeats.impact()),
      ask: () => {
        const q = c.ask;
        if (!q) return 'Ask: anyone asks the knowledge base in plain language, and gets an answer with its sources, or "not in the knowledge base".';
        const spokenQ = q.question.replace(/https?:\/\/[^\s/]+\/([\w-]+)\S*/g, 'the $1 page');
        const t = countOf(q.sources, /^[A-Z][A-Z0-9_]+-\d+$/);
        const cm = countOf(q.sources, /^[0-9a-f]{7,40}$/);
        const fl = countOf(q.sources, /\//);
        return `Ask: anyone asks in plain language, even with the address of the page they are on. "${spokenQ}" ${q.secs ? `${q.secs} seconds later, the answer` : 'The answer'}: ${firstSentence(q.answer, 200)}${t || cm || fl ? ` It cites ${list([t && plural(t, 'ticket'), cm && plural(cm, 'commit'), fl && plural(fl, 'file')].filter(Boolean))}, each checked.` : ''}`;
      },
    };

    const part = (steps, n) => steps.map((s) => ({ ...s, part: n }));
    // The case's steps keep their own objects (Object.assign, not a copy): a step read when it is shown keeps its getters.
    const P = { p1: part(p1, 1), p2: part(p2, 2), case: Object.fromEntries(Object.entries(kase).map(([key, s]) => [key, Object.assign(s, { part: 3 })])), p4: part(p4, 4), p5: part(p5, 5), backup: backup.map((s) => ({ ...s, part: 5, backup: true })) };
    const C = P.case;
    return { ...P, caseSay, caseBeats, viewSay, viewBeats, impactWeeks: () => impactNow()?.weeks ?? null, slidesOnly: [...P.p1, ...P.p2, C.intro, C.report, C.timeline, C.thread, C.learnt, C.caught, ...P.p4, ...P.p5, ...P.backup] };
  }

  /**
   * The case's Teams moment over the dashboard (tour.js #tour-teams), from the card the agent posted: `which` is the
   * owner's card or the fix's; `stage` 'notice' (the owner's phone rings), 'message' (the post as Teams shows it),
   * 'time' (the same, its time after the report lit). Empty when the card is not in the records.
   */
  function teamsPop(c, which, stage) {
    const k = K(c);
    const card = which === 'fix' ? k?.cards?.fix : k?.cards?.owner;
    if (!card) return '';
    const chan = c.teams?.channel ?? 'support-triage';
    const secs = which === 'fix' ? k?.t?.fixNotified : k?.t?.notified;
    if (stage === 'notice') {
      const day = k?.reportedAt ? new Date(Date.parse(k.reportedAt) + (secs ?? 0) * 1000).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
      return `<div class="tm-phone"><div class="clock">${clock(k?.reportedAt, secs) || 'now'}</div><div class="date">${esc(day)}</div>
        <div class="tm-notif"><div class="h"><span class="tm-logo sm">T</span>Microsoft Teams · now</div><b>Ticket Intelligence mentioned you in #${esc(chan)}</b><div>${esc(card.title)}</div></div></div>`;
    }
    const when = secs != null ? `<span class="tm-when${stage === 'time' ? ' hot' : ''}">${mmss(secs)} after the report</span>` : '';
    const body = which === 'fix'
      ? `<div><span class="tm-at">@${esc(card.to)}</span> · fix ready for review</div><div class="tm-title">${esc(card.message)}</div>
         ${card.tests ? `<div class="tm-kv"><span>Checked</span>${esc(card.tests)}</div>` : ''}${card.broke ? `<div class="tm-kv"><span>Broken by</span>${esc(card.broke)}</div>` : ''}
         <div class="tm-btns"><span>Review the pull request</span><span>Open in Jira</span></div>`
      : `<div><span class="tm-at">@${esc(card.to)}</span> · mentioned in Teams</div><div class="tm-title">${esc(plainTitle(card.title))}</div>
         <div>${esc(sentencesOf(card.message, 2))}${sentencesOf(card.message, 2).length < String(card.message ?? '').trim().length ? ' …' : ''}</div>
         ${card.why ? `<div class="tm-kv"><span>Why you</span>${esc(sentencesOf(noParens(card.why), 1))}</div>` : ''}
         ${card.where ? `<div class="tm-kv"><span>Where</span><code>${esc(fileName(card.where))}</code></div>` : ''}
         ${card.confidence ? `<div class="tm-kv"><span>How sure</span>${esc(card.confidence)}</div>` : ''}
         <div class="tm-btns"><span>Open in Jira</span><span>Open in Teams</span></div>`;
    return `<div class="tm-app"><div class="tm-top"><span class="tm-logo">T</span><span class="tm-chan"># ${esc(chan)}</span><span class="tm-tabs"><span class="on">Posts</span></span></div>
      <div class="tm-feed"><div class="tm-msg"><span class="tm-av bot">✦</span><div class="tm-post"><div class="tm-meta"><b>Ticket Intelligence</b><span class="tm-tag">APP</span><span>${clock(k?.reportedAt, secs)}</span>${when}</div>
      <div class="tm-card">${body}</div></div></div></div></div>`;
  }

  window.TourSlides = { css, slides, deck, STEPS, teamsPop, caseTimes };
})();
