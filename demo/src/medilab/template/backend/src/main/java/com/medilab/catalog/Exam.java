package com.medilab.catalog;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;

/**
 * A laboratory test of the catalog ("catalogo esami"): what is measured, in which sample and unit, its reference
 * range (by sex) and the regional tariff code MediBill charges it with.
 */
@Entity
@Table(name = "exams")
public class Exam {

    @Id
    private String code;
    private String name;
    @Column(name = "sample_type")
    private String sampleType;
    private String unit;
    private int decimals;
    @Column(name = "ref_min_m")
    private BigDecimal refMinM;
    @Column(name = "ref_max_m")
    private BigDecimal refMaxM;
    @Column(name = "ref_min_f")
    private BigDecimal refMinF;
    @Column(name = "ref_max_f")
    private BigDecimal refMaxF;
    @Column(name = "tariff_code")
    private String tariffCode;
    private BigDecimal price;
    private boolean active;

    protected Exam() {}

    public String getCode() { return code; }
    public String getName() { return name; }
    public String getSampleType() { return sampleType; }
    public String getUnit() { return unit; }
    public int getDecimals() { return decimals; }
    public BigDecimal getRefMinM() { return refMinM; }
    public BigDecimal getRefMaxM() { return refMaxM; }
    public BigDecimal getRefMinF() { return refMinF; }
    public BigDecimal getRefMaxF() { return refMaxF; }
    public String getTariffCode() { return tariffCode; }
    public BigDecimal getPrice() { return price; }
    public boolean isActive() { return active; }
}
