package com.medilab.result;

import com.medilab.catalog.Exam;
import java.math.BigDecimal;

/** Reference ranges: L below the range, H above it, N inside (bounds included). The range depends on the sex. */
public final class Flags {

    public static final String LOW = "L";
    public static final String HIGH = "H";
    public static final String NORMAL = "N";

    private Flags() {}

    /** The range of the exam for a patient of sex "M" or "F": [min, max]; a missing bound is open. */
    public static BigDecimal[] range(Exam exam, String sex) {
        // MediAgenda registers the sex as "M" or "F" (its PatientRequest); the order keeps that copy.
        boolean female = "F".equalsIgnoreCase(sex);
        return female
                ? new BigDecimal[] {exam.getRefMinF(), exam.getRefMaxF()}
                : new BigDecimal[] {exam.getRefMinM(), exam.getRefMaxM()};
    }

    public static String flag(Exam exam, String sex, BigDecimal value) {
        BigDecimal[] range = range(exam, sex);
        if (range[0] != null && value.compareTo(range[0]) < 0) return LOW;
        if (range[1] != null && value.compareTo(range[1]) > 0) return HIGH;
        return NORMAL;
    }
}
