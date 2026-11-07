import { AbstractControl, ValidationErrors } from '@angular/forms';

/** Electronic prescription number (NRE), e.g. 0301A4000112233 (the letter in either case, sent upper case). */
export const NRE = /^[0-9]{4}[A-Za-z][0-9]{10}$/;

/** Optional NRE: empty, or a valid number (same rule as the backend's OrderRequest). */
export function nreValidator(control: AbstractControl): ValidationErrors | null {
  const value = String(control.value ?? '').trim();
  return !value || NRE.test(value) ? null : { nre: true };
}
