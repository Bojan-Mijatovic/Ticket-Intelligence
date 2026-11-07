package com.medifarma.integration;

import java.util.Optional;

/** MediLab, the laboratory application: the patient's latest validated creatinine, for the renal dose check. */
public interface MediLabClient {

    /** The newest validated creatinine (exam CREA) of the patient, or empty when MediLab has none. */
    Optional<LabValue> latestCreatinine(String fiscalCode);
}
