// Redaction of personal data before ticket text reaches an AI model (R-02 of docs/DEPENDENCIES_AND_RISKS.md).
// Shared by the analyze-ticket skill (analysis, documentation) and the Ticket Intelligence agent (fix, review, Ask).
//
// Deterministic, no AI, no network:
//   - identifiers: Italian fiscal codes, e-mail addresses, phone numbers, IBANs, health card numbers, birth dates
//     (a date next to "born", "nato/a", "data di nascita", …);
//   - people's names: two capitalised words of which one is a common first name, unless the name is on the allow-list
//     of the team (Jira users, git authors, configured staff). The team must stay visible: "who knows this code" is
//     half of an analysis.
// The same value always gets the same placeholder ([PERSON_1], [FISCAL_CODE_1], …), so the model can still tell
// that two mentions are the same person. The mapping stays in memory; it is never written or sent.
//
// Limits (said in REDACTION.md): names that are not common first names, names written in one word or in upper case,
// free-text addresses, and anything inside images (screenshots) are not caught. Use attachments: "skip" where
// screenshots may show patients.

// Common Italian, English and Serbian first names (lower case, no accents): enough for "Surname Name" in tickets.
const FIRST_NAMES = new Set(`
alessandro alessandra alberto alice andrea angela anna antonio arianna aurora barbara beatrice benedetta bruno camilla carla carlo carolina caterina cecilia chiara claudia claudio cristina cristian daniela daniele dario davide diego domenico donato edoardo elena elisa elisabetta emanuele emma enrico enzo erika ettore fabio fabrizio federica federico filippo francesca francesco franco gabriele gabriella giacomo gianluca gianni giada giorgia giorgio giovanna giovanni giulia giulio giuseppe giuseppina greta guido ilaria irene isabella jacopo laura leonardo letizia lorenzo luca lucia luciano luigi luisa marco margherita maria marina mario marta martina massimo matilde matteo mattia maurizio michela michele mirko monica nadia nicola nicoletta noemi paola paolo patrizia pietro raffaele riccardo rita roberta roberto rosa rosanna salvatore samuele sandra sara serena sergio silvia simona simone sofia stefania stefano teresa tommaso valentina valeria valerio vincenzo viola vittoria vittorio
adam alan alex amy ben chris daniel david emily emma george grace harry jack james jane john joseph julia kate laura lisa mark mary michael nick olivia oliver paul peter rachel robert sam sarah sophie thomas tom william
aleksandar ana bojan dragan dusan ivan ivana jelena jovan marija marko milan milica milos nikola petar stefan tamara vladimir zoran
`.split(/\s+/).filter(Boolean));

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Identifiers, in the order they are applied (an IBAN before a phone number, a fiscal code before names).
const RULES = [
  ['FISCAL_CODE', /\b[A-Z]{6}\d{2}[A-EHLMPRST]\d{2}[A-Z]\d{3}[A-Z]\b/g],
  ['IBAN', /\b[A-Z]{2}\d{2}[A-Z]\d{10}[0-9A-Z]{12}\b/g],
  ['HEALTH_CARD', /\b80\d{18}\b/g],
  ['EMAIL', /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/gi],
  // Not part of a decimal or a code: no digit, ",", "." or "-" before it, and no digit or decimal after it.
  // A code after its label is not a phone number either: "AIC 012345678" (a drug), a lot, an id.
  ['PHONE', /(?<![\w,.\-/])(?<!\b(?:AIC|lotto|lot|codice|code|cod\.|id|ID)[:#]?\s?)(?:\+39[ .-]?)?(?:3\d{2}|0\d{1,3})[ .-]?\d{6,8}(?!\d|[.,]\d)/g],
  ['BIRTH_DATE', /\b(?:nat[oa]\s+il|born(?:\s+on)?|data di nascita:?|date of birth:?|birth date:?|d\.o\.b\.?:?)\s*\d{1,2}[/.-]\d{1,2}[/.-](?:19|20)\d{2}\b/gi],
];
// Addresses that are tools, not people (kept as they are).
const KEEP_EMAIL = /noreply|no-reply|example\.(com|org|it)$/i;

/** The identifier rules as [kind, RegExp] (not global), for checks that report rather than mask (the knowledge lint). */
export const IDENTIFIER_RULES = RULES.map(([kind, re]) => [kind, new RegExp(re.source, re.flags.replace('g', ''))]);
export const isToolEmail = (s) => KEEP_EMAIL.test(s);

/**
 * @param {object} [o]
 * @param {boolean} [o.enabled]       false: text passes unchanged
 * @param {string[]} [o.allow]        the team: names that stay (Jira users, git authors, staff)
 * @returns {{ text: (s: string) => string, allow: (names: string[]) => void, stats: () => Record<string, number>, enabled: boolean }}
 */
export function createRedactor({ enabled = true, allow = [] } = {}) {
  const team = new Set();
  const addAllowed = (names) => {
    for (const n of names ?? []) {
      const f = fold(n);
      if (!f) continue;
      team.add(f);
      const parts = f.split(' ');
      if (parts.length === 2) team.add(`${parts[1]} ${parts[0]}`); // "Colombo Sara" too
    }
  };
  addAllowed(allow);
  const tokens = new Map(); // `${kind}|${value}` → placeholder
  const counts = {};
  const placeholder = (kind, value) => {
    // A person is the same whatever the order: "Marino Paolo" = "Paolo Marino".
    const id = `${kind}|${kind === 'PERSON' ? fold(value).split(' ').sort().join(' ') : value}`;
    if (!tokens.has(id)) {
      counts[kind] = (counts[kind] ?? 0) + 1;
      tokens.set(id, `[${kind}_${counts[kind]}]`);
    }
    return tokens.get(id);
  };

  function text(s) {
    if (!enabled || s == null) return s;
    let out = String(s);
    for (const [kind, re] of RULES) {
      out = out.replace(re, (m) => (kind === 'EMAIL' && KEEP_EMAIL.test(m) ? m : placeholder(kind, m)));
    }
    // Two capitalised words, one of them a first name: "Costa Andrea", "Giulia Ferrari", "Dr.ssa Anna Ferri".
    // Letters may carry combining accents ("Mijatovic" + U+0301): \p{M} keeps them inside the word.
    // A possessive ("Davide Greco's comment") is not part of the name: checked without it, kept after the placeholder.
    out = out.replace(/(?<![\p{L}\p{M}])(\p{Lu}[\p{Ll}\p{M}'’]{1,20})[ \t]+(\p{Lu}[\p{Ll}\p{M}'’]{1,20})(?![\p{L}\p{M}])/gu, (m, a, b) => {
      const bare = b.replace(/['’]s$/, '');
      const pair = fold(`${a} ${bare}`);
      if (team.has(pair)) return m;
      return FIRST_NAMES.has(fold(a)) || FIRST_NAMES.has(fold(bare)) ? `${placeholder('PERSON', pair)}${b.slice(bare.length)}` : m;
    });
    return out;
  }

  return { enabled, text, allow: addAllowed, stats: () => ({ ...counts }) };
}

/** Whether redaction is on: TICKET_INTEL_REDACTION=off|on wins over the config (redaction.enabled, default on). */
export function redactionEnabled(cfg = {}, env = process.env) {
  const v = String(env.TICKET_INTEL_REDACTION ?? '').toLowerCase();
  if (v === 'off' || v === '0' || v === 'false') return false;
  if (v === 'on' || v === '1' || v === 'true') return true;
  return cfg.redaction?.enabled !== false;
}

/** A normalized issue (jira.mjs normalizeIssue) with its free text redacted; people fields are the team, kept. */
export function redactIssue(issue, r) {
  if (!r?.enabled || !issue) return issue;
  return {
    ...issue,
    summary: r.text(issue.summary),
    description: r.text(issue.description),
    comments: (issue.comments ?? []).map((c) => ({ ...c, body: r.text(c.body) })),
    worklogs: (issue.worklogs ?? []).map((w) => ({ ...w, comment: r.text(w.comment) })),
    links: (issue.links ?? []).map((l) => ({ ...l, summary: r.text(l.summary) })),
    // Field changes may carry text (a description edit); values of fields like status stay readable.
    changelog: (issue.changelog ?? []).map((h) => ({ ...h, items: h.items.map((i) => (/description|summary|comment|environment/i.test(i.field) ? { ...i, from: r.text(i.from), to: r.text(i.to) } : i)) })),
  };
}

/** The team in a normalized issue: reporter, assignee, comment, worklog and change authors (Jira accounts). */
export function peopleOfIssue(issue) {
  const names = [issue?.reporter?.name, issue?.assignee?.name, ...(issue?.comments ?? []).map((c) => c.author?.name), ...(issue?.worklogs ?? []).map((w) => w.author?.name), ...(issue?.changelog ?? []).map((h) => h.author?.name)];
  return names.filter(Boolean);
}
