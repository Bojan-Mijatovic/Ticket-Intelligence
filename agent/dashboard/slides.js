// The slides of the guided tour and of the presentation around it (?present), with what the voice says on them.
//
// ?tour shows five of them over the dashboard (problem, pipeline, ai, work, built). ?present shows them full screen
// in three parts: the presentation (title → what you'll see), the demo (the tour's own steps on the dashboard), the
// conclusion (what you just saw → sources, thank you) and backup Q&A slides after the end. ?deck is the slides alone.
//
// tour.js plays them: `TourSlides.slides[name](ctx)` is a slide's HTML, `TourSlides.deck(ctx)` the steps of parts 1
// and 3. ctx: { full, mode, deck (agent.config.json "presentation"), apps, cases }, built by tour.js from the page's
// data (the replayed runs, the projects), so the slides and the demo show the same tickets and numbers.
// Elements with data-r="n" appear one group after another while the voice speaks; data-g="n" is lit while group n
// is the newest one.

(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
  /** 92 → "92 seconds", 290 → "about 5 minutes" (for the voice); short: "92 s", "4 min 50 s" (for a slide). */
  const spoken = (secs) => (secs < 90 ? `${secs} seconds` : `about ${plural(Math.round(secs / 60), 'minute')}`);
  const short = (secs) => (secs < 90 ? `${secs} s` : `${Math.floor(secs / 60)} min${secs % 60 ? ` ${secs % 60} s` : ''}`);
  const usd = (x) => `$${x.toFixed(2)}`;

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
    .ts-big { font-size: 28px; font-weight: 800; color: var(--text); font-variant-numeric: tabular-nums; }
    .ts-flow { display: grid; gap: 12px; }
    .ts-row { display: grid; grid-template-columns: 120px 1fr; gap: 12px; align-items: center; }
    .ts-row .lbl { font-weight: 800; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; transition: color .4s; }
    .ts-nodes { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .ts-node { border: 1.5px solid var(--border); border-radius: 10px; padding: 7px 11px; background: var(--surface-2); font-size: 13px; font-weight: 650;
      transition: border-color .4s, background .4s, box-shadow .4s; transition-delay: 0s; }
    .ts-node small { display: block; font-weight: 500; color: var(--muted); font-size: 11.5px; }
    .ts-node.ai::before { content: "✦ "; color: var(--teams); }
    .ts-node.done { border-color: var(--ok); background: var(--ok-soft); }
    .ts-node.done::after { content: " ✓"; color: var(--ok); }
    .ts-arrow { color: var(--muted); font-weight: 700; }
    .ts-row .lbl .total { display: block; margin-top: 4px; color: var(--text); text-transform: none; letter-spacing: 0; font-weight: 650; font-size: 1.05em; }
    .ts-row.hot .lbl { color: var(--accent); }
    .ts-row.hot .ts-node { border-color: var(--accent); background: var(--accent-soft); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
      transition-delay: calc(var(--i, 0) * 260ms); }
    .ts-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 14px; } /* separate: a hidden row hides its borders too */
    .ts-table th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); padding: 6px 10px; border-bottom: 2px solid var(--border); }
    .ts-table td { padding: 9px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
    .ts-table td.num { font-weight: 750; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .ts-table .res { color: var(--ok); font-weight: 750; }
    .ts-table .open { color: var(--warn); font-weight: 650; }
    .ts-app { border: 1.5px solid var(--border); border-radius: 12px; padding: 12px 14px; background: var(--surface-2); }
    .ts-app b { font-size: 16px; }
    .ts-app .key { color: var(--muted); font-weight: 700; font-size: 12px; margin-left: 6px; }
    .ts-app .calls { margin-top: 6px; font-size: 13px; color: var(--muted); }
    .ts-app .calls b { font-size: inherit; color: var(--text); font-weight: 650; }
    .ts-src { columns: 2; column-gap: 28px; margin: 0; padding-left: 18px; }
    .ts-src li { break-inside: avoid; }
    .ts-src a { display: block; font-size: .88em; overflow-wrap: anywhere; }
    .ts-title { display: grid; gap: 10px; }
    .ts-title .logo { width: 64px; height: 64px; border-radius: 16px; background: linear-gradient(135deg, var(--accent), var(--teams)); display: grid; place-items: center; color: #fff; font-size: 32px; }
    .ts-title .who { color: var(--muted); margin-top: 18px; font-size: 16px; }
    .ts-title .who b { color: var(--text); }
    .ts-qa .q { font-size: 13px; font-weight: 800; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }

    /* Full screen (?present, ?deck): the slide covers the dashboard; the caption bar stays below it. */
    #tour-slide.full { inset: 0; left: 0; transform: none; width: auto; max-height: none !important; border: 0; border-radius: 0; box-shadow: none;
      padding: 5vh 6vw calc(var(--tour-bar-h, 150px) + 4vh); display: grid; align-content: center; opacity: 1; transition: opacity .45s ease; }
    #tour-slide.full.out { opacity: 0; pointer-events: none; }
    #tour-slide.full > .page { width: min(1280px, 100%); margin: 0 auto; }
    #tour-slide.full .kick { font-size: clamp(12px, 1vw, 16px); }
    #tour-slide.full h1 { font-size: clamp(26px, 2.8vw, 46px); margin: 6px 0 10px; }
    #tour-slide.full .lead { font-size: clamp(15px, 1.35vw, 22px); margin-bottom: 3vh; }
    #tour-slide.full li, #tour-slide.full .ts-card, #tour-slide.full .ts-table, #tour-slide.full .ts-goal { font-size: clamp(14px, 1.15vw, 19px); }
    #tour-slide.full .ts-card h3, #tour-slide.full .ts-table th { font-size: clamp(12px, .9vw, 15px); }
    #tour-slide.full .ts-node { font-size: clamp(13px, 1.05vw, 17px); padding: 9px 13px; }
    #tour-slide.full .ts-node small { font-size: clamp(11.5px, .85vw, 14px); }
    #tour-slide.full .ts-row { grid-template-columns: 150px 1fr; }
    #tour-slide.full .ts-row .lbl { font-size: clamp(12px, .95vw, 15px); }
    #tour-slide.full .ts-big { font-size: clamp(28px, 2.6vw, 42px); }
    #tour-slide.full .ts-app b { font-size: clamp(16px, 1.3vw, 21px); }
    #tour-slide.full .ts-app .calls { font-size: clamp(13px, 1vw, 16px); }
    #tour-slide.full .ts-title { justify-items: center; text-align: center; }
    #tour-slide.full .ts-title h1 { font-size: clamp(40px, 5vw, 80px); }
    #tour-slide.full .ts-title .lead { font-size: clamp(18px, 1.8vw, 30px); }
    #tour-slide.full .ts-title .who { font-size: clamp(15px, 1.3vw, 22px); }
    @media (max-width: 900px) { .ts-cols, .ts-grid, .ts-grid.two, .ts-grid.four { grid-template-columns: 1fr; } .ts-row, #tour-slide.full .ts-row { grid-template-columns: 1fr; }
      #tour-slide { padding: 18px; } .ts-src { columns: 1; } }
  `;

  // ------------------------------------------------------------------ pieces
  const node = (t, s, i, cls = '') => `<span class="ts-node ${cls}" style="--i:${i}">${t}${s ? `<small>${s}</small>` : ''}</span>`;
  const row = (g, label, nodes) => `<div class="ts-row" data-r="${g}" data-g="${g}"><div class="lbl">${label}</div><div class="ts-nodes">${nodes.join('<span class="ts-arrow">→</span>')}</div></div>`;
  /** The success metrics: the targets set before the code (docs/PROBLEM_BRIEF.md), and what the POC measured. */
  const METRICS = [
    { what: 'Time from a new ticket to the analysis in Jira', target: '< 5 min', result: '~80 s', ok: true },
    { what: 'Related history found (the earlier ticket it refers to)', target: '≥ 80 %', result: 'found; the one miss fixed by a prompt change', ok: true },
    { what: 'Likely cause right', target: '≥ 60 %', result: 'right in every scored case: 6–8 / 8 points', ok: true },
    { what: 'Recommended owner accepted', target: '≥ 70 %', result: 'to be measured on real tickets', ok: false },
    { what: 'Writes outside the policy', target: '0', result: '0', ok: true },
    { what: 'Time for a developer to orient on an unfamiliar ticket', target: '−50 %', result: 'to be measured on real tickets', ok: false },
  ];
  const metricsTable = (withResults) => `
    <table class="ts-table"><thead><tr><th>Metric</th><th>Target</th>${withResults ? '<th>POC result</th>' : ''}</tr></thead><tbody>
      ${METRICS.map((m, i) => `<tr data-r="${withResults ? Math.min(3, Math.floor(i / 2) + 1) : Math.min(2, Math.floor(i / 3) + 1)}"><td>${m.what}</td><td class="num">${m.target}</td>${withResults ? `<td class="${m.ok ? 'res' : 'open'}">${m.result}</td>` : ''}</tr>`).join('')}
    </tbody></table>`;
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
  const DOCS = ['PROBLEM_BRIEF', 'SPEC', 'DEMO_SCENARIO', 'DEPENDENCIES_AND_RISKS', 'EXIT_CRITERIA', 'AGENT_TRAINING', 'SUITE', 'ROADMAP'];

  /** A case's line on the recap slide. */
  const caseNodes = (c) => [
    node(esc(c.key), esc(c.app), 0, 'done'),
    node('Analysis', c.analyzeSecs ? `in Jira after ${short(c.analyzeSecs)}` : 'in Jira', 1, 'done ai'),
    ...(c.cross ? [node(`Cause in ${esc(c.cross)}`, c.fixIn ? `fix belongs in ${esc(c.fixIn)}` : '', 2, 'done ai')] : []),
    ...(c.reproduced ? [node('Test fails', c.side === 'backend' ? 'JUnit' : 'Playwright', 3, 'done ai')] : []),
    ...(c.fixed ? [node('Fix', 'checks re-run · draft PR', 4, 'done ai')] : []),
    ...(c.risk ? [node('AI review', `risk ${esc(c.risk)}`, 5, 'done ai')] : []),
  ];
  /** A case's label on the recap slide: its number and, below, its total time. */
  const caseLabel = (c, i) => `Case ${i + 1}${c.totalSecs ? `<small class="total">${short(c.totalSecs)}<br>nobody started it</small>` : ''}`;

  // ------------------------------------------------------------------ slides
  const slides = {
    title: (c) => `
      <div class="ts-title">
        <div class="logo" data-r="1">✦</div>
        <div class="kick" data-r="1">Proof of concept · ${esc(new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }))}</div>
        <h1 data-r="1">Ticket Intelligence</h1>
        <p class="lead" data-r="1">From a Jira ticket to a reviewed fix, with nobody starting it</p>
        ${c.deck?.presenter || c.deck?.team ? `<div class="who" data-r="1">${c.deck.presenter ? `<b>${esc(c.deck.presenter)}</b>` : ''}${c.deck.presenter && c.deck.team ? ' · ' : ''}${esc(c.deck.team ?? '')}</div>` : ''}
      </div>`,

    problem: (c) => `
      <div class="kick">The problem</div>
      <h1>“I opened a ticket. What is the status? Can it be sped up?”</h1>
      <p class="lead">Customers of hospital scheduling systems ask this every day. A good answer takes a lot of digging.</p>
      <div class="ts-cols">
        <div class="ts-card" data-r="1"><h3>To answer well, an engineer has to</h3><ol>
          <li>read the ticket, its comments, history and screenshots</li>
          <li>search Jira for earlier tickets with the same symptom</li>
          <li>find where it lives in the code, and what changed there recently</li>
          <li>work out who knows that part of the code</li>
          <li>hand it over, with the context, to that person</li></ol></div>
        <div class="ts-card" data-r="2"><h3>Today it is done by hand</h3><ul>
          <li><b>Customers</b> wait for a real answer</li>
          <li><b>Support</b> cannot say anything concrete without a developer</li>
          <li><b>Developers new to a project</b> do not know the code, the history, or whom to ask</li>
          <li><b>Team leads</b> spend their time routing tickets and chasing status</li>
          <li><b>Experienced developers</b> keep explaining old history again</li></ul></div>
      </div>
      ${c?.full
        ? `<div class="ts-goal note" data-r="3"><b>An example from the demo data:</b> a new bug in the Struttura search field was the same defect as one fixed two months earlier,
          and that fix's code review had even predicted it. Without that history, a new engineer starts from zero.</div>`
        : `<div class="ts-goal" data-r="3"><b>The goal:</b> for every new ticket, within minutes and with no human start, an analysis with evidence in Jira,
          the right person informed, drafts for a human to approve, and the knowledge kept when it is solved.</div>`}`,

    goals: () => `
      <div class="kick">The goal</div>
      <h1>For every new ticket, within minutes, with no human start</h1>
      <p class="lead">An analysis with evidence in Jira, the right person informed, drafts a human approves, and the knowledge kept when it is solved.
        The targets were set and approved before any code.</p>
      ${metricsTable(false)}`,

    pipeline: () => `
      <div class="kick">Behind the scenes</div>
      <h1>From a Jira ticket to a reviewed fix, with nobody starting it</h1>
      <p class="lead">Plain code collects and checks the facts. The AI reads, connects and writes. Only the watcher writes anywhere, and only what the policy allows.</p>
      <div class="ts-flow">
        ${row(1, '1 · Collect', [node('New Jira ticket', 'any of the 4 apps', 0), node('Watcher', 'checks Jira every 30 s', 1), node('Facts, by plain code', 'ticket, history, related tickets, commits, code, people', 2)])}
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
        <div class="ts-card" data-r="2"><h3>Not trained, improved</h3><p>No fine-tuning: the model is the same for everyone. It improves through what it reads: instructions, project conventions, commit messages, the knowledge base, tests.</p><p>Each change is scored on tickets with a known answer.</p></div>
        ${c?.full
          ? `<div class="ts-card" data-r="3"><h3>Policy</h3><p>Each action is <b>auto</b>, <b>draft</b> or <b>off</b> in <code>policy.json</code>.</p><p>Auto: the internal Jira comment, the fix as a draft pull request, the review. Draft: the reply to the customer, the assignment. Off: status, priority, <b>merging</b>.</p></div>`
          : '<div class="ts-card" data-r="3"><h3>Cost</h3><p><span class="ts-big">$0.15–0.60</span> per ticket analysis</p><p><span class="ts-big">$0.10–0.40</span> per Ask question, 15–30 s</p></div>'}
        <div class="ts-card" data-r="3"><h3>Patient data</h3><p>Tickets may contain personal and health data. Nothing goes to an AI service outside the approved tools; redaction comes before company tickets.</p></div>
      </div>`,

    setup: (c) => {
      const apps = c.apps?.length ? c.apps : [];
      const name = (k) => apps.find((a) => a.key === k)?.name ?? k;
      return `
      <div class="kick">The demo</div>
      <h1>Four linked hospital apps, built to be realistic</h1>
      <p class="lead">Each with its own Jira project, git history and team. They call each other's APIs, so a bug can start in another app.</p>
      <div class="ts-grid two" data-r="1">
        ${apps.map((a) => `<div class="ts-app"><b>${esc(a.name)}</b><span class="key">${esc(a.key)}</span><div>${esc(a.role ?? '')}</div>
          <div class="calls">${a.linked?.length ? `calls <b>${esc(list(a.linked.map(name)))}</b>` : 'called by the others'}</div></div>`).join('')}
      </div>
      <div class="ts-grid" style="margin-top:16px">
        <div class="ts-card" data-r="2"><h3>Real services</h3><p>A real Jira Cloud project per app, real git repositories on GitHub, real draft pull requests. Teams messages are simulated.</p></div>
        <div class="ts-card" data-r="2"><h3>Real-looking bugs</h3><p>Each one brought in by a later change, with a trace in Jira. The answer keys are hidden from the agent; every run is scored.</p></div>
        <div class="ts-card" data-r="3"><h3>Today</h3><p>The cases are real runs of the agent, shown again with their real timings; a recorded run is replayed faster and marked <b>REPLAY</b>. Nothing is started or paid now.</p></div>
      </div>`;
    },

    preview: (c) => {
      const [a, b] = c.cases ?? [];
      return `
      <div class="kick">The demo</div>
      <h1>What you will see</h1>
      <div class="ts-grid four">
        <div class="ts-card" data-r="1"><h3>Case 1</h3><p><b>${esc(a?.key ?? 'A new ticket')}</b> · ${esc(a?.app ?? '')}</p><p class="sub">${esc(a?.title ?? '')}</p><p>From Jira to a reviewed pull request.</p></div>
        <div class="ts-card" data-r="1"><h3>Case 2</h3>${b ? `<p><b>${esc(b.key)}</b> · ${esc(b.app)}</p><p class="sub">${esc(b.title)}</p>` : ''}<p>The cause is in another app.</p></div>
        <div class="ts-card" data-r="2"><h3>Insights</h3><p>The whole history: where bugs come from, who knows what, what to fix next.</p></div>
        <div class="ts-card" data-r="2"><h3>Ask</h3><p>A question in plain English, answered with checked sources, or “not in the knowledge base”.</p></div>
      </div>`;
    },

    recap: (c) => `
      <div class="kick">${c.mode === 'deck' ? 'The demo' : 'Back to the slides'}</div>
      <h1>${c.mode === 'deck' ? 'What the demo shows' : 'What you just saw'}</h1>
      <p class="lead">Every step from the diagram, with the real timings of these runs.</p>
      <div class="ts-flow">
        ${(c.cases ?? []).map((x, i) => `<div class="ts-row" data-r="${i + 1}"><div class="lbl">${caseLabel(x, i)}</div><div class="ts-nodes">${caseNodes(x).join('<span class="ts-arrow">→</span>')}</div></div>`).join('')}
      </div>
      <div class="ts-goal" data-r="3">Then <b>Insights</b> read the whole history for free, and <b>Ask</b> answered from checked sources, or said it did not know.</div>`,

    results: (c) => {
      const costs = (c.cases ?? []).map((x) => x.cost).filter((x) => x > 0);
      return `
      <div class="kick">Results</div>
      <h1>Against the targets</h1>
      ${metricsTable(true)}
      <div class="ts-goal note" data-r="3"><b>Cost:</b> $0.15–0.60 per ticket analysis${costs.length ? ` (the demo's: ${costs.map(usd).join(', ')})` : ''}, $0.10–0.40 per Ask question; Insights is plain code and free.
        Scored on 7 demo scenarios with hidden answer keys. Real-ticket numbers need a sample of 20–30 company tickets.</div>`;
    },

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
              <li>Four linked hospital apps with real git history, Jira projects and teams</li>
              <li>Bugs brought in by later changes, like real ones; the answer keys are hidden from the agent</li>
              <li>Every run scored: the file, the change that caused it, related tickets, owner, the fix</li></ul>
              <p style="margin-top:10px"><span class="ts-big">~80 s</span> to an analysis in Jira · <span class="ts-big">6–8 / 8</span> scored · <span class="ts-big">0</span> writes outside the policy</p></div>`}
      </div>
      ${c?.full ? '' : `<div class="ts-goal" data-r="3"><b>Next:</b> approval straight from Teams · a night shift with a morning digest · release notes ·
        a reply to the customer after the merge · redaction of patient data before company tickets.</div>`}`,

    tech: () => `
      <div class="kick">Technologies</div>
      <h1>What it is made of</h1>
      <div class="ts-grid">
        <div class="ts-card" data-r="1"><h3>AI</h3><p><b>Claude Code</b> CLI, headless (<code>claude -p</code>)</p><p><b>Claude Sonnet</b> for the analysis, <b>Claude Opus</b> for the fix, review and Ask</p><p>Agent Skills: <code>SKILL.md</code>, also read by GitHub Copilot</p></div>
        <div class="ts-card" data-r="1"><h3>The agent</h3><p><b>Node.js</b> 20, plain ES modules, no npm dependencies</p><p>A watcher, a policy file, a live dashboard (HTML, server-sent events)</p><p>Runs on one Windows workstation</p></div>
        <div class="ts-card" data-r="2"><h3>Integrations</h3><p><b>Jira Cloud</b> REST API v2</p><p><b>git</b> (worktrees per ticket) and <b>SVN</b> 1.14</p><p><b>GitHub</b> through <code>gh</code>: draft pull requests and reviews</p><p>Teams: simulated in the POC</p></div>
        <div class="ts-card" data-r="2"><h3>The demo apps</h3><p><b>Angular</b> 18 · <b>Spring Boot</b> 3.3 on Java 21</p><p>H2 with Flyway migrations</p><p><b>Playwright</b> 1.64 browser tests · <b>JUnit</b> with Maven 3.9</p></div>
        <div class="ts-card" data-r="3"><h3>Insights</h3><p>Plain code over git, Jira and the analyses: blame, churn, hotspots, bus factor. No AI, no cost.</p></div>
        <div class="ts-card" data-r="3"><h3>This presentation</h3><p>The dashboard itself, with the browser's own speech synthesis (Web Speech API): free, nothing leaves the machine.</p></div>
      </div>`,

    limits: () => `
      <div class="kick">Limits and next steps</div>
      <h1>What it does not do yet, and what comes next</h1>
      <div class="ts-cols">
        <div class="ts-card" data-r="1"><h3>Limits</h3><ul>
          <li><b>Patient data:</b> redaction and an approved AI service are required before company tickets.</li>
          <li><b>GitHub Copilot:</b> same skill files, not tried inside Copilot yet; the test plan is ready.</li>
          <li><b>SVN:</b> the analysis gives the same result as on git; the automatic fix, pull requests and Insights are git only.</li>
          <li><b>Real tickets:</b> owner acceptance and time saved still need a sample of 20–30 company tickets.</li></ul></div>
        <div class="ts-card" data-r="2"><h3>Next</h3><ol>
          <li>Approval straight from Teams: approve or reject the fix on a card</li>
          <li>A night shift with a morning digest</li>
          <li>Release notes and a sprint report</li>
          <li>A reply to the customer after the merge</li>
          <li><b>A pilot on a company project</b>, with redaction first</li></ol></div>
      </div>`,

    sources: () => `
      <div class="kick">Sources</div>
      <h1>Documentation and references</h1>
      <div class="ts-card" data-r="1"><h3>Public documentation</h3><ul class="ts-src">
        ${SOURCES.map(([t, u]) => `<li>${esc(t)} <a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https:\/\//, ''))}</a></li>`).join('')}
      </ul></div>
      <div class="ts-goal note" data-r="2"><b>The project's documents</b> (in the repository, <code>docs/</code>): ${DOCS.map((d) => `<code>${d}.md</code>`).join(' · ')}.</div>`,

    thanks: (c) => `
      <div class="ts-title">
        <div class="logo" data-r="1">✦</div>
        <h1 data-r="1">Thank you</h1>
        <p class="lead" data-r="1">Questions?</p>
        ${c.deck?.presenter || c.deck?.contact ? `<div class="who" data-r="1">${c.deck.presenter ? `<b>${esc(c.deck.presenter)}</b>` : ''}${c.deck.presenter && c.deck.contact ? ' · ' : ''}${esc(c.deck.contact ?? '')}</div>` : ''}
      </div>`,

    // Backup slides for the questions: after the end, reached with → only.
    qaData: () => `
      <div class="kick">Questions</div>
      <h1>What about patient data?</h1>
      <div class="ts-grid">
        <div class="ts-card" data-r="1"><h3>In the POC</h3><p>Only fictional demo data: invented patients, tickets and code.</p></div>
        <div class="ts-card" data-r="1"><h3>Before company tickets</h3><p>Personal and health data is redacted before the analysis, and only a company-approved AI service is used. This is a precondition, not an option.</p></div>
        <div class="ts-card" data-r="1"><h3>What leaves the machine</h3><p>The analysis sends the ticket and the code it reads to the model. The Insights statistics and this voice send nothing.</p></div>
      </div>`,
    qaWrong: () => `
      <div class="kick">Questions</div>
      <h1>What if it is wrong?</h1>
      <div class="ts-grid">
        <div class="ts-card" data-r="1"><h3>It says how sure it is</h3><p>Every analysis has a confidence. Below medium, nobody is notified; below high, no fix is attempted.</p></div>
        <div class="ts-card" data-r="1"><h3>It is labelled</h3><p>An internal Jira comment marked as an AI analysis, “please verify before acting on it”. Every cited ticket, commit and file is checked by code.</p></div>
        <div class="ts-card" data-r="1"><h3>A human decides</h3><p>A fix must first make a failing test pass; it is a draft pull request, reviewed, and merged only by a person. Customer replies are drafts.</p></div>
      </div>`,
    qaCost: () => `
      <div class="kick">Questions</div>
      <h1>What does it cost?</h1>
      <div class="ts-grid">
        <div class="ts-card" data-r="1"><h3>Per ticket</h3><p><span class="ts-big">$0.15–0.60</span></p><p>for the analysis, about a minute and ten agent turns. The fix and the review are separate, longer runs.</p></div>
        <div class="ts-card" data-r="1"><h3>Ask</h3><p><span class="ts-big">$0.10–0.40</span></p><p>per question, 15–30 seconds.</p></div>
        <div class="ts-card" data-r="1"><h3>Free</h3><p>Insights (plain code), the dashboard, this tour. API-equivalent prices; seat-based subscriptions include the runs.</p></div>
      </div>`,
  };

  // ------------------------------------------------------------------ the presentation's steps (parts 1 and 3)
  /**
   * The steps before and after the demo, and the backup Q&A. A step: { part, ch, slide, say, stagger (reveal the
   * groups while speaking), hold (stay there, the end), silent (captions only) }.
   */
  function deck(c) {
    const [a, b] = c.cases ?? [];
    const demo = c.mode !== 'deck';
    const caseLine = (x) => (x.risk && x.fixed
      ? `${x.key} went from Jira to a reviewed pull request in ${spoken(x.totalSecs)}: the analysis after ${spoken(x.analyzeSecs)}, a test that failed first, a fix with every check re-run, and a review with ${x.risk} risk.`
      : `${x.key} was analyzed in ${spoken(x.analyzeSecs)}${x.fixed ? ', and a fix proposed as a draft pull request' : ''}.`);
    const intro = [
      { ch: 'Welcome', slide: 'title',
        say: `Hi, and welcome. This is Ticket Intelligence: an AI agent that reads every new Jira ticket, finds the code behind it, proves the bug with a test, proposes a fix, and gets it to the right person. First a few slides on why and how,${demo ? ' then a demo,' : ''} then the results.` },
      { ch: 'The problem', slide: 'problem', stagger: true,
        say: 'Customers open a ticket, then ask: what is the status, can it be sped up? To answer well, an engineer reads the ticket and its history, looks for earlier tickets like it, finds the code and what changed there, and works out who knows it. All by hand. In our demo data, a new bug was the same defect as one fixed two months earlier, and the old review had even predicted it. Without that history, you start from zero.' },
      { ch: 'The goal', slide: 'goals', stagger: true,
        say: 'So the goal: for every new ticket, within minutes and with no human start, an analysis with evidence in Jira, the right person informed, and drafts a human approves. The targets were set before any code: under five minutes, the history found in eight of ten tickets, the cause right in six of ten, and no writes outside the policy. We will come back to them at the end.' },
      { ch: 'How it works', slide: 'pipeline', stagger: true,
        say: 'How it works. A watcher checks Jira every thirty seconds. Plain code collects the facts. Claude reads them, in a run that cannot edit files, and returns a result the code checks; a policy decides what goes out on its own. When the bug is clear, the agent proves it with a test that must fail, makes the smallest fix, and the watcher re-runs every check before a draft pull request and an AI review. When the ticket is done, the cause and the fix go into the knowledge base.' },
      { ch: 'The AI', slide: 'ai', stagger: true,
        say: 'The AI is Claude, by Anthropic, run headless through Claude Code: Sonnet for the analysis, Opus for the fix, the review and Ask. Code collects the facts and checks every result; the model reads, connects and writes. Each run gets only the tools it needs, and merging is never automatic. It is not trained on our data: it improves through what it reads.' },
      { ch: 'The demo', slide: 'setup', stagger: true,
        say: `The demo runs on four linked hospital apps: booking, laboratory, pharmacy and billing, each with its own Jira project, git history and team, calling each other's APIs. The bugs came in with later changes, like real ones, and the answers are hidden from the agent. ${demo ? 'The cases you will see' : 'The cases'} are real runs of the agent, shown again with their real timings, so nothing is paid now.` },
      ...(demo ? [{ ch: 'The demo', slide: 'preview', stagger: true,
        say: `Case one: a ticket from Jira to a reviewed pull request. Case two: a bug whose cause is in another app. Then Insights and Ask. Let's go to the dashboard.` }] : []),
    ];
    const outro = [
      ...(a ? [{ ch: 'Recap', slide: 'recap', stagger: true,
        say: `${demo ? 'Back to the slides. What you just saw: ' : 'In the demo, '}${caseLine(a)}${b ? ` ${b.key} was traced to ${b.cross ?? 'another app'} and fixed where it belongs.` : ''} Nobody started either of them.` }] : []),
      { ch: 'Results', slide: 'results', stagger: true,
        say: 'Against the targets: about eighty seconds to an analysis in Jira, against five minutes. The cause was right in every scored case, six to eight points out of eight; the one missed earlier ticket was found after a prompt change. No writes outside the policy. An analysis costs fifteen to sixty cents. Not proven yet: whether people accept the owner it picks, and how much time it saves. That needs twenty to thirty real tickets.' },
      { ch: 'How it was built', slide: 'built', stagger: true,
        say: 'It was built problem first: the targets, risks and exit criteria were approved before any code. Then a skill on demand, then the watcher that runs it alone. What we learned: check, do not trust; prove a bug with a test that fails first; and the agent improves through what it reads. One change to the prompt, and a missed ticket in another app was found.' },
      { ch: 'Technologies', slide: 'tech', stagger: true,
        say: 'The technology: Claude Code, headless, with Sonnet and Opus. The agent is plain Node.js with no dependencies, talking to Jira Cloud, to git or SVN, and to GitHub. The demo apps are Angular and Spring Boot, tested with Playwright and JUnit. And the voice you hear is the browser’s own speech.' },
      { ch: 'Next', slide: 'limits', stagger: true,
        say: 'The limits. Patient data must be redacted, with an approved AI service, before company tickets. Copilot reads the same skills, but is not tried yet; on SVN the analysis works, the automatic fix is git only. Next: approval from Teams, a night shift, release notes, a reply to the customer after the merge, and a pilot on a company project.' },
      { ch: 'Sources', slide: 'sources', stagger: true,
        say: 'The sources are on the screen: the public documentation behind each part, and the project’s own documents.' },
      { ch: 'Thank you', slide: 'thanks', hold: true,
        say: 'That is Ticket Intelligence: tickets understood in minutes, the bug proven with a test, a fix proposed and reviewed, and the knowledge kept. Thank you. Questions?' },
    ];
    const backup = [
      { ch: 'Q&A', slide: 'qaData', hold: true, silent: true, say: 'Question: what about patient data?' },
      { ch: 'Q&A', slide: 'qaWrong', hold: true, silent: true, say: 'Question: what if it is wrong?' },
      { ch: 'Q&A', slide: 'qaCost', hold: true, silent: true, say: 'Question: what does it cost?' },
      { ch: 'Q&A', slide: 'work', hold: true, silent: true, say: 'Question: does it work with GitHub Copilot and SVN?' },
    ];
    return {
      intro: intro.map((s) => ({ ...s, part: 1 })),
      outro: outro.map((s) => ({ ...s, part: 3 })),
      backup: backup.map((s) => ({ ...s, part: 3, backup: true })),
    };
  }

  // The "At work" slide (Copilot, git and SVN): in the tour, and a backup Q&A slide in the presentation.
  slides.work = () => `
      <div class="kick">At work</div>
      <h1>GitHub Copilot, git and SVN</h1>
      <p class="lead">The same skills on demand in the editor; the autonomous agent runs on Claude Code.</p>
      <div class="ts-grid">
        <div class="ts-card" data-r="1"><h3>GitHub Copilot</h3><p>The two skills, <code>/analyze-ticket</code> and <code>/document-ticket</code>, use the same <code>SKILL.md</code> format: VS Code agent mode and the Copilot CLI read them (<code>node install.mjs</code>).</p><p>Copilot runs the same Node scripts in the terminal, with the model picked there, Claude included.</p><p><b>Status:</b> not tried inside Copilot yet; the test plan is ready.</p></div>
        <div class="ts-card" data-r="2"><h3>git and SVN</h3><p>Detected automatically. git: <code>git log</code>, <code>git show</code>. SVN: <code>svn log --search</code>, <code>svn diff -c</code>, logins mapped to names.</p><p>Tested on an SVN copy of MediAgenda: the same components, people and related tickets as on git.</p></div>
        <div class="ts-card" data-r="3"><h3>Documentation on SVN</h3><p><code>/document-ticket</code> can commit, make a branch (<code>svn copy</code>) or write a patch file. An SVN commit goes straight to the server, so it always asks first. Patch mode is tested.</p><p><b>Git only for now:</b> the automatic fix, pull requests and Insights.</p></div>
      </div>`;

  window.TourSlides = { css, slides, deck };
})();
