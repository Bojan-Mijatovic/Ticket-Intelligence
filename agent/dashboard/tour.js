// Guided tour of the dashboard, about ten minutes in English. The page drives itself: a cursor moves and clicks, a
// spotlight shows each part, explainer slides open over the page, and a voice narrates (the browser's own speech
// synthesis), with captions.
//
// It tells the whole story: the problem, how the agent works behind the scenes, which AI it uses and how it is kept
// honest, three real cases, Insights, Ask, and how it was built. When no ticket has been analyzed since the last
// reset, the cases are recorded runs from the event logs, replayed sped up with their real timings
// (/api/tour/replay); Ask replays recorded answers (/api/tour/asks). Replays carry a REPLAY badge and live only in
// this page.
//
// Read-only: it never starts an agent run, an Ask question, a review or a recommendation.
//
// Start it with the ▶ Tour button in the header, or open the dashboard with ?tour (a click is still needed: browsers
// do not let a page speak before the person has clicked on it). It uses the dashboard's own globals (tickets, status,
// showTab, selectProject, apply, render, answers, …): top-level let/const of the page's script are visible here too.

(() => {
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  // Natural English voices first (Edge on Windows has them), then the usual Windows and Chrome ones.
  const PREFERRED = [/Aria.*Natural/i, /Jenny.*Natural/i, /Guy.*Natural/i, /Ava.*Natural/i, /Andrew.*Natural/i, /Natural/i, /Google US English/i, /Google UK English/i, /Zira/i, /David/i];
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
  };

  // ------------------------------------------------------------------ styles
  document.head.append(Object.assign(document.createElement('style'), { textContent: `
    #tour-spot { position: fixed; z-index: 60; pointer-events: none; border-radius: 12px; outline: 3px solid var(--accent);
      box-shadow: 0 0 0 9999px rgb(10 14 20 / 0.5); transition: top .45s ease, left .45s ease, width .45s ease, height .45s ease; }
    #tour-cursor { position: fixed; left: 0; top: 0; z-index: 64; pointer-events: none; width: 26px; height: 26px; opacity: 0;
      transition: transform .8s cubic-bezier(.3,.7,.2,1), opacity .3s; filter: drop-shadow(0 2px 3px rgb(0 0 0 / .35)); }
    #tour-cursor.on { opacity: 1; }
    #tour-cursor svg { width: 26px; height: 26px; display: block; }
    #tour-cursor .ring { position: absolute; left: -14px; top: -14px; width: 28px; height: 28px; border-radius: 50%;
      border: 3px solid var(--accent); opacity: 0; transform: scale(.3); }
    #tour-cursor.click .ring { animation: tour-ring .5s ease-out; }
    @keyframes tour-ring { 0% { opacity: .9; transform: scale(.3); } 100% { opacity: 0; transform: scale(1.6); } }
    #tour-bar { position: fixed; z-index: 63; left: 50%; bottom: 18px; transform: translateX(-50%); width: min(920px, calc(100vw - 32px));
      background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 14px; padding: 14px 16px 12px;
      box-shadow: 0 10px 30px rgb(0 0 0 / 0.25); display: grid; gap: 10px; }
    #tour-bar .tt { font-size: 16px; line-height: 1.5; min-height: 48px; }
    #tour-bar .tc { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    #tour-bar .tc select { font: inherit; font-size: 12px; padding: 4px 6px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); max-width: 220px; }
    #tour-bar .tn { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
    #tour-bar .ch { color: var(--accent); font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }
    #tour-bar .tp { height: 3px; border-radius: 2px; background: var(--surface-2); overflow: hidden; }
    #tour-bar .tp i { display: block; height: 100%; background: var(--accent); transition: width .4s; }
    .tour-replay { font-size: 11px; font-weight: 800; letter-spacing: .06em; padding: 1px 8px; border-radius: 999px; background: var(--warn-soft); color: var(--warn); white-space: nowrap; margin-left: 6px; }
    #tour-start { position: fixed; inset: 0; z-index: 65; display: grid; place-items: center; background: rgb(10 14 20 / 0.55); }
    #tour-start button { font-size: 18px; padding: 14px 28px; border-radius: 12px; }

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
    .ts-card { border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; background: var(--surface-2); font-size: 14px; }
    .ts-card h3 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--accent); }
    .ts-card p { margin: 0 0 6px; }
    .ts-goal { margin-top: 16px; border-left: 4px solid var(--ok); background: var(--ok-soft); padding: 12px 16px; border-radius: 0 10px 10px 0; font-size: 15px; }
    .ts-big { font-size: 28px; font-weight: 800; color: var(--text); font-variant-numeric: tabular-nums; }
    .ts-flow { display: grid; gap: 12px; }
    .ts-row { display: grid; grid-template-columns: 120px 1fr; gap: 12px; align-items: center; }
    .ts-row .lbl { font-weight: 800; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; transition: color .4s; }
    .ts-nodes { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .ts-node { border: 1.5px solid var(--border); border-radius: 10px; padding: 7px 11px; background: var(--surface-2); font-size: 13px; font-weight: 650;
      transition: border-color .4s, background .4s, box-shadow .4s; transition-delay: 0s; }
    .ts-node small { display: block; font-weight: 500; color: var(--muted); font-size: 11.5px; }
    .ts-node.ai::before { content: "✦ "; color: var(--teams); }
    .ts-arrow { color: var(--muted); font-weight: 700; }
    .ts-row.hot .lbl { color: var(--accent); }
    .ts-row.hot .ts-node { border-color: var(--accent); background: var(--accent-soft); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
      transition-delay: calc(var(--i, 0) * 260ms); }
    @media (max-width: 900px) { .ts-cols, .ts-grid { grid-template-columns: 1fr; } .ts-row { grid-template-columns: 1fr; } #tour-slide { padding: 18px; } }
    @media (max-width: 600px) { #tour-bar { bottom: 8px; } #tour-bar .tt { font-size: 14px; } }
  ` }));

  // ------------------------------------------------------------------ helpers
  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
  /** The first `n` sentences, at most `max` characters. */
  const sentences = (s, n = 1, max = 220) => {
    let t = String(s ?? '').replace(/\s+/g, ' ').trim();
    // A dot inside a word (dates.ts, 2.50) does not end a sentence: only one followed by a space or the end.
    const parts = (t.match(/.+?[.!?]+(?=\s|$)/g) ?? [t]).map((p) => p.trim());
    t = parts.slice(0, n).join(' ') || t;
    return t.length > max ? `${t.slice(0, max).replace(/\s+\S*$/, '')}…` : t;
  };
  const firstSentence = (s, max = 220) => sentences(s, 1, max);
  /** Without the "(commit …, DEM-14, …)" asides, which make captions long and the voice read hashes. */
  const noParens = (s) => String(s ?? '').replace(/\s*\([^()]*\)/g, '').replace(/\s+([.,;:])/g, '$1');
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const duration = (secs) => (secs < 90 ? `${secs} seconds` : `about ${plural(Math.round(secs / 60), 'minute')}`);
  /** A ticket title without its "[BE][FE] - " prefix. */
  const plainTitle = (s) => String(s ?? '').replace(/^(\s*\[[^\]]+\])+\s*-?\s*/, '');
  const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
  const longDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  const appName = (key) => projectInfo(projOf(key))?.name ?? projOf(key);
  // What each demo app is, for the narration ("MediFarma, the hospital pharmacy"); other projects get no aside.
  const ROLE = { DEM: 'the booking app', LAB: 'the laboratory app', FAR: 'the hospital pharmacy', BIL: 'the billing app' };
  const appWithRole = (key) => `${appName(key)}${ROLE[projOf(key)] ? `, ${ROLE[projOf(key)]},` : ''}`;
  /** What the voice reads: ticket keys letter by letter, a file by its name, no commit hashes, no symbols. */
  const speakable = (s) => String(s)
    .replace(/[\w./\\-]+\.(java|ts|tsx|js|mjs|html|scss|css|xml|sql|json|properties|ya?ml)(:\d+(-\d+)?)?\b/g,
      (m) => m.replace(/:\d+(-\d+)?$/, '').split(/[/\\]/).pop().replace(/\.\w+$/, '').replace(/[._-]+/g, ' '))
    .replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g, 'a commit')
    .replace(/\b([A-Z]{2,})-(\d+)\b/g, (_, p, n) => `${p.split('').join(' ')} ${n}`)
    .replace(/\bJUnit\b/g, 'J Unit')
    .replace(/[`✦▶⇄]/g, '')
    .replace(/\s+/g, ' ');

  /** Waits until `test()` is true (or the time is up); false when the tour was stopped or moved on meanwhile. */
  async function until(test, ms, my) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (my !== token) return false;
      try { if (test()) return true; } catch { /* not there yet */ }
      await sleep(150);
    }
    return my === token;
  }
  // getClientRects, not offsetParent: a fixed element (the slide) has no offsetParent but is shown.
  const shown = (el) => Boolean(el && el.isConnected && el.getClientRects().length > 0);

  // Dashboard elements the steps point at. They are looked up again on every frame: the page re-renders often.
  const ticketEl = (key) => [...document.querySelectorAll('#tickets .ticket')].find((el) => el.querySelector('.t-key')?.textContent === key) ?? null;
  const rowOf = (key, label) => [...(ticketEl(key)?.querySelectorAll('.result .row') ?? [])].find((r) => r.querySelector('.k')?.textContent === label) ?? null;
  const boxOf = (key, icon) => [...(ticketEl(key)?.querySelectorAll('.fix') ?? [])].find((f) => f.querySelector('.fix-title')?.textContent.startsWith(icon)) ?? null;
  const sectionOf = (id) => { const el = document.getElementById(id); return shown(el) && !el.hidden ? el : null; };
  const hasContent = (id) => { const el = sectionOf(id); return el && el.children.length && !(el.children.length === 1 && el.firstElementChild.classList.contains('empty')); };
  const tabBtn = (name) => document.querySelector(`#tabs button[data-tab="${name}"]`);

  // ------------------------------------------------------------------ cursor
  let cursor = null;
  function cursorUi() {
    cursor = Object.assign(document.createElement('div'), { id: 'tour-cursor' });
    cursor.innerHTML = '<span class="ring"></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 2l15 9.5-6.6 1.3 3.9 7.4-2.9 1.5-3.9-7.4L4 19z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.append(cursor);
    cursor.style.transform = `translate(${innerWidth / 2}px, ${innerHeight / 2}px)`;
  }
  /** Glides the cursor to an element (or its point `at`, 0..1 of its box). */
  async function moveTo(el, my, at = { x: 0.5, y: 0.5 }) {
    if (!cursor || !shown(el)) return false;
    const r = el.getBoundingClientRect();
    cursor.classList.add('on');
    cursor.style.transform = `translate(${r.left + r.width * at.x}px, ${r.top + r.height * at.y}px)`;
    return until(() => false, 850, my);
  }
  function clickMark() {
    cursor.classList.remove('click');
    void cursor.offsetWidth; // restart the animation
    cursor.classList.add('click');
  }
  /** Moves to an element and clicks it, with a visible click. */
  async function clickOn(el, my) {
    if (!(await moveTo(el, my))) return false;
    clickMark();
    await sleep(180);
    if (my !== token) return false;
    el.click();
    return until(() => false, 350, my);
  }
  /** Moves to an element and shows a click, without clicking (the Ask button: the answer is a replay). */
  async function pressOn(el, my) {
    if (!(await moveTo(el, my))) return false;
    clickMark();
    return until(() => false, 300, my);
  }
  async function pickProject(key, my) {
    if (selected === key) return true;
    await moveTo($('#project-sel'), my);
    if (my !== token) return false;
    clickMark();
    selectProject(key);
    return until(() => false, 300, my);
  }
  async function openTab(name, my) {
    if (tab === name) return true;
    return clickOn(tabBtn(name), my);
  }

  // ------------------------------------------------------------------ speech
  let voice = null;
  let rate = Number(store.get('ti-tour-rate')) || 1;
  const englishVoices = () => (synth?.getVoices() ?? []).filter((v) => /^en([-_]|$)/i.test(v.lang));
  function pickVoice() {
    const en = englishVoices();
    const saved = store.get('ti-tour-voice');
    if (saved === 'none') return null;
    const mine = en.find((v) => v.name === saved);
    if (mine) return mine;
    for (const re of PREFERRED) { const v = en.find((x) => re.test(x.name)); if (v) return v; }
    return en.find((v) => /en-US/i.test(v.lang)) ?? en[0] ?? null;
  }
  const muted = () => !synth || store.get('ti-tour-voice') === 'none' || !voice;

  /** Speaks one sentence; resolves when it is spoken (or a watchdog says it should have been). */
  function speakOne(text) {
    return new Promise((ok) => {
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice; u.lang = voice.lang; u.rate = rate;
      let done = false;
      const end = () => { if (!done) { done = true; clearTimeout(dog); ok(); } };
      u.onend = end; u.onerror = end;
      const dog = setTimeout(end, 2500 + (text.length * 110) / rate);
      synth.speak(u);
    });
  }
  /** Speaks a step sentence by sentence (long utterances get cut off in Chrome); captions-only: waits a reading time. */
  async function say(text, my) {
    if (muted()) {
      const words = text.split(/\s+/).length;
      return until(() => false, (words / 2.6) * 1000 / rate + 900, my);
    }
    const parts = speakable(text).match(/[^.!?]+[.!?]+["')]*|[^.!?]+$/g) ?? [text];
    for (const p of parts) {
      if (my !== token) return false;
      if (p.trim()) await speakOne(p.trim());
    }
    return my === token;
  }

  // ------------------------------------------------------------------ replays of recorded runs
  const rps = new Map(); // key → { key, recordedAt, events, i, shift }
  /** Applies a recorded run's events up to (and including) the first one of `type` ('' = all), at a sped-up pace. */
  async function playTo(key, type, my) {
    const rp = rps.get(key);
    if (!rp) return true;
    if (rp.shift == null) rp.shift = Date.now() - Date.parse(rp.events[0].at);
    while (rp.i < rp.events.length) {
      if (my !== token) return false;
      const e = rp.events[rp.i];
      const prev = rp.events[rp.i - 1];
      if (prev) await sleep(Math.min(1300, Math.max(110, (Date.parse(e.at) - Date.parse(prev.at)) * 0.05)));
      if (my !== token) return false;
      apply({ ...e, at: new Date(Date.parse(e.at) + rp.shift).toISOString() });
      if (e.type === 'picked') tickets.get(key).expanded = true; // keep the steps visible when it is done
      rp.i++;
      render();
      if (e.type === type) return true;
    }
    return true;
  }
  function removeReplays() {
    for (const key of rps.keys()) {
      tickets.delete(key);
      for (const arr of [teams, drafts]) for (let i = arr.length - 1; i >= 0; i--) if (arr[i].key === key) arr.splice(i, 1);
    }
    rps.clear();
    for (let i = answers.length - 1; i >= 0; i--) if (answers[i].tourReplay) answers.splice(i, 1);
    renderAnswers();
    const btn = $('#ask-go');
    btn.disabled = false; btn.textContent = 'Ask';
    $('#ask-progress').hidden = true;
    $('#ask-q').value = '';
    render();
  }

  /** A recorded Ask answer, replayed: the question is typed, Ask is pressed (not really), the steps stream, the answer appears. */
  async function replayAsk(rec, project, my) {
    const box = $('#ask-q');
    await clickOn(box, my);
    box.value = '';
    for (const ch of rec.question) { if (my !== token) return false; box.value += ch; await sleep(28); }
    await pressOn($('#ask-go'), my);
    if (my !== token) return false;
    const btn = $('#ask-go');
    btn.disabled = true; btn.textContent = 'Thinking…';
    const progress = $('#ask-progress');
    progress.hidden = false;
    progress.replaceChildren(h('div', { class: 'step' }, h('span'), h('span'), h('span', { class: 'typing m' }, 'working')));
    for (const step of rec.steps ?? []) {
      await sleep(650);
      if (my !== token) return false;
      progress.insertBefore(h('div', { class: 'step' }, h('span', { class: 't' }, ''), h('span', { class: 'i' }, '›'), h('span', { class: 'm' }, step)), progress.lastChild);
      progress.scrollTop = progress.scrollHeight;
    }
    await sleep(900);
    if (my !== token) return false;
    answers.unshift({ ...rec, project, tourReplay: true });
    box.value = '';
    btn.disabled = false; btn.textContent = 'Ask';
    progress.hidden = true;
    renderAnswers();
    return true;
  }

  // ------------------------------------------------------------------ explainer slides
  const SLIDES = {
    problem: () => `
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
      <div class="ts-goal" data-r="3"><b>The goal:</b> for every new ticket, within minutes and with no human start, an analysis with evidence in Jira,
        the right person informed, drafts for a human to approve, and the knowledge kept when it is solved.</div>`,
    pipeline: () => {
      const node = (t, s, i, ai = false) => `<span class="ts-node${ai ? ' ai' : ''}" style="--i:${i}">${t}${s ? `<small>${s}</small>` : ''}</span>`;
      const row = (g, label, nodes) => `<div class="ts-row" data-r="${g}" data-g="${g}"><div class="lbl">${label}</div><div class="ts-nodes">${nodes.join('<span class="ts-arrow">→</span>')}</div></div>`;
      return `
      <div class="kick">Behind the scenes</div>
      <h1>From a Jira ticket to a reviewed fix, with nobody starting it</h1>
      <p class="lead">Plain code collects and checks the facts. The AI reads, connects and writes. Only the watcher writes anywhere, and only what the policy allows.</p>
      <div class="ts-flow">
        ${row(1, '1 · Collect', [node('New Jira ticket', 'any of the 4 apps', 0), node('Watcher', 'checks Jira every 30 s', 1), node('Facts, by plain code', 'ticket, history, related tickets, commits, code, people', 2)])}
        ${row(2, '2 · Analyze', [node('Claude, headless', 'cannot edit files', 0, true), node('JSON result', 'checked by code', 1), node('Policy', 'auto · draft · off', 2), node('Jira comment · Teams', 'drafts wait for a human', 3)])}
        ${row(3, '3 · Prove & fix', [node('Own copy of the code', 'a worktree on a branch', 0), node('Test reproduces the bug', 'Playwright or JUnit; must fail', 1, true), node('Fix', 'smallest change', 2, true), node('Watcher re-runs everything', 'tests, build, backend', 3), node('Draft pull request', '', 4), node('AI reviewer', 'risk and findings', 5, true)])}
        ${row(4, '4 · Learn', [node('Ticket Done', '', 0), node('Knowledge base', 'docs/knowledge, as a pull request', 1, true), node('Insights · Ask', 'read all of this history', 2, true)])}
      </div>`;
    },
    ai: () => `
      <div class="kick">The AI</div>
      <h1>Claude, by Anthropic, run through Claude Code</h1>
      <p class="lead">Headless runs, started by the watcher. Each run gets only the tools its job needs.</p>
      <div class="ts-grid">
        <div class="ts-card" data-r="1"><h3>Models</h3><p><b>Analysis:</b> Claude Sonnet: fast and cheaper.</p><p><b>Fix, review, Ask, app review:</b> Claude Opus.</p><p>Set in <code>agent.config.json</code>.</p></div>
        <div class="ts-card" data-r="1"><h3>Who does what</h3><p><b>Plain code</b> collects Jira, git or SVN, people and signals, computes scores and checks every result.</p><p><b>The model</b> reads, connects the facts and writes.</p></div>
        <div class="ts-card" data-r="2"><h3>Guardrails</h3><p>The analysis cannot edit files; Ask and the reviewer can only read. No MCP servers, no publishing tools.</p><p>Every cited ticket, commit and file is checked by code.</p></div>
        <div class="ts-card" data-r="2"><h3>Not trained, improved</h3><p>No fine-tuning: the model is the same for everyone. It improves through what it reads: instructions, project conventions, commit messages, the knowledge base, tests.</p><p>Each change is scored on tickets with a known answer.</p></div>
        <div class="ts-card" data-r="3"><h3>Cost</h3><p><span class="ts-big">$0.15–0.60</span> per ticket analysis</p><p><span class="ts-big">$0.10–0.40</span> per Ask question, 15–30 s</p></div>
        <div class="ts-card" data-r="3"><h3>At work too</h3><p>The same <code>/analyze-ticket</code> skill runs on demand in Claude Code or GitHub Copilot, in git and SVN projects.</p></div>
      </div>`,
    built: () => `
      <div class="kick">How it was built</div>
      <h1>Problem first, evidence over opinion, and a human decides</h1>
      <div class="ts-cols">
        <div class="ts-card" data-r="1"><h3>The ideas</h3><ol>
          <li><b>Problem first:</b> the problem, success metrics, risks and exit criteria were written and approved before the code.</li>
          <li><b>A skill, then autonomy:</b> <code>/analyze-ticket</code> on demand first, then the watcher that runs it alone.</li>
          <li><b>Evidence over opinion:</b> a test proves the bug, the watcher re-runs every check, every claim cites its source.</li>
          <li><b>A human decides:</b> a policy per action, drafts for anything customer-facing, merging is never automatic.</li></ol></div>
        <div class="ts-card" data-r="2"><h3>Tested honestly</h3><ul>
          <li>Four linked hospital apps with real git history, Jira projects and teams</li>
          <li>Bugs brought in by later changes, like real ones; the answer keys are hidden from the agent</li>
          <li>Every run scored: the file, the change that caused it, related tickets, owner, the fix</li></ul>
          <p style="margin-top:10px"><span class="ts-big">~80 s</span> to an analysis in Jira · <span class="ts-big">6–8 / 8</span> scored · <span class="ts-big">0</span> writes outside the policy</p></div>
      </div>
      <div class="ts-goal" data-r="3"><b>Next:</b> approval straight from Teams · a night shift with a morning digest · release notes ·
        a reply to the customer after the merge · redaction of patient data before company tickets.</div>`,
  };
  let slideEl = null;
  let slideName = null;
  function showSlide(name, reveal) {
    if (!slideEl) { slideEl = Object.assign(document.createElement('div'), { id: 'tour-slide' }); document.body.append(slideEl); }
    if (slideName !== name) { slideEl.innerHTML = SLIDES[name](); slideName = name; slideEl.scrollTop = 0; }
    requestAnimationFrame(() => {
      for (const el of slideEl.querySelectorAll('[data-r]')) el.classList.toggle('on', Number(el.dataset.r) <= reveal);
      for (const el of slideEl.querySelectorAll('[data-g]')) el.classList.toggle('hot', Number(el.dataset.g) === reveal);
    });
    cursor?.classList.remove('on');
  }
  function hideSlide() { slideEl?.remove(); slideEl = null; slideName = null; }

  // ------------------------------------------------------------------ the script
  let asks = []; // recorded Ask answers for the tour
  /** The steps, built from what the dashboard has now: real tickets (live or recorded runs), a real project, real numbers. */
  function buildSteps() {
    const T = (k) => tickets.get(k);
    const R = (k) => T(k)?.result;
    const evs = (k) => (rps.has(k) ? rps.get(k).events : T(k)?.steps ?? []);
    const did = (k, type) => Boolean(k) && evs(k).some((e) => e.type === type);
    const firstOf = (k, type) => evs(k).find((e) => e.type === type);
    const secs = (k, a, b) => Math.round((Date.parse(firstOf(k, b)?.at) - Date.parse(firstOf(k, a)?.at)) / 1000) || 0;
    const titleOf = (k) => plainTitle(rps.has(k) ? rps.get(k).events.find((e) => e.type === 'queued' || e.type === 'picked')?.text : T(k)?.title);
    const recorded = (k) => (rps.has(k) ? ` This is a recorded run from ${longDate(rps.get(k).recordedAt)}, replayed faster; the seconds are the real ones.` : '');
    const side = (k) => firstOf(k, 'reproducing')?.side ?? T(k)?.fix?.side ?? 'frontend';
    const playUntil = (k, type) => (my) => playTo(k, type, my);
    const toTickets = async (k, my) => { await openTab('tickets', my); if (k && !visible(k)) await pickProject('all', my); };

    // The cases: a live ticket first, then recorded runs; case 2 crosses projects, case 3 is a duplicate.
    const analyzed = [...tickets.values()].filter((t) => t.result && !rps.has(t.key));
    const live = analyzed.find((t) => t.fix?.stage === 'done' && t.review?.stage === 'done') ?? analyzed.find((t) => t.fix?.stage === 'done') ?? analyzed.find((t) => t.state === 'done') ?? analyzed[0] ?? null;
    const replayed = [...rps.keys()];
    const k1 = live?.key ?? replayed.find((k) => did(k, 'fix-proposed')) ?? replayed[0] ?? null;
    const k2 = replayed.find((k) => k !== k1 && did(k, 'cross-project') && !did(k, 'duplicate')) ?? null;
    const k3 = replayed.find((k) => k !== k1 && k !== k2 && did(k, 'duplicate')) ?? null;

    const ready = projects().filter((p) => p.ready);
    const proj = (k1 && projectInfo(projOf(k1))) ?? focus() ?? ready[0] ?? null;
    const pollSecs = status?.lastPoll && status?.nextPoll ? Math.round((Date.parse(status.nextPoll) - Date.parse(status.lastPoll)) / 1000) : null;
    const d = () => (insightsData && insightsFor === proj?.key ? insightsData : null);
    const toInsights = async (my) => { await openTab('insights', my); if (proj) await pickProject(proj.key, my); };
    const answerEl = (i = 0) => document.querySelectorAll('#ask-answers .answer')[i] ?? null;
    const [askFound, askMissing] = [asks.find((a) => a.found), asks.find((a) => !a.found)];
    const cents = (usd) => `${Math.round((usd ?? 0) * 100)} cents`;

    /** The steps of one ticket case; `intro` is what the first step says about it. */
    const caseOne = (k) => [
      { ch: 'Case 1', when: () => k && rps.has(k), go: async (my) => { await toTickets(k, my); await playTo(k, 'picked', my); }, target: () => ticketEl(k)?.querySelector('.t-head'),
        say: () => `Case one: someone opens a ticket in Jira for ${appWithRole(k).replace(/,$/, '')}: ${titleOf(k)}.${recorded(k)}` },
      { ch: 'Case 1', when: () => k && rps.has(k), play: playUntil(k, 'analyzed'), target: () => ticketEl(k)?.querySelector('.steps') ?? ticketEl(k),
        say: "Nobody starts it. The agent picks the ticket up, reads it, searches for related tickets, then searches the code and its history. Every step shows up here, live." },
      { ch: 'Case 1', when: () => k && !rps.has(k), go: async (my) => { await toTickets(k, my); T(k).expanded = true; render(); }, target: () => ticketEl(k)?.querySelector('.t-head'),
        say: () => `Case one, a real ticket: ${k}. ${firstSentence(titleOf(k), 160)}` },
      { ch: 'Case 1', when: () => k && !rps.has(k) && T(k)?.steps?.length, target: () => ticketEl(k)?.querySelector('.steps'),
        say: () => `These are the ${T(k).steps.length} steps the agent took, with the second each one happened: it read the ticket, searched for related tickets, then searched the code and its history.${T(k).totalMs ? ` The whole run took ${duration(Math.round(T(k).totalMs / 1000))}.` : ''}` },
      { ch: 'Case 1', when: () => R(k), target: () => rowOf(k, 'Likely cause'),
        say: () => `${did(k, 'picked') && did(k, 'analyzed') ? `In ${duration(secs(k, 'picked', 'analyzed'))}, it` : 'It'} explains the likely cause, with its confidence, and points to the exact files and lines. Here, with ${R(k).confidence} confidence: ${firstSentence(noParens(R(k).likelyCause))}` },
      { ch: 'Case 1', when: () => R(k)?.owner?.name, target: () => rowOf(k, 'Owner'),
        say: () => `It says who should handle it: ${R(k).owner.name}. ${firstSentence(noParens(R(k).owner.why), 180)} All of this is already posted as a comment in Jira.` },
      { ch: 'Case 1', when: () => did(k, 'notified'), go: (my) => moveTo($('#teams'), my, { x: 0.5, y: 0.3 }), target: () => $('#teams')?.closest('aside'),
        say: () => `At the same moment, ${R(k)?.owner?.name ?? 'the owner'} gets a handoff message in Microsoft Teams, simulated here. What the agent may do alone is a policy: anything for the customer, like a reply to the reporter, waits below as a draft until a person approves it.` },
      { ch: 'Case 1', when: () => did(k, 'reproduced'), play: playUntil(k, 'reproduced'), go: (my) => (rps.has(k) ? moveTo(ticketEl(k), my, { x: 0.3, y: 0.8 }) : true), target: () => boxOf(k, '🛠') ?? ticketEl(k),
        say: () => `Then it goes further. It writes a ${side(k) === 'backend' ? 'backend test' : 'browser test'} from the steps in the ticket and runs it against the real app. The watcher checks that the test fails on the current code: the bug is reproduced, with proof.` },
      { ch: 'Case 1', when: () => did(k, 'fix-proposed'), play: playUntil(k, 'fix-proposed'), target: () => boxOf(k, '🛠') ?? ticketEl(k),
        say: "Now it fixes the code. Then the watcher, not the agent, runs every check again on its own: the tests, the build, the backend. Only with real evidence does it open a draft pull request.",
        after: (my) => moveTo(ticketEl(k)?.querySelector('.pr-link'), my) },
      { ch: 'Case 1', when: () => T(k)?.fix?.before && T(k)?.fix?.after, target: () => ticketEl(k)?.querySelector('.shots'),
        say: "The screenshots before and after the fix are the evidence: the bug in the real app, and the same screen fixed." },
      { ch: 'Case 1', when: () => did(k, 'reviewed'), go: playUntil(k, 'reviewed'), target: () => boxOf(k, '🧐'),
        say: () => `A second AI then reviews the pull request, like a colleague would. It rated the risk ${T(k)?.review?.risk ?? 'low'}, and checked that the test really covers the bug. Merging is always a human decision.` },
      { ch: 'Case 1', when: () => did(k, 'documented'), go: playUntil(k, 'documented'), target: () => boxOf(k, '📚'),
        say: "And when the ticket is closed in Jira, the agent writes what was learned into the project's knowledge base: the cause, the fix and how to check it." },
      { ch: 'Case 1', when: () => rps.has(k) && did(k, 'fix-proposed'), go: playUntil(k, ''), target: () => ticketEl(k)?.querySelector('.t-head'),
        say: () => `So: from a ticket in Jira to a tested${did(k, 'reviewed') ? ', reviewed' : ''} pull request in ${duration(secs(k, 'picked', did(k, 'reviewed') ? 'reviewed' : 'fix-proposed'))}, and nobody had to start it.` },
    ];

    const cross = (k) => T(k)?.cross ?? null;
    // From the recorded event too: the voice may describe it before the replay has applied it to the card.
    const crossEv = (k) => firstOf(k, 'cross-project');
    const crossApp = (k) => cross(k)?.projects?.[0] ?? crossEv(k)?.projects?.[0];
    const caseTwo = (k) => [
      { ch: 'Case 2', when: () => k, go: async (my) => { if (k1 && T(k1)) { T(k1).expanded = false; render(); } await toTickets(k, my); await playTo(k, 'picked', my); }, target: () => ticketEl(k)?.querySelector('.t-head'),
        say: () => `Case two is harder. ${appWithRole(k)} gets a ticket: ${titleOf(k)}. This time, the trouble started in another application.${recorded(k)}` },
      { ch: 'Case 2', when: () => k, play: playUntil(k, 'analyzed'), target: () => ticketEl(k)?.querySelector('.steps') ?? ticketEl(k),
        say: () => `The agent searches ${appName(k)}, and also the code and history of the apps it calls, in read-only copies. The four apps call each other's APIs, so a change in one can break another.` },
      { ch: 'Case 2', when: () => k && crossApp(k), target: () => rowOf(k, 'Other projects') ?? rowOf(k, 'Likely cause'),
        say: () => {
          const o = crossApp(k);
          const ev = String(o.evidence ?? '').match(/\b[A-Z][A-Z0-9_]+-\d+\b/)?.[0];
          const fixIn = cross(k)?.fixIn ?? crossEv(k)?.fixIn;
          return `And it finds where it started: ${firstSentence(noParens(o.why))}${ev ? ` It cites the change, ${ev}, with its commit.` : ''}${fixIn ? ` And it says where the fix belongs: in ${projectInfo(fixIn)?.name ?? fixIn}.` : ''}`;
        } },
      { ch: 'Case 2', when: () => did(k, 'fix-proposed'), play: playUntil(k, 'fix-proposed'), target: () => boxOf(k, '🛠') ?? ticketEl(k),
        say: () => (side(k) === 'backend'
          ? 'Because it is a backend bug, the proof is a J Unit test, not a browser test. It fails on the current code. Then the agent fixes the code, every backend test passes again, and a draft pull request is opened.'
          : 'Again, a test proves the bug first. Then the agent fixes the code, every test passes again, and a draft pull request is opened.') },
      { ch: 'Case 2', when: () => did(k, 'reviewed'), go: playUntil(k, 'reviewed'), target: () => boxOf(k, '🧐'),
        say: () => `The second AI reviewed it as well: risk ${T(k)?.review?.risk ?? 'low'}. From the ticket to the pull request: ${duration(secs(k, 'picked', 'fix-proposed'))}.` },
    ];

    const caseThree = (k) => [
      { ch: 'Case 3', when: () => k, go: async (my) => { if (k2 && T(k2)) { T(k2).expanded = false; render(); } await toTickets(k, my); await playTo(k, 'picked', my); }, target: () => ticketEl(k)?.querySelector('.t-head'),
        say: () => `Case three is about knowing when not to act. ${appWithRole(k)} gets a ticket: ${titleOf(k)}.${recorded(k)}` },
      { ch: 'Case 3', when: () => k, play: playUntil(k, ''), target: () => ticketEl(k)?.querySelector('.steps') ?? ticketEl(k),
        say: () => `It analyzes it the same way${crossApp(k) ? `, and traces the cause to ${projectInfo(crossApp(k).key)?.name ?? crossApp(k).key}: ${firstSentence(noParens(crossApp(k).why))}` : '.'}` },
      { ch: 'Case 3', when: () => k && R(k)?.duplicateOf, target: () => rowOf(k, 'Duplicate?') ?? ticketEl(k),
        say: () => `But it also notices that the same problem is already reported, as ${R(k).duplicateOf.key}, which already has a fix on the way. So it flags a possible duplicate and makes no second fix. Sometimes doing nothing is the right answer, and the card says why.` },
    ];

    return [
      // Opening and the explainers
      { ch: 'Welcome', target: () => $('.brand'),
        say: "Hi. This is Ticket Intelligence: an AI agent that reads every new Jira ticket, finds the code behind it, proves the bug with a test, proposes a fix, and gets it to the right person. In about ten minutes I'll show you the problem it solves, how it works behind the scenes, three real cases, and what it knows about the whole application. Nothing I do here costs money or changes anything." },
      { ch: 'The problem', slide: 'problem', reveal: 1,
        say: "First, the problem. Customers of hospital scheduling systems open a ticket, then ask: what is the status, can it be sped up? To answer, an engineer has to read the ticket and its history, find earlier tickets like it, find the code and what changed there, and work out who knows it." },
      { ch: 'The problem', slide: 'problem', reveal: 3,
        say: "Today this is done by hand. It is slow, and it depends on who remembers the history; people new to a project suffer most. So the goal: for every new ticket, within minutes and with no human start, an analysis with evidence, the right person informed, and the knowledge kept." },
      { ch: 'Behind the scenes', slide: 'pipeline', reveal: 1,
        say: "Behind the scenes, a watcher checks Jira every thirty seconds. For a new ticket, plain code first collects the facts: the ticket and its history, related tickets, commits, code, and who worked on what." },
      { ch: 'Behind the scenes', slide: 'pipeline', reveal: 2,
        say: "Then Claude reads it all, in a run that cannot edit files, and returns a structured result that the code checks. The policy decides the rest: the Jira comment and the owner's message go out on their own; anything for the customer waits as a draft." },
      { ch: 'Behind the scenes', slide: 'pipeline', reveal: 3,
        say: "When the bug is clear, the agent writes a test that reproduces it, in its own copy of the code. The watcher checks that the test fails, and after the fix it runs every test and the build again. Only then is a draft pull request opened, and a second AI reviews it." },
      { ch: 'Behind the scenes', slide: 'pipeline', reveal: 4,
        say: "When the ticket is closed, the cause and the fix go into the project's knowledge base, where Insights and Ask use them. Every ticket makes the next one faster." },
      { ch: 'The AI', slide: 'ai', reveal: 2,
        say: "Which AI? Claude, by Anthropic, through Claude Code: Claude Sonnet for the analysis, which is fast and cheaper, and Claude Opus for the fix, the review and Ask. Plain code collects and checks the facts; the model does what needs judgement. Every run gets only the tools it needs, and every source it cites is checked by code." },
      { ch: 'The AI', slide: 'ai', reveal: 3,
        say: "The model is not trained on our data: it improves through what it reads, like instructions, project conventions and tests, and every change is scored. An analysis costs about fifteen to sixty cents, a question ten to forty. And the same skill runs on demand in Claude Code or GitHub Copilot." },

      // The dashboard
      { ch: 'The dashboard', target: () => $('#state'), go: async (my) => { await toTickets(k1, my); await moveTo($('#state'), my); },
        say: () => `Now the live dashboard. The light shows the agent is watching Jira${pollSecs > 0 ? `, every ${pollSecs < 90 ? `${pollSecs} seconds` : `${Math.round(pollSecs / 60)} minutes`}` : ''}${projects().length > 1 ? `, for ${projects().length} linked apps of one hospital suite: ${list(projects().map((p) => p.name))}` : ''}. Nobody has to start it.` },
      { ch: 'The dashboard', when: () => !k1, target: () => $('#tickets'),
        say: "Each new ticket appears here as a card, and you can watch the agent's steps live. There is no analyzed ticket yet, so let's move on." },

      ...caseOne(k1),
      ...caseTwo(k2),
      ...caseThree(k3),

      // Insights
      { ch: 'Insights', when: () => ready.length > 1,
        go: async (my) => { await openTab('insights', my); await pickProject('all', my); await until(() => hasContent('suite-apps') && !$('#suite-apps').textContent.includes('Loading'), 20000, my); },
        target: () => sectionOf('ins-suite'),
        say: "The second tab is Insights. It looks at the whole history, not one ticket. First the whole suite: every app side by side, how they call each other, and bugs whose cause sits in another app, like case two." },
      { ch: 'Insights', when: () => proj, go: async (my) => { await toInsights(my); await until(() => d() && !$('#ins-body').hidden, 25000, my); }, target: () => sectionOf('ins-kpis'),
        say: () => `Now one application: ${proj.name}. It combines Jira, git and the agent's analyses.${d() ? ` ${plural(d().totals.bugs, 'bug')} so far, ${d().totals.openBugs} still open, across ${plural(d().totals.commits, 'commit')}.` : ''}` },
      { ch: 'Insights', when: () => proj, target: () => $('#ins-heat')?.closest('.panel'),
        say: "This map shows bugs per component and month. The darker the cell, the more bugs." },
      { ch: 'Insights', when: () => document.querySelector('#ins-heat .hc.clickable'),
        go: async (my) => {
          const cells = [...document.querySelectorAll('#ins-heat .hc.clickable')];
          const top = cells.reduce((a, b) => ((parseInt(b.textContent, 10) || 0) > (parseInt(a.textContent, 10) || 0) ? b : a), cells[0]);
          bringIntoView(top.closest('.panel'));
          await sleep(500);
          await clickOn(top, my);
        },
        target: () => sectionOf('ins-tickets'),
        say: "One click on a cell lists the tickets behind the number, with links to Jira and the commits that fixed them." },
      { ch: 'Insights', when: () => d()?.hotspots?.length, target: () => sectionOf('ins-hotspots'),
        say: () => { const c = d().components.find((x) => x.name === d().hotspots[0]); return `The top hotspot is ${d().hotspots[0]}${c ? `, with ${plural(c.bugs, 'bug')}` : ''}. For each hotspot you see the files fixed more than once, and the AI can write a recommendation, citing tickets and commits.`; } },
      { ch: 'Insights', when: () => proj, target: () => sectionOf('ins-suggestions'), go: (my) => moveTo($('#ins-review'), my),
        say: "On request, the AI also reviews the whole app, and suggests tickets to open next, with the person who knows that code best. Every item cites its source, and nothing is created on its own: someone checks it and confirms. Below, risk files show where the next bug is most likely, and each fixed bug is traced to the change that brought it in." },
      { ch: 'Insights', when: () => hasContent('ins-knowledge'), target: () => sectionOf('ins-knowledge'),
        say: () => { const one = (d()?.components ?? []).filter((c) => c.team?.length && c.busFactor <= 1).length; return `The knowledge map shows who knows each component.${one ? ` ${one === 1 ? 'One component is' : `${one} components are`} known by one person only. That is a risk, so the suggestions pick a second person to learn it.` : ' Here every component is known by at least two people, so nobody is a single point of failure.'}`; } },

      // Ask
      { ch: 'Ask', when: () => proj, go: async (my) => { await openTab('ask', my); await until(() => !$('#ask-form').hidden, 5000, my); }, target: () => $('#ask-form'),
        say: "The last tab is Ask. Anyone, from support to project managers, can ask the knowledge base a question in plain English." },
      { ch: 'Ask', when: () => proj && askFound, play: (my) => replayAsk(askFound, proj.key, my), target: () => $('#ask-form'),
        say: "Watch. The code first collects the tickets, the agent's analyses and the git history that match the question. Then Claude reads them, with read-only tools: it can open and search files, and nothing else. This is a recorded answer, so nothing is paid now." },
      { ch: 'Ask', when: () => proj && askFound, target: () => answerEl(0),
        say: () => `The answer: ${sentences(noParens(askFound.answer), 2, 260)} Every source is listed, and each one was checked by code: ${plural(askFound.sources?.length ?? 0, 'ticket or commit', 'tickets and commits')}. It took ${Math.round((askFound.meta?.durationMs ?? 0) / 1000)} seconds and ${cents(askFound.meta?.costUsd)}.` },
      { ch: 'Ask', when: () => proj && askMissing, play: (my) => replayAsk(askMissing, proj.key, my), target: () => $('#ask-form'),
        say: "And when the answer is not in the data, it says so." },
      { ch: 'Ask', when: () => proj && askMissing, target: () => answerEl(0),
        say: () => `Asked "${askMissing.question}", it answers: ${sentences(noParens(askMissing.answer), 2, 220)} It shows what does exist, and whom to ask. No guessing.` },
      { ch: 'Ask', when: () => proj && !askFound,
        go: async (my) => {
          const q = proj.askExamples?.[0] ?? 'Has this bug happened before?';
          const box = $('#ask-q');
          await clickOn(box, my);
          box.value = '';
          for (const ch of q) { if (my !== token) return; box.value += ch; await sleep(30); }
          await moveTo($('#ask-go'), my);
        },
        target: () => $('#ask-form'),
        say: "The answer comes only from Jira, the agent's analyses, the git history and the code, and every claim cites its source. If the answer is not there, it says so, instead of guessing. I won't press Ask now: each question is a short paid run of about half a minute." },

      // How it was built, and the end
      { ch: 'How it was built', slide: 'built', reveal: 2,
        say: "How was it built? Problem first: the problem, the metrics, the risks and the rules were approved before any code. Then a skill to run on demand, then the watcher that runs it alone, always with evidence over opinion and a human deciding. It is tested on four linked demo apps with real history and hidden answer keys: about eighty seconds to an analysis, six to eight out of eight on the scored cases, and no writes outside the policy." },
      { ch: 'How it was built', slide: 'built', reveal: 3,
        say: "Next: approval straight from Teams, a night shift with a morning digest, release notes, a reply to the customer after the merge, and redaction of patient data before company tickets." },
      { ch: 'The end', go: async (my) => { await openTab('tickets', my); window.scrollTo({ top: 0, behavior: 'smooth' }); }, target: () => $('header'),
        say: "That's Ticket Intelligence. Tickets understood in minutes, the bug proven with a test, a fix proposed and reviewed, the right person informed, and the knowledge kept for next time. Thanks for watching." },
    ];
  }

  // ------------------------------------------------------------------ player
  let steps = [];
  let cur = 0;
  let token = 0;
  let running = false;
  let paused = false;
  let target = null;
  let saved = null;
  let spot, bar, textEl, numEl, chEl, progEl, pauseBtn;

  function ui() {
    spot = Object.assign(document.createElement('div'), { id: 'tour-spot' });
    bar = document.createElement('div');
    bar.id = 'tour-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Guided tour');
    textEl = Object.assign(document.createElement('div'), { className: 'tt' });
    textEl.setAttribute('aria-live', 'polite');
    progEl = Object.assign(document.createElement('div'), { className: 'tp' });
    progEl.append(document.createElement('i'));
    numEl = Object.assign(document.createElement('span'), { className: 'tn' });
    chEl = Object.assign(document.createElement('span'), { className: 'ch' });
    const btn = (label, title, fn) => Object.assign(document.createElement('button'), { className: 'small', textContent: label, title, onclick: fn, type: 'button' });
    pauseBtn = btn('⏸ Pause', 'Pause (space)', () => (paused ? resume() : pause()));
    const voiceSel = document.createElement('select');
    voiceSel.setAttribute('aria-label', 'Voice');
    voiceSel.onchange = () => { store.set('ti-tour-voice', voiceSel.value); voice = pickVoice(); if (running && !paused) play(cur, 1); };
    const fillVoices = () => {
      const en = englishVoices();
      voiceSel.replaceChildren(...en.map((v) => new Option(v.name.replace(/^Microsoft /, '').replace(/ - .*$/, ''), v.name)), new Option('No voice (captions only)', 'none'));
      voiceSel.value = store.get('ti-tour-voice') === 'none' ? 'none' : voice?.name ?? 'none';
    };
    fillVoices();
    if (synth) synth.onvoiceschanged = () => { voice = pickVoice(); fillVoices(); };
    const rateSel = document.createElement('select');
    rateSel.setAttribute('aria-label', 'Speed');
    rateSel.replaceChildren(...[0.85, 1, 1.15, 1.3].map((x) => new Option(`${x}×`, String(x))));
    rateSel.value = String(rate);
    rateSel.onchange = () => { rate = Number(rateSel.value); store.set('ti-tour-rate', String(rate)); };
    const controls = Object.assign(document.createElement('div'), { className: 'tc' });
    controls.append(btn('⏮ Back', 'Previous step (←)', () => jump(-1)), pauseBtn, btn('Next ⏭', 'Next step (→)', () => jump(1)),
      chEl, numEl, Object.assign(document.createElement('span'), { className: 'spacer' }), voiceSel, rateSel, btn('✕ End', 'End the tour (Esc)', stop));
    bar.append(textEl, progEl, controls);
    document.body.append(spot, bar);
    cursorUi();
  }

  /** Every frame: the spotlight follows its target, the slide fits between header and caption bar, replays say REPLAY. */
  function follow() {
    if (!running) return;
    const headBottom = $('header').getBoundingClientRect().bottom;
    const barTop = bar.getBoundingClientRect().top;
    if (slideEl) {
      slideEl.style.top = `${headBottom + 14}px`;
      slideEl.style.maxHeight = `${Math.max(200, barTop - headBottom - 30)}px`;
    }
    let el = null;
    try { el = target?.(); } catch { /* gone */ }
    if (shown(el)) {
      const r = el.getBoundingClientRect();
      // Below the sticky header, unless the target is in the header itself.
      const top = (el.closest('header') ? r.top : Math.max(r.top, headBottom + 4)) - 6;
      const bottom = Math.min(r.bottom, barTop - 8) + 6;
      Object.assign(spot.style, { top: `${top}px`, left: `${r.left - 6}px`, width: `${r.width + 12}px`, height: `${Math.max(24, bottom - top)}px` });
    } else {
      Object.assign(spot.style, { top: '50%', left: '50%', width: '0px', height: '0px' });
    }
    for (const rp of rps.values()) {
      const head = ticketEl(rp.key)?.querySelector('.t-head');
      if (head && !head.querySelector('.tour-replay')) {
        head.append(Object.assign(document.createElement('span'), { className: 'tour-replay', textContent: `REPLAY · ${longDate(rp.recordedAt)}`, title: 'A recorded run of the agent, replayed by the tour (only in this page)' }));
      }
    }
    document.querySelectorAll('#ask-answers .answer').forEach((el, i) => {
      const a = answers[i];
      if (a?.tourReplay && !el.querySelector('.tour-replay')) {
        el.querySelector('.q')?.append(Object.assign(document.createElement('span'), { className: 'tour-replay', textContent: `REPLAY · ${a.at ? longDate(a.at) : 'recorded'}`, title: 'A recorded answer, replayed by the tour (nothing was asked or paid now)' }));
      }
    });
    requestAnimationFrame(follow);
  }

  /** Scrolls the target into the space between the sticky header and the caption bar. */
  function bringIntoView(el) {
    if (!shown(el)) return;
    const head = $('header').getBoundingClientRect().bottom;
    const room = bar.getBoundingClientRect().top - head - 24;
    const r = el.getBoundingClientRect();
    const y = window.scrollY + r.top - head - (r.height < room ? (room - r.height) / 2 : 12);
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  }

  async function play(from, dir) {
    const my = ++token;
    synth?.cancel();
    for (let i = from; i >= 0 && i < steps.length; i += dir) {
      const st = steps[i];
      let ok = true;
      try { ok = !st.when || Boolean(st.when()); } catch { ok = false; }
      if (!ok) continue;
      dir = 1; // after a jump back, go on forward
      cur = i;
      numEl.textContent = `${i + 1} / ${steps.length}`;
      chEl.textContent = st.ch ?? '';
      progEl.firstChild.style.width = `${Math.round(((i + 1) / steps.length) * 100)}%`;
      textEl.textContent = '…';
      if (st.slide) { showSlide(st.slide, st.reveal ?? 99); target = () => slideEl; } else hideSlide();
      try { await st.go?.(my); } catch { /* the step shows what it can */ }
      if (my !== token) return;
      const tgt = st.slide ? () => slideEl : st.target;
      target = tgt;
      // A replay step: the recorded events play while the voice explains them.
      const playing = st.play ? st.play(my) : null;
      if (!(await until(() => shown(tgt()), 8000, my))) return;
      const el = tgt();
      if (!shown(el)) { if (playing) await playing; continue; } // nothing to point at: skip this step
      if (!st.slide) bringIntoView(el);
      let text = '';
      try { text = typeof st.say === 'function' ? st.say() : st.say; } catch { continue; }
      textEl.textContent = text;
      await sleep(450);
      if (!(await say(text, my))) return;
      if (playing) { if (!(await playing)) return; if (!st.slide) bringIntoView(tgt()); }
      try { await st.after?.(my); } catch { /* optional */ }
      if (!(await until(() => false, 600, my))) return;
    }
    if (my === token) stop();
  }

  function jump(by) {
    paused = false;
    pauseBtn.textContent = '⏸ Pause';
    play(Math.max(0, Math.min(steps.length - 1, cur + by)), by < 0 ? -1 : 1);
  }
  // Pause cancels the speech; resume says the current step again (pause/resume of speech is unreliable in browsers).
  function pause() { paused = true; token++; synth?.cancel(); pauseBtn.textContent = '▶ Resume'; }
  function resume() { paused = false; pauseBtn.textContent = '⏸ Pause'; play(cur, 1); }

  function onKey(e) {
    if (!running || e.target.closest?.('input, textarea, select')) return;
    if (e.key === 'Escape') stop();
    else if (e.key === 'ArrowRight') jump(1);
    else if (e.key === 'ArrowLeft') jump(-1);
    else if (e.key === ' ') { e.preventDefault(); paused ? resume() : pause(); }
    else return;
    e.preventDefault();
  }

  async function getJson(url) {
    try { const res = await fetch(url); return res.ok ? await res.json() : null; } catch { return null; }
  }

  async function start() {
    if (running) return;
    document.getElementById('tour-start')?.remove();
    running = true;
    paused = false;
    voice = pickVoice();
    ui();
    textEl.textContent = 'Getting ready…';
    requestAnimationFrame(follow);
    document.addEventListener('keydown', onKey, true);
    const my = token;
    await until(() => status && live, 10000, my);
    if (!running) return;
    saved = { tab, project: selected, expanded: new Map([...tickets.values()].map((t) => [t.key, t.expanded])), scroll: window.scrollY };
    // Recorded runs for the cases (a ticket shown live is never replaced), and recorded Ask answers.
    const replay = await getJson('/api/tour/replay');
    for (const run of replay?.runs ?? []) if (run?.events?.length && !tickets.has(run.key)) rps.set(run.key, { ...run, i: 0, shift: null });
    const askProject = projOf([...rps.keys()][0] ?? '') || focus()?.key || projects().find((p) => p.ready)?.key;
    asks = askProject ? (await getJson(`/api/tour/asks?project=${encodeURIComponent(askProject)}`))?.answers ?? [] : [];
    if (!running) return;
    steps = buildSteps();
    play(0, 1);
  }

  function stop() {
    if (!running) return;
    running = false;
    token++;
    synth?.cancel();
    document.removeEventListener('keydown', onKey, true);
    for (const el of [spot, bar, cursor]) el?.remove();
    hideSlide();
    target = null;
    removeReplays();
    asks = [];
    if (saved) {
      for (const t of tickets.values()) if (saved.expanded.has(t.key)) t.expanded = saved.expanded.get(t.key);
      if (selected !== saved.project) selectProject(saved.project);
      showTab(saved.tab);
      render();
      window.scrollTo({ top: saved.scroll });
      saved = null;
    }
  }

  // ------------------------------------------------------------------ entry points
  document.getElementById('tour-btn')?.addEventListener('click', start);
  window.startTour = start;
  if (new URLSearchParams(location.search).has('tour')) {
    const wrap = Object.assign(document.createElement('div'), { id: 'tour-start' });
    const go = Object.assign(document.createElement('button'), { className: 'primary', textContent: '▶ Start the guided tour', onclick: start, type: 'button' });
    wrap.append(go);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
    document.body.append(wrap);
  }
})();
