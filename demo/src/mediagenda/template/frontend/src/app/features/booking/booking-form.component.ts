import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, merge, of, switchMap } from 'rxjs';
import { apiErrors } from '../../core/http/api-errors';
import { StructureAutocompleteComponent } from '../../shared/components/structure-autocomplete/structure-autocomplete.component';
import { AgendaResource, Structure } from '../../shared/models/agenda.models';
import { NRE, todayIso } from '../../shared/validators/form-validators';
import { AgendaApiService } from '../agenda/services/agenda-api.service';
import { Patient, PatientApiService } from '../patients/patient-api.service';
import { AvailableTime, Booking, BookingApiService, PRIORITIES, Priority } from './booking-api.service';

/** "Nuova prenotazione": patient → structure → provider → day → free time → prescription data. */
@Component({
  selector: 'app-booking-form',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, DatePipe, StructureAutocompleteComponent],
  template: `
    <section class="card">
      <h1 class="page-title">Nuova prenotazione</h1>

      @if (created(); as b) {
        <div class="alert success" id="booking-created">
          Prenotazione <b>{{ b.id }}</b> confermata: {{ b.patientName }}, {{ b.appointmentAt | date: 'EEEE dd/MM/yyyy HH:mm' }}, {{ b.agendaName }}.
          <a routerLink="/prenotazioni">Vai alle prenotazioni</a>
        </div>
      }
      @if (errors().length) {
        <div class="alert error" id="booking-errors"><b>Prenotazione non riuscita</b><ul>@for (e of errors(); track e) {<li>{{ e }}</li>}</ul></div>
      }

      <form [formGroup]="form" (ngSubmit)="confirm()" novalidate>
        <h2>Paziente</h2>
        <div class="form-grid">
          <div class="form-field wide patient-field">
            <label class="required" for="patient-search">Paziente</label>
            @if (patient(); as p) {
              <div class="picked" id="patient-picked">
                <b>{{ p.lastName }} {{ p.firstName }}</b> <span class="muted">{{ p.fiscalCode }} · {{ p.birthDate | date: 'dd/MM/yyyy' }}</span>
                <button type="button" class="btn-text" (click)="clearPatient()">Cambia</button>
              </div>
            } @else {
              <input id="patient-search" type="search" placeholder="Cognome o codice fiscale (min. 2 caratteri)" autocomplete="off"
                     (input)="patientQuery$.next($any($event.target).value)" />
              @if (patientHits().length) {
                <ul class="suggestions patient-suggestions">
                  @for (p of patientHits(); track p.id) {
                    <li (mousedown)="pickPatient(p)"><b>{{ p.lastName }} {{ p.firstName }}</b> <span class="muted">{{ p.fiscalCode }}</span></li>
                  }
                </ul>
              }
            }
          </div>
        </div>

        <h2>Appuntamento</h2>
        <div class="form-grid">
          <div class="form-field">
            <app-structure-autocomplete (structureSelected)="onStructure($event)" />
          </div>
          <div class="form-field">
            <label class="required" for="resource-select">Erogatore</label>
            <select id="resource-select" formControlName="resourceCode">
              <option value="">{{ resources().length ? 'Seleziona…' : 'Seleziona prima una struttura' }}</option>
              @for (r of resources(); track r.code) { <option [value]="r.code">{{ r.code }} · {{ r.description }}</option> }
            </select>
          </div>
          <div class="form-field">
            <label class="required" for="booking-date">Giorno</label>
            <input id="booking-date" type="date" formControlName="date" [min]="today" />
          </div>
          <div class="form-field wide">
            <span class="label required">Orario</span>
            @if (!form.controls.resourceCode.value || !form.controls.date.value) {
              <span class="muted">Scegli erogatore e giorno per vedere gli orari liberi.</span>
            } @else if (loadingTimes()) {
              <span class="muted">Ricerca degli orari liberi…</span>
            } @else if (!times().length) {
              <span class="muted" id="no-times">Nessun orario libero in questo giorno.</span>
            } @else {
              <div class="times" id="free-times">
                @for (t of times(); track t.timeSlotId + t.startAt) {
                  <button type="button" class="time" [class.selected]="form.controls.time.value === t" (click)="form.controls.time.setValue(t)">
                    {{ t.startAt | date: 'HH:mm' }}
                  </button>
                }
              </div>
              @if (form.controls.time.value; as t) { <span class="muted">{{ t.agendaName }} · {{ t.priority }}</span> }
            }
          </div>
        </div>

        <h2>Prescrizione</h2>
        <div class="form-grid">
          <div class="form-field">
            <label class="required" for="priority-select">Classe di priorità</label>
            <select id="priority-select" formControlName="priority">
              @for (p of priorities; track p.code) { <option [value]="p.code">{{ p.label }}</option> }
            </select>
          </div>
          <div class="form-field">
            <label for="nre-input">Numero ricetta (NRE)</label>
            <input id="nre-input" type="text" formControlName="prescriptionCode" maxlength="15" placeholder="es. 0301A4000112233" />
            @if (form.controls.prescriptionCode.touched && form.controls.prescriptionCode.invalid) {
              <span class="error">15 caratteri: 4 cifre, una lettera, 10 cifre.</span>
            }
          </div>
          <div class="form-field wide">
            <label for="notes">Note per l'erogatore</label>
            <textarea id="notes" rows="2" formControlName="notes" maxlength="500"></textarea>
          </div>
        </div>

        <div class="form-actions">
          <a class="btn-text" routerLink="/prenotazioni">ANNULLA</a>
          <button type="submit" class="btn-primary" id="confirm-booking" [disabled]="form.invalid || !patient() || saving()">CONFERMA PRENOTAZIONE</button>
        </div>
      </form>
    </section>
  `,
  styles: `
    h2 { margin-top: 18px; }
    .patient-field { position: relative; }
    .patient-field input { max-width: 420px; }
    .picked { display: flex; align-items: center; gap: 8px; }
    .suggestions { position: absolute; top: 100%; z-index: 10; min-width: 320px; margin: 4px 0 0; padding: 4px 0; list-style: none;
      background: var(--surface); border: 1px solid var(--border); border-radius: 6px; box-shadow: 0 6px 18px rgb(0 0 0 / 0.08); }
    .suggestions li { padding: 6px 12px; cursor: pointer; }
    .suggestions li:hover { background: var(--primary-soft); }
    .times { display: flex; flex-wrap: wrap; gap: 6px; }
    .time { font: inherit; padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); cursor: pointer; }
    .time.selected { background: var(--primary); border-color: var(--primary); color: var(--primary-ink); font-weight: 600; }
    a.btn-text { text-decoration: none; display: inline-block; }
  `,
})
export class BookingFormComponent {
  private readonly bookings = inject(BookingApiService);
  private readonly patients = inject(PatientApiService);
  private readonly agenda = inject(AgendaApiService);
  private readonly fb = inject(FormBuilder);

  readonly priorities = PRIORITIES;
  readonly today = todayIso();
  readonly patientQuery$ = new Subject<string>();
  readonly patientHits = signal<Patient[]>([]);
  readonly patient = signal<Patient | null>(null);
  readonly resources = signal<AgendaResource[]>([]);
  readonly times = signal<AvailableTime[]>([]);
  readonly loadingTimes = signal(false);
  readonly saving = signal(false);
  readonly created = signal<Booking | null>(null);
  readonly errors = signal<string[]>([]);

  readonly form = this.fb.group({
    resourceCode: ['', Validators.required],
    date: ['', Validators.required],
    time: this.fb.control<AvailableTime | null>(null, Validators.required),
    priority: this.fb.nonNullable.control<Priority>('P', Validators.required),
    prescriptionCode: ['', Validators.pattern(NRE)],
    notes: ['', Validators.maxLength(500)],
  });

  constructor() {
    this.patientQuery$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((q) => (q.trim().length >= 2 ? this.patients.search(q.trim(), 0, 6) : of({ items: [] as Patient[] }))),
        takeUntilDestroyed(),
      )
      .subscribe((r) => this.patientHits.set(r.items));

    // A new provider or day: the chosen time no longer applies; load the free times again.
    merge(this.form.controls.resourceCode.valueChanges, this.form.controls.date.valueChanges)
      .pipe(
        switchMap(() => {
          this.form.controls.time.setValue(null);
          const { resourceCode, date } = this.form.getRawValue();
          if (!resourceCode || !date) return of([] as AvailableTime[]);
          this.loadingTimes.set(true);
          return this.bookings.availability(resourceCode, date);
        }),
        takeUntilDestroyed(),
      )
      .subscribe({
        next: (list) => {
          this.loadingTimes.set(false);
          this.times.set(list);
        },
        error: (e) => {
          this.loadingTimes.set(false);
          this.errors.set(apiErrors(e));
        },
      });
  }

  pickPatient(p: Patient): void {
    this.patient.set(p);
    this.patientHits.set([]);
  }

  clearPatient(): void {
    this.patient.set(null);
  }

  onStructure(structure: Structure): void {
    this.form.controls.resourceCode.setValue('');
    this.agenda.resources([structure.id]).subscribe((list) => this.resources.set(list));
  }

  confirm(): void {
    const patient = this.patient();
    const v = this.form.getRawValue();
    if (!patient || !v.time || this.form.invalid) return;
    this.saving.set(true);
    this.errors.set([]);
    this.created.set(null);
    this.bookings
      .create({
        patientId: patient.id,
        timeSlotId: v.time.timeSlotId,
        appointmentAt: v.time.startAt,
        priority: v.priority,
        prescriptionCode: v.prescriptionCode?.toUpperCase() || null,
        notes: v.notes?.trim() || null,
      })
      .subscribe({
        next: (b) => {
          this.saving.set(false);
          this.created.set(b);
          this.times.update((list) => list.filter((t) => t !== v.time));
          this.form.controls.time.setValue(null);
        },
        error: (e) => {
          this.saving.set(false);
          this.errors.set(e?.status === 409 ? ["L'orario scelto è appena stato prenotato: scegline un altro."] : apiErrors(e));
        },
      });
  }
}
