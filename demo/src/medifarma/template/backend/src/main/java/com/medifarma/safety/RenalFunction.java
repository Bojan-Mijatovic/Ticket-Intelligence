package com.medifarma.safety;

/** Kidney function from serum creatinine: eGFR with the CKD-EPI 2021 equation (no race coefficient). */
public final class RenalFunction {

    /** 1 mg/dL of creatinine = 88.4 µmol/L. */
    public static final double UMOL_PER_MG = 88.4;

    private RenalFunction() {}

    /**
     * eGFR in mL/min/1.73 m², rounded.
     * @param creatinineMgDl serum creatinine in mg/dL
     * @param sex "M" or "F", as MediAgenda registers it
     */
    public static int egfr(double creatinineMgDl, int age, String sex) {
        boolean female = "F".equalsIgnoreCase(sex);
        double kappa = female ? 0.7 : 0.9;
        double alpha = female ? -0.241 : -0.302;
        double ratio = creatinineMgDl / kappa;
        double value = 142
                * Math.pow(Math.min(ratio, 1), alpha)
                * Math.pow(Math.max(ratio, 1), -1.200)
                * Math.pow(0.9938, age)
                * (female ? 1.012 : 1);
        return (int) Math.round(value);
    }
}
