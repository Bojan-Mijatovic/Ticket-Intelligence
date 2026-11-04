import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { LABELS } from '../../../core/i18n/labels';
import { Structure } from '../../models/agenda.models';
import { StructureApiService } from '../../services/structure-api.service';

/**
 * "Struttura" field: type at least 2 characters, pick a structure from the suggestions.
 * Emits `structureSelected` when the user picks one.
 */
@Component({
  selector: 'app-structure-autocomplete',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './structure-autocomplete.component.html',
  styleUrl: './structure-autocomplete.component.scss',
})
export class StructureAutocompleteComponent {
  @Input() label: string = LABELS.structure;
  @Output() readonly structureSelected = new EventEmitter<Structure>();

  private readonly api = inject(StructureApiService);
  private readonly query$ = new Subject<string>();

  text = '';
  suggestions: Structure[] = [];
  selected: Structure | null = null;

  constructor() {
    this.query$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((q) => (q.trim().length >= 2 ? this.api.search(q.trim()) : of([]))),
        takeUntilDestroyed(),
      )
      .subscribe((list) => (this.suggestions = list));
  }

  onInput(value: string): void {
    this.text = value;
    // Typing again means the operator is looking for another structure: drop the badge of the previous one.
    if (this.selected && value !== this.selected.id) {
      this.selected = null;
    }
    this.query$.next(value);
  }

  choose(structure: Structure): void {
    this.selected = structure;
    this.text = structure.id;
    this.suggestions = [];
    this.structureSelected.emit(structure);
  }
}
