import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API } from '../../core/http/api';

export type Priority = 'U' | 'B' | 'D' | 'P';

export interface Booking {
  id: string;
  appointmentAt: string;
  status: string;
  priority: Priority | null;
  patientId: number;
  patientName: string;
  fiscalCode: string;
  timeSlotId: number;
  agendaName: string;
  structureId: string;
  resourceCode: string;
  prescriptionCode: string | null;
  notes: string | null;
}

/** Body of POST /api/bookings. */
export interface BookingRequest {
  patientId: number;
  timeSlotId: number;
  appointmentAt: string;
  priority: Priority;
  prescriptionCode: string | null;
  notes: string | null;
}

/** A free appointment time (GET /api/agenda/availability). */
export interface AvailableTime {
  timeSlotId: number;
  startAt: string;
  agendaName: string;
  priority: string;
  structureId: string;
}

/** Priority classes of the prescription, as printed on it. */
export const PRIORITIES: { code: Priority; label: string }[] = [
  { code: 'U', label: 'U - Urgente (entro 72 ore)' },
  { code: 'B', label: 'B - Breve (entro 10 giorni)' },
  { code: 'D', label: 'D - Differibile (entro 30/60 giorni)' },
  { code: 'P', label: 'P - Programmata (entro 120 giorni)' },
];

@Injectable({ providedIn: 'root' })
export class BookingApiService {
  private readonly http = inject(HttpClient);

  list(): Observable<Booking[]> {
    return this.http.get<Booking[]>(`${API}/bookings`);
  }

  create(booking: BookingRequest): Observable<Booking> {
    return this.http.post<Booking>(`${API}/bookings`, booking);
  }

  availability(resourceCode: string, date: string): Observable<AvailableTime[]> {
    return this.http.get<AvailableTime[]>(`${API}/agenda/availability`, { params: { resourceCode, date } });
  }
}
