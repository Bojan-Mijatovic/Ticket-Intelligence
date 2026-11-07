package com.medibill.integration;

import java.time.LocalDateTime;

/**
 * A MediAgenda booking (its BookingView, GET /api/bookings), as the charge import needs it: who, when, which
 * provider (resourceCode: the tariff of the visit) and the booking status.
 */
public record BookingInfo(
        String id,
        LocalDateTime appointmentAt,
        String status,
        Long patientId,
        String patientName,
        String fiscalCode,
        String agendaName,
        String resourceCode,
        String prescriptionCode) {}
