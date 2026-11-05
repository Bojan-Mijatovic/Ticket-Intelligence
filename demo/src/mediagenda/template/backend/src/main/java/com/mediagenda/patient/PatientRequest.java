package com.mediagenda.patient;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Past;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

/**
 * Body of POST /api/patients and PUT /api/patients/{id} (the "Anagrafica paziente" form).
 * The fiscal code ("codice fiscale") is checked for its format only, not for its check character.
 */
public record PatientRequest(
        @NotBlank
        @Pattern(regexp = "(?i)^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$",
                message = "is not a valid fiscal code")
        String fiscalCode,
        @NotBlank @Size(max = 60) String firstName,
        @NotBlank @Size(max = 60) String lastName,
        @NotNull @Past LocalDate birthDate,
        @NotBlank @Pattern(regexp = "^[MF]$", message = "must be M or F") String sex,
        @Size(max = 60) String city,
        @Pattern(regexp = "^$|^\\+?[0-9 ]{6,20}$", message = "is not a valid phone number") String phone,
        @Email @Size(max = 120) String email) {}
