// Italian labels for the values the backend returns.

export function sexLabel(sex: string): string {
  return sex === 'F' ? 'Femmina' : sex === 'M' ? 'Maschio' : sex;
}

/** "2 mesi", "1 mese", "11 anni": months up to two years, then years. */
export function monthsLabel(months: number): string {
  if (months < 24) return months === 1 ? '1 mese' : `${months} mesi`;
  const years = Math.floor(months / 12);
  return years === 1 ? '1 anno' : `${years} anni`;
}

/** "da 2 mesi a 6 anni", "da 65 anni". */
export function ageRangeLabel(minAgeMonths: number, maxAgeYears: number | null): string {
  return maxAgeYears === null ? `da ${monthsLabel(minAgeMonths)}` : `da ${monthsLabel(minAgeMonths)} a ${maxAgeYears} anni`;
}

/** "60 giorni" between doses; a single-dose vaccine has no interval. */
export function intervalLabel(days: number): string {
  return days === 0 ? '—' : `${days} giorni`;
}

/** "ogni anno", "ogni 10 anni", "ogni 6 mesi", or "no". */
export function boosterLabel(months: number | null): string {
  if (months === null) return 'no';
  if (months % 12 === 0) return months === 12 ? 'ogni anno' : `ogni ${months / 12} anni`;
  return `ogni ${months} mesi`;
}

/** "Dose 2", or "Richiamo" for a booster. */
export function doseLabel(doseNumber: number, booster: boolean): string {
  return booster ? 'Richiamo' : `Dose ${doseNumber}`;
}
