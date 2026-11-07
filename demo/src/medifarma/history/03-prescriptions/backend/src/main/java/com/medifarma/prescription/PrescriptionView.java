package com.medifarma.prescription;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/** A prescription as the lists and the dispensing page show it (drug names resolved). */
public record PrescriptionView(
        String id,
        Long patientId,
        String fiscalCode,
        String patientName,
        String sex,
        LocalDate birthDate,
        String prescriber,
        String status,
        LocalDateTime issuedAt,
        List<Item> items) {

    public record Item(String aic, String name, String dose, String frequency, int days, int packs) {}
}
