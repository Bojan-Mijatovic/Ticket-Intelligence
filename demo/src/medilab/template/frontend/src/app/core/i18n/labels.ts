/** UI labels (Italian, as used by the laboratory staff). */
export const LABELS = {
  search: 'RICERCA',
  confirm: 'CONFERMA',
  save: 'SALVA',
  validate: 'VALIDA E REFERTA',
  accept: 'ACCETTA',
  reject: 'RIFIUTA',
  print: 'STAMPA',
} as const;

/** Status of a request, as the lists show it. */
export const ORDER_STATUS: Record<string, string> = {
  RICHIESTA: 'Richiesta',
  IN_LAVORAZIONE: 'In lavorazione',
  REFERTATA: 'Refertata',
  ANNULLATA: 'Annullata',
};

/** Sample types of the catalog. */
export const SAMPLE_TYPE: Record<string, string> = {
  SIERO: 'Siero (provetta gialla)',
  SANGUE: 'Sangue intero (provetta viola)',
};

/** Reasons for rejecting a tube at the acceptance desk. */
export const REJECT_REASONS = ['Emolizzato', 'Coagulato', 'Quantità insufficiente', 'Etichetta errata'] as const;
