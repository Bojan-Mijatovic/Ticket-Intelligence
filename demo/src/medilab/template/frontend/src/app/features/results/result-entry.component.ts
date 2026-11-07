import { DatePipe } from '@angular/common';
import { Component, ElementRef, QueryList, ViewChildren, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { apiErrors } from '../../core/http/api-errors';
import { ResultEntry, ResultRow, ResultSheet } from '../../shared/models/lab.models';
import { formatDecimal, rangeLabel } from '../../shared/utils/numbers';
import { ResultApiService } from './result-api.service';

/**
 * "Inserimento risultati": one value per test of the request. Enter moves to the next value, so a whole request is
 * typed from the keyboard; SALVA stores and flags the values, VALIDA E REFERTA signs the report.
 */
@Component({
  selector: 'app-result-entry',
  standalone: true,
  imports: [FormsModule, DatePipe, RouterLink],
  template: `
    <section class="card">
      <div class="toolbar">
        <h1 class="page-title">Inserimento risultati</h1>
        <a class="btn-text" routerLink="/richieste">Torna alle richieste</a>
      </div>
      @if (sheet(); as s) {
        <p class="hint">
          <b>{{ s.orderId }}</b> · {{ s.patientName }} · {{ s.fiscalCode }} · {{ s.sex }} · nato/a il {{ s.birthDate | date: 'dd/MM/yyyy' }}
          · richiesta del {{ s.requestedAt | date: 'dd/MM/yyyy HH:mm' }} ({{ s.prescriber }})
        </p>
        @if (message()) { <div class="alert success" id="result-message">{{ message() }}</div> }
        @if (errors().length) { <div class="alert error" id="result-errors">@for (e of errors(); track e) { <div>{{ e }}</div> }</div> }
        <table class="table" id="results-table">
          <thead><tr><th>Esame</th><th>Risultato</th><th>Unità</th><th>Valori di riferimento</th><th></th></tr></thead>
          <tbody>
            @for (r of s.rows; track r.examCode; let i = $index) {
              <tr>
                <td>{{ r.name }} <span class="muted">({{ r.examCode }})</span></td>
                <td>
                  <input #valueInput type="text" inputmode="decimal" class="value" [id]="'value-' + r.examCode" [name]="'value-' + r.examCode"
                         [(ngModel)]="values[r.examCode]" (keydown.enter)="focusNext($event, i)" />
                </td>
                <td>{{ r.unit }}</td>
                <td>{{ range(r) }}</td>
                <td>@if (r.flag && r.flag !== 'N') { <span [class]="'flag ' + r.flag">{{ r.flag }}</span> }</td>
              </tr>
            }
          </tbody>
        </table>
        <div class="form-actions">
          <input id="validated-by" type="text" name="validatedBy" [(ngModel)]="validatedBy" placeholder="Firma (medico validatore)" />
          <button type="button" class="btn-text" id="save-results" (click)="save()">SALVA</button>
          <button type="button" class="btn-primary" id="validate-results" [disabled]="!validatedBy.trim()" (click)="validate()">VALIDA E REFERTA</button>
        </div>
      }
    </section>
  `,
  styles: `
    .value { width: 110px; min-width: 0; text-align: right; }
  `,
})
export class ResultEntryComponent {
  @ViewChildren('valueInput') inputs?: QueryList<ElementRef<HTMLInputElement>>;
  private readonly api = inject(ResultApiService);
  private readonly router = inject(Router);
  private readonly orderId = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';
  readonly sheet = signal<ResultSheet | null>(null);
  readonly message = signal('');
  readonly errors = signal<string[]>([]);
  /** The text typed for each test code. */
  values: Record<string, string> = {};
  validatedBy = 'Dr.ssa Anna Ferri';

  constructor() {
    this.api.sheet(this.orderId).subscribe({ next: (s) => this.show(s), error: (e) => this.errors.set(apiErrors(e)) });
  }

  range(r: ResultRow): string {
    return rangeLabel(r.refMin, r.refMax, r.decimals);
  }

  /** Enter: next value field (the last one saves). */
  focusNext(event: Event, index: number): void {
    event.preventDefault();
    const list = this.inputs?.toArray() ?? [];
    if (index + 1 < list.length) list[index + 1].nativeElement.focus();
    else this.save();
  }

  save(): void {
    const entries: ResultEntry[] = Object.entries(this.values)
      .filter(([, text]) => String(text ?? '').trim() !== '')
      .map(([examCode, text]) => ({ examCode, value: this.toNumber(text) }));
    if (entries.some((e) => Number.isNaN(e.value))) {
      this.errors.set(['Valore non numerico.']);
      return;
    }
    this.api.save(this.orderId, entries).subscribe({
      next: (s) => { this.show(s); this.message.set('Risultati salvati'); this.errors.set([]); },
      error: (e) => this.errors.set(apiErrors(e)),
    });
  }

  validate(): void {
    this.api.validate(this.orderId, this.validatedBy.trim()).subscribe({
      next: () => this.router.navigate(['/referti', this.orderId]),
      error: (e) => this.errors.set(apiErrors(e)),
    });
  }

  private toNumber(text: string): number {
    return parseFloat(String(text).trim());
  }

  private show(s: ResultSheet): void {
    this.sheet.set(s);
    this.values = Object.fromEntries(s.rows.map((r) => [r.examCode, formatDecimal(r.value, r.decimals)]));
  }
}
