import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apiErrors } from '../../core/http/api-errors';
import { DispensingView, PrescriptionView } from '../../shared/models/farma.models';
import { PrescriptionApiService } from '../prescriptions/prescription-api.service';
import { DispensingApiService } from './dispensing-api.service';

/** "Erogazione": hands a prescription out from stock; the backend picks the lots (first expiry first). */
@Component({
  selector: 'app-dispensing',
  standalone: true,
  imports: [DatePipe, RouterLink],
  template: `
    <section class="card">
      <div class="toolbar">
        <h1 class="page-title">Erogazione</h1>
        <a class="btn-text" routerLink="/prescrizioni">Torna alle prescrizioni</a>
      </div>
      @if (errors().length) { <div class="alert error" id="dispensing-errors">@for (e of errors(); track e) { <div>{{ e }}</div> }</div> }
      @if (prescription(); as p) {
        <p class="hint"><b>{{ p.id }}</b> · {{ p.patientName }} · {{ p.fiscalCode }} · {{ p.prescriber }} · {{ p.issuedAt | date: 'dd/MM/yyyy HH:mm' }}
          · <span [class]="'chip ' + p.status.toLowerCase()">{{ p.status }}</span></p>
        <table class="table" id="prescription-items">
          <thead><tr><th>Farmaco</th><th>Posologia</th><th class="num">Giorni</th><th class="num">Confezioni</th></tr></thead>
          <tbody>
            @for (i of p.items; track $index) {
              <tr><td><b>{{ i.name }}</b></td><td>{{ i.dose }}, {{ i.frequency }}</td><td class="num">{{ i.days }}</td><td class="num">{{ i.packs }}</td></tr>
            }
          </tbody>
        </table>
        <div class="form-actions">
          <button type="button" class="btn-primary" id="dispense" [disabled]="busy() || p.status !== 'EMESSA'" (click)="dispense(p)">EROGA</button>
        </div>
      }
      @for (d of dispensings(); track d.id) {
        <div class="alert success dispensed" id="dispensed">
          Erogata il {{ d.dispensedAt | date: 'dd/MM/yyyy HH:mm' }}:
          <ul>@for (l of d.lines; track $index) { <li>{{ l.name }}: {{ l.packs }} conf. dal lotto {{ l.lotNumber }} (scad. {{ l.expiry | date: 'dd/MM/yyyy' }})</li> }</ul>
        </div>
      }
    </section>
  `,
})
export class DispensingComponent {
  private readonly prescriptions = inject(PrescriptionApiService);
  private readonly api = inject(DispensingApiService);
  private readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';
  readonly prescription = signal<PrescriptionView | null>(null);
  readonly dispensings = signal<DispensingView[]>([]);
  readonly busy = signal(false);
  readonly errors = signal<string[]>([]);

  constructor() {
    this.prescriptions.get(this.id).subscribe({ next: (p) => this.prescription.set(p), error: (e) => this.errors.set(apiErrors(e)) });
    this.api.list(this.id).subscribe((list) => this.dispensings.set(list));
  }

  dispense(p: PrescriptionView): void {
    // A double click must not send two requests: the second one would hand the drugs out again.
    if (this.busy()) return;
    this.busy.set(true);
    this.api.dispense(p.id).subscribe({
      next: (d) => {
        this.dispensings.update((list) => [d, ...list]);
        this.prescription.set({ ...p, status: 'DISPENSATA' });
        this.errors.set([]);
        this.busy.set(false);
      },
      error: (e) => { this.errors.set(apiErrors(e)); this.busy.set(false); },
    });
  }
}
