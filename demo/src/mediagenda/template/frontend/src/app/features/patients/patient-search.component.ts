import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PageResponse, Patient, PatientApiService } from './patient-api.service';

@Component({
  selector: 'app-patient-search',
  standalone: true,
  imports: [FormsModule, DatePipe, RouterLink],
  template: `
    <section class="card">
      <div class="toolbar">
        <h1 class="page-title">Pazienti</h1>
        <a class="btn-primary" routerLink="/pazienti/nuovo" id="new-patient">NUOVO PAZIENTE</a>
      </div>
      <form class="row" (ngSubmit)="search(0)">
        <input type="search" name="q" placeholder="Cognome o codice fiscale" [(ngModel)]="query" />
        <button type="submit" class="btn-primary">RICERCA</button>
      </form>
      @if (result(); as r) {
        <table class="table">
          <thead><tr><th>Cognome</th><th>Nome</th><th>Codice fiscale</th><th>Data di nascita</th><th>Comune</th><th></th></tr></thead>
          <tbody>
            @for (p of r.items; track p.id) {
              <tr>
                <td>{{ p.lastName }}</td><td>{{ p.firstName }}</td><td>{{ p.fiscalCode }}</td>
                <td>{{ p.birthDate | date: 'dd/MM/yyyy' }}</td><td>{{ p.city }}</td>
                <td><a class="btn-text" [routerLink]="['/pazienti', p.id]">Modifica</a></td>
              </tr>
            }
          </tbody>
        </table>
        <div class="pager">
          <button type="button" class="btn-text" [disabled]="r.page === 0" (click)="search(r.page - 1)">‹ Precedente</button>
          <span class="muted">Pagina {{ r.page + 1 }} · {{ r.total }} pazienti</span>
          <button type="button" class="btn-text" [disabled]="(r.page + 1) * r.size >= r.total" (click)="search(r.page + 1)">Successiva ›</button>
        </div>
      }
    </section>
  `,
  styles: `
    .row { display: flex; gap: 8px; margin-bottom: 12px; }
    .pager { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
    a.btn-primary, a.btn-text { text-decoration: none; display: inline-block; }
  `,
})
export class PatientSearchComponent {
  private readonly api = inject(PatientApiService);
  query = '';
  readonly result = signal<PageResponse<Patient> | null>(null);

  constructor() {
    this.search(0);
  }

  search(page: number): void {
    this.api.search(this.query, page).subscribe((r) => this.result.set(r));
  }
}
