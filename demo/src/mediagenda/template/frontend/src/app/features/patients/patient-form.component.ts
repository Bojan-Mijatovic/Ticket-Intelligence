import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apiErrors } from '../../core/http/api-errors';
import { isoToItalian, italianPastDate, parseItalianDate, toIsoDate } from '../../shared/utils/dates';
import { fiscalCodeValidator } from '../../shared/validators/form-validators';
import { Patient, PatientApiService, PatientRequest } from './patient-api.service';

/** "Anagrafica paziente": new patient (/pazienti/nuovo) or edit (/pazienti/:id). */
@Component({
  selector: 'app-patient-form',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <section class="card">
      <h1 class="page-title">{{ patientId ? 'Modifica paziente' : 'Nuovo paziente' }}</h1>

      @if (saved(); as p) {
        <div class="alert success" id="patient-saved">
          Paziente {{ p.lastName }} {{ p.firstName }} salvato ({{ p.fiscalCode }}).
          @if (!patientId) { <a [routerLink]="['/pazienti', p.id]">Apri la scheda</a> }
        </div>
      }
      @if (errors().length) {
        <div class="alert error" id="patient-errors"><b>Impossibile salvare il paziente</b><ul>@for (e of errors(); track e) {<li>{{ e }}</li>}</ul></div>
      }

      <form [formGroup]="form" (ngSubmit)="save()" novalidate>
        <div class="form-grid">
          <div class="form-field">
            <label class="required" for="fiscal-code">Codice fiscale</label>
            <input id="fiscal-code" type="text" formControlName="fiscalCode" maxlength="16" autocomplete="off" />
            @if (form.controls.fiscalCode.touched && form.controls.fiscalCode.invalid) {
              <span class="error">Inserire un codice fiscale valido (16 caratteri).</span>
            }
          </div>
          <div class="form-field">
            <label class="required" for="last-name">Cognome</label>
            <input id="last-name" type="text" formControlName="lastName" maxlength="60" />
            @if (form.controls.lastName.touched && form.controls.lastName.invalid) { <span class="error">Campo obbligatorio.</span> }
          </div>
          <div class="form-field">
            <label class="required" for="first-name">Nome</label>
            <input id="first-name" type="text" formControlName="firstName" maxlength="60" />
            @if (form.controls.firstName.touched && form.controls.firstName.invalid) { <span class="error">Campo obbligatorio.</span> }
          </div>
          <div class="form-field">
            <span class="label required">Sesso</span>
            <div class="radio-row">
              <label><input type="radio" formControlName="sex" value="F" id="sex-f" /> Femmina</label>
              <label><input type="radio" formControlName="sex" value="M" id="sex-m" /> Maschio</label>
            </div>
          </div>
          <div class="form-field">
            <label class="required" for="birth-date">Data di nascita</label>
            <input id="birth-date" type="text" formControlName="birthDate" placeholder="gg/mm/aaaa" maxlength="10" />
            @if (form.controls.birthDate.touched && form.controls.birthDate.errors; as e) {
              <span class="error">{{ e['future'] ? 'La data non può essere futura.' : 'Inserire una data nel formato gg/mm/aaaa.' }}</span>
            }
          </div>
          <div class="form-field">
            <label for="city">Comune di residenza</label>
            <input id="city" type="text" formControlName="city" maxlength="60" />
          </div>
          <div class="form-field">
            <label for="phone">Telefono</label>
            <input id="phone" type="tel" formControlName="phone" placeholder="+39 …" />
            @if (form.controls.phone.touched && form.controls.phone.invalid) { <span class="error">Numero non valido.</span> }
          </div>
          <div class="form-field">
            <label for="email">E-mail</label>
            <input id="email" type="email" formControlName="email" />
            @if (form.controls.email.touched && form.controls.email.invalid) { <span class="error">Indirizzo e-mail non valido.</span> }
          </div>
        </div>

        <div class="form-actions">
          <a class="btn-text" routerLink="/pazienti">ANNULLA</a>
          <button type="submit" class="btn-primary" id="save-patient" [disabled]="saving()">SALVA</button>
        </div>
      </form>
    </section>
  `,
  styles: `a.btn-text { text-decoration: none; display: inline-block; }`,
})
export class PatientFormComponent {
  private readonly api = inject(PatientApiService);
  private readonly fb = inject(FormBuilder).nonNullable;

  readonly patientId = Number(inject(ActivatedRoute).snapshot.paramMap.get('id')) || null;
  readonly saving = signal(false);
  readonly saved = signal<Patient | null>(null);
  readonly errors = signal<string[]>([]);

  readonly form = this.fb.group({
    fiscalCode: ['', [Validators.required, fiscalCodeValidator]],
    lastName: ['', [Validators.required, Validators.maxLength(60)]],
    firstName: ['', [Validators.required, Validators.maxLength(60)]],
    sex: ['' as '' | 'M' | 'F', Validators.required],
    birthDate: ['', [Validators.required, italianPastDate]],
    city: [''],
    phone: ['', Validators.pattern(/^\+?[0-9 ]{6,20}$/)],
    email: ['', Validators.email],
  });

  constructor() {
    // The fiscal code is always upper case, whatever the operator types.
    this.form.controls.fiscalCode.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => {
      if (v !== v.toUpperCase()) this.form.controls.fiscalCode.setValue(v.toUpperCase(), { emitEvent: false });
    });
    if (this.patientId) {
      this.api.get(this.patientId).subscribe({
        next: (p) => this.form.patchValue({ ...p, birthDate: isoToItalian(p.birthDate), city: p.city ?? '', phone: p.phone ?? '', email: p.email ?? '' }),
        error: (e) => this.errors.set(apiErrors(e)),
      });
    }
  }

  save(): void {
    this.form.markAllAsTouched();
    this.saved.set(null);
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const request: PatientRequest = {
      fiscalCode: v.fiscalCode,
      lastName: v.lastName.trim(),
      firstName: v.firstName.trim(),
      sex: v.sex as 'M' | 'F',
      birthDate: toIsoDate(parseItalianDate(v.birthDate)!),
      city: v.city.trim() || null,
      phone: v.phone.trim() || null,
      email: v.email.trim() || null,
    };
    this.saving.set(true);
    this.errors.set([]);
    const call = this.patientId ? this.api.update(this.patientId, request) : this.api.create(request);
    call.subscribe({
      next: (p) => {
        this.saving.set(false);
        this.saved.set(p);
        if (!this.patientId) this.form.reset();
      },
      error: (e) => {
        this.saving.set(false);
        this.errors.set(e?.status === 409 ? ['Codice fiscale già presente in anagrafica.'] : apiErrors(e));
      },
    });
  }
}
