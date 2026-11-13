package com.medivax.patient;

import com.medivax.common.NotFoundException;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PatientService {

    /** Fewer characters match too many patients to be useful. */
    static final int MIN_QUERY = 2;

    private final PatientRepository patients;

    public PatientService(PatientRepository patients) {
        this.patients = patients;
    }

    /** Patients whose surname or fiscal code starts with `query`, in any case ("rossi" finds "Rossi"). */
    @Transactional(readOnly = true)
    public List<Patient> search(String query) {
        String q = query == null ? "" : query.trim();
        if (q.length() < MIN_QUERY) return List.of();
        return patients.findTop50ByLastNameStartingWithIgnoreCaseOrFiscalCodeStartingWithIgnoreCaseOrderByLastNameAscFirstNameAsc(q, q);
    }

    @Transactional(readOnly = true)
    public Patient get(long id) {
        return patients.findById(id).orElseThrow(() -> new NotFoundException("Patient", id));
    }
}
