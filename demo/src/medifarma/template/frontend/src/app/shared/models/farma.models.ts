/** Shapes of the MediFarma API (see the backend records with the same names). */

export interface Drug {
  aic: string;
  name: string;
  activeIngredient: string;
  atc: string;
  packSize: number;
  unitPrice: number;
  minStock: number;
  active: boolean;
  renalReduceBelow: number | null;
  renalAvoidBelow: number | null;
  renalNote: string | null;
}

/** A patient of the MediAgenda registry. */
export interface PatientInfo {
  id: number;
  fiscalCode: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  sex: 'M' | 'F';
}

export interface Warning {
  type: 'RENE' | 'INTERAZIONE' | 'INFO';
  severity: 'ALTA' | 'MEDIA' | 'INFO';
  aic: string | null;
  drug: string | null;
  message: string;
}

export interface SafetyCheck {
  patientId: number;
  patientName: string;
  creatinine: number | null;
  creatinineUnit: string | null;
  creatinineDate: string | null;
  egfr: number | null;
  warnings: Warning[];
}

export interface PrescriptionItemView {
  aic: string;
  name: string;
  dose: string;
  frequency: string;
  days: number;
  packs: number;
}

export interface PrescriptionView {
  id: string;
  patientId: number;
  fiscalCode: string;
  patientName: string;
  sex: 'M' | 'F';
  birthDate: string;
  prescriber: string;
  status: string;
  issuedAt: string;
  egfr: number | null;
  warningsAcknowledged: boolean;
  items: PrescriptionItemView[];
}

/** Body of POST /api/prescriptions. */
export interface PrescriptionRequest {
  patientId: number;
  prescriber: string;
  acknowledgeWarnings: boolean;
  items: { aic: string; dose: string; frequency: string; days: number; packs: number }[];
}

export interface DispensingView {
  id: number;
  prescriptionId: string;
  patientName: string;
  dispensedAt: string;
  lines: { aic: string; name: string; lotNumber: string; expiry: string | null; packs: number }[];
}

export interface LotView {
  lotNumber: string;
  expiry: string;
  quantity: number;
  expired: boolean;
  daysLeft: number;
}

export interface StockRow {
  aic: string;
  name: string;
  available: number;
  minStock: number;
  low: boolean;
  lots: LotView[];
}
