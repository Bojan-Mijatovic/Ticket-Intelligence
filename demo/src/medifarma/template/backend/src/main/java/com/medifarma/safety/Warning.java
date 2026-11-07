package com.medifarma.safety;

/**
 * A warning of the prescription checks: RENE (renal dose rule), INTERAZIONE (two drugs), INFO (a check that could not
 * be made). Severity ALTA must be acknowledged by the prescriber; MEDIA and INFO are shown only.
 */
public record Warning(String type, String severity, String aic, String drug, String message) {

    public static final String ALTA = "ALTA";
    public static final String MEDIA = "MEDIA";

    public static Warning renal(String severity, String aic, String drug, String message) {
        return new Warning("RENE", severity, aic, drug, message);
    }

    public static Warning interaction(String severity, String drugs, String message) {
        return new Warning("INTERAZIONE", severity, null, drugs, message);
    }

    public static Warning info(String message) {
        return new Warning("INFO", "INFO", null, null, message);
    }

    public boolean isHigh() {
        return ALTA.equals(severity);
    }
}
