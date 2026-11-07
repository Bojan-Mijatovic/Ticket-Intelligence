import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API } from '../../core/http/api';
import { Receipt } from '../../shared/models/bill.models';

@Injectable({ providedIn: 'root' })
export class ReceiptApiService {
  private readonly http = inject(HttpClient);

  list(status: string): Observable<Receipt[]> {
    return this.http.get<Receipt[]>(`${API}/receipts`, { params: status ? { status } : {} });
  }

  /** One receipt for every open charge of the patient. */
  issue(fiscalCode: string): Observable<Receipt> {
    return this.http.post<Receipt>(`${API}/receipts`, { fiscalCode });
  }

  pay(id: string): Observable<Receipt> {
    return this.http.post<Receipt>(`${API}/receipts/${id}/pay`, {});
  }

  storno(id: string): Observable<Receipt> {
    return this.http.post<Receipt>(`${API}/receipts/${id}/storno`, {});
  }
}
