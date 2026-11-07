package com.medilab.result;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * A validated result of a patient, for the other applications of the suite (GET /api/patients/{fiscalCode}/results).
 * The value is in `unit`: always read both.
 */
public record PatientResult(String orderId, String examCode, String examName, BigDecimal value, String unit, String flag, LocalDateTime reportedAt) {}
