package com.mediagenda.timeslot;

import java.time.LocalDateTime;

/** A free appointment time inside a time slot, offered by the "Nuova prenotazione" form. */
public record AvailableTime(Long timeSlotId, LocalDateTime startAt, String agendaName, String priority, String structureId) {

    static AvailableTime of(TimeSlot slot, LocalDateTime startAt) {
        return new AvailableTime(slot.getId(), startAt, slot.getAgendaName(), slot.getPriority(), slot.getStructureId());
    }
}
