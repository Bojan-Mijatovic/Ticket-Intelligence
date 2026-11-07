import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrors } from '../../core/http/api-errors';
import { ORDER_STATUS } from '../../core/i18n/labels';
import { OrderView } from '../../shared/models/lab.models';
import { OrderApiService } from './order-api.service';

@Component({
  selector: 'app-order-list',
  standalone: true,
  imports: [FormsModule, DatePipe, RouterLink],
  template: `
    <section class="card">
      <div class="toolbar">
        <h1 class="page-title">Richieste</h1>
        <a class="btn-primary" routerLink="/richieste/nuova" id="new-order">NUOVA RICHIESTA</a>
      </div>
      <form class="row" (ngSubmit)="load()">
        <select id="status-filter" name="status" [(ngModel)]="status" (ngModelChange)="load()">
          <option value="">Tutte</option>
          @for (s of statuses; track s[0]) { <option [value]="s[0]">{{ s[1] }}</option> }
        </select>
        <input type="search" name="q" placeholder="Paziente o codice fiscale" [(ngModel)]="query" />
        <button type="submit" class="btn-primary">RICERCA</button>
      </form>
      @if (message()) { <div class="alert success" id="order-message">{{ message() }}</div> }
      @if (errors().length) { <div class="alert error" id="order-errors">@for (e of errors(); track e) { <div>{{ e }}</div> }</div> }
      <table class="table" id="orders-table">
        <thead><tr><th>Richiesta</th><th>Data</th><th>Paziente</th><th>Codice fiscale</th><th>Esami</th><th>Stato</th><th></th></tr></thead>
        <tbody>
          @for (o of orders(); track o.id) {
            <tr>
              <td><b>{{ o.id }}</b> @if (o.urgent) { <span class="chip urgent">URGENTE</span> }</td>
              <td>{{ o.requestedAt | date: 'dd/MM/yyyy HH:mm' }}</td>
              <td>{{ o.patientName }}</td>
              <td>{{ o.fiscalCode }}</td>
              <td [title]="examNames(o)">{{ o.exams.length }}</td>
              <td><span [class]="'chip ' + o.status.toLowerCase()">{{ statusLabel(o.status) }}</span></td>
              <td class="actions">
                @if (o.status === 'IN_LAVORAZIONE') { <a class="btn-text" [routerLink]="['/richieste', o.id, 'risultati']">Risultati</a> }
                @if (o.status === 'REFERTATA') { <a class="btn-text" [routerLink]="['/referti', o.id]">Referto</a> }
                @if (o.status === 'RICHIESTA') { <button type="button" class="btn-text" (click)="askCancel(o)">Annulla</button> }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="7" class="muted">Nessuna richiesta.</td></tr>
          }
        </tbody>
      </table>
      @if (cancelling(); as o) {
        <div class="cancel-row">
          <span>Annulla <b>{{ o.id }}</b> ({{ o.patientName }}): motivo</span>
          <input id="cancel-reason" type="text" name="reason" [(ngModel)]="reason" />
          <button type="button" class="btn-danger" id="confirm-cancel" [disabled]="!reason.trim()" (click)="cancel(o)">CONFERMA ANNULLAMENTO</button>
          <button type="button" class="btn-text" (click)="cancelling.set(null)">Chiudi</button>
        </div>
      }
    </section>
  `,
  styles: `
    .row { display: flex; gap: 8px; margin-bottom: 12px; }
    .actions { display: flex; gap: 4px; }
    .cancel-row { display: flex; align-items: center; gap: 8px; margin-top: 12px; padding: 10px; background: var(--danger-soft); border-radius: 6px; }
  `,
})
export class OrderListComponent {
  private readonly api = inject(OrderApiService);
  readonly statuses = Object.entries(ORDER_STATUS);
  status = '';
  query = '';
  reason = '';
  readonly orders = signal<OrderView[]>([]);
  readonly cancelling = signal<OrderView | null>(null);
  readonly message = signal('');
  readonly errors = signal<string[]>([]);

  constructor() {
    this.load();
  }

  load(): void {
    this.api.list(this.status, this.query).subscribe({
      next: (list) => this.orders.set(list),
      error: (e) => this.errors.set(apiErrors(e)),
    });
  }

  statusLabel(status: string): string {
    return ORDER_STATUS[status] ?? status;
  }

  examNames(o: OrderView): string {
    return o.exams.map((e) => e.name).join(', ');
  }

  askCancel(o: OrderView): void {
    this.reason = '';
    this.cancelling.set(o);
  }

  cancel(o: OrderView): void {
    this.api.cancel(o.id, this.reason).subscribe({
      next: (done) => {
        this.message.set(`${done.id} annullata`);
        this.errors.set([]);
        this.cancelling.set(null);
        this.load();
      },
      error: (e) => this.errors.set(apiErrors(e)),
    });
  }
}
