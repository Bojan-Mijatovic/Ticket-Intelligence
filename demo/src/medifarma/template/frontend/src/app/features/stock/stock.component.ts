import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StockRow } from '../../shared/models/farma.models';
import { DrugApiService } from '../drugs/drug-api.service';

/** "Magazzino": usable packs per drug (expired lots do not count) and the lots; optionally only what expires soon. */
@Component({
  selector: 'app-stock',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <section class="card">
      <div class="toolbar">
        <h1 class="page-title">Magazzino</h1>
        <label class="check-row"><input id="only-expiring" type="checkbox" name="expiring" [(ngModel)]="onlyExpiring" (ngModelChange)="load()" /> Solo lotti in scadenza (60 giorni)</label>
      </div>
      <table class="table" id="stock-table">
        <thead><tr><th>Farmaco</th><th class="num">Disponibili</th><th class="num">Scorta minima</th><th>Lotti</th></tr></thead>
        <tbody>
          @for (r of rows(); track r.aic) {
            <tr>
              <td><b>{{ r.name }}</b> @if (r.low) { <span class="chip low">SOTTO SCORTA</span> }</td>
              <td class="num">{{ r.available }}</td>
              <td class="num">{{ r.minStock }}</td>
              <td>
                @for (l of r.lots; track l.lotNumber) {
                  <div class="lot">
                    {{ l.lotNumber }} · {{ l.expiry | date: 'dd/MM/yyyy' }} · {{ l.quantity }} conf.
                    @if (l.expired) { <span class="chip expired">SCADUTO</span> } @else if (l.daysLeft <= 60) { <span class="chip low">{{ l.daysLeft }} giorni</span> }
                  </div>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="4" class="muted">Nessun lotto.</td></tr>
          }
        </tbody>
      </table>
    </section>
  `,
  styles: `.lot { white-space: nowrap; } .toolbar .check-row { padding: 0; }`,
})
export class StockComponent {
  private readonly api = inject(DrugApiService);
  onlyExpiring = false;
  readonly rows = signal<StockRow[]>([]);

  constructor() {
    this.load();
  }

  load(): void {
    (this.onlyExpiring ? this.api.expiring(60) : this.api.stock()).subscribe((list) => this.rows.set(list));
  }
}
