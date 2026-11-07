package com.medifarma.safety;

import com.medifarma.drug.Drug;
import com.medifarma.integration.LabValue;
import com.medifarma.integration.MediLabClient;
import com.medifarma.integration.PatientInfo;
import java.time.LocalDate;
import java.time.Period;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;

/**
 * Renal dose check: the eGFR from the patient's latest MediLab creatinine, then the renal rule of every drug
 * (avoid below renalAvoidBelow → ALTA, reduce the dose below renalReduceBelow → MEDIA).
 */
@Service
public class RenalCheckService {

    private final MediLabClient mediLab;

    public RenalCheckService(MediLabClient mediLab) {
        this.mediLab = mediLab;
    }

    public RenalCheck check(PatientInfo patient, List<Drug> drugs) {
        Optional<LabValue> latest = mediLab.latestCreatinine(patient.fiscalCode());
        if (latest.isEmpty()) {
            return new RenalCheck(null, null, null, null, List.of(Warning.info("Nessuna creatinina validata in MediLab: controllo renale non eseguito.")));
        }
        LabValue creatinine = latest.get();
        // MediLab reports creatinine in µmol/L (its results API, CUP_LAB-114); CKD-EPI needs mg/dL.
        double mgDl = creatinine.value().doubleValue() / RenalFunction.UMOL_PER_MG;
        int egfr = RenalFunction.egfr(mgDl, age(patient.birthDate()), patient.sex());

        List<Warning> warnings = new ArrayList<>();
        for (Drug d : drugs) {
            if (d.getRenalAvoidBelow() != null && egfr < d.getRenalAvoidBelow()) {
                warnings.add(Warning.renal(Warning.ALTA, d.getAic(), d.getName(),
                        "eGFR " + egfr + ": controindicato sotto " + d.getRenalAvoidBelow() + (d.getRenalNote() == null ? "" : ". " + d.getRenalNote())));
            } else if (d.getRenalReduceBelow() != null && egfr < d.getRenalReduceBelow()) {
                warnings.add(Warning.renal(Warning.MEDIA, d.getAic(), d.getName(),
                        "eGFR " + egfr + ": ridurre la dose sotto " + d.getRenalReduceBelow() + (d.getRenalNote() == null ? "" : ". " + d.getRenalNote())));
            }
        }
        return new RenalCheck(creatinine.value(), creatinine.unit(), creatinine.reportedAt(), egfr, warnings);
    }

    static int age(LocalDate birthDate) {
        return Period.between(birthDate, LocalDate.now()).getYears();
    }
}
