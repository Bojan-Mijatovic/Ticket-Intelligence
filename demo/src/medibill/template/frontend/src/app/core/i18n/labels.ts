/** UI labels (Italian, as used by the billing office). */
export const LABELS = {
  import: 'IMPORTA',
  issue: 'EMETTI RICEVUTA',
  pay: 'PAGA',
  storno: 'STORNA',
} as const;

export const RECEIPT_STATUS: Record<string, string> = {
  EMESSA: 'Da pagare',
  PAGATA: 'Pagata',
  STORNATA: 'Stornata',
};

export const SOURCE: Record<string, string> = {
  VISITA: 'Visita (MediAgenda)',
  LABORATORIO: 'Analisi (MediLab)',
};
