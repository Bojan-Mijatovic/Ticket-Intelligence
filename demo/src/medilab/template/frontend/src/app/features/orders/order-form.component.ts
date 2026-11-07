import { Component, ViewChild, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrors } from '../../core/http/api-errors';
import { SAMPLE_TYPE } from '../../core/i18n/labels';
import { PatientPickerComponent } from '../../shared/components/patient-picker/patient-picker.component';
import { Exam, OrderView, PatientInfo } from '../../shared/models/lab.models';
import { nreValidator } from '../../shared/validators/form-validators';
import { OrderApiService } from './order-api.service';

/** Ready-made sets of tests the wards ask for most. */
const PROFILES: { name: string; codes: string[] }[] = [
  { name: 'Profilo renale', codes: ['CREA', 'UREA', 'NA', 'K'] },
  { name: 'Profilo glicemico', codes: ['GLU', 'HBA1C'] },
  { name: 'Profilo epatico', codes: ['ALT', 'AST'] },
];

@Component({
  selector: 'app-order-form',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, PatientPickerComponent],
  template: `
    <section class="card">
      <div class="toolbar">
        <h1 class="page-title">Nuova richiesta</h1>
        <a class="btn-text" routerLink="/richieste">Torna alle richieste</a>
      </div>
      @if (created(); as c) {
        <div class="alert success" id="order-created">
          Richiesta <b>{{ c.id }}</b> per {{ c.patientName }}: provette {{ barcodes(c) }}
        </div>
      }
      @if (errors().length) {
        <div class="alert error" id="order-errors"><ul>@for (e of errors(); track e) { <li>{{ e }}</li> }</ul></div>
      }
      <form [formGroup]="form" (ngSubmit)="submit()">
        <div class="form-grid">
          <div class="form-field wide">
            <span class="label required">Paziente</span>
            <app-patient-picker (picked)="onPatient($event)" />
            @if (patient(); as p) {
              <div class="muted" id="patient-picked">{{ p.lastName }} {{ p.firstName }} · {{ p.fiscalCode }} · {{ p.sex }}</div>
            }
          </div>
          <div class="form-field">
            <label for="prescriber" class="required">Medico richiedente</label>
            <input id="prescriber" type="text" formControlName="prescriber" />
          </div>
          <div class="form-field">
            <label for="nre">Ricetta elettronica (NRE)</label>
            <input id="nre" type="text" formControlName="prescriptionCode" placeholder="0301A4000112233" />
            @if (form.controls.prescriptionCode.invalid && form.controls.prescriptionCode.touched) { <span class="error">NRE non valido</span> }
          </div>
          <div class="form-field">
            <span class="label">Priorità</span>
            <div class="check-row"><label><input id="urgent" type="checkbox" formControlName="urgent" /> Urgente</label></div>
          </div>
        </div>

        <h2 style="margin-top: 18px">Esami</h2>
        <div class="profiles">
          @for (p of profiles; track p.name) { <button type="button" class="btn-text" (click)="addProfile(p.codes)">+ {{ p.name }}</button> }
        </div>
        @for (group of groups(); track group.type) {
          <div class="group">
            <div class="muted">{{ sampleLabel(group.type) }}</div>
            <div class="check-row">
              @for (e of group.exams; track e.code) {
                <label><input type="checkbox" [id]="'exam-' + e.code" [checked]="isSelected(e.code)" (change)="toggle(e.code)" /> {{ e.name }}</label>
              }
            </div>
          </div>
        }
        <div class="form-actions">
          <span class="muted">{{ selected().length }} esami selezionati</span>
          <button type="submit" class="btn-primary" id="confirm-order" [disabled]="!canSubmit()">CONFERMA</button>
        </div>
      </form>
    </section>
  `,
  styles: `
    .profiles { display: flex; gap: 4px; margin-bottom: 8px; }
    .group { margin-bottom: 8px; }
  `,
})
export class OrderFormComponent {
  @ViewChild(PatientPickerComponent) picker?: PatientPickerComponent;
  private readonly api = inject(OrderApiService);
  readonly profiles = PROFILES;
  readonly form = inject(FormBuilder).nonNullable.group({
    prescriber: ['', [Validators.required, Validators.maxLength(80)]],
    prescriptionCode: ['', nreValidator],
    urgent: [false],
  });
  readonly exams = signal<Exam[]>([]);
  readonly patient = signal<PatientInfo | null>(null);
  /** Chosen test codes, in the order they were added (a profile can add a test that is already there). */
  readonly selected = signal<string[]>([]);
  readonly created = signal<OrderView | null>(null);
  readonly errors = signal<string[]>([]);
  readonly groups = computed(() => {
    const types = [...new Set(this.exams().map((e) => e.sampleType))];
    return types.map((type) => ({ type, exams: this.exams().filter((e) => e.sampleType === type) }));
  });

  constructor() {
    this.api.exams().subscribe((list) => this.exams.set(list));
  }

  onPatient(p: PatientInfo | null): void {
    this.patient.set(p);
  }

  sampleLabel(type: string): string {
    return SAMPLE_TYPE[type] ?? type;
  }

  isSelected(code: string): boolean {
    return this.selected().includes(code);
  }

  toggle(code: string): void {
    this.selected.update((list) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code]));
  }

  addProfile(codes: string[]): void {
    this.selected.update((list) => [...list, ...codes]);
  }

  canSubmit(): boolean {
    return this.form.valid && this.patient() !== null && this.selected().length > 0;
  }

  barcodes(o: OrderView): string {
    return o.samples.map((s) => `${s.barcode} (${s.sampleType.toLowerCase()})`).join(', ');
  }

  submit(): void {
    const p = this.patient();
    if (!p || !this.canSubmit()) return;
    const v = this.form.getRawValue();
    this.api
      .create({ patientId: p.id, prescriber: v.prescriber, prescriptionCode: v.prescriptionCode.trim().toUpperCase(), urgent: v.urgent, examCodes: this.selected() })
      .subscribe({
        next: (o) => {
          this.created.set(o);
          this.errors.set([]);
          this.selected.set([]);
          this.patient.set(null);
          this.picker?.clear();
          this.form.reset();
        },
        error: (e) => this.errors.set(apiErrors(e)),
      });
  }
}
