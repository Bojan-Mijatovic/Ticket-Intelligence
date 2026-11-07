package com.medilab.order;

/** Life of a test request: RICHIESTA → IN_LAVORAZIONE (all samples accepted) → REFERTATA (results validated). */
public final class OrderStatus {

    public static final String RICHIESTA = "RICHIESTA";
    public static final String IN_LAVORAZIONE = "IN_LAVORAZIONE";
    public static final String REFERTATA = "REFERTATA";
    public static final String ANNULLATA = "ANNULLATA";

    private OrderStatus() {}
}
