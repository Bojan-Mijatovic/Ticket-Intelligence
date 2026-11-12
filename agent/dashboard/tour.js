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
// Three modes. ?tour (or ▶ Tour): the tour above, with its slides over the dashboard. ?present (or ▶ Present): a
// presentation of about fourteen minutes: full-screen slides (slides.js), then the tour's dashboard part as the demo,
// then full-screen slides again (what you just saw, results, technologies, sources, thank you) and backup Q&A slides
// after the end. ?deck: the slides alone. In a presentation, P switches to presenter mode (no voice; → shows the next
// part of a slide, then the next slide) and F to full screen.
//
// Start it with the buttons in the header, or open the dashboard with ?tour, ?present or ?deck (a click is still
// needed: browsers do not let a page speak before the person has clicked on it). It uses the dashboard's own globals (tickets, status,
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
    #tour-bar { position: fixed; z-index: 63; left: 50%; bottom: 18px; transform: translateX(-50%); width: min(1180px, calc(100vw - 32px));
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
    #tour-bar .parts { display: inline-flex; gap: 4px; }
    #tour-bar .parts[hidden], #tour-bar .tm[hidden] { display: none; }
    #tour-bar .parts button.on, #tour-bar button.on { background: var(--accent); border-color: var(--accent); color: #fff; }
    #tour-bar .tm { display: inline-flex; gap: 3px; font-size: 11px; font-weight: 700; }
    #tour-bar .tm span { padding: 2px 8px; border-radius: 999px; background: var(--surface-2); color: var(--muted); border: 1px solid var(--border); white-space: nowrap; }
    #tour-bar .tm span.on { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
    @media (max-width: 600px) { #tour-bar { bottom: 8px; } #tour-bar .tt { font-size: 14px; } }
  ` }));
  // The slides' own styles (slides.js).
  document.head.append(Object.assign(document.createElement('style'), { textContent: window.TourSlides?.css ?? '' }));

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
    // data-speaking on the caption bar: when the tour talks (lets a test measure the silences between steps).
    if (bar) bar.dataset.speaking = '1';
    try {
      if (muted()) {
        const words = text.split(/\s+/).length;
        return await until(() => false, (words / 2.6) * 1000 / rate + 900, my);
      }
      const parts = speakable(text).match(/[^.!?]+[.!?]+["')]*|[^.!?]+$/g) ?? [text];
      for (const p of parts) {
        if (my !== token) return false;
        if (p.trim()) await speakOne(p.trim());
      }
      return my === token;
    } finally {
      if (bar) bar.dataset.speaking = '0';
    }
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
      // A tenth of the real pace, so the steps stream while the voice explains them.
      if (prev) await sleep(Math.min(2200, Math.max(150, (Date.parse(e.at) - Date.parse(prev.at)) * 0.1)));
      if (my !== token) return false;
      apply({ ...e, at: new Date(Date.parse(e.at) + rp.shift).toISOString() });
      if (e.type === 'picked') tickets.get(key).expanded = true; // keep the steps visible when it is done
      rp.i++;
      render();
      // `type` is an event type, or the start of a progress step's text (e.g. 'ticket.mjs').
      if (e.type === type || (type && e.type === 'progress' && String(e.text ?? e.step ?? '').startsWith(type))) return true;
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

  /** Closes the suggested-ticket editor the tour opened (the page's own state: openSuggestion). */
  function closeEditor() {
    if (typeof openSuggestion !== 'undefined' && openSuggestion) { openSuggestion = null; if (insightsData) renderSuggestions(insightsData); }
  }

  // ------------------------------------------------------------------ slides (their content is in slides.js)
  let slideEl = null;
  let slideName = null;
  let revealed = 0; // the newest group of the slide's data-r elements that is shown
  /** The number of reveal groups on the slide shown (data-r="1", "2", …). */
  const groups = () => Math.max(0, ...[...(slideEl?.querySelectorAll('[data-r]') ?? [])].map((el) => Number(el.dataset.r) || 0));
  /** Shows the groups up to `n`; group `n` is lit (data-g). */
  function reveal(n) {
    revealed = n;
    if (!slideEl) return;
    for (const el of slideEl.querySelectorAll('[data-r]')) el.classList.toggle('on', Number(el.dataset.r) <= n);
    for (const el of slideEl.querySelectorAll('[data-g]')) el.classList.toggle('hot', Number(el.dataset.g) === n);
  }
  function showSlide(name, n) {
    const make = window.TourSlides?.slides?.[name];
    if (!make) return;
    if (!slideEl) {
      slideEl = Object.assign(document.createElement('div'), { id: 'tour-slide', className: full ? 'full' : '' });
      document.body.append(slideEl);
    }
    if (slideName !== name) {
      const html = make({ ...ctx, full });
      slideEl.innerHTML = full ? `<div class="page">${html}</div>` : html;
      slideName = name;
      slideEl.scrollTop = 0;
      revealed = 0;
    }
    requestAnimationFrame(() => reveal(n));
    cursor?.classList.remove('on');
  }
  /** A full-screen slide fades out (into the dashboard); one over the page just goes. */
  function hideSlide() {
    const el = slideEl;
    slideEl = null;
    slideName = null;
    if (!el) return;
    if (running && el.classList.contains('full')) { el.classList.add('out'); setTimeout(() => el.remove(), 450); } else el.remove();
  }

  // ------------------------------------------------------------------ the script
  let mode = 'tour'; // 'tour' | 'present' | 'deck'
  let full = false; // slides cover the whole screen (present, deck)
  let presenter = false; // no voice; → moves on (present, deck)
  let deckCfg = {}; // agent.config.json "presentation": presenter, team, contact
  let ctx = {}; // what the slides show: the cases, the apps (built with the steps)
  let asks = []; // recorded Ask answers for the tour
  let suite = null; // the suite insights, fetched at the start (it also warms the server's cache)
  let preIns = null; // the first case's project insights, fetched at the start for the same reason
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

    // The cases: a live ticket first, then recorded runs; case 2 crosses projects.
    const analyzed = [...tickets.values()].filter((t) => t.result && !rps.has(t.key));
    const live = analyzed.find((t) => t.fix?.stage === 'done' && t.review?.stage === 'done') ?? analyzed.find((t) => t.fix?.stage === 'done') ?? analyzed.find((t) => t.state === 'done') ?? analyzed[0] ?? null;
    const replayed = [...rps.keys()];
    const k1 = live?.key ?? replayed.find((k) => did(k, 'fix-proposed')) ?? replayed[0] ?? null;
    const k2 = replayed.find((k) => k !== k1 && did(k, 'cross-project') && !did(k, 'duplicate')) ?? null;

    const ready = projects().filter((p) => p.ready);
    const proj = (k1 && projectInfo(projOf(k1))) ?? focus() ?? ready[0] ?? null;
    const pollSecs = status?.lastPoll && status?.nextPoll ? Math.round((Date.parse(status.nextPoll) - Date.parse(status.lastPoll)) / 1000) : null;
    const d = () => (insightsData && insightsFor === proj?.key ? insightsData : null);
    const toInsights = async (my) => { await openTab('insights', my); if (proj) await pickProject(proj.key, my); };
    const answerEl = (i = 0) => document.querySelectorAll('#ask-answers .answer')[i] ?? null;
    const [askFound, askMissing] = [asks.find((a) => a.found), asks.find((a) => !a.found)];
    const cents = (usd) => `${Math.round((usd ?? 0) * 100)} cents`;

    // Facts of a run, from its recorded events (the voice may describe a step before the replay has shown it).
    const evText = (k, type, re = null) => evs(k).filter((e) => e.type === type).map((e) => String(e.text ?? '')).find((t) => !re || re.test(t)) ?? '';
    const reviewOf = (k) => (T(k)?.review?.stage === 'done' ? T(k).review : firstOf(k, 'reviewed')?.review ?? null);
    const findings = (k) => Number(evText(k, 'reviewed').match(/(\d+) finding/)?.[1] ?? reviewOf(k)?.findings?.length ?? 0);
    const attachments = (k) => Number(evText(k, 'commented', /attachments/).match(/(\d+) attachments/)?.[1] ?? 0);
    const warmSecs = (k) => Number(evText(k, 'warmed').match(/ready in (\d+) s/)?.[1] ?? 0);
    const stepText = (e) => String(e?.text ?? e?.step ?? '');
    const linkedApps = (k) => {
      const e = evs(k).find((x) => x.type === 'progress' && /^linked projects:/.test(stepText(x)));
      return e ? stepText(e).replace(/^linked projects:\s*/, '').replace(/\s*\([A-Z]+\)/g, '').split(/,\s*/).filter(Boolean) : [];
    };
    const readFile = (k, re) => evs(k).some((e) => e.type === 'progress' && re.test(stepText(e)));
    /** "e2e 11 passed / 0 failed · build ok · backend not changed" in words. */
    const checksText = (k) => {
      const words = evText(k, 'verified').split(' · ').map((p) => p.trim()
        .replace(/^e2e (\d+) passed \/ 0 failed$/, 'all $1 browser tests pass')
        .replace(/^e2e not needed$/, '')
        .replace(/^build ok$/, 'the Angular build is fine')
        .replace(/^build skipped$/, '')
        .replace(/^backend not changed$/, 'the backend did not change')
        .replace(/^backend (\d+) tests ok$/, 'all $1 backend tests pass')).filter(Boolean);
      return words.length ? list(words) : 'every test and the build pass';
    };
    /** ", and post(s) the reproduction … to Jira" — `verb`: 'post' after "does it", 'posts' after "it pushes". */
    const posted = (k, verb = 'posts') => (attachments(k) ? ` and ${verb} the reproduction and the fix to Jira, with ${plural(attachments(k), 'attachment')}: screenshots and the recorded calls` : '');

    /** Case 1: one ticket end to end, from Jira to a reviewed pull request. */
    const caseOne = (k) => [
      { ch: 'Case 1', stage: 'collect', when: () => k && rps.has(k), go: async (my) => { await toTickets(k, my); await playTo(k, 'picked', my); }, target: () => ticketEl(k)?.querySelector('.t-head'),
        say: () => `Case one: a ticket for ${appWithRole(k).replace(/,$/, '')}: ${titleOf(k)}.${recorded(k)}` },
      { ch: 'Case 1', stage: 'collect', when: () => k && rps.has(k), play: playUntil(k, 'analyzed'), target: () => ticketEl(k)?.querySelector('.steps') ?? ticketEl(k),
        say: () => `Nobody starts it. The watcher picks it up within seconds, gives the agent its own copy of the code on a branch named ${k}${did(k, 'warmed') ? ', and starts the app\'s development server in parallel' : ''}. Then a plain script collects the facts: the ticket and its history, related tickets, commits, code and people. Claude reads that bundle and opens the suspect files itself.` },
      { ch: 'Case 1', stage: 'collect', when: () => k && !rps.has(k), go: async (my) => { await toTickets(k, my); T(k).expanded = true; render(); }, target: () => ticketEl(k)?.querySelector('.steps') ?? ticketEl(k)?.querySelector('.t-head'),
        say: () => `Case one, a real ticket: ${k}. ${firstSentence(titleOf(k), 160)} Here are the steps the agent took: a plain script collected the facts, then Claude read them and opened the suspect files itself.` },
      { ch: 'Case 1', stage: 'analyze', when: () => R(k), target: () => rowOf(k, 'Likely cause'),
        say: () => `${did(k, 'picked') && did(k, 'analyzed') ? `After ${duration(secs(k, 'picked', 'analyzed'))}, the` : 'The'} result is in, validated by the watcher: the likely cause with its confidence, the exact files and lines, and the owner, ${R(k).owner?.name ?? 'the right person'}. Here, with ${R(k).confidence} confidence: ${firstSentence(noParens(R(k).likelyCause))} All of it is posted as an internal comment in Jira.` },
      { ch: 'Case 1', stage: 'analyze', when: () => did(k, 'notified'), go: (my) => moveTo($('#teams'), my, { x: 0.5, y: 0.3 }), target: () => $('#teams')?.closest('aside'),
        say: () => `${R(k)?.owner?.name ?? 'The owner'} gets a handoff message in Teams, simulated here. Anything for the customer, like a reply to the reporter, waits below as a draft until a person approves it: that is the policy.` },
      { ch: 'Case 1', when: () => did(k, 'reproduced'), play: playUntil(k, 'reproduced'), go: (my) => (rps.has(k) ? moveTo(ticketEl(k), my, { x: 0.3, y: 0.8 }) : true), target: () => boxOf(k, '🛠') ?? ticketEl(k),
        say: () => (side(k) === 'backend'
          ? 'Then it goes further: it writes a backend test from the ticket and runs it with Maven. The watcher runs it again on its own, and it must fail on the current code. It does: the bug is reproduced, with proof.'
          : 'Then it goes further. It reads the test harness, with its mocked backend and page helpers, and writes a Playwright browser test from the steps in the ticket. The watcher runs it again on its own, against the real app: it must fail on the current code. It does: the bug is reproduced, with proof.') },
      { ch: 'Case 1', when: () => did(k, 'fix-proposed'), play: playUntil(k, 'fix-proposed'), target: () => boxOf(k, '🛠') ?? ticketEl(k),
        say: () => `Now the agent makes the smallest fix. The watcher checks it independently: ${checksText(k)}. Only then does it push the branch, open a draft pull request on GitHub,${posted(k, 'post') || ' and post it to Jira'}.`,
        after: (my) => moveTo(ticketEl(k)?.querySelector('.pr-link'), my) },
      { ch: 'Case 1', when: () => T(k)?.fix?.before && T(k)?.fix?.after, target: () => ticketEl(k)?.querySelector('.shots'),
        say: "The screenshots before and after the fix are the evidence." },
      { ch: 'Case 1', when: () => did(k, 'reviewed'), play: playUntil(k, ''), target: () => boxOf(k, '🧐') ?? boxOf(k, '🛠') ?? ticketEl(k),
        say: () => `A second agent reviews the pull request, read-only and without a shell: risk ${reviewOf(k)?.risk ?? 'low'}, ${plural(findings(k), 'finding')}. Merging stays a human decision. From the ticket to a reviewed pull request: ${duration(secs(k, 'picked', 'reviewed'))}, and nobody had to start it.` },
    ];

    const cross = (k) => T(k)?.cross ?? null;
    // From the recorded event too: the voice may describe it before the replay has applied it to the card.
    const crossEv = (k) => firstOf(k, 'cross-project');
    const crossApp = (k) => cross(k)?.projects?.[0] ?? crossEv(k)?.projects?.[0];

    /** Case 2: a bug whose cause is a change in another app. */
    const caseTwo = (k) => [
      { ch: 'Case 2', stage: 'collect', when: () => k, go: async (my) => { if (k1 && T(k1)) { T(k1).expanded = false; render(); } await toTickets(k, my); await playTo(k, 'picked', my); }, play: playUntil(k, 'analyzed'), target: () => ticketEl(k) ?? null,
        say: () => `Case two is harder. ${appWithRole(k)} gets a ticket: ${titleOf(k)}. The trouble started in another app. ${appName(k)} calls ${linkedApps(k).length ? list(linkedApps(k)) : 'other apps of the suite'}, so the run also gets a read-only copy of each, and their Jira projects are searched too.` },
      { ch: 'Case 2', stage: 'analyze', when: () => k && crossApp(k), target: () => rowOf(k, 'Other projects') ?? rowOf(k, 'Likely cause'),
        say: () => {
          const o = crossApp(k);
          const ev = String(o.evidence ?? '').match(/\b[A-Z][A-Z0-9_]+-\d+\b/)?.[0];
          const fixIn = cross(k)?.fixIn ?? crossEv(k)?.fixIn;
          return `It finds where it started: ${firstSentence(noParens(o.why))}${ev ? ` It cites the change, ${ev}, with its commit,` : ''}${fixIn ? ` and says the fix belongs in ${projectInfo(fixIn)?.name ?? fixIn}.` : ''}`;
        } },
      { ch: 'Case 2', when: () => did(k, 'fix-proposed'), play: playUntil(k, ''), target: () => boxOf(k, '🛠') ?? ticketEl(k),
        say: () => `${side(k) === 'backend' ? `The proof is a J Unit test.${readFile(k, /Fake\w+Client/) ? ' The tests used a fake of the other app that still sends the old data: that is why they were green while production was wrong.' : ''}` : 'A browser test proves it first.'} The new test fails, the fix makes ${checksText(k)}, and a draft pull request is open, reviewed with risk ${reviewOf(k)?.risk ?? 'low'}. ${duration(secs(k, 'picked', 'fix-proposed')).replace(/^\w/, (c) => c.toUpperCase())}, across two applications.` },
    ];

    // The suggested ticket the tour opens in the editor: one that can still be created, with a suggested person.
    const pickSuggestion = () => (d()?.suggestions ?? []).filter((s) => !s.created && !s.openAs).sort((a, b) => Boolean(b.person) - Boolean(a.person))[0] ?? null;
    let opened = null;
    const editorEl = () => document.querySelector('#ins-suggestions td[colspan="4"]');
    const labelOf = (text) => [...(editorEl()?.querySelectorAll('label') ?? [])].find((l) => l.textContent.includes(text)) ?? null;

    // What the presentation's slides show: the same cases and numbers as the demo.
    const caseFacts = (k) => {
      const last = ['reviewed', 'fix-proposed', 'analyzed'].find((t) => did(k, t));
      const o = crossApp(k);
      const fixIn = cross(k)?.fixIn ?? crossEv(k)?.fixIn;
      return {
        key: k, app: appName(k), title: titleOf(k),
        analyzeSecs: secs(k, 'picked', 'analyzed'), totalSecs: last ? secs(k, 'picked', last) : 0,
        reproduced: did(k, 'reproduced'), fixed: did(k, 'fix-proposed'), side: side(k), risk: did(k, 'reviewed') ? reviewOf(k)?.risk ?? null : null,
        cross: o ? projectInfo(o.key)?.name ?? o.key : null, fixIn: fixIn ? projectInfo(fixIn)?.name ?? fixIn : null,
        cost: firstOf(k, 'analyzed')?.meta?.costUsd ?? T(k)?.meta?.costUsd ?? 0,
      };
    };
    ctx = {
      mode, deck: deckCfg,
      apps: projects().map((p) => ({ key: p.key, name: p.name, role: String(p.description ?? ROLE[p.key] ?? '').split(/[;:]/)[0], linked: p.linked ?? [] })),
      cases: [k1, k2].filter(Boolean).map(caseFacts),
    };

    const opening = [
      { ch: 'Welcome', target: () => $('.brand'),
        say: "Hi. This is Ticket Intelligence: an AI agent that reads every new Jira ticket, finds the code behind it, proves the bug with a test, proposes a fix, and gets it to the right person. In about twelve minutes: the problem, how it works, two real cases, Insights and Ask. Nothing I do here costs money or changes anything." },
      { ch: 'The problem', slide: 'problem', reveal: 3,
        say: "The problem: customers open a ticket, then ask what the status is. To answer, an engineer has to read the ticket and its history, find earlier tickets like it, find the code and what changed there, and work out who knows it. By hand, slowly, and hardest for people new to a project. The goal: for every new ticket, within minutes and with no human start, an analysis with evidence, the right person informed, and the knowledge kept." },
      { ch: 'Behind the scenes', slide: 'pipeline', reveal: 2,
        say: "Behind the scenes, a watcher checks Jira every thirty seconds. Plain code collects the facts first. Then Claude reads them, in a run that cannot edit files, and returns a result the code checks. A policy decides what goes out on its own, and what waits for a human." },
      { ch: 'Behind the scenes', slide: 'pipeline', reveal: 4,
        say: "When the bug is clear, the agent proves it with a test that must fail, fixes it, and the watcher re-runs every check before a draft pull request is opened and a second AI reviews it. When the ticket is closed, the cause and fix go into the knowledge base, for Insights and Ask." },
      { ch: 'The AI', slide: 'ai', reveal: 3,
        say: "The AI is Claude, by Anthropic, through Claude Code: Sonnet for the analysis, Opus for the fix, the review and Ask. Code does the facts and the checks; the model does the judgement. Each run gets only the tools it needs, and every source it cites is checked. It is not trained on our data; it improves through what it reads, and every change is scored. An analysis costs fifteen to sixty cents." },
      { ch: 'At work', slide: 'work', reveal: 3,
        say: "At work, the same skills run on demand in GitHub Copilot, which reads the same skill files; that is still to be tried there. Projects can be in git or SVN: the analysis gives the same result on an SVN copy of the demo app, and documentation on SVN can be a commit, a branch or a patch. The automatic fix and Insights are git only for now." },
    ];

    // The dashboard: the demo part of a presentation.
    const dashboard = [
      { ch: 'The dashboard', target: () => $('#state'), go: async (my) => { await toTickets(k1, my); await moveTo($('#state'), my); },
        say: () => `This is the live dashboard: the agent is watching Jira${pollSecs > 0 ? ` every ${pollSecs < 90 ? `${pollSecs} seconds` : `${Math.round(pollSecs / 60)} minutes`}` : ''}${projects().length > 1 ? `, for ${projects().length} linked apps of one hospital suite` : ''}.` },
      { ch: 'The dashboard', when: () => !k1, target: () => $('#tickets'),
        say: "Each new ticket appears here as a card, and you can watch the agent's steps live. There is no analyzed ticket yet, so let's move on." },

      ...caseOne(k1),
      ...caseTwo(k2),

      // Insights
      { ch: 'Insights', when: () => ready.length > 1,
        go: async (my) => { await openTab('insights', my); await pickProject('all', my); },
        play: (my) => until(() => hasContent('suite-integrations') && !$('#suite-apps').textContent.includes('Loading'), 25000, my),
        target: () => sectionOf('ins-suite'),
        say: () => {
          const name = (key) => projectInfo(key)?.name ?? key;
          const crossed = (suite?.integrations ?? []).filter((i) => i.linkedBugs).map((i) => `from ${name(i.from)} to ${name(i.to)}`);
          return `Insights looks at the whole history. It is plain code over git, Jira and the agent's analyses, so it costs nothing. For the whole suite${suite?.totals ? `, ${plural(suite.totals.bugs, 'bug')} in ${suite.totals.apps} apps` : ''}: how the apps call each other${crossed.length ? `, with bugs that crossed the links ${list(crossed)}` : ''}, and code copied between apps, where a fix made in one copy and missing in another is flagged.`;
        } },
      { ch: 'Insights', when: () => proj,
        go: async (my) => { await toInsights(my); },
        play: (my) => until(() => d() && !$('#ins-body').hidden, 25000, my),
        target: () => sectionOf('ins-kpis') ?? sectionOf('ins-body'),
        say: () => {
          const x = d() ?? preIns;
          const cov = x?.testCoverage?.backend;
          const last = x?.trend?.at?.(-1)?.code;
          return `For one app, ${proj.name}:${x ? ` ${plural(x.totals.bugs, 'bug')}, ${x.totals.priorityBugs} of them high priority, and ${plural(x.recurring?.length ?? 0, 'recurring problem')}.` : ''}${cov ? ` Only ${cov.tested} of ${cov.total} backend services have a unit test${last ? `; ${last.screensTested} of ${last.screensTotal} screens have a browser test` : ''}.` : ''}` ;
        } },
      { ch: 'Insights', when: () => document.querySelector('#ins-heat .hc.clickable'),
        go: async (my) => {
          const cells = [...document.querySelectorAll('#ins-heat .hc.clickable')];
          const top = cells.reduce((a, b) => ((parseInt(b.textContent, 10) || 0) > (parseInt(a.textContent, 10) || 0) ? b : a), cells[0]);
          bringIntoView(top.closest('.panel'));
          await sleep(500);
          await clickOn(top, my);
        },
        target: () => sectionOf('ins-tickets') ?? $('#ins-heat')?.closest('.panel'),
        say: "The map shows bugs per component and month, taken from the commits that fixed them. One click on a cell lists the tickets behind the number." },
      { ch: 'Insights', when: () => d()?.hotspots?.length, target: () => sectionOf('ins-hotspots'),
        say: () => { const c = d().components.find((x) => x.name === d().hotspots[0]); return `The hotspots rank components by bugs, weighted by priority and churn. The top one is ${d().hotspots[0]}${c ? `, with ${plural(c.bugs, 'bug')}` : ''}, and the AI can write a recommendation that must cite tickets and commits.`; } },
      { ch: 'Insights', when: () => d()?.review?.evaluation && hasContent('ins-review-body'), go: (my) => moveTo($('#ins-review'), my), target: () => sectionOf('ins-review-body'),
        say: () => {
          const r = d().review;
          return `On this button, the AI reviews the whole app, read-only: it scores five areas from one to five, and lists ${plural(r.findings?.length ?? 0, 'finding')}, ${plural(r.refactors?.length ?? 0, 'refactor')} and ${plural(r.growth?.length ?? 0, 'way')} to grow, each with its source.${r.stale ? ' The page says when the data has changed since, as here.' : ''}`;
        } },

      // Opening a suggested ticket
      { ch: 'A new ticket', when: () => pickSuggestion() && hasContent('ins-suggestions'), target: () => sectionOf('ins-suggestions'),
        say: () => `From the review and the facts come ${plural(d().suggestions.length, 'suggested ticket')}, each with the person who knows that code best. Let's open one.` },
      { ch: 'A new ticket', when: () => pickSuggestion(),
        go: async (my) => {
          opened = pickSuggestion();
          const row = [...document.querySelectorAll('#ins-suggestions tr')].find((tr) => tr.querySelector('b')?.textContent === opened.summary);
          const btn = row && [...row.querySelectorAll('button')].find((b) => /Create in Jira/.test(b.textContent));
          if (btn) { bringIntoView(row); await sleep(500); await clickOn(btn, my); }
          await until(() => editorEl(), 3000, my);
        },
        target: () => editorEl(),
        say: () => `Create in Jira opens it for editing, already written: the summary in the project's style, ${plainTitle(opened?.summary ?? '')}, a type and a priority, and a Jira description with the problem, the evidence, the proposed fix, how to prevent it, and the files. Everything can be changed.` },
      { ch: 'A new ticket', when: () => opened && editorEl(),
        go: async (my) => { await until(() => !labelOf('Assignee')?.querySelector('select')?.disabled, 5000, my); },
        // After the page has scrolled to the target, so the cursor lands on the list.
        play: async (my) => { await sleep(900); await moveTo(labelOf('Assignee')?.querySelector('select'), my); },
        target: () => labelOf('Assignee')?.parentElement ?? editorEl(),
        say: () => {
          // The note next to the list ("suggested: X (no Jira account in DEM)"), not the field labels.
          const note = labelOf('Assignee')?.parentElement?.querySelector(':scope > span.t-sub')?.textContent ?? '';
          return `The assignee list comes from Jira: only the people who can be assigned in ${projectInfo(opened?.project)?.name ?? 'this project'}. The suggested person, ${opened?.person?.name ?? 'the one who knows the code best'}, is picked when they have an account.${/no Jira account/.test(note) ? ' Here they have none in this Jira, so the page says so and leaves it to you.' : ''}`;
        } },
      { ch: 'A new ticket', when: () => opened && editorEl(),
        play: async (my) => {
          await sleep(900);
          await moveTo(labelOf('Let the agent')?.querySelector('input'), my);
          await sleep(1200);
          await moveTo([...(editorEl()?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Create in Jira'), my);
        },
        target: () => labelOf('Let the agent')?.parentElement ?? editorEl(),
        after: async (my) => { closeEditor(); await until(() => false, 200, my); },
        say: "By default the new ticket gets the no-ai label, so the agent leaves it alone; tick the box to let it analyze it. Create in Jira asks for a confirmation, then the watcher creates it with the label ai-suggested, checks the assignee again, and leaves it in the backlog. I won't create one now." },

      { ch: 'Insights', when: () => d()?.riskFiles?.length && hasContent('ins-risk'), go: async () => { closeEditor(); }, target: () => sectionOf('ins-risk'),
        say: () => {
          const f = d().riskFiles[0];
          const r = d().recurring?.[0];
          const o = d().origins;
          return `Further down: risk files, where the next bug is most likely; here ${f.path.split('/').pop()}, with ${list(f.why)}. Recurring problems${r ? `, like ${r.key} repeating ${r.of}` : ''}. And where bugs come from: git blame finds the change that brought each one in${o?.medianDaysInCode ? `; a bug stayed in the code ${o.medianDaysInCode} days, at the median` : ''}. It names the change, not the person.`;
        } },
      { ch: 'Insights', when: () => hasContent('ins-knowledge'), target: () => sectionOf('ins-knowledge'),
        say: () => { const one = (d()?.components ?? []).filter((c) => c.team?.length && c.busFactor <= 1).length; return `And the knowledge map: who knows each component.${one ? ` ${one === 1 ? 'One component is' : `${one} components are`} known by one person only, so the suggestions pick a second person to learn it.` : ' Here every component is known by at least two people.'} The people table below is for knowing whom to ask, not for ranking anyone.`; } },

      // Ask
      { ch: 'Ask', when: () => proj && askFound, go: async (my) => { closeEditor(); await openTab('ask', my); await until(() => !$('#ask-form').hidden, 5000, my); }, play: (my) => replayAsk(askFound, proj.key, my), target: () => $('#ask-form'),
        say: "The last tab is Ask: anyone can ask the knowledge base in plain English. The code collects the matching tickets, analyses and history; Claude reads them with read-only tools. This is a recorded answer, so nothing is paid now." },
      { ch: 'Ask', when: () => proj && askFound, target: () => answerEl(0),
        say: () => `The answer: ${sentences(noParens(askFound.answer), 2, 220)} Every source is listed and was checked by code. It took ${Math.round((askFound.meta?.durationMs ?? 0) / 1000)} seconds and ${cents(askFound.meta?.costUsd)}.` },
      { ch: 'Ask', when: () => proj && askMissing, play: (my) => replayAsk(askMissing, proj.key, my), target: () => $('#ask-form'),
        say: () => `And when the answer is not in the data, it says so. Asked "${askMissing.question}", it searches the tickets, the commits, the code and the knowledge base, then answers: not in the knowledge base, and shows what does exist. No guessing.` },
      { ch: 'Ask', when: () => proj && !askFound,
        go: async (my) => {
          closeEditor();
          await openTab('ask', my);
          const q = proj.askExamples?.[0] ?? 'Has this bug happened before?';
          const box = $('#ask-q');
          await clickOn(box, my);
          box.value = '';
          for (const ch of q) { if (my !== token) return; box.value += ch; await sleep(30); }
          await moveTo($('#ask-go'), my);
        },
        target: () => $('#ask-form'),
        say: "The last tab is Ask: anyone can ask the knowledge base in plain English. The answer comes only from Jira, the agent's analyses, the git history and the code, and every claim cites its source. If the answer is not there, it says so. I won't press Ask now: each question is a short paid run." },
    ];

    const closing = [
      { ch: 'How it was built', slide: 'built', reveal: 3,
        say: "How was it built? Problem first: the problem, metrics, risks and rules were approved before any code. Then a skill on demand, then the watcher that runs it alone, with evidence over opinion and a human deciding. It is tested on four linked demo apps with hidden answer keys: about eighty seconds to an analysis, six to eight out of eight on the scored cases, no writes outside the policy. Next: approval from Teams, a night shift, and redaction of patient data before company tickets." },
      { ch: 'The end', go: async (my) => { await openTab('tickets', my); window.scrollTo({ top: 0, behavior: 'smooth' }); }, target: () => $('header'),
        say: "That's Ticket Intelligence: tickets understood in minutes, the bug proven with a test, a fix proposed and reviewed, the right person informed, and the knowledge kept. Thanks for watching." },
    ];

    if (mode === 'tour' || !window.TourSlides) return [...opening, ...dashboard, ...closing];
    const deck = window.TourSlides.deck(ctx);
    if (mode === 'deck') return [...deck.intro, ...deck.outro, ...deck.backup];
    return [...deck.intro, ...dashboard.map((s) => ({ ...s, part: 2 })), ...deck.outro, ...deck.backup];
  }

  // Where each demo step is in the flow of the "How it works" slide (the caption bar's small map).
  const STAGES = [['collect', 'Collect'], ['analyze', 'Analyze'], ['fix', 'Prove & fix'], ['learn', 'Learn']];
  const CH_STAGE = { 'The dashboard': 'collect', 'Case 1': 'fix', 'Case 2': 'fix', Insights: 'learn', 'A new ticket': 'learn', Ask: 'learn' };
  const PARTS = { 1: 'Presentation', 2: 'Demo', 3: 'Conclusion' };

  // ------------------------------------------------------------------ player
  let steps = [];
  let cur = 0;
  let token = 0;
  let running = false;
  let paused = false;
  let target = null;
  let saved = null;
  let spot, bar, textEl, numEl, chEl, progEl, pauseBtn, partsEl, mapEl, presenterBtn;

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
    // A presentation's parts (filled when the steps are built) and, in the demo, where the step is in the flow.
    partsEl = Object.assign(document.createElement('span'), { className: 'parts', hidden: true });
    mapEl = Object.assign(document.createElement('span'), { className: 'tm', hidden: true });
    mapEl.setAttribute('aria-label', 'Stage');
    for (const [key, label] of STAGES) {
      const el = Object.assign(document.createElement('span'), { textContent: label });
      el.dataset.stage = key;
      mapEl.append(el);
    }
    presenterBtn = btn('🎤 Presenter', 'Presenter mode: no voice, → moves on (P)', () => setPresenter(!presenter));
    presenterBtn.hidden = !full;
    const controls = Object.assign(document.createElement('div'), { className: 'tc' });
    controls.append(btn('⏮ Back', 'Previous step (←)', () => jump(-1)), pauseBtn, btn('Next ⏭', 'Next step (→)', () => jump(1)),
      partsEl, chEl, numEl, mapEl, Object.assign(document.createElement('span'), { className: 'spacer' }), presenterBtn, voiceSel, rateSel, btn('✕ End', 'End the tour (Esc)', stop));
    bar.append(textEl, progEl, controls);
    document.body.append(spot, bar);
    cursorUi();
  }

  /** Every frame: the spotlight follows its target, the slide fits between header and caption bar, replays say REPLAY. */
  function follow() {
    if (!running) return;
    const headBottom = $('header').getBoundingClientRect().bottom;
    const barTop = bar.getBoundingClientRect().top;
    if (slideEl?.classList.contains('full')) {
      slideEl.style.setProperty('--tour-bar-h', `${Math.max(0, innerHeight - barTop)}px`);
    } else if (slideEl) {
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

  /** The caption bar: the step number, the progress, the part of a presentation and, in the demo, the stage. */
  function mark(i, st) {
    const main = steps.filter((s) => !s.backup).length;
    numEl.textContent = st.backup ? '' : `${i + 1} / ${main}`;
    chEl.textContent = st.ch ?? '';
    progEl.firstChild.style.width = `${Math.round((Math.min(i + 1, main) / main) * 100)}%`;
    for (const b of partsEl.children) b.classList.toggle('on', Number(b.dataset.part) === st.part);
    const stage = st.slide ? null : st.stage ?? CH_STAGE[st.ch] ?? null;
    mapEl.hidden = !stage;
    for (const s of mapEl.children) s.classList.toggle('on', s.dataset.stage === stage);
  }

  /** While the voice speaks, the slide's groups appear one after another. */
  async function stagger(text, my) {
    const n = groups();
    if (n < 2) return;
    const ms = ((text.split(/\s+/).length / 2.6) * 1000) / rate;
    for (let g = 2; g <= n; g++) {
      if (!(await until(() => false, ms / n, my))) return;
      if (g > revealed) reveal(g);
    }
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
      // The same step again (resume, presenter mode switched): what the slide already shows stays.
      const keep = i === cur && st.slide && st.slide === slideName ? revealed : 0;
      cur = i;
      mark(i, st);
      textEl.textContent = '…';
      if (st.slide) { showSlide(st.slide, Math.max(keep, st.stagger ? 1 : st.reveal ?? 99)); target = () => slideEl; } else hideSlide();
      try { await st.go?.(my); } catch { /* the step shows what it can */ }
      if (my !== token) return;
      const tgt = st.slide ? () => slideEl : st.target;
      target = tgt;
      // A replay step: the recorded events play while the voice explains them.
      // Its result does not matter (a cursor that found no element returns false); a failure never stops the tour.
      const playing = st.play ? Promise.resolve().then(() => st.play(my)).catch(() => null) : null;
      if (!(await until(() => shown(tgt()), 8000, my))) return;
      const el = tgt();
      if (!shown(el)) { if (playing) await playing; continue; } // nothing to point at: skip this step
      if (!st.slide) bringIntoView(el);
      let text = '';
      try { text = typeof st.say === 'function' ? st.say() : st.say; } catch { continue; }
      textEl.textContent = text;
      // Presenter mode, or a silent slide (the backup Q&A): show it and wait for → (a replay still plays).
      if (presenter || st.silent) {
        if (st.silent) reveal(groups());
        if (playing) { await playing; if (my === token && !st.slide) bringIntoView(tgt()); }
        return;
      }
      await sleep(200);
      if (st.stagger) stagger(text, my);
      if (!(await say(text, my))) return;
      if (st.slide && revealed < groups()) reveal(groups());
      // Only a stop, pause or jump (a new token) ends this loop; what the step's animation returned does not.
      if (playing) { await playing; if (my !== token) return; if (!st.slide) bringIntoView(tgt()); }
      try { await st.after?.(my); } catch { /* optional */ }
      if (st.hold) return; // the end of a presentation: it stays until → (the Q&A slides) or Esc
      if (!(await until(() => false, 300, my))) return;
    }
    if (my === token) stop();
  }

  function jump(by) {
    // Presenter mode: → first shows the rest of the slide, then goes on.
    if (presenter && by > 0 && slideEl && revealed < groups()) { reveal(revealed + 1); return; }
    paused = false;
    pauseBtn.textContent = '⏸ Pause';
    play(Math.max(0, Math.min(steps.length - 1, cur + by)), by < 0 ? -1 : 1);
  }
  // Pause cancels the speech; resume says the current step again (pause/resume of speech is unreliable in browsers).
  function pause() { paused = true; token++; synth?.cancel(); pauseBtn.textContent = '▶ Resume'; }
  function resume() { paused = false; pauseBtn.textContent = '⏸ Pause'; play(cur, 1); }
  /** Presenter mode: no voice, the captions stay as notes, and the presenter moves on with →. */
  function setPresenter(on) {
    presenter = on;
    presenterBtn.classList.toggle('on', on);
    paused = false;
    pauseBtn.textContent = '⏸ Pause';
    play(cur, 1);
  }
  function fullscreen(on) {
    try {
      if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.()?.catch?.(() => {});
      if (!on && document.fullscreenElement) document.exitFullscreen?.()?.catch?.(() => {});
    } catch { /* not allowed here */ }
  }
  /** The part buttons of a presentation: Presentation · Demo · Conclusion; a click goes to the part's first step. */
  function renderParts() {
    const parts = [...new Set(steps.map((s) => s.part).filter(Boolean))];
    partsEl.replaceChildren(...parts.map((p) => {
      const b = Object.assign(document.createElement('button'), { className: 'small', type: 'button', textContent: PARTS[p], title: `Go to: ${PARTS[p]}` });
      b.dataset.part = p;
      b.onclick = () => { paused = false; pauseBtn.textContent = '⏸ Pause'; play(steps.findIndex((s) => s.part === p), 1); };
      return b;
    }));
    partsEl.hidden = parts.length < 2;
  }

  function onKey(e) {
    if (!running || e.target.closest?.('input, textarea, select')) return;
    if (e.key === 'Escape') stop();
    else if (e.key === 'ArrowRight') jump(1);
    else if (e.key === 'ArrowLeft') jump(-1);
    else if (e.key === ' ') { e.preventDefault(); paused ? resume() : pause(); }
    else if ((e.key === 'p' || e.key === 'P') && full) setPresenter(!presenter);
    else if (e.key === 'f' || e.key === 'F') fullscreen(!document.fullscreenElement);
    else return;
    e.preventDefault();
  }

  async function getJson(url) {
    try { const res = await fetch(url); return res.ok ? await res.json() : null; } catch { return null; }
  }

  /** `m`: 'tour' (the default), 'present' (slides, demo, slides) or 'deck' (the slides alone). */
  async function start(m) {
    if (running) return;
    mode = m === 'present' || m === 'deck' ? m : 'tour';
    full = mode !== 'tour';
    if (full) fullscreen(true); // still inside the click that started it, as browsers require
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
    // Not awaited: the first suite read takes several seconds; by the time the tour reaches Insights it is cached.
    getJson('/api/insights/suite').then((x) => { if (running) suite = x; });
    if (askProject) getJson(`/api/insights?project=${encodeURIComponent(askProject)}`).then((x) => { if (running) preIns = x; });
    deckCfg = full ? (await getJson('/api/tour/deck'))?.presentation ?? {} : {};
    if (!running) return;
    steps = buildSteps();
    renderParts();
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
    closeEditor();
    asks = [];
    suite = null;
    preIns = null;
    presenter = false;
    if (full) fullscreen(false);
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
  document.getElementById('tour-btn')?.addEventListener('click', () => start('tour'));
  document.getElementById('present-btn')?.addEventListener('click', () => start('present'));
  window.startTour = start;
  const entry = ['present', 'deck', 'tour'].find((k) => new URLSearchParams(location.search).has(k));
  if (entry) {
    const label = { present: '▶ Start the presentation', deck: '▶ Start the slides', tour: '▶ Start the guided tour' }[entry];
    const wrap = Object.assign(document.createElement('div'), { id: 'tour-start' });
    const go = Object.assign(document.createElement('button'), { className: 'primary', textContent: label, onclick: () => start(entry), type: 'button' });
    wrap.append(go);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
    document.body.append(wrap);
  }
})();
