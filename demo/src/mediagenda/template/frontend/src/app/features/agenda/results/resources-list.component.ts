import { Component, Input } from '@angular/core';
import { LABELS } from '../../../core/i18n/labels';
import { AgendaResource } from '../../../shared/models/agenda.models';

/** "Risorse": providers of the selected structure(s). */
@Component({
  selector: 'app-resources-list',
  standalone: true,
  template: `
    <h3 class="sub">{{ labels.resources }}</h3>
    <table class="table">
      <thead><tr><th style="width: 32px"><input type="checkbox" aria-label="Seleziona tutte" /></th><th>Codice</th><th>Descrizione</th></tr></thead>
      <tbody>
        @for (r of resources; track r.code) {
          <tr><td><input type="checkbox" [attr.aria-label]="r.code" /></td><td>{{ r.code }}</td><td>{{ r.description }}</td></tr>
        } @empty {
          <tr><td colspan="3" class="muted">Nessuna risorsa: seleziona una struttura.</td></tr>
        }
      </tbody>
    </table>
  `,
  styles: `.sub { margin: 4px 0 8px; font-size: 13px; }`,
})
export class ResourcesListComponent {
  @Input() resources: AgendaResource[] = [];
  readonly labels = LABELS;
}
