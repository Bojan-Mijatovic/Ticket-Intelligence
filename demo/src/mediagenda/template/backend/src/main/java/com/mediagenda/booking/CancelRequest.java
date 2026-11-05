package com.mediagenda.booking;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Body of POST /api/bookings/{id}/cancel. */
public record CancelRequest(@NotBlank @Size(max = 200) String reason) {}
