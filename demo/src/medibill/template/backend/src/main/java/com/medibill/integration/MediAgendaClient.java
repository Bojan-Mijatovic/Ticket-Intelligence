package com.medibill.integration;

import java.util.List;
import java.util.Optional;

/** MediAgenda, the CUP booking application: its patient registry and the bookings (visits) to charge. */
public interface MediAgendaClient {

    /** The patient with this MediAgenda id, or empty when MediAgenda does not know it. */
    Optional<PatientInfo> patient(long id);

    /** Patients whose last name or fiscal code contains `q` (first page of MediAgenda's search). */
    List<PatientInfo> search(String q);

    /** Every MediAgenda booking, newest appointment first (GET /api/bookings). */
    List<BookingInfo> bookings();
}
