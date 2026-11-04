package com.mediagenda.timeslot;

import jakarta.validation.constraints.NotEmpty;
import java.util.List;

/**
 * Body of POST /api/agenda/structure-timeslots.
 * CUP_DEMO-2398: a search can span several structures, so the request carries a list.
 */
public record TimeSlotSearchRequest(@NotEmpty List<String> structureIds) {}
