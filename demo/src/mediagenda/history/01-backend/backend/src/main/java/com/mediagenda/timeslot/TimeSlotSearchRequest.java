package com.mediagenda.timeslot;

import jakarta.validation.constraints.NotBlank;

/** Body of POST /api/agenda/structure-timeslots. */
public record TimeSlotSearchRequest(@NotBlank String structureId) {}
