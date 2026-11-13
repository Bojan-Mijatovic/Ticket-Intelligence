// Calendar days as the centre means them: in the browser's time zone (Europe/Rome), never in UTC.

/** The local calendar day of `date` as "yyyy-MM-dd" (Date.toISOString() is UTC: after midnight it gives yesterday). */
export function localIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Today as "yyyy-MM-dd". */
export function today(): string {
  return localIsoDate(new Date());
}

const parse = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** "04/03/2026" from "2026-03-04"; empty for no date. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** "yyyy-MM-dd" moved by `days`. */
export function addDays(iso: string, days: number): string {
  const d = parse(iso);
  d.setDate(d.getDate() + days);
  return localIsoDate(d);
}

/** The week of `iso`, Monday to Sunday (the centre's week starts on Monday). */
export function weekOf(iso: string): { from: string; to: string } {
  const d = parse(iso);
  const sinceMonday = (d.getDay() + 6) % 7;
  const from = addDays(iso, -sinceMonday);
  return { from, to: addDays(from, 6) };
}

/** Whole years from the birth date to `on`: the age goes up on the birthday. */
export function ageInYears(birthDate: string, on: string): number {
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [y, m, d] = on.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}
