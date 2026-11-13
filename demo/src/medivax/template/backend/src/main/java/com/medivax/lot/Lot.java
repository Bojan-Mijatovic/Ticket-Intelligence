package com.medivax.lot;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDate;

/** A lot of a vaccine in the fridge. A dose can be given from it until its expiry day, included. */
@Entity
@Table(name = "lots")
public class Lot {

    @Id
    private String code;

    @Column(name = "vaccine_code", nullable = false)
    private String vaccineCode;

    @Column(nullable = false)
    private LocalDate expiry;

    @Column(name = "doses_left", nullable = false)
    private int dosesLeft;

    protected Lot() {}

    public Lot(String code, String vaccineCode, LocalDate expiry, int dosesLeft) {
        this.code = code;
        this.vaccineCode = vaccineCode;
        this.expiry = expiry;
        this.dosesLeft = dosesLeft;
    }

    public String getCode() { return code; }
    public String getVaccineCode() { return vaccineCode; }
    public LocalDate getExpiry() { return expiry; }
    public int getDosesLeft() { return dosesLeft; }

    /** Whether a dose can still be given from it on `day`: the expiry day itself still counts. */
    public boolean usableOn(LocalDate day) {
        return !expiry.isBefore(day);
    }

    public void takeOne() {
        dosesLeft--;
    }
}
