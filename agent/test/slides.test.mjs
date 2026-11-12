import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// slides.js is a browser script: run it with a window of its own and read what it defines.
const here = dirname(fileURLToPath(import.meta.url));
const window = {};
vm.runInNewContext(readFileSync(join(here, '..', 'dashboard', 'slides.js'), 'utf8'), { window });
const { slides, deck } = window.TourSlides;

const cases = [
  { key: 'DEM-36', app: 'MediAgenda', title: 'Pazienti: the birth date is <saved> one day earlier', analyzeSecs: 92, totalSecs: 341, reproduced: true, fixed: true, side: 'frontend', risk: 'low', cross: null, fixIn: null, cost: 0.59 },
  { key: 'FAR-19', app: 'MediFarma', title: 'No renal warning for metformin', analyzeSecs: 100, totalSecs: 321, reproduced: true, fixed: true, side: 'backend', risk: 'low', cross: 'MediLab', fixIn: 'MediFarma', cost: 0.16 },
];
const apps = [
  { key: 'DEM', name: 'MediAgenda', role: 'CUP booking', linked: [] },
  { key: 'LAB', name: 'MediLab', role: 'Laboratory', linked: ['DEM'] },
];
const ctx = (mode) => ({ mode, full: true, deck: { presenter: 'A. Presenter', team: '', contact: 'example.org' }, apps, cases });
// The captions-only pace of the tour (tour.js, say()): 2.6 words a second and a short pause per step.
const seconds = (steps) => steps.reduce((s, st) => s + st.say.split(/\s+/).length / 2.6 + 1.2, 0);

test('a presentation: slides before and after the demo, then backup Q&A that only → reaches', () => {
  const d = deck(ctx('present'));
  assert.deepEqual(Array.from(d.intro, (s) => s.slide), ['title', 'problem', 'goals', 'pipeline', 'ai', 'setup', 'preview']);
  assert.deepEqual(Array.from(d.outro, (s) => s.slide), ['recap', 'results', 'built', 'tech', 'limits', 'sources', 'thanks']);
  assert.ok(d.intro.every((s) => s.part === 1) && d.outro.every((s) => s.part === 3));
  assert.equal(d.outro.at(-1).hold, true, 'it stays on the last slide');
  assert.ok(d.backup.length >= 4 && d.backup.every((s) => s.backup && s.hold && s.silent));
});

test('every slide a step names exists and renders, with the page data escaped', () => {
  for (const mode of ['present', 'deck']) {
    const d = deck(ctx(mode));
    for (const st of [...d.intro, ...d.outro, ...d.backup]) {
      assert.equal(typeof slides[st.slide], 'function', `slide ${st.slide}`);
      const html = slides[st.slide](ctx(mode));
      assert.ok(html.length > 50);
      assert.ok(!html.includes('<saved>'), `${st.slide} escapes ticket titles`);
    }
  }
  for (const name of ['problem', 'pipeline', 'ai', 'work', 'built']) assert.ok(slides[name]({ full: false }).includes('data-r'), `${name} still works over the dashboard (?tour)`);
});

test('the slides alone (?deck) skip the bridge into the demo and do not say "you just saw"', () => {
  const d = deck(ctx('deck'));
  assert.ok(!d.intro.some((s) => s.slide === 'preview'));
  assert.ok(!d.outro[0].say.includes('just saw'));
  assert.match(deck(ctx('present')).outro[0].say, /just saw: DEM-36 went from Jira to a reviewed pull request in about 6 minutes/);
});

test('the recap names the cases and their real numbers', () => {
  const html = slides.recap(ctx('present'));
  for (const s of ['DEM-36', 'after 1 min 32 s', 'Cause in MediLab', 'fix belongs in MediFarma', 'JUnit', 'risk low', '5 min 41 s<br>nobody started it']) assert.ok(html.includes(s), s);
});

test('the slides fit the time: about 3 minutes before the demo, under 3 after it', () => {
  const d = deck(ctx('present'));
  const before = seconds(d.intro);
  const after = seconds(d.outro);
  assert.ok(before <= 200, `before the demo: ${Math.round(before)} s`);
  assert.ok(after <= 175, `after the demo: ${Math.round(after)} s`);
});
