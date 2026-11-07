/** Shapes of the MediBill API (see the backend records and entities with the same names). */

/** A patient of the MediAgenda registry. */
export interface PatientInfo {
  id: number;
  fiscalCode: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  sex: 'M' | 'F';
}

export interface Tariff {
  code: string;
  description: string;
  kind: 'VISITA' | 'LABORATORIO';
  price: number;
  mediagendaResource: string | null;
  active: boolean;
}

export interface Exemption {
  id: number;
  fiscalCode: string;
  patientName: string;
  code: string;
  description: string;
  total: boolean;
  tariffCodes: string;
  validFrom: string;
  validTo: string;
}

export interface ExemptionType {
  code: string;
  description: string;
  total: boolean;
}

export interface Charge {
  id: number;
  source: 'VISITA' | 'LABORATORIO';
  sourceRef: string;
  serviceDate: string;
  fiscalCode: string;
  patientName: string;
  tariffCode: string;
  description: string;
  amount: number;
  status: 'APERTO' | 'IN_RICEVUTA';
  receiptId: string | null;
}

export interface ImportResult {
  day: string;
  visits: number;
  tests: number;
  alreadyImported: number;
  skipped: string[];
}

export interface ReceiptLine {
  chargeId: number;
  serviceDate: string;
  source: string;
  tariffCode: string;
  description: string;
  amount: number;
  exempt: boolean;
}

export interface Receipt {
  id: string;
  fiscalCode: string;
  patientName: string;
  issuedAt: string;
  total: number;
  exempt: number;
  copay: number;
  exemptionCodes: string;
  status: 'EMESSA' | 'PAGATA' | 'STORNATA';
  paidAt: string | null;
  lines: ReceiptLine[];
}

export interface MonthlyReport {
  month: string;
  receipts: number;
  total: number;
  exempt: number;
  copay: number;
  collected: number;
  byStatus: Record<string, number>;
}
