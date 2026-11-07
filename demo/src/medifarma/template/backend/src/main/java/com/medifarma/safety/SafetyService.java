package com.medifarma.safety;

import com.medifarma.common.BadRequestException;
import com.medifarma.drug.Drug;
import com.medifarma.drug.DrugRepository;
import com.medifarma.integration.MediAgendaClient;
import com.medifarma.integration.PatientInfo;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.springframework.stereotype.Service;

/** The checks of a prescription: interactions between its drugs and the renal dose rules for the patient. */
@Service
public class SafetyService {

    private final MediAgendaClient mediAgenda;
    private final DrugRepository drugs;
    private final InteractionRuleRepository rules;
    private final RenalCheckService renal;

    public SafetyService(MediAgendaClient mediAgenda, DrugRepository drugs, InteractionRuleRepository rules, RenalCheckService renal) {
        this.mediAgenda = mediAgenda;
        this.drugs = drugs;
        this.rules = rules;
        this.renal = renal;
    }

    public SafetyCheck check(SafetyRequest request) {
        PatientInfo patient = patient(request.patientId());
        return check(patient, drugs(request.aics()));
    }

    public SafetyCheck check(PatientInfo patient, List<Drug> list) {
        List<Warning> warnings = new ArrayList<>(interactions(list));
        RenalCheck kidney = renal.check(patient, list);
        warnings.addAll(kidney.warnings());
        warnings.sort(Comparator.comparing((Warning w) -> !w.isHigh()));
        return new SafetyCheck(patient.id(), patient.displayName(), kidney.creatinine(), kidney.creatinineUnit(), kidney.creatinineDate(), kidney.egfr(), warnings);
    }

    public PatientInfo patient(Long id) {
        return mediAgenda.patient(id).orElseThrow(() -> new BadRequestException("patientId: patient " + id + " is not in the MediAgenda registry"));
    }

    public List<Drug> drugs(List<String> aics) {
        List<Drug> list = new ArrayList<>();
        for (String aic : aics) {
            list.add(drugs.findById(aic).filter(Drug::isActive).orElseThrow(() -> new BadRequestException("aic: " + aic + " is not in the formulary")));
        }
        return list;
    }

    /** Every pair of drugs against the interaction rules. */
    List<Warning> interactions(List<Drug> list) {
        List<InteractionRule> all = rules.findAll();
        List<Warning> out = new ArrayList<>();
        for (int i = 0; i < list.size(); i++) {
            for (int j = i + 1; j < list.size(); j++) {
                Drug a = list.get(i);
                Drug b = list.get(j);
                all.stream()
                        .filter(r -> r.matches(a.getActiveIngredient(), b.getActiveIngredient()))
                        .forEach(r -> out.add(Warning.interaction(r.getSeverity(), a.getName() + " + " + b.getName(), r.getNote())));
            }
        }
        return out;
    }
}
