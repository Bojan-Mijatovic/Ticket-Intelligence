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
}

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
}
