import { DatePipe } from '@angular/common';
import { Component, Input } from '@angular/core';
import { TimeSlot } from '../../../shared/models/agenda.models';

/** Daily detail of the time slots ("fasce orarie"). */
@Component({
  selector: 'app-timeslot-table',
  standalone: true,
  imports: [DatePipe],
  template: `
    <table class="table">
      <thead>
        <tr>
          <th style="width: 32px"><input type="checkbox" aria-label="Seleziona tutte" /></th>
          <th>Agenda</th><th>Fascia</th><th>Codice fascia</th><th>Data inizio fascia</th><th>Data fine fascia</th>
          <th>Frequenza</th><th>Giorno settimana</th><th>Ora inizio</th><th>Ora fine</th><th>Priorità</th>
          <th class="num">Equipara priorità</th><th>Data fine calendario</th>
        </tr>
      </thead>
      <tbody>
        @if (loading) {
          <tr><td colspan="13" class="muted">Caricamento…</td></tr>
        } @else {
          @for (s of slots; track s.id) {
            <tr>
              <td><input type="checkbox" [attr.aria-label]="s.slotCode" /></td>
              <td>{{ s.agendaName }}</td><td>{{ s.id }}</td><td>{{ s.slotCode }}</td>
              <td>{{ s.startDate | date: 'dd/MM/yyyy' }}</td><td>{{ s.endDate | date: 'dd/MM/yyyy' }}</td>
              <td>{{ s.frequency }}</td><td>{{ s.weekday }}</td>
              <td>{{ s.startTime.slice(0, 5) }}</td><td>{{ s.endTime.slice(0, 5) }}</td>
              <td>{{ s.priority }}</td><td class="num">{{ s.priorityRank }}</td>
              <td>{{ s.calendarEndDate | date: 'dd/MM/yyyy' }}</td>
            </tr>
          } @empty {
            <tr><td colspan="13" class="muted">Nessuna fascia oraria.</td></tr>
          }
        }
      </tbody>
    </table>
  `,
})
export class TimeSlotTableComponent {
  @Input() slots: TimeSlot[] = [];
  @Input() loading = false;
}
