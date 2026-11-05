import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BookingApiService } from './booking-api.service';

@Component({
  selector: 'app-booking-list',
  standalone: true,
  imports: [AsyncPipe, DatePipe, RouterLink],
  template: `
    <section class="card">
      <div class="toolbar">
        <h1 class="page-title">Prenotazioni</h1>
        <a class="btn-primary" routerLink="/prenotazioni/nuova" id="new-booking">NUOVA PRENOTAZIONE</a>
      </div>
      <table class="table" id="bookings-table">
        <thead><tr><th>Codice</th><th>Appuntamento</th><th>Paziente</th><th>Agenda</th><th>Priorità</th><th>Stato</th></tr></thead>
        <tbody>
          @for (b of bookings$ | async; track b.id) {
            <tr>
              <td>{{ b.id }}</td>
              <td>{{ b.appointmentAt | date: 'dd/MM/yyyy HH:mm' }}</td>
              <td>{{ b.patientName }} <span class="muted">{{ b.fiscalCode }}</span></td>
              <td>{{ b.agendaName }} <span class="muted">{{ b.structureId }}</span></td>
              <td>{{ b.priority }}</td>
              <td>{{ b.status }}</td>
            </tr>
          }
        </tbody>
      </table>
    </section>
  `,
  styles: `a.btn-primary { text-decoration: none; display: inline-block; }`,
})
export class BookingListComponent {
  readonly bookings$ = inject(BookingApiService).list();
}
