import { Injectable, inject, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import { AgendaResource, Structure, TimeSlot } from '../../../shared/models/agenda.models';
import { AgendaApiService } from '../services/agenda-api.service';

/** State of the Agenda search mask. Provided per search-mask instance. */
@Injectable()
export class AgendaSearchStore {
  private readonly api = inject(AgendaApiService);

  /** Structures used for the search (CUP_DEMO-2398: the time slot service accepts several). */
  readonly selectedStructureIds = signal<string[]>([]);
  readonly resources = signal<AgendaResource[]>([]);
  readonly timeSlots = signal<TimeSlot[]>([]);
  readonly loading = signal(false);

  selectStructure(structure: Structure): void {
    if (!this.selectedStructureIds().includes(structure.id)) {
      this.selectedStructureIds.update((ids) => [...ids, structure.id]);
    }
    this.load();
  }

  load(): void {
    const ids = this.selectedStructureIds();
    if (!ids.length) return;
    this.loading.set(true);
    forkJoin({ resources: this.api.resources(ids), slots: this.api.structureTimeSlots(ids) }).subscribe({
      next: ({ resources, slots }) => {
        this.resources.set(resources);
        this.timeSlots.set(slots);
      },
      complete: () => this.loading.set(false),
      error: () => this.loading.set(false),
    });
  }

  reset(): void {
    this.resources.set([]);
    this.timeSlots.set([]);
  }
}
