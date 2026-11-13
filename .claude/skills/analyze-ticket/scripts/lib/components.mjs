// Components by name (K6 of the Ticket Intelligence knowledge plan): the parts of an application as the team names
// them ("Pazienti", "Prenotazioni"), each a list of path prefixes. The knowledge base has one file per component
// (docs/knowledge/pazienti.md), and the agent's Insights use the same names.
//
// Where the rules come from, first found wins:
//   1. the repository's .ticket-intel.json → "components": [{ "name": "Pazienti", "paths": ["frontend/src/app/features/patients/", …] }]
//   2. the environment variable TICKET_INTEL_COMPONENTS (the same list as JSON; the agent sets it from agent.config.json)
// Without rules, components stay path-based (code.mjs componentOf), as before.

/** The rules: [{ name, paths }] or []. */
export function componentRules(repoConfig = {}, env = process.env) {
  if (Array.isArray(repoConfig.components) && repoConfig.components.length) return repoConfig.components;
  try {
    const list = JSON.parse(env.TICKET_INTEL_COMPONENTS ?? '[]');
    return Array.isArray(list) ? list.filter((r) => r?.name && Array.isArray(r.paths)) : [];
  } catch {
    return [];
  }
}

/**
 * The named component of a path (first matching prefix), or null. Tests count with what they test: a JVM test with
 * its main package; a browser test (e2e/) with nothing by path (its screen decides, see the caller).
 */
export function namedComponentOf(path, rules) {
  const p = String(path).replace(/\\/g, '/').replace(/^.*?(?=(frontend|backend|e2e)\/)/, '').replace('/src/test/java/', '/src/main/java/');
  return rules.find((r) => r.paths.some((prefix) => p.startsWith(prefix)))?.name ?? null;
}

/** "Shared (forms, dates, layout)" → "shared-forms-dates-layout"; "Fasce orarie" → "fasce-orarie". */
export function slugOf(name) {
  return String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'general';
}

/**
 * The named component of a set of files: the one most files belong to; a component whose name says "shared" or
 * "common" loses a tie, because a fix is usually documented where the screen or the feature is.
 */
export function namedComponentOfFiles(files, rules) {
  const count = new Map();
  for (const f of files) {
    const n = namedComponentOf(f, rules);
    if (n) count.set(n, (count.get(n) ?? 0) + 1);
  }
  const shared = (n) => /shared|common|condivis/i.test(n);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || Number(shared(a[0])) - Number(shared(b[0])))[0]?.[0] ?? null;
}
