import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apiErrors } from '../../core/http/api-errors';
import { Lot, NextDose, PatientCard, Vaccine } from '../../shared/models/vax.models';
import { ageInYears, formatDate, today } from '../../shared/utils/dates';
import { doseLabel, sexLabel } from '../../shared/utils/labels';
import { PatientApiService } from './patient-api.service';

/** "Scheda paziente": the doses given, the next ones due, and a new dose to record. */
@Component({
  selector: 'app-patient-card',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <a routerLink="/pazienti" class="btn-text">← Pazienti</a>
    @if (card(); as c) {
      <section class="card">
        <h1 class="page-title" id="patient-name">{{ c.patient.lastName }} {{ c.patient.firstName }}</h1>
        <p class="muted" id="patient-details">
          {{ c.patient.fiscalCode }} · {{ sexLabel(c.patient.sex) }} · nato/a il {{ formatDate(c.patient.birthDate) }} a {{ c.patient.birthPlace }} ·
          {{ age(c.patient.birthDate) }} anni
        </p>
      </section>

      <section class="card">
        <h2>Prossime dosi</h2>
        @if (c.next.length) {
          <table class="table" id="next-table">
            <thead><tr><th>Vaccino</th><th>Dose</th><th>Dal</th><th></th></tr></thead>
            <tbody>
              @for (n of c.next; track n.vaccineCode) {
                <tr [attr.data-vaccine]="n.vaccineCode">
                  <td>{{ n.vaccineName }}</td>
                  <td>{{ doseLabel(n.doseNumber, n.booster) }}</td>
                  <td>{{ formatDate(n.dueOn) }}</td>
                  <td>@if (late(n)) { <span class="chip late">in ritardo</span> }</td>
                </tr>
              }
            </tbody>
          </table>
        } @else {
          <p class="muted" id="no-next">Nessuna dose in programma.</p>
        }
      </section>

      <section class="card">
        <h2>Dosi somministrate</h2>
        @if (c.doses.length) {
          <table class="table" id="doses-table">
            <thead><tr><th>Vaccino</th><th>Dose</th><th>Data</th><th>Lotto</th></tr></thead>
            <tbody>
              @for (d of c.doses; track d.id) {
                <tr><td>{{ d.vaccineName }}</td><td>{{ d.doseNumber }}</td><td>{{ formatDate(d.givenOn) }}</td><td>{{ d.lotCode }}</td></tr>
              }
            </tbody>
          </table>
        } @else {
          <p class="muted" id="no-doses">Nessuna dose registrata.</p>
        }
      </section>

      <section class="card">
        <h2>Registra una dose</h2>
        @if (message()) { <div class="alert success" id="dose-message">{{ message() }}</div> }
        @if (errors().length) { <div class="alert error" id="dose-errors">@for (e of errors(); track e) { <div>{{ e }}</div> }</div> }
        <div class="form-grid">
          <div class="form-field">
            <label for="dose-vaccine" class="required">Vaccino</label>
            <select id="dose-vaccine" name="vaccine" [(ngModel)]="vaccineCode" (ngModelChange)="loadLots()">
              <option value="">Scegli…</option>
              @for (v of vaccines(); track v.code) { <option [value]="v.code">{{ v.code }} · {{ v.name }}</option> }
            </select>
          </div>
          <div class="form-field">
            <label for="dose-lot" class="required">Lotto</label>
            <select id="dose-lot" name="lot" [(ngModel)]="lotCode" [disabled]="!vaccineCode">
              <option value="">Scegli…</option>
              @for (l of lots(); track l.code) { <option [value]="l.code">{{ l.code }} · scade il {{ formatDate(l.expiry) }} · {{ l.dosesLeft }} dosi</option> }
            </select>
          </div>
          <div class="form-field">
            <label for="dose-date" class="required">Data</label>
            <input id="dose-date" type="date" name="givenOn" [(ngModel)]="givenOn" />
          </div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn-primary" id="record-dose" [disabled]="!vaccineCode || !lotCode || !givenOn" (click)="record(c.patient.id)">REGISTRA</button>
        </div>
      </section>
    }
  `,
})
export class PatientCardComponent {
  private readonly api = inject(PatientApiService);
  private readonly id = Number(inject(ActivatedRoute).snapshot.paramMap.get('id'));
  readonly card = signal<PatientCard | null>(null);
  readonly vaccines = signal<Vaccine[]>([]);
  readonly lots = signal<Lot[]>([]);
  readonly message = signal('');
  readonly errors = signal<string[]>([]);
  readonly formatDate = formatDate;
  readonly sexLabel = sexLabel;
  readonly doseLabel = doseLabel;
  vaccineCode = '';
  lotCode = '';
  givenOn = today();

  constructor() {
    this.load();
    this.api.vaccines().subscribe((list) => this.vaccines.set(list));
  }

  load(): void {
    this.api.card(this.id).subscribe({ next: (c) => this.card.set(c), error: (e) => this.errors.set(apiErrors(e)) });
  }

  loadLots(): void {
    this.lotCode = '';
    this.lots.set([]);
    if (this.vaccineCode) this.api.lots(this.vaccineCode).subscribe((list) => this.lots.set(list));
  }

  age(birthDate: string): number {
    return ageInYears(birthDate, today());
  }

  late(n: NextDose): boolean {
    return n.dueOn < today();
  }

  record(patientId: number): void {
    this.api.recordDose({ patientId, vaccineCode: this.vaccineCode, givenOn: this.givenOn, lotCode: this.lotCode }).subscribe({
      next: (d) => {
        this.message.set(`Dose ${d.doseNumber} di ${d.vaccineCode} registrata il ${formatDate(d.givenOn)} (lotto ${d.lotCode})`);
        this.errors.set([]);
        this.load();
        this.loadLots();
      },
      error: (e) => {
        this.message.set('');
        this.errors.set(apiErrors(e));
      },
    });
  }
}
