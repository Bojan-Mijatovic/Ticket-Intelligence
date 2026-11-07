/** Shapes of the MediLab API (see the backend records with the same names). */

export interface Exam {
  code: string;
  name: string;
  sampleType: string;
  unit: string;
  decimals: number;
  refMinM: number | null;
  refMaxM: number | null;
  refMinF: number | null;
  refMaxF: number | null;
  tariffCode: string;
  price: number;
  active: boolean;
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

export interface ExamRef {
  code: string;
  name: string;
  sampleType: string;
  tariffCode: string;
}

export interface SampleRef {
  barcode: string;
  sampleType: string;
  status: string;
}

export interface OrderView {
  id: string;
  patientId: number;
  fiscalCode: string;
  patientName: string;
  sex: 'M' | 'F';
  birthDate: string;
  prescriber: string;
  prescriptionCode: string | null;
  urgent: boolean;
  status: string;
  requestedAt: string;
  reportedAt: string | null;
  cancelReason: string | null;
  exams: ExamRef[];
  samples: SampleRef[];
}

/** Body of POST /api/orders. */
export interface OrderRequest {
  patientId: number;
  prescriber: string;
  prescriptionCode: string;
  urgent: boolean;
  examCodes: string[];
}

export interface SampleView {
  barcode: string;
  sampleType: string;
  status: string;
  acceptedAt: string | null;
  rejectReason: string | null;
  replacedBy: string | null;
  orderId: string;
  orderStatus: string;
  patientName: string;
  fiscalCode: string;
  urgent: boolean;
  examCodes: string[];
}

export interface ResultRow {
  examCode: string;
  name: string;
  sampleType: string;
  unit: string;
  decimals: number;
  refMin: number | null;
  refMax: number | null;
  value: number | null;
  flag: 'L' | 'N' | 'H' | null;
}

export interface ResultSheet {
  orderId: string;
  status: string;
  patientName: string;
  fiscalCode: string;
  sex: 'M' | 'F';
  birthDate: string;
  prescriber: string;
  requestedAt: string;
  reportedAt: string | null;
  validatedBy: string | null;
  rows: ResultRow[];
}

/** One value of PUT /api/orders/{id}/results. */
export interface ResultEntry {
  examCode: string;
  value: number;
}
