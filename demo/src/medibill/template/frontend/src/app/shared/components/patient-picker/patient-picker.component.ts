import { DatePipe } from '@angular/common';
import { Component, EventEmitter, OnDestroy, Output, inject, signal } from '@angular/core';
import { Subject, Subscription, catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { apiErrors } from '../../../core/http/api-errors';
import { PatientInfo } from '../../models/bill.models';
import { MediAgendaApiService } from '../../services/mediagenda-api.service';

/**
 * Patient field of "Nuova richiesta": searches the MediAgenda registry by last name or fiscal code.
 * Emits the chosen patient, and null as soon as the text no longer is that patient (edited or cleared).
 */
@Component({
  selector: 'app-patient-picker',
  standalone: true,
  imports: [DatePipe],
  template: `
    <div class="picker">
      <input id="patient-search" type="text" autocomplete="off" placeholder="Cognome o codice fiscale (MediAgenda)"
             [value]="text()" (input)="onInput($any($event.target).value)" (blur)="open.set(false)" />
      @if (open() && suggestions().length) {
        <ul class="patient-suggestions">
          @for (p of suggestions(); track p.id) {
            <li (mousedown)="pick(p)">
              <b>{{ p.lastName }} {{ p.firstName }}</b> · {{ p.fiscalCode }} · {{ p.birthDate | date: 'dd/MM/yyyy' }}
            </li>
          }
        </ul>
      }
      @if (error()) { <div class="error">{{ error() }}</div> }
    </div>
  `,
  styles: `
    .picker { position: relative; }
    .picker input { width: 100%; min-width: 0; }
    .patient-suggestions { position: absolute; z-index: 5; left: 0; right: 0; margin: 2px 0 0; padding: 4px 0; list-style: none;
      background: var(--surface); border: 1px solid var(--border); border-radius: 6px; box-shadow: 0 6px 16px rgb(0 0 0 / 0.08); }
    .patient-suggestions li { padding: 6px 10px; cursor: pointer; }
    .patient-suggestions li:hover { background: var(--primary-soft); }
    .error { color: var(--danger); font-size: 12px; margin-top: 4px; }
  `,
})
export class PatientPickerComponent implements OnDestroy {
  @Output() readonly picked = new EventEmitter<PatientInfo | null>();

  private readonly api = inject(MediAgendaApiService);
  private readonly typed = new Subject<string>();
  private readonly sub: Subscription;
  private chosen: PatientInfo | null = null;

  readonly text = signal('');
  readonly suggestions = signal<PatientInfo[]>([]);
  readonly open = signal(false);
  readonly error = signal('');

  constructor() {
    this.sub = this.typed
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((q) => {
          this.error.set('');
          if (q.trim().length < 2) return of([] as PatientInfo[]);
          // MediAgenda not answering (502) is shown under the field; the next keystroke tries again.
          return this.api.searchPatients(q.trim()).pipe(catchError((e) => { this.error.set(apiErrors(e)[0]); return of([] as PatientInfo[]); }));
        }),
      )
      .subscribe((list) => { this.suggestions.set(list); this.open.set(true); });
  }

  onInput(value: string): void {
    this.text.set(value);
    // The text no longer names the chosen patient: the form must not keep sending the old patientId.
    if (this.chosen) {
      this.chosen = null;
      this.picked.emit(null);
    }
    this.typed.next(value);
  }

  pick(p: PatientInfo): void {
    this.chosen = p;
    this.text.set(`${p.lastName} ${p.firstName}`);
    this.open.set(false);
    this.picked.emit(p);
  }

  /** Empties the field (after an exemption was saved). */
  clear(): void {
    this.chosen = null;
    this.text.set('');
    this.suggestions.set([]);
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }
}
