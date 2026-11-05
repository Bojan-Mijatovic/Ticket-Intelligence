import { DatePipe } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Booking } from './booking-api.service';

export const CANCEL_REASONS = ['Richiesta del paziente', "Indisponibilità dell'erogatore", 'Errore di inserimento', 'Altro'];

/** "Annulla prenotazione" dialog (CUP_DEMO-2533): a reason is required; "Altro" needs a note. */
@Component({
  selector: 'app-booking-cancel-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, DatePipe],
  template: `
    <div class="dialog-backdrop" (click)="closed.emit()">
      <form class="dialog" id="cancel-dialog" [formGroup]="form" (ngSubmit)="submit()" (click)="$event.stopPropagation()">
        <h2>Annulla prenotazione {{ booking.id }}</h2>
        <p class="muted">{{ booking.patientName }} · {{ booking.appointmentAt | date: 'dd/MM/yyyy HH:mm' }} · {{ booking.agendaName }}</p>
        <div class="form-field">
          <label class="required" for="cancel-reason">Motivo</label>
          <select id="cancel-reason" formControlName="reason">
            <option value="">Seleziona…</option>
            @for (r of reasons; track r) { <option [value]="r">{{ r }}</option> }
          </select>
        </div>
        @if (form.controls.reason.value === 'Altro') {
          <div class="form-field" style="margin-top: 10px">
            <label class="required" for="cancel-note">Specificare</label>
            <textarea id="cancel-note" rows="2" formControlName="note" maxlength="150"></textarea>
          </div>
        }
        <div class="form-actions">
          <button type="button" class="btn-text" (click)="closed.emit()">CHIUDI</button>
          <button type="submit" class="btn-primary" id="confirm-cancel" [disabled]="!valid()">CONFERMA ANNULLAMENTO</button>
        </div>
      </form>
    </div>
  `,
})
export class BookingCancelDialogComponent {
  @Input({ required: true }) booking!: Booking;
  @Output() readonly confirmed = new EventEmitter<string>();
  @Output() readonly closed = new EventEmitter<void>();

  readonly reasons = CANCEL_REASONS;
  readonly form = new FormGroup({
    reason: new FormControl('', { nonNullable: true, validators: Validators.required }),
    note: new FormControl('', { nonNullable: true }),
  });

  valid(): boolean {
    const { reason, note } = this.form.getRawValue();
    return !!reason && (reason !== 'Altro' || note.trim().length > 0);
  }

  submit(): void {
    if (!this.valid()) return;
    const { reason, note } = this.form.getRawValue();
    this.confirmed.emit(reason === 'Altro' ? `Altro: ${note.trim()}` : reason);
  }
}
