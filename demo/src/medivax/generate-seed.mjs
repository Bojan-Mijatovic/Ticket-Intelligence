#!/usr/bin/env node
// Writes MediVax's seed data from one source, so the database (Flyway) and the browser tests' mocked API agree:
//   template/backend/src/main/resources/db/migration/V1__patients.sql   synthetic patients (demo/lib/synthetic-patients.mjs)
//   template/backend/src/main/resources/db/migration/V2__vaccines.sql   the vaccine catalog
//   template/backend/src/main/resources/db/migration/V3__lots.sql       vaccine lots
//   template/backend/src/main/resources/db/migration/V4__doses.sql      the doses given so far
//   template/e2e/support/api-data.json                                  the same data for mock-api.ts
//
//   node demo/src/medivax/generate-seed.mjs
//
// Deterministic: "today" is fixed (TODAY), so the seed does not change from one run to the next.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rng, syntheticPatients } from '../../lib/synthetic-patients.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const T = join(HERE, 'template');
const MIG = join(T, 'backend/src/main/resources/db/migration');
const TODAY = '2026-11-13';

export const VACCINES = [
  { code: 'ESA', name: 'Esavalente (DTPa-IPV-HB-Hib)', doses: 3, intervalDays: 60, minAgeMonths: 2, maxAgeYears: 6, boosterMonths: null },
  { code: 'MPRV', name: 'Morbillo-Parotite-Rosolia-Varicella', doses: 2, intervalDays: 28, minAgeMonths: 12, maxAgeYears: null, boosterMonths: null },
  { code: 'HPV', name: 'Papillomavirus 9-valente', doses: 2, intervalDays: 180, minAgeMonths: 132, maxAgeYears: 26, boosterMonths: null },
  { code: 'TDAP', name: 'Difterite-Tetano-Pertosse (adulti)', doses: 1, intervalDays: 0, minAgeMonths: 216, maxAgeYears: null, boosterMonths: 120 },
  { code: 'INFL', name: 'Antinfluenzale stagionale', doses: 1, intervalDays: 0, minAgeMonths: 6, maxAgeYears: null, boosterMonths: 12 },
  { code: 'HZV', name: 'Herpes zoster ricombinante', doses: 2, intervalDays: 60, minAgeMonths: 600, maxAgeYears: null, boosterMonths: null },
  { code: 'PCV', name: 'Pneumococco coniugato 20-valente', doses: 1, intervalDays: 0, minAgeMonths: 780, maxAgeYears: null, boosterMonths: null },
];

export const LOTS = [
  { code: 'ESA-24A', vaccineCode: 'ESA', expiry: '2026-06-30', dosesLeft: 0 },
  { code: 'ESA-25A', vaccineCode: 'ESA', expiry: '2026-11-30', dosesLeft: 10 },
  { code: 'ESA-25B', vaccineCode: 'ESA', expiry: '2027-03-31', dosesLeft: 40 },
  { code: 'MPRV-25C', vaccineCode: 'MPRV', expiry: '2027-01-31', dosesLeft: 25 },
  { code: 'HPV-24X', vaccineCode: 'HPV', expiry: '2026-09-30', dosesLeft: 5 },
  { code: 'HPV-25D', vaccineCode: 'HPV', expiry: '2026-12-31', dosesLeft: 30 },
  { code: 'TDAP-26A', vaccineCode: 'TDAP', expiry: '2028-02-29', dosesLeft: 50 },
  { code: 'INFL-25N', vaccineCode: 'INFL', expiry: '2026-05-31', dosesLeft: 0 },
  { code: 'INFL-26N', vaccineCode: 'INFL', expiry: '2027-05-31', dosesLeft: 200 },
  { code: 'HZV-26B', vaccineCode: 'HZV', expiry: '2027-08-31', dosesLeft: 20 },
  { code: 'PCV-26C', vaccineCode: 'PCV', expiry: '2027-10-31', dosesLeft: 15 },
];

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const addMonths = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
};
const years = (birth, on) => {
  const [by, bm, bd] = birth.split('-').map(Number);
  const [y, m, d] = on.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
};

/** The doses each patient has had, by age group; every date before TODAY. */
export function dosesFor(patients, seed = 7) {
  const r = rng(seed);
  const out = [];
  const lotFor = (vaccine, on) => LOTS.filter((l) => l.vaccineCode === vaccine && l.expiry >= on).sort((a, b) => a.expiry.localeCompare(b.expiry))[0]?.code ?? LOTS.find((l) => l.vaccineCode === vaccine).code;
  const months = (birth, on) => {
    const [by, bm, bd] = birth.split('-').map(Number);
    const [y, m, d] = on.split('-').map(Number);
    return (y - by) * 12 + (m - bm) - (d < bd ? 1 : 0);
  };
  const give = (p, vaccine, on, n) => {
    const v = VACCINES.find((x) => x.code === vaccine);
    // Only doses the centre could have given: in the past, and in the vaccine's age range.
    if (on >= TODAY || months(p.birthDate, on) < v.minAgeMonths || (v.maxAgeYears !== null && years(p.birthDate, on) > v.maxAgeYears)) return false;
    out.push({ id: out.length + 1, patientId: p.id, vaccineCode: vaccine, doseNumber: n, givenOn: on, lotCode: lotFor(vaccine, on) });
    return true;
  };
  const jitter = (n) => Math.floor(r() * n);
  for (const p of patients) {
    const age = years(p.birthDate, TODAY);
    if (age < 1) {
      // The esavalente from 2 months, every 60 days (some infants are overdue for their next dose).
      let on = addDays(addMonths(p.birthDate, 2), jitter(10));
      for (let n = 1; n <= 3; n++) {
        if (!give(p, 'ESA', on, n)) break;
        on = addDays(on, 60 + jitter(20));
      }
    } else if (age < 12) {
      const first = addDays(addMonths(p.birthDate, 13), jitter(30));
      give(p, 'MPRV', first, 1);
      if (r() < 0.75) give(p, 'MPRV', addDays(first, 28 + jitter(40)), 2);
      if (r() < 0.6) give(p, 'INFL', `2025-${r() < 0.5 ? '10' : '11'}-${String(3 + jitter(25)).padStart(2, '0')}`, 1);
    } else if (age < 18) {
      const on = `2026-${String(3 + jitter(5)).padStart(2, '0')}-${String(2 + jitter(26)).padStart(2, '0')}`;
      give(p, 'HPV', on, 1);
      if (r() < 0.3) give(p, 'HPV', addDays(on, 180 + jitter(30)), 2);
    } else {
      if (r() < 0.7) give(p, 'TDAP', `${2015 + jitter(4)}-${String(1 + jitter(12)).padStart(2, '0')}-${String(1 + jitter(28)).padStart(2, '0')}`, 1);
      if (age >= 60 || r() < 0.4) give(p, 'INFL', `2025-${r() < 0.6 ? '10' : '11'}-${String(3 + jitter(25)).padStart(2, '0')}`, 1);
      if (age >= 50 && r() < 0.6) {
        const on = `2026-${String(8 + jitter(3)).padStart(2, '0')}-${String(1 + jitter(28)).padStart(2, '0')}`;
        if (give(p, 'HZV', on, 1) && r() < 0.4) give(p, 'HZV', addDays(on, 60 + jitter(10)), 2);
      }
      if (age >= 65 && r() < 0.5) give(p, 'PCV', `2026-${String(1 + jitter(9)).padStart(2, '0')}-${String(1 + jitter(28)).padStart(2, '0')}`, 1);
    }
  }
  return out;
}

const sql = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const insert = (table, cols, rows) => `INSERT INTO ${table} (${cols.join(', ')}) VALUES\n${rows.map((r) => `  (${r.map(sql).join(', ')})`).join(',\n')};\n`;

const patients = syntheticPatients(30, { today: TODAY });
const doses = dosesFor(patients);

const write = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  console.log(path.replace(HERE, 'demo/src/medivax').replace(/\\/g, '/'));
};

write(join(MIG, 'V1__patients.sql'), `-- Patients of the vaccination centre. SYNTHETIC: generated by demo/lib/synthetic-patients.mjs, no real person.
-- The fiscal codes have the official shape but a wrong check letter, so none can belong to anyone.
CREATE TABLE patients (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  fiscal_code VARCHAR(16)  NOT NULL UNIQUE,
  last_name   VARCHAR(60)  NOT NULL,
  first_name  VARCHAR(60)  NOT NULL,
  sex         CHAR(1)      NOT NULL,
  birth_date  DATE         NOT NULL,
  birth_place VARCHAR(60)  NOT NULL,
  phone       VARCHAR(20),
  health_card VARCHAR(20)
);

${insert('patients', ['id', 'fiscal_code', 'last_name', 'first_name', 'sex', 'birth_date', 'birth_place', 'phone', 'health_card'], patients.map((p) => [p.id, p.fiscalCode, p.lastName, p.firstName, p.sex, p.birthDate, p.birthPlace, p.phone, p.healthCard]))}
ALTER TABLE patients ALTER COLUMN id RESTART WITH ${patients.length + 1};
`);

write(join(MIG, 'V2__vaccines.sql'), `-- The vaccine catalog: doses of the primary series, days between them, the age range, and the booster interval.
CREATE TABLE vaccines (
  code            VARCHAR(10)  PRIMARY KEY,
  name            VARCHAR(80)  NOT NULL,
  doses           INT          NOT NULL,
  interval_days   INT          NOT NULL,
  min_age_months  INT          NOT NULL,
  max_age_years   INT,
  booster_months  INT
);

${insert('vaccines', ['code', 'name', 'doses', 'interval_days', 'min_age_months', 'max_age_years', 'booster_months'], VACCINES.map((v) => [v.code, v.name, v.doses, v.intervalDays, v.minAgeMonths, v.maxAgeYears, v.boosterMonths]))}`);

write(join(MIG, 'V3__lots.sql'), `-- Vaccine lots in the fridge: a dose can be given from a lot until its expiry day, included.
CREATE TABLE lots (
  code          VARCHAR(20)  PRIMARY KEY,
  vaccine_code  VARCHAR(10)  NOT NULL REFERENCES vaccines(code),
  expiry        DATE         NOT NULL,
  doses_left    INT          NOT NULL
);

${insert('lots', ['code', 'vaccine_code', 'expiry', 'doses_left'], LOTS.map((l) => [l.code, l.vaccineCode, l.expiry, l.dosesLeft]))}`);

write(join(MIG, 'V4__doses.sql'), `-- The doses given so far (synthetic history, consistent with the patients' ages).
CREATE TABLE doses (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  patient_id    BIGINT       NOT NULL REFERENCES patients(id),
  vaccine_code  VARCHAR(10)  NOT NULL REFERENCES vaccines(code),
  dose_number   INT          NOT NULL,
  given_on      DATE         NOT NULL,
  lot_code      VARCHAR(20)  NOT NULL REFERENCES lots(code)
);

${insert('doses', ['id', 'patient_id', 'vaccine_code', 'dose_number', 'given_on', 'lot_code'], doses.map((d) => [d.id, d.patientId, d.vaccineCode, d.doseNumber, d.givenOn, d.lotCode]))}
ALTER TABLE doses ALTER COLUMN id RESTART WITH ${doses.length + 1};
`);

write(join(T, 'e2e/support/api-data.json'), `${JSON.stringify({ _note: 'Mirrors the Flyway seed (generated by demo/src/medivax/generate-seed.mjs). Synthetic patients: no real person.', patients: patients.map(({ rareName: _r, ...p }) => p), vaccines: VACCINES, lots: LOTS, doses }, null, 2)}\n`);

console.log(`${patients.length} patients, ${doses.length} doses`);
