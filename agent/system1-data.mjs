#!/usr/bin/env node
// System 1 (docs/SYSTEM1_PLAN.md, J8a): the training and test data for the local decision model.
//
//   node agent/system1-data.mjs              writes state/system1/train.jsonl and test.jsonl
//   node agent/system1-data.mjs --out DIR    writes them to DIR instead (a check while a training run reads the others)
//
// Every question the model is asked in use is trained here, with the same words (lib/system1.mjs):
//   - intake (J1, J2): type, side, urgency, component and "needs code?" for the tickets of the projects with Insights
//     facts, read from Jira (masked, as a model reads them): type from the issue type, side from the [FE]/[BE] tag
//     (taken off the text), component from the files of their commits on main, urgency from the priority. Plus the
//     written tickets of demo/system1/written-tickets.json: the kinds the demo's Jira does not have;
//   - known issue (J4): which entry of the project's knowledge base on main a report describes, or none: each
//     documented ticket's own report, the reports of demo/system1/known-reworded.json, and none for the others. The
//     four LAB-8 sentences of J0 are only in the test set;
//   - intent (J5): the Ask questions of demo/system1/ask-intents.json, and the component of the "who" questions of
//     demo/system1/ask-components.json (until ft-2 the component was learnt from ticket texts only);
//   - privacy (J6): ticket sentences with synthetic patients (demo/lib/synthetic-patients.mjs), masked as in use. A
//     sentence is labelled "names a person" when a name it was given survives the masking, so the label is exact.
//     And the real ticket texts, masked the same way, with the labels a person gave (demo/system1/privacy-real.json);
//   - what the report tells (J7): what was done, what is wrong, where, where/when/which record, for the Jira tickets
//     a person labelled (demo/system1/completeness.json) and the written tickets (their `missing`).
// Tickets labelled system1-demo are never used: they are the shadow test (J1). Split 75/25 by a hash of each row's
// id, so a row stays on its side when rows are added (a nightly run with new tickets): with a split by position,
// every new row moved others, and the current checkpoint was then tested on rows it had been trained on.
// Train with agent/system1-train.mjs (agent/README.md, System 1).

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJira } from './lib/jira-actions.mjs';
import { loadProjects } from './lib/projects.mjs';
import {
  CODE_TYPES, NONE, completeLabels, componentOfFiles, entryOption, intentQuestion, knownEntries, knownQuestion, privacyQuestion, questionsFor,
  sideOfFiles, stateOf, strangersOnly, stripTags, urgencyOfPriority,
} from './lib/system1.mjs';
import { syntheticPatients } from '../demo/lib/synthetic-patients.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO = join(HERE, '..', 'demo', 'system1');
const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : join(HERE, 'state', 'system1');
const all = loadProjects(HERE);
const jira = createJira();
const readDemo = (f) => JSON.parse(readFileSync(join(DEMO, f), 'utf8'));

const TYPE_OF = { Bug: 'bug in code', Story: 'new requirement', Task: 'change request' };
const tagsOf = (s) => [...String(s).matchAll(/\[(FE|BE)\]/gi)].map((m) => m[1].toUpperCase()).concat(/^\s*(FE|BE)\s+-/i.test(s) ? [String(s).trim().slice(0, 2).toUpperCase()] : []);
const sideOf = (tags) => (tags.includes('FE') && tags.includes('BE') ? 'both' : tags.includes('FE') ? 'frontend' : tags.includes('BE') ? 'backend' : null);
const codeOf = (type) => (type ? (CODE_TYPES.has(type) ? 'needs code' : 'no code change') : null);

/** One row: the text, the questions, the answers we know (a question without a known answer is not trained). */
const row = (id, source, group, state, questions, expected) => {
  const known = Object.fromEntries(Object.entries(expected).filter(([, v]) => v));
  return { state, questions, expected: known, meta: { id, source, group } };
};

const entriesOf = new Map(all.projects.map((p) => [p.key, existsSync(p.repoDir) ? knownEntries(p.repoDir) : []]));
const projectOfKey = (key) => all.ofTicket(key);
const componentsOf = (p) => (p?.cfg.insights?.components ?? []).map((c) => c.name);

const rows = [];
const skipped = { gone: [], demo: [], noFacts: [], fromAnalyses: [] };
const completeness = readDemo('completeness.json').missing;

// ---- intake (+ known) from Jira
for (const p of all.projects) {
  const facts = join(p.stateDir, 'insights', 'review-facts.json');
  if (!existsSync(facts)) {
    skipped.noFacts.push(p.key);
    continue;
  }
  const entries = entriesOf.get(p.key);
  const tickets = JSON.parse(readFileSync(facts, 'utf8')).tickets ?? [];
  for (let i = 0; i < tickets.length; i += 5) {
    const batch = await Promise.all(tickets.slice(i, i + 5).map((t) => jira.getIssue(t.key).then((full) => ({ t, full }), (e) => {
      if (e.jiraStatus === 404) return skipped.gone.push(t.key), null; // deleted by a demo reset since the facts were written
      throw e;
    })));
    for (const { t, full } of batch.filter(Boolean)) {
      if (full.labels?.includes('system1-demo')) {
        skipped.demo.push(t.key);
        continue;
      }
      const type = TYPE_OF[t.type];
      const entry = entries.find((e) => e.key === t.key);
      const text = `${stripTags(full.summary)}\n\n${String(full.description ?? '').slice(0, 1500)}`.trim();
      const missing = completeness[t.key]; // J7, read by a person; a ticket not listed gets no such question
      rows.push(row(t.key, 'jira', type, text, questionsFor(componentsOf(p), entries, { complete: Boolean(missing) }), {
        type, side: sideOf(tagsOf(t.summary)), urgency: urgencyOfPriority(t.priority), component: t.components?.[0], code: codeOf(type),
        known: entries.length ? (entry ? entryOption(entry) : NONE) : null,
        ...(missing ? completeLabels(missing) : {}),
      }));
    }
  }
}

// ---- System 2 teaches System 1 (J8b): every other ticket with a saved Claude analysis (state/projects/<KEY>/results),
// labelled by it: side and component from the files it names (when its confidence is not low), the known issue from
// its "Already known?" (priorArt), type and urgency from Jira. The pilot's tickets come in this way (VAX has no
// Insights facts), one more example with every analysis.
const KNOWN_KINDS = new Set(['fixed-on-main', 'duplicate', 'regression', 'in-progress', 'solved-before']);
const inData = new Set(rows.map((r) => r.meta.id));
for (const p of all.projects) {
  const dir = join(p.stateDir, 'results');
  if (!existsSync(dir)) continue;
  const keys = readdirSync(dir).filter((f) => new RegExp(`^${p.key}-\\d+\\.json$`).test(f)).map((f) => f.slice(0, -5)).filter((k) => !inData.has(k) && !skipped.demo.includes(k));
  if (!keys.length) continue;
  // The whole project, not "key in (…)": that fails on a key a demo reset deleted.
  const meta = new Map((await jira.searchAll(`project = ${p.key}`, 2000)).map((i) => [i.key, i]));
  const entries = entriesOf.get(p.key);
  const rules = p.cfg.insights?.components ?? [];
  for (const key of keys) {
    const m = meta.get(key);
    if (!m) {
      skipped.gone.push(key);
      continue;
    }
    if (m.labels?.includes('system1-demo')) {
      skipped.demo.push(key);
      continue;
    }
    const saved = JSON.parse(readFileSync(join(dir, `${key}.json`), 'utf8')).result ?? {};
    const full = await jira.getIssue(key);
    const type = TYPE_OF[m.issueType];
    const sure = saved.confidence && saved.confidence !== 'low';
    const files = saved.files ?? [];
    const pa = saved.priorArt ?? {};
    // A ticket documented since its analysis (LAB-23) is its own entry; otherwise what the analysis found.
    const own = entries.find((e) => e.key === key);
    const entry = own ?? entries.find((e) => (pa.entry && pa.entry.endsWith(`#${e.anchor}`)) || (!pa.entry && pa.key === e.key));
    const known = !entries.length ? null : own || KNOWN_KINDS.has(pa.kind) ? (entry ? entryOption(entry) : null) : NONE;
    rows.push(row(key, 'analysis', type, stateOf(full), questionsFor(componentsOf(p), entries), {
      type, side: sure && CODE_TYPES.has(type) ? sideOfFiles(files) : null, urgency: urgencyOfPriority(m.priority), component: sure ? componentOfFiles(files, rules) : null,
      code: codeOf(type), known,
    }));
    skipped.fromAnalyses.push(key);
  }
}

// ---- intake (+ known: none) from the written tickets
// A half-written bug report (J7) is about code but may not tell its side or component: those are then not trained.
readDemo('written-tickets.json').tickets.forEach((t, i) => {
  const code = CODE_TYPES.has(t.type);
  const p = all.projects.find((x) => x.name === t.app);
  const components = code ? componentsOf(p) : [];
  if (code && t.component && !components.includes(t.component)) throw new Error(`written ticket ${i + 1}: ${t.component} is not a component of ${t.app}`);
  const entries = entriesOf.get(p.key);
  rows.push(row(`W-${i + 1}`, 'written', t.type, `${t.title}\n\n${t.description}`.trim(), questionsFor(components, entries, { complete: Array.isArray(t.missing) }), {
    type: t.type, side: code ? t.side : 'not code', urgency: t.urgency, component: code ? t.component : null, code: codeOf(t.type), known: entries.length ? NONE : null,
    ...(Array.isArray(t.missing) ? completeLabels(t.missing) : {}),
  }));
});

// ---- known issues in other words (J4)
readDemo('known-reworded.json').reports.forEach((r, i) => {
  const p = projectOfKey(r.key);
  const entries = entriesOf.get(p.key);
  const entry = entries.find((e) => e.key === r.key);
  if (!entry) throw new Error(`known-reworded ${i + 1}: ${r.key} is not an entry on ${p.name}'s main`);
  rows.push(row(`K-${i + 1}`, 'reworded', 'known', r.text, { known: knownQuestion(entries), code: questionsFor().code }, { known: entryOption(entry), code: 'needs code' }));
});

// ---- intent of an Ask question (J5), and the component of a "who" question (demo/system1/ask-components.json): the
// router answers without Claude only when it is sure of both. A question in both files is one row with both answers.
const askComponents = readDemo('ask-components.json').questions.map((x) => {
  const p = all.projects.find((y) => y.key === x.project);
  if (!componentsOf(p).includes(x.component)) throw new Error(`ask-components: ${x.component} is not a component of ${x.project}`);
  return { ...x, components: componentsOf(p) };
});
const askQuestions = (q, x) => (x ? { ...intentQuestion(), component: questionsFor(x.components).component } : intentQuestion());
readDemo('ask-intents.json').questions.forEach((q, i) => {
  const x = askComponents.find((y) => y.q === q.q);
  rows.push(row(`A-${i + 1}`, 'ask', q.intent, q.q, askQuestions(q, x), { intent: q.intent, component: x?.component }));
});
const intentTexts = new Set(readDemo('ask-intents.json').questions.map((q) => q.q));
askComponents.filter((x) => !intentTexts.has(x.q)).forEach((x, i) => rows.push(row(`AC-${i + 1}`, 'ask', 'who', x.q, askQuestions(null, x), { intent: 'who', component: x.component })));

// ---- privacy (J6): sentences with synthetic patients, masked as in use; the label is whether a name survived
const TEAM = ['Davide Greco', 'Sara Colombo', 'Marta Ricci', 'Luca Bianchi'];
const TEMPLATES = [
  (x) => `La paziente ${x.lastName} ${x.firstName} non compare nella lista delle scadenze di questa settimana.`,
  (x) => `Patient ${x.firstName} ${x.lastName} called: the second dose is not on the card.`,
  (x) => `Il signor ${x.lastName} chiede la ristampa della ricevuta di ieri.`,
  (x) => `${x.lastName.toUpperCase()} ${x.firstName.toUpperCase()} risulta due volte in anagrafica.`,
  () => 'Il paziente del letto 4 in Cardiologia non riceve la terapia prescritta.',
  (x) => `Codice fiscale ${x.fiscalCode}, telefono ${x.phone}: la prenotazione non si salva.`,
  (x, i) => `Lotto L-MF${2600 + i}, richiesta RL-2026-${String(i).padStart(5, '0')}: il referto non si stampa.`,
  (x, i) => `${TEAM[i % TEAM.length]} ha già corretto il problema per la paziente ${x.lastName} ${x.firstName}.`,
  (x) => `Mrs ${x.lastName} (health card ${x.healthCard}) cannot see her results.`,
  (x) => `A patient born on ${x.birthDate.split('-').reverse().join('/')} cannot be found by the search.`,
];
const patients = syntheticPatients(TEMPLATES.length * 24, { seed: 777, rareShare: 0.5 });
patients.forEach((x, i) => {
  const raw = TEMPLATES[i % TEMPLATES.length](x, i);
  const masked = strangersOnly(raw);
  const tokens = `${x.lastName} ${x.firstName}`.split(/\s+/).filter((w) => w.length > 2);
  const left = tokens.some((w) => new RegExp(`(^|[^\\p{L}])${w}([^\\p{L}]|$)`, 'iu').test(masked) && raw.toLowerCase().includes(w.toLowerCase()));
  const label = left ? 'names a person' : 'no person';
  // A template with no patient field ("the patient of bed 4"), or a surname drawn twice, gives the same text again:
  // it is kept once, so the same sentence is never both trained on and tested (ft-2's test had 6 such rows).
  if (rows.some((r) => r.meta.source === 'privacy' && r.state === masked)) return;
  rows.push(row(`P-${i + 1}`, 'privacy', label, masked, privacyQuestion(), { privacy: label }));
});
// Real ticket texts, checked by hand (demo/system1/privacy-real.json): trained on synthetic sentences alone, ft-2
// held a quarter of the real tickets that name nobody. Only the listed Jira tickets and the written ones are used,
// each on the same side of the split as its ticket (below), so a tested text was never read in training.
const real = readDemo('privacy-real.json');
const realLabel = (id) => (real.namesAPerson.includes(id) ? 'names a person' : real.noPerson.includes(id) || id.startsWith('W-') ? 'no person' : null);
const realRows = (rs) => rs.filter((x) => ['jira', 'written'].includes(x.meta.source) && realLabel(x.meta.id))
  .map((x) => row(`PR-${x.meta.id}`, 'privacy-real', realLabel(x.meta.id), strangersOnly(x.state), privacyQuestion(), { privacy: realLabel(x.meta.id) }));

// ---- split: 75/25 by a hash of the row (a Jira ticket by its key, any other row by its source and text), so a row
// keeps its side whatever is added or removed around it (FNV-1a, 32 bits)
const fnv = (s) => [...String(s)].reduce((h, c) => Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0, 2166136261);
const isTest = (r) => fnv(['jira', 'analysis'].includes(r.meta.source) ? r.meta.id : `${r.meta.source}|${r.state}`) % 4 === 0;
const train = rows.filter((r) => !isTest(r));
const test = rows.filter(isTest);
const realTrain = realRows(train);
const realTest = realRows(test);
train.push(...realTrain);
test.push(...realTest);
rows.push(...realTrain, ...realTest);
// A text in both (e.g. one Ask question in two files) is tested only if it was never trained on.
const trained = new Set(train.map((r) => r.state));
const overlap = test.filter((r) => trained.has(r.state));
if (overlap.length) test.splice(0, test.length, ...test.filter((r) => !trained.has(r.state)));
// LAB-8 in other words (J0): only ever a test, never trained on.
const lab = all.byKey('LAB');
const lab8 = entriesOf.get('LAB').find((e) => e.key === 'LAB-8');
if (lab8) {
  for (const [name, text] of Object.entries({
    'IT, own words': "Signora in reparto: l'emoglobina a 12,4 esce in rosso come bassa, ma per una donna e' normale. Anche nel referto c'e' la scala degli uomini.",
    'IT, close to the terms': 'Risultato segnalato basso per una donna: il range di riferimento e quello maschile',
    'EN, own words': 'Hemoglobin of 12.4 for a lady shows red as too low on the report, the scale printed is the one for men',
    'SR, own words': 'Pacijentkinji je hemoglobin 12,4 označen kao nizak, a na nalazu stoji muški opseg',
  })) test.push(row(`LAB-8 ${name}`, 'lab8', 'known', text, { known: knownQuestion(entriesOf.get(lab.key)) }, { known: entryOption(lab8) }));
}

mkdirSync(OUT, { recursive: true });
const jsonl = (rs) => `${rs.map((r) => JSON.stringify(r)).join('\n')}\n`;
writeFileSync(join(OUT, 'train.jsonl'), jsonl(train));
writeFileSync(join(OUT, 'test.jsonl'), jsonl(test));
const items = (rs) => rs.reduce((n, r) => n + Object.keys(r.expected).length, 0);
const bySource = (rs) => rs.reduce((m, r) => ((m[r.meta.source] = (m[r.meta.source] ?? 0) + 1), m), {});
const perQuestion = (rs) => rs.reduce((m, r) => { for (const q of Object.keys(r.expected)) m[q] = (m[q] ?? 0) + 1; return m; }, {});
console.log(`train ${train.length} rows, ${items(train)} labelled questions`, bySource(train), perQuestion(train));
console.log(`test  ${test.length} rows, ${items(test)} labelled questions`, bySource(test), perQuestion(test));
const priv = rows.filter((r) => r.meta.source === 'privacy');
console.log(`privacy rows: ${priv.filter((r) => r.expected.privacy === 'names a person').length} still name a person after the masking, ${priv.filter((r) => r.expected.privacy === 'no person').length} do not`);
console.log(`real ticket texts for privacy: train ${realTrain.length} (${realTrain.filter((r) => r.expected.privacy === 'names a person').map((r) => r.meta.id).join(' ') || 'none'} name a person), test ${realTest.length} (${realTest.filter((r) => r.expected.privacy === 'names a person').map((r) => r.meta.id).join(' ') || 'none'})`);
console.log(`known issues on main: ${[...entriesOf].map(([k, e]) => `${k} ${e.length}`).join(', ')}`);
if (overlap.length) console.log(`left out of the test, also in training: ${overlap.map((r) => r.meta.id).join(' ')}`);
if (skipped.fromAnalyses.length) console.log(`labelled by their Claude analysis (System 2 teaches System 1): ${skipped.fromAnalyses.join(' ')}`);
if (skipped.gone.length) console.log(`left out, no longer in Jira: ${skipped.gone.join(' ')}`);
if (skipped.demo.length) console.log(`left out, the shadow test (system1-demo): ${skipped.demo.join(' ')}`);
if (skipped.noFacts.length) console.log(`projects without Insights facts (open Insights once): ${skipped.noFacts.join(' ')}`);
console.log(`→ ${join(OUT, 'train.jsonl')}, test.jsonl`);
