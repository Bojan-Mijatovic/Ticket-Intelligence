import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { apiErrors } from '../../core/http/api-errors';
import { StructureAutocompleteComponent } from '../../shared/components/structure-autocomplete/structure-autocomplete.component';
import { AgendaResource, Structure, TimeSlot } from '../../shared/models/agenda.models';
import { orderedRange, todayIso } from '../../shared/validators/form-validators';
import { AgendaApiService } from '../agenda/services/agenda-api.service';
import { TimeSlotApiService } from './timeslot-api.service';

const WEEKDAYS = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

/** "Nuova fascia oraria" (CUP_DEMO-2590): a recurring slot for a provider on one or more weekdays. */
@Component({
  selector: 'app-timeslot-form',
  standalone: true,
  imports: [ReactiveFormsModule, StructureAutocompleteComponent],
  template: `
    <section class="card">
      <h1 class="page-title">Nuova fascia oraria</h1>
      <p class="hint">Crea una fascia ricorrente per un erogatore: una fascia per ogni giorno selezionato.</p>

      @if (created().length) {
        <div class="alert success" id="slots-created">
          Create {{ created().length }} fasce:
          <ul>@for (s of created(); track s.id) {<li>{{ s.slotCode }} · {{ s.frequency }} · fino al {{ s.calendarEndDate }}</li>}</ul>
        </div>
      }
      @if (errors().length) {
        <div class="alert error" id="slot-errors"><ul>@for (e of errors(); track e) {<li>{{ e }}</li>}</ul></div>
      }

      <form [formGroup]="form" (ngSubmit)="save()" novalidate>
        <div class="form-grid">
          <div class="form-field">
            <app-structure-autocomplete (structureSelected)="onStructure($event)" />
          </div>
          <div class="form-field">
            <label class="required" for="slot-resource">Erogatore</label>
            <select id="slot-resource" formControlName="resourceCode">
              <option value="">{{ resources().length ? 'Seleziona…' : 'Seleziona prima una struttura' }}</option>
              @for (r of resources(); track r.code) { <option [value]="r.code">{{ r.code }} · {{ r.description }}</option> }
            </select>
          </div>
          <div class="form-field">
            <label class="required" for="agenda-name">Nome agenda</label>
            <input id="agenda-name" type="text" formControlName="agendaName" maxlength="120" placeholder="es. AMBULATORIO DI ECOGRAFIA" />
          </div>
          <div class="form-field wide">
            <span class="label required">Giorni</span>
            <div class="check-row" formArrayName="days">
              @for (day of weekdays; track day; let i = $index) {
                <label><input type="checkbox" [formControlName]="i" [id]="'day-' + i" /> {{ day }}</label>
              }
            </div>
            @if (form.controls.days.touched && !selectedDays().length) { <span class="error">Selezionare almeno un giorno.</span> }
          </div>
          <div class="form-field">
            <label class="required" for="start-time">Dalle</label>
            <input id="start-time" type="time" formControlName="startTime" step="600" />
          </div>
          <div class="form-field">
            <label class="required" for="end-time">Alle</label>
            <input id="end-time" type="time" formControlName="endTime" step="600" />
            @if (form.errors?.['endTimeBeforeFrom']) { <span class="error">L'ora di fine deve essere successiva all'inizio.</span> }
          </div>
          <div class="form-field">
            <label class="required" for="start-date">Valida dal</label>
            <input id="start-date" type="date" formControlName="startDate" [min]="today" />
          </div>
          <div class="form-field">
            <label class="required" for="end-date">Valida al</label>
            <input id="end-date" type="date" formControlName="endDate" />
            @if (form.errors?.['endDateBeforeFrom']) { <span class="error">La data di fine non può precedere l'inizio.</span> }
          </div>
          <div class="form-field">
            <label class="required" for="slot-priority">Priorità</label>
            <select id="slot-priority" formControlName="priority">
              <option value="U">U - Urgente</option>
              <option value="B">B - Breve</option>
              <option value="D">D - Differita</option>
              <option value="P">P - Programmato</option>
            </select>
          </div>
        </div>

        @if (preview(); as p) { <p class="muted" id="slot-preview">Anteprima: {{ p }}</p> }

        <div class="form-actions">
          <button type="button" class="btn-text" (click)="reset()">PULISCI</button>
          <button type="submit" class="btn-primary" id="save-slots" [disabled]="saving()">SALVA FASCE</button>
        </div>
      </form>
    </section>
  `,
})
export class TimeSlotFormComponent {
  private readonly api = inject(TimeSlotApiService);
  private readonly agenda = inject(AgendaApiService);
  private readonly fb = inject(FormBuilder).nonNullable;

  readonly weekdays = WEEKDAYS;
  readonly today = todayIso();
  readonly resources = signal<AgendaResource[]>([]);
  readonly created = signal<TimeSlot[]>([]);
  readonly errors = signal<string[]>([]);
  readonly saving = signal(false);

  readonly form = this.fb.group(
    {
      resourceCode: ['', Validators.required],
      agendaName: ['', [Validators.required, Validators.maxLength(120)]],
      days: new FormArray(WEEKDAYS.map(() => new FormControl(false, { nonNullable: true }))),
      startTime: ['', Validators.required],
      endTime: ['', Validators.required],
      startDate: [todayIso(), Validators.required],
      endDate: ['', Validators.required],
      priority: ['P' as 'U' | 'B' | 'D' | 'P', Validators.required],
    },
    { validators: [orderedRange('startTime', 'endTime'), orderedRange('startDate', 'endDate', true)] },
  );

  private readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  readonly selectedDays = computed(() => WEEKDAYS.filter((_, i) => this.value().days?.[i]));
  readonly preview = computed(() => {
    const v = this.value();
    const days = this.selectedDays();
    if (!v.startTime || !v.endTime || !days.length) return '';
    return `${v.startTime}-${v.endTime}, ogni ${days.join(' e ')}`;
  });

  onStructure(structure: Structure): void {
    this.form.controls.resourceCode.setValue('');
    this.agenda.resources([structure.id]).subscribe((list) => this.resources.set(list));
  }

  reset(): void {
    this.form.reset();
    this.created.set([]);
    this.errors.set([]);
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || !this.selectedDays().length) return;
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.errors.set([]);
    this.api
      .create({
        resourceCode: v.resourceCode,
        agendaName: v.agendaName.trim(),
        weekdays: this.selectedDays(),
        startTime: v.startTime,
        endTime: v.endTime,
        startDate: v.startDate,
        endDate: v.endDate,
        priority: v.priority,
      })
      .subscribe({
        next: (slots) => {
          this.saving.set(false);
          this.created.set(slots);
        },
        error: (e) => {
          this.saving.set(false);
          this.errors.set(apiErrors(e));
        },
      });
  }
}
