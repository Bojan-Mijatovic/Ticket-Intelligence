import { Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrors } from '../../core/http/api-errors';
import { REJECT_REASONS, SAMPLE_TYPE } from '../../core/i18n/labels';
import { SampleView } from '../../shared/models/lab.models';
import { SampleApiService } from './sample-api.service';

/**
 * Acceptance desk: the tube's barcode is scanned (the scanner types it and presses Enter), then the tube is
 * accepted or rejected with a reason. The field is emptied for the next tube.
 */
@Component({
  selector: 'app-sample-acceptance',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="card">
      <h1 class="page-title">Accettazione campioni</h1>
      <form class="row" (ngSubmit)="scan()">
        <input #barcodeInput id="barcode" type="text" name="barcode" autocomplete="off" placeholder="Codice a barre (LB…)" [(ngModel)]="barcode" />
        <button type="submit" class="btn-primary" id="find-sample">RICERCA</button>
      </form>
      @if (message()) { <div class="alert success" id="sample-message">{{ message() }}</div> }
      @if (errors().length) { <div class="alert error" id="sample-errors">@for (e of errors(); track e) { <div>{{ e }}</div> }</div> }

      @if (sample(); as s) {
        <div class="sample" id="sample-card">
          <div class="head">
            <b>{{ s.barcode }}</b> · {{ sampleLabel(s.sampleType) }}
            <span [class]="'chip ' + s.status.toLowerCase()">{{ s.status }}</span>
            @if (s.urgent) { <span class="chip urgent">URGENTE</span> }
          </div>
          <div>Richiesta {{ s.orderId }} · {{ s.patientName }} · {{ s.fiscalCode }}</div>
          <div class="muted">Esami: {{ s.examCodes.join(', ') }}</div>
          @if (s.status === 'ATTESO') {
            <div class="actions">
              <button type="button" class="btn-primary" id="accept-sample" (click)="accept(s)">ACCETTA</button>
              <select id="reject-reason" name="reason" [(ngModel)]="reason">
                <option value="">Motivo del rifiuto…</option>
                @for (r of reasons; track r) { <option [value]="r">{{ r }}</option> }
              </select>
              <button type="button" class="btn-danger" id="reject-sample" [disabled]="!reason" (click)="reject(s)">RIFIUTA</button>
            </div>
          }
        </div>
      }
    </section>
  `,
  styles: `
    .row { display: flex; gap: 8px; margin-bottom: 12px; }
    .sample { display: grid; gap: 6px; padding: 12px; border: 1px solid var(--border); border-radius: 8px; }
    .head { display: flex; align-items: center; gap: 8px; }
    .actions { display: flex; gap: 8px; margin-top: 6px; }
  `,
})
export class SampleAcceptanceComponent {
  @ViewChild('barcodeInput') barcodeInput?: ElementRef<HTMLInputElement>;
  private readonly api = inject(SampleApiService);
  readonly reasons = REJECT_REASONS;
  barcode = '';
  reason = '';
  readonly sample = signal<SampleView | null>(null);
  readonly message = signal('');
  readonly errors = signal<string[]>([]);

  sampleLabel(type: string): string {
    return SAMPLE_TYPE[type] ?? type;
  }

  scan(): void {
    // Labels are printed in upper case; a scanner with Caps Lock off, or a code typed by hand, may send lower case.
    const code = this.barcode.trim().toUpperCase();
    if (!code) return;
    this.message.set('');
    this.api.get(code).subscribe({
      next: (s) => { this.sample.set(s); this.errors.set([]); this.reason = ''; },
      error: (e) => { this.sample.set(null); this.errors.set(apiErrors(e)); },
    });
  }

  accept(s: SampleView): void {
    this.api.accept(s.barcode).subscribe({
      next: (done) => this.next(`${done.barcode} accettato${done.orderStatus === 'IN_LAVORAZIONE' ? ` · richiesta ${done.orderId} in lavorazione` : ''}`),
      error: (e) => this.errors.set(apiErrors(e)),
    });
  }

  reject(s: SampleView): void {
    this.api.reject(s.barcode, this.reason).subscribe({
      next: (done) => this.next(`${done.barcode} rifiutato (${done.rejectReason})${done.replacedBy ? ` · nuova provetta ${done.replacedBy}` : ''}`),
      error: (e) => this.errors.set(apiErrors(e)),
    });
  }

  /** Done with this tube: message, empty field, focus back for the next scan. */
  private next(message: string): void {
    this.message.set(message);
    this.errors.set([]);
    this.sample.set(null);
    this.barcode = '';
    this.reason = '';
    this.barcodeInput?.nativeElement.focus();
  }
}
