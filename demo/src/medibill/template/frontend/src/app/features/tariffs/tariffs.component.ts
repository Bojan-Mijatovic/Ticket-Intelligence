import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { API } from '../../core/http/api';
import { Tariff } from '../../shared/models/bill.models';
import { formatMoney } from '../../shared/utils/money';

/** "Tariffario": the regional fee schedule; visits are mapped to the MediAgenda provider they are charged for. */
@Component({
  selector: 'app-tariffs',
  standalone: true,
  template: `
    <section class="card">
      <h1 class="page-title">Tariffario</h1>
      <table class="table" id="tariffs-table">
        <thead><tr><th>Codice</th><th>Prestazione</th><th>Tipo</th><th>Erogatore MediAgenda</th><th class="money">Tariffa</th></tr></thead>
        <tbody>
          @for (t of tariffs(); track t.code) {
            <tr><td><b>{{ t.code }}</b></td><td>{{ t.description }}</td><td>{{ t.kind }}</td><td>{{ t.mediagendaResource ?? '–' }}</td><td class="money">{{ money(t.price) }}</td></tr>
          }
        </tbody>
      </table>
    </section>
  `,
})
export class TariffsComponent {
  readonly tariffs = signal<Tariff[]>([]);

  constructor() {
    inject(HttpClient).get<Tariff[]>(`${API}/tariffs`).subscribe((list) => this.tariffs.set(list));
  }

  money(value: number): string {
    return formatMoney(value);
  }
}
