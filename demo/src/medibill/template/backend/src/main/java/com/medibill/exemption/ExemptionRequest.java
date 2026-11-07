package com.medibill.exemption;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;

/** Body of POST /api/exemptions: a MediAgenda patient, the exemption code and its validity. */
public record ExemptionRequest(@NotNull Long patientId, @NotBlank String code, @NotNull LocalDate validFrom, @NotNull LocalDate validTo) {}
