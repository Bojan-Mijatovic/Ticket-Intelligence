package com.medibill.exemption;

import java.util.Arrays;
import java.util.List;
import java.util.Optional;

/** The exemption codes the billing office registers (a subset of the national list). */
public enum ExemptionType {
    E01("E01", "Età < 6 o > 65 anni con reddito familiare ≤ 36.151,98 €", true, List.of()),
    E02("E02", "Disoccupato e familiari a carico, reddito ≤ 8.263,31 €", true, List.of()),
    D048("048", "Patologia neoplastica maligna", true, List.of()),
    D013("013", "Diabete mellito", false, List.of("90.27.1", "90.28.1", "95.02")),
    D031("031", "Ipertensione arteriosa", false, List.of("89.7A.3", "90.37.4", "90.40.4", "90.16.3"));

    private final String code;
    private final String description;
    private final boolean total;
    private final List<String> tariffCodes;

    ExemptionType(String code, String description, boolean total, List<String> tariffCodes) {
        this.code = code;
        this.description = description;
        this.total = total;
        this.tariffCodes = tariffCodes;
    }

    public static Optional<ExemptionType> byCode(String code) {
        return Arrays.stream(values()).filter(t -> t.code.equalsIgnoreCase(code)).findFirst();
    }

    public String code() { return code; }
    public String description() { return description; }
    public boolean total() { return total; }
    public List<String> tariffCodes() { return tariffCodes; }
}
