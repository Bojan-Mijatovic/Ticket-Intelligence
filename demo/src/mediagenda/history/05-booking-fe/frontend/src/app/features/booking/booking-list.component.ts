import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { BookingApiService } from './booking-api.service';

@Component({
  selector: 'app-booking-list',
  standalone: true,
  imports: [AsyncPipe, DatePipe],
  template: `
    <section class="card">
      <h1 class="page-title">Prenotazioni</h1>
      <table class="table">
        <thead><tr><th>Codice</th><th>Appuntamento</th><th class="num">Paziente</th><th class="num">Fascia</th><th>Stato</th></tr></thead>
        <tbody>
          @for (b of bookings$ | async; track b.id) {
            <tr>
              <td>{{ b.id }}</td><td>{{ b.appointmentAt | date: 'dd/MM/yyyy HH:mm' }}</td>
              <td class="num">{{ b.patientId }}</td><td class="num">{{ b.timeSlotId }}</td><td>{{ b.status }}</td>
            </tr>
          }
        </tbody>
      </table>
    </section>
  `,
})
export class BookingListComponent {
  readonly bookings$ = inject(BookingApiService).list();
}
