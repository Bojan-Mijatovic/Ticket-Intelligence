import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrors } from '../../core/http/api-errors';
import { RECEIPT_STATUS } from '../../core/i18n/labels';
import { Receipt } from '../../shared/models/bill.models';
import { formatMoney } from '../../shared/utils/money';
import { ReceiptApiService } from './receipt-api.service';

/** "Ricevute": the receipts with their lines; PAGA at the desk, STORNA (cancel) an unpaid one to correct it. */
@Component({
  selector: 'app-receipts',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <section class="card">
      <div class="toolbar">
        <h1 class="page-title">Ricevute</h1>
        <select id="status-filter" name="status" [(ngModel)]="status" (ngModelChange)="load()">
          <option value="">Tutte</option>
          @for (s of statuses; track s[0]) { <option [value]="s[0]">{{ s[1] }}</option> }
        </select>
      </div>
      @if (message()) { <div class="alert success" id="receipt-message">{{ message() }}</div> }
      @if (errors().length) { <div class="alert error" id="receipt-errors">@for (e of errors(); track e) { <div>{{ e }}</div> }</div> }
      <table class="table" id="receipts-table">
        <thead><tr><th>Ricevuta</th><th>Data</th><th>Paziente</th><th class="money">Importo</th><th class="money">Esente</th><th class="money">Ticket</th><th>Stato</th><th></th></tr></thead>
        <tbody>
          @for (r of receipts(); track r.id) {
            <tr [attr.data-receipt]="r.id">
              <td><button type="button" class="btn-text" (click)="toggle(r.id)">{{ r.id }}</button></td>
              <td>{{ r.issuedAt | date: 'dd/MM/yyyy HH:mm' }}</td>
              <td>{{ r.patientName }}</td>
              <td class="money">{{ money(r.total) }}</td>
              <td class="money">{{ money(r.exempt) }} @if (r.exemptionCodes) { <span class="chip exempt">{{ r.exemptionCodes }}</span> }</td>
              <td class="money copay">{{ money(r.copay) }}</td>
              <td><span [class]="'chip ' + r.status.toLowerCase()">{{ statusLabel(r.status) }}</span></td>
              <td class="actions">
                @if (r.status === 'EMESSA') {
                  <button type="button" class="btn-primary pay" (click)="pay(r)">PAGA</button>
                  <button type="button" class="btn-text storno" (click)="storno(r)">STORNA</button>
                }
              </td>
            </tr>
            @if (open() === r.id) {
              <tr class="lines"><td colspan="8">
                <table class="table">
                  @for (l of r.lines; track l.chargeId) {
                    <tr><td>{{ l.serviceDate | date: 'dd/MM/yyyy' }}</td><td>{{ l.tariffCode }} · {{ l.description }}</td>
                      <td class="money">{{ money(l.amount) }}</td><td>@if (l.exempt) { <span class="chip exempt">esente</span> }</td></tr>
                  }
                </table>
              </td></tr>
            }
          } @empty {
            <tr><td colspan="8" class="muted">Nessuna ricevuta.</td></tr>
          }
        </tbody>
      </table>
    </section>
  `,
  styles: `.actions { display: flex; gap: 4px; } .actions .btn-primary { padding: 4px 10px; } .lines > td { background: var(--bg); }`,
})
export class ReceiptsComponent {
  private readonly api = inject(ReceiptApiService);
  readonly statuses = Object.entries(RECEIPT_STATUS);
  status = '';
  readonly receipts = signal<Receipt[]>([]);
  readonly open = signal<string | null>(null);
  readonly message = signal('');
  readonly errors = signal<string[]>([]);

  constructor() {
    this.load();
  }

  load(): void {
    this.api.list(this.status).subscribe({ next: (list) => this.receipts.set(list), error: (e) => this.errors.set(apiErrors(e)) });
  }

  money(value: number): string {
    return formatMoney(value);
  }

  statusLabel(status: string): string {
    return RECEIPT_STATUS[status] ?? status;
  }

  toggle(id: string): void {
    this.open.set(this.open() === id ? null : id);
  }

  pay(r: Receipt): void {
    this.api.pay(r.id).subscribe({ next: (done) => this.done(`${done.id} pagata: ${formatMoney(done.copay)}`), error: (e) => this.errors.set(apiErrors(e)) });
  }

  storno(r: Receipt): void {
    this.api.storno(r.id).subscribe({ next: (done) => this.done(`${done.id} stornata: gli addebiti sono di nuovo aperti`), error: (e) => this.errors.set(apiErrors(e)) });
  }

  private done(message: string): void {
    this.message.set(message);
    this.errors.set([]);
    this.load();
  }
}
