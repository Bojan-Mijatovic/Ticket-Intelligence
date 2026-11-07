package com.medilab.sample;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Body of POST /api/samples/{barcode}/reject, e.g. { "reason": "Emolizzato" }. */
public record RejectRequest(@NotBlank @Size(max = 200) String reason) {}
