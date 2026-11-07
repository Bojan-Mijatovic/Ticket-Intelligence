import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { API } from '../../core/http/api';
import { MonthlyReport } from '../../shared/models/bill.models';
import { addMonths, monthOf } from '../../shared/utils/dates';
import { formatMoney } from '../../shared/utils/money';

const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

/** "Report incassi": the receipts of a month (cancelled ones left out) and the co-pay collected. */
@Component({
  selector: 'app-report',
  standalone: true,
  template: `
    <section class="card">
      <div class="toolbar">
        <h1 class="page-title">Report incassi</h1>
        <button type="button" class="btn-text" id="prev-month" (click)="move(-1)">‹</button>
        <b id="month-label">{{ label() }}</b>
        <button type="button" class="btn-text" id="next-month" (click)="move(1)">›</button>
      </div>
      @if (report(); as r) {
        <table class="table" id="report-table">
          <tbody>
            <tr><td>Ricevute</td><td class="money" id="report-receipts">{{ r.receipts }}</td></tr>
            <tr><td>Importo a tariffa</td><td class="money">{{ money(r.total) }}</td></tr>
            <tr><td>Esente</td><td class="money">{{ money(r.exempt) }}</td></tr>
            <tr><td>Ticket emesso</td><td class="money" id="report-copay">{{ money(r.copay) }}</td></tr>
            <tr><td>Ticket incassato</td><td class="money" id="report-collected">{{ money(r.collected) }}</td></tr>
          </tbody>
        </table>
      }
    </section>
  `,
})
export class ReportComponent {
  private readonly http = inject(HttpClient);
  readonly month = signal(monthOf(new Date()));
  readonly report = signal<MonthlyReport | null>(null);

  constructor() {
    this.load();
  }

  label(): string {
    const [y, m] = this.month().split('-').map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  }

  move(delta: number): void {
    this.month.set(addMonths(this.month(), delta));
    this.load();
  }

  money(value: number): string {
    return formatMoney(value);
  }

  private load(): void {
    this.http.get<MonthlyReport>(`${API}/reports/monthly`, { params: { month: this.month() } }).subscribe((r) => this.report.set(r));
  }
}
