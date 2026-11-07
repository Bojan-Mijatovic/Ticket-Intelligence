/** UI labels (Italian, as used by the pharmacy and the wards). */
export const LABELS = {
  search: 'RICERCA',
  issue: 'EMETTI',
  dispense: 'EROGA',
} as const;

/** Status of a prescription, as the lists show it. */
export const PRESCRIPTION_STATUS: Record<string, string> = {
  EMESSA: 'Emessa',
  DISPENSATA: 'Erogata',
  ANNULLATA: 'Annullata',
};

/** Type of a warning of the prescription checks. */
export const WARNING_TYPE: Record<string, string> = {
  RENE: 'Funzione renale',
  INTERAZIONE: 'Interazione',
  INFO: 'Informazione',
};
