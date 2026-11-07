package com.medibill.integration;

import java.time.LocalDateTime;
import java.util.List;

/** A reported MediLab request (its OrderView): the patient and the tests, each with its regional tariff code. */
public record LabOrderInfo(String id, String fiscalCode, String patientName, String status, LocalDateTime reportedAt, List<Exam> exams) {

    public record Exam(String code, String name, String tariffCode) {}
}
