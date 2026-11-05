import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrors } from '../../core/http/api-errors';
import { BookingCancelDialogComponent } from './booking-cancel-dialog.component';
import { Booking, BookingApiService } from './booking-api.service';

@Component({
  selector: 'app-booking-list',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, BookingCancelDialogComponent],
  template: `
    <section class="card">
      <div class="toolbar">
        <h1 class="page-title">Prenotazioni</h1>
        <label class="muted" for="status-filter">Stato</label>
        <select id="status-filter" [(ngModel)]="status" (ngModelChange)="load()">
          <option value="">Tutte</option>
          <option value="CONFERMATA">Confermate</option>
          <option value="ANNULLATE">Annullate</option>
          <option value="COMPLETATA">Completate</option>
        </select>
        <a class="btn-primary" routerLink="/prenotazioni/nuova" id="new-booking">NUOVA PRENOTAZIONE</a>
      </div>

      @if (message()) { <div class="alert success" id="booking-message">{{ message() }}</div> }
      @if (errors().length) { <div class="alert error"><ul>@for (e of errors(); track e) {<li>{{ e }}</li>}</ul></div> }

      <table class="table" id="bookings-table">
        <thead>
          <tr><th>Codice</th><th>Appuntamento</th><th>Paziente</th><th>Agenda</th><th>Priorità</th><th>Stato</th><th></th></tr>
        </thead>
        <tbody>
          @for (b of bookings(); track b.id) {
            <tr>
              <td>{{ b.id }}</td>
              <td>{{ b.appointmentAt | date: 'dd/MM/yyyy HH:mm' }}</td>
              <td>{{ b.patientName }} <span class="muted">{{ b.fiscalCode }}</span></td>
              <td>{{ b.agendaName }} <span class="muted">{{ b.structureId }}</span></td>
              <td>{{ b.priority }}</td>
              <td><span [class]="'chip ' + b.status.toLowerCase()" [title]="b.cancelReason ?? ''">{{ b.status }}</span></td>
              <td>
                @if (b.status === 'CONFERMATA') {
                  <button type="button" class="btn-text cancel" (click)="toCancel.set(b)">Annulla</button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="7" class="muted">Nessuna prenotazione.</td></tr>
          }
        </tbody>
      </table>
    </section>

    @if (toCancel(); as b) {
      <app-booking-cancel-dialog [booking]="b" (confirmed)="cancel(b, $event)" (closed)="toCancel.set(null)" />
    }
  `,
  styles: `a.btn-primary { text-decoration: none; display: inline-block; }`,
})
export class BookingListComponent {
  private readonly api = inject(BookingApiService);

  status = '';
  readonly bookings = signal<Booking[]>([]);
  readonly toCancel = signal<Booking | null>(null);
  readonly message = signal('');
  readonly errors = signal<string[]>([]);

  constructor() {
    this.load();
  }

  load(): void {
    this.api.list(this.status).subscribe({ next: (list) => this.bookings.set(list), error: (e) => this.errors.set(apiErrors(e)) });
  }

  cancel(booking: Booking, reason: string): void {
    this.api.cancel(booking.id, reason).subscribe({
      next: () => {
        this.toCancel.set(null);
        this.message.set(`Prenotazione ${booking.id} annullata.`);
        this.load();
      },
      error: (e) => {
        this.toCancel.set(null);
        this.errors.set(apiErrors(e));
      },
    });
  }
}
