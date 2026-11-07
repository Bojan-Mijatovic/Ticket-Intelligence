import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API } from '../../core/http/api';
import { Exam, OrderRequest, OrderView } from '../../shared/models/lab.models';

@Injectable({ providedIn: 'root' })
export class OrderApiService {
  private readonly http = inject(HttpClient);

  /** GET /api/orders: an empty status or query is left out (all requests). */
  list(status: string, q: string): Observable<OrderView[]> {
    const params: Record<string, string> = {};
    if (status) params['status'] = status;
    if (q.trim()) params['q'] = q.trim();
    return this.http.get<OrderView[]>(`${API}/orders`, { params });
  }

  get(id: string): Observable<OrderView> {
    return this.http.get<OrderView>(`${API}/orders/${id}`);
  }

  create(request: OrderRequest): Observable<OrderView> {
    return this.http.post<OrderView>(`${API}/orders`, request);
  }

  cancel(id: string, reason: string): Observable<OrderView> {
    return this.http.post<OrderView>(`${API}/orders/${id}/cancel`, { reason });
  }

  exams(): Observable<Exam[]> {
    return this.http.get<Exam[]>(`${API}/exams`);
  }
}
