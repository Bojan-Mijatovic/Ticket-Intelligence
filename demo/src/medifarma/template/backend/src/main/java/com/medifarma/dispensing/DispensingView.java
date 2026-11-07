package com.medifarma.dispensing;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/** What was handed out, for the Erogazione page and the pharmacy log. */
public record DispensingView(Long id, String prescriptionId, String patientName, LocalDateTime dispensedAt, List<Line> lines) {

    public record Line(String aic, String name, String lotNumber, LocalDate expiry, int packs) {}
}
