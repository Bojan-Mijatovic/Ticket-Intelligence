package com.medilab.order;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/**
 * A request as the lists and the other applications see it (MediBill charges the tests of reported requests by
 * their tariff code).
 */
public record OrderView(
        String id,
        Long patientId,
        String fiscalCode,
        String patientName,
        String sex,
        LocalDate birthDate,
        String prescriber,
        String prescriptionCode,
        boolean urgent,
        String status,
        LocalDateTime requestedAt,
        LocalDateTime reportedAt,
        String cancelReason,
        List<ExamRef> exams,
        List<SampleRef> samples) {

    public record ExamRef(String code, String name, String sampleType, String tariffCode) {}

    public record SampleRef(String barcode, String sampleType, String status) {}
}
