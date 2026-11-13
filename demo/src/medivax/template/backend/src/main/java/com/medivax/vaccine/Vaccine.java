package com.medivax.vaccine;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/** A vaccine of the catalog: its primary series, the age range it is given in, and its booster. */
@Entity
@Table(name = "vaccines")
public class Vaccine {

    @Id
    private String code;

    @Column(nullable = false)
    private String name;

    /** Doses of the primary series. */
    @Column(nullable = false)
    private int doses;

    /** Days between two doses of the series. */
    @Column(name = "interval_days", nullable = false)
    private int intervalDays;

    @Column(name = "min_age_months", nullable = false)
    private int minAgeMonths;

    /** The last age (in years) it is given at; null: no upper limit. */
    @Column(name = "max_age_years")
    private Integer maxAgeYears;

    /** Months from the last dose to the booster; null: no booster. */
    @Column(name = "booster_months")
    private Integer boosterMonths;

    protected Vaccine() {}

    public Vaccine(String code, String name, int doses, int intervalDays, int minAgeMonths, Integer maxAgeYears, Integer boosterMonths) {
        this.code = code;
        this.name = name;
        this.doses = doses;
        this.intervalDays = intervalDays;
        this.minAgeMonths = minAgeMonths;
        this.maxAgeYears = maxAgeYears;
        this.boosterMonths = boosterMonths;
    }

    public String getCode() { return code; }
    public String getName() { return name; }
    public int getDoses() { return doses; }
    public int getIntervalDays() { return intervalDays; }
    public int getMinAgeMonths() { return minAgeMonths; }
    public Integer getMaxAgeYears() { return maxAgeYears; }
    public Integer getBoosterMonths() { return boosterMonths; }
}
