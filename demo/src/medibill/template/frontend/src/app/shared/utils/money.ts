/** 22.5 → "22,50 €" (Italian format, always two decimals); '' when there is no amount. */
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return Number(value).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
