// Calendar days as the office means them: in the browser's time zone (Europe/Rome), never in UTC.

/** The local calendar day of `date` as "yyyy-MM-dd" (Date.toISOString() is UTC: after midnight it gives yesterday). */
export function localIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Today, `offset` days later (-1 = yesterday), as "yyyy-MM-dd". */
export function dayFromToday(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return localIsoDate(d);
}

/** "2026-10" for the month of `date` (local time). */
export function monthOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** "2026-10" moved by `delta` months. */
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  return monthOf(new Date(y, m - 1 + delta, 1));
}
