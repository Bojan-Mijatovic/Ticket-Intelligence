// Helpers for the form pages (Pazienti, Prenotazioni, Fasce orarie).

/** "yyyy-MM-dd" of the next given weekday after today (0 = Sunday … 6 = Saturday), in local time. */
export function nextWeekday(day: number): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() !== day) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
