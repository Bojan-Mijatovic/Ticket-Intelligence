import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API } from '../../core/http/api';

export interface Patient {
  id: number;
  fiscalCode: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  sex: 'M' | 'F';
  city: string | null;
  phone: string | null;
  email: string | null;
}

/** Body of POST /api/patients and PUT /api/patients/{id}. */
export type PatientRequest = Omit<Patient, 'id'>;

export interface PageResponse<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
}

@Injectable({ providedIn: 'root' })
export class PatientApiService {
  private readonly http = inject(HttpClient);

  search(q: string, page: number, size = 5): Observable<PageResponse<Patient>> {
    return this.http.get<PageResponse<Patient>>(`${API}/patients`, { params: { q, page, size } });
  }

  get(id: number): Observable<Patient> {
    return this.http.get<Patient>(`${API}/patients/${id}`);
  }

  create(patient: PatientRequest): Observable<Patient> {
    return this.http.post<Patient>(`${API}/patients`, patient);
  }

  update(id: number, patient: PatientRequest): Observable<Patient> {
    return this.http.put<Patient>(`${API}/patients/${id}`, patient);
  }
}
