package com.medilab.order;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;

/** Body of POST /api/orders (the "Nuova richiesta" form). */
public record OrderRequest(
        @NotNull Long patientId,
        @NotBlank @Size(max = 80) String prescriber,
        @Pattern(regexp = "^$|^[0-9]{4}[A-Za-z][0-9]{10}$", message = "is not a valid electronic prescription number (NRE)") String prescriptionCode,
        boolean urgent,
        @NotEmpty List<@NotBlank String> examCodes) {}
