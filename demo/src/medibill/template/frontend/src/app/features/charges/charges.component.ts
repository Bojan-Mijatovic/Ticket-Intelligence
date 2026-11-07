import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrors } from '../../core/http/api-errors';
import { SOURCE } from '../../core/i18n/labels';
import { Charge, ImportResult } from '../../shared/models/bill.models';
import { dayFromToday } from '../../shared/utils/dates';
import { formatMoney } from '../../shared/utils/money';
import { ReceiptApiService } from '../receipts/receipt-api.service';
import { ChargeApiService } from './charge-api.service';

/**
 * "Addebiti": the daily import of the services to charge (MediAgenda visits, MediLab tests), and the open charges by
 * patient, ready for a receipt.
 */
@Component({
  selector: 'app-charges',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <section class="card">
      <h1 class="page-title">Addebiti</h1>
      <form class="row" (ngSubmit)="importDay()">
        <label for="import-date" class="muted">Giorno</label>
        <input id="import-date" type="date" name="date" [(ngModel)]="date" />
        <button type="button" class="btn-text" id="yesterday" (click)="date = yesterday()">Ieri</button>
        <button type="button" class="btn-text" id="today" (click)="date = today()">Oggi</button>
        <button type="submit" class="btn-primary" id="import" [disabled]="!date || busy()">IMPORTA</button>
      </form>
      @if (result(); as r) {
        <div class="alert success" id="import-result">
          {{ r.day | date: 'dd/MM/yyyy' }}: {{ r.visits }} visite, {{ r.tests }} analisi importate · {{ r.alreadyImported }} già presenti
          @if (r.skipped.length) { <ul>@for (s of r.skipped; track s) { <li>{{ s }}</li> }</ul> }
        </div>
      }
      @if (message()) { <div class="alert success" id="charges-message">{{ message() }}</div> }
      @if (errors().length) { <div class="alert error" id="charges-errors">@for (e of errors(); track e) { <div>{{ e }}</div> }</div> }
    </section>

    <section class="card">
      <h2>Da fatturare</h2>
      @for (p of patients(); track p.fiscalCode) {
        <div class="patient" [attr.data-patient]="p.fiscalCode">
          <div class="head">
            <b>{{ p.name }}</b> · {{ p.fiscalCode }} · <span class="money">{{ money(p.total) }}</span>
            <button type="button" class="btn-primary issue" (click)="issue(p.fiscalCode)">EMETTI RICEVUTA</button>
          </div>
          <table class="table">
            <tbody>
              @for (c of p.charges; track c.id) {
                <tr>
                  <td>{{ c.serviceDate | date: 'dd/MM/yyyy' }}</td><td>{{ sourceLabel(c.source) }}</td><td>{{ c.sourceRef }}</td>
                  <td>{{ c.tariffCode }} · {{ c.description }}</td><td class="money">{{ money(c.amount) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @empty {
        <p class="muted">Nessun addebito aperto.</p>
      }
    </section>
  `,
  styles: `
    .row { display: flex; align-items: center; gap: 8px; }
    .patient { margin-bottom: 14px; }
    .head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .head .issue { margin-left: auto; padding: 4px 10px; }
  `,
})
export class ChargesComponent {
  private readonly api = inject(ChargeApiService);
  private readonly receipts = inject(ReceiptApiService);
  date = dayFromToday(-1);
  readonly charges = signal<Charge[]>([]);
  readonly result = signal<ImportResult | null>(null);
  readonly message = signal('');
  readonly errors = signal<string[]>([]);
  readonly busy = signal(false);
  /** Open charges grouped by patient. */
  readonly patients = computed(() => {
    const groups = new Map<string, { fiscalCode: string; name: string; total: number; charges: Charge[] }>();
    for (const c of this.charges()) {
      const g = groups.get(c.fiscalCode) ?? { fiscalCode: c.fiscalCode, name: c.patientName, total: 0, charges: [] };
      g.charges.push(c);
      g.total = Math.round((g.total + c.amount) * 100) / 100;
      groups.set(c.fiscalCode, g);
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  constructor() {
    this.load();
  }

  today(): string {
    return dayFromToday(0);
  }

  yesterday(): string {
    return dayFromToday(-1);
  }

  money(value: number): string {
    return formatMoney(value);
  }

  sourceLabel(source: string): string {
    return SOURCE[source] ?? source;
  }

  load(): void {
    this.api.list('APERTO').subscribe({ next: (list) => this.charges.set(list), error: (e) => this.errors.set(apiErrors(e)) });
  }

  importDay(): void {
    this.busy.set(true);
    this.api.importDay(this.date).subscribe({
      next: (r) => { this.result.set(r); this.errors.set([]); this.busy.set(false); this.load(); },
      error: (e) => { this.errors.set(apiErrors(e)); this.busy.set(false); },
    });
  }

  issue(fiscalCode: string): void {
    this.receipts.issue(fiscalCode).subscribe({
      next: (r) => { this.message.set(`Ricevuta ${r.id} emessa: ticket ${formatMoney(r.copay)}`); this.errors.set([]); this.load(); },
      error: (e) => this.errors.set(apiErrors(e)),
    });
  }
}
