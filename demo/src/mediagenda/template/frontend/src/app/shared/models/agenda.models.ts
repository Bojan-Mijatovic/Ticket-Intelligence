export interface Structure {
  id: string;
  name: string;
  city: string;
}

export interface AgendaResource {
  code: string;
  description: string;
  structureId: string;
  active: boolean;
}

export interface TimeSlot {
  id: number;
  agendaName: string;
  slotCode: string;
  startDate: string;
  endDate: string;
  frequency: string;
  weekday: string;
  startTime: string;
  endTime: string;
  priority: string;
  priorityRank: number;
  calendarEndDate: string;
  resourceCode: string;
  structureId: string;
}
