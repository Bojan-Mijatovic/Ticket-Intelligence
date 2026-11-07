import { CurrencyPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { API } from '../../core/http/api';
import { SAMPLE_TYPE } from '../../core/i18n/labels';
import { Exam } from '../../shared/models/lab.models';
import { rangeLabel } from '../../shared/utils/numbers';

/** The test catalog: units, reference ranges by sex, tariff code and price (what MediBill charges). */
@Component({
  selector: 'app-exam-catalog',
  standalone: true,
  imports: [FormsModule, CurrencyPipe],
  template: `
    <section class="card">
      <h1 class="page-title">Catalogo esami</h1>
      <form class="row" (ngSubmit)="load()">
        <input type="search" name="q" placeholder="Codice o nome dell'esame" [(ngModel)]="query" />
        <button type="submit" class="btn-primary">RICERCA</button>
      </form>
      <table class="table" id="exams-table">
        <thead><tr><th>Codice</th><th>Esame</th><th>Campione</th><th>Unità</th><th>Uomo</th><th>Donna</th><th>Tariffa</th><th class="num">Prezzo</th></tr></thead>
        <tbody>
          @for (e of exams(); track e.code) {
            <tr>
              <td><b>{{ e.code }}</b></td><td>{{ e.name }}</td><td>{{ sampleLabel(e.sampleType) }}</td><td>{{ e.unit }}</td>
              <td>{{ range(e.refMinM, e.refMaxM, e.decimals) }}</td><td>{{ range(e.refMinF, e.refMaxF, e.decimals) }}</td>
              <td>{{ e.tariffCode }}</td><td class="num">{{ e.price | currency: 'EUR' : 'symbol' : '1.2-2' : 'it' }}</td>
            </tr>
          }
        </tbody>
      </table>
    </section>
  `,
  styles: `.row { display: flex; gap: 8px; margin-bottom: 12px; }`,
})
export class ExamCatalogComponent {
  private readonly http = inject(HttpClient);
  query = '';
  readonly exams = signal<Exam[]>([]);

  constructor() {
    this.load();
  }

  load(): void {
    this.http.get<Exam[]>(`${API}/exams`, { params: { q: this.query.trim() } }).subscribe((list) => this.exams.set(list));
  }

  sampleLabel(type: string): string {
    return SAMPLE_TYPE[type] ?? type;
  }

  range(min: number | null, max: number | null, decimals: number): string {
    return rangeLabel(min, max, decimals);
  }
}
