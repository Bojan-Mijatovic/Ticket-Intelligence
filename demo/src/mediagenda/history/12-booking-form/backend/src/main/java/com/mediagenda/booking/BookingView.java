package com.mediagenda.booking;

import java.time.LocalDateTime;

/** A booking as shown in the Prenotazioni list: with the patient's name and the agenda of its time slot. */
public record BookingView(
        String id,
        LocalDateTime appointmentAt,
        String status,
        String priority,
        Long patientId,
        String patientName,
        String fiscalCode,
        Long timeSlotId,
        String agendaName,
        String structureId,
        String resourceCode,
        String prescriptionCode,
        String notes) {}
