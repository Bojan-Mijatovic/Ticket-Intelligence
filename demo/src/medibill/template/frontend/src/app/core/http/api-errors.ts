import { HttpErrorResponse } from '@angular/common/http';

/** Messages to show for a failed API call: the backend's ApiError details, or a generic message. */
export function apiErrors(error: unknown): string[] {
  if (error instanceof HttpErrorResponse) {
    const details = error.error?.details;
    if (Array.isArray(details) && details.length) return details;
    if (error.status === 0) return ['Il server non risponde. Riprova tra qualche istante.'];
    return [`Errore ${error.status}: ${error.statusText || 'richiesta non riuscita'}`];
  }
  return ['Errore imprevisto.'];
}
