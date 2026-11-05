import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API } from '../../core/http/api';
import { TimeSlot } from '../../shared/models/agenda.models';

/** Body of POST /api/timeslots: one slot per weekday. */
export interface TimeSlotCreateRequest {
  resourceCode: string;
  agendaName: string;
  weekdays: string[];
  startTime: string;
  endTime: string;
  startDate: string;
  endDate: string;
  priority: 'U' | 'B' | 'D' | 'P';
}

@Injectable({ providedIn: 'root' })
export class TimeSlotApiService {
  private readonly http = inject(HttpClient);

  create(request: TimeSlotCreateRequest): Observable<TimeSlot[]> {
    return this.http.post<TimeSlot[]>(`${API}/timeslots`, request);
  }
}
