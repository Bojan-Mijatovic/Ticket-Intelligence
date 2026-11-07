import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { WARNING_TYPE } from '../../../core/i18n/labels';
import { SafetyCheck } from '../../../shared/models/farma.models';

/**
 * The checks of the prescription being written: the patient's kidney function (eGFR from the MediLab creatinine)
 * and the warnings. ALTA warnings need the prescriber's acknowledgement before EMETTI.
 */
@Component({
  selector: 'app-warnings-panel',
  standalone: true,
  imports: [DatePipe, DecimalPipe],
  template: `
    @if (check; as c) {
      <div class="panel" id="warnings-panel">
        <div class="kidney" id="renal-function">
          @if (c.egfr !== null) {
            eGFR <b id="egfr">{{ c.egfr }}</b> mL/min/1,73 m² · creatinina {{ c.creatinine | number: '1.0-2' : 'it' }} {{ c.creatinineUnit }}
            (MediLab, {{ c.creatinineDate | date: 'dd/MM/yyyy' }})
          } @else {
            <span class="muted">Funzione renale non disponibile</span>
          }
        </div>
        @if (c.warnings.length) {
          <ul class="warnings">
            @for (w of c.warnings; track $index) {
              <li [class]="'w ' + w.severity.toLowerCase()">
                <span [class]="'chip ' + w.severity.toLowerCase()">{{ w.severity }}</span>
                <b>{{ typeLabel(w.type) }}</b>@if (w.drug) { · {{ w.drug }} }: {{ w.message }}
              </li>
            }
          </ul>
        } @else {
          <div class="muted" id="no-warnings">Nessun avviso.</div>
        }
        @if (high()) {
          <label class="check-row"><input id="acknowledge" type="checkbox" [checked]="acknowledged" (change)="acknowledgedChange.emit($any($event.target).checked)" />
            Ho letto gli avvisi ad alta gravità e confermo la prescrizione</label>
        }
      </div>
    }
  `,
  styles: `
    .panel { margin-top: 16px; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); }
    .kidney { margin-bottom: 8px; }
    .warnings { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
    .w.alta { color: var(--danger); }
  `,
})
export class WarningsPanelComponent {
  @Input() check: SafetyCheck | null = null;
  @Input() acknowledged = false;
  @Output() readonly acknowledgedChange = new EventEmitter<boolean>();

  high(): boolean {
    return (this.check?.warnings ?? []).some((w) => w.severity === 'ALTA');
  }

  typeLabel(type: string): string {
    return WARNING_TYPE[type] ?? type;
  }
}
