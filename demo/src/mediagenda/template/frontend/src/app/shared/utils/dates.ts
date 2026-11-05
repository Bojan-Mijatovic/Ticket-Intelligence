import { AbstractControl, ValidationErrors } from '@angular/forms';

// Dates as the operators type them (dd/MM/yyyy) and their conversion to the API's ISO format (CUP_DEMO-2612).

const IT_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/** "07/03/1985" → the Date at local midnight, or null when the text is not a real date. */
export function parseItalianDate(text: string): Date | null {
  const m = IT_DATE.exec(String(text ?? '').trim());
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

/** Date → "1985-03-07", the format of the API. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "1985-03-07" (API) → "07/03/1985". */
export function isoToItalian(iso: string): string {
  const [year, month, day] = String(iso ?? '').slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : '';
}

/** Validator: dd/MM/yyyy, a real date, not after today. */
export function italianPastDate(control: AbstractControl): ValidationErrors | null {
  if (!control.value) return null;
  const date = parseItalianDate(control.value);
  if (!date) return { italianDate: true };
  return date.getTime() > Date.now() ? { future: true } : null;
}
