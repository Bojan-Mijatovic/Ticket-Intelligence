package com.medibill.receipt;

import jakarta.validation.constraints.NotBlank;

/** Body of POST /api/receipts: the receipt is made for every open charge of this patient. */
public record ReceiptRequest(@NotBlank String fiscalCode) {}
