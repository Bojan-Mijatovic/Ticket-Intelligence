import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apiErrors } from '../../core/http/api-errors';
import { ResultRow, ResultSheet } from '../../shared/models/lab.models';
import { formatDecimal, rangeLabel } from '../../shared/utils/numbers';
import { ResultApiService } from '../results/result-api.service';

/** The report ("referto") of a REFERTATA request, ready to print. */
@Component({
  selector: 'app-report-view',
  standalone: true,
  imports: [DatePipe, RouterLink],
  template: `
    <section class="card report">
      <div class="toolbar">
        <h1 class="page-title">Referto</h1>
        <a class="btn-text no-print" routerLink="/richieste">Torna alle richieste</a>
        <button type="button" class="btn-primary no-print" (click)="print()">STAMPA</button>
      </div>
      @if (errors().length) { <div class="alert error">@for (e of errors(); track e) { <div>{{ e }}</div> }</div> }
      @if (report(); as r) {
        <div class="patient" id="report-patient">
          <div><b>{{ r.patientName }}</b> · {{ r.fiscalCode }} · {{ r.sex }} · nato/a il {{ r.birthDate | date: 'dd/MM/yyyy' }}</div>
          <div class="muted">Richiesta {{ r.orderId }} del {{ r.requestedAt | date: 'dd/MM/yyyy' }} · {{ r.prescriber }} · refertata il {{ r.reportedAt | date: 'dd/MM/yyyy HH:mm' }}</div>
        </div>
        <table class="table" id="report-table">
          <thead><tr><th>Esame</th><th class="num">Risultato</th><th>Unità</th><th>Valori di riferimento</th><th></th></tr></thead>
          <tbody>
            @for (row of r.rows; track row.examCode) {
              <tr>
                <td>{{ row.name }}</td>
                <td class="num">{{ value(row) }}</td>
                <td>{{ row.unit }}</td>
                <td>{{ range(row) }}</td>
                <td>@if (row.flag && row.flag !== 'N') { <span [class]="'flag ' + row.flag">{{ row.flag }}</span> }</td>
              </tr>
            }
          </tbody>
        </table>
        <p class="hint" style="margin-top: 12px">Validato da {{ r.validatedBy }}. H = sopra, L = sotto i valori di riferimento.</p>
      }
    </section>
  `,
  styles: `
    .patient { margin-bottom: 12px; }
    @media print { .no-print { display: none; } }
  `,
})
export class ReportViewComponent {
  private readonly api = inject(ResultApiService);
  private readonly orderId = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';
  readonly report = signal<ResultSheet | null>(null);
  readonly errors = signal<string[]>([]);

  constructor() {
    this.api.report(this.orderId).subscribe({ next: (r) => this.report.set(r), error: (e) => this.errors.set(apiErrors(e)) });
  }

  value(row: ResultRow): string {
    return formatDecimal(row.value, row.decimals);
  }

  range(row: ResultRow): string {
    return rangeLabel(row.refMin, row.refMax, row.decimals);
  }

  print(): void {
    window.print();
  }
}
