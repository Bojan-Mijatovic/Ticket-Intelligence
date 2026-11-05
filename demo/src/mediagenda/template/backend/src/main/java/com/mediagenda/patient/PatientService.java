package com.mediagenda.patient;

import com.mediagenda.common.ConflictException;
import com.mediagenda.common.NotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Patient registry ("anagrafica"): create and update, one patient per fiscal code. */
@Service
public class PatientService {

    private final PatientRepository patients;

    public PatientService(PatientRepository patients) {
        this.patients = patients;
    }

    public Patient get(Long id) {
        return patients.findById(id).orElseThrow(() -> new NotFoundException("Patient", id));
    }

    @Transactional
    public Patient create(PatientRequest request) {
        patients.findByFiscalCodeIgnoreCase(request.fiscalCode()).ifPresent(existing -> {
            throw new ConflictException("fiscalCode: already registered for patient " + existing.getId());
        });
        return patients.save(Patient.from(request));
    }

    @Transactional
    public Patient update(Long id, PatientRequest request) {
        Patient patient = get(id);
        patients.findByFiscalCodeIgnoreCase(request.fiscalCode())
                .filter(other -> !other.getId().equals(id))
                .ifPresent(other -> {
                    throw new ConflictException("fiscalCode: already registered for patient " + other.getId());
                });
        patient.apply(request);
        return patient;
    }
}
