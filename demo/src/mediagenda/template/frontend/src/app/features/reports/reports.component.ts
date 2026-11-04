import { AsyncPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { API } from '../../core/http/api';

interface MonthlyBookings {
  month: string;
  structureId: string;
  bookings: number;
}

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [AsyncPipe],
  template: `
    <section class="card">
      <h1 class="page-title">Report: prenotazioni per mese</h1>
      <table class="table">
        <thead><tr><th>Mese</th><th>Struttura</th><th class="num">Prenotazioni</th></tr></thead>
        <tbody>
          @for (r of rows$ | async; track r.month + r.structureId) {
            <tr><td>{{ r.month }}</td><td>{{ r.structureId }}</td><td class="num">{{ r.bookings }}</td></tr>
          }
        </tbody>
      </table>
    </section>
  `,
})
export class ReportsComponent {
  readonly rows$ = inject(HttpClient).get<MonthlyBookings[]>(`${API}/reports/monthly-bookings`);
}
