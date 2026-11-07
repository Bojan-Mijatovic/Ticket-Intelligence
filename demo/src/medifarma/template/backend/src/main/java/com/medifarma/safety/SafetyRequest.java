package com.medifarma.safety;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.List;

/** Body of POST /api/safety/check: a MediAgenda patient and the AIC codes of the drugs being prescribed. */
public record SafetyRequest(@NotNull Long patientId, @NotEmpty List<String> aics) {}
