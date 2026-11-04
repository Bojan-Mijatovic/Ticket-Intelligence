import { Component, EventEmitter, Input, Output } from '@angular/core';
import { LABELS } from '../../../core/i18n/labels';

/** Sticky footer of the search masks: PREFERENZE · PULISCI · RICERCA. */
@Component({
  selector: 'app-footer-actions',
  standalone: true,
  template: `
    <footer class="footer-actions">
      <button type="button" class="btn-text" (click)="preferences.emit()">{{ labels.preferences }}</button>
      <button type="button" class="btn-text" (click)="clean.emit()">{{ labels.clean }}</button>
      <button type="button" class="btn-primary" [disabled]="searchDisabled" (click)="search.emit()">{{ labels.search }}</button>
    </footer>
  `,
  styles: `
    .footer-actions {
      position: fixed; right: 0; bottom: 0; left: 200px; display: flex; justify-content: flex-end; gap: 8px;
      padding: 10px 24px; background: var(--surface); border-top: 1px solid var(--border);
    }
    @media (max-width: 800px) { .footer-actions { left: 0; } }
  `,
})
export class FooterActionsComponent {
  @Input() searchDisabled = false;
  @Output() readonly preferences = new EventEmitter<void>();
  @Output() readonly clean = new EventEmitter<void>();
  @Output() readonly search = new EventEmitter<void>();
  readonly labels = LABELS;
}
