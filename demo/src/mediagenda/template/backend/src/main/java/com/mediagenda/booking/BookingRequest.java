package com.mediagenda.booking;

import jakarta.validation.constraints.Future;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDateTime;

/** Body of POST /api/bookings (the "Nuova prenotazione" form). */
public record BookingRequest(
        @NotNull Long patientId,
        @NotNull Long timeSlotId,
        @NotNull @Future LocalDateTime appointmentAt,
        @NotBlank @Pattern(regexp = "^[UBDP]$", message = "must be U, B, D or P") String priority,
        @Pattern(regexp = "(?i)^$|^[0-9]{4}[A-Z][0-9]{10}$", message = "is not a valid NRE (electronic prescription number)")
        String prescriptionCode,
        @Size(max = 500) String notes) {}
