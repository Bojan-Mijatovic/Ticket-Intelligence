package com.medifarma.prescription;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/** Body of POST /api/prescriptions (the "Nuova prescrizione" form). */
public record PrescriptionRequest(
        @NotNull Long patientId,
        @NotBlank @Size(max = 80) String prescriber,
        @NotEmpty List<@Valid Item> items) {

    public record Item(
            @NotBlank String aic,
            @NotBlank @Size(max = 60) String dose,
            @NotBlank @Size(max = 60) String frequency,
            @Min(1) @Max(365) int days,
            @Min(1) @Max(20) int packs) {}
}
