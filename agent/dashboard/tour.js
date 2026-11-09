// Guided tour of the dashboard. The page drives itself: a cursor moves and clicks the tabs and controls, a spotlight
// shows each part, and a voice narrates in English (the browser's own speech synthesis), with captions.
//
// When no ticket has been analyzed since the last reset, the tour replays the best recorded run of the agent from the
// event logs (/api/tour/replay): the ticket arrives, the steps stream in, the analysis, the reproduction, the fix, the
// pull request and the review appear one after the other, sped up, with the real timings. The card says REPLAY.
//
// Read-only: it never starts an agent run, an Ask question, a review or a recommendation. A replay lives only in this
// page and is removed when the tour ends.
//
// Start it with the ▶ Tour button in the header, or open the dashboard with ?tour (a click is still needed: browsers
// do not let a page speak before the person has clicked on it). It uses the dashboard's own globals (tickets, status,
// showTab, selectProject, apply, render, …): top-level let/const of the page's script are visible to this script too.

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
    #tour-bar { position: fixed; z-index: 61; left: 50%; bottom: 18px; transform: translateX(-50%); width: min(920px, calc(100vw - 32px));
      background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 14px; padding: 14px 16px 12px;
      box-shadow: 0 10px 30px rgb(0 0 0 / 0.25); display: grid; gap: 10px; }
    #tour-bar .tt { font-size: 16px; line-height: 1.5; min-height: 48px; }
    #tour-bar .tc { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    #tour-bar .tc select { font: inherit; font-size: 12px; padding: 4px 6px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); max-width: 220px; }
    #tour-bar .tn { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
    #tour-bar .tp { height: 3px; border-radius: 2px; background: var(--surface-2); overflow: hidden; }
    #tour-bar .tp i { display: block; height: 100%; background: var(--accent); transition: width .4s; }
    .tour-replay { font-size: 11px; font-weight: 800; letter-spacing: .06em; padding: 1px 8px; border-radius: 999px; background: var(--warn-soft); color: var(--warn); white-space: nowrap; }
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
  /** Without the "(commit …, DEM-14, …)" asides, which make captions long and the voice read hashes. */
  const noParens = (s) => String(s ?? '').replace(/\s*\([^()]*\)/g, '').replace(/\s+([.,;:])/g, '$1');
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const duration = (secs) => (secs < 90 ? `${secs} seconds` : `about ${plural(Math.round(secs / 60), 'minute')}`);
  /** A ticket title without its "[BE][FE] - " prefix. */
  const plainTitle = (s) => String(s ?? '').replace(/^(\s*\[[^\]]+\])+\s*-?\s*/, '');
  const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
  const longDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  /** What the voice reads: ticket keys letter by letter, a file by its name, no commit hashes, no symbols. */
  const speakable = (s) => String(s)
    .replace(/[\w./\\-]+\.(java|ts|tsx|js|mjs|html|scss|css|xml|sql|json|properties|ya?ml)(:\d+(-\d+)?)?\b/g,
      (m) => m.replace(/:\d+(-\d+)?$/, '').split(/[/\\]/).pop().replace(/\.\w+$/, '').replace(/[._-]+/g, ' '))
    .replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g, 'a commit')
    .replace(/\b([A-Z]{2,})-(\d+)\b/g, (_, p, n) => `${p.split('').join(' ')} ${n}`)
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
  const shown = (el) => Boolean(el && el.isConnected && el.offsetParent !== null);

  // Dashboard elements the steps point at. They are looked up again on every frame: the page re-renders often.
  const ticketEl = (key) => [...document.querySelectorAll('#tickets .ticket')].find((el) => el.querySelector('.t-key')?.textContent === key) ?? null;
  const rowOf = (key, label) => [...(ticketEl(key)?.querySelectorAll('.result .row') ?? [])].find((r) => r.querySelector('.k')?.textContent === label) ?? null;
  const boxOf = (key, icon) => [...(ticketEl(key)?.querySelectorAll('.fix') ?? [])].find((f) => f.querySelector('.fix-title')?.textContent.startsWith(icon)) ?? null;
  const sectionOf = (id) => { const el = document.getElementById(id); return shown(el) && !el.hidden ? el : null; };
  const hasContent = (id) => { const el = sectionOf(id); return el && el.children.length && !(el.children.length === 1 && el.firstElementChild.classList.contains('empty')); };
  const tabBtn = (name) => document.querySelector(`#tabs button[data-tab="${name}"]`);

  // ------------------------------------------------------------------ cursor
  let cursor = null;
  let cursorAt = null;
  function cursorUi() {
    cursor = Object.assign(document.createElement('div'), { id: 'tour-cursor' });
    cursor.innerHTML = '<span class="ring"></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 2l15 9.5-6.6 1.3 3.9 7.4-2.9 1.5-3.9-7.4L4 19z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.append(cursor);
    cursorAt = { x: innerWidth / 2, y: innerHeight / 2 };
    cursor.style.transform = `translate(${cursorAt.x}px, ${cursorAt.y}px)`;
  }
  /** Glides the cursor to an element (or its point `at`, 0..1 of its box). */
  async function moveTo(el, my, at = { x: 0.5, y: 0.5 }) {
    if (!cursor || !shown(el)) return false;
    const r = el.getBoundingClientRect();
    cursorAt = { x: r.left + r.width * at.x, y: r.top + r.height * at.y };
    cursor.classList.add('on');
    cursor.style.transform = `translate(${cursorAt.x}px, ${cursorAt.y}px)`;
    return until(() => false, 850, my);
  }
  /** Moves to an element and clicks it, with a visible click. */
  async function clickOn(el, my) {
    if (!(await moveTo(el, my))) return false;
    cursor.classList.remove('click');
    void cursor.offsetWidth; // restart the animation
    cursor.classList.add('click');
    await sleep(180);
    if (my !== token) return false;
    el.click();
    return until(() => false, 350, my);
  }
  async function pickProject(key, my) {
    if (selected === key) return true;
    await moveTo($('#project-sel'), my);
    if (my !== token) return false;
    cursor?.classList.add('click');
    selectProject(key);
    await sleep(300);
    cursor?.classList.remove('click');
    return my === token;
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

  // ------------------------------------------------------------------ replay of a recorded run
  let rp = null; // { key, recordedAt, events, i, shift }
  /** Applies the recorded events up to (and including) the first one of `type`, at a sped-up pace. */
  async function playTo(type, my) {
    if (!rp) return true;
    if (rp.shift == null) rp.shift = Date.now() - Date.parse(rp.events[0].at);
    while (rp.i < rp.events.length) {
      if (my !== token) return false;
      const e = rp.events[rp.i];
      const prev = rp.events[rp.i - 1];
      if (prev) await sleep(Math.min(1300, Math.max(110, (Date.parse(e.at) - Date.parse(prev.at)) * 0.05)));
      if (my !== token) return false;
      apply({ ...e, at: new Date(Date.parse(e.at) + rp.shift).toISOString() });
      if (e.type === 'picked') tickets.get(rp.key).expanded = true; // keep the steps visible when it is done
      rp.i++;
      render();
      if (e.type === type) return true;
    }
    return true;
  }
  function removeReplay() {
    if (!rp) return;
    tickets.delete(rp.key);
    for (const arr of [teams, drafts]) for (let i = arr.length - 1; i >= 0; i--) if (arr[i].key === rp.key) arr.splice(i, 1);
    rp = null;
    render();
  }

  // ------------------------------------------------------------------ the script
  /** The steps, built from what the dashboard has now: a real ticket (live or a recorded run), a real project, real numbers. */
  function buildSteps() {
    const analyzed = [...tickets.values()].filter((t) => t.result);
    const live = analyzed.find((t) => t.fix?.stage === 'done' && t.review?.stage === 'done')
      ?? analyzed.find((t) => t.fix?.stage === 'done')
      ?? analyzed.find((t) => t.state === 'done')
      ?? analyzed[0] ?? null;
    const key = live?.key ?? rp?.key ?? null;
    const T = () => tickets.get(key);
    const R = () => T()?.result;
    /** Whether the ticket went through `type` (in the replay: will go through it). */
    const did = (type) => (rp ? rp.events : T()?.steps ?? []).some((e) => e.type === type);
    const firstOf = (type) => (rp ? rp.events : T()?.steps ?? []).find((e) => e.type === type);
    const ready = projects().filter((p) => p.ready);
    const proj = (key && projectInfo(projOf(key))) ?? focus() ?? ready[0] ?? null;
    const pollSecs = status?.lastPoll && status?.nextPoll ? Math.round((Date.parse(status.nextPoll) - Date.parse(status.lastPoll)) / 1000) : null;
    const d = () => (insightsData && insightsFor === proj?.key ? insightsData : null);
    const toTickets = async (my) => { await openTab('tickets', my); if (key && !visible(key)) await pickProject('all', my); };
    const toInsights = async (my) => { await openTab('insights', my); if (proj) await pickProject(proj.key, my); };
    const side = () => firstOf('reproducing')?.side ?? T()?.fix?.side ?? 'frontend';

    return [
      { target: () => $('.brand'),
        say: "Hi. Let me show you Ticket Intelligence: an agent that reads every new Jira ticket, finds the code behind it, and gets the problem to the right person, with evidence. Nothing I show here costs money or changes anything." },
      { target: () => $('#state'), go: (my) => moveTo($('#state'), my),
        say: `This light shows that the agent is live. It checks Jira on its own${pollSecs > 0 ? `, about every ${pollSecs < 90 ? `${pollSecs} seconds` : `${Math.round(pollSecs / 60)} minutes`}` : ''}. Nobody has to start it: a new ticket is picked up and analyzed by itself.` },
      { when: () => projects().length > 0, target: () => $('.project-pick'), go: (my) => moveTo($('#project-sel'), my),
        say: () => `It watches ${projects().length === 1 ? 'one application' : `${projects().length} applications of the suite`}: ${list(projects().map((p) => p.name))}. Here you pick one project, or see all of them together.` },
      { go: toTickets, target: () => $('#tab-tickets .kpis'),
        say: () => {
          const done = Number($('#k-done').textContent) || 0;
          const time = $('#k-time').textContent;
          return done && !rp
            ? `The top row counts the work: ${plural(done, 'ticket')} analyzed with no human start${time !== '–' ? `, in ${duration(parseInt(time, 10)).replace(/^about /, '')} on average` : ''}, owners notified, and escalations flagged by the rules.`
            : 'The top row counts the work: tickets analyzed with no human start, the average time to an analysis, owners notified, and escalations flagged by the rules.';
        } },

      // One ticket, from Jira to a pull request: live, or a recorded run replayed.
      { when: () => !key, target: () => $('#tickets'),
        say: "Each new ticket appears here as a card, and you can watch the agent's steps live, with timings. There is no analyzed ticket yet, so let's move on." },
      { when: () => key && rp, go: async (my) => { await toTickets(my); await playTo('picked', my); }, target: () => ticketEl(key)?.querySelector('.t-head'),
        say: () => `Now the main part. Someone opens a ticket in Jira: ${key}, ${plainTitle(rp.events.find((e) => e.type === 'queued' || e.type === 'picked')?.text)}. I'll replay a real run of the agent on it, recorded on ${longDate(rp.recordedAt)}, sped up. The seconds you see are the real ones.` },
      { when: () => key && rp, play: 'analyzed', target: () => ticketEl(key)?.querySelector('.steps') ?? ticketEl(key),
        say: "Nobody starts it. The agent picks the ticket up, reads it, searches for related tickets, then searches the code and its history. Every step shows up here, live." },
      { when: () => key && !rp, go: async (my) => { await toTickets(my); T().expanded = true; render(); }, target: () => ticketEl(key)?.querySelector('.t-head'),
        say: () => `Let's open one real ticket: ${key}. ${firstSentence(plainTitle(T().title), 160)}` },
      { when: () => key && !rp && T()?.steps?.length, target: () => ticketEl(key)?.querySelector('.steps'),
        say: () => `These are the ${T().steps.length} steps the agent took, with the second each one happened: it read the ticket, searched for related tickets, then searched the code and its history.${T().totalMs ? ` The whole run took ${duration(Math.round(T().totalMs / 1000))}.` : ''}` },
      { when: () => R(), target: () => rowOf(key, 'Likely cause'),
        say: () => `${rp ? `In ${duration(Math.round((Date.parse(firstOf('analyzed').at) - Date.parse(firstOf('picked').at)) / 1000))}, it` : 'It'} explains the problem and the likely cause, with its confidence. Here, with ${R().confidence} confidence: ${firstSentence(noParens(R().likelyCause))}` },
      { when: () => R()?.files?.length, target: () => rowOf(key, 'Where'),
        say: () => `It points to the exact ${R().files.length === 1 ? 'file' : 'files'} in the code, so a developer does not start from zero.` },
      { when: () => R()?.owner?.name, target: () => rowOf(key, 'Owner'),
        say: () => `And it says who should handle it: ${R().owner.name}. ${firstSentence(noParens(R().owner.why), 180)}` },
      { when: () => R()?.nextSteps?.length, target: () => rowOf(key, 'Next steps'),
        say: "It lists the next steps, and it has already posted all of this as a comment in Jira, where the team works anyway." },
      { when: () => did('notified'), go: (my) => moveTo($('#teams'), my, { x: 0.5, y: 0.3 }), target: () => $('#teams')?.closest('.panel'),
        say: () => `At the same moment, ${R()?.owner?.name ?? 'the owner'} gets a handoff message with the context: in Microsoft Teams, or here in the simulated channel. The right person knows, without a meeting.` },
      { when: () => did('draft'), target: () => $('#drafts')?.closest('.panel'),
        say: "What the agent may do on its own is a policy, shown at the bottom. Anything customer-facing, like a reply to the reporter or an assignment, waits here as a draft until a person approves it." },
      { when: () => did('reproduced'), play: 'reproduced', go: (my) => (rp ? moveTo(ticketEl(key), my, { x: 0.3, y: 0.8 }) : true), target: () => boxOf(key, '🛠') ?? ticketEl(key),
        say: () => `Then it goes further. It writes a ${side() === 'backend' ? 'backend test' : 'browser test'} from the steps in the ticket and runs it against the real app. The test fails on the current code: the bug is reproduced, with proof.` },
      { when: () => did('fix-proposed'), play: 'fix-proposed', target: () => boxOf(key, '🛠') ?? ticketEl(key),
        say: "Now it fixes the code. Then the watcher, not the agent, runs every check again on its own: the tests, the build, the backend. Only with real evidence does it open a draft pull request.",
        after: (my) => moveTo(ticketEl(key)?.querySelector('.pr-link'), my) },
      { when: () => T()?.fix?.before && T()?.fix?.after, target: () => ticketEl(key)?.querySelector('.shots'),
        say: "The screenshots before and after the fix are the evidence: the bug in the real app, and the same screen fixed." },
      { when: () => did('reviewed'), go: (my) => playTo('reviewed', my), target: () => boxOf(key, '🧐'),
        say: () => `A second agent then reviews the pull request, like a colleague would. It rated the risk ${T()?.review?.risk ?? 'low'}, and checked that the test really covers the bug. Merging is always a human decision.` },
      { when: () => did('documented'), go: (my) => playTo('documented', my), target: () => boxOf(key, '📚'),
        say: "And when the ticket is closed in Jira, the agent writes what was learned into the project's knowledge base: the cause, the fix and how to check it. Next time a similar bug comes in, the answer is already there." },
      { when: () => rp, go: (my) => playTo('', my), target: () => ticketEl(key),
        say: () => `So, from the ticket in Jira to a reviewed pull request: ${duration(Math.round(((Date.parse(firstOf('reviewed')?.at ?? firstOf('done')?.at ?? rp.events.at(-1).at)) - Date.parse(firstOf('picked').at)) / 1000))}, and nobody had to start it.` },

      // Insights
      { when: () => ready.length > 1,
        go: async (my) => { await openTab('insights', my); await pickProject('all', my); await until(() => hasContent('suite-apps') && !$('#suite-apps').textContent.includes('Loading'), 20000, my); },
        target: () => sectionOf('ins-suite'),
        say: "The second tab is Insights. With several applications, it first shows the whole suite: every app side by side, how they call each other, and bugs whose cause sits in another app." },
      { when: () => proj, go: async (my) => { await toInsights(my); await until(() => d() && !$('#ins-body').hidden, 25000, my); }, target: () => sectionOf('ins-kpis'),
        say: () => `Now one application: ${proj.name}. Insights read the whole history: Jira, git and the agent's analyses.${d() ? ` ${plural(d().totals.bugs, 'bug')} so far, ${d().totals.openBugs} still open, across ${plural(d().totals.commits, 'commit')}.` : ''}` },
      { when: () => proj, target: () => $('#ins-heat')?.closest('.panel'),
        say: "This map shows bugs per component and month. The darker the cell, the more bugs." },
      { when: () => document.querySelector('#ins-heat .hc.clickable'),
        go: async (my) => {
          const cells = [...document.querySelectorAll('#ins-heat .hc.clickable')];
          const top = cells.reduce((a, b) => ((parseInt(b.textContent, 10) || 0) > (parseInt(a.textContent, 10) || 0) ? b : a), cells[0]);
          bringIntoView(top.closest('.panel'));
          await sleep(500);
          await clickOn(top, my);
        },
        target: () => sectionOf('ins-tickets'),
        say: "One click on a cell lists the tickets behind the number, with their dates and links to Jira." },
      { when: () => d()?.hotspots?.length, target: () => sectionOf('ins-hotspots'),
        say: () => { const c = d().components.find((x) => x.name === d().hotspots[0]); return `The top hotspot is ${d().hotspots[0]}${c ? `, with ${plural(c.bugs, 'bug')}` : ''}. For each hotspot you see the files fixed more than once, and the AI can write a recommendation, citing tickets and commits.`; } },
      { when: () => proj, target: () => $('#ins-review')?.parentElement, go: (my) => moveTo($('#ins-review'), my),
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
      { when: () => proj, go: async (my) => { await openTab('ask', my); await until(() => !$('#ask-form').hidden, 5000, my); }, target: () => $('#ask-form'),
        say: "The last tab is Ask. Anyone, from support to project managers, can ask the knowledge base a question in plain English." },
      { when: () => proj, target: () => $('#ask-form'),
        go: async (my) => {
          const q = proj.askExamples?.[0] ?? 'Has this bug happened before?';
          const box = $('#ask-q');
          await clickOn(box, my);
          box.value = '';
          for (const ch of q) { if (my !== token) return; box.value += ch; await sleep(30); }
          await moveTo($('#ask-go'), my);
        },
        say: "The answer comes only from Jira, the agent's analyses, the git history and the code, and every claim cites its source. If the answer is not there, it says so, instead of guessing. I won't press Ask now: each question is a short paid run of about half a minute." },

      { go: async (my) => { $('#ask-q').value = ''; await openTab('tickets', my); window.scrollTo({ top: 0, behavior: 'smooth' }); }, target: () => $('header'),
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
    cursorUi();
  }

  /** Every frame: the spotlight follows its target (the page re-renders and scrolls under it); a replayed card says REPLAY. */
  function follow() {
    if (!running) return;
    let el = null;
    try { el = target?.(); } catch { /* gone */ }
    if (shown(el)) {
      const r = el.getBoundingClientRect();
      // Below the sticky header, unless the target is in the header itself.
      const top = (el.closest('header') ? r.top : Math.max(r.top, $('header').getBoundingClientRect().bottom + 4)) - 6;
      const bottom = Math.min(r.bottom, bar.getBoundingClientRect().top - 8) + 6;
      Object.assign(spot.style, { top: `${top}px`, left: `${r.left - 6}px`, width: `${r.width + 12}px`, height: `${Math.max(24, bottom - top)}px` });
    } else {
      Object.assign(spot.style, { top: '50%', left: '50%', width: '0px', height: '0px' });
    }
    if (rp) {
      const head = ticketEl(rp.key)?.querySelector('.t-head');
      if (head && !head.querySelector('.tour-replay')) {
        head.append(Object.assign(document.createElement('span'), { className: 'tour-replay', textContent: `REPLAY · ${longDate(rp.recordedAt)}`, title: 'A recorded run of the agent, replayed by the tour (only in this page)' }));
      }
    }
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
      progEl.firstChild.style.width = `${Math.round(((i + 1) / steps.length) * 100)}%`;
      textEl.textContent = '…';
      try { await st.go?.(my); } catch { /* the step shows what it can */ }
      if (my !== token) return;
      target = st.target;
      // A replay step: the recorded events play while the voice explains them.
      const playing = st.play ? playTo(st.play, my) : null;
      if (!(await until(() => shown(st.target()), 8000, my))) return;
      const el = st.target();
      if (!shown(el)) { if (playing) await playing; continue; } // nothing to point at: skip this step
      bringIntoView(el);
      let text = '';
      try { text = typeof st.say === 'function' ? st.say() : st.say; } catch { continue; }
      textEl.textContent = text;
      await sleep(450);
      if (!(await say(text, my))) return;
      if (playing) { if (!(await playing)) return; bringIntoView(st.target()); }
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
    // No analyzed ticket on the dashboard: replay the best recorded run (a ticket shown live is never replaced).
    if (![...tickets.values()].some((t) => t.result)) {
      try {
        const res = await fetch('/api/tour/replay');
        const run = res.ok ? await res.json() : null;
        if (run?.events?.length && !tickets.has(run.key)) rp = { ...run, i: 0, shift: null };
      } catch { /* the tour goes on without the ticket part */ }
    }
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
    target = null;
    removeReplay();
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
