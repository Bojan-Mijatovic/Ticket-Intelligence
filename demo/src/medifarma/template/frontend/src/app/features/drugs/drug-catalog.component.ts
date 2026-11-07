import { CurrencyPipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Drug } from '../../shared/models/farma.models';
import { DrugApiService } from './drug-api.service';

/** The hospital formulary, with the renal dose rules of the drugs cleared by the kidneys. */
@Component({
  selector: 'app-drug-catalog',
  standalone: true,
  imports: [FormsModule, CurrencyPipe],
  template: `
    <section class="card">
      <h1 class="page-title">Farmaci</h1>
      <form class="row" (ngSubmit)="load()">
        <input type="search" name="q" placeholder="Nome o principio attivo" [(ngModel)]="query" />
        <button type="submit" class="btn-primary">RICERCA</button>
      </form>
      <table class="table" id="drugs-table">
        <thead><tr><th>AIC</th><th>Farmaco</th><th>Principio attivo</th><th>ATC</th><th class="num">Confezione</th><th class="num">Prezzo</th><th>Funzione renale</th></tr></thead>
        <tbody>
          @for (d of drugs(); track d.aic) {
            <tr>
              <td>{{ d.aic }}</td><td><b>{{ d.name }}</b></td><td>{{ d.activeIngredient }}</td><td>{{ d.atc }}</td>
              <td class="num">{{ d.packSize }}</td><td class="num">{{ d.unitPrice | currency: 'EUR' : 'symbol' : '1.2-2' : 'it' }}</td>
              <td>{{ renal(d) }}</td>
            </tr>
          }
        </tbody>
      </table>
    </section>
  `,
  styles: `.row { display: flex; gap: 8px; margin-bottom: 12px; }`,
})
export class DrugCatalogComponent {
  private readonly api = inject(DrugApiService);
  query = '';
  readonly drugs = signal<Drug[]>([]);

  constructor() {
    this.load();
  }

  load(): void {
    this.api.search(this.query.trim()).subscribe((list) => this.drugs.set(list));
  }

  renal(d: Drug): string {
    const parts = [];
    if (d.renalAvoidBelow !== null) parts.push(`evitare sotto eGFR ${d.renalAvoidBelow}`);
    if (d.renalReduceBelow !== null) parts.push(`ridurre sotto eGFR ${d.renalReduceBelow}`);
    return parts.join(' · ');
  }
}
