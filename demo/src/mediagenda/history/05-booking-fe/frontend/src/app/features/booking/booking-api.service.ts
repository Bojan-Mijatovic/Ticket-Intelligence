import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API } from '../../core/http/api';

export interface Booking {
  id: string;
  patientId: number;
  timeSlotId: number;
  appointmentAt: string;
  status: string;
}

@Injectable({ providedIn: 'root' })
export class BookingApiService {
  private readonly http = inject(HttpClient);

  list(): Observable<Booking[]> {
    return this.http.get<Booking[]>(`${API}/bookings`);
  }
}
