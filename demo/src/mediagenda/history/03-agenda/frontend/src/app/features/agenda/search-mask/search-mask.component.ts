import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LABELS } from '../../../core/i18n/labels';
import { FooterActionsComponent } from '../../../shared/components/footer-actions/footer-actions.component';
import { StructureAutocompleteComponent } from '../../../shared/components/structure-autocomplete/structure-autocomplete.component';
import { Structure } from '../../../shared/models/agenda.models';
import { ResourcesListComponent } from '../results/resources-list.component';
import { TimeSlotTableComponent } from '../results/timeslot-table.component';
import { AgendaSearchStore } from '../state/agenda-search.store';

type SearchBy = 'struttura' | 'agenda' | 'erogatore';

/** Agenda search mask: pick a structure, see its providers ("Risorse") and time slots. */
@Component({
  selector: 'app-agenda-search-mask',
  standalone: true,
  imports: [FormsModule, StructureAutocompleteComponent, FooterActionsComponent, ResourcesListComponent, TimeSlotTableComponent],
  providers: [AgendaSearchStore],
  templateUrl: './search-mask.component.html',
})
export class SearchMaskComponent {
  readonly store = inject(AgendaSearchStore);
  readonly labels = LABELS;
  searchBy: SearchBy = 'struttura';

  onStructureSelected(structure: Structure): void {
    this.store.selectStructure(structure);
  }

  onClean(): void {
    this.store.reset();
  }

  onSearch(): void {
    this.store.load();
  }
}
