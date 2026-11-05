import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/** Italian fiscal code ("codice fiscale"): format only, same rule as the backend (PatientRequest). */
export const FISCAL_CODE = /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/;

/** Electronic prescription number (NRE), e.g. 0301A4000112233 (the letter in either case, sent upper case). */
export const NRE = /^[0-9]{4}[A-Za-z][0-9]{10}$/;

export function fiscalCodeValidator(control: AbstractControl): ValidationErrors | null {
  const value = String(control.value ?? '').toUpperCase();
  return !value || FISCAL_CODE.test(value) ? null : { fiscalCode: true };
}

/** Today as "yyyy-MM-dd" in the browser's time zone (what <input type="date"> uses). */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** For <input type="date">: the date must not be after today. */
export function notInFuture(control: AbstractControl): ValidationErrors | null {
  return control.value && control.value > todayIso() ? { future: true } : null;
}

/** Group validator: `to` must be after `from` (times "HH:mm" or dates "yyyy-MM-dd", compared as text). */
export function orderedRange(from: string, to: string, allowEqual = false): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const a = group.get(from)?.value;
    const b = group.get(to)?.value;
    if (!a || !b) return null;
    return b > a || (allowEqual && a === b) ? null : { [`${to}BeforeFrom`]: true };
  };
}
