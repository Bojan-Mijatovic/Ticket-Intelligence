package com.medilab.result;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/** The results of a request: the entry screen ("Inserimento risultati") and the report ("referto"). */
public record ResultSheet(
        String orderId,
        String status,
        String patientName,
        String fiscalCode,
        String sex,
        LocalDate birthDate,
        String prescriber,
        LocalDateTime requestedAt,
        LocalDateTime reportedAt,
        String validatedBy,
        List<Row> rows) {

    public record Row(String examCode, String name, String sampleType, String unit, int decimals,
                      BigDecimal refMin, BigDecimal refMax, BigDecimal value, String flag) {}
}
