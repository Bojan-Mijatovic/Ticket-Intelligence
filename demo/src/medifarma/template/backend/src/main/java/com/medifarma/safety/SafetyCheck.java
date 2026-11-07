package com.medifarma.safety;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

/** All checks of a prescription, for the warnings panel of "Nuova prescrizione". ALTA warnings come first. */
public record SafetyCheck(
        Long patientId,
        String patientName,
        BigDecimal creatinine,
        String creatinineUnit,
        LocalDateTime creatinineDate,
        Integer egfr,
        List<Warning> warnings) {

    public long highCount() {
        return warnings.stream().filter(Warning::isHigh).count();
    }
}
