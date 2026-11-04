import { Injectable, inject, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import { AgendaResource, Structure, TimeSlot } from '../../../shared/models/agenda.models';
import { AgendaApiService } from '../services/agenda-api.service';

/** State of the Agenda search mask. Provided per search-mask instance. */
@Injectable()
export class AgendaSearchStore {
  private readonly api = inject(AgendaApiService);

  readonly selectedStructureId = signal<string | null>(null);
  readonly resources = signal<AgendaResource[]>([]);
  readonly timeSlots = signal<TimeSlot[]>([]);
  readonly loading = signal(false);

  selectStructure(structure: Structure): void {
    this.selectedStructureId.set(structure.id);
    this.load();
  }

  load(): void {
    const id = this.selectedStructureId();
    if (!id) return;
    this.loading.set(true);
    forkJoin({ resources: this.api.resources([id]), slots: this.api.structureTimeSlots(id) }).subscribe({
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
