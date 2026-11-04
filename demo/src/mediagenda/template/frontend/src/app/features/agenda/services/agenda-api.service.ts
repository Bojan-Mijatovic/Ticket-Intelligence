import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API } from '../../../core/http/api';
import { AgendaResource, TimeSlot } from '../../../shared/models/agenda.models';

@Injectable({ providedIn: 'root' })
export class AgendaApiService {
  private readonly http = inject(HttpClient);

  resources(structureIds: string[]): Observable<AgendaResource[]> {
    return this.http.get<AgendaResource[]>(`${API}/resources`, { params: { structureIds: structureIds.join(',') } });
  }

  /** StructuretimeSlot service (CUP_DEMO-2398: accepts several structures). */
  structureTimeSlots(structureIds: string[]): Observable<TimeSlot[]> {
    return this.http.post<TimeSlot[]>(`${API}/agenda/structure-timeslots`, { structureIds });
  }
}
