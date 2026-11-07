// Numbers as the laboratory reads them: Italian format (decimal comma), with the decimals of the test.

/** 1.35 → "1,35" (with exactly `decimals` decimals); '' when there is no value. */
export function formatDecimal(value: number | null | undefined, decimals: number): string {
  if (value === null || value === undefined) return '';
  return Number(value).toLocaleString('it-IT', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: false });
}

/** Reference range as printed on the report: "0,70 – 1,20", "≤ 200", "≥ 3,5"; '' without bounds. */
export function rangeLabel(min: number | null, max: number | null, decimals: number): string {
  if (min !== null && max !== null) return `${formatDecimal(min, decimals)} – ${formatDecimal(max, decimals)}`;
  if (max !== null) return `≤ ${formatDecimal(max, decimals)}`;
  if (min !== null) return `≥ ${formatDecimal(min, decimals)}`;
  return '';
}
