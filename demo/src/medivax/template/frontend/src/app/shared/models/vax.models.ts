// The shapes the MediVax backend returns (dates as "yyyy-MM-dd").

export interface Patient {
  id: number;
  fiscalCode: string;
  lastName: string;
  firstName: string;
  sex: 'M' | 'F';
  birthDate: string;
  birthPlace: string;
  phone: string | null;
  healthCard: string | null;
}

export interface Vaccine {
  code: string;
  name: string;
  doses: number;
  intervalDays: number;
  minAgeMonths: number;
  maxAgeYears: number | null;
  boosterMonths: number | null;
}

export interface Lot {
  code: string;
  vaccineCode: string;
  expiry: string;
  dosesLeft: number;
}

export interface DoseView {
  id: number;
  vaccineCode: string;
  vaccineName: string;
  doseNumber: number;
  givenOn: string;
  lotCode: string;
}

export interface NextDose {
  vaccineCode: string;
  vaccineName: string;
  doseNumber: number;
  dueOn: string;
  booster: boolean;
}

export interface PatientCard {
  patient: Patient;
  doses: DoseView[];
  next: NextDose[];
}

export interface DoseRequest {
  patientId: number;
  vaccineCode: string;
  givenOn: string;
  lotCode: string;
}

export interface DueRow {
  patientId: number;
  patientName: string;
  fiscalCode: string;
  phone: string | null;
  vaccineCode: string;
  vaccineName: string;
  doseNumber: number;
  dueOn: string;
  booster: boolean;
}
