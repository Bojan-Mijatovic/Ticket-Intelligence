import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRedactor, peopleOfIssue, redactIssue, redactionEnabled } from '../../.claude/skills/analyze-ticket/scripts/lib/redact.mjs';

test('identifiers are masked, the same value always with the same placeholder', () => {
  const r = createRedactor();
  const out = r.text('Marino Paolo (MRNPLA61S03C351V), nato il 03/11/1961, tel. 333 1234567, mail paolo.marino@gmail.com, IBAN IT60X0542811101000000123456. Again MRNPLA61S03C351V and Paolo Marino.');
  assert.equal(out, '[PERSON_1] ([FISCAL_CODE_1]), [BIRTH_DATE_1], tel. [PHONE_1], mail [EMAIL_1], IBAN [IBAN_1]. Again [FISCAL_CODE_1] and [PERSON_1].');
  assert.deepEqual(r.stats(), { FISCAL_CODE: 1, IBAN: 1, EMAIL: 1, PHONE: 1, BIRTH_DATE: 1, PERSON: 1 });
});

test('the team stays readable: allow-list in either order, also when added later', () => {
  const r = createRedactor({ allow: ['Sara Colombo'] });
  assert.equal(r.text('Sara Colombo fixed it; Colombo Sara reviewed; the patient Costa Andrea called.'), 'Sara Colombo fixed it; Colombo Sara reviewed; the patient [PERSON_1] called.');
  r.allow(['Elena Conti']);
  assert.equal(r.text('Verified by Elena Conti on SVIL.'), 'Verified by Elena Conti on SVIL.');
});

test('no false alarms on what an analysis needs: codes, amounts, dates, values, screens', () => {
  const r = createRedactor();
  const text = 'PR-2026-00590 on 17/11/2026 at 14:10, co-pay 3,3899999999999997 €, 22,50 €, creatinine 2,50 mg/dL, eGFR 269, RL-2026-00058, SVIL_MS_VISITE, Nuova Prenotazione, Report Incassi, Agenda Search, CA_CARDIOLOGIA, build of 2026-11-03, commit a427822, noreply@anthropic.com';
  assert.equal(r.text(text), text);
});

test('names: a first name next to another capitalised word; one-word or upper-case names are a known limit', () => {
  const r = createRedactor();
  assert.equal(r.text('Dr.ssa Anna Ferri signed; Giulia Ferrari and Ferrari Giulia are the same person.'), 'Dr.ssa [PERSON_1] signed; [PERSON_2] and [PERSON_2] are the same person.');
  assert.equal(r.text('ANDREA COSTA called; Andrea called.'), 'ANDREA COSTA called; Andrea called.');
});

test('a normalized issue: free text masked, people fields kept; off by environment', () => {
  const issue = { key: 'FAR-13', summary: 'Bianchi Laura gets a renal warning', description: 'MRNPLA61S03C351V', reporter: { name: 'Bojan Mijatovic' }, comments: [{ author: { name: 'Valentina Rinaldi' }, body: 'Checked for Bianchi Laura' }], worklogs: [], links: [{ key: 'FAR-11', summary: 'Renal dose check' }], changelog: [{ author: { name: 'Bojan Mijatovic' }, items: [{ field: 'status', from: 'To Do', to: 'Done' }] }] };
  const r = createRedactor({ allow: peopleOfIssue(issue) });
  const out = redactIssue(issue, r);
  assert.equal(out.summary, '[PERSON_1] gets a renal warning');
  assert.equal(out.description, '[FISCAL_CODE_1]');
  assert.equal(out.comments[0].body, 'Checked for [PERSON_1]');
  assert.equal(out.comments[0].author.name, 'Valentina Rinaldi');
  assert.equal(out.changelog[0].items[0].to, 'Done');
  assert.deepEqual(peopleOfIssue(issue), ['Bojan Mijatovic', 'Valentina Rinaldi', 'Bojan Mijatovic']);
  assert.equal(redactionEnabled({}, { TICKET_INTEL_REDACTION: 'off' }), false);
  assert.equal(redactionEnabled({ redaction: { enabled: false } }, {}), false);
  assert.equal(redactionEnabled({}, {}), true);
  assert.equal(createRedactor({ enabled: false }).text('Costa Andrea'), 'Costa Andrea');
});

test('found on the real data: possessives, combining accents, drug codes', () => {
  const r = createRedactor({ allow: ['Davide Greco', 'Bojan Mijatović'] });
  assert.equal(r.text("Davide Greco's comment; Bojan Mijatović merged it; Rossi Mario's request."), "Davide Greco's comment; Bojan Mijatović merged it; [PERSON_1]'s request.");
  assert.equal(r.text('5 packs of Amoxicillina, AIC 012345678, lotto 0234567890; call 0521 703456.'), '5 packs of Amoxicillina, AIC 012345678, lotto 0234567890; call [PHONE_1].');
});
