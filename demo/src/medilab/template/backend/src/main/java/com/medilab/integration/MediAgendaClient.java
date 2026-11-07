package com.medilab.integration;

import java.util.List;
import java.util.Optional;

/**
 * The MediAgenda patient registry. MediLab keeps no patient registry of its own: a request is always made for a
 * MediAgenda patient, and the order stores a copy of the data it needs (fiscal code, name, sex, birth date).
 */
public interface MediAgendaClient {

    /** The patient with this MediAgenda id, or empty when MediAgenda does not know it. */
    Optional<PatientInfo> patient(long id);

    /** Patients whose last name or fiscal code contains `q` (first page of MediAgenda's search). */
    List<PatientInfo> search(String q);
}
