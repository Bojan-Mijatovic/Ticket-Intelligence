// The pilot's cases on MediVax, with their answer key (docs/PILOT.md). The agent never sees this file: it lives in
// the Ticket Intelligence repository, not in the app's.
//
// A case is a realistic change a developer pushes to main: a small, legitimate edit and, inside it, a bug the
// existing tests do not catch (the planter runs them first, as CI would, and drops a case they catch). Later a user
// reports the symptom in Jira, quoting a patient the way real tickets do. The patients are synthetic.
//
//   id        stable name of the case
//   side      'BE' or 'FE': the ticket's tag
//   author    who makes the change (history.mjs PEOPLE)
//   story     the Jira story the change belongs to (created Done when the change is pushed)
//   subject   the commit subject after "<STORY KEY>: "
//   edits     [{ file, from, to }]: each `from` must occur exactly once on main
//   ticket(h) the bug report: { summary, description, priority? (default High) }, built when it is reported. h: { patient(id), person(spec),
//             it(iso) → "20/11/2026", day: the report day (ISO) }; patient() and person() record the identifiers
//             the ticket quotes, for the redaction score
//   answer    { files: [path], owners: [name] }: a file the analysis must name, the people who know the code
//
// Cases are taken in this order; a case that no longer applies to main (its code changed) is skipped.

const BE = 'backend/src/main/java/com/medivax';
const FE = 'frontend/src/app';
const DUE = `${BE}/schedule/DueService.java`;
const DOSES = `${BE}/dose/DoseService.java`;
const PATIENTS = `${BE}/patient/PatientService.java`;
const SCHEDULE = `${BE}/schedule/Schedule.java`;
const DATES = `${FE}/shared/utils/dates.ts`;
const CARD = `${FE}/features/patients/patient-card.component.ts`;
const SEARCH = `${FE}/features/patients/patient-search.component.ts`;

const SIGN = '\n\nSegnalato da Anna Lombardi (coordinatrice infermieristica).';

export const CASES = [
  {
    id: 'due-last-day',
    side: 'BE',
    author: 'federica',
    story: { summary: '[BE] - Scadenze: tidy the due list before the SMS reminders', description: 'Small cleanup of DueService (names), before the SMS reminders read the same list.' },
    subject: 'tidy the due list: one map of the patients by id',
    edits: [
      { file: DUE, from: 'Map<Long, Patient> people = patients.findAllById(', to: 'Map<Long, Patient> byId = patients.findAllById(' },
      { file: DUE, from: 'Patient p = people.get(e.getKey());', to: 'Patient p = byId.get(e.getKey());' },
      { file: DUE, from: 'if (!n.dueOn().isBefore(from) && !n.dueOn().isAfter(to)) {', to: 'if (!n.dueOn().isBefore(from) && n.dueOn().isBefore(to)) {' },
    ],
    ticket: (h) => ({
      summary: '[BE] - Scadenze: the doses due on Sunday are missing from the week',
      description: `In Scadenze, the week from 16/11 to 22/11 does not list ${h.patient(27, { phone: true })}: her second Herpes zoster dose is due on Sunday ${h.it('2026-11-22')}, and her card shows it. Last week the patients due on Sunday were missing too, so nobody called them.${SIGN}`,
    }),
    answer: { files: [DUE], owners: ['Federica Gallo'] },
  },
  {
    id: 'hpv-26',
    side: 'BE',
    author: 'irene',
    story: { summary: '[BE] - Registrazione dose: comment the age checks for the audit', description: 'The regional audit asks where the age rules are; a comment on each check.' },
    subject: 'comment the age checks',
    edits: [
      { file: DOSES, from: '        int years = Ages.years(patient.getBirthDate(), request.givenOn());\n', to: '        // The age on the day of the dose, not today: a dose can be recorded afterwards.\n        int years = Ages.years(patient.getBirthDate(), request.givenOn());\n' },
      { file: DOSES, from: 'if (vaccine.getMaxAgeYears() != null && years > vaccine.getMaxAgeYears()) {', to: 'if (vaccine.getMaxAgeYears() != null && years >= vaccine.getMaxAgeYears()) {' },
    ],
    ticket: (h) => {
      const p = h.person({ lastName: 'Gentile', firstName: 'Ottavio', sex: 'M', yearsOld: 26, monthsOld: 3, town: 'H501', birthPlace: 'Roma', healthCard: true });
      return {
        summary: '[BE] - Registrazione dose: a 26-year-old is refused the second HPV dose',
        description: `${p} came today for the second HPV dose. REGISTRA answers "age: HPV is given up to 26 years, the patient is 26". The regional calendar gives HPV up to 26 years included, and the first dose was given here last spring.${SIGN}`,
      };
    },
    answer: { files: [DOSES], owners: ['Federica Gallo', 'Irene Fabbri'] },
  },
  {
    id: 'week-sunday',
    side: 'FE',
    author: 'tommaso',
    story: { summary: '[FE] - Scadenze: simpler week computation', description: 'Cleanup of the date helpers used by Scadenze.' },
    subject: 'simpler week computation in the date helpers',
    edits: [
      { file: DATES, from: '/** Today as "yyyy-MM-dd". */', to: '/** Today as "yyyy-MM-dd" (local time). */' },
      { file: DATES, from: '  const sinceMonday = (d.getDay() + 6) % 7;', to: '  const sinceMonday = d.getDay() - 1;' },
    ],
    ticket: (h) => ({
      summary: '[FE] - Scadenze: on a Sunday the page shows the next week',
      description: `When the day chosen in Scadenze is a Sunday (e.g. ${h.it('2026-11-15')}), the page shows "Dal 16/11/2026 al 22/11/2026", the week after. ${h.patient(27)}, whose influenza booster is due on that Sunday, is not in the list then. On Monday to Saturday it is right.${SIGN}`,
    }),
    answer: { files: [DATES], owners: ['Tommaso Bruno'] },
  },
  {
    id: 'interval-from-first',
    side: 'BE',
    author: 'irene',
    story: { summary: '[BE] - Schedule: no sorting, the repository already orders the doses', description: 'Small performance cleanup: the doses come ordered from the database.' },
    subject: 'take the last dose without sorting again',
    edits: [
      { file: SCHEDULE, from: 'Dose last = given.stream().max(Comparator.comparing(Dose::getGivenOn).thenComparing(Dose::getDoseNumber)).orElseThrow();', to: 'Dose last = given.get(0); // the repository returns the doses already ordered' },
    ],
    ticket: (h) => ({
      summary: '[BE] - Scheda paziente: the third ESA dose is due too early',
      description: `The card of ${h.patient(8, { birth: true })} says the third esavalente dose is due from ${h.it('2026-09-05')} and marks it late. The second dose was given on ${h.it('2026-09-21')}, so the third cannot be before 20/11/2026. REGISTRA would accept it today.${SIGN}`,
    }),
    answer: { files: [SCHEDULE], owners: ['Federica Gallo', 'Irene Fabbri'] },
  },
  {
    id: 'card-booster-label',
    side: 'FE',
    author: 'tommaso',
    story: { summary: '[FE] - Scheda paziente: one label per dose in the next doses', description: 'Next doses table: the dose column reads the same as the doses given.' },
    subject: 'same dose label in the next doses table',
    edits: [
      { file: CARD, from: '                  <td>{{ doseLabel(n.doseNumber, n.booster) }}</td>', to: '                  <td>{{ doseLabel(n.doseNumber, false) }}</td>' },
    ],
    ticket: (h) => ({
      summary: '[FE] - Scheda paziente: the influenza booster shows as "Dose 2"',
      description: `On the card of ${h.patient(6, { healthCard: true })} the next influenza dose shows "Dose 2". It is the yearly booster and Scadenze shows it as "Richiamo". The nurses think a second dose of the series is missing.${SIGN}`,
    }),
    answer: { files: [CARD], owners: ['Tommaso Bruno'] },
  },
  {
    id: 'late-today',
    side: 'FE',
    author: 'tommaso',
    story: { summary: '[FE] - Scheda paziente: document the late marker', description: 'Comments on the card component.' },
    subject: 'document when a dose is late',
    edits: [
      { file: CARD, from: '  late(n: NextDose): boolean {\n    return n.dueOn < today();', to: '  /** A dose whose day has come. */\n  late(n: NextDose): boolean {\n    return n.dueOn <= today();' },
    ],
    ticket: (h) => {
      const p = h.person({ lastName: 'Rizzo', firstName: 'Brando', sex: 'M', yearsOld: 1, monthsOld: 3, town: 'F205', birthPlace: 'Milano', phone: true });
      return {
        summary: '[FE] - Scheda paziente: a dose due today is marked "in ritardo"',
        description: `${p} is booked today, ${h.it(h.day)}, for the second MPRV dose, which is due today. His card already marks it "in ritardo", and the parents were told they were late. A dose due today is on time.${SIGN}`,
      };
    },
    answer: { files: [CARD], owners: ['Tommaso Bruno'] },
  },
  {
    id: 'search-two-letters',
    side: 'BE',
    author: 'irene',
    story: { summary: '[BE] - Pazienti: document the search limits', description: 'The search returns at most 50 patients; say it where the minimum is.' },
    subject: 'document the search limits',
    edits: [
      { file: PATIENTS, from: '    /** Fewer characters match too many patients to be useful. */\n    static final int MIN_QUERY = 2;', to: '    /** Fewer characters match too many patients to be useful (the list stops at 50). */\n    static final int MIN_QUERY = 3;' },
    ],
    ticket: (h) => ({
      summary: '[BE] - Pazienti: two letters find nobody',
      description: `The search page says "almeno 2 caratteri", but "De" finds nobody: ${h.patient(8)} is found only with "De L". The same for every surname searched with two letters.${SIGN}`,
    }),
    // Either side is a right answer: the backend went back to 3 characters, the page still says 2.
    answer: { files: [PATIENTS, SEARCH], owners: ['Irene Fabbri'] },
  },
  {
    id: 'booster-anytime',
    side: 'BE',
    author: 'federica',
    story: { summary: '[BE] - Registrazione dose: say which interval rule applies', description: 'A comment on each branch of the interval check, for the new nurses reading the rules.' },
    subject: 'comment the interval rule',
    edits: [
      { file: DOSES, from: '            if (request.givenOn().isBefore(next.get().dueOn())) {', to: '            // Inside the series a dose waits for its interval.\n            if (!next.get().booster() && request.givenOn().isBefore(next.get().dueOn())) {' },
    ],
    ticket: (h) => ({
      summary: '[BE] - Registrazione dose: a booster is accepted months too early',
      description: `For ${h.patient(6, { birth: true })} REGISTRA accepted an influenza dose on ${h.it('2026-05-12')}, six months after the previous one (${h.it('2025-11-16')}). The influenza booster is yearly, and the card still shows the next one in November. The same happens with the TDAP booster, which is every ten years.${SIGN}`,
    }),
    answer: { files: [DOSES], owners: ['Federica Gallo'] },
  },
  {
    id: 'due-phone',
    side: 'BE',
    author: 'irene',
    story: { summary: '[BE] - Scadenze: prepare the call list for the SMS reminders', description: 'The SMS gateway will read the same list; a note on the record.' },
    subject: 'note the SMS reminders on the call list',
    edits: [
      { file: DUE, from: '    /** A dose due in a period, for the call list of the week. */', to: '    /** A dose due in a period, for the call list of the week (and, later, the SMS reminders). */' },
      { file: DUE, from: 'out.add(new DueRow(p.getId(), p.displayName(), p.getFiscalCode(), p.getPhone(), ', to: 'out.add(new DueRow(p.getId(), p.displayName(), p.getFiscalCode(), p.getHealthCard(), ' },
    ],
    ticket: (h) => ({
      summary: '[BE] - Scadenze: the phone column shows a 20-digit number',
      description: `In Scadenze the "Telefono" column shows long numbers starting with 80380. For ${h.patient(8, { phone: true, healthCard: true })} it shows the health card instead of the phone, so the calls of this week cannot be made from the list.${SIGN}`,
    }),
    answer: { files: [DUE], owners: ['Federica Gallo', 'Irene Fabbri'] },
  },
  {
    id: 'vaccines-order',
    side: 'BE',
    author: 'irene',
    story: { summary: '[BE] - Vaccini: no custom query for the catalog', description: 'The catalog is small; the standard repository method is enough.' },
    subject: 'use the standard query for the catalog',
    edits: [
      { file: `${BE}/vaccine/VaccineController.java`, from: '        return vaccines.findAllByOrderByName();', to: '        return vaccines.findAll();' },
    ],
    ticket: (h) => ({
      summary: '[BE] - Vaccini: the vaccines are no longer in alphabetical order',
      description: `The Vaccini page and the vaccine list of "Registra una dose" now start with Esavalente and Papillomavirus; until last week they were in alphabetical order (Antinfluenzale first). Yesterday a nurse picked the wrong line for ${h.patient(26)} and had to correct it.${SIGN}`,
      priority: 'Low',
    }),
    answer: { files: [`${BE}/vaccine/VaccineController.java`, `${BE}/vaccine/VaccineRepository.java`], owners: ['Irene Fabbri'] },
  },
  {
    id: 'lot-expiry-iso',
    side: 'FE',
    author: 'tommaso',
    story: { summary: '[FE] - Registra dose: shorter lot labels', description: 'The lot list is wide on the tablets of the ambulatory; shorter labels.' },
    subject: 'shorter lot labels in the dose form',
    edits: [
      { file: CARD, from: '{{ l.code }} · scade il {{ formatDate(l.expiry) }} · {{ l.dosesLeft }} dosi', to: '{{ l.code }} · scade {{ l.expiry }} · {{ l.dosesLeft }} dosi' },
    ],
    ticket: (h) => ({
      summary: '[FE] - Registra dose: the lot expiry is shown as 2026-11-30',
      description: `Recording the second esavalente dose for ${h.patient(17, { birth: true })}, the lot list shows "ESA-25A · scade 2026-11-30". Everywhere else dates are 30/11/2026, and a nurse read it as a lot code.${SIGN}`,
    }),
    answer: { files: [CARD], owners: ['Tommaso Bruno'] },
  },
  {
    id: 'card-sex-raw',
    side: 'FE',
    author: 'tommaso',
    story: { summary: '[FE] - Scheda paziente: a more compact header', description: 'Less text in the header line of the card.' },
    subject: 'compact card header',
    edits: [
      { file: CARD, from: '{{ c.patient.fiscalCode }} · {{ sexLabel(c.patient.sex) }} · nato/a il', to: '{{ c.patient.fiscalCode }} · {{ c.patient.sex }} · nato/a il' },
    ],
    ticket: (h) => ({
      summary: '[FE] - Scheda paziente: the header shows "F" instead of "Femmina"',
      description: `The card of ${h.patient(19, { birth: true })} shows "F" in the header line, where it used to say "Femmina". The search list still says "Femmina".${SIGN}`,
      priority: 'Low',
    }),
    answer: { files: [CARD], owners: ['Tommaso Bruno'] },
  },
];
