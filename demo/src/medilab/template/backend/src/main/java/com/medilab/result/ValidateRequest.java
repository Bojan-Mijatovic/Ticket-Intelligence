package com.medilab.result;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Body of POST /api/orders/{id}/validate: who signs the report. */
public record ValidateRequest(@NotBlank @Size(max = 60) String validatedBy) {}
