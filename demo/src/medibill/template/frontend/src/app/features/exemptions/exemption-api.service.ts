import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API } from '../../core/http/api';
import { Exemption, ExemptionType } from '../../shared/models/bill.models';

@Injectable({ providedIn: 'root' })
export class ExemptionApiService {
  private readonly http = inject(HttpClient);

  list(): Observable<Exemption[]> {
    return this.http.get<Exemption[]>(`${API}/exemptions`);
  }

  types(): Observable<ExemptionType[]> {
    return this.http.get<ExemptionType[]>(`${API}/exemptions/types`);
  }

  register(patientId: number, code: string, validFrom: string, validTo: string): Observable<Exemption> {
    return this.http.post<Exemption>(`${API}/exemptions`, { patientId, code, validFrom, validTo });
  }
}
