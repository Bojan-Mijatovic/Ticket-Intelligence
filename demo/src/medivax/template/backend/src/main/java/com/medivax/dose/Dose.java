package com.medivax.dose;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDate;

/** One dose given to a patient: which vaccine, which dose of its series, when, from which lot. */
@Entity
@Table(name = "doses")
public class Dose {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "patient_id", nullable = false)
    private Long patientId;

    @Column(name = "vaccine_code", nullable = false)
    private String vaccineCode;

    /** 1 for the first dose; after the series, the booster continues the count. */
    @Column(name = "dose_number", nullable = false)
    private int doseNumber;

    @Column(name = "given_on", nullable = false)
    private LocalDate givenOn;

    @Column(name = "lot_code", nullable = false)
    private String lotCode;

    protected Dose() {}

    public Dose(Long patientId, String vaccineCode, int doseNumber, LocalDate givenOn, String lotCode) {
        this.patientId = patientId;
        this.vaccineCode = vaccineCode;
        this.doseNumber = doseNumber;
        this.givenOn = givenOn;
        this.lotCode = lotCode;
    }

    public Long getId() { return id; }
    public Long getPatientId() { return patientId; }
    public String getVaccineCode() { return vaccineCode; }
    public int getDoseNumber() { return doseNumber; }
    public LocalDate getGivenOn() { return givenOn; }
    public String getLotCode() { return lotCode; }
}
