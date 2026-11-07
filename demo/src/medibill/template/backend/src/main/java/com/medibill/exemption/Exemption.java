package com.medibill.exemption;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.SequenceGenerator;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * A co-pay exemption of a patient ("esenzione ticket"): total (income, age, oncology: no co-pay at all) or for a
 * disease (only the listed tariff codes are free, e.g. glucose and HbA1c for diabetes), valid between two dates.
 */
@Entity
@Table(name = "exemptions")
public class Exemption {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "exemption_seq")
    @SequenceGenerator(name = "exemption_seq", sequenceName = "exemption_seq", allocationSize = 1)
    private Long id;
    @Column(name = "fiscal_code")
    private String fiscalCode;
    @Column(name = "patient_name")
    private String patientName;
    private String code;
    private String description;
    @Column(name = "total_exemption")
    private boolean total;
    /** Tariff codes covered by a disease exemption, comma separated (empty for a total exemption). */
    @Column(name = "tariff_codes")
    private String tariffCodes;
    @Column(name = "valid_from")
    private LocalDate validFrom;
    @Column(name = "valid_to")
    private LocalDate validTo;

    protected Exemption() {}

    static Exemption of(String fiscalCode, String patientName, ExemptionType type, LocalDate from, LocalDate to) {
        Exemption e = new Exemption();
        e.fiscalCode = fiscalCode.toUpperCase();
        e.patientName = patientName;
        e.code = type.code();
        e.description = type.description();
        e.total = type.total();
        e.tariffCodes = String.join(",", type.tariffCodes());
        e.validFrom = from;
        e.validTo = to;
        return e;
    }

    /** Valid on `day` (both dates included). */
    public boolean validOn(LocalDate day) {
        return !day.isBefore(validFrom) && !day.isAfter(validTo);
    }

    /** Whether this exemption makes a service with this tariff free. */
    public boolean covers(String tariffCode) {
        return total || tariffCodeSet().contains(tariffCode);
    }

    public Set<String> tariffCodeSet() {
        return tariffCodes == null || tariffCodes.isBlank() ? Set.of() : Arrays.stream(tariffCodes.split(",")).map(String::trim).collect(Collectors.toSet());
    }

    public Long getId() { return id; }
    public String getFiscalCode() { return fiscalCode; }
    public String getPatientName() { return patientName; }
    public String getCode() { return code; }
    public String getDescription() { return description; }
    public boolean isTotal() { return total; }
    public String getTariffCodes() { return tariffCodes; }
    public LocalDate getValidFrom() { return validFrom; }
    public LocalDate getValidTo() { return validTo; }
}
