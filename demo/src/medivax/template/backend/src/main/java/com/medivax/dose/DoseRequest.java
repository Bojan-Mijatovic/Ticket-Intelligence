package com.medivax.dose;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;

/** A dose to record: the patient, the vaccine, the day it was given and the lot it came from. */
public record DoseRequest(@NotNull Long patientId, @NotBlank String vaccineCode, @NotNull LocalDate givenOn, @NotBlank String lotCode) {}
