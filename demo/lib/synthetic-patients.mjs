// Synthetic patients for the pilot app (MediVax) and its tickets: no real person, by construction.
//
// Every value has the shape of a real Italian identifier, so the redaction (R-02) meets it the way it would meet real
// data, but none can belong to anyone:
//   - the fiscal code is computed from the invented name, birth date and town, then its check letter is moved by one,
//     so it fails the official check: a real fiscal code always passes it;
//   - the health card number uses the Italian prefix 80380 and digits from a fixed seed;
//   - phone numbers are mobile-shaped (3xx xxxxxxx) from the same seed.
// The generator is deterministic: the same seed gives the same patients, so the database seed, the browser tests' data
// and the pilot's tickets agree.
//
// About a quarter of the first names are uncommon ones that the redaction's name list does not know (Ottavio,
// Ludovica, …). They are there on purpose: the pilot measures how many names the masking misses, not only the easy ones.

const COMMON_F = ['Giulia', 'Chiara', 'Francesca', 'Sara', 'Martina', 'Alessandra', 'Elisa', 'Silvia', 'Laura', 'Paola', 'Valentina', 'Federica', 'Anna', 'Roberta', 'Sofia', 'Aurora'];
const COMMON_M = ['Marco', 'Luca', 'Andrea', 'Matteo', 'Davide', 'Simone', 'Stefano', 'Paolo', 'Roberto', 'Lorenzo', 'Giorgio', 'Fabio', 'Riccardo', 'Antonio', 'Leonardo', 'Edoardo'];
const RARE_F = ['Ludovica', 'Ginevra', 'Ottavia', 'Benedetta Maria', 'Adelaide', 'Costanza', 'Brunella', 'Iolanda'];
const RARE_M = ['Ottavio', 'Brando', 'Gioele', 'Ercole', 'Lapo', 'Tancredi', 'Corrado', 'Ascanio'];
const SURNAMES = ['Rossi', 'Russo', 'Ferrari', 'Esposito', 'Bianchi', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo', 'Conti', 'De Luca', 'Mancini', 'Costa', 'Giordano', 'Rizzo', 'Lombardi', 'Moretti', 'Barbieri', 'Fontana', 'Santoro', 'Mariani', 'Rinaldi', 'Caruso', 'Ferrara', 'Galli', 'Martini', 'Leone', 'Longo', 'Gentile'];
const TOWNS = [['H501', 'Roma'], ['F205', 'Milano'], ['L219', 'Torino'], ['A944', 'Bologna'], ['F839', 'Napoli'], ['D612', 'Firenze'], ['G273', 'Palermo'], ['L736', 'Venezia']];
const MONTHS = 'ABCDEHLMPRST';

/** A small seeded PRNG (mulberry32): the same seed gives the same sequence. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const letters = (s) => s.toUpperCase().normalize('NFD').replace(/[^A-Z]/g, '');
const consonants = (s) => letters(s).replace(/[AEIOU]/g, '');
const vowels = (s) => letters(s).replace(/[^AEIOU]/g, '');
const pad3 = (s) => `${s}XXX`.slice(0, 3);

function surnameCode(s) {
  return pad3(consonants(s) + vowels(s));
}
function nameCode(s) {
  const c = consonants(s);
  return c.length >= 4 ? c[0] + c[2] + c[3] : pad3(c + vowels(s));
}

const ODD = { 0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21, A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23 };
const even = (ch) => (/\d/.test(ch) ? Number(ch) : ch.charCodeAt(0) - 65);

/** The official check letter of the first 15 characters of a fiscal code. */
export function checkLetter(first15) {
  let sum = 0;
  for (let i = 0; i < 15; i++) sum += i % 2 === 0 ? ODD[first15[i]] : even(first15[i]);
  return String.fromCharCode(65 + (sum % 26));
}

/** Whether a fiscal code passes the official check (a real one always does; ours never). */
export const passesCheck = (code) => /^[A-Z0-9]{16}$/.test(code) && checkLetter(code.slice(0, 15)) === code[15];

/**
 * A fiscal code in the official shape whose check letter is deliberately wrong (moved by one).
 * @param {{ lastName: string, firstName: string, birthDate: string, sex: 'M'|'F', town: string }} p
 */
export function syntheticFiscalCode({ lastName, firstName, birthDate, sex, town }) {
  const [y, m, d] = birthDate.split('-').map(Number);
  const first15 = `${surnameCode(lastName)}${nameCode(firstName)}${String(y % 100).padStart(2, '0')}${MONTHS[m - 1]}${String(sex === 'F' ? d + 40 : d).padStart(2, '0')}${town}`;
  const right = checkLetter(first15);
  return first15 + String.fromCharCode(65 + ((right.charCodeAt(0) - 65 + 1) % 26));
}

const pick = (r, list) => list[Math.floor(r() * list.length)];
const digits = (r, n) => Array.from({ length: n }, () => Math.floor(r() * 10)).join('');

// Age groups that the vaccine catalog needs (infants, children, teenagers, adults, older people), as birth-year ranges.
const GROUPS = [
  { from: 2025, to: 2026, share: 0.2 },
  { from: 2014, to: 2021, share: 0.2 },
  { from: 2009, to: 2014, share: 0.15 },
  { from: 1965, to: 1998, share: 0.25 },
  { from: 1938, to: 1964, share: 0.2 },
];

/**
 * `count` synthetic patients, deterministic for a seed. Birth dates are before `today` (ISO).
 * @returns {{ id, fiscalCode, lastName, firstName, sex, birthDate, birthPlace, phone, healthCard, rareName: boolean }[]}
 */
export function syntheticPatients(count, { seed = 20261113, today = '2026-11-13', rareShare = 0.25 } = {}) {
  const r = rng(seed);
  const out = [];
  const used = new Set();
  for (let i = 0; out.length < count && i < count * 20; i++) {
    const sex = r() < 0.5 ? 'F' : 'M';
    const rare = r() < rareShare;
    const firstName = pick(r, rare ? (sex === 'F' ? RARE_F : RARE_M) : sex === 'F' ? COMMON_F : COMMON_M);
    const lastName = pick(r, SURNAMES);
    if (used.has(`${lastName} ${firstName}`)) continue;
    let acc = 0;
    const g = r();
    const group = GROUPS.find((x) => (acc += x.share) >= g) ?? GROUPS.at(-1);
    const year = group.from + Math.floor(r() * (group.to - group.from + 1));
    const month = 1 + Math.floor(r() * 12);
    const day = 1 + Math.floor(r() * 28);
    const birthDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (birthDate >= today) continue;
    const [town, birthPlace] = pick(r, TOWNS);
    used.add(`${lastName} ${firstName}`);
    out.push({
      id: out.length + 1,
      fiscalCode: syntheticFiscalCode({ lastName, firstName, birthDate, sex, town }),
      lastName,
      firstName,
      sex,
      birthDate,
      birthPlace,
      phone: `3${20 + Math.floor(r() * 79)} ${digits(r, 7)}`,
      healthCard: `80380${digits(r, 15)}`,
      rareName: rare,
    });
  }
  return out;
}

/** "14/03/1961" from "1961-03-14". */
export const italianDate = (iso) => iso.split('-').reverse().join('/');
