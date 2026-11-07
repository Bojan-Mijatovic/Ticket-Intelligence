package com.medibill.receipt;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/** A receipt with its lines, as the Ricevute page and the printout show it. */
public record ReceiptView(
        String id,
        String fiscalCode,
        String patientName,
        LocalDateTime issuedAt,
        BigDecimal total,
        BigDecimal exempt,
        BigDecimal copay,
        String exemptionCodes,
        String status,
        LocalDateTime paidAt,
        List<Line> lines) {

    public record Line(Long chargeId, LocalDate serviceDate, String source, String tariffCode, String description, BigDecimal amount, boolean exempt) {}
}
