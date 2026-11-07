package com.medibill.integration;

import java.time.LocalDate;

/** A patient of the MediAgenda registry (GET /api/patients/{id} there), as MediBill needs it. */
public record PatientInfo(Long id, String fiscalCode, String firstName, String lastName, LocalDate birthDate, String sex) {

    /** "Rossi Mario", as the lists show it. */
    public String displayName() {
        return lastName + " " + firstName;
    }
}
