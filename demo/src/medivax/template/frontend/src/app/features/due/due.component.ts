import { HttpClient, HttpParams } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { API } from '../../core/http/api';
import { apiErrors } from '../../core/http/api-errors';
import { DueRow } from '../../shared/models/vax.models';
import { addDays, formatDate, today, weekOf } from '../../shared/utils/dates';
import { doseLabel } from '../../shared/utils/labels';

/** "Scadenze": the doses due in a week, Monday to Sunday, to call the patients. */
@Component({
  selector: 'app-due',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <section class="card">
      <div class="toolbar">
        <h1 class="page-title">Scadenze</h1>
        <button type="button" class="btn-text" id="prev-week" (click)="move(-7)">← Settimana precedente</button>
        <input id="due-day" type="date" name="day" [(ngModel)]="day" (ngModelChange)="load()" />
        <button type="button" class="btn-text" id="next-week" (click)="move(7)">Settimana successiva →</button>
      </div>
      <p class="hint" id="due-range">Dal {{ formatDate(from) }} al {{ formatDate(to) }}</p>
      @if (errors().length) { <div class="alert error" id="due-errors">@for (e of errors(); track e) { <div>{{ e }}</div> }</div> }
      @if (rows().length) {
        <table class="table" id="due-table">
          <thead><tr><th>Dal</th><th>Paziente</th><th>Telefono</th><th>Vaccino</th><th>Dose</th></tr></thead>
          <tbody>
            @for (r of rows(); track r.patientId + r.vaccineCode) {
              <tr [attr.data-patient-id]="r.patientId">
                <td>{{ formatDate(r.dueOn) }}</td>
                <td><a [routerLink]="['/pazienti', r.patientId]">{{ r.patientName }}</a></td>
                <td>{{ r.phone }}</td>
                <td>{{ r.vaccineName }}</td>
                <td>@if (r.booster) { <span class="chip booster">{{ doseLabel(r.doseNumber, r.booster) }}</span> } @else { {{ doseLabel(r.doseNumber, r.booster) }} }</td>
              </tr>
            }
          </tbody>
        </table>
      } @else {
        <p class="muted" id="no-due">Nessuna dose in scadenza in questa settimana.</p>
      }
    </section>
  `,
})
export class DueComponent {
  private readonly http = inject(HttpClient);
  readonly rows = signal<DueRow[]>([]);
  readonly errors = signal<string[]>([]);
  readonly formatDate = formatDate;
  readonly doseLabel = doseLabel;
  day = today();
  from = '';
  to = '';

  constructor() {
    this.load();
  }

  move(days: number): void {
    this.day = addDays(this.day, days);
    this.load();
  }

  load(): void {
    if (!this.day) return;
    ({ from: this.from, to: this.to } = weekOf(this.day));
    const params = new HttpParams().set('from', this.from).set('to', this.to);
    this.http.get<DueRow[]>(`${API}/due`, { params }).subscribe({
      next: (list) => {
        this.rows.set(list);
        this.errors.set([]);
      },
      error: (e) => this.errors.set(apiErrors(e)),
    });
  }
}
