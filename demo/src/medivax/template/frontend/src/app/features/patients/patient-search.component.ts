import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrors } from '../../core/http/api-errors';
import { Patient } from '../../shared/models/vax.models';
import { ageInYears, formatDate, today } from '../../shared/utils/dates';
import { sexLabel } from '../../shared/utils/labels';
import { PatientApiService } from './patient-api.service';

/** At least this many characters before the search runs (the backend answers nothing for fewer). */
const MIN_QUERY = 2;

/** "Pazienti": search a patient by surname or fiscal code, and open the vaccination card. */
@Component({
  selector: 'app-patient-search',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <section class="card">
      <h1 class="page-title">Pazienti</h1>
      <p class="hint">Cerca per cognome o codice fiscale (almeno {{ minQuery }} caratteri).</p>
      <input id="patient-query" type="search" name="q" placeholder="Cognome o codice fiscale" [(ngModel)]="query" (ngModelChange)="search()" />
      @if (errors().length) { <div class="alert error" id="search-errors">@for (e of errors(); track e) { <div>{{ e }}</div> }</div> }
    </section>

    @if (searched()) {
      <section class="card">
        @if (patients().length) {
          <table class="table" id="patients-table">
            <thead><tr><th>Paziente</th><th>Codice fiscale</th><th>Data di nascita</th><th class="num">Età</th><th>Sesso</th></tr></thead>
            <tbody>
              @for (p of patients(); track p.id) {
                <tr [attr.data-patient-id]="p.id">
                  <td><a [routerLink]="['/pazienti', p.id]">{{ p.lastName }} {{ p.firstName }}</a></td>
                  <td>{{ p.fiscalCode }}</td>
                  <td>{{ formatDate(p.birthDate) }}</td>
                  <td class="num">{{ age(p) }}</td>
                  <td>{{ sexLabel(p.sex) }}</td>
                </tr>
              }
            </tbody>
          </table>
        } @else {
          <p class="muted" id="no-patients">Nessun paziente trovato.</p>
        }
      </section>
    }
  `,
})
export class PatientSearchComponent {
  private readonly api = inject(PatientApiService);
  readonly minQuery = MIN_QUERY;
  readonly patients = signal<Patient[]>([]);
  readonly searched = signal(false);
  readonly errors = signal<string[]>([]);
  readonly formatDate = formatDate;
  readonly sexLabel = sexLabel;
  query = '';

  search(): void {
    const q = this.query.trim();
    if (q.length < MIN_QUERY) {
      this.patients.set([]);
      this.searched.set(false);
      return;
    }
    this.api.search(q).subscribe({
      next: (list) => {
        this.patients.set(list);
        this.searched.set(true);
        this.errors.set([]);
      },
      error: (e) => this.errors.set(apiErrors(e)),
    });
  }

  age(p: Patient): number {
    return ageInYears(p.birthDate, today());
  }
}
