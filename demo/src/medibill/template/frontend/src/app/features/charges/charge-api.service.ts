import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API } from '../../core/http/api';
import { Charge, ImportResult } from '../../shared/models/bill.models';

@Injectable({ providedIn: 'root' })
export class ChargeApiService {
  private readonly http = inject(HttpClient);

  list(status: string): Observable<Charge[]> {
    return this.http.get<Charge[]>(`${API}/charges`, { params: status ? { status } : {} });
  }

  /** Imports the visits (MediAgenda) and tests (MediLab) of a day ("yyyy-MM-dd"). */
  importDay(date: string): Observable<ImportResult> {
    return this.http.post<ImportResult>(`${API}/charges/import`, {}, { params: { date } });
  }
}
