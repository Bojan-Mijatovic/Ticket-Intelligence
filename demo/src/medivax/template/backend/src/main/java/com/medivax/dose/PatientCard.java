package com.medivax.dose;

import com.medivax.patient.Patient;
import com.medivax.schedule.Schedule.NextDose;
import java.util.List;

/** The vaccination card of a patient: the doses given and the next ones due. */
public record PatientCard(Patient patient, List<DoseView> doses, List<NextDose> next) {}
