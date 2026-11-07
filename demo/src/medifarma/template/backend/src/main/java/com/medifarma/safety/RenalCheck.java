package com.medifarma.safety;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

/** The renal check of a prescription: the MediLab creatinine it used (as MediLab sent it), the eGFR, the warnings. */
public record RenalCheck(BigDecimal creatinine, String creatinineUnit, LocalDateTime creatinineDate, Integer egfr, List<Warning> warnings) {}
