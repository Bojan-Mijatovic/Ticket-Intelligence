package com.medivax.dose;

import java.time.LocalDate;

/** A dose as the patient card shows it, with the vaccine's name. */
public record DoseView(Long id, String vaccineCode, String vaccineName, int doseNumber, LocalDate givenOn, String lotCode) {}
