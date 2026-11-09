// Guided tour of the dashboard. The page drives itself (tabs, scrolling, a spotlight on each part) and narrates in
// English with the browser's own speech synthesis, with captions. Read-only: it never starts an agent run, an Ask
// question, a review or a recommendation; it only shows what is already there.
//
// Start it with the ▶ Tour button in the header, or open the dashboard with ?tour (a click is still needed: browsers
// do not let a page speak before the person has clicked on it).
//
// It uses the dashboard's own globals (tickets, status, showTab, selectProject, focus, insightsData, …): top-level
// let/const of the page's script are visible to this script too.

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
      box-shadow: 0 0 0 9999px rgb(10 14 20 / 0.5); transition: top .45s ease, left .45s ease, width .45s ease, height .45s ease, opacity .3s; }
    #tour-bar { position: fixed; z-index: 61; left: 50%; bottom: 18px; transform: translateX(-50%); width: min(920px, calc(100vw - 32px));
      background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 14px; padding: 14px 16px 12px;
      box-shadow: 0 10px 30px rgb(0 0 0 / 0.25); display: grid; gap: 10px; }
    #tour-bar .tt { font-size: 16px; line-height: 1.5; min-height: 48px; }
    #tour-bar .tc { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    #tour-bar .tc select { font: inherit; font-size: 12px; padding: 4px 6px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); max-width: 220px; }
    #tour-bar .tn { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
    #tour-bar .tp { height: 3px; border-radius: 2px; background: var(--surface-2); overflow: hidden; }
    #tour-bar .tp i { display: block; height: 100%; background: var(--accent); transition: width .4s; }
    #tour-start { position: fixed; inset: 0; z-index: 62; display: grid; place-items: center; background: rgb(10 14 20 / 0.55); }
    #tour-start button { font-size: 18px; padding: 14px 28px; border-radius: 12px; }
    @media (max-width: 600px) { #tour-bar { bottom: 8px; } #tour-bar .tt { font-size: 14px; } }
  ` }));

  // ------------------------------------------------------------------ helpers
  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const firstSentence = (s, max = 220) => {
    const t = String(s ?? '').replace(/\s+/g, ' ').trim();
    const m = t.match(/^.+?[.!?](\s|$)/);
    const one = (m ? m[0] : t).trim();
    return one.length > max ? `${one.slice(0, max).replace(/\s+\S*$/, '')}…` : one;
  };
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const duration = (secs) => (secs < 90 ? `${secs} seconds` : `about ${plural(Math.round(secs / 60), 'minute')}`);
  /** A ticket title without its "[BE][FE] - " prefix. */
  const plainTitle = (s) => String(s ?? '').replace(/^(\s*\[[^\]]+\])+\s*-?\s*/, '');
  const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
  /** What the voice reads: ticket keys letter by letter, a file by its name, no commit hashes, no symbols. */
  const speakable = (s) => String(s)
    .replace(/[\w./\\-]+\.(java|ts|tsx|js|mjs|html|scss|css|xml|sql|json|properties|ya?ml)(:\d+(-\d+)?)?\b/g,
      (m) => m.replace(/:\d+(-\d+)?$/, '').split(/[/\\]/).pop().replace(/\.\w+$/, '').replace(/[._-]+/g, ' '))
    .replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g, 'a commit')
    .replace(/\b([A-Z]{2,})-(\d+)\b/g, (_, p, n) => `${p.split('').join(' ')} ${n}`)
    .replace(/[`✦▶⇄]/g, '')
    .replace(/\s+/g, ' ');

  /** Waits until `test()` is true (or the time is up); false when the tour was stopped meanwhile. */
  async function until(test, ms, my) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (my !== token) return false;
      try { if (test()) return true; } catch { /* not there yet */ }
      await sleep(150);
    }
    return my === token;
  }

  // Dashboard elements the steps point at. They are looked up again on every frame: the page re-renders often.
  const ticketEl = (key) => [...document.querySelectorAll('#tickets .ticket')].find((el) => el.querySelector('.t-key')?.textContent === key) ?? null;
  const rowOf = (key, label) => [...(ticketEl(key)?.querySelectorAll('.result .row') ?? [])].find((r) => r.querySelector('.k')?.textContent === label) ?? null;
  const boxOf = (key, icon) => [...(ticketEl(key)?.querySelectorAll('.fix') ?? [])].find((f) => f.querySelector('.fix-title')?.textContent.startsWith(icon)) ?? null;
  const sectionOf = (id) => { const el = document.getElementById(id); return el && !el.hidden && el.offsetParent ? el : null; };
  const hasContent = (id) => { const el = sectionOf(id); return el && el.children.length && !(el.children.length === 1 && el.firstElementChild.classList.contains('empty')); };

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

  // ------------------------------------------------------------------ the script
  /** The steps, built from what the dashboard has now: a real ticket, a real project, real numbers. */
  function buildSteps() {
    const all = [...tickets.values()];
    const analyzed = all.filter((t) => t.result);
    const ex = analyzed.find((t) => t.fix?.stage === 'done' && t.review?.stage === 'done')
      ?? analyzed.find((t) => t.fix?.stage === 'done')
      ?? analyzed.find((t) => t.state === 'done')
      ?? analyzed[0] ?? null;
    const ready = projects().filter((p) => p.ready);
    const proj = (ex && projectInfo(projOf(ex.key))) ?? focus() ?? ready[0] ?? null;
    const key = ex?.key;
    const r = ex?.result;
    const pollSecs = status?.lastPoll && status?.nextPoll ? Math.round((Date.parse(status.nextPoll) - Date.parse(status.lastPoll)) / 1000) : null;
    const d = () => (insightsData && insightsFor === proj?.key ? insightsData : null);
    const toTickets = () => { showTab('tickets'); if (proj && selected !== proj.key) selectProject(proj.key); };
    const toInsights = () => { if (proj && selected !== proj.key) selectProject(proj.key); showTab('insights'); };
    const insightsReady = () => d() && !$('#ins-body').hidden;

    return [
      { target: () => $('.brand'),
        say: "Hi. Let me show you Ticket Intelligence: an agent that reads every new Jira ticket, finds the code behind it, and gets the problem to the right person, with evidence. The tour takes a few minutes. Nothing I show here costs money or changes anything." },
      { target: () => $('#state'),
        say: `This light shows that the agent is live. It checks Jira on its own${pollSecs > 0 ? `, about every ${pollSecs < 90 ? `${pollSecs} seconds` : `${Math.round(pollSecs / 60)} minutes`}` : ''}. Nobody has to start it: a new ticket is picked up and analyzed by itself.` },
      { when: () => projects().length > 0, target: () => $('.project-pick'),
        say: () => `It watches ${projects().length === 1 ? 'one application' : `${projects().length} applications of the suite`}: ${list(projects().map((p) => p.name))}. Here you pick one project, or see all of them together.` },
      { target: () => $('#run-form'),
        say: "Check now asks Jira right away. Run ticket runs the whole flow again on one ticket, for example after someone edited it." },
      { go: toTickets, target: () => $('#tab-tickets .kpis'),
        say: () => {
          const done = Number($('#k-done').textContent) || 0;
          const time = $('#k-time').textContent;
          return done
            ? `The top row counts the work: ${plural(done, 'ticket')} analyzed with no human start${time !== '–' ? `, in ${duration(parseInt(time, 10)).replace(/^about /, '')} on average` : ''}, owners notified, and escalations flagged by the rules.`
            : 'The top row counts the work: tickets analyzed with no human start, the average time to an analysis, owners notified, and escalations flagged by the rules.';
        } },
      { when: () => !ex, go: toTickets, target: () => $('#tickets'),
        say: "Each new ticket appears here as a card, and you can watch the agent's steps live, with timings. There is no analyzed ticket yet, so let's move on." },
      { when: () => ex, go: () => { toTickets(); ex.expanded = true; render(); }, target: () => ticketEl(key)?.querySelector('.t-head'),
        say: () => `Let's open one real ticket: ${key}. ${firstSentence(plainTitle(ex.title), 160)}` },
      { when: () => ex?.steps?.length, target: () => ticketEl(key)?.querySelector('.steps'),
        say: () => `These are the ${ex.steps.length} steps the agent took, with the second each one happened: it read the ticket, searched for related tickets, then searched the code and its history.${ex.totalMs ? ` The whole run took ${duration(Math.round(ex.totalMs / 1000))}.` : ''}` },
      { when: () => r, target: () => rowOf(key, 'Likely cause'),
        say: () => `It explains the problem and the likely cause, with its confidence. Here, with ${r.confidence} confidence: ${firstSentence(r.likelyCause)}` },
      { when: () => r?.files?.length, target: () => rowOf(key, 'Where'),
        say: () => `It points to the exact ${r.files.length === 1 ? 'file' : 'files'} in the code, so a developer does not start from zero.` },
      { when: () => r?.owner?.name, target: () => rowOf(key, 'Owner'),
        say: () => `And it says who should handle it: ${r.owner.name}. ${firstSentence(r.owner.why, 180)}` },
      { when: () => r?.nextSteps?.length, target: () => rowOf(key, 'Next steps'),
        say: "It lists the next steps, and it has already posted all of this as a comment in Jira, where the team works anyway." },
      { when: () => ex?.fix, target: () => boxOf(key, '🛠'),
        say: () => ex.fix.stage === 'done'
          ? `When the cause is clear, it goes further. First it wrote a ${ex.fix.side === 'backend' ? 'backend test' : 'browser test'} that reproduces the bug in the real app. Then it made the fix, ran the tests and the build, and opened a draft pull request.${ex.fix.before && ex.fix.after ? ' The screenshots before and after the fix are the evidence.' : ''}`
          : 'When the cause is clear, it also tries to reproduce the bug with a test and to propose a tested fix. A fix that cannot be proven is stopped, and the card says why.' },
      { when: () => ex && !ex.fix && ex.fixSkipped, target: () => ticketEl(key)?.querySelector('.t-sub'),
        say: () => `For this ticket it did not try a fix, and it says why: ${firstSentence(ex.fixSkipped.replace(/^no automatic fix: /, ''), 160).replace(/[.…]+$/, '')}. When the cause is clear, it writes a test that reproduces the bug, makes the fix and opens a draft pull request.` },
      { when: () => ex?.review?.stage === 'done', target: () => boxOf(key, '🧐'),
        say: () => `A second agent then reviews the pull request, like a colleague would. It rated the risk ${ex.review.risk}, and checked that the test really covers the bug. Merging is always a human decision.` },
      { when: () => ex?.docs, target: () => boxOf(key, '📚'),
        say: "And when the ticket is closed in Jira, the agent writes what was learned into the project's knowledge base: the cause, the fix and how to check it. Next time a similar bug comes in, the answer is already there." },
      { go: toTickets, target: () => $('#teams')?.closest('.panel'),
        say: "The owner gets a handoff message with the context: in Microsoft Teams, or here in the simulated channel. The right person knows, without a meeting." },
      { target: () => $('#drafts')?.closest('.panel'),
        say: () => `What the agent may do on its own is a policy, shown at the bottom. ${drafts.length ? 'Anything customer-facing, like a reply to the reporter or an assignment, waits here as a draft until a person approves it.' : 'Anything customer-facing, like a reply to the reporter, waits here as a draft until a person approves it.'}` },

      // Insights
      { when: () => projects().filter((p) => p.ready).length > 1,
        go: async (my) => { showTab('insights'); selectProject('all'); await until(() => hasContent('suite-apps') && !$('#suite-apps').textContent.includes('Loading'), 20000, my); },
        target: () => sectionOf('ins-suite'),
        say: "The second tab is Insights. With several applications, it first shows the whole suite: every app side by side, how they call each other, and bugs whose cause sits in another app." },
      { when: () => proj, go: async (my) => { toInsights(); await until(insightsReady, 25000, my); }, target: () => sectionOf('ins-kpis'),
        say: () => `Now one application: ${proj.name}. Insights read the whole history: Jira, git and the agent's analyses.${d() ? ` ${plural(d().totals.bugs, 'bug')} so far, ${d().totals.openBugs} still open, across ${plural(d().totals.commits, 'commit')}.` : ''}` },
      { when: () => proj, target: () => $('#ins-heat')?.closest('.panel'),
        say: "This map shows bugs per component and month. The darker the cell, the more bugs. A click on a cell lists the tickets behind the number." },
      { when: () => d()?.hotspots?.length, target: () => sectionOf('ins-hotspots'),
        say: () => { const c = d().components.find((x) => x.name === d().hotspots[0]); return `The top hotspot is ${d().hotspots[0]}${c ? `, with ${plural(c.bugs, 'bug')}` : ''}. For each hotspot you see the files fixed more than once, and the AI can write a recommendation, citing tickets and commits.`; } },
      { when: () => proj, target: () => $('#ins-review')?.parentElement,
        say: () => `On request, an AI reviews the whole app: it reads these facts and the code, and writes findings, refactors and ways to grow. ${d()?.review ? 'Every item cites a ticket, a commit or a file; anything without a source is dropped.' : 'It runs only on this button, because it takes a few minutes.'}` },
      { when: () => proj, target: () => sectionOf('ins-suggestions'),
        say: "From that, it suggests tickets the team could open next, written in the project's style, with the person who knows that code best. Nothing is created on its own: someone checks it, edits it, and confirms." },
      { when: () => hasContent('ins-risk'), target: () => sectionOf('ins-risk'),
        say: "Risk files show where the next bug is most likely: code fixed by several bugs, changed often, big, and without a test of its own." },
      { when: () => hasContent('ins-origins'), target: () => sectionOf('ins-origins'),
        say: "And for each fixed bug, it traces which earlier change brought it in. That is about learning from the code, not blaming people." },
      { when: () => hasContent('ins-knowledge'), target: () => sectionOf('ins-knowledge'),
        say: () => { const one = (d()?.components ?? []).filter((c) => c.team?.length && c.busFactor <= 1).length; return `The knowledge map shows who knows each component.${one ? ` ${one === 1 ? 'One component is' : `${one} components are`} known by one person only. That is a risk for the team, so the suggestions pick a second person to learn it.` : ' Here every component is known by at least two people, so nobody is a single point of failure.'}`; } },

      // Ask
      { when: () => proj, go: async (my) => { showTab('ask'); await until(() => !$('#ask-form').hidden, 5000, my); }, target: () => $('#ask-form'),
        say: "The last tab is Ask. Anyone, from support to project managers, can ask the knowledge base a question in plain English." },
      { when: () => proj, target: () => $('#ask-form'),
        go: async (my) => {
          const q = proj.askExamples?.[0] ?? 'Has this bug happened before?';
          const box = $('#ask-q');
          box.value = '';
          for (const ch of q) { if (my !== token) return; box.value += ch; await sleep(28); }
        },
        say: "The answer comes only from Jira, the agent's analyses, the git history and the code, and every claim cites its source. If the answer is not there, it says so, instead of guessing. I won't press Ask now: each question is a short paid run of about half a minute." },

      { go: () => { $('#ask-q').value = ''; toTickets(); window.scrollTo({ top: 0, behavior: 'smooth' }); }, target: () => $('header'),
        say: "That's Ticket Intelligence. Tickets understood in minutes, a tested fix proposed, the right person informed, and the knowledge kept for next time. Thanks for watching." },
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
  let spot, bar, textEl, numEl, progEl, pauseBtn;

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
      numEl, Object.assign(document.createElement('span'), { className: 'spacer' }), voiceSel, rateSel, btn('✕ End', 'End the tour (Esc)', stop));
    bar.append(textEl, progEl, controls);
    document.body.append(spot, bar);
  }

  /** The spotlight follows its target on every frame (the page re-renders and scrolls under it). */
  function follow() {
    if (!running) return;
    let el = null;
    try { el = target?.(); } catch { /* gone */ }
    if (el && el.isConnected && el.offsetParent !== null) {
      const r = el.getBoundingClientRect();
      // Below the sticky header, unless the target is in the header itself.
      const top = (el.closest('header') ? r.top : Math.max(r.top, $('header').getBoundingClientRect().bottom + 4)) - 6;
      const bottom = Math.min(r.bottom, bar.getBoundingClientRect().top - 8) + 6;
      Object.assign(spot.style, { opacity: '1', top: `${top}px`, left: `${r.left - 6}px`, width: `${r.width + 12}px`, height: `${Math.max(24, bottom - top)}px` });
    } else {
      Object.assign(spot.style, { opacity: '1', top: '50%', left: '50%', width: '0px', height: '0px' });
    }
    requestAnimationFrame(follow);
  }

  /** Scrolls the target into the space between the sticky header and the caption bar. */
  function bringIntoView(el) {
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
      progEl.firstChild.style.width = `${Math.round(((i + 1) / steps.length) * 100)}%`;
      textEl.textContent = '…';
      try { await st.go?.(my); } catch { /* the step shows what it can */ }
      if (my !== token) return;
      target = st.target;
      if (!(await until(() => { const el = st.target(); return el && el.offsetParent !== null; }, 6000, my))) return;
      const el = st.target();
      if (!el || el.offsetParent === null) continue; // nothing to point at: skip this step
      bringIntoView(el);
      let text = '';
      try { text = typeof st.say === 'function' ? st.say() : st.say; } catch { continue; }
      textEl.textContent = text;
      await sleep(450);
      if (!(await say(text, my))) return;
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
    saved = { tab, project: selected, expanded: new Map([...tickets.values()].map((t) => [t.key, t.expanded])), scroll: window.scrollY };
    steps = buildSteps();
    play(0, 1);
  }

  function stop() {
    if (!running) return;
    running = false;
    token++;
    synth?.cancel();
    document.removeEventListener('keydown', onKey, true);
    spot?.remove();
    bar?.remove();
    target = null;
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
