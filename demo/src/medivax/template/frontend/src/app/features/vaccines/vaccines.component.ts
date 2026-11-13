import { Component, inject, signal } from '@angular/core';
import { Vaccine } from '../../shared/models/vax.models';
import { ageRangeLabel, boosterLabel, intervalLabel } from '../../shared/utils/labels';
import { PatientApiService } from '../patients/patient-api.service';

/** "Vaccini": the catalog, with the series, the age range and the booster of each vaccine. */
@Component({
  selector: 'app-vaccines',
  standalone: true,
  template: `
    <section class="card">
      <h1 class="page-title">Vaccini</h1>
      <table class="table" id="vaccines-table">
        <thead><tr><th>Codice</th><th>Vaccino</th><th class="num">Dosi</th><th>Intervallo</th><th>Età</th><th>Richiamo</th></tr></thead>
        <tbody>
          @for (v of vaccines(); track v.code) {
            <tr [attr.data-vaccine]="v.code">
              <td><b>{{ v.code }}</b></td>
              <td>{{ v.name }}</td>
              <td class="num">{{ v.doses }}</td>
              <td>{{ intervalLabel(v.intervalDays) }}</td>
              <td>{{ ageRangeLabel(v.minAgeMonths, v.maxAgeYears) }}</td>
              <td>{{ boosterLabel(v.boosterMonths) }}</td>
            </tr>
          }
        </tbody>
      </table>
    </section>
  `,
})
export class VaccinesComponent {
  readonly vaccines = signal<Vaccine[]>([]);
  readonly intervalLabel = intervalLabel;
  readonly ageRangeLabel = ageRangeLabel;
  readonly boosterLabel = boosterLabel;

  constructor() {
    inject(PatientApiService).vaccines().subscribe((list) => this.vaccines.set(list));
  }
}
