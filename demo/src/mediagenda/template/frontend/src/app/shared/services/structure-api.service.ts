import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API } from '../../core/http/api';
import { Structure } from '../models/agenda.models';

@Injectable({ providedIn: 'root' })
export class StructureApiService {
  private readonly http = inject(HttpClient);

  search(query: string): Observable<Structure[]> {
    return this.http.get<Structure[]>(`${API}/structures`, { params: { q: query } });
  }
}
