import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API } from '../../core/http/api';
import { PatientInfo } from '../models/bill.models';

/** The MediAgenda patient registry, through the MediBill backend (GET /api/mediagenda/patients). */
@Injectable({ providedIn: 'root' })
export class MediAgendaApiService {
  private readonly http = inject(HttpClient);

  searchPatients(q: string): Observable<PatientInfo[]> {
    return this.http.get<PatientInfo[]>(`${API}/mediagenda/patients`, { params: { q } });
  }
}
