import { Component, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject, debounceTime, switchMap } from 'rxjs';
import { apiErrors } from '../../core/http/api-errors';
import { PatientPickerComponent } from '../../shared/components/patient-picker/patient-picker.component';
import { Drug, PatientInfo, PrescriptionView } from '../../shared/models/farma.models';
import { DrugApiService } from '../drugs/drug-api.service';
import { PrescriptionApiService } from './prescription-api.service';

/** One drug of the prescription being written. */
interface Row {
  rowId: number;
  aic: string;
  name: string;
  dose: string;
  frequency: string;
  days: number;
  packs: number;
}

@Component({
  selector: 'app-prescription-form',
  standalone: true,
  imports: [FormsModule, RouterLink, PatientPickerComponent],
  template: `
    <section class="card">
      <div class="toolbar">
        <h1 class="page-title">Nuova prescrizione</h1>
        <a class="btn-text" routerLink="/prescrizioni">Torna alle prescrizioni</a>
      </div>
      @if (issued(); as rx) { <div class="alert success" id="prescription-issued">Prescrizione <b>{{ rx.id }}</b> emessa per {{ rx.patientName }}</div> }
      @if (errors().length) { <div class="alert error" id="prescription-errors">@for (e of errors(); track e) { <div>{{ e }}</div> }</div> }

      <div class="form-grid">
        <div class="form-field wide">
          <span class="label required">Paziente</span>
          <app-patient-picker (picked)="onPatient($event)" />
          @if (patient(); as p) { <div class="muted" id="patient-picked">{{ p.lastName }} {{ p.firstName }} · {{ p.fiscalCode }} · {{ p.sex }}</div> }
        </div>
        <div class="form-field">
          <label for="prescriber" class="required">Medico prescrittore</label>
          <input id="prescriber" type="text" name="prescriber" [(ngModel)]="prescriber" />
        </div>
        <div class="form-field">
          <label for="drug-search">Aggiungi farmaco</label>
          <div class="drug-picker">
            <input id="drug-search" type="text" autocomplete="off" placeholder="Nome o principio attivo" [value]="drugText()"
                   (input)="onDrugInput($any($event.target).value)" (blur)="drugs.set([])" />
            @if (drugs().length) {
              <ul class="drug-suggestions">
                @for (d of drugs(); track d.aic) { <li (mousedown)="add(d)">{{ d.name }} <span class="muted">· {{ d.activeIngredient }}</span></li> }
              </ul>
            }
          </div>
        </div>
      </div>

      <table class="table" id="items-table">
        <thead><tr><th>Farmaco</th><th>Dose</th><th>Frequenza</th><th class="num">Giorni</th><th class="num">Confezioni</th><th></th></tr></thead>
        <tbody>
          @for (row of rows(); track row.rowId) {
            <tr>
              <td><b>{{ row.name }}</b></td>
              <td><input type="text" [name]="'dose-' + row.rowId" [(ngModel)]="row.dose" /></td>
              <td><input type="text" [name]="'frequency-' + row.rowId" [(ngModel)]="row.frequency" /></td>
              <td class="num"><input class="small" type="number" min="1" [name]="'days-' + row.rowId" [(ngModel)]="row.days" /></td>
              <td class="num"><input class="small" type="number" min="1" [name]="'packs-' + row.rowId" [(ngModel)]="row.packs" /></td>
              <td><button type="button" class="btn-text remove" (click)="remove(row)">Rimuovi</button></td>
            </tr>
          } @empty {
            <tr><td colspan="6" class="muted">Nessun farmaco.</td></tr>
          }
        </tbody>
      </table>

      <div class="form-actions">
        <button type="button" class="btn-primary" id="issue-prescription" [disabled]="!canIssue()" (click)="issue()">EMETTI</button>
      </div>
    </section>
  `,
  styles: `
    .drug-picker { position: relative; }
    .drug-picker input { width: 100%; min-width: 0; }
    .drug-suggestions { position: absolute; z-index: 5; left: 0; right: 0; margin: 2px 0 0; padding: 4px 0; list-style: none;
      background: var(--surface); border: 1px solid var(--border); border-radius: 6px; box-shadow: 0 6px 16px rgb(0 0 0 / 0.08); }
    .drug-suggestions li { padding: 6px 10px; cursor: pointer; }
    .drug-suggestions li:hover { background: var(--primary-soft); }
    #items-table { margin-top: 16px; }
    #items-table input[type='text'] { min-width: 140px; }
    input.small { width: 70px; }
  `,
})
export class PrescriptionFormComponent {
  @ViewChild(PatientPickerComponent) picker?: PatientPickerComponent;
  private readonly api = inject(PrescriptionApiService);
  private readonly drugApi = inject(DrugApiService);
  private readonly typed = new Subject<string>();
  private nextRow = 1;

  prescriber = '';
  readonly patient = signal<PatientInfo | null>(null);
  readonly items = signal<Row[]>([]);
  /** Rows as shown: by drug name. */
  readonly rows = computed(() => [...this.items()].sort((a, b) => a.name.localeCompare(b.name)));
  readonly drugText = signal('');
  readonly drugs = signal<Drug[]>([]);
  readonly issued = signal<PrescriptionView | null>(null);
  readonly errors = signal<string[]>([]);

  constructor() {
    this.typed
      .pipe(debounceTime(200), switchMap((q) => this.drugApi.search(q)))
      .subscribe((list) => this.drugs.set(this.drugText().trim().length >= 2 ? list : []));
  }

  onPatient(p: PatientInfo | null): void {
    this.patient.set(p);
  }

  onDrugInput(value: string): void {
    this.drugText.set(value);
    if (value.trim().length >= 2) this.typed.next(value.trim());
    else this.drugs.set([]);
  }

  add(d: Drug): void {
    this.items.update((list) => [...list, { rowId: this.nextRow++, aic: d.aic, name: d.name, dose: '1 compressa', frequency: '1 volta al giorno', days: 30, packs: 1 }]);
    this.drugText.set('');
    this.drugs.set([]);
  }

  remove(row: Row): void {
    this.items.update((list) => list.filter((x) => x.rowId !== row.rowId));
  }

  canIssue(): boolean {
    return this.patient() !== null && this.prescriber.trim() !== '' && this.items().length > 0;
  }

  issue(): void {
    const p = this.patient();
    if (!p || !this.canIssue()) return;
    const items = this.items().map(({ aic, dose, frequency, days, packs }) => ({ aic, dose, frequency, days: Number(days), packs: Number(packs) }));
    this.api.issue({ patientId: p.id, prescriber: this.prescriber.trim(), items }).subscribe({
      next: (rx) => {
        this.issued.set(rx);
        this.errors.set([]);
        this.items.set([]);
        this.patient.set(null);
        this.picker?.clear();
      },
      error: (e) => this.errors.set(apiErrors(e)),
    });
  }
}
