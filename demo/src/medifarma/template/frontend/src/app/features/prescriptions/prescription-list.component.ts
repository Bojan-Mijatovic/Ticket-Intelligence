import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrors } from '../../core/http/api-errors';
import { PRESCRIPTION_STATUS } from '../../core/i18n/labels';
import { PrescriptionView } from '../../shared/models/farma.models';
import { PrescriptionApiService } from './prescription-api.service';

@Component({
  selector: 'app-prescription-list',
  standalone: true,
  imports: [FormsModule, DatePipe, RouterLink],
  template: `
    <section class="card">
      <div class="toolbar">
        <h1 class="page-title">Prescrizioni</h1>
        <a class="btn-primary" routerLink="/prescrizioni/nuova" id="new-prescription">NUOVA PRESCRIZIONE</a>
      </div>
      <div class="row">
        <select id="status-filter" name="status" [(ngModel)]="status" (ngModelChange)="load()">
          <option value="">Tutte</option>
          @for (s of statuses; track s[0]) { <option [value]="s[0]">{{ s[1] }}</option> }
        </select>
      </div>
      @if (message()) { <div class="alert success" id="prescription-message">{{ message() }}</div> }
      @if (errors().length) { <div class="alert error" id="prescription-errors">@for (e of errors(); track e) { <div>{{ e }}</div> }</div> }
      <table class="table" id="prescriptions-table">
        <thead><tr><th>Prescrizione</th><th>Data</th><th>Paziente</th><th>Farmaci</th><th class="num">eGFR</th><th>Stato</th><th></th></tr></thead>
        <tbody>
          @for (p of prescriptions(); track p.id) {
            <tr>
              <td><b>{{ p.id }}</b></td>
              <td>{{ p.issuedAt | date: 'dd/MM/yyyy HH:mm' }}</td>
              <td>{{ p.patientName }}</td>
              <td>{{ drugNames(p) }}</td>
              <td class="num">{{ p.egfr ?? '–' }}</td>
              <td><span [class]="'chip ' + p.status.toLowerCase()">{{ statusLabel(p.status) }}</span></td>
              <td class="actions">
                @if (p.status === 'EMESSA') {
                  <a class="btn-text" [routerLink]="['/erogazione', p.id]">Eroga</a>
                  <button type="button" class="btn-text" (click)="cancel(p)">Annulla</button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="7" class="muted">Nessuna prescrizione.</td></tr>
          }
        </tbody>
      </table>
    </section>
  `,
  styles: `
    .row { display: flex; gap: 8px; margin-bottom: 12px; }
    .actions { display: flex; gap: 4px; }
  `,
})
export class PrescriptionListComponent {
  private readonly api = inject(PrescriptionApiService);
  readonly statuses = Object.entries(PRESCRIPTION_STATUS);
  status = '';
  readonly prescriptions = signal<PrescriptionView[]>([]);
  readonly message = signal('');
  readonly errors = signal<string[]>([]);

  constructor() {
    this.load();
  }

  load(): void {
    this.api.list(this.status).subscribe({ next: (list) => this.prescriptions.set(list), error: (e) => this.errors.set(apiErrors(e)) });
  }

  statusLabel(status: string): string {
    return PRESCRIPTION_STATUS[status] ?? status;
  }

  drugNames(p: PrescriptionView): string {
    return p.items.map((i) => i.name).join(', ');
  }

  cancel(p: PrescriptionView): void {
    this.api.cancel(p.id).subscribe({
      next: (done) => { this.message.set(`${done.id} annullata`); this.errors.set([]); this.load(); },
      error: (e) => this.errors.set(apiErrors(e)),
    });
  }
}
