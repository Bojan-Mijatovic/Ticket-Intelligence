import { DatePipe } from '@angular/common';
import { Component, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrors } from '../../core/http/api-errors';
import { PatientPickerComponent } from '../../shared/components/patient-picker/patient-picker.component';
import { Exemption, ExemptionType, PatientInfo } from '../../shared/models/bill.models';
import { dayFromToday } from '../../shared/utils/dates';
import { ExemptionApiService } from './exemption-api.service';

/** "Esenzioni": the co-pay exemptions of the patients, and a new one for a MediAgenda patient. */
@Component({
  selector: 'app-exemptions',
  standalone: true,
  imports: [FormsModule, DatePipe, PatientPickerComponent],
  template: `
    <section class="card">
      <h1 class="page-title">Esenzioni</h1>
      @if (message()) { <div class="alert success" id="exemption-message">{{ message() }}</div> }
      @if (errors().length) { <div class="alert error" id="exemption-errors">@for (e of errors(); track e) { <div>{{ e }}</div> }</div> }
      <div class="form-grid">
        <div class="form-field wide">
          <span class="label required">Paziente</span>
          <app-patient-picker (picked)="patient.set($event)" />
          @if (patient(); as p) { <div class="muted" id="patient-picked">{{ p.lastName }} {{ p.firstName }} · {{ p.fiscalCode }}</div> }
        </div>
        <div class="form-field">
          <label for="exemption-code" class="required">Esenzione</label>
          <select id="exemption-code" name="code" [(ngModel)]="code">
            <option value="">Scegli…</option>
            @for (t of types(); track t.code) { <option [value]="t.code">{{ t.code }} · {{ t.description }}</option> }
          </select>
        </div>
        <div class="form-field">
          <label for="valid-from" class="required">Valida dal</label>
          <input id="valid-from" type="date" name="from" [(ngModel)]="validFrom" />
        </div>
        <div class="form-field">
          <label for="valid-to" class="required">Valida al</label>
          <input id="valid-to" type="date" name="to" [(ngModel)]="validTo" />
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn-primary" id="save-exemption" [disabled]="!patient() || !code || !validFrom || !validTo" (click)="save()">SALVA</button>
      </div>
    </section>

    <section class="card">
      <table class="table" id="exemptions-table">
        <thead><tr><th>Paziente</th><th>Codice fiscale</th><th>Esenzione</th><th>Copertura</th><th>Validità</th></tr></thead>
        <tbody>
          @for (e of exemptions(); track e.id) {
            <tr>
              <td>{{ e.patientName }}</td><td>{{ e.fiscalCode }}</td><td><b>{{ e.code }}</b> · {{ e.description }}</td>
              <td>{{ e.total ? 'Totale' : e.tariffCodes }}</td>
              <td>{{ e.validFrom | date: 'dd/MM/yyyy' }} – {{ e.validTo | date: 'dd/MM/yyyy' }} @if (expired(e)) { <span class="chip stornata">scaduta</span> }</td>
            </tr>
          }
        </tbody>
      </table>
    </section>
  `,
})
export class ExemptionsComponent {
  @ViewChild(PatientPickerComponent) picker?: PatientPickerComponent;
  private readonly api = inject(ExemptionApiService);
  readonly patient = signal<PatientInfo | null>(null);
  readonly types = signal<ExemptionType[]>([]);
  readonly exemptions = signal<Exemption[]>([]);
  readonly message = signal('');
  readonly errors = signal<string[]>([]);
  code = '';
  validFrom = dayFromToday(0);
  validTo = '';

  constructor() {
    this.api.types().subscribe((list) => this.types.set(list));
    this.load();
  }

  load(): void {
    this.api.list().subscribe((list) => this.exemptions.set(list));
  }

  expired(e: Exemption): boolean {
    return e.validTo < dayFromToday(0);
  }

  save(): void {
    const p = this.patient();
    if (!p) return;
    this.api.register(p.id, this.code, this.validFrom, this.validTo).subscribe({
      next: (e) => {
        this.message.set(`Esenzione ${e.code} registrata per ${e.patientName}`);
        this.errors.set([]);
        this.patient.set(null);
        this.picker?.clear();
        this.code = '';
        this.validTo = '';
        this.load();
      },
      error: (e) => this.errors.set(apiErrors(e)),
    });
  }
}
