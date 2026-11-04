package com.mediagenda.patient;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PatientRepository extends JpaRepository<Patient, Long> {

    Page<Patient> findByLastNameContainingIgnoreCaseOrFiscalCodeContainingIgnoreCase(String lastName, String fiscalCode, Pageable pageable);
}
