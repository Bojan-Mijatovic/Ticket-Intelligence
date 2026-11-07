import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API } from '../../core/http/api';
import { ResultEntry, ResultSheet } from '../../shared/models/lab.models';

@Injectable({ providedIn: 'root' })
export class ResultApiService {
  private readonly http = inject(HttpClient);

  sheet(orderId: string): Observable<ResultSheet> {
    return this.http.get<ResultSheet>(`${API}/orders/${orderId}/results`);
  }

  save(orderId: string, entries: ResultEntry[]): Observable<ResultSheet> {
    return this.http.put<ResultSheet>(`${API}/orders/${orderId}/results`, entries);
  }

  validate(orderId: string, validatedBy: string): Observable<ResultSheet> {
    return this.http.post<ResultSheet>(`${API}/orders/${orderId}/validate`, { validatedBy });
  }

  report(orderId: string): Observable<ResultSheet> {
    return this.http.get<ResultSheet>(`${API}/orders/${orderId}/report`);
  }
}
