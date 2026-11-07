package com.medilab.result;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

/** One value of PUT /api/orders/{id}/results, e.g. { "examCode": "GLU", "value": 92 }. */
public record ResultEntry(@NotBlank String examCode, @NotNull @DecimalMin("0") BigDecimal value) {}
