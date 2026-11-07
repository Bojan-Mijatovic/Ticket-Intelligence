import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API } from '../../core/http/api';
import { Drug, StockRow } from '../../shared/models/farma.models';

@Injectable({ providedIn: 'root' })
export class DrugApiService {
  private readonly http = inject(HttpClient);

  search(q: string): Observable<Drug[]> {
    return this.http.get<Drug[]>(`${API}/drugs`, { params: { q } });
  }

  stock(): Observable<StockRow[]> {
    return this.http.get<StockRow[]>(`${API}/stock`);
  }

  /** Lots with packs left that expire within `days` days (or have expired). */
  expiring(days: number): Observable<StockRow[]> {
    return this.http.get<StockRow[]>(`${API}/stock/expiring`, { params: { days } });
  }
}
