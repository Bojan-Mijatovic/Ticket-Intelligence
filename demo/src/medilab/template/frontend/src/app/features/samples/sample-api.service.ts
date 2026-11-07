import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API } from '../../core/http/api';
import { SampleView } from '../../shared/models/lab.models';

@Injectable({ providedIn: 'root' })
export class SampleApiService {
  private readonly http = inject(HttpClient);

  get(barcode: string): Observable<SampleView> {
    return this.http.get<SampleView>(`${API}/samples/${encodeURIComponent(barcode)}`);
  }

  accept(barcode: string): Observable<SampleView> {
    return this.http.post<SampleView>(`${API}/samples/${encodeURIComponent(barcode)}/accept`, {});
  }

  reject(barcode: string, reason: string): Observable<SampleView> {
    return this.http.post<SampleView>(`${API}/samples/${encodeURIComponent(barcode)}/reject`, { reason });
  }
}
