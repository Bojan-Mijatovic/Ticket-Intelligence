import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// The dashboard's scripts run in the browser, as classic scripts: an early error (a name declared twice, a syntax
// error) stops the whole file, and the tests of agent/lib never load it. 2026-11-16: a second `reveal` in tour.js
// stopped the Tour and Present buttons, with every other test green.
const here = dirname(fileURLToPath(import.meta.url));
const dash = (f) => readFileSync(join(here, '..', 'dashboard', f), 'utf8');
const parses = (name, src) => {
  try {
    new Function(src); // parses the body as a script would be: early errors throw here
  } catch (e) {
    assert.fail(`${name}: ${e.message}`);
  }
};

test('the dashboard scripts parse as the browser parses them', () => {
  parses('tour.js', dash('tour.js'));
  parses('slides.js', dash('slides.js'));
  const inline = [...dash('index.html').matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(inline.length >= 1, 'the page has its inline script');
  inline.forEach((src, i) => parses(`index.html inline script ${i + 1}`, src));
});

test('a name declared twice is caught', () => {
  assert.throws(() => new Function('const reveal = 1;\nfunction reveal() {}'), /already been declared/);
});
