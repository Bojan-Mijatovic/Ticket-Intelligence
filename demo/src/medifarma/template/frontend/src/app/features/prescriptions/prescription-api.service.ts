import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API } from '../../core/http/api';
import { PrescriptionRequest, PrescriptionView, SafetyCheck } from '../../shared/models/farma.models';

@Injectable({ providedIn: 'root' })
export class PrescriptionApiService {
  private readonly http = inject(HttpClient);

  list(status: string): Observable<PrescriptionView[]> {
    return this.http.get<PrescriptionView[]>(`${API}/prescriptions`, { params: status ? { status } : {} });
  }

  get(id: string): Observable<PrescriptionView> {
    return this.http.get<PrescriptionView>(`${API}/prescriptions/${id}`);
  }

  issue(request: PrescriptionRequest): Observable<PrescriptionView> {
    return this.http.post<PrescriptionView>(`${API}/prescriptions`, request);
  }

  cancel(id: string): Observable<PrescriptionView> {
    return this.http.post<PrescriptionView>(`${API}/prescriptions/${id}/cancel`, {});
  }

  /** The checks of the prescription being written: interactions and renal dose rules. */
  check(patientId: number, aics: string[]): Observable<SafetyCheck> {
    return this.http.post<SafetyCheck>(`${API}/safety/check`, { patientId, aics });
  }
}
