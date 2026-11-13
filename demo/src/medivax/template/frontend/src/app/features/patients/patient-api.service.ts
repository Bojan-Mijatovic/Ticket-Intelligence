import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API } from '../../core/http/api';
import { DoseRequest, DoseView, Lot, Patient, PatientCard, Vaccine } from '../../shared/models/vax.models';

@Injectable({ providedIn: 'root' })
export class PatientApiService {
  private readonly http = inject(HttpClient);

  search(q: string): Observable<Patient[]> {
    return this.http.get<Patient[]>(`${API}/patients`, { params: new HttpParams().set('q', q) });
  }

  card(id: number): Observable<PatientCard> {
    return this.http.get<PatientCard>(`${API}/patients/${id}/card`);
  }

  vaccines(): Observable<Vaccine[]> {
    return this.http.get<Vaccine[]>(`${API}/vaccines`);
  }

  lots(vaccineCode: string): Observable<Lot[]> {
    return this.http.get<Lot[]>(`${API}/lots`, { params: new HttpParams().set('vaccine', vaccineCode) });
  }

  recordDose(request: DoseRequest): Observable<DoseView> {
    return this.http.post<DoseView>(`${API}/doses`, request);
  }
}
